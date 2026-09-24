// ── pty-host — runs under utilityProcess.fork (Node context) ─────────
// VS Code-style pty host: owns node-pty sessions, batches output, keeps a
// per-session ring buffer for replay-on-attach. Talks to the main process
// over process.parentPort using PtyHostRequest/PtyHostResponse.
//
// Built to out/main/pty/pty-host.js (see electron.vite.config rollup input).
// node-pty must stay external — it's a native N-API module loaded from
// node_modules at runtime.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'
import {
  PTY_ATTACH_RESET_SEQ,
  PTY_DEFAULT_COLS,
  PTY_DEFAULT_ROWS,
  type PtySessionInfo,
  type PtySessionStatus,
  type PtySpawnOpts
} from '../../shared/pty'
import type { PtyHostRequest, PtyHostResponse } from './protocol'

// node-pty is a native N-API module — it must be loaded from node_modules,
// never bundled. createRequire bypasses the bundler regardless of whether
// the main build externalizes dependencies, resolving node_modules by
// walking up from this file (dev) or the app resources path (packaged).
const req = createRequire(__filename)
const { spawn: ptySpawn } = req('node-pty') as typeof import('node-pty')

// ── tunables ─────────────────────────────────────────────────────────

/** Flush pending output when it reaches this size (chars). */
const FLUSH_CHUNK = 16 * 1024
/** Max time output may sit in the pending buffer before a flush. */
const FLUSH_DELAY_MS = 8
/** Scrollback replay cap per session (chars — approx bytes for ASCII-heavy output). */
const RING_CAP = 256 * 1024

// ── session state ────────────────────────────────────────────────────

interface PtySession {
  opts: Required<PtySpawnOpts>
  pty: IPty | null
  pid: number | null
  resolvedCommand: string | null
  status: PtySessionStatus
  startedAt: number
  exitCode: number | null
  /** Output already forwarded to main — the replayable history. */
  ring: string[]
  ringLen: number
  /** Output received but not yet flushed. */
  pending: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, PtySession>()

// ── transport ────────────────────────────────────────────────────────
// Two modes, same message contract:
//  • utilityProcess — parentPort (default; dies with the Electron app)
//  • detached supervisor — TERRARIUM_PTY_HOST_PORT set → newline-delimited
//    JSON over a loopback TCP server. Ptys then OUTLIVE the app: on
//    relaunch the manager reconnects, list() resyncs and the renderer's
//    attach/replay path restores every terminal with its scrollback.
interface Conn {
  send(msg: PtyHostResponse): void
  onMessage(cb: (msg: PtyHostRequest) => void): void
}

const sockPort = Number(
  process.env.TERRARIUM_PTY_HOST_PORT ?? process.env.ATOLYE_PTY_HOST_PORT ?? 0
)
let conn: Conn

if (sockPort > 0) {
  conn = makeSocketConn(sockPort)
} else {
  const port = process.parentPort
  if (!port) {
    console.error('[pty-host] process.parentPort missing; refusing to start')
    process.exit(1)
  }
  conn = {
    send(msg) {
      try {
        port.postMessage(msg)
      } catch {
        // parent gone — nothing we can do
      }
    },
    onMessage(cb) {
      port.on('message', (e: { data: PtyHostRequest }) => cb(e.data))
    }
  }
}

function makeSocketConn(port: number): Conn {
  // Imported lazily so utilityProcess mode never pulls in net.
  const net = require('node:net') as typeof import('node:net')
  const clients = new Set<import('node:net').Socket>()
  const server = net.createServer((socket) => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
    // greet each client so the manager can tell supervisor vs stale port
    socket.write(JSON.stringify({ t: 'ready', pid: process.pid }) + '\n')

    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
        if (!line.trim()) continue
        try {
          dispatchMsg(JSON.parse(line) as PtyHostRequest)
        } catch {
          /* malformed line — drop */
        }
      }
      // guard against unbounded buffering from a broken client
      if (buf.length > 8 * 1024 * 1024) socket.destroy()
    })
  })
  server.on('error', () => {
    // Port already owned by something else — exit so the manager falls
    // back to utilityProcess mode instead of hanging on a dead address.
    process.exit(1)
  })
  server.listen(port, '127.0.0.1')

  // Idle self-exit — a supervisor with no sessions and no clients for
  // 15min is an orphan, not a service. Keeps machines clean after the
  // app is uninstalled or panes are all closed.
  let lastClientAt = Date.now()
  const clientWatcher = setInterval(() => {
    if (clients.size > 0) lastClientAt = Date.now()
    if (clients.size === 0 && sessions.size === 0 && Date.now() - lastClientAt > 15 * 60_000) {
      process.exit(0)
    }
  }, 60_000)
  clientWatcher.unref()

  return {
    send(msg) {
      const line = JSON.stringify(msg) + '\n'
      for (const socket of clients) {
        try {
          socket.write(line)
        } catch {
          clients.delete(socket)
        }
      }
    },
    onMessage(cb) {
      dispatchFn = cb
    }
  }
}

