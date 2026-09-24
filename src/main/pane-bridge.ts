// ── pane-bridge — loopback /cmd server for browser-pane control ──────
// Terminals (agent CLIs, scripts, curl) drive the workspace's browser
// panes through a tiny HTTP server bound to 127.0.0.1 — same command
// vocabulary as the Devin Tab Bridge (ping / tabs / nav / eval), so it's
// the drop-in default backend for in-app browsing. Requests are forwarded
// to the renderer (which owns the <webview> guests) on PANE_IPC.cmd; the
// renderer's reply on PANE_IPC.result resolves the HTTP response.
//
// Security posture: loopback only, no CORS, no auth — same trust level as
// the pty host itself (any local process can already write to a terminal).
// `eval` runs inside the sandboxed guest page, never in the app.

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { BrowserWindow, ipcMain } from 'electron'
import { PANE_IPC } from '../shared/ipc'
import { browserMcpStatus, setBrowserMcp } from './browser-mcp'
import {
  PANE_BRIDGE_PORT,
  PANE_BRIDGE_PORT_MAX,
  PANE_CMD_TIMEOUT_MAX_MS,
  type PaneCmdResult
} from '../shared/pane-bridge'

/** Bound port once listening (8791+ — first free), null before/disabled. */
let boundPort: number | null = null
let nextId = 1
/** HTTP responses waiting on the renderer's PANE_IPC.result reply. */
const pending = new Map<number, (res: PaneCmdResult) => void>()

const CMD_TIMEOUT_MS = 20_000
const BODY_MAX = 512 * 1024

export function paneBridgePort(): number | null {
  return boundPort
}

/** Fail every in-flight command — renderer gone means no reply is coming. */
function flushPending(error: string): void {
  for (const [id, resolve] of pending) {
    pending.delete(id)
    resolve({ ok: false, error })
  }
}

/** Windows already wired to flush pending on renderer death. */
const wiredWindows = new WeakSet<BrowserWindow>()

/** Every live window, each wired to flush pending on renderer death. */
function liveWindows(): BrowserWindow[] {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  for (const win of wins) {
    if (wiredWindows.has(win)) continue
    wiredWindows.add(win)
    win.webContents.once('destroyed', () => flushPending('renderer window destroyed'))
    win.webContents.once('render-process-gone', () =>
      flushPending('renderer process crashed')
    )
  }
  return wins
}

/** Forward one command to one window's renderer; resolves with its reply. */
function askWindow(win: BrowserWindow, msg: Record<string, unknown>, ms: number): Promise<PaneCmdResult> {
  return new Promise((resolve) => {
    const id = nextId++
    const timeout = setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, error: 'pane command timed out' })
    }, ms)
    pending.set(id, (result) => {
      clearTimeout(timeout)
      resolve(result)
    })
    try {
      win.webContents.send(PANE_IPC.cmd, { ...msg, id })
    } catch (e) {
      pending.delete(id)
      clearTimeout(timeout)
      resolve({ ok: false, error: e instanceof Error ? e.message : 'renderer unreachable' })
    }
  })
}

/** Does this window's orchestration store own the caller's sid / net? */
async function windowOwns(win: BrowserWindow, sid: string, net: string): Promise<boolean> {
  const res = await askWindow(win, { cmd: 'net.list' }, 2000)
  if (!res.ok || !Array.isArray(res.result)) return false
  const key = net.toLowerCase()
  return (res.result as Array<Record<string, unknown>>).some((n) => {
    if (net && (n.id === net || String(n.name ?? '').toLowerCase() === key)) return true
    if (!sid) return false
    const nodes = [n.orchestrator, ...(Array.isArray(n.agents) ? n.agents : [])]
    return nodes.some((x) => !!x && typeof x === 'object' && (x as { sid?: unknown }).sid === sid)
  })
}

/**
 * Resolve the window a command targets. With several windows open, each
 * renderer keeps its own tabs/networks, so route by the caller's sid (or
 * explicit net) to the window that owns it; otherwise the focused window,
 * else the first. A single window short-circuits (no probe).
 */
