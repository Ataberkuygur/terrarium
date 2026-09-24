// ── PTY subsystem — shared protocol ─────────────────────────────────
// Types and channel names shared by main (pty manager + IPC), preload
// (contextBridge surface) and renderer (Terminal component). The actual
// main↔pty-host wire protocol lives in src/main/pty/protocol.ts — these
// types are the contract the renderer sees.

/** Lifecycle of a single pty session. `dead` = the host process died underneath it. */
export type PtySessionStatus = 'spawning' | 'running' | 'exited' | 'dead'

export interface PtySpawnOpts {
  /** Caller-chosen session id — also used for re-attach bookkeeping. */
  sessionId: string
  /** Working directory for the spawned process. */
  cwd: string
  /** Bare command (`claude`, `codex`) or executable path. .cmd/.bat shims are resolved on Windows. */
  command: string
  args?: string[]
  /** Extra env vars, merged over the host's env. TERM/COLORTERM defaults are applied first. */
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export interface PtySessionInfo {
  sessionId: string
  /** OS pid of the pty wrapper process, null once gone. */
  pid: number | null
  /** Command as requested. */
  command: string
  /** Fully resolved executable path (e.g. the .cmd shim where.exe found), when known. */
  resolvedCommand: string | null
  cwd: string
  cols: number
  rows: number
  status: PtySessionStatus
  startedAt: number
  exitCode: number | null
}

/**
 * Events flowing host → main → renderer on the PTY_IPC.EVENT channel.
 * `data` events with `replay: true` are scrollback replays triggered by an
 * `attach()` — they begin with PTY_ATTACH_RESET_SEQ and should replace
 * (not append to) the current screen.
 */
export type PtyEvent =
  | { type: 'data'; sessionId: string; data: string; replay?: boolean }
  | { type: 'exit'; sessionId: string; exitCode: number; signal?: number }
  | { type: 'status'; sessionId: string; status: PtySessionStatus }

/** ipcRenderer.invoke channels (request/response) + ipcRenderer.send channels (fire-and-forget). */
export const PTY_IPC = {
  /** invoke: (opts: PtySpawnOpts) → PtySessionInfo */
  SPAWN: 'terrarium:pty:spawn',
  /** invoke: (sessionId: string) → PtySessionInfo | null — also triggers a scrollback replay event */
  ATTACH: 'terrarium:pty:attach',
  /** send: (sessionId: string, data: string) */
  WRITE: 'terrarium:pty:write',
  /** send: (sessionId: string, cols: number, rows: number) */
  RESIZE: 'terrarium:pty:resize',
  /** invoke: (sessionId: string) → void */
  KILL: 'terrarium:pty:kill',
  /** invoke: () → PtySessionInfo[] */
  LIST: 'terrarium:pty:list',
  /** invoke: (sessionId: string, maxChars: number) → string — raw ring tail */
  READ: 'terrarium:pty:read',
  /** webContents.send channel: (event: PtyEvent) — broadcast to all windows */
  EVENT: 'terrarium:pty:event'
} as const

/**
 * Escape sequence prepended to scrollback replays on attach — soft-resets
 * modes, pops kitty keyboard flags and restores the cursor shape so a
 * re-attaching renderer starts from a sane state. (Same trick VS Code uses.)
 */
export const PTY_ATTACH_RESET_SEQ = '\x1b[!p\x1b[=0u\x1b[0 q'

/** Default pty dimensions when the caller doesn't know better. */
export const PTY_DEFAULT_COLS = 120
export const PTY_DEFAULT_ROWS = 30

/**
 * The surface the preload exposes on `window.terrarium.pty` and the Terminal
 * component consumes. `MockPtyBridge` implements the same contract for
 * browser-only dev.
 *
 * Ordering guarantee: subscribe to onData/onReplay/onExit *before* calling
 * spawn() or attach(). Replay chunks arrive on onReplay (never onData) and
 * precede any live data for that session, so writing replay → then live
 * data is always consistent.
 */
export interface PtyBridge {
  /** Spawn a new session. Rejects if the id is already running/spawning. */
  spawn(opts: PtySpawnOpts): Promise<PtySessionInfo>
  /**
   * Attach to an existing session — triggers a scrollback replay delivered
   * via onReplay. Resolves with the session info, or null if unknown.
   */
  attach(sessionId: string): Promise<PtySessionInfo | null>
  /** Send keystrokes / pasted text to the pty. Fire-and-forget. */
  write(sessionId: string, data: string): void
  /** Report a new grid size. Fire-and-forget. */
  resize(sessionId: string, cols: number, rows: number): void
  /** Terminate the session. Resolves once the request is accepted; the exit event arrives async. */
  kill(sessionId: string): Promise<void>
  /** All known sessions (live + exited + dead-from-host-crash). */
  list(): Promise<PtySessionInfo[]>
  /**
   * Tail of the session's replay ring — raw output with escape codes.
   * Optional: the mock bridge doesn't keep a ring. '' when unknown.
   */
  readTail?(sessionId: string, maxChars: number): Promise<string>
  /** Live output. Returns an unsubscribe function. */
  onData(sessionId: string, cb: (data: string) => void): () => void
  /** Scrollback replay after attach(). Write after a full terminal reset. Returns unsubscribe. */
  onReplay(sessionId: string, cb: (data: string) => void): () => void
  /** Fired once when the pty exits. Returns unsubscribe. */
  onExit(
    sessionId: string,
    cb: (exit: { exitCode: number; signal?: number }) => void
  ): () => void
  /** Lifecycle changes (running → exited, or dead after a host crash). Returns unsubscribe. */
  onStatus(sessionId: string, cb: (status: PtySessionStatus) => void): () => void
}