// socket mode registers its dispatch target here; parentPort mode calls
// dispatchMsg directly. Set before any message can arrive.
let dispatchFn: ((msg: PtyHostRequest) => void) | null = null
function dispatchMsg(msg: PtyHostRequest): void {
  dispatchFn?.(msg)
}

function send(msg: PtyHostResponse): void {
  conn.send(msg)
}

function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void {
  send({ t: 'log', level, msg })
}

// ── output batching + ring buffer ────────────────────────────────────

/** Cut a slice of at most `max` chars without splitting a surrogate pair. */
function head(str: string, max: number): string {
  if (str.length <= max) return str
  let cut = max
  const code = str.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut-- // don't split a lead surrogate
  return str.slice(0, cut)
}

function ringAppend(s: PtySession, chunk: string): void {
  s.ring.push(chunk)
  s.ringLen += chunk.length
  while (s.ringLen > RING_CAP && s.ring.length > 0) {
    const dropped = s.ring[0]
    const overflow = s.ringLen - RING_CAP
    if (dropped.length <= overflow) {
      s.ring.shift()
      s.ringLen -= dropped.length
    } else {
      // Trim the oldest chunk; don't leave an orphaned trail surrogate.
      let cut = overflow
      const code = dropped.charCodeAt(cut)
      if (code >= 0xdc00 && code <= 0xdfff) cut++
      s.ring[0] = dropped.slice(cut)
      s.ringLen -= cut
    }
  }
}

function flush(s: PtySession): void {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer)
    s.flushTimer = null
  }
  while (s.pending.length > 0) {
    const chunk = head(s.pending, FLUSH_CHUNK)
    s.pending = s.pending.slice(chunk.length)
    send({ t: 'data', sessionId: s.opts.sessionId, data: chunk })
    ringAppend(s, chunk)
  }
}

function enqueueOutput(s: PtySession, data: string): void {
  s.pending += data
  if (s.pending.length >= FLUSH_CHUNK) {
    flush(s)
  } else if (!s.flushTimer) {
    s.flushTimer = setTimeout(() => flush(s), FLUSH_DELAY_MS)
  }
}

function sessionInfo(s: PtySession): PtySessionInfo {
  return {
    sessionId: s.opts.sessionId,
    pid: s.pid,
    command: s.opts.command,
    resolvedCommand: s.resolvedCommand,
    cwd: s.opts.cwd,
    cols: s.opts.cols,
    rows: s.opts.rows,
    status: s.status,
    startedAt: s.startedAt,
    exitCode: s.exitCode
  }
}

// ── windows command resolution (.cmd / .bat shims) ───────────────────

interface Launch {
  file: string
  /** Pre-joined command line when spawning via cmd.exe, argv otherwise. */
  args: string[] | string
  resolved: string | null
  viaCmd: boolean
}

function quoteArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[\s"&|<>^()]/.test(arg)) return arg
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
}

/** `where.exe` lookup — finds .cmd/.bat/.exe shims on PATH. Returns [] on failure. */
function where(name: string): string[] {
  try {
    const out = execFileSync('where.exe', [name], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true
    })
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && existsSync(l))
  } catch {
    return []
  }
}

/** Wrap a batch/shim target in `cmd.exe /d /s /c ""<file>" <args>"`. */
function cmdLaunch(target: string, args: string[]): Launch {
  const inner = [quoteArg(target), ...args.map(quoteArg)].join(' ')
  return {
    file: process.env.comspec || 'cmd.exe',
    // Verbatim command line — node-pty would mangle a pre-quoted string[]
    // by re-escaping the inner quotes. The string form is passed through
    // untouched; /s makes cmd strip the outer quotes and run the rest.
    args: `/d /s /c "${inner}"`,
    resolved: target,
    viaCmd: true
  }
}

