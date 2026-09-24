// ── main ↔ pty-host wire protocol ───────────────────────────────────
// Messages exchanged over utilityProcess.postMessage / process.parentPort.
// Requests carry an `id` when they expect a correlated reply.

import type { PtySessionInfo, PtySessionStatus, PtySpawnOpts } from '../../shared/pty'

export type PtyHostRequest =
  | { t: 'spawn'; id: number; opts: PtySpawnOpts }
  | { t: 'attach'; id: number; sessionId: string }
  | { t: 'write'; sessionId: string; data: string }
  | { t: 'resize'; sessionId: string; cols: number; rows: number }
  | { t: 'kill'; sessionId: string }
  | { t: 'list'; id: number }
  /** Tail of the session's replay ring — read-only, never truncates. */
  | { t: 'read'; id: number; sessionId: string; maxChars: number }
  | { t: 'shutdown' }

export type PtyHostResponse =
  | { t: 'ready'; pid: number }
  | { t: 'spawned'; id: number; sessionId: string; info: PtySessionInfo }
  | { t: 'spawn-error'; id: number; sessionId: string; error: string }
  | { t: 'attached'; id: number; sessionId: string; info: PtySessionInfo | null }
  | { t: 'data'; sessionId: string; data: string; replay?: boolean }
  | { t: 'exit'; sessionId: string; exitCode: number; signal?: number }
  | { t: 'status'; sessionId: string; status: PtySessionStatus }
  | { t: 'list'; id: number; sessions: PtySessionInfo[] }
  | { t: 'read-result'; id: number; sessionId: string; data: string }
  | { t: 'log'; level: PtyHostLogLevel; msg: string }

export type PtyHostLogLevel = 'debug' | 'info' | 'warn' | 'error'
