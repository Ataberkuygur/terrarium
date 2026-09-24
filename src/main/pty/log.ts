// ── tiny leveled logger for the pty subsystem ───────────────────────
// Mirrors to the main-process console and keeps a small ring of recent
// entries so a diagnostic dump doesn't need a log file.

import type { PtyHostLogLevel } from './protocol'

export interface PtyLogEntry {
  ts: number
  level: PtyHostLogLevel
  scope: string
  msg: string
}

const RING_CAP = 200
const ring: PtyLogEntry[] = []

export function ptyLog(level: PtyHostLogLevel, scope: string, msg: string): void {
  ring.push({ ts: Date.now(), level, scope, msg })
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP)
  const line = `[pty:${scope}] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (level === 'debug') console.debug(line)
  else console.log(line)
}

export function recentPtyLogs(): PtyLogEntry[] {
  return ring.slice()
}

export function createPtyLogger(scope: string): Record<PtyHostLogLevel, (msg: string) => void> {
  return {
    debug: (msg) => ptyLog('debug', scope, msg),
    info: (msg) => ptyLog('info', scope, msg),
    warn: (msg) => ptyLog('warn', scope, msg),
    error: (msg) => ptyLog('error', scope, msg)
  }
}
