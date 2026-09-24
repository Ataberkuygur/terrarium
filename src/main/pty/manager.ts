// ── pty manager — main-process side ─────────────────────────────────
// Owns the pty-host utility process and the session registry
// (sessionId → info). Exposes a Promise-friendly API used by the IPC
// layer, and fans host events out as PtyEvents. If the host crashes,
// live sessions are marked 'dead' and the next spawn re-forks.

import { BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { existsSync, openSync, closeSync } from 'node:fs'
import { spawn as spawnChild } from 'node:child_process'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { defaultHome } from '../engine/paths'
import {
  PTY_IPC,
  type PtyEvent,
  type PtySessionInfo,
  type PtySessionStatus,
  type PtySpawnOpts
} from '../../shared/pty'
import { createPtyLogger, recentPtyLogs } from './log'
import type { PtyHostRequest, PtyHostResponse } from './protocol'

const log = createPtyLogger('manager')

const RPC_TIMEOUT_MS = 15_000

interface PendingReq {
  resolve: (msg: PtyHostResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface PtyManager {
  spawn(opts: PtySpawnOpts): Promise<PtySessionInfo>
  attach(sessionId: string): Promise<PtySessionInfo | null>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  kill(sessionId: string): Promise<void>
  list(): Promise<PtySessionInfo[]>
  /** Tail of the session's replay ring — raw output, '' when unknown. */
  readTail(sessionId: string, maxChars: number): Promise<string>
  /** Every PtyEvent from every session — wire to webContents.send(PTY_IPC.EVENT). */
  onEvent(cb: (ev: PtyEvent) => void): () => void
  /** Kill all sessions and shut the host down. */
  dispose(): void
}

export interface PtyManagerOptions {
  /** Override the host module path (tests / custom layouts). */
  hostPath?: string
}

export function createPtyManager(opts: PtyManagerOptions = {}): PtyManager {
  // electron-vite emits the second main entry as out/main/pty/pty-host.js
  // (rollup input key 'pty/pty-host'). Where that lands relative to THIS
  // bundle depends on whether manager.ts was inlined into index.js or
  // emitted as a shared chunk — try each plausible layout.
  const hostPath =
    opts.hostPath ??
    [
      join(__dirname, 'pty/pty-host.js'), // manager inlined into out/main/index.js
      join(__dirname, '../pty/pty-host.js'), // manager in chunks/ or its own dir
      join(__dirname, 'pty-host.js') // flat layout
    ].find((p) => existsSync(p)) ?? join(__dirname, 'pty/pty-host.js')

  // Two transports, same protocol: a detached supervisor on a loopback
  // socket (pty sessions OUTLIVE the app — reconnect on relaunch and the
  // renderer's attach/replay path restores every terminal) or the classic
  // utilityProcess fork (dies with the app; kept as the fallback).
  type HostConn =
    | { kind: 'fork'; child: UtilityProcess }
    | { kind: 'sock'; socket: Socket }

  const SUPERVISOR_PORT = Number(
    process.env.TERRARIUM_PTY_HOST_PORT ?? process.env.ATOLYE_PTY_HOST_PORT ?? 8794
  )

  let conn: HostConn | null = null
  let connAttempt: Promise<HostConn> | null = null
  let reqSeq = 0
  const pending = new Map<number, PendingReq>()
  const listeners = new Set<(ev: PtyEvent) => void>()
  /** Registry: sessions this manager has ever spawned, incl. dead ones from a crashed host. */
  const registry = new Map<string, PtySessionInfo>()

  const emit = (ev: PtyEvent) => {
    for (const cb of listeners) {
      try {
        cb(ev)
      } catch (err) {
        log.warn(`event listener threw: ${String(err)}`)
      }
    }
  }

  const setStatus = (sessionId: string, status: PtySessionStatus) => {
    const info = registry.get(sessionId)
    if (info) info.status = status
    emit({ type: 'status', sessionId, status })
  }

  function rejectAllPending(reason: string): void {
    for (const req of pending.values()) {
      clearTimeout(req.timer)
      req.reject(new Error(reason))
    }
    pending.clear()
  }

  function markLiveSessionsDead(): void {
    for (const info of registry.values()) {
      if (info.status === 'running' || info.status === 'spawning') {
        info.status = 'dead'
        info.pid = null
        emit({ type: 'status', sessionId: info.sessionId, status: 'dead' })
      }
    }
  }

  function onHostExit(code: number | null): void {
    log.warn(`pty-host exited (code ${code}) — marking live sessions dead`)
    conn = null
    rejectAllPending('pty-host exited')
    markLiveSessionsDead()
  }

  /** Socket dropped — the supervisor may still be alive, so sessions keep
   * their status; the next request reconnects and list() resyncs truth. */
  function onSockDead(): void {
    log.warn('pty supervisor socket closed — will reconnect on next request')
    conn = null
    rejectAllPending('pty supervisor disconnected')
  }

  function tryConnect(port: number): Promise<Socket | null> {
    return new Promise((resolve) => {
      const s = new Socket()
      const done = (v: Socket | null) => {
        s.removeAllListeners()
        if (!v) s.destroy()
        resolve(v)
      }
      s.setTimeout(700)
      s.once('connect', () => done(s))
      s.once('timeout', () => done(null))
      s.once('error', () => done(null))
      s.connect(port, '127.0.0.1')
    })
  }

  /** Detached supervisor — electron.exe run as plain node so node-pty's
   * ABI matches (same binary utilityProcess would use). detached+unref →
   * the process tree survives this app's exit entirely. */
  function spawnSupervisor(): void {
    try {
      const logPath = join(defaultHome(), 'pty-host.log')
      let outFd: number | undefined
      try {
        outFd = openSync(logPath, 'a')
      } catch {
        /* logging optional */
      }
      const child = spawnChild(process.execPath, [hostPath], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          TERRARIUM_PTY_HOST_PORT: String(SUPERVISOR_PORT)
        },
        detached: true,
        windowsHide: true,
        stdio: outFd !== undefined ? ['ignore', outFd, outFd] : 'ignore'
      })
      child.unref()
      if (outFd !== undefined) closeSync(outFd)
      log.info(`pty supervisor spawned (pid ${child.pid}, port ${SUPERVISOR_PORT})`)
    } catch (err) {
      log.warn(`pty supervisor spawn failed: ${String(err)}`)
    }
  }

  function forkHost(): HostConn {
    const child = utilityProcess.fork(hostPath, [], {
      serviceName: 'terrarium-pty-host',
      // NOTE: do NOT set ELECTRON_RUN_AS_NODE here — utilityProcess already
      // runs the child in a Node context with process.parentPort; setting it
      // makes electron.exe reject the mojo utility flags ('bad option').
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const c: HostConn = { kind: 'fork', child }
    conn = c

    child.on('message', (msg: PtyHostResponse) => dispatch(msg))
    child.on('exit', (code) => {
      if (conn === c) conn = null
      onHostExit(code ?? null)
    })
    child.on('error', (type, location, report) => {
      log.error(`pty-host ${type} at ${location}: ${report}`)
    })
    child.stdout?.on('data', (d) => log.debug(`host stdout: ${String(d).trimEnd()}`))
    child.stderr?.on('data', (d) => log.warn(`host stderr: ${String(d).trimEnd()}`))
    log.info(`pty-host forked (${hostPath})`)
    return c
  }

  function wrapSocket(socket: Socket): HostConn {
    socket.setNoDelay(true)
    socket.setTimeout(0)
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
          dispatch(JSON.parse(line) as PtyHostResponse)
        } catch {
          /* malformed line — drop */
        }
      }
      if (buf.length > 16 * 1024 * 1024) socket.destroy()
    })
    const dead = () => onSockDead()
    socket.on('close', dead)
    socket.on('error', dead)
    const c: HostConn = { kind: 'sock', socket }
    conn = c
    return c
  }

  async function ensureHost(): Promise<HostConn> {
    if (conn) return conn
    if (connAttempt) return connAttempt
    connAttempt = (async () => {
      // 1. a supervisor from a previous app instance may already listen
      let sock = await tryConnect(SUPERVISOR_PORT)
      // 2. spawn one and wait for it to bind
      if (!sock) {
        spawnSupervisor()
        const deadline = Date.now() + 4000
        while (!sock && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 120))
          sock = await tryConnect(SUPERVISOR_PORT)
        }
      }
      if (sock) {
        const c = wrapSocket(sock)
        // Handshake: a real supervisor answers list() instantly; a foreign
        // port squatter never will → destroy and fall back to fork mode.
        try {
          const res = await requestVia<PtyHostResponse & { t: 'list' }>(
            c,
            { t: 'list', id: ++reqSeq },
            2000
          )
          // Resync — the supervisor's sessions outlived the last app run;
          // adopt them so attach/spawn/kill address real state.
          for (const info of res.sessions) registry.set(info.sessionId, info)
          log.info(`pty supervisor connected on 127.0.0.1:${SUPERVISOR_PORT}`)
          return c
        } catch {
          conn = null
          sock.destroy()
          log.warn('pty supervisor handshake failed — falling back to utilityProcess')
        }
      }
      return forkHost()
    })()
    try {
      return await connAttempt
    } finally {
      connAttempt = null
    }
  }

  function dispatch(msg: PtyHostResponse): void {
    if (!msg || typeof msg !== 'object') return
    switch (msg.t) {
      case 'spawned':
      case 'spawn-error':
      case 'attached':
      case 'read-result':
      case 'list': {
        const req = pending.get(msg.id)
        if (req) {
          pending.delete(msg.id)
          clearTimeout(req.timer)
          req.resolve(msg)
        }
        return
      }
      case 'data':
        emit({ type: 'data', sessionId: msg.sessionId, data: msg.data, replay: msg.replay })
        return
      case 'exit': {
        const info = registry.get(msg.sessionId)
        if (info) {
          info.status = 'exited'
          info.exitCode = msg.exitCode
          info.pid = null
        }
        emit({ type: 'exit', sessionId: msg.sessionId, exitCode: msg.exitCode, signal: msg.signal })
        return
      }
      case 'status': {
        const info = registry.get(msg.sessionId)
        if (info) info.status = msg.status
        emit({ type: 'status', sessionId: msg.sessionId, status: msg.status })
        return
      }
      case 'log':
        log[msg.level](`host: ${msg.msg}`)
        return
      case 'ready':
        log.info(`pty-host ready (pid ${msg.pid})`)
        return
    }
  }

  /** Send a request that expects a correlated reply (spawn/attach/list). */
  async function request<T extends PtyHostResponse>(
    msg: PtyHostRequest & { id: number },
    timeoutMs = RPC_TIMEOUT_MS
  ): Promise<T> {
    const c = await ensureHost()
    return requestVia<T>(c, msg, timeoutMs)
  }

  function requestVia<T extends PtyHostResponse>(
    c: HostConn,
    msg: PtyHostRequest & { id: number },
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(msg.id)
        reject(new Error(`pty-host request '${msg.t}' timed out`))
      }, timeoutMs)
      pending.set(msg.id, {
        resolve: resolve as (m: PtyHostResponse) => void,
        reject,
        timer
      })
      try {
        if (c.kind === 'fork') c.child.postMessage(msg)
        else c.socket.write(JSON.stringify(msg) + '\n')
      } catch (err) {
        pending.delete(msg.id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Fire-and-forget send; silently drops when the host is gone. */
  function send(msg: PtyHostRequest): void {
    if (!conn) return
    try {
      if (conn.kind === 'fork') conn.child.postMessage(msg)
      else conn.socket.write(JSON.stringify(msg) + '\n')
    } catch {
      /* host died mid-send — exit handler will clean up */
    }
  }

  return {
    async spawn(opts: PtySpawnOpts): Promise<PtySessionInfo> {
      const existing = registry.get(opts.sessionId)
      if (existing && (existing.status === 'running' || existing.status === 'spawning')) {
        throw new Error(`pty session '${opts.sessionId}' is already running`)
      }
      await ensureHost()
      registry.set(opts.sessionId, {
        sessionId: opts.sessionId,
        pid: null,
        command: opts.command,
        resolvedCommand: null,
        cwd: opts.cwd,
        cols: opts.cols ?? 0,
        rows: opts.rows ?? 0,
        status: 'spawning',
        startedAt: Date.now(),
        exitCode: null
      })
      setStatus(opts.sessionId, 'spawning')

      const res = await request<PtyHostResponse & { t: 'spawned' | 'spawn-error' }>({
        t: 'spawn',
        id: ++reqSeq,
        opts
      })
      if (res.t === 'spawn-error') {
        registry.delete(opts.sessionId)
        throw new Error(res.error)
      }
      registry.set(opts.sessionId, res.info)
      return res.info
    },

    async attach(sessionId: string): Promise<PtySessionInfo | null> {
      // Replay arrives as data{replay:true} events before/around this reply.
      const res = await request<PtyHostResponse & { t: 'attached' }>({
        t: 'attach',
        id: ++reqSeq,
        sessionId
      })
      return res.info
    },

    write(sessionId: string, data: string): void {
      send({ t: 'write', sessionId, data })
    },

    resize(sessionId: string, cols: number, rows: number): void {
      const info = registry.get(sessionId)
      if (info) {
        info.cols = cols
        info.rows = rows
      }
      send({ t: 'resize', sessionId, cols, rows })
    },

    async kill(sessionId: string): Promise<void> {
      send({ t: 'kill', sessionId })
      // If the host is already gone there'll be no exit event — mark it ourselves.
      if (!conn) {
        const info = registry.get(sessionId)
        if (info && info.status !== 'exited') {
          info.status = 'dead'
          emit({ type: 'status', sessionId, status: 'dead' })
        }
      }
    },

    async list(): Promise<PtySessionInfo[]> {
      try {
        await ensureHost()
      } catch {
        return [...registry.values()].map((i) => ({ ...i }))
      }
      const res = await request<PtyHostResponse & { t: 'list' }>({ t: 'list', id: ++reqSeq })
      const byId = new Map<string, PtySessionInfo>()
      for (const info of registry.values()) byId.set(info.sessionId, { ...info })
      for (const info of res.sessions) {
        byId.set(info.sessionId, info)
        registry.set(info.sessionId, info)
      }
      return [...byId.values()]
    },

    async readTail(sessionId: string, maxChars: number): Promise<string> {
      try {
        // Tight cap — an old supervisor that predates 'read' just drops the
        // request, and classification shouldn't stall 15s on it.
        const res = await request<PtyHostResponse & { t: 'read-result' }>(
          { t: 'read', id: ++reqSeq, sessionId, maxChars },
          2500
        )
        return res.data
      } catch {
        return ''
      }
    },

    onEvent(cb: (ev: PtyEvent) => void): () => void {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    dispose(): void {
      const c = conn
      conn = null
      if (c?.kind === 'sock') {
        // Deliberately NOT sending 'shutdown' — the supervisor and every
        // pty it owns survive app exit. Next launch reconnects and the
        // renderer's attach/replay path restores the terminals.
        try {
          c.socket.end()
        } catch {
          /* already gone */
        }
      } else if (c?.kind === 'fork' && c.child.pid !== undefined) {
        try {
          c.child.postMessage({ t: 'shutdown' } satisfies PtyHostRequest)
        } catch {
          /* already gone */
        }
        // Give the host a moment to reap its ptys, then force it down.
        setTimeout(() => {
          try {
            c.child.kill()
          } catch {
            /* already gone */
          }
        }, 500).unref()
      }
      rejectAllPending('pty manager disposed')
    }
  }
}

/**
 * Wires the manager onto ipcMain. Call once from main/index.ts after
 * app.whenReady(). Events broadcast to every window on PTY_IPC.EVENT.
 */
export function registerPtyIpc(manager: PtyManager): void {
  ipcMain.handle(PTY_IPC.SPAWN, (_e, opts: PtySpawnOpts) => manager.spawn(opts))
  ipcMain.handle(PTY_IPC.ATTACH, (_e, sessionId: string) => manager.attach(sessionId))
  ipcMain.handle(PTY_IPC.KILL, (_e, sessionId: string) => manager.kill(sessionId))
  ipcMain.handle(PTY_IPC.LIST, () => manager.list())
  ipcMain.handle(PTY_IPC.READ, (_e, sessionId: string, maxChars: number) =>
    manager.readTail(sessionId, maxChars)
  )

  // High-frequency, fire-and-forget channels — no invoke round-trip.
  ipcMain.on(PTY_IPC.WRITE, (_e, sessionId: string, data: string) => {
    if (typeof sessionId === 'string' && typeof data === 'string') {
      manager.write(sessionId, data)
    }
  })
  ipcMain.on(PTY_IPC.RESIZE, (_e, sessionId: string, cols: number, rows: number) => {
    if (typeof sessionId === 'string' && Number.isFinite(cols) && Number.isFinite(rows)) {
      manager.resize(sessionId, cols, rows)
    }
  })

  manager.onEvent((ev) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(PTY_IPC.EVENT, ev)
    }
  })
}

export { recentPtyLogs }
export type { PtySessionInfo, PtySpawnOpts }
