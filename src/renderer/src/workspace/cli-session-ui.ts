// ── cli-session-ui — shared bits for CLI session history rows ────────────────
// CommandMenu (⌄ dropdown list) and SessionRail (scrollable, filterable
// list under each terminal leaf) both render the same lists — one cache
// keeps it to a single IPC per CLI per TTL window.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { cliName, resumeCommand, resumeToken, type CliSessionEntry } from '@shared/cli-sessions'
import {
  commandSessionId,
  commandSessionKey,
  type PaneAction,
  type PaneLeaf
} from '../lib/panes'
import { getPty } from '../lib/ipc'
import { getAllTerminalLeaves, getWorkspaceTerminalLeaves } from '../lib/terminal-agents'
import { paneDispatch } from '../lib/pane-bridge'
import { leafRunningSession } from '../lib/workspace-resume'
import { categoryForSession } from '../lib/categories'
import { useApp } from '../lib/store'

// lives in shared/cli-sessions now — re-exported so existing imports hold
export { resumeToken }

const TTL_MS = 20_000
const cache = new Map<string, { at: number; list: CliSessionEntry[] }>()

// Fresh lists fetched elsewhere (lib/live-cli matching a pane to the
// session it's writing) land here too — every mounted list re-reads.
let cacheVersion = 0
const cacheSubs = new Set<() => void>()
const subscribeCache = (cb: () => void) => {
  cacheSubs.add(cb)
  return () => cacheSubs.delete(cb)
}

/** Seed the per-CLI cache with a just-fetched list and refresh open lists. */
export function primeCliSessions(cli: string, list: CliSessionEntry[]): void {
  cache.set(cli, { at: Date.now(), list })
  cacheVersion++
  cacheSubs.forEach((cb) => cb())
}

/** Compact relative time: now → 5m → 9h → 12d → date. */
export function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(ms).toLocaleDateString()
}

/** '5m' for same-project sessions, '5m · lumiere' for foreign-cwd ones. */
export function sessionDetail(s: CliSessionEntry, projectRoot: string | undefined): string {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase()
  const dir = s.cwd?.split(/[\\/]/).filter(Boolean).pop()
  const foreign = !!s.cwd && !!projectRoot && norm(s.cwd) !== norm(projectRoot)
  return foreign && dir ? `${ago(s.at)} · ${dir}` : ago(s.at)
}

/**
 * Live filter for the rail's search box — case-insensitive, every word must
 * hit somewhere in: title (what `claude --resume` lists), first prompt, cwd
 * or id. Turkish-aware lowercasing, so "İ"/"ı" match as typed.
 */
export function sessionMatches(s: CliSessionEntry, q: string): boolean {
  const words = q.trim().toLocaleLowerCase('tr').split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [s.summary, s.prompt, s.cwd, s.id]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase('tr')
  return words.every((w) => hay.includes(w))
}

