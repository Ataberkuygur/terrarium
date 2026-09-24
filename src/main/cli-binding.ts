// ── cli-binding — pty pid → agent CLI process → session id ───────────
// Lets the renderer remember which conversation each orchestration node
// is in, so a node whose pty died with the machine comes back resumed
// (shared/cli-resume.ts has the contract).
//
//   claude → ~/.claude/sessions/<pid>.json ({ sessionId, cwd }), written by
//            the CLI while it runs; readable live.
//   devin  → %APPDATA%/devin/cli/session_locks/<session>.lock holds the
//            owner's pid, but under an exclusive byte-range lock while the
//            CLI lives. Live we only learn the pid; once that process is
//            gone the lock reads fine and names its session.

import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { promises as fs } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { cliFromCommandLine } from '../shared/cli-detect'
import { isResumableCli, type CliBinding, type ResumableCli } from '../shared/cli-resume'
import { devinDbPath } from './cli-sessions'
import { processTable, type Proc } from './proc-cli'

const MAX_DEPTH = 5
/** devin stamps created_at in whole seconds, a little after the pty starts. */
const DEVIN_SINCE_SLACK_MS = 120_000
/** Clock skew allowed between the pty's start and a CLI's own startedAt. */
const START_SLACK_MS = 10_000

interface ClaudePidFile {
  sessionId?: unknown
  cwd?: unknown
  startedAt?: unknown
}

/**
 * claude's pid file, if it belongs to a process started inside this pty.
 * A hard power-off leaves pid files behind and pids get reused — a file
 * older than the pty is some earlier process's.
 */
async function claudePidSession(pid: number, since: number): Promise<{ id: string; cwd: string | null } | null> {
  try {
    const raw = await fs.readFile(join(homedir(), '.claude', 'sessions', `${pid}.json`), 'utf8')
    const j = JSON.parse(raw) as ClaudePidFile
    if (typeof j.sessionId !== 'string' || !j.sessionId) return null
    if (typeof j.startedAt === 'number' && since > 0 && j.startedAt < since - START_SLACK_MS) return null
    return { id: j.sessionId, cwd: typeof j.cwd === 'string' ? j.cwd : null }
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The agent CLI process at or under `root`. The root counts only when its
 * own image is the CLI — a `powershell -Command claude …` wrapper names the
 * CLI in its command line but isn't it. Among descendants, the shallowest
 * process whose image is the CLI wins (devin's `acp` child sits below its
 * main); else the deepest one whose command line names it (npm shims →
 * node.exe running the package).
 */
function findCli(root: number, procs: Proc[], children: Map<number, Proc[]>): { cli: ResumableCli; pid: number } | null {
  const self = procs.find((p) => p.pid === root)
  const selfCli = self ? cliFromCommandLine(self.name) : null
  if (isResumableCli(selfCli)) return { cli: selfCli, pid: root }

  let byCmd: { cli: ResumableCli; pid: number } | null = null
  let frontier = children.get(root) ?? []
  const seen = new Set<number>([root])
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next: Proc[] = []
    for (const p of frontier) {
      if (seen.has(p.pid)) continue
      seen.add(p.pid)
      const image = cliFromCommandLine(p.name)
      if (isResumableCli(image)) return { cli: image, pid: p.pid }
      const cmd = cliFromCommandLine(p.cmd)
      if (isResumableCli(cmd)) byCmd = { cli: cmd, pid: p.pid }
      next.push(...(children.get(p.pid) ?? []))
    }
    frontier = next
  }
  return byCmd
}

/** Shell root pid → the CLI last found under it (pruned when it dies). */
const shellChild = new Map<number, { cli: ResumableCli; pid: number }>()

/**
 * invoke handler for 'cli:bindings' — per pty root pid, the CLI session
 * running there. `since` is the pty's start (ms), for pid-file freshness.
 */
export async function cliBindings(
  entries: { pid: number; since: number }[]
): Promise<Record<number, CliBinding | null>> {
  const out: Record<number, CliBinding | null> = {}
  const roots = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && Number.isInteger(e.pid) && e.pid > 0
  )
  if (!roots.length) return out

  // cheap path first: a pty launched straight into claude IS the CLI
  const pending: { pid: number; since: number }[] = []
  for (const root of roots) {
    const hit = await claudePidSession(root.pid, root.since)
    if (hit) out[root.pid] = { cli: 'claude', pid: root.pid, id: hit.id, cwd: hit.cwd }
    else pending.push(root)
  }
  if (!pending.length) return out

  // a shell's CLI found last time and still alive is still the answer —
  // skip the process-table snapshot (a PowerShell/WMI spawn) entirely
  const unknown: { pid: number; since: number }[] = []
  for (const root of pending) {
    const known = shellChild.get(root.pid)
    if (!known || !isAlive(known.pid)) {
      shellChild.delete(root.pid)
      unknown.push(root)
      continue
    }
    const session = known.cli === 'claude' ? await claudePidSession(known.pid, root.since) : null
    out[root.pid] = { cli: known.cli, pid: known.pid, id: session?.id ?? null, cwd: session?.cwd ?? null }
  }
  if (!unknown.length) return out

  let procs: Proc[]
  try {
    procs = await processTable()
  } catch {
    return out
  }
  const children = new Map<number, Proc[]>()
  for (const p of procs) {
    if (p.pid === p.ppid) continue
    const list = children.get(p.ppid)
    if (list) list.push(p)
    else children.set(p.ppid, [p])
  }
  for (const root of unknown) {
    const found = findCli(root.pid, procs, children)
    if (!found) {
      out[root.pid] = null
      continue
    }
    if (found.pid !== root.pid) shellChild.set(root.pid, found)
    const session = found.cli === 'claude' ? await claudePidSession(found.pid, root.since) : null
    out[root.pid] = { cli: found.cli, pid: found.pid, id: session?.id ?? null, cwd: session?.cwd ?? null }
  }
  return out
}