function resolveLaunch(command: string, args: string[]): Launch {
  if (process.platform !== 'win32') {
    return { file: command, args, resolved: null, viaCmd: false }
  }

  const isPath = /[\\/]/.test(command)
  const isBatch = /\.(cmd|bat)$/i.test(command)

  // Explicit path — honour its extension directly.
  if (isPath) {
    if (isBatch) return cmdLaunch(command, args)
    return { file: command, args, resolved: command, viaCmd: false }
  }

  // Bare name — ask where.exe what it resolves to (PATHEXT-aware).
  const found = where(command)
  const exe = found.find((f) => /\.exe$/i.test(f))
  const batch = found.find((f) => /\.(cmd|bat)$/i.test(f))
  const ps1 = found.find((f) => /\.ps1$/i.test(f))

  if (exe) return { file: exe, args, resolved: exe, viaCmd: false }
  if (batch) return cmdLaunch(batch, args)
  if (ps1) {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args],
      resolved: ps1,
      viaCmd: false
    }
  }
  if (found.length > 0) return { file: found[0], args, resolved: found[0], viaCmd: false }

  // where.exe found nothing — let cmd.exe try PATH/PATHEXT itself.
  return cmdLaunch(command, args)
}

// ── spawn / io ───────────────────────────────────────────────────────

/** Variables that describe whoever launched Terrarium, not the terminal
 * itself. Started from inside an agent harness (e.g. a Claude Code session),
 * the app would otherwise hand CLAUDECODE / CLAUDE_CODE_CHILD_SESSION to every
 * pane: claude then treats itself as a nested child — no colours, transcript
 * saving off. ELECTRON_RUN_AS_NODE / the supervisor port are our own plumbing
 * and would break any Electron app started from a pane. */
const LAUNCHER_ENV = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_|ELECTRON_RUN_AS_NODE$|TERRARIUM_PTY_HOST_PORT$|NO_COLOR$)/i

function buildEnv(opts: Required<PtySpawnOpts>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && !LAUNCHER_ENV.test(k)) env[k] = v
  }
  if (env.FORCE_COLOR === '0') delete env.FORCE_COLOR
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  for (const [k, v] of Object.entries(opts.env)) env[k] = v
  return env
}

function normalizeOpts(opts: PtySpawnOpts): Required<PtySpawnOpts> {
  return {
    sessionId: opts.sessionId,
    cwd: opts.cwd,
    command: opts.command,
    args: opts.args ?? [],
    env: opts.env ?? {},
    cols: Math.max(1, Math.floor(opts.cols ?? PTY_DEFAULT_COLS)),
    rows: Math.max(1, Math.floor(opts.rows ?? PTY_DEFAULT_ROWS))
  }
}