/** Past sessions for a resumable CLI — null while loading or not applicable. */
export function useCliSessions(cli: string | null): CliSessionEntry[] | null {
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  const [list, setList] = useState<CliSessionEntry[] | null>(null)
  const version = useSyncExternalStore(subscribeCache, () => cacheVersion)
  useEffect(() => {
    if (!cli || !projectRoot) {
      setList(null)
      return
    }
    const hit = cache.get(cli)
    if (hit && Date.now() - hit.at < TTL_MS) {
      setList(hit.list)
      return
    }
    let alive = true
    // `?.()` yields undefined where the preload isn't bridged (browser
    // mock) — coalesce before .then so it never throws.
    void (window.terrarium?.cliSessions?.(cli, projectRoot) ?? Promise.resolve([]))
      .then((l) => {
        cache.set(cli, { at: Date.now(), list: l })
        if (alive) setList(l)
      })
      .catch(() => {
        if (alive) setList([])
      })
    return () => {
      alive = false
    }
  }, [cli, projectRoot, version])
  return list
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Rebind a leaf to `command`/`cwd`, retiring its old pty — and when the
 * command resumes a CLI session, take ownership of the transcript first:
 * a CLI session can only be open in one process, so every OTHER holder is
 * evicted — a sibling grid leaf still RUNNING that session is unbound+killed,
 * and orphan supervisor sessions still running it (panes closed before
 * kill-on-close existed) are reaped. Without this the new pane's CLI dies
 * on the transcript lock ('session is locked') while the session keeps
 * running in whatever terminal held it before.
 *
 * Only the picked pane may change otherwise. A binding's `--resume <id>`
 * is just what the pane was launched with — its CLI may have moved on
 * since (/resume, /clear, a restore into its latest session) — so a
 * sibling is judged by the session it is known to run now, and a live
 * pane's pty is never taken for an orphan.
 */
export function claimLeafCommand(
  dispatch: ((action: PaneAction) => void) | null,
  leaf: PaneLeaf,
  command: string,
  cwd: string | undefined
): void {
  const cli = cliName(command)
  const token = resumeToken(command)
  const cmd = command.trim()
  const oldSid = commandSessionId(leaf)
  const newSid = commandSessionId({ ...leaf, command: cmd, cwd })
  const pty = getPty()
  void (async () => {
    const kills: Promise<unknown>[] = []
    const kill = (sid: string) => {
      kills.push(pty?.kill(sid)?.catch(() => {}) ?? Promise.resolve())
    }

    if (cli && token) {
      // A sibling grid leaf running this session loses it — the binding
      // moves to the pane the user picked (their pty dies with the unbind).
      // Grid leaves go through the grid's own dispatch: `dispatch` is the
      // orchestration store's when the pick came from a network node.
      const grid = paneDispatch()
      for (const l of grid ? getWorkspaceTerminalLeaves() : []) {
        if (l.id === leaf.id) continue
        if (cliName(l.command) !== cli) continue
        if (leafRunningSession(l, resumeToken(l.command)) !== token) continue
        grid?.({
          type: 'update',
          leafId: l.id,
          patch: { command: undefined, cwd: undefined }
        })
        kill(commandSessionId(l))
      }
      // every pty a pane or network node is showing right now
      const owned = new Set(getAllTerminalLeaves().map((l) => l.id))

      // Orphaned supervisor sessions running this same resume — no leaf
      // claims them, but they still hold the session lock. The sid suffix
      // is the command|cwd hash of the leaf's binding, so `*:hash(cmd|cwd)`
      // identifies them without args being exposed in `list()`. Two forms:
      // the session's own spawn cwd, and '' for leaves bound with no cwd
      // (their pty spawned into the project-root fallback).
      const list = (await pty?.list?.().catch(() => null)) ?? null
      for (const s of list ?? []) {
        if (s.status !== 'running' && s.status !== 'spawning') continue
        if (s.sessionId === newSid) continue // leaf's target sid — adopted, not killed
        if (s.sessionId === oldSid) continue // killed below
        if (owned.has(s.sessionId.split(':')[0])) continue // a live pane's, not an orphan
        if (cliName(s.command) !== cli) continue
        const match = [s.cwd, undefined].some(
          (c) => s.sessionId.endsWith(`:${commandSessionKey(cmd, c)}`)
        )
        if (match) kill(s.sessionId)
      }
    }

    if (oldSid !== newSid) kill(oldSid)
    await Promise.allSettled(kills)
    // ConPTY teardown is async — give the CLI a beat to release its
    // transcript lock before the respawn asks for it.
    if (kills.length) await sleep(150)
    dispatch?.({
      type: 'update',
      leafId: leaf.id,
      patch: { command: cmd, cwd }
    })
  })()
}

/** Swap a leaf onto a session's resume command + original cwd. */
export function resumeLeafSession(
  dispatch: ((action: PaneAction) => void) | null,
  leaf: PaneLeaf,
  cli: string,
  entry: CliSessionEntry
): void {
  const cmd = resumeCommand(cli, entry.id)
  if (!cmd) return
  claimLeafCommand(dispatch, leaf, cmd, entry.cwd ?? undefined)
  // a session previously filed under a category lands back there — the
  // memory is keyed "<cli>:<sessionId>" (see lib/categories.ts)
  const category = categoryForSession(cli, entry.id)
  if (category) dispatch?.({ type: 'update', leafId: leaf.id, patch: { category } })
}
