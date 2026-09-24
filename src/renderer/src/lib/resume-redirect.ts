// ── resume-redirect — follow claude's "different directory" bounce ──────
// `claude --resume <id>` (or picking a foreign session in its /resume
// list) from the wrong cwd doesn't resume — claude prints
//
//   This conversation is from a different directory.
//   To resume, run:
//     cd '<dir>' ; claude --resume <id>
//
// and exits. A pane that hits this (a typed resume, a bind without cwd, a
// layout restored from before cwd was tracked) does exactly what the
// message asks for: rebinds to the resume command in the session's own
// dir via claimLeafCommand, the same path the session picker takes.
//
// Only live pty output is scanned (render-leaf's onData — replayed
// scrollback never reaches it), so a bounce still sitting in a restored
// pane's ring can't re-fire after an app restart. And the text alone
// proves nothing — it can scroll past inside a conversation (a pasted
// message, an agent quoting it). The redirect only fires once claude is
// confirmed gone: a CLI-bound pane's pty has exited, a shell pane has no
// claude left under it (main's process-tree probe).

import type { CliSessionEntry } from '@shared/cli-sessions'
import { commandSessionId, type PaneLeaf } from './panes'
import { getPty } from './ipc'
import { isShellCommand } from './live-cli'
import { paneDispatch, paneLeafById } from './pane-bridge'
import { claimLeafCommand } from '../workspace/cli-session-ui'

const MARKER = 'This conversation is from a different directory'
/** Chars of stripped output kept per pty — the bounce is a few short lines. */
const TAIL_MAX = 4096
/** The same leaf+session isn't redirected twice in this window (loop guard). */
const REPEAT_GUARD_MS = 60_000

/** claude takes a beat to exit after printing — confirm at these offsets, then give up. */
const CONFIRM_AT_MS = [800, 2000, 4500]

const tails = new Map<string, string>()
const handled = new Map<string, number>()

// CSI cursor-forward is how ink sometimes renders a gap — keep it a space;
// every other escape (CSI/OSC/charset) is dropped.
const stripAnsi = (s: string): string =>
  s
    .replace(/\x1b\[\d*C/g, ' ')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>78DEHM]/g, '')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * Session id + target dir from a bounce. ink hard-wraps long lines at the
 * pane width (indenting the continuation), which can split the command
 * anywhere — the id is read with all whitespace removed; the dir is only
 * a fallback for when the transcript isn't in the sessions list.
 */
function parseBounce(text: string): { id: string; dir: string | null } | null {
  const at = text.lastIndexOf(MARKER)
  if (at === -1) return null
  const after = text.slice(at + MARKER.length)
  const idm = /claude--resume([0-9a-f-]{36})/i.exec(after.replace(/\s+/g, ''))
  if (!idm || !UUID.test(idm[1])) return null
  // unwrap ink's continuation lines, then: cd '<dir>' | cd "<dir>" | cd <dir>
  const flat = after.replace(/\r?\n[ \t]*/g, '')
  const dm = /\bcd\s+(?:'((?:[^']|'')+)'|"([^"]+)"|(\S+))\s*(?:;|&&)\s*claude\b/.exec(flat)
  const dir = dm ? (dm[1]?.replace(/''/g, "'") ?? dm[2] ?? dm[3] ?? null) : null
  return { id: idm[1].toLowerCase(), dir }
}

async function sessionCwd(id: string, projectRoot: string): Promise<string | null> {
  try {
    const list: CliSessionEntry[] =
      (await window.terrarium?.cliSessions?.('claude', projectRoot)) ?? []
    return list.find((s) => s.id.toLowerCase() === id)?.cwd ?? null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * True once the CLI that printed the bounce has exited. Unknown → false:
 * a missed redirect costs one manual `cd`, a wrong one kills a live chat.
 */
async function cliGone(sid: string, shellBound: boolean): Promise<boolean> {
  const pty = getPty()
  const info = (await pty?.list().catch(() => null))?.find((s) => s.sessionId === sid)
  if (!info) return false
  if (info.status !== 'running') return true
  // a CLI-bound pty that's still running IS the CLI (or its shim)
  if (!shellBound || !info.pid) return false
  const probe = window.terrarium?.cliProcesses
  if (!probe) return false
  try {
    return ((await probe([info.pid]))?.[info.pid] ?? null) === null
  } catch {
    return false
  }
}

/** Feed live pty output for a workspace terminal leaf. Cheap until the marker shows up. */
export function noteResumeBounce(leaf: PaneLeaf, sid: string, data: string, projectRoot: string | undefined): void {
  const prev = tails.get(sid) ?? ''
  const next = (prev + stripAnsi(data)).slice(-TAIL_MAX)
  tails.set(sid, next)
  if (!next.includes(MARKER)) return
  const bounce = parseBounce(next)
  if (!bounce) return // command line not flushed yet — the next chunk retries

  tails.set(sid, '') // consume: one bounce, one redirect
  const key = `${leaf.id}|${bounce.id}`
  const last = handled.get(key) ?? 0
  if (Date.now() - last < REPEAT_GUARD_MS) return
  handled.set(key, Date.now())

  const shellBound = isShellCommand(leaf.command)
  void (async () => {
    let gone = false
    let waited = 0
    for (const at of CONFIRM_AT_MS) {
      await sleep(at - waited)
      waited = at
      if ((gone = await cliGone(sid, shellBound))) break
    }
    if (!gone) {
      handled.delete(key) // not a real bounce — a later one may be
      return
    }
    const dir = (projectRoot && (await sessionCwd(bounce.id, projectRoot))) || bounce.dir
    const dispatch = paneDispatch()
    // re-read: the leaf may have been rebound/closed meanwhile
    const live = paneLeafById(leaf.id)
    if (!dir || !dispatch || live?.kind !== 'terminal' || commandSessionId(live) !== sid) return
    claimLeafCommand(dispatch, live, `claude --resume ${bounce.id}`, dir)
  })()
}