function handleSpawn(id: number, rawOpts: PtySpawnOpts): void {
  const opts = normalizeOpts(rawOpts)
  const existing = sessions.get(opts.sessionId)
  if (existing && (existing.status === 'running' || existing.status === 'spawning')) {
    send({ t: 'spawn-error', id, sessionId: opts.sessionId, error: 'session already running' })
    return
  }

  const launch = resolveLaunch(opts.command, opts.args)
  const s: PtySession = {
    opts,
    pty: null,
    pid: null,
    resolvedCommand: launch.resolved,
    status: 'spawning',
    startedAt: Date.now(),
    exitCode: null,
    ring: [],
    ringLen: 0,
    pending: '',
    flushTimer: null
  }
  sessions.set(opts.sessionId, s)

  try {
    const pty = ptySpawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: buildEnv(opts),
      useConpty: true,
      useConptyDll: true,
      conptyInheritCursor: true
    })
    s.pty = pty
    s.pid = pty.pid
    s.status = 'running'

    pty.onData((data) => enqueueOutput(s, data))
    pty.onExit(({ exitCode, signal }) => {
      flush(s) // drain before the exit event so ordering holds
      s.status = 'exited'
      s.exitCode = exitCode
      s.pid = null
      send({ t: 'exit', sessionId: opts.sessionId, exitCode, signal })
      send({ t: 'status', sessionId: opts.sessionId, status: 'exited' })
    })

    send({ t: 'spawned', id, sessionId: opts.sessionId, info: sessionInfo(s) })
    send({ t: 'status', sessionId: opts.sessionId, status: 'running' })
  } catch (err) {
    s.status = 'exited'
    s.exitCode = -1
    send({
      t: 'spawn-error',
      id,
      sessionId: opts.sessionId,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

function handleAttach(id: number, sessionId: string): void {
  const s = sessions.get(sessionId)
  if (!s) {
    send({ t: 'attached', id, sessionId, info: null })
    return
  }
  // ConPTY may reprint the screen after a client-side reset — clear its
  // shadow buffer so replay stays authoritative.
  try {
    s.pty?.clear()
  } catch {
    /* pty gone */
  }
  // Replay = reset seq + everything already flushed to main. Pending output
  // (≤8ms worth) arrives right after as a normal data event, so ordering holds.
  const replay = PTY_ATTACH_RESET_SEQ + s.ring.join('')
  if (replay.length > 0) {
    send({ t: 'data', sessionId, data: replay, replay: true })
  }
  send({ t: 'attached', id, sessionId, info: sessionInfo(s) })
}

function handleWrite(sessionId: string, data: string): void {
  const s = sessions.get(sessionId)
  if (!s?.pty || s.status !== 'running') return
  try {
    s.pty.write(data)
  } catch (err) {
    log('warn', `write failed for ${sessionId}: ${String(err)}`)
  }
}

function handleResize(sessionId: string, cols: number, rows: number): void {
  const s = sessions.get(sessionId)
  if (!s) return
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  s.opts.cols = c
  s.opts.rows = r
  if (!s.pty || s.status !== 'running') return
  try {
    s.pty.resize(c, r)
  } catch (err) {
    log('warn', `resize failed for ${sessionId}: ${String(err)}`)
  }
}

function handleKill(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (!s) return
  if (s.pty && s.status === 'running') {
    try {
      s.pty.kill()
    } catch (err) {
      log('warn', `kill failed for ${sessionId}: ${String(err)}`)
    }
  } else if (s.status !== 'exited') {
    // No live pty but not marked exited — synthesize the exit so callers don't hang.
    flush(s)
    s.status = 'exited'
    s.exitCode = -1
    send({ t: 'exit', sessionId, exitCode: -1 })
    send({ t: 'status', sessionId, status: 'exited' })
  }
}

function handleList(id: number): void {
  send({ t: 'list', id, sessions: [...sessions.values()].map(sessionInfo) })
}

/** Tail of the replay ring + still-pending output — raw, escape codes and all. */
function handleRead(id: number, sessionId: string, maxChars: number): void {
  const s = sessions.get(sessionId)
  const cap = Math.max(0, Math.min(RING_CAP, Math.floor(maxChars) || 0))
  if (!s || cap === 0) {
    send({ t: 'read-result', id, sessionId, data: '' })
    return
  }
  const tail = (s.ring.join('') + s.pending).slice(-cap)
  send({ t: 'read-result', id, sessionId, data: tail })
}

function handleShutdown(): void {
  for (const s of sessions.values()) {
    try {
      s.pty?.kill()
    } catch {
      /* already gone */
    }
  }
  process.exit(0)
}

// ── dispatch ─────────────────────────────────────────────────────────

conn.onMessage((msg) => {
  if (!msg || typeof msg !== 'object' || !('t' in msg)) return
  try {
    switch (msg.t) {
      case 'spawn':
        return handleSpawn(msg.id, msg.opts)
      case 'attach':
        return handleAttach(msg.id, msg.sessionId)
      case 'write':
        return handleWrite(msg.sessionId, msg.data)
      case 'resize':
        return handleResize(msg.sessionId, msg.cols, msg.rows)
      case 'kill':
        return handleKill(msg.sessionId)
      case 'list':
        return handleList(msg.id)
      case 'read':
        return handleRead(msg.id, msg.sessionId, msg.maxChars)
      case 'shutdown':
        return handleShutdown()
    }
  } catch (err) {
    log('error', `handler for '${msg.t}' threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  }
})

send({ t: 'ready', pid: process.pid })
