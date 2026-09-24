// ── proc-cli — which agent CLI runs under a pane's shell ─────────────
// A pane bound to `powershell` may be running `claude --resume …` the
// user typed. The renderer sniffs the screen for a fast guess; this is the
// authoritative check: snapshot the OS process table once, walk each
// requested shell pid's descendants breadth-first, and classify command
// lines with the shared cli-detect rules.
//
// Cost control: one snapshot serves every pid in the call, concurrent
// callers share the in-flight snapshot, and a snapshot is reused for
// SNAPSHOT_TTL_MS. The renderer only asks on screen transitions (a command
// echoed, a prompt returned), never on a timer.

import { execFile } from 'child_process'
import { cliFromCommandLine } from '../shared/cli-detect'

export interface Proc {
  pid: number
  ppid: number
  name: string
  cmd: string
}

const SNAPSHOT_TTL_MS = 1500
const MAX_DEPTH = 5

let snap: { at: number; procs: Proc[] } | null = null
let inflight: Promise<Proc[]> | null = null

function runSnapshot(): Promise<Proc[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Tab-separated rows; UTF-8 so non-ASCII paths survive.
      const script =
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine | ' +
        'ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$($_.CommandLine)" }'
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 10_000, maxBuffer: 32 * 1024 * 1024 },
        (_err, stdout) => {
          const procs: Proc[] = []
          for (const line of (stdout ?? '').split(/\r?\n/)) {
            const parts = line.split('\t')
            if (parts.length < 3) continue
            const pid = Number(parts[0])
            const ppid = Number(parts[1])
            if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
            procs.push({ pid, ppid, name: parts[2], cmd: parts.slice(3).join('\t') })
          }
          resolve(procs)
        }
      )
      return
    }
    execFile(
      'ps',
      ['-eo', 'pid=,ppid=,args='],
      { timeout: 5_000, maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout) => {
        const procs: Proc[] = []
        for (const line of (stdout ?? '').split('\n')) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
          if (!m) continue
          const cmd = m[3]
          procs.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            name: cmd.split(/\s+/)[0]?.split('/').pop() ?? '',
            cmd
          })
        }
        resolve(procs)
      }
    )
  })
}

async function snapshot(): Promise<Proc[]> {
  if (snap && Date.now() - snap.at < SNAPSHOT_TTL_MS) return snap.procs
  if (!inflight) {
    inflight = runSnapshot()
      .then((procs) => {
        snap = { at: Date.now(), procs }
        return procs
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Cached OS process table (pid, ppid, image, command line). */
export function processTable(): Promise<Proc[]> {
  return snapshot()
}

/**
 * invoke handler for 'cli:processes' — for each root (shell) pid, the
 * canonical id of the first agent CLI among its descendants, or null when
 * the shell is idle / running something else. Roots missing from the
 * process table map to null too.
 */
export async function probeCliProcesses(pids: number[]): Promise<Record<number, string | null>> {
  const out: Record<number, string | null> = {}
  const roots = (Array.isArray(pids) ? pids : []).filter((p) => Number.isInteger(p) && p > 0)
  if (!roots.length) return out
  let procs: Proc[]
  try {
    procs = await snapshot()
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
  for (const root of roots) {
    let found: string | null = null
    let frontier = children.get(root) ?? []
    const seen = new Set<number>([root])
    for (let depth = 0; depth < MAX_DEPTH && frontier.length && !found; depth++) {
      const next: Proc[] = []
      for (const p of frontier) {
        if (seen.has(p.pid)) continue
        seen.add(p.pid)
        // command line first (carries script paths / packages); the bare
        // image name covers processes whose command line is unreadable
        found = cliFromCommandLine(p.cmd) ?? cliFromCommandLine(p.name)
        if (found) break
        next.push(...(children.get(p.pid) ?? []))
      }
      frontier = next
    }
    out[root] = found
  }
  return out
}
