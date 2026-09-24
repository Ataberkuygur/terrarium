#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// terrarium-mcp — Model Context Protocol server for the Terrarium app.
//
// A single-file, zero-dependency MCP server that exposes a running
// Terrarium instance to any MCP client (Claude Desktop, Devin, Cursor,
// Windsurf, …): board cards, crew agents, wiki pages, pty terminals,
// browser panes and the live event feed — all proxied through the app's
// token-gated remote API (src/main/mobile.ts, ports 8795–8804).
//
// Transports:  MCP stdio (newline-delimited JSON-RPC 2.0)
// Protocols:   2024-11-05 · 2025-03-26 · 2025-06-18
// Build:       bun build --compile --minify mcp/terrarium-mcp.ts \
//                --outfile dist/terrarium-mcp
// CLI:         terrarium-mcp [--api URL] [--token T] [--update-url URL]
//                [--version] [--doctor] [--self-update] [--help]
//
// Config resolution order (first wins):
//   1. CLI flags            --api / --token / --update-url
//   2. Environment          TERRARIUM_API / TERRARIUM_TOKEN /
//                           TERRARIUM_MCP_UPDATE_URL
//   3. Config file          ./terrarium-mcp.json (next to the exe), then
//                           ~/.terrarium/mcp.json
//   4. Defaults             scan http://127.0.0.1:8795..8804, token read
//                           from ~/.terrarium/mobile-token
// ─────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { basename, dirname, join } from 'node:path'

const VERSION = '1.0.0'
const SERVER_NAME = 'terrarium-mcp'
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
const SCAN_PORT_MIN = 8795
const SCAN_PORT_MAX = 8804
const HTTP_TIMEOUT_MS = 15_000
const DISCOVERY_TIMEOUT_MS = 2_500

// ── tiny utils ────────────────────────────────────────────────────────────

const log = (...a: unknown[]) => process.stderr.write(`[terrarium-mcp] ${a.join(' ')}\n`)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** Compare dotted versions — returns <0, 0, >0. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Strip ANSI escapes so terminal output is readable in plain text tools. */
function stripAnsi(s: string): string {
  // CSI sequences, OSC (terminated by BEL or ST), and misc escapes
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-2]?/g, '')
    .replace(/\x1b[=>MNO\\]/g, '')
    .replace(/\x1b\[[\=>]/g, '')
    .replace(/\x07/g, '')
}

// ── config ────────────────────────────────────────────────────────────────

interface FileConfig {
  api?: string
  token?: string
  updateUrl?: string
}

interface Config {
  /** Explicit API base (e.g. http://192.168.1.5:8795); null → loopback scan. */
  api: string | null
  /** Bearer token for the remote API. */
  token: string | null
  /** Where the token default was found — surfaced by --doctor/status. */
  tokenSource: string
  /** JSON manifest URL for check_update/self_update. */
  updateUrl: string | null
  args: string[]
}

function readJsonFile(path: string): FileConfig {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isRecord(parsed) ? (parsed as FileConfig) : {}
  } catch {
    return {}
  }
}

function terrariumHome(): string {
  const home = homedir()
  const modern = join(home, '.terrarium')
  const legacy = join(home, '.atolye')
  if (existsSync(modern) || !existsSync(legacy)) return modern
  return legacy
}

function defaultToken(): { token: string | null; source: string } {
  for (const p of [join(terrariumHome(), 'mobile-token')]) {
    try {
      if (existsSync(p)) {
        const t = readFileSync(p, 'utf8').trim()
        if (t.length >= 8) return { token: t, source: p }
      }
    } catch {
      /* keep looking */
    }
  }
  return { token: null, source: 'none' }
}

function parseArgs(argv: string[]): { flags: Map<string, string>; bare: string[] } {
  const flags = new Map<string, string>()
  const bare: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1))
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags.set(a.slice(2), argv[++i])
      else flags.set(a.slice(2), 'true')
    } else bare.push(a)
  }
  return { flags, bare }
}

function resolveConfig(): Config {
  const { flags, bare } = parseArgs(process.argv.slice(2))

  const exeDir = (() => {
    try {
      return dirname(process.execPath)
    } catch {
      return process.cwd()
    }
  })()

  // layered file config: exe-local wins over the terrarium home file
  const fileCfg: FileConfig = {
    ...readJsonFile(join(terrariumHome(), 'mcp.json')),
    ...readJsonFile(join(exeDir, 'terrarium-mcp.json'))
  }

  const env = process.env
  const api =
    flags.get('api') ?? env.TERRARIUM_API?.trim() ?? fileCfg.api?.trim() ?? null

  let token = flags.get('token') ?? env.TERRARIUM_TOKEN?.trim() ?? fileCfg.token?.trim() ?? null
  let tokenSource = token
    ? flags.has('token')
      ? '--token'
      : env.TERRARIUM_TOKEN
        ? 'TERRARIUM_TOKEN'
        : 'config file'
    : 'none'
  if (!token) {
    const d = defaultToken()
    token = d.token
    tokenSource = d.source
  }

  const updateUrl =
    flags.get('update-url') ??
    env.TERRARIUM_MCP_UPDATE_URL?.trim() ??
    fileCfg.updateUrl?.trim() ??
    null

  return { api, token, tokenSource, updateUrl, args: bare }
}

