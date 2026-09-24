// ── CLI session history — main-process scanner ───────────────────────
// Reads agent-CLI session stores from the user's home dir so the pane
// dropdown can offer "jump back into session X":
//   claude → ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl
//   codex  → ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl
//   muse   → <wsl distro>:~/.local/share/muse/session-index.db (sqlite)
//   opencode → ~/.local/share/opencode/opencode.db (sqlite `session` table)
//   qoder  → ~/.qoder/projects/<cwd-slug>/<sessionId>.jsonl (claude layout,
//            but the dir lives in a "workspace-directories" line instead of "cwd")
// Everything is best-effort: missing dirs, foreign layouts and partial
// lines all degrade to an empty list rather than an IPC error.

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, promises as fs } from 'fs'
import { execFile } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import type { CliSessionEntry } from '../shared/cli-sessions'

/** Sessions listed per CLI — effectively "all of them"; the rail renders
 *  them incrementally and summaries are cached by file+mtime. */
const MAX_SESSIONS = 2000
/** Bytes sampled from the top of a transcript — enough for cwd/summary lines. */
const HEAD_BYTES = 48 * 1024
/** Rollout files probed per codex scan, newest-first — bounds the fs walk. */
const CODEX_PROBE_LIMIT = 4000
/** Parallel transcript head reads — keeps a long history off the fd limit. */
const READ_CONCURRENCY = 24

/** Order-preserving map with at most `limit` promises in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** file → summary at a given mtime: re-listing only re-reads transcripts that moved. */
const summaryCache = new Map<string, { mtime: number; summary: string | null }>()

async function cachedSummary(file: string, mtime: number): Promise<string | null> {
  const hit = summaryCache.get(file)
  if (hit && hit.mtime === mtime) return hit.summary
  const summary = headSummary(await readHead(file).catch(() => ''))
  summaryCache.set(file, { mtime, summary })
  return summary
}

async function readHead(path: string): Promise<string> {
  const fh = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    return buf.toString('utf8', 0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** First `"cwd":"…"` in a sampled jsonl head — authoritative dir↔project match.
 *  qoder transcripts carry no "cwd"; their head opens with
 *  `{"type":"workspace-directories","directories":["<dir>", …]}` instead. */
function headCwd(head: string): string | null {
  const m =
    /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head) ??
    /"directories"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"/.exec(head)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return m[1]
  }
}

/** First user-authored text in a transcript head — claude summary/user, codex input_text. */
function headSummary(head: string): string | null {
  let firstUser: string | null = null
  for (const line of head.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const j = JSON.parse(t)
      if (j.type === 'summary' && typeof j.summary === 'string' && j.summary.trim()) {
        return j.summary.trim()
      }
      if (j.type === 'custom-title' && typeof j.customTitle === 'string' && j.customTitle.trim()) {
        return j.customTitle.trim()
      }
      if (firstUser !== null) continue
      // claude: {type:'user', message:{content: string | [{type:'text',text}]}}
      if (j.type === 'user') {
        const c = j.message?.content
        const text =
          typeof c === 'string'
            ? c
            : Array.isArray(c)
              ? c.find((x: { type?: string; text?: string }) => x?.type === 'text')?.text
              : null
        if (typeof text === 'string' && text.trim() && !text.startsWith('<')) {
          firstUser = text
        }
      }
      // codex: {type:'response_item', payload:{role:'user', content:[{type:'input_text',text}]}}
      if (j.type === 'response_item' && j.payload?.role === 'user') {
        const text = Array.isArray(j.payload.content)
          ? j.payload.content.find(
              (x: { type?: string; text?: string }) =>
                x?.type === 'input_text' || x?.type === 'text'
            )?.text
          : null
        if (typeof text === 'string' && text.trim() && !text.startsWith('<')) {
          firstUser = text
        }
      }
    } catch {
      /* partial JSON at the head boundary — skip */
    }
  }
  return firstUser ? firstUser.replace(/\s+/g, ' ').trim().slice(0, 90) : null
}

