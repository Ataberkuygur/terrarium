import { contextBridge, ipcRenderer, net, webUtils, type IpcRendererEvent } from 'electron'
import { UPDATER_IPC, type UpdateStatus } from '../shared/updater'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { IPC, PANE_IPC } from '../shared/ipc'
import { PTY_IPC, type PtyBridge, type PtyEvent } from '../shared/pty'
import type { PaneCmdEnvelope, PaneCmdResult } from '../shared/pane-bridge'
import type { CliSessionEntry } from '../shared/cli-sessions'
import type { CliBinding } from '../shared/cli-resume'
import { JEV_IPC, type JevKeyStatus, type JevRequest, type JevResult } from '../shared/jev'
import { BROWSER_MCP_IPC, type BrowserMcpStatus } from '../shared/browser-mcp'
import type {
  Agent,
  Engine,
  EngineState,
  CardStatus,
  TaskCard,
  WikiPage,
  WikiPageMeta
} from '../shared/types'

// ── engine bridge ──

const engine: Engine = {
  getState: () => ipcRenderer.invoke(IPC.engineGetState) as Promise<EngineState>,

  subscribe(cb) {
    const handler = (_e: IpcRendererEvent, s: EngineState) => cb(s)
    ipcRenderer.on(IPC.engineState, handler)
    return () => ipcRenderer.removeListener(IPC.engineState, handler)
  },

  createCard: (input) => ipcRenderer.invoke(IPC.cardCreate, input) as Promise<TaskCard>,

  assignCard: (cardId: string, agentId: string) =>
    ipcRenderer.invoke(IPC.cardAssign, cardId, agentId) as Promise<void>,

  moveCard: (cardId: string, status: CardStatus) =>
    ipcRenderer.invoke(IPC.cardMove, cardId, status) as Promise<void>,

  updateCard: (cardId: string, patch) =>
    ipcRenderer.invoke(IPC.cardUpdate, cardId, patch) as Promise<void>,

  deleteCard: (cardId: string) =>
    ipcRenderer.invoke(IPC.cardDelete, cardId) as Promise<void>,

  nudgeAgent: (agentId: string, message: string) =>
    ipcRenderer.invoke(IPC.agentNudge, agentId, message) as Promise<void>,

  touchAgent: (agentId: string) =>
    ipcRenderer.invoke(IPC.agentTouch, agentId) as Promise<void>,

  upsertAgent: (agent: Agent) =>
    ipcRenderer.invoke(IPC.agentUpsert, agent) as Promise<void>,

  removeAgent: (agentId: string) =>
    ipcRenderer.invoke(IPC.agentRemove, agentId) as Promise<void>,

  listWikiPages: (projectId: string) =>
    ipcRenderer.invoke(IPC.wikiList, projectId) as Promise<WikiPageMeta[]>,

  getWikiPage: (projectId: string, pageId: string) =>
    ipcRenderer.invoke(IPC.wikiGet, projectId, pageId) as Promise<WikiPage>,

  searchWiki: (projectId: string, q: string) =>
    ipcRenderer.invoke(IPC.wikiSearch, projectId, q) as Promise<WikiPageMeta[]>,

  saveWikiPage: (projectId: string, pageId: string, body: string) =>
    ipcRenderer.invoke(IPC.wikiSave, projectId, pageId, body) as Promise<void>
}

// ── pty bridge — single EVENT channel fanned out per session/type ──

type PtyEvCb = (ev: PtyEvent) => void
// indexed by session — every event used to walk every listener of every
// pane/tracker (~100 with a big orchestration web) on each output chunk
const ptyListeners = new Map<string, Set<PtyEvCb>>()
let ptyListenerAttached = false

function ensurePtyListener() {
  if (ptyListenerAttached) return
  ptyListenerAttached = true
  ipcRenderer.on(PTY_IPC.EVENT, (_e, ev: PtyEvent) => {
    const subs = ptyListeners.get(ev.sessionId)
    if (!subs) return
    for (const cb of [...subs]) {
      try {
        cb(ev)
      } catch (err) {
        console.error('PTY listener error:', err)
      }
    }
  })
}

