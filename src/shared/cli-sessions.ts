// ── CLI session history — shared contract ────────────────────────────
// Agent CLIs keep per-project session transcripts on disk
// (~/.claude/projects, ~/.codex/sessions). The terminal pane's command
// dropdown lists them so a pane can jump straight back into an earlier
// session — the resume command replaces leaf.command, which re-keys the
// pty session and spawns the CLI with the resume flag.

export interface CliSessionEntry {
  /** Resume token — claude: session uuid (transcript basename); codex: rollout id. */
  id: string
  /** Last activity, ms epoch (transcript mtime / rollout timestamp). */
  at: number
  /** First user prompt / summary line when recoverable — may be null. */
  summary: string | null
  /**
   * Directory the session was created in — resume spawns the CLI here
   * (claude `--resume` only resolves transcripts under their own project
   * dir). Null = unknown → the pane's default cwd is fine.
   */
  cwd: string | null
}

/** Executable basename → resume-command builder. Unlisted CLIs have no history to show. */
const RESUMABLE: Record<string, (sessionId: string) => string> = {
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  devin: (id) => `devin --resume ${id}`,
  'cursor-agent': (id) => `cursor-agent --resume ${id}`,
  muse: (id) => `muse resume ${id}`,
  opencode: (id) => `opencode --session ${id}`,
  qoder: (id) => `qoder --resume ${id}`,
  qodercli: (id) => `qodercli --resume ${id}`
}

/** First token of a bound command, normalized: strips path segments and .exe/.cmd/.bat. */
export function cliName(command: string | undefined): string | null {
  const first = command?.trim().split(/\s+/)[0]
  if (!first) return null
  const base = (first.split(/[\\/]/).pop() ?? first).replace(/\.(exe|cmd|bat)$/i, '')
  return base.toLowerCase() || null
}

/** True when the bound command's executable has a resumable session store. */
export function isResumableCli(cli: string | null): boolean {
  return !!cli && cli in RESUMABLE
}

/** '--resume <id>' / 'resume <id>' / '--session <id>' token of a bound command, if any. */
export function resumeToken(command: string | undefined): string | null {
  const parts = command?.trim().split(/\s+/) ?? []
  const i = parts.findIndex((p) => p === '--resume' || p === 'resume' || p === '--session')
  const tok = i === -1 ? undefined : parts[i + 1]
  return tok && !tok.startsWith('-') ? tok : null
}

/** The command string that reopens a past session in a fresh pty. */
export function resumeCommand(cli: string, sessionId: string): string | null {
  return RESUMABLE[cli]?.(sessionId) ?? null
}