// ── claude / qoder ───────────────────────────────────────────────────
// Every project dir contributes its transcripts — sessions are listed
// across cwds and each entry carries its own, so the pane can resume in
// the dir the transcript actually belongs to (the slug isn't documented,
// so the newest transcript's own "cwd"/"directories" field resolves the
// dir once). qoder keeps the identical layout under ~/.qoder/projects.
async function jsonlProjectSessions(root: string): Promise<CliSessionEntry[]> {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const found: { id: string; at: number; file: string; cwd: string | null }[] = []

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = join(root, d.name)
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'))
    if (!files.length) continue

    const stats = (
      await Promise.all(
        files.map(async (f) => {
          const st = await fs.stat(join(dir, f)).catch(() => null)
          return st ? { name: f, mtime: st.mtimeMs } : null
        })
      )
    ).filter((s): s is { name: string; mtime: number } => !!s)
    if (!stats.length) continue
    stats.sort((a, b) => b.mtime - a.mtime)

    const head = await readHead(join(dir, stats[0].name)).catch(() => '')
    const cwd = headCwd(head)
    for (const s of stats) {
      found.push({
        id: s.name.slice(0, -'.jsonl'.length),
        at: s.mtime,
        file: join(dir, s.name),
        cwd
      })
    }
  }

  found.sort((a, b) => b.at - a.at)
  const top = found.slice(0, MAX_SESSIONS)
  return mapLimit(top, READ_CONCURRENCY, async ({ id, at, file, cwd }) => ({
    id,
    at,
    cwd,
    summary: await cachedSummary(file, at)
  }))
}

function claudeSessions(): Promise<CliSessionEntry[]> {
  return jsonlProjectSessions(join(homedir(), '.claude', 'projects'))
}

function qoderSessions(): Promise<CliSessionEntry[]> {
  return jsonlProjectSessions(join(homedir(), '.qoder', 'projects'))
}

// ── codex ────────────────────────────────────────────────────────────
// sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl — filenames sort by time,
// so newest-first probing stays bounded even with a long history.
async function codexSessions(): Promise<CliSessionEntry[]> {
  const root = join(homedir(), '.codex', 'sessions')
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || files.length >= CODEX_PROBE_LIMIT) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    // name-desc puts newer year/month/day branches first
    entries.sort((a, b) => b.name.localeCompare(a.name))
    for (const e of entries) {
      if (files.length >= CODEX_PROBE_LIMIT) return
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p, depth + 1)
      else if (e.name.endsWith('.jsonl')) files.push(p)
    }
  }
  await walk(root, 0)
  // rollout filenames embed the timestamp — name order ≈ recency
  files.sort((a, b) => b.localeCompare(a))

  const entries = await mapLimit(files.slice(0, MAX_SESSIONS), READ_CONCURRENCY, codexEntry)
  const out = entries.filter((e): e is CliSessionEntry => !!e)
  out.sort((a, b) => b.at - a.at)
  return out.slice(0, MAX_SESSIONS)
}

/** file → parsed entry at a given mtime (rollouts only grow on resume). */
const codexCache = new Map<string, { mtime: number; entry: CliSessionEntry | null }>()

async function codexEntry(file: string): Promise<CliSessionEntry | null> {
  const st = await fs.stat(file).catch(() => null)
  if (!st) return null
  const hit = codexCache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit.entry
  let entry: CliSessionEntry | null = null
  const head = await readHead(file).catch(() => '')
  try {
    const first = head ? JSON.parse(head.split('\n', 1)[0]) : null
    const meta: { id?: string; timestamp?: string; cwd?: string } | null =
      first?.type === 'session_meta' ? (first.payload ?? null) : null
    if (meta) {
      entry = {
        id: meta.id ?? file.split(/[\\/]/).pop()!.replace(/\.jsonl$/, ''),
        // last activity: a resumed rollout keeps its start timestamp but its
        // mtime moves — that's what lets a pane find the session it resumed
        at: st.mtimeMs,
        summary: headSummary(head),
        cwd: meta.cwd ?? null
      }
    }
  } catch {
    /* partial first line — not a rollout we can read */
  }
  codexCache.set(file, { mtime: st.mtimeMs, entry })
  return entry
}

// ── devin ────────────────────────────────────────────────────────────
// Primary: read the CLI's sessions.db directly — every session across
// cwds, instantly. `devin list --format json` stays as fallback (it's
// cwd-filtered and a cold subprocess, so it's second choice).
interface DevinListRow {
  id: string
  title?: string
  last_activity_at?: number // unix seconds
}

