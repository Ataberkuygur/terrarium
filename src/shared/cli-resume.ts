// ── cli-resume — which CLI session a terminal is in, and how to reopen it ──
// A laptop sleep/shutdown takes the detached pty supervisor down with it:
// every orchestration node comes back as a fresh CLI with no memory of the
// conversation it was in. Main resolves "pty pid → agent CLI → session id"
// (cli-binding.ts); the renderer persists it per node and, when the node's
// pty is gone, respawns the CLI with its resume flag in the session's dir.

/** CLIs whose running process can be mapped to its session. */
export type ResumableCli = 'claude' | 'devin'

/** Live answer from main for one pty root pid. */
export interface CliBinding {
  cli: ResumableCli
  /** pid of the CLI process itself (the pty root, or a descendant of a shell). */
  pid: number
  /**
   * Session id when readable while running — claude: ~/.claude/sessions/<pid>.json.
   * devin holds its session lock exclusively while alive → null; resolved
   * after the process is gone (resolveCliSession).
   */
  id: string | null
  /** Directory the CLI runs in, when known. */
  cwd: string | null
}

/** Persisted per node. */
export interface NodeResume {
  cli: ResumableCli
  id?: string
  pid?: number
  /** pty start of the process `pid` belongs to (ms) — bounds the devin lock lookup. */
  since?: number
  cwd?: string
  /**
   * The CLI was still running when last seen. A CLI the user exited on
   * purpose is not brought back — only one the machine took down.
   */
  active: boolean
  /**
   * Put to sleep (ms) — Terrarium killed the idle CLI to free its memory.
   * The card holds off respawning until woken (click / tnet send), and
   * then it resumes this session.
   */
  slept?: number
}

export function isResumableCli(cli: string | null | undefined): cli is ResumableCli {
  return cli === 'claude' || cli === 'devin'
}

/** Flags that pick a session — dropped before the resume flag goes on. */
const SESSION_FLAGS_WITH_VALUE = new Set(['--resume', '-r', '--session-id'])
const SESSION_FLAGS = new Set(['--continue', '-c', '--fork-session'])

function stripSessionArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (SESSION_FLAGS.has(a)) continue
    if (SESSION_FLAGS_WITH_VALUE.has(a)) {
      // `--resume` alone opens a picker — only swallow a value that isn't a flag
      if (args[i + 1] && !args[i + 1].startsWith('-')) i++
      continue
    }
    if (/^--(resume|session-id)=/.test(a)) continue
    out.push(a)
  }
  return out
}

const shellBase = (first: string) =>
  first
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '')

/**
 * Command that reopens `resume` for a node bound to `command`.
 * CLI-bound: the node's own command line (flags kept) + `--resume <id>`.
 * Shell-bound (the user typed the CLI): the shell again, running the
 * resume and staying open after it — so the pane is still their shell.
 */
export function resumeSpawnCommand(command: string, shellBound: boolean, r: NodeResume & { id: string }): string {
  const parts = command.trim().split(/\s+/)
  if (!shellBound) return [parts[0], ...stripSessionArgs(parts.slice(1)), '--resume', r.id].join(' ')
  const run = `${r.cli} --resume ${r.id}`
  const base = shellBase(parts[0] ?? '')
  if (base === 'powershell' || base === 'pwsh') return `${parts[0]} -NoExit -Command ${run}`
  if (base === 'cmd') return `${parts[0]} /k ${run}`
  return run
}