// ── remote API client ─────────────────────────────────────────────────────

let resolvedBase: string | null = null
const cfg = resolveConfig()

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.token) h.authorization = `Bearer ${cfg.token}`
  return h
}

/**
 * Probe a base URL — true when a Terrarium remote API answers. Checks
 * /api/state (present on every app version), NOT /api/info, so the MCP
 * still discovers builds older than the extended API surface.
 */
async function probe(base: string): Promise<boolean> {
  try {
    const sep = base.includes('?') ? '&' : '?'
    const res = await fetch(
      `${base}/api/state${cfg.token ? `${sep}k=${encodeURIComponent(cfg.token)}` : ''}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) }
    )
    if (!res.ok) return false
    const body: unknown = await res.json()
    return (
      isRecord(body) && Array.isArray(body.agents) && Array.isArray(body.cards)
    )
  } catch {
    return false
  }
}

/** Find the API base once — explicit config, else scan the port range. */
async function discover(): Promise<string> {
  if (resolvedBase) return resolvedBase
  if (cfg.api) {
    const base = cfg.api.replace(/\/+$/, '')
    resolvedBase = base
    return base
  }
  const bases: string[] = []
  for (let p = SCAN_PORT_MIN; p <= SCAN_PORT_MAX; p++) bases.push(`http://127.0.0.1:${p}`)
  const hits = await Promise.all(
    bases.map(async (b) => ((await probe(b)) ? b : null))
  )
  const found = hits.find((b): b is string => !!b)
  if (!found) {
    throw new Error(
      `no Terrarium remote API found on 127.0.0.1:${SCAN_PORT_MIN}-${SCAN_PORT_MAX} ` +
        `(is the app running? token: ${cfg.tokenSource})`
    )
  }
  resolvedBase = found
  log(`api discovered at ${found}`)
  return found
}

async function api(
  path: string,
  opts: {
    method?: string
    body?: unknown
    query?: Record<string, string | number | undefined>
    timeoutMs?: number
  } = {}
): Promise<unknown> {
  const doCall = async (): Promise<Response> => {
    const base = await discover()
    const qs = opts.query
      ? '?' +
        Object.entries(opts.query)
          .filter((e): e is [string, string | number] => e[1] !== undefined)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&')
      : ''
    const url = `${base}${path}${qs}${cfg.token ? `${qs ? '&' : '?'}k=${encodeURIComponent(cfg.token)}` : ''}`
    return fetch(url, {
      method: opts.method ?? 'GET',
      headers: authHeaders(),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? HTTP_TIMEOUT_MS)
    })
  }

  let res: Response
  try {
    res = await doCall()
  } catch (e) {
    // connection-level failure on the cached base — the app may have
    // restarted onto a different port: re-scan once, then give up
    if (cfg.api) throw e
    resolvedBase = null
    res = await doCall()
  }

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  if (!res.ok) {
    if (res.status === 403) {
      throw new ApiError(403, `forbidden — bad or missing token (source: ${cfg.tokenSource})`)
    }
    const msg =
      isRecord(parsed) && typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return parsed
}

// ── orchestration calls ───────────────────────────────────────────────────
// Inside a Terrarium network terminal the loopback pane bridge is right
// there (TERRARIUM_WS_CMD, no token); elsewhere go through the remote
// API's /api/pane passthrough. The caller's TERRARIUM_SID/NET pick the
// network unless `net` is given.

async function netCall(
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<unknown> {
  const body: Record<string, unknown> = { cmd, timeoutMs }
  for (const [k, v] of Object.entries(args)) if (v !== undefined) body[k] = v
  if (body.net === undefined && process.env.TERRARIUM_NET) body.net = process.env.TERRARIUM_NET
  if (process.env.TERRARIUM_SID) body.sid = process.env.TERRARIUM_SID
  const direct = process.env.TERRARIUM_WS_CMD
  let reply: unknown
  if (direct) {
    const res = await fetch(direct, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs + 5000)
    })
    reply = await res.json()
  } else {
    reply = await api('/api/pane', { method: 'POST', body, timeoutMs: timeoutMs + 5000 })
  }
  if (isRecord(reply) && reply.ok === false) {
    throw new Error(typeof reply.error === 'string' ? reply.error : 'orchestration command failed')
  }
  return isRecord(reply) && 'result' in reply ? reply.result : reply
}

const secMs = (v: unknown): number | undefined => {
  const n = num(v)
  return n === undefined ? undefined : n * 1000
}

// ── tool registry ─────────────────────────────────────────────────────────

interface JsonSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

interface Tool {
  name: string
  description: string
  inputSchema: JsonSchema
  run(args: Record<string, unknown>): Promise<unknown>
}

const req = (args: Record<string, unknown>, key: string): unknown => {
  const v = args[key]
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`missing required argument: ${key}`)
  }
  return v
}
const reqStr = (args: Record<string, unknown>, key: string): string => String(req(args, key))

const CARD_STATUSES = ['backlog', 'ready', 'doing', 'review', 'done']

