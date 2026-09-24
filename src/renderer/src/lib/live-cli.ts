// ── live-cli — which agent CLI a terminal pane is running *right now* ──
// leaf.command only says what the pane was launched with. A pane bound to
// powershell may be running `claude --resume x` the user typed, `codex
// resume`, `devin`… This module keeps a per-pty-session answer, plus the
// CLI session (transcript) that run is writing to, so the brand mark, the
// Sessions rail and the pane's session dropdown follow what's on screen.
//
// Signals, cheapest first — all event-driven, nothing polls:
//   1. Screen (live xterm buffer via terminal-classify's reader): the
//      command echoed after the last shell prompt ('PS C:\x> claude -c')
//      is the strongest hint; a bare prompt at the bottom means the CLI
//      exited; banner/status signatures cover alt-screen TUIs and custom
//      prompts.
//   2. Window title (OSC 0/2) — only when set after the last prompt seen
//      (shells don't reset it when a CLI exits).
//   3. Process tree (main 'cli:processes'): authoritative, but a WMI query
//      — asked only when the screen answer changes / a new command is
//      echoed, ≥2s apart per pane, plus a slow confirm when the screen
//      gives no evidence either way.
// Evaluation runs on pty output / title changes (debounced, ≥2s apart), so
// an idle pane costs nothing.
//
// Session match: newest transcript for that CLI + cwd with activity after
// the run was detected (resume appends to the old transcript, so its mtime
// moves too); an echoed `--resume <id>` names it outright, `-c/--continue`
// takes the newest in the cwd.

import { useSyncExternalStore } from 'react'
import { cliFromCommandLine, cliFromScreen } from '@shared/cli-detect'
import { cliName, isResumableCli, resumeToken, type CliSessionEntry } from '@shared/cli-sessions'
import { commandSessionId, type PaneLeaf } from './panes'
import { getPty } from './ipc'
import { useApp } from './store'
import { onScrollbackReaderRegistered, readLiveScreen } from './terminal-classify'
import { getAllTerminalLeaves } from './terminal-agents'
import { primeCliSessions } from '../workspace/cli-session-ui'
import { setLiveSessionResolver } from './categories'

export interface LiveCli {
  /** Canonical CLI id (shared/cli-detect) — 'claude', 'codex', 'cursor-agent'… */
  cli: string
  /** When this run was first seen, ms epoch. */
  since: number
  /** Directory the CLI was started in (from the prompt), when known. */
  cwd: string | null
  /** Transcript id this run is writing to, once matched. */
  sessionId: string | null
  /** Echoed resume target: a session id, 'continue', or null. */
  hint: string | null
}

interface Watch {
  sid: string
  /** Bound to a shell (or nothing) → detection runs; else the bound CLI is the answer. */
  shellBound: boolean
  boundCli: string | null
  boundToken: string | null
  defaultCwd: string
  live: LiveCli | null
  title: string
  titleAt: number
  shellAt: number
  lastEcho: { line: string; cmd: string; cwd: string | null } | null
  evalTimer?: ReturnType<typeof setTimeout>
  lastEval: number
  probeAt: number
  probeTimer?: ReturnType<typeof setTimeout>
  probeRetries: number
  /** Last CLI the process tree reported (null = none / not asked). */
  probeSaw: string | null
  sessionAt: number
  sessionBusy: boolean
  sessionTimer?: ReturnType<typeof setTimeout>
}

const EVAL_DEBOUNCE_MS = 700
const EVAL_MIN_GAP_MS = 2000
const PROBE_MIN_GAP_MS = 2500
const PROBE_RETRY_MS = 3000
/** Confirm a sticky (evidence-free) answer with the process tree at most this often. */
const PROBE_CONFIRM_MS = 20_000
const SESSION_SEEK_MS = 8000
const SESSION_REFRESH_MS = 30_000
/** Transcript activity this long before detection still counts as this run's. */
const SESSION_GRACE_MS = 5000

const watches = new Map<string, Watch>()

