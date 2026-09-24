// ── MockPtyBridge — browser-dev stand-in for the Electron pty ───────
// Implements PtyBridge over a fake line-editing shell: echoes input,
// answers `help` / `clear` / `exit`, and runs a canned `agent` script so
// Terminal.tsx can be exercised without Electron or node-pty.

import {
  PTY_ATTACH_RESET_SEQ,
  PTY_DEFAULT_COLS,
  PTY_DEFAULT_ROWS,
  type PtyBridge,
  type PtySessionInfo,
  type PtySessionStatus,
  type PtySpawnOpts
} from '../../../shared/pty'

const PROMPT = '\x1b[38;5;214m❯\x1b[0m '
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const AMBER = '\x1b[38;5;214m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const REPLAY_CAP = 16 * 1024

const BANNER =
  `${DIM}terrarium mock shell — no real pty attached${RESET}\r\n` +
  `${DIM}try: help · agent · clear · exit${RESET}\r\n\r\n`

/** A canned "agent run" — spinner, tool calls, status lines, done. */
const AGENT_SCRIPT: Array<[number, string]> = [
  [300, `${AMBER}⣾${RESET} claude — thinking…`],
  [700, `\r${AMBER}⣽${RESET} claude — thinking…`],
  [700, `\r${AMBER}⣻${RESET} claude — reading src/main/index.ts`],
  [900, `\r${GREEN}✓${RESET} read src/main/index.ts ${DIM}(47 lines)${RESET}\r\n`],
  [400, `${AMBER}⢿${RESET} claude — editing src/renderer/src/App.tsx`],
  [900, `${GREEN}✓${RESET} edited src/renderer/src/App.tsx ${DIM}(+12 −4)${RESET}\r\n`],
  [500, `${CYAN}$${RESET} pnpm typecheck\r\n`],
  [1100, `${DIM}tsc --noEmit -p tsconfig.json${RESET}\r\n${GREEN}clean${RESET}\r\n`],
  [400, `${GREEN}✓ done${RESET} — task complete ${DIM}(3.2s)${RESET}\r\n\r\n`]
]

interface MockSession {
  info: PtySessionInfo
  line: string
  /** Non-null while swallowing an incoming escape sequence (arrows, f-keys, paste marks). */
  esc: string | null
  history: string
  timers: ReturnType<typeof setTimeout>[]
  dataCbs: Set<(d: string) => void>
  replayCbs: Set<(d: string) => void>
  exitCbs: Set<(e: { exitCode: number; signal?: number }) => void>
  statusCbs: Set<(s: PtySessionStatus) => void>
}

export class MockPtyBridge implements PtyBridge {
  private sessions = new Map<string, MockSession>()
  private nextPid = 4000

  private emitData(s: MockSession, data: string): void {
    s.history = (s.history + data).slice(-REPLAY_CAP)
    for (const cb of s.dataCbs) cb(data)
  }

  private emitStatus(s: MockSession, status: PtySessionStatus): void {
    s.info.status = status
    for (const cb of s.statusCbs) cb(status)
  }

  private prompt(s: MockSession): void {
    this.emitData(s, PROMPT)
  }

  private runCommand(s: MockSession, cmdline: string): void {
    const cmd = cmdline.trim().split(/\s+/)[0] ?? ''
    switch (cmd) {
      case '':
        return this.prompt(s)
      case 'help':
        this.emitData(
          s,
          `${DIM}commands:${RESET}\r\n` +
            `  ${CYAN}agent${RESET}  run a canned agent session\r\n` +
            `  ${CYAN}clear${RESET}  clear the screen\r\n` +
            `  ${CYAN}exit${RESET}   end the session\r\n`
        )
        return this.prompt(s)
      case 'clear':
        this.emitData(s, '\x1b[2J\x1b[H')
        return this.prompt(s)
      case 'exit':
        this.emitData(s, `${DIM}logout${RESET}\r\n`)
        return this.endSession(s, 0)
      case 'agent': {
        let t = 0
        for (const [delay, chunk] of AGENT_SCRIPT) {
          t += delay
          s.timers.push(
            setTimeout(() => {
              if (s.info.status === 'running') this.emitData(s, chunk)
            }, t)
          )
        }
        s.timers.push(
          setTimeout(() => {
            if (s.info.status === 'running') this.prompt(s)
          }, t + 50)
        )
        return
      }
      default:
        this.emitData(s, `${RED}mock: command not found:${RESET} ${cmdline}\r\n`)
        return this.prompt(s)
    }
  }