export function devinDbPath(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(
            process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
            'devin',
            'cli',
            'sessions.db'
          )
        ]
      : [
          join(homedir(), '.config', 'devin', 'cli', 'sessions.db'),
          join(homedir(), 'Library', 'Application Support', 'devin', 'cli', 'sessions.db')
        ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

function devinDbSessions(): CliSessionEntry[] | null {
  const path = devinDbPath()
  if (!path) return null
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT id, working_directory AS cwd, last_activity_at AS at, title
           FROM sessions WHERE COALESCE(hidden, 0) = 0
           ORDER BY last_activity_at DESC LIMIT ?`
        )
        .all(MAX_SESSIONS) as { id: string; cwd: string | null; at: number | null; title: string | null }[]
      return rows.map((r) => ({
        id: r.id,
        at: (r.at ?? 0) * 1000,
        summary: r.title?.trim() || null,
        cwd: r.cwd ?? null
      }))
    } finally {
      db.close()
    }
  } catch {
    return null // locked / schema moved — subprocess fallback covers it
  }
}

function devinListFallback(cwd: string): Promise<CliSessionEntry[]> {
  return new Promise((resolve) => {
    execFile(
      'devin',
      ['list', '--format', 'json'],
      { cwd, timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => {
        try {
          const rows = JSON.parse(stdout) as DevinListRow[]
          resolve(
            rows
              .filter((r) => r?.id)
              .slice(0, MAX_SESSIONS)
              .map((r) => ({
                id: r.id,
                at: (r.last_activity_at ?? 0) * 1000,
                summary: r.title?.trim() || null,
                cwd // `devin list` is cwd-scoped — the dir is implied
              }))
          )
        } catch {
          resolve([]) // devin missing / timed out / non-JSON output
        }
      }
    )
  })
}

function devinSessions(cwd: string): Promise<CliSessionEntry[]> {
  const rows = devinDbSessions()
  return rows ? Promise.resolve(rows) : devinListFallback(cwd)
}

// ── cursor-agent ─────────────────────────────────────────────────────
// ~/.cursor/chats/<md5>/<chatId>/meta.json {cwd, updatedAtMs, ...} —
// the hash dir name is opaque, so every chat's own `cwd` field decides.
// The session's store.db holds JSON message blobs; first {role:'user'}
// blob's text doubles as the session title.
function cursorTitle(storePath: string): string | null {
  try {
    const db = new DatabaseSync(storePath, { readOnly: true })
    try {
      const rows = db.prepare('SELECT data FROM blobs LIMIT 80').all() as {
        data: Uint8Array
      }[]
      for (const { data } of rows) {
        try {
          const msg = JSON.parse(Buffer.from(data).toString('utf8'))
          if (msg?.role !== 'user') continue
          const c = msg.content
          const text =
            typeof c === 'string'
              ? c
              : Array.isArray(c)
                ? c.find((x: { type?: string; text?: string }) => x?.text)?.text
                : null
          if (typeof text === 'string' && text.trim() && !text.startsWith('<')) {
            return text.replace(/\s+/g, ' ').trim().slice(0, 90)
          }
        } catch {
          /* binary/encrypted blob — skip */
        }
      }
    } finally {
      db.close()
    }
  } catch {
    /* store.db missing/locked/foreign schema → no title */
  }
  return null
}

async function cursorSessions(): Promise<CliSessionEntry[]> {
  const root = join(homedir(), '.cursor', 'chats')
  const out: CliSessionEntry[] = []
  for (const proj of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!proj.isDirectory()) continue
    const projDir = join(root, proj.name)
    for (const chat of await fs.readdir(projDir, { withFileTypes: true }).catch(() => [])) {
      if (!chat.isDirectory()) continue
      const dir = join(projDir, chat.name)
      let meta: { cwd?: string; updatedAtMs?: number; hasConversation?: boolean }
      try {
        meta = JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf8'))
      } catch {
        continue
      }
      if (meta.hasConversation === false) continue
      out.push({
        id: chat.name,
        at: meta.updatedAtMs ?? 0,
        summary: cursorTitle(join(dir, 'store.db')),
        cwd: meta.cwd ?? null
      })
      if (out.length >= MAX_SESSIONS * 2) break // enough raw hits; sort trims
    }
  }
  out.sort((a, b) => b.at - a.at)
  return out.slice(0, MAX_SESSIONS)
}

// ── muse ─────────────────────────────────────────────────────────────
// Muse Code runs inside WSL (muse.cmd shims `wsl.exe -d <distro>`); its
// session index is a sqlite db under each WSL user's home:
//   ~/.local/share/muse/session-index.db → table `sessions`
// SQLite can't take a lock over the \\wsl.localhost 9P share, so each
// installed distro is probed with a python3 one-liner — same subprocess
// pattern as the devin fallback. Missing WSL/python/db all degrade to [].
interface MuseRow {
  id?: string
  name?: string | null
  title?: string | null
  prompt?: string | null
  cwd?: string | null
  at?: number | null
}

const MUSE_PROBE = [
  'import glob, json, sqlite3',
  'out = []',
  "for p in glob.glob('/root/.local/share/muse/session-index.db') + glob.glob('/home/*/.local/share/muse/session-index.db'):",
  '    try:',
  "        db = sqlite3.connect('file:' + p + '?mode=ro', uri=True)",
  '        cols = (\'session_id\',\'session_name\',\'title\',\'first_user_prompt\',\'workspace_root\',\'updated_at_us\')',
  "        sel = 'SELECT ' + ','.join(cols) + \" FROM sessions WHERE status='valid' ORDER BY updated_at_us DESC LIMIT 2000\"",
  '        out += [dict(zip((\'id\',\'name\',\'title\',\'prompt\',\'cwd\',\'at\'), r)) for r in db.execute(sel)]',
  '        db.close()',
  '    except Exception:',
  '        pass',
  'print(json.dumps(out))'
].join('\n')

/** `wsl.exe -l -q` — installed distro names. Output is UTF-16LE with embedded nulls. */
function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-l', '-q'],
      { timeout: 8_000, windowsHide: true, encoding: 'buffer' },
      (_err, stdout) => {
        const text = Buffer.from(stdout as unknown as Buffer).toString('utf16le')
        resolve(
          text
            .split(/\r?\n/)
            .map((l) => l.replace(/[^\x20-\x7E]/g, '').trim())
            .filter((l) => l.length > 0 && !/^windows subsystem/i.test(l))
        )
      }
    )
  })
}

function museDistroSessions(distro: string): Promise<MuseRow[]> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-d', distro, '--', 'python3', '-c', MUSE_PROBE],
      { timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (_err, stdout) => {
        try {
          const rows = JSON.parse(stdout)
          resolve(Array.isArray(rows) ? (rows as MuseRow[]) : [])
        } catch {
          resolve([]) // no python3 / no db / non-JSON output
        }
      }
    )
  })
}

/** `/mnt/c/Ataberk/x` → `C:\Ataberk\x`; pure-linux roots have no Windows cwd. */
function museCwd(root: string | null | undefined): string | null {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(root ?? '')
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : null
}

function museSummary(
  name: string | null | undefined,
  title: string | null | undefined,
  prompt: string | null | undefined
): string | null {
  const pick = [name, title !== 'New session' ? title : null, prompt].find(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  )
  return pick ? pick.replace(/\s+/g, ' ').trim().slice(0, 90) : null
}

async function museSessions(): Promise<CliSessionEntry[]> {
  if (process.platform !== 'win32') return []
  const distros = await wslDistros()
  if (!distros.length) return []
  const rows = (await Promise.all(distros.map(museDistroSessions)))
    .flat()
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const seen = new Set<string>()
  const out: CliSessionEntry[] = []
  for (const r of rows) {
    if (!r?.id || seen.has(r.id)) continue
    seen.add(r.id)
    out.push({
      id: r.id,
      at: Math.floor((r.at ?? 0) / 1000), // µs → ms
      summary: museSummary(r.name, r.title, r.prompt),
      cwd: museCwd(r.cwd)
    })
    if (out.length >= MAX_SESSIONS) break
  }
  return out
}

// ── opencode ─────────────────────────────────────────────────────────
// ~/.local/share/opencode/opencode.db — the sqlite `session` table carries
// id/title/directory/time_updated (XDG data path even on Windows installs).
// Same readOnly DatabaseSync pattern as devin's sessions.db.
function opencodeDbPath(): string | null {
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  const candidates = [
    join(xdg, 'opencode', 'opencode.db'),
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'opencode', 'opencode.db')
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

function opencodeSessions(): CliSessionEntry[] {
  const path = opencodeDbPath()
  if (!path) return []
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT id, title, directory AS cwd, time_updated AS at
           FROM session WHERE time_archived IS NULL
           ORDER BY time_updated DESC LIMIT ?`
        )
        .all(MAX_SESSIONS) as {
        id: string
        title: string | null
        cwd: string | null
        at: number | null
      }[]
      return rows.map((r) => ({
        id: r.id,
        at: r.at ?? 0,
        summary: r.title?.trim() || null,
        cwd: r.cwd ?? null
      }))
    } finally {
      db.close()
    }
  } catch {
    return [] // locked / schema moved → no history to show
  }
}

/** invoke handler for 'terrarium:cli-sessions' — unknown CLIs simply have no store.
 *  `cwd` is only used by the devin subprocess fallback; every scanner lists
 *  sessions across directories and tags each with its own cwd. */
export async function listCliSessions(cli: string, cwd: string): Promise<CliSessionEntry[]> {
  try {
    if (cli === 'claude') return await claudeSessions()
    if (cli === 'codex') return await codexSessions()
    if (cli === 'devin') return await devinSessions(cwd)
    if (cli === 'cursor-agent') return await cursorSessions()
    if (cli === 'muse') return await museSessions()
    if (cli === 'opencode') return opencodeSessions()
    if (cli === 'qoder' || cli === 'qodercli') return await qoderSessions()
  } catch {
    /* unreadable store → empty list, not an IPC failure */
  }
  return []
}