async function devinSessionForPid(pid: number, since: number): Promise<{ id: string; cwd: string | null } | null> {
  const db = devinDbPath()
  if (!db) return null
  const lockDir = join(dirname(db), 'session_locks')
  const names = await fs.readdir(lockDir).catch(() => [] as string[])
  const ids: string[] = []
  await Promise.all(
    names
      .filter((n) => n.endsWith('.lock'))
      .map(async (n) => {
        // a live session's lock is unreadable (EBUSY) — skipped, which is
        // right: a running session isn't this dead process's
        const body = await fs.readFile(join(lockDir, n), 'utf8').catch(() => null)
        if (body?.trim() === String(pid)) ids.push(basename(n, '.lock'))
      })
  )
  if (!ids.length) return null
  try {
    const conn = new DatabaseSync(db, { readOnly: true })
    try {
      const rows = conn
        .prepare(
          `SELECT id, working_directory AS cwd, created_at AS created, last_activity_at AS at
           FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`
        )
        .all(...ids) as { id: string; cwd: string | null; created: number; at: number }[]
      // pids get reused — only a session that started with this process
      const fresh = rows
        .filter((r) => r.created * 1000 >= since - DEVIN_SINCE_SLACK_MS)
        .sort((a, b) => b.at - a.at)
      const pick = fresh[0]
      return pick ? { id: pick.id, cwd: pick.cwd } : null
    } finally {
      conn.close()
    }
  } catch {
    return null
  }
}

/**
 * invoke handler for 'cli:resolve-session' — the session a now-dead CLI
 * process was in. claude's pid file survives a hard power-off (only a
 * clean exit removes it); devin's lock becomes readable once its owner is
 * gone.
 */
export async function resolveCliSession(
  cli: string,
  pid: number,
  since: number
): Promise<{ id: string; cwd: string | null } | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null
  // the process this asks about is dead — a live pid is someone else now
  if (isAlive(pid)) return null
  const from = Number.isFinite(since) ? since : 0
  if (cli === 'claude') return claudePidSession(pid, from)
  if (cli === 'devin') return devinSessionForPid(pid, from)
  return null
}