function onPtyEvent(
  sessionId: string,
  pred: (ev: PtyEvent) => boolean,
  cb: (ev: PtyEvent) => void
): () => void {
  ensurePtyListener()
  const wrapped: PtyEvCb = (ev) => {
    if (pred(ev)) cb(ev)
  }
  let subs = ptyListeners.get(sessionId)
  if (!subs) ptyListeners.set(sessionId, (subs = new Set()))
  subs.add(wrapped)
  return () => {
    subs.delete(wrapped)
    if (!subs.size && ptyListeners.get(sessionId) === subs) ptyListeners.delete(sessionId)
  }
}

const pty: PtyBridge = {
  spawn: (opts) => ipcRenderer.invoke(PTY_IPC.SPAWN, opts),
  attach: (sessionId) => ipcRenderer.invoke(PTY_IPC.ATTACH, sessionId),
  write: (sessionId, data) => {
    ipcRenderer.send(PTY_IPC.WRITE, sessionId, data)
  },
  resize: (sessionId, cols, rows) => {
    ipcRenderer.send(PTY_IPC.RESIZE, sessionId, cols, rows)
  },
  kill: (sessionId) => ipcRenderer.invoke(PTY_IPC.KILL, sessionId),
  list: () => ipcRenderer.invoke(PTY_IPC.LIST),
  readTail: (sessionId, maxChars) => ipcRenderer.invoke(PTY_IPC.READ, sessionId, maxChars),
  onData: (sessionId, cb) =>
    onPtyEvent(sessionId, (ev) => ev.type === 'data' && !ev.replay, (ev) => {
      if (ev.type === 'data') cb(ev.data)
    }),
  onReplay: (sessionId, cb) =>
    onPtyEvent(sessionId, (ev) => ev.type === 'data' && !!ev.replay, (ev) => {
      if (ev.type === 'data') cb(ev.data)
    }),
  onExit: (sessionId, cb) =>
    onPtyEvent(sessionId, (ev) => ev.type === 'exit', (ev) => {
      if (ev.type === 'exit') cb({ exitCode: ev.exitCode, signal: ev.signal })
    }),
  onStatus: (sessionId, cb) =>
    onPtyEvent(sessionId, (ev) => ev.type === 'status', (ev) => {
      if (ev.type === 'status') cb(ev.status)
    })
}

// ── Jev local path ──
// Preferred route is IPC → main's decideJev. This fallback exists for a
// main process older than the channel (window reloads pick up new
// preload/main-bundle code without restarting Electron's main) — the key
// is resolved inside the privileged preload world and the request goes
// out via electron.net, so it still never enters the page's JS world.

const JEV_MODEL_ID = 'jev-latest'
const JEV_DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const JEV_DEFAULT_TIMEOUT_MS = 3000

let cachedJevEnv: Record<string, string> | null = null