const TOOLS: Tool[] = [
  // ── meta ──
  {
    name: 'terrarium_status',
    description:
      'Connectivity + version report for this MCP server and the Terrarium remote API it bridges to. Run first to verify the setup — reports the API base, app version, which backends are live (terminals/wiki/panes), and where the auth token came from.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      let apiInfo: unknown = null
      let apiError: string | null = null
      try {
        apiInfo = await api('/api/info')
      } catch (e) {
        apiError = e instanceof Error ? e.message : String(e)
      }
      return {
        server: { name: SERVER_NAME, version: VERSION, protocol: [...PROTOCOL_VERSIONS] },
        config: {
          api: cfg.api ?? `auto-scan 127.0.0.1:${SCAN_PORT_MIN}-${SCAN_PORT_MAX}`,
          resolvedBase,
          tokenSource: cfg.tokenSource,
          updateUrl: cfg.updateUrl
        },
        api: apiError ? { ok: false, error: apiError } : { ok: true, info: apiInfo }
      }
    }
  },

  // ── office state / events ──
  {
    name: 'get_office_state',
    description:
      'Full Terrarium office snapshot: agents (status, task, sleeping), cards (board columns, priority, dueAt), runs (agent work sessions with worktree/branch), projects and the recent event feed. The single best "what is happening right now" call.',
    inputSchema: {
      type: 'object',
      properties: {
        eventLimit: { type: 'number', description: 'max events to include (default 40, max 200)' }
      }
    },
    async run(args) {
      const s = (await api('/api/state')) as Record<string, unknown>
      const limit = Math.min(200, Math.max(0, num(args.eventLimit) ?? 40))
      if (Array.isArray(s.events)) s.events = s.events.slice(0, limit)
      return s
    }
  },
  {
    name: 'list_events',
    description:
      'Recent office activity feed — card moves, run logs, completions, agent status changes. Newest first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max events (default 40, max 200)' } }
    },
    async run(args) {
      return api('/api/events', { query: { limit: Math.min(200, Math.max(1, num(args.limit) ?? 40)) } })
    }
  },

  // ── cards ──
  {
    name: 'list_cards',
    description:
      'List task cards from the board, optionally filtered by column status and/or assignee. Card fields: id, title, body, status (backlog|ready|doing|review|done), assigneeId, priority (0 none, 1 normal, 2 urgent), dueAt (ms epoch or null), createdAt, updatedAt.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: CARD_STATUSES, description: 'filter by column' },
        assignee: { type: 'string', description: 'filter by assignee agent id' }
      }
    },
    async run(args) {
      return api('/api/cards', {
        query: { status: str(args.status), assignee: str(args.assignee) }
      })
    }
  },
  {
    name: 'get_card',
    description: 'Fetch a single card by id (full fields incl. body and dueAt).',
    inputSchema: {
      type: 'object',
      properties: { cardId: { type: 'string' } },
      required: ['cardId']
    },
    async run(args) {
      return api(`/api/cards/${encodeURIComponent(reqStr(args, 'cardId'))}`)
    }
  },
  {
    name: 'create_card',
    description:
      'Create a task card on the board. Optionally set body, priority, due date (dueAt ms epoch or ISO string), starting column, and assignee — applied after creation.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'details / notes (markdown ok)' },
        projectId: { type: 'string', description: 'defaults to the first project' },
        priority: { type: 'number', enum: [0, 1, 2], description: '0 none · 1 normal · 2 urgent' },
        dueAt: {
          type: ['number', 'string'],
          description: 'ms epoch or ISO-8601 date/datetime'
        },
        status: { type: 'string', enum: CARD_STATUSES, description: 'column to start in (default backlog)' },
        assignee: { type: 'string', description: 'agent id to assign immediately' }
      },
      required: ['title']
    },
    async run(args) {
      const dueAt = parseDue(args.dueAt)
      const created = (await api('/api/cards', {
        method: 'POST',
        body: {
          title: reqStr(args, 'title'),
          body: str(args.body),
          projectId: str(args.projectId),
          dueAt
        }
      })) as { card: { id: string } }
      const id = created.card.id
      if (num(args.priority) !== undefined) {
        await api(`/api/cards/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { priority: num(args.priority) }
        })
      }
      if (str(args.status) && str(args.status) !== 'backlog') {
        await api(`/api/cards/${encodeURIComponent(id)}/move`, {
          method: 'POST',
          body: { status: str(args.status) }
        })
      }
      if (str(args.assignee)) {
        await api(`/api/cards/${encodeURIComponent(id)}/assign`, {
          method: 'POST',
          body: { agentId: str(args.assignee) }
        })
      }
      return api(`/api/cards/${encodeURIComponent(id)}`)
    }
  },
  {
    name: 'update_card',
    description:
      'Patch a card: title, body, priority (0|1|2), or dueAt. Pass dueAt=null to clear the schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        priority: { type: 'number', enum: [0, 1, 2] },
        dueAt: { type: ['number', 'string', 'null'], description: 'ms epoch, ISO string, or null to clear' }
      },
      required: ['cardId']
    },
    async run(args) {
      const body: Record<string, unknown> = {}
      if (args.title !== undefined) body.title = str(args.title)
      if (args.body !== undefined) body.body = str(args.body)
      if (args.priority !== undefined) body.priority = num(args.priority)
      if ('dueAt' in args) body.dueAt = args.dueAt === null ? null : parseDue(args.dueAt)
      return api(`/api/cards/${encodeURIComponent(reqStr(args, 'cardId'))}`, {
        method: 'PATCH',
        body
      })
    }
  },
  {
    name: 'move_card',
    description: 'Move a card to a board column (backlog|ready|doing|review|done).',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        status: { type: 'string', enum: CARD_STATUSES }
      },
      required: ['cardId', 'status']
    },
    async run(args) {
      return api(`/api/cards/${encodeURIComponent(reqStr(args, 'cardId'))}/move`, {
        method: 'POST',
        body: { status: reqStr(args, 'status') }
      })
    }
  },
  {
    name: 'assign_card',
    description:
      'Assign a card to a crew agent — moves it to doing, marks the agent working and opens a run (with worktree+branch).',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        agentId: { type: 'string' }
      },
      required: ['cardId', 'agentId']
    },
    async run(args) {
      return api(`/api/cards/${encodeURIComponent(reqStr(args, 'cardId'))}/assign`, {
        method: 'POST',
        body: { agentId: reqStr(args, 'agentId') }
      })
    }
  },
  {
    name: 'delete_card',
    description: 'Permanently delete a card — its runs cascade and the assignee is freed.',
    inputSchema: {
      type: 'object',
      properties: { cardId: { type: 'string' } },
      required: ['cardId']
    },
    async run(args) {
      return api(`/api/cards/${encodeURIComponent(reqStr(args, 'cardId'))}`, { method: 'DELETE' })
    }
  },

  // ── agents ──
  {
    name: 'list_agents',
    description:
      'List the crew: id, name, role, domain, status (idle|working|waiting|done|offline), current taskId, deskId, lastActiveAt, sleeping.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return api('/api/agents')
    }
  },
  {
    name: 'upsert_agent',
    description:
      'Create or update a crew member. Supply the full agent object — minimum {id, name, role}; role ∈ lead|builder|reviewer|researcher|designer|scribe, domain ∈ frontend|backend|marketing|design|research|legal|general.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'object',
          description: 'full Agent object (id + name required)',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
            domain: { type: 'string' },
            brief: { type: 'string' },
            hue: { type: 'number' },
            deskId: { type: 'string' },
            status: { type: 'string' }
          },
          required: ['id', 'name']
        }
      },
      required: ['agent']
    },
    async run(args) {
      const agent = req(args, 'agent')
      if (!isRecord(agent)) throw new Error('agent must be an object')
      return api('/api/agents', { method: 'POST', body: agent })
    }
  },
  {
    name: 'remove_agent',
    description: 'Remove a crew member; their cards return to unassigned.',
    inputSchema: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
      required: ['agentId']
    },
    async run(args) {
      return api(`/api/agents/${encodeURIComponent(reqStr(args, 'agentId'))}`, { method: 'DELETE' })
    }
  },
  {
    name: 'nudge_agent',
    description:
      'Send a message to an agent — logged to the event feed, and wakes a waiting agent back to working.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['agentId', 'message']
    },
    async run(args) {
      return api(`/api/agents/${encodeURIComponent(reqStr(args, 'agentId'))}/nudge`, {
        method: 'POST',
        body: { message: reqStr(args, 'message') }
      })
    }
  },

  // ── wiki ──
  {
    name: 'list_wiki_pages',
    description:
      'List wiki/doc pages for a project (meta only: id, title, path, type, stale, links, updatedAt). Pass `query` for full-text search.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'defaults to the first project' },
        query: { type: 'string', description: 'FTS search string' }
      }
    },
    async run(args) {
      return api('/api/wiki', {
        query: { projectId: str(args.projectId), q: str(args.query) }
      })
    }
  },
  {
    name: 'get_wiki_page',
    description: 'Fetch one wiki page incl. markdown body and backlinks.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        projectId: { type: 'string', description: 'defaults to the first project' }
      },
      required: ['pageId']
    },
    async run(args) {
      return api(`/api/wiki/${encodeURIComponent(reqStr(args, 'pageId'))}`, {
        query: { projectId: str(args.projectId) }
      })
    }
  },
  {
    name: 'save_wiki_page',
    description:
      'Overwrite a wiki page body (markdown). [[wikilinks]] inside the body re-derive the link graph.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        body: { type: 'string' },
        projectId: { type: 'string', description: 'defaults to the first project' }
      },
      required: ['pageId', 'body']
    },
    async run(args) {
      return api(`/api/wiki/${encodeURIComponent(reqStr(args, 'pageId'))}`, {
        method: 'PUT',
        body: { body: reqStr(args, 'body'), projectId: str(args.projectId) }
      })
    }
  },

  // ── terminals ──
  {
    name: 'terminal_list',
    description:
      'List pty sessions owned by the app: sessionId, command, resolvedCommand, cwd, cols/rows, status (spawning|running|exited|dead), pid, startedAt, exitCode.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return api('/api/terminals')
    }
  },
  {
    name: 'terminal_spawn',
    description:
      'Spawn a new terminal session in the pty host (survives app restarts). command may be a bare name (claude, powershell, cmd, node) or an absolute path; .cmd/.bat shims resolve on Windows.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'working directory (absolute path)' },
        args: { type: 'array', items: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        cols: { type: 'number', description: 'default 120' },
        rows: { type: 'number', description: 'default 30' },
        sessionId: { type: 'string', description: 'caller-chosen id; auto-generated when omitted' }
      },
      required: ['command', 'cwd']
    },
    async run(args) {
      return api('/api/terminals', {
        method: 'POST',
        body: {
          command: reqStr(args, 'command'),
          cwd: reqStr(args, 'cwd'),
          args: Array.isArray(args.args) ? args.args : undefined,
          env: isRecord(args.env) ? args.env : undefined,
          cols: num(args.cols),
          rows: num(args.rows),
          sessionId: str(args.sessionId)
        }
      })
    }
  },
  {
    name: 'terminal_write',
    description:
      'Write raw input to a terminal session (keystrokes/paste). Set enter=true to append a carriage return — the usual way to submit a line.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        data: { type: 'string' },
        enter: { type: 'boolean', description: 'append \\r (submit the line)' }
      },
      required: ['sessionId', 'data']
    },
    async run(args) {
      const data = reqStr(args, 'data') + (bool(args.enter) ? '\r' : '')
      return api(`/api/terminals/${encodeURIComponent(reqStr(args, 'sessionId'))}/write`, {
        method: 'POST',
        body: { data }
      })
    }
  },
  {
    name: 'terminal_read',
    description:
      'Read the tail of a terminal session’s scrollback ring (≤256 KB). stripAnsi=true (default) returns clean text; false returns raw output with escape codes.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        maxChars: { type: 'number', description: 'default 16000' },
        stripAnsi: { type: 'boolean', description: 'default true' }
      },
      required: ['sessionId']
    },
    async run(args) {
      const r = (await api(`/api/terminals/${encodeURIComponent(reqStr(args, 'sessionId'))}/read`, {
        query: { maxChars: num(args.maxChars) ?? 16000 }
      })) as { data: string }
      return { data: bool(args.stripAnsi) === false ? r.data : stripAnsi(r.data) }
    }
  },
  {
    name: 'terminal_resize',
    description: 'Resize a terminal session grid.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        cols: { type: 'number' },
        rows: { type: 'number' }
      },
      required: ['sessionId', 'cols', 'rows']
    },
    async run(args) {
      return api(`/api/terminals/${encodeURIComponent(reqStr(args, 'sessionId'))}/resize`, {
        method: 'POST',
        body: { cols: num(req(args, 'cols')), rows: num(req(args, 'rows')) }
      })
    }
  },
  {
    name: 'terminal_kill',
    description: 'Terminate a terminal session (the pty exits; scrollback ring is lost).',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId']
    },
    async run(args) {
      return api(`/api/terminals/${encodeURIComponent(reqStr(args, 'sessionId'))}/kill`, {
        method: 'POST'
      })
    }
  },

  // ── panes ──
  {
    name: 'pane_command',
    description:
      'Drive the workspace browser panes via the pane-bridge vocabulary (Devin Tab Bridge compatible). cmd ∈ ping|help|tabs|newtab|nav|activate|close|cdp|eval|dl|ws|spawn|split|focus|bind|write|ratio|layout. Extra args are forwarded verbatim (tabId|pane|url|expr|method|params|dir|command|cwd|title|sid|data|enter|ratio|name|i|active|bind). Requires the Workspace view to be open in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        cmd: {
          type: 'string',
          enum: [
            'ping', 'help', 'tabs', 'newtab', 'nav', 'activate', 'close', 'attach',
            'detach', 'cdp', 'eval', 'dl', 'ws', 'spawn', 'split', 'focus', 'bind',
            'write', 'ratio', 'layout'
          ]
        },
        args: {
          type: 'object',
          description: 'command arguments forwarded verbatim, e.g. {url}, {pane,data,enter}',
          additionalProperties: true
        },
        timeoutMs: { type: 'number', description: 'per-command timeout (max 120000)' }
      },
      required: ['cmd']
    },
    async run(args) {
      const body: Record<string, unknown> = { cmd: reqStr(args, 'cmd') }
      if (isRecord(args.args)) Object.assign(body, args.args)
      if (num(args.timeoutMs)) body.timeoutMs = num(args.timeoutMs)
      return api('/api/pane', { method: 'POST', body })
    }
  },

  // ── orchestration networks ──
  // An orchestrator CLI started inside Terrarium passes its env to this
  // server (TERRARIUM_SID / TERRARIUM_NET / TERRARIUM_WS_CMD), so every
  // call targets that orchestrator's own network with no arguments.
  {
    name: 'orchestrator_info',
    description:
      'The orchestration network this orchestrator belongs to (or the active/named one): orchestrator + every subagent with index, name, CLI, task and status (busy|idle|starting|exited). all=true lists every network tab instead.',
    inputSchema: {
      type: 'object',
      properties: {
        net: { type: 'string', description: 'network id/name; default = own network, else the active tab' },
        all: { type: 'boolean' }
      }
    },
    async run(args) {
      return netCall(bool(args.all) ? 'net.list' : 'net.info', { net: str(args.net) })
    }
  },
  {
    name: 'orchestrator_spawn',
    description:
      'Tether new subagent terminal(s) to the orchestrator. command = CLI to run (claude, codex, powershell…; default = the network default, usually the orchestrator’s own CLI). task = first prompt, typed in once the CLI has booted — make it self-contained. Returns index/name/sid per subagent.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        command: { type: 'string' },
        title: { type: 'string', description: 'subagent name (default: a Latin name)' },
        cwd: { type: 'string' },
        count: { type: 'number', description: 'several identical subagents (max 8)' },
        net: { type: 'string' }
      }
    },
    async run(args) {
      return netCall('net.spawn', {
        task: str(args.task),
        command: str(args.command),
        title: str(args.title),
        cwd: str(args.cwd),
        count: num(args.count),
        net: str(args.net)
      })
    }
  },
  {
    name: 'orchestrator_send',
    description:
      'Type a message into a subagent (agent = index | name | id | "orchestrator") and press Enter (enter=false leaves it unsubmitted). Multi-line text goes in as one paste. Returns at once with sentAt — follow with orchestrator_wait {since: sentAt} + orchestrator_read, or use orchestrator_ask.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: ['string', 'number'] },
        data: { type: 'string' },
        enter: { type: 'boolean' },
        net: { type: 'string' }
      },
      required: ['agent', 'data']
    },
    async run(args) {
      // a just-spawned subagent is waited on until its CLI has booted
      return netCall(
        'net.send',
        { agent: req(args, 'agent'), data: reqStr(args, 'data'), enter: bool(args.enter), net: str(args.net) },
        90_000
      )
    }
  },
  {
    name: 'orchestrator_ask',
    description:
      'Send a message to a subagent, wait until it has been quiet for idleSec (default 4), and return its rendered screen. timeoutSec (default 110, max 115) bounds the wait — done=false means still working: call orchestrator_wait, then orchestrator_read.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: ['string', 'number'] },
        data: { type: 'string' },
        idleSec: { type: 'number' },
        timeoutSec: { type: 'number' },
        lines: { type: 'number', description: 'screen lines to return (default 60)' },
        net: { type: 'string' }
      },
      required: ['agent', 'data']
    },
    async run(args) {
      const t = Math.min(115, num(args.timeoutSec) ?? 110) * 1000
      return netCall(
        'net.ask',
        {
          agent: req(args, 'agent'),
          data: reqStr(args, 'data'),
          idleMs: secMs(args.idleSec),
          lines: num(args.lines),
          net: str(args.net)
        },
        t
      )
    }
  },
  {
    name: 'orchestrator_read',
    description:
      'Rendered screen text of a subagent — what a human would see, TUI redraws resolved — last `lines` lines (default 60), plus its status.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: ['string', 'number'] },
        lines: { type: 'number' },
        net: { type: 'string' }
      },
      required: ['agent']
    },
    async run(args) {
      return netCall('net.read', { agent: req(args, 'agent'), lines: num(args.lines), net: str(args.net) })
    }
  },
  {
    name: 'orchestrator_wait',
    description:
      'Block until a subagent (or agent="all", the default) has produced no output for idleSec (default 4). since = sentAt from orchestrator_send to require fresh activity first. Bounded by timeoutSec (default 110, max 115); done=false means still working.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: ['string', 'number'] },
        idleSec: { type: 'number' },
        since: { type: 'number' },
        timeoutSec: { type: 'number' },
        net: { type: 'string' }
      }
    },
    async run(args) {
      const t = Math.min(115, num(args.timeoutSec) ?? 110) * 1000
      return netCall(
        'net.wait',
        {
          agent: args.agent ?? 'all',
          idleMs: secMs(args.idleSec),
          since: num(args.since),
          net: str(args.net)
        },
        t
      )
    }
  },
  {
    name: 'orchestrator_kill',
    description: 'Cut a subagent’s tether — its terminal process ends and the card leaves the web.',
    inputSchema: {
      type: 'object',
      properties: { agent: { type: ['string', 'number'] }, net: { type: 'string' } },
      required: ['agent']
    },
    async run(args) {
      return netCall('net.kill', { agent: req(args, 'agent'), net: str(args.net) })
    }
  },
  {
    name: 'orchestrator_topic',
    description:
      'Label what this network is for with a short 2–4 word topic (e.g. "Senior loop") — the tab then reads "Web 1: Senior loop". Empty string clears it.',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string' }, net: { type: 'string' } },
      required: ['topic']
    },
    async run(args) {
      return netCall('net.topic', { topic: typeof args.topic === 'string' ? args.topic : '', net: str(args.net) })
    }
  },

  // ── self maintenance ──
  {
    name: 'check_update',
    description:
      'Check the configured update manifest for a newer terrarium-mcp release. Reports current vs latest and the download URL. Needs updateUrl (config file, TERRARIUM_MCP_UPDATE_URL, or --update-url).',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return checkUpdate()
    }
  },
  {
    name: 'self_update',
    description:
      'Download the latest release from the update manifest and stage the swap: the new exe replaces this one on next start. The MCP client should restart the server after this succeeds. Call only when the user asks to update; run check_update first to confirm a newer version exists. Fails when no updateUrl is configured.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return selfUpdate()
    }
  }
]

function parseDue(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (Number.isFinite(t)) return t
    throw new Error(`unparseable date: ${v}`)
  }
  throw new Error('dueAt must be a number (ms epoch), ISO string, or null')
}

// ── update machinery ──────────────────────────────────────────────────────

interface UpdateManifest {
  version: string
  notes?: string
  files?: Record<string, { url: string; sha256?: string }>
  url?: string
  sha256?: string
}

function platformKey(): string {
  const p = platform()
  const arch = process.arch === 'x64' ? 'x64' : process.arch
  return p === 'win32' ? `windows-${arch}` : `${p}-${arch}`
}

async function fetchManifest(): Promise<UpdateManifest> {
  if (!cfg.updateUrl) {
    throw new Error(
      'no update manifest configured — set TERRARIUM_MCP_UPDATE_URL, ' +
        '--update-url, or updateUrl in terrarium-mcp.json'
    )
  }
  const res = await fetch(cfg.updateUrl, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`)
  const m: unknown = await res.json()
  if (!isRecord(m) || typeof m.version !== 'string') throw new Error('bad manifest shape')
  return m as UpdateManifest
}

async function checkUpdate(): Promise<unknown> {
  const m = await fetchManifest()
  const key = platformKey()
  const file = m.files?.[key] ?? (m.url ? { url: m.url, sha256: m.sha256 } : null)
  return {
    current: VERSION,
    latest: m.version,
    updateAvailable: cmpVersion(m.version, VERSION) > 0,
    notes: m.notes ?? null,
    asset: file,
    manifest: cfg.updateUrl
  }
}

async function selfUpdate(): Promise<unknown> {
  const m = await fetchManifest()
  if (cmpVersion(m.version, VERSION) <= 0) {
    return { ok: true, alreadyLatest: true, version: VERSION }
  }
  const key = platformKey()
  const file = m.files?.[key] ?? (m.url ? { url: m.url, sha256: m.sha256 } : null)
  if (!file?.url) throw new Error(`manifest has no asset for ${key}`)

  const exe = process.execPath
  if (!/\.exe$/i.test(exe) || basename(exe).startsWith('bun')) {
    // running under a dev runtime (node/bun), not a packaged exe
    throw new Error(`self-update only applies to the packaged exe (running: ${exe})`)
  }

  const res = await fetch(file.url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())

  if (file.sha256) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new Error(`sha256 mismatch — expected ${file.sha256}, got ${got}`)
    }
  }

  const tmp = `${exe}.new.exe`
  writeFileSync(tmp, buf)

  // Windows can't overwrite a running exe — stage a swap script that waits
  // for this process to exit, moves the new binary in, then self-deletes.
  const bat = join(dirname(exe), `update-${basename(exe, '.exe')}.bat`)
  writeFileSync(
    bat,
    [
      '@echo off',
      'rem terrarium-mcp self-update swap',
      ':wait',
      `move /y "${tmp}" "${exe}" >nul 2>nul`,
      'if errorlevel 1 (',
      '  ping 127.0.0.1 -n 2 >nul',
      '  goto wait',
      ')',
      'start "" /b cmd /c "ping 127.0.0.1 -n 2 >nul & del "%~f0""'
    ].join('\r\n')
  )
  spawn('cmd.exe', ['/c', 'start', '', '/min', bat], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref()

  return {
    ok: true,
    staged: true,
    from: VERSION,
    to: m.version,
    note: 'Update staged — the swap runs the moment this process exits. Restart the MCP server (or the client) to run the new version.'
  }
}