async function hostWindow(msg: Record<string, unknown>): Promise<BrowserWindow | null> {
  const wins = liveWindows()
  if (wins.length <= 1) return wins[0] ?? null
  const sid = typeof msg.sid === 'string' ? msg.sid : ''
  const net = typeof msg.net === 'string' ? msg.net : ''
  if (sid || net) {
    const owns = await Promise.all(wins.map((w) => windowOwns(w, sid, net)))
    const hit = wins[owns.indexOf(true)]
    if (hit) return hit
  }
  const focused = BrowserWindow.getFocusedWindow()
  return focused && !focused.isDestroyed() ? focused : wins[0]
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function handleCmd(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, port: boundPort })
    return
  }
  if (req.method !== 'POST' || req.url !== '/cmd') {
    sendJson(res, 404, { ok: false, error: 'use POST /cmd or GET /health' })
    return
  }
  let body = ''
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8')
    if (body.length > BODY_MAX) req.destroy()
  })
  req.on('end', async () => {
    let msg: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(body)
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
      msg = parsed as Record<string, unknown>
    } catch {
      sendJson(res, 400, { ok: false, error: 'body must be a JSON object' })
      return
    }
    // host-level switch, no window involved (agents: `tnet mcp on|off`)
    if (msg.cmd === 'mcp.browser') {
      try {
        const result = typeof msg.on === 'boolean' ? await setBrowserMcp(msg.on) : await browserMcpStatus()
        sendJson(res, 200, { ok: true, result })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
      return
    }
    const win = await hostWindow(msg)
    if (!win) {
      sendJson(res, 503, { ok: false, error: 'no live window' })
      return
    }
    const id = nextId++
    // caller-tunable like the Chrome bridge's 120s default, hard-capped
    const reqMs =
      typeof msg.timeoutMs === 'number' && Number.isFinite(msg.timeoutMs)
        ? Math.min(Math.max(msg.timeoutMs, 1000), PANE_CMD_TIMEOUT_MAX_MS)
        : CMD_TIMEOUT_MS
    const timeout = setTimeout(() => {
      if (pending.delete(id)) {
        sendJson(res, 504, { id, ok: false, error: 'pane command timed out' })
      }
    }, reqMs)
    pending.set(id, (result) => {
      clearTimeout(timeout)
      sendJson(res, 200, { id, ...result })
    })
    try {
      win.webContents.send(PANE_IPC.cmd, { id, ...msg })
    } catch (e) {
      pending.delete(id)
      clearTimeout(timeout)
      sendJson(res, 503, {
        id,
        ok: false,
        error: e instanceof Error ? e.message : 'renderer unreachable'
      })
    }
  })
  req.on('error', () => {
    /* client hung up mid-body — pending entry dies with the 20s timeout */
  })
}

/** Start the server + IPC plumbing. Safe to call once at app ready. */
export function startPaneBridge(): void {
  ipcMain.on(PANE_IPC.result, (_e, id: number, result: PaneCmdResult) => {
    const resolve = pending.get(id)
    if (!resolve) return
    pending.delete(id)
    resolve(result && typeof result === 'object' ? result : { ok: false, error: 'bad result' })
  })
  ipcMain.handle(PANE_IPC.port, () => boundPort)

  const server = createServer(handleCmd)
  let attempt = PANE_BRIDGE_PORT
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < PANE_BRIDGE_PORT_MAX) {
      attempt++
      server.listen(attempt, '127.0.0.1')
    } else {
      console.warn('[pane-bridge] disabled:', err.message)
    }
  })
  server.on('listening', () => {
    const addr = server.address()
    boundPort = typeof addr === 'object' && addr ? addr.port : attempt
    console.log(`[pane-bridge] http://127.0.0.1:${boundPort}/cmd`)
  })
  server.listen(attempt, '127.0.0.1')
}
