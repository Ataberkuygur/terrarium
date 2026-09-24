// ── workspace-resume — grid terminals come back in their CLI session ──
// Orchestration nodes already do this (orchestration.ts, shared/cli-resume);
// this is the same contract for the workspace grid. The detached pty
// supervisor survives an app restart but not a reboot — nor an update,
// whose installer stops every Terrarium.exe, the supervisor included.
// Every terminal leaf remembers the claude/devin session it is running
// (main's pid → session binding, polled) and, when its pty is gone at
// launch, respawns the CLI with its resume flag in the session's dir.
//
// Kept beside the tree (keyed by leaf id) rather than in it: nothing here
// may re-key a pane's pty session, and saved layouts must not carry it.

import { useSyncExternalStore } from 'react'
import { isResumableCli, resumeSpawnCommand, type NodeResume } from '@shared/cli-resume'
import { collectLeaves, commandSessionId, deserializePanes, type PaneLeaf } from './panes'
import { getPty } from './ipc'
import { isShellCommand } from './live-cli'

const STORE_KEY = 'terrarium.paneResume'
const PANES_KEY = 'terrarium.panes'
const BIND_EVERY_MS = 20_000
const RESTORE_TIMEOUT_MS = 10_000

function load(): Map<string, NodeResume> {
  const out = new Map<string, NodeResume>()
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue
      const r = v as Record<string, unknown>
      if (!isResumableCli(typeof r.cli === 'string' ? r.cli : null)) continue
      const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : undefined)
      const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
      out.set(id, {
        cli: r.cli as NodeResume['cli'],
        id: str(r.id),
        pid: num(r.pid),
        since: num(r.since),
        cwd: str(r.cwd),
        active: r.active === true
      })
    }
  } catch {
    /* corrupt — start empty */
  }
  return out
}

const resumes = load()
/** Launch: resumable leaves are being resolved — their terminals hold off spawning. */
let restoring = [...resumes.values()].some((r) => r.active)
let version = 0
const subs = new Set<() => void>()

function notify(): void {
  version++
  subs.forEach((cb) => cb())
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(resumes)))
  } catch {
    /* storage full — next change retries */
  }
}

function same(a: NodeResume | undefined, b: NodeResume | undefined): boolean {
  return (
    a?.cli === b?.cli &&
    a?.id === b?.id &&
    a?.pid === b?.pid &&
    a?.since === b?.since &&
    a?.cwd === b?.cwd &&
    a?.active === b?.active
  )
}

function apply(patch: Map<string, NodeResume | undefined>): void {
  let changed = false
  for (const [id, r] of patch) {
    if (same(resumes.get(id), r)) continue
    if (r) resumes.set(id, r)
    else resumes.delete(id)
    changed = true
  }
  if (!changed) return
  persist()
  notify()
}

/** Grid terminal leaves as last persisted by WorkspaceView. */
function gridLeaves(): PaneLeaf[] | null {
  try {
    const tree = deserializePanes(localStorage.getItem(PANES_KEY))
    return tree ? collectLeaves(tree).filter((l) => l.kind === 'terminal') : []
  } catch {
    return null
  }
}

/** Command a grid terminal spawns with — its CLI session resumed when it has one. */
export function leafSpawnCommand(leaf: PaneLeaf, fallback: string): { command: string; cwd?: string } {
  const base = leaf.command?.trim() || fallback
  const r = resumes.get(leaf.id)
  if (!r?.active || !r.id) return { command: base }
  return {
    command: resumeSpawnCommand(base, isShellCommand(leaf.command), { ...r, id: r.id }),
    cwd: r.cwd
  }
}

/** Re-render hook: the leaf's resume state + whether launch restore is still running. */
export function useLeafResume(leafId: string): { active: boolean; restoring: boolean } {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version
  )
  return { active: resumes.get(leafId)?.active === true, restoring }
}

// ── launch: resolve the sessions of CLIs the supervisor no longer has ──