// ── resources ─────────────────────────────────────────────────────────────

interface Resource {
  uri: string
  name: string
  description: string
  mimeType: string
}

const RESOURCES: Resource[] = [
  { uri: 'terrarium://state', name: 'Office state', description: 'Full engine snapshot — agents, cards, runs, projects, events.', mimeType: 'application/json' },
  { uri: 'terrarium://cards', name: 'Board cards', description: 'All task cards.', mimeType: 'application/json' },
  { uri: 'terrarium://agents', name: 'Crew agents', description: 'All crew agents.', mimeType: 'application/json' },
  { uri: 'terrarium://events', name: 'Activity feed', description: 'Recent office events.', mimeType: 'application/json' },
  { uri: 'terrarium://terminals', name: 'Pty sessions', description: 'Terminal sessions in the pty host.', mimeType: 'application/json' },
  { uri: 'terrarium://wiki', name: 'Wiki index', description: 'Wiki page list for the first project.', mimeType: 'application/json' },
  { uri: 'terrarium://info', name: 'App info', description: 'Remote API /api/info payload.', mimeType: 'application/json' }
]

async function readResource(uri: string): Promise<unknown> {
  switch (uri) {
    case 'terrarium://state':
      return api('/api/state')
    case 'terrarium://cards':
      return api('/api/cards')
    case 'terrarium://agents':
      return api('/api/agents')
    case 'terrarium://events':
      return api('/api/events')
    case 'terrarium://terminals':
      return api('/api/terminals')
    case 'terrarium://wiki':
      return api('/api/wiki')
    case 'terrarium://info':
      return api('/api/info')
    default:
      if (uri.startsWith('terrarium://wiki/')) {
        return api(`/api/wiki/${encodeURIComponent(uri.slice('terrarium://wiki/'.length))}`)
      }
      throw new Error(`unknown resource ${uri}`)
  }
}