  private handleInput(s: MockSession, data: string): void {
    for (const ch of data) {
      // swallow escape sequences so arrows/f-keys don't echo garbage
      if (s.esc !== null) {
        s.esc += ch
        const code = ch.charCodeAt(0)
        const isOsc = s.esc.startsWith('\x1b]')
        const oscDone = isOsc && (ch === '\x07' || s.esc.endsWith('\x1b\\'))
        // two-byte seq (ESC c) ends on the type char unless it opens CSI/OSC/SS3
        const csiDone =
          !isOsc &&
          ((s.esc.length === 2 && !'[]O('.includes(ch)) ||
            (s.esc.length >= 3 && code >= 0x40 && code <= 0x7e))
        if (oscDone || csiDone || s.esc.length > 32) s.esc = null
        continue
      }
      if (ch === '\x1b') {
        s.esc = ch
        continue
      }
      if (ch === '\r') {
        this.emitData(s, '\r\n')
        const line = s.line
        s.line = ''
        this.runCommand(s, line)
      } else if (ch === '\x7f' || ch === '\b') {
        if (s.line.length > 0) {
          s.line = s.line.slice(0, -1)
          this.emitData(s, '\b \b')
        }
      } else if (ch === '\x03') {
        s.line = ''
        this.emitData(s, '^C\r\n')
        this.prompt(s)
      } else if (ch === '\x0c') {
        this.emitData(s, '\x1b[2J\x1b[H')
        this.prompt(s)
      } else if (ch >= ' ' || ch === '\t') {
        s.line += ch
        this.emitData(s, ch)
      }
      // other control bytes (arrows, escape seqs) are ignored in the mock
    }
  }

  private endSession(s: MockSession, exitCode: number): void {
    if (s.info.status !== 'running') return
    for (const t of s.timers) clearTimeout(t)
    s.timers = []
    s.info.exitCode = exitCode
    s.info.pid = null
    this.emitStatus(s, 'exited')
    for (const cb of s.exitCbs) cb({ exitCode })
  }

  spawn(opts: PtySpawnOpts): Promise<PtySessionInfo> {
    const existing = this.sessions.get(opts.sessionId)
    if (existing && existing.info.status === 'running') {
      return Promise.reject(new Error(`mock session '${opts.sessionId}' already running`))
    }
    const s: MockSession = {
      info: {
        sessionId: opts.sessionId,
        pid: this.nextPid++,
        command: opts.command,
        resolvedCommand: `/mock/${opts.command}`,
        cwd: opts.cwd,
        cols: opts.cols ?? PTY_DEFAULT_COLS,
        rows: opts.rows ?? PTY_DEFAULT_ROWS,
        status: 'running',
        startedAt: Date.now(),
        exitCode: null
      },
      line: '',
      esc: null,
      history: '',
      timers: [],
      dataCbs: new Set(),
      replayCbs: new Set(),
      exitCbs: new Set(),
      statusCbs: new Set()
    }
    this.sessions.set(opts.sessionId, s)
    // async so subscribers attached right after spawn() don't miss the banner
    s.timers.push(
      setTimeout(() => {
        if (s.info.status !== 'running') return
        this.emitStatus(s, 'running')
        this.emitData(s, BANNER)
        this.prompt(s)
      }, 30)
    )
    return Promise.resolve({ ...s.info })
  }

  attach(sessionId: string): Promise<PtySessionInfo | null> {
    const s = this.sessions.get(sessionId)
    if (!s) return Promise.resolve(null)
    const replay = PTY_ATTACH_RESET_SEQ + s.history
    for (const cb of s.replayCbs) cb(replay)
    return Promise.resolve({ ...s.info })
  }

  write(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId)
    if (s && s.info.status === 'running') this.handleInput(s, data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId)
    if (s) {
      s.info.cols = cols
      s.info.rows = rows
    }
  }

  kill(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (s) this.endSession(s, 0)
    return Promise.resolve()
  }

  list(): Promise<PtySessionInfo[]> {
    return Promise.resolve([...this.sessions.values()].map((s) => ({ ...s.info })))
  }

  onData(sessionId: string, cb: (data: string) => void): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.dataCbs.add(cb)
    return () => s.dataCbs.delete(cb)
  }

  onReplay(sessionId: string, cb: (data: string) => void): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.replayCbs.add(cb)
    return () => s.replayCbs.delete(cb)
  }

  onExit(
    sessionId: string,
    cb: (exit: { exitCode: number; signal?: number }) => void
  ): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.exitCbs.add(cb)
    return () => s.exitCbs.delete(cb)
  }

  onStatus(sessionId: string, cb: (status: PtySessionStatus) => void): () => void {
    const s = this.sessions.get(sessionId)
    if (!s) return () => {}
    s.statusCbs.add(cb)
    return () => s.statusCbs.delete(cb)
  }
}

let mockSingleton: MockPtyBridge | null = null

/**
 * The bridge Terminal should use: the real one when under Electron, a shared
 * mock in a plain browser. The mock is a singleton so callers can use
 * `bridge={getPtyBridge()}` inline without respawning sessions per render.
 */
export function getPtyBridge(): PtyBridge {
  // cast keeps this file independent of the preload wiring state
  const real = window.terrarium?.pty as PtyBridge | undefined
  if (real) return real
  if (!mockSingleton) mockSingleton = new MockPtyBridge()
  return mockSingleton
}