/** Decode ~/.terrarium/.env bytes — PowerShell '>'/Out-File write UTF-16LE. */
function decodeEnv(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

function jevFileEnv(): Record<string, string> {
  if (cachedJevEnv) return cachedJevEnv
  cachedJevEnv = {}
  try {
    const base = join(homedir(), '.terrarium')
    const legacy = join(homedir(), '.atolye')
    // the atolye-era dir answers while the home move is still pending
    const path = join(existsSync(base) || !existsSync(legacy) ? base : legacy, '.env')
    if (!existsSync(path)) return cachedJevEnv
    for (const line of decodeEnv(readFileSync(path)).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !line.trimStart().startsWith('#')) {
        cachedJevEnv[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    /* unreadable — process.env still applies */
  }
  return cachedJevEnv
}

function jevEnv(key: string): string | undefined {
  return process.env[key]?.trim() || jevFileEnv()[key]?.trim() || undefined
}

async function jevDecideLocal(req: JevRequest): Promise<JevResult | null> {
  const flag = jevEnv('JEV_ENABLED')
  if (flag === '0' || flag === 'false') return null
  const apiKey = jevEnv('TYPESAFE_API_KEY')
  if (!apiKey || !req?.questions || typeof req.questions !== 'object') return null
  const endpoint = jevEnv('TYPESAFE_ENDPOINT') ?? JEV_DEFAULT_ENDPOINT
  const timeoutMs = Number(jevEnv('JEV_TIMEOUT_MS'))
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : JEV_DEFAULT_TIMEOUT_MS
  )
  try {
    const post = net?.fetch ?? fetch
    const res = await post(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: req.state, model: JEV_MODEL_ID, questions: req.questions }),
      signal: controller.signal
    })
    if (!res.ok) return null
    const body = (await res.json()) as { answers?: JevResult['answers']; usage?: JevResult['usage'] }
    if (!body?.answers || typeof body.answers !== 'object') return null
    return { answers: body.answers, usage: body.usage ?? { input_tokens: 0, output_tokens: 0 } }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Jev key (Settings) — main owns it; the local path only covers an older
//    main process that doesn't have the handlers yet ──

function jevKeyStatusLocal(): JevKeyStatus {
  const fromEnv = process.env.TYPESAFE_API_KEY?.trim()
  const key = jevEnv('TYPESAFE_API_KEY')
  const flag = jevEnv('JEV_ENABLED')
  return {
    configured: !!key,
    source: fromEnv ? 'env' : key ? 'file' : null,
    masked: key ? `••••${key.slice(-4)}` : null,
    enabled: !key || !(flag === '0' || flag === 'false')
  }
}

function jevKeySetLocal(raw: string): JevKeyStatus {
  const key = String(raw ?? '').trim().replace(/[\r\n"']/g, '')
  const path = join(homedir(), '.terrarium', '.env')
  let lines: string[] = []
  try {
    if (existsSync(path)) lines = decodeEnv(readFileSync(path)).split(/\r?\n/)
  } catch {
    lines = []
  }
  lines = lines.filter((l) => !/^\s*TYPESAFE_API_KEY\s*=/.test(l))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (key) lines.push(`TYPESAFE_API_KEY=${key}`)
  writeFileSync(path, lines.length ? lines.join('\n') + '\n' : '', 'utf8')
  cachedJevEnv = null
  return jevKeyStatusLocal()
}

const jevKey = {
  status: async (): Promise<JevKeyStatus> => {
    try {
      return (await ipcRenderer.invoke(JEV_IPC.KEY_STATUS)) as JevKeyStatus
    } catch {
      return jevKeyStatusLocal()
    }
  },
  set: async (key: string): Promise<JevKeyStatus> => {
    cachedJevEnv = null
    try {
      return (await ipcRenderer.invoke(JEV_IPC.KEY_SET, key)) as JevKeyStatus
    } catch {
      return jevKeySetLocal(key)
    }
  },
  test: async (): Promise<{ ok: boolean; status?: number; error?: string; restart?: boolean }> => {
    try {
      return (await ipcRenderer.invoke(JEV_IPC.KEY_TEST)) as { ok: boolean; status?: number }
    } catch {
      return { ok: false, restart: true }
    }
  }
}

async function jevDecide(req: JevRequest): Promise<JevResult | null> {
  try {
    // resolves (possibly null) when main registered the channel —
    // rejects 'no handler' while an older main process is still running
    return (await ipcRenderer.invoke(JEV_IPC.DECIDE, req)) as JevResult | null
  } catch {
    return jevDecideLocal(req)
  }
}

// ── misc host API ──

const api = {
  platform: process.platform,
  engine,
  pty,
  detectClis: () => ipcRenderer.invoke('agents:detect'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder') as Promise<string | null>,
  setProjectRoot: (projectId: string, rootPath: string) =>
    ipcRenderer.invoke(IPC.projectSetRoot, projectId, rootPath) as Promise<void>,
  /** Past sessions of a resumable CLI (claude/codex/opencode/…) for the pane's cwd. */
  cliSessions: (cli: string, cwd: string) =>
    ipcRenderer.invoke('cli:sessions', cli, cwd) as Promise<CliSessionEntry[]>,
  /** Agent CLI (canonical id) running under each shell pid — null = none. */
  cliProcesses: (pids: number[]) =>
    ipcRenderer.invoke('cli:processes', pids) as Promise<Record<number, string | null>>,
  /** Per pty root pid: the resumable CLI session running there (shared/cli-resume). */
  cliBindings: (entries: { pid: number; since: number }[]) =>
    ipcRenderer.invoke('cli:bindings', entries) as Promise<Record<number, CliBinding | null>>,
  /** Session a now-dead CLI process was in. */
  resolveCliSession: (cli: string, pid: number, since: number) =>
    ipcRenderer.invoke('cli:resolve-session', cli, pid, since) as Promise<{
      id: string
      cwd: string | null
    } | null>,
  /** Settings: Devin's playwright + chrome-devtools MCP servers on/off. */
  browserMcp: {
    status: () => ipcRenderer.invoke(BROWSER_MCP_IPC.status) as Promise<BrowserMcpStatus>,
    set: (on: boolean) => ipcRenderer.invoke(BROWSER_MCP_IPC.set, on) as Promise<BrowserMcpStatus>
  },
  /** 2–4 word topic from an orchestrator's claude transcript (null = none yet). */
  suggestNetTopic: (sessionId: string, agentTitles: string[]) =>
    ipcRenderer.invoke('net:suggest-topic', sessionId, agentTitles) as Promise<string | null>,
  /** LAN URL + QR data-url for phone pairing (null when the server is off). */
  mobileInfo: () =>
    ipcRenderer.invoke('mobile:info') as Promise<{
      url: string
      host: string
      port: number
      ip: string
      qr: string
    } | null>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  /** Jev (TypeSafe AI) typed decisions — null when unconfigured/failed. */
  jevDecide,
  /** Settings: Jev API key — status (masked), save/remove, connection test. */
  jevKey,
  onWikiChanged(cb: (e: { projectId: string }) => void) {
    const handler = (_e: IpcRendererEvent, payload: { projectId: string }) => cb(payload)
    ipcRenderer.on(IPC.wikiChanged, handler)
    return () => ipcRenderer.removeListener(IPC.wikiChanged, handler)
  },
  /** main → renderer: a new image hit the system clipboard (peek panel). */
  onClipboardImage(
    cb: (e: { dataUrl: string; path: string; width: number; height: number; at: number }) => void
  ) {
    const handler = (
      _e: IpcRendererEvent,
      payload: { dataUrl: string; path: string; width: number; height: number; at: number }
    ) => cb(payload)
    ipcRenderer.on('clipboard:image', handler)
    return () => ipcRenderer.removeListener('clipboard:image', handler)
  },
  /** Clipboard panel: saved images + text history (main/clip-history.ts). */
  clipHistory: {
    list: () =>
      ipcRenderer.invoke('clip:list') as Promise<{
        images: { path: string; at: number }[]
        texts: { id: string; text: string; at: number }[]
      }>,
    thumb: (path: string) =>
      ipcRenderer.invoke('clip:thumb', path) as Promise<{ dataUrl: string; width: number; height: number } | null>,
    remove: (kind: 'image' | 'text', id: string) =>
      ipcRenderer.invoke('clip:remove', { kind, id }) as Promise<boolean>,
    copy: (kind: 'image' | 'text', id: string) =>
      ipcRenderer.invoke('clip:copy', { kind, id }) as Promise<boolean>,
    onText(cb: () => void) {
      const handler = () => cb()
      ipcRenderer.on('clipboard:text', handler)
      return () => ipcRenderer.removeListener('clipboard:text', handler)
    }
  },
  /** Reveal a file in the OS file manager. */
  showItem: (path: string) => ipcRenderer.invoke('shell:showItem', path),
  /** Absolute path of a File from a drop (Explorer / native drag) — '' when it has none. */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  /** Downloads panel: newest files in the OS Downloads folder (main/downloads.ts). */
  downloads: {
    list: () =>
      ipcRenderer.invoke('dl:list') as Promise<{
        dir: string
        files: { path: string; name: string; size: number; at: number }[]
      }>,
    thumb: (path: string) =>
      ipcRenderer.invoke('dl:thumb', path) as Promise<{
        dataUrl: string
        width: number
        height: number
        icon: boolean
      } | null>,
    open: (path: string) => ipcRenderer.invoke('dl:open', path) as Promise<boolean>,
    reveal: (path: string) => ipcRenderer.invoke('dl:reveal', path) as Promise<boolean>,
    /** Start a native OS file drag — call from the item's dragstart. */
    startDrag: (path: string) => ipcRenderer.send('dl:drag', path),
    onChange(cb: () => void) {
      const handler = () => cb()
      ipcRenderer.on('downloads:changed', handler)
      return () => ipcRenderer.removeListener('downloads:changed', handler)
    }
  },

  /** Whole-UI zoom owned by main — get/set the factor, hear changes (Ctrl+= / Ctrl+- / Ctrl+0). */
  appZoom: {
    get: () => ipcRenderer.invoke('terrarium:zoom:get') as Promise<number>,
    set: (factor: number) => ipcRenderer.invoke('terrarium:zoom:set', factor) as Promise<number>,
    onChange(cb: (factor: number) => void) {
      const handler = (_e: IpcRendererEvent, f: number) => cb(f)
      ipcRenderer.on('terrarium:zoom:changed', handler)
      return () => ipcRenderer.removeListener('terrarium:zoom:changed', handler)
    }
  },
  /** Orchestration host info — tnet bin dir + PATH to prepend (null when not installed). */
  orchInfo: () =>
    ipcRenderer.invoke('terrarium:orch:info') as Promise<{
      binDir: string
      pathKey: string
      pathValue: string
      delimiter: string
      guide: string
    } | null>,

  // ── pane bridge — /cmd commands forwarded from main's HTTP server ──
  /** Bound port of the pane-bridge server (null when not running). */
  paneBridgePort: () => ipcRenderer.invoke(PANE_IPC.port) as Promise<number | null>,
  /** main → renderer: a pane command to execute against a browser webview. */
  onPaneCmd(cb: (msg: PaneCmdEnvelope) => void) {
    const handler = (_e: IpcRendererEvent, msg: PaneCmdEnvelope) => cb(msg)
    ipcRenderer.on(PANE_IPC.cmd, handler)
    return () => ipcRenderer.removeListener(PANE_IPC.cmd, handler)
  },
  /** renderer → main: resolve a forwarded command (drives its HTTP response). */
  paneCmdResult: (id: number, result: PaneCmdResult) => {
    ipcRenderer.send(PANE_IPC.result, id, result)
  }
}

const updater = {
  get: () => ipcRenderer.invoke(UPDATER_IPC.GET) as Promise<UpdateStatus>,
  check: () => ipcRenderer.invoke(UPDATER_IPC.CHECK) as Promise<UpdateStatus>,
  install: () => ipcRenderer.invoke(UPDATER_IPC.INSTALL) as Promise<UpdateStatus>,
  onStatus(cb: (s: UpdateStatus) => void) {
    const handler = (_e: IpcRendererEvent, s: UpdateStatus) => cb(s)
    ipcRenderer.on(UPDATER_IPC.STATUS, handler)
    return () => ipcRenderer.removeListener(UPDATER_IPC.STATUS, handler)
  }
}

contextBridge.exposeInMainWorld('terrarium', { ...api, updater })

export type TerrariumApi = typeof api