// ── JSON-RPC / MCP stdio ──────────────────────────────────────────────────

interface RpcMsg {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
}

function reply(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function replyError(id: number | string, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

function textResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
  }
}

function errorResult(e: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const msg = e instanceof Error ? e.message : String(e)
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
}

async function handle(msg: RpcMsg): Promise<void> {
  if (msg.id === undefined) return // notification — nothing to answer
  const id = msg.id
  try {
    switch (msg.method) {
      case 'initialize': {
        const requested = isRecord(msg.params) ? str(msg.params.protocolVersion) : undefined
        const protocolVersion =
          requested && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
            ? requested
            : PROTOCOL_VERSIONS[0]
        return reply(id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: { name: SERVER_NAME, version: VERSION }
        })
      }
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
          }))
        })
      case 'tools/call': {
        const p = isRecord(msg.params) ? msg.params : {}
        const name = str(p.name)
        const tool = TOOLS.find((t) => t.name === name)
        if (!tool) return replyError(id, -32602, `unknown tool: ${name}`)
        const args = isRecord(p.arguments) ? p.arguments : {}
        try {
          return reply(id, textResult(await tool.run(args)))
        } catch (e) {
          return reply(id, errorResult(e))
        }
      }
      case 'resources/list':
        return reply(id, { resources: RESOURCES })
      case 'resources/read': {
        const p = isRecord(msg.params) ? msg.params : {}
        const uri = str(p.uri)
        if (!uri) return replyError(id, -32602, 'missing uri')
        try {
          const data = await readResource(uri)
          return reply(id, {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(data, null, 2)
              }
            ]
          })
        } catch (e) {
          return replyError(id, -32603, e instanceof Error ? e.message : String(e))
        }
      }
      case 'prompts/list':
        return reply(id, { prompts: [] })
      case 'logging/setLevel':
        return reply(id, {})
      default:
        return replyError(id, -32601, `method not found: ${msg.method}`)
    }
  } catch (e) {
    replyError(id, -32603, e instanceof Error ? e.message : String(e))
  }
}