async function restore(): Promise<void> {
  const pty = getPty()
  const leaves = gridLeaves()
  if (!pty || !leaves) return
  const want = leaves.filter((l) => resumes.get(l.id)?.active)
  if (!want.length) return
  const list = await pty.list()
  const running = new Set(
    list.filter((i) => i.status === 'running' || i.status === 'spawning').map((i) => i.sessionId)
  )
  const resolve = window.terrarium?.resolveCliSession
  const patch = new Map<string, NodeResume | undefined>()
  for (const leaf of want) {
    if (running.has(commandSessionId(leaf))) continue // supervisor kept it — nothing lost
    const r = resumes.get(leaf.id)!
    let { id, cwd } = r
    // the pid names the session the process actually ended in (a /clear
    // or /resume inside it moves on from the recorded id)
    if (resolve && r.pid) {
      const hit = await resolve(r.cli, r.pid, r.since ?? 0).catch(() => null)
      if (hit) {
        id = hit.id
        cwd = hit.cwd ?? cwd
      }
    }
    patch.set(leaf.id, id ? { ...r, id, cwd, pid: undefined } : { ...r, active: false })
  }
  apply(patch)
}

// ── steady state: learn which session each live pane is in ──

let bindBusy = false

async function refresh(): Promise<void> {
  const api = window.terrarium?.cliBindings
  const pty = getPty()
  const leaves = gridLeaves()
  if (!api || !pty || !leaves || bindBusy || restoring) return
  bindBusy = true
  try {
    const list = await pty.list()
    const byId = new Map(list.map((i) => [i.sessionId, i]))
    const patch = new Map<string, NodeResume | undefined>()
    // closed panes forget their session
    const live = new Set(leaves.map((l) => l.id))
    for (const id of resumes.keys()) if (!live.has(id)) patch.set(id, undefined)
    const ask: { leaf: PaneLeaf; pid: number; since: number }[] = []
    for (const leaf of leaves) {
      const info = byId.get(commandSessionId(leaf))
      // unknown to the supervisor (fresh after a reboot) or crashed with
      // it: exactly the case to resume — leave the memory alone
      if (!info || info.status === 'dead') continue
      const prev = resumes.get(leaf.id)
      if (info.status === 'exited') {
        // the CLI ended on its own — don't bring it back uninvited
        if (prev?.active) patch.set(leaf.id, { ...prev, active: false })
        continue
      }
      if (!info.pid) continue
      // devin can't be read live; a CLI-bound one never changes session
      // under the same pid — nothing new to learn
      if (prev?.active && prev.cli === 'devin' && prev.since === info.startedAt && !isShellCommand(leaf.command)) {
        continue
      }
      ask.push({ leaf, pid: info.pid, since: info.startedAt })
    }
    if (ask.length) {
      const got = await api(ask.map((a) => ({ pid: a.pid, since: a.since })))
      for (const { leaf, pid, since } of ask) {
        const b = got?.[pid]
        const prev = resumes.get(leaf.id)
        if (!b) {
          // a shell with no CLI in it right now
          if (prev?.active) patch.set(leaf.id, { ...prev, active: false })
          continue
        }
        const samePid = prev?.cli === b.cli && prev?.pid === b.pid
        patch.set(leaf.id, {
          cli: b.cli,
          id: b.id ?? (samePid ? prev?.id : undefined),
          pid: b.pid,
          since,
          cwd: b.cwd ?? (samePid ? prev?.cwd : undefined) ?? leaf.cwd,
          active: true
        })
      }
    }
    apply(patch)
  } catch {
    /* supervisor/IPC hiccup — next tick */
  } finally {
    bindBusy = false
  }
}

void (async () => {
  try {
    await Promise.race([restore(), new Promise((r) => setTimeout(r, RESTORE_TIMEOUT_MS))])
  } catch {
    /* supervisor unreachable — terminals spawn whatever they're bound to */
  } finally {
    restoring = false
    notify()
  }
  // first pass soon after launch so a pane is covered before the next reboot
  setTimeout(() => void refresh(), 3000)
  setInterval(() => void refresh(), BIND_EVERY_MS)
})()