// ── subscription ─────────────────────────────────────────────────────
let version = 0
const subs = new Set<() => void>()
function notify(): void {
  version++
  subs.forEach((cb) => cb())
}
function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

// ── helpers ──────────────────────────────────────────────────────────

const SHELL_RE = /^(powershell|pwsh|cmd|bash|sh|zsh|fish|nu|wsl)$/

/** True for an unbound pane or one bound to a plain shell. */
export function isShellCommand(command: string | undefined): boolean {
  const first = command?.trim().split(/\s+/)[0]
  if (!first) return true
  const base = first
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '')
  return SHELL_RE.test(base)
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Prompt forms whose line carries the cwd and the typed command. */
const PROMPTS: RegExp[] = [
  /^PS ([^>]*)>\s?(.*)$/, // PowerShell: 'PS C:\x> cmd'
  /^([A-Za-z]:\\[^>]*)>\s?(.*)$/, // cmd.exe: 'C:\x>cmd'
  /^(?:\([^)]*\)\s*)?\S+@\S+?:\s*([^$#%]*?)\s*[$#%]\s?(.*)$/, // user@host:~/x$ cmd
  /^()[$#%]\s?(.*)$/ // bare '$ cmd'
]

function parsePrompt(line: string): { cwd: string | null; cmd: string } | null {
  for (const re of PROMPTS) {
    const m = re.exec(line.trimEnd())
    if (!m) continue
    const dir = m[1]?.trim() ?? ''
    // only absolute dirs are usable for the session match ('~/x' is not)
    const cwd = /^([A-Za-z]:[\\/]|\/)/.test(dir) ? dir : null
    return { cwd, cmd: (m[2] ?? '').trim() }
  }
  return null
}

/** Resume target named on a CLI command line. */
function hintFrom(cmd: string | undefined): string | null {
  if (!cmd) return null
  const tok = resumeToken(cmd)
  if (tok) return tok
  if (/\s(-c|--continue|--last)\b/.test(` ${cmd}`) || /\bresume\s+--last\b/.test(cmd)) {
    return 'continue'
  }
  return null
}

/** Claude Code titles its window '✳ <task>' / spinner glyph + task. */
const CLAUDE_TITLE = /^[✳✶✻✽✢✺·⠁-⣿]\s/

function titleCli(title: string): string | null {
  if (!title.trim()) return null
  if (CLAUDE_TITLE.test(title)) return 'claude'
  // cmd.exe titles running programs 'cmd - claude --resume x'
  return cliFromScreen(title) ?? cliFromCommandLine(title.replace(/^.*?\s-\s/, ''))
}

function defaultCwd(): string {
  return useApp.getState().projects[0]?.rootPath ?? ''
}

function ensureWatch(sid: string, leaf?: PaneLeaf): Watch | null {
  let w = watches.get(sid)
  if (!leaf && !w) {
    leaf = getAllTerminalLeaves().find((l) => commandSessionId(l) === sid)
    if (!leaf) return null
  }
  if (!w) {
    w = {
      sid,
      shellBound: true,
      boundCli: null,
      boundToken: null,
      defaultCwd: '',
      live: null,
      title: '',
      titleAt: 0,
      shellAt: 0,
      lastEcho: null,
      lastEval: 0,
      probeAt: 0,
      probeRetries: 0,
      probeSaw: null,
      sessionAt: 0,
      sessionBusy: false
    }
    watches.set(sid, w)
  }
  if (leaf) {
    w.shellBound = isShellCommand(leaf.command)
    w.boundCli = w.shellBound ? null : cliName(leaf.command)
    w.boundToken = w.shellBound ? null : resumeToken(leaf.command)
    w.defaultCwd = leaf.cwd?.trim() || defaultCwd()
    if (!w.shellBound && w.boundCli && !w.live) {
      // launched straight into a CLI — the answer is fixed; only the
      // session it writes to is left to find
      w.live = {
        cli: w.boundCli,
        since: Date.now(),
        cwd: w.defaultCwd || null,
        sessionId: w.boundToken,
        hint: hintFrom(leaf.command)
      }
      notify()
      if (isResumableCli(w.boundCli)) scheduleSessionCheck(w, 1500)
    }
  }
  return w
}

// ── evaluation ───────────────────────────────────────────────────────

function scheduleEval(w: Watch, delay = EVAL_DEBOUNCE_MS): void {
  if (w.evalTimer) return
  const gap = EVAL_MIN_GAP_MS - (Date.now() - w.lastEval)
  w.evalTimer = setTimeout(() => {
    w.evalTimer = undefined
    if (watches.get(w.sid) === w) evaluate(w)
  }, Math.max(delay, gap))
}

function setLive(w: Watch, cli: string | null): void {
  const cur = w.live?.cli ?? null
  if (cli === cur) return
  if (!cli) {
    w.live = null
  } else {
    const echoed = w.lastEcho && cliFromCommandLine(w.lastEcho.cmd) === cli ? w.lastEcho : null
    w.live = {
      cli,
      since: Date.now(),
      cwd: echoed?.cwd ?? w.lastEcho?.cwd ?? (w.defaultCwd || null),
      sessionId: null,
      hint: hintFrom(echoed?.cmd)
    }
    if (isResumableCli(cli)) scheduleSessionCheck(w, 1500)
  }
  notify()
}

function evaluate(w: Watch): void {
  w.lastEval = Date.now()
  if (!w.shellBound) {
    scheduleSessionCheck(w)
    return
  }
  const screen = readLiveScreen(w.sid)
  if (screen == null) {
    // pane not mounted — only the process tree can tell
    if (w.live) requestProbe(w, w.live.cli, false)
    return
  }
  const lines = screen.split('\n').slice(-80)
  let p = -1
  let parsed: ReturnType<typeof parsePrompt> = null
  for (let i = lines.length - 1; i >= 0; i--) {
    parsed = parsePrompt(lines[i])
    if (parsed) {
      p = i
      break
    }
  }
  const now = Date.now()
  const freshTitle = w.titleAt > w.shellAt ? titleCli(w.title) : null
  let candidate: string | null
  let strong = false
  let evidence = true
  let echoChanged = false

  if (p !== -1 && p === lines.length - 1) {
    // prompt is the bottom line: idle shell (or the user is still typing)
    w.shellAt = now
    candidate = null
    strong = true
  } else if (p !== -1 && parsed) {
    const echo = { line: lines[p], cmd: parsed.cmd, cwd: parsed.cwd }
    echoChanged = echo.line !== w.lastEcho?.line
    w.lastEcho = echo
    const echoed = cliFromCommandLine(parsed.cmd)
    if (echoed) {
      candidate = echoed
      strong = true
    } else {
      // some other program (or an alias) — look only at what it printed
      // the same echo as before keeps the current answer (it may have come
      // from the process tree, which the screen can't see)
      const seen = freshTitle ?? cliFromScreen(lines.slice(p + 1).join('\n'))
      candidate = seen ?? (echoChanged ? null : (w.live?.cli ?? null))
      evidence = seen !== null || !w.live
    }
  } else {
    // no prompt on screen: alt-screen TUI, long CLI transcript, or a
    // prompt style we don't parse — sticky unless something names a CLI
    const seen = freshTitle ?? cliFromScreen(lines.join('\n'))
    candidate = seen ?? w.live?.cli ?? null
    evidence = seen !== null
  }

  const cur = w.live?.cli ?? null
  // the process tree just said otherwise — don't flip-flop on a prompt
  // look-alike inside a CLI's own output
  if (candidate === null && cur && w.probeSaw === cur && now - w.probeAt < 10_000) {
    candidate = cur
  }
  if (candidate !== cur) {
    setLive(w, candidate)
    requestProbe(w, candidate, strong)
  } else if (echoChanged) {
    requestProbe(w, candidate, strong)
  } else if (cur && !evidence && now - w.probeAt > PROBE_CONFIRM_MS) {
    requestProbe(w, candidate, false)
  }
  if (w.live && isResumableCli(w.live.cli)) scheduleSessionCheck(w)
}

// ── process-tree probe ───────────────────────────────────────────────

let listCache: { at: number; pids: Map<string, number | null> } | null = null

/** Running pty sessions (sid → pid), 2s cache. Watches whose pty is gone
 *  (pane closed, or rebound to a resume command — new sid) are dropped so
 *  they stop claiming their transcript. */
async function runningPtys(): Promise<Map<string, number | null> | null> {
  if (!listCache || Date.now() - listCache.at > 2000) {
    const list = await getPty()?.list?.().catch(() => null)
    if (!list) return listCache?.pids ?? null
    listCache = {
      at: Date.now(),
      pids: new Map(
        list
          .filter((s) => s.status === 'running' || s.status === 'spawning')
          .map((s) => [s.sessionId, s.pid])
      )
    }
    for (const [sid, w] of watches) {
      if (listCache.pids.has(sid) || w.lastEval > Date.now() - 10_000) continue
      clearTimeout(w.evalTimer)
      clearTimeout(w.probeTimer)
      clearTimeout(w.sessionTimer)
      watches.delete(sid)
    }
  }
  return listCache.pids
}

async function ptyPid(sid: string): Promise<number | null> {
  return (await runningPtys())?.get(sid) ?? null
}

function requestProbe(w: Watch, heuristic: string | null, strong: boolean): void {
  const api = window.terrarium?.cliProcesses
  if (!api) return // main/preload predates 'cli:processes' — screen answer stands
  clearTimeout(w.probeTimer)
  const wait = Math.max(0, PROBE_MIN_GAP_MS - (Date.now() - w.probeAt))
  w.probeTimer = setTimeout(() => {
    w.probeTimer = undefined
    void runProbe(w, api, heuristic, strong)
  }, wait)
}

async function runProbe(
  w: Watch,
  api: NonNullable<NonNullable<Window['terrarium']>['cliProcesses']>,
  heuristic: string | null,
  strong: boolean
): Promise<void> {
  w.probeAt = Date.now()
  const pid = await ptyPid(w.sid)
  if (!pid || watches.get(w.sid) !== w) return
  let found: string | null
  try {
    found = (await api([pid]))?.[pid] ?? null
  } catch {
    return // probe failed — keep the screen's answer
  }
  if (watches.get(w.sid) !== w) return
  w.probeSaw = found
  if (found) {
    w.probeRetries = 0
    setLive(w, found)
    return
  }
  if (heuristic && w.probeRetries < 2) {
    // the CLI may still be booting behind an npm shim — look again
    w.probeRetries++
    w.probeTimer = setTimeout(() => {
      w.probeTimer = undefined
      void runProbe(w, api, heuristic, strong)
    }, PROBE_RETRY_MS)
    return
  }
  w.probeRetries = 0
  // nothing under the shell: a banner/title guess was wrong or the CLI is
  // gone. A command the user visibly typed (strong) is left standing —
  // the probe can miss launchers like wsl.
  if (!strong) setLive(w, null)
}

// ── session match ────────────────────────────────────────────────────

function scheduleSessionCheck(w: Watch, delay?: number): void {
  if (!w.live || !isResumableCli(w.live.cli) || w.sessionTimer || w.sessionBusy) return
  if (delay === undefined) {
    // throttled path (output events): seek often until matched, then only
    // refresh occasionally (a /clear or new chat starts another transcript)
    const every = w.live.sessionId ? SESSION_REFRESH_MS : SESSION_SEEK_MS
    if (Date.now() - w.sessionAt < every) return
    delay = 0
  }
  w.sessionTimer = setTimeout(() => {
    w.sessionTimer = undefined
    void checkSession(w)
  }, delay)
}

async function checkSession(w: Watch): Promise<void> {
  const live = w.live
  const list = window.terrarium?.cliSessions
  if (!live || !list || !isResumableCli(live.cli)) return
  w.sessionBusy = true
  w.sessionAt = Date.now()
  await runningPtys() // prune dead watches before judging who owns what
  let entries: CliSessionEntry[] = []
  try {
    entries = (await list(live.cli, live.cwd || w.defaultCwd || defaultCwd())) ?? []
  } catch {
    entries = []
  } finally {
    w.sessionBusy = false
  }
  primeCliSessions(live.cli, entries)
  if (w.live !== live) return // CLI changed while we were reading

  // transcripts other panes already own are not ours
  const claimed = new Set<string>()
  for (const o of watches.values()) {
    if (o !== w && o.live?.cli === live.cli && o.live.sessionId) claimed.add(o.live.sessionId)
  }
  const cwd = live.cwd ? normPath(live.cwd) : null
  const inCwd = (e: CliSessionEntry) => !cwd || !e.cwd || normPath(e.cwd) === cwd
  let next = live.sessionId

  if (live.hint && live.hint !== 'continue' && !next) {
    const h = live.hint
    next = entries.find((e) => e.id === h || e.id.startsWith(h))?.id ?? h
  }
  const fresh = entries
    .filter((e) => e.at >= live.since - SESSION_GRACE_MS && inCwd(e) && !claimed.has(e.id))
    .sort((a, b) => b.at - a.at)[0]
  if (fresh) next = fresh.id
  else if (!next && live.hint === 'continue') {
    next = entries.filter((e) => inCwd(e) && !claimed.has(e.id)).sort((a, b) => b.at - a.at)[0]?.id ?? null
  }

  if (next !== live.sessionId) {
    w.live = { ...live, sessionId: next }
    notify()
  }
}

// ── inputs (render-leaf) ─────────────────────────────────────────────

/** Pty output on a workspace terminal — the pane's screen may have changed. */
export function noteTerminalOutput(leaf: PaneLeaf, sid: string): void {
  const w = ensureWatch(sid, leaf)
  if (w) scheduleEval(w)
}

/** OSC 0/2 window title from a workspace terminal. */
export function noteTerminalTitle(sid: string, title: string): void {
  const w = ensureWatch(sid)
  if (!w) return
  w.title = title
  w.titleAt = Date.now()
  scheduleEval(w, 300)
}

// first look when a pane mounts (restart / re-attach): the replayed
// screen may already show a CLI that won't print again until spoken to
onScrollbackReaderRegistered((sid) => {
  setTimeout(() => {
    const w = ensureWatch(sid)
    if (w) scheduleEval(w, 0)
  }, 1500)
})

// category memory ('<cli>:<sessionId>' → category) for hand-started runs
setLiveSessionResolver((leaf) => {
  if (leaf.kind !== 'terminal' || !isShellCommand(leaf.command)) return null
  return watches.get(commandSessionId(leaf))?.live ?? null
})

// ── queries ──────────────────────────────────────────────────────────

/** The live CLI run in a pty session, if any (non-reactive). */
export function liveCliForSid(sid: string): LiveCli | null {
  return watches.get(sid)?.live ?? null
}

/** Reactive live-CLI state for a leaf's current pty session. */
export function useLiveCli(leaf: PaneLeaf): LiveCli | null {
  const sid = leaf.kind === 'terminal' ? commandSessionId(leaf) : ''
  useSyncExternalStore(subscribe, () => version)
  return sid ? liveCliForSid(sid) : null
}

/**
 * The CLI a terminal leaf is running: a CLI-bound leaf → its bound
 * executable; a shell leaf → whatever was detected in it (null = shell).
 */
export function effectiveCli(leaf: PaneLeaf, live: LiveCli | null): string | null {
  if (!isShellCommand(leaf.command)) return cliName(leaf.command)
  return live?.cli ?? null
}

/**
 * A command string for brand lookups (components/CliBrand): the bound
 * command, or the detected CLI for shell panes.
 */
export function effectiveBrandCommand(leaf: PaneLeaf, live: LiveCli | null): string | undefined {
  if (!isShellCommand(leaf.command)) return leaf.command
  return live?.cli ?? leaf.command
}