function serve(): void {
  const rl = createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: RpcMsg
    try {
      msg = JSON.parse(trimmed) as RpcMsg
    } catch {
      return // malformed line — drop
    }
    void handle(msg)
  })
  rl.on('close', () => process.exit(0))
}

// ── CLI modes ─────────────────────────────────────────────────────────────

function printHelp(): void {
  process.stderr.write(
    `${SERVER_NAME} v${VERSION} — MCP server for the Terrarium desktop app.

usage: terrarium-mcp [options]

  (no flags)          run the MCP stdio server — what MCP clients spawn
  --api <url>         remote API base (default: scan 127.0.0.1:8795-8804)
  --token <t>         API token (default: ~/.terrarium/mobile-token)
  --update-url <url>  update manifest URL for check_update/self_update
  --doctor            print resolved config + API connectivity, then exit
  --self-update       download the latest release and stage the swap
  --check-update      report latest version vs current
  --version           print version
  --help              this text

env: TERRARIUM_API · TERRARIUM_TOKEN · TERRARIUM_MCP_UPDATE_URL
file: ./terrarium-mcp.json or ~/.terrarium/mcp.json — {"api","token","updateUrl"}
`
  )
}

async function doctor(): Promise<void> {
  process.stderr.write(`config:\n  api: ${cfg.api ?? `auto-scan 127.0.0.1:${SCAN_PORT_MIN}-${SCAN_PORT_MAX}`}\n  token: ${cfg.tokenSource}\n  updateUrl: ${cfg.updateUrl ?? 'none'}\n`)
  try {
    const base = await discover()
    const info = await api('/api/info')
    process.stderr.write(`api: OK → ${base}\ninfo: ${JSON.stringify(info)}\n`)
  } catch (e) {
    process.stderr.write(`api: FAIL → ${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2))
  if (flags.has('help') || flags.has('h')) return printHelp()
  if (flags.has('version') || flags.has('v')) {
    process.stderr.write(`${VERSION}\n`)
    return
  }
  if (flags.has('doctor')) return doctor()
  if (flags.has('check-update')) {
    const r = await checkUpdate()
    process.stderr.write(JSON.stringify(r, null, 2) + '\n')
    return
  }
  if (flags.has('self-update')) {
    const r = await selfUpdate()
    process.stderr.write(JSON.stringify(r, null, 2) + '\n')
    if (isRecord(r) && r.staged) process.exit(0)
    return
  }
  serve()
}

void main()
