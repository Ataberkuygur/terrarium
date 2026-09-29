// ── pane-folder — the project folder a terminal is pinned to ──────────
// `PaneLeaf.folder` is the user's own assignment: saved with the layout and
// changed by nothing except the folder menu in the pane header. This file
// holds the one write path (setLeafFolder) and the recent-folder memory the
// menu offers.

import { cliName, resumeToken } from '@shared/cli-sessions'
import { getPty } from './ipc'
import { commandSessionId, type PaneAction, type PaneLeaf } from './panes'

const RECENT_KEY = 'terrarium.recentFolders'
const RECENT_MAX = 8

/** Last-picked folders, newest first. */
export function recentFolders(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : []
  } catch {
    return []
  }
}

export function rememberFolder(path: string): void {
  const p = path.trim()
  if (!p) return
  const key = p.toLowerCase()
  const next = [p, ...recentFolders().filter((r) => r.toLowerCase() !== key)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked — the pin itself is saved with the layout anyway */
  }
}

/** Trailing separators off, except a drive root ('C:\\') which needs its own. */
export function cleanFolder(path: string): string {
  const p = path.trim().replace(/^"(.*)"$/, '$1')
  return /^[A-Za-z]:[\\/]*$/.test(p) ? `${p.slice(0, 2)}\\` : p.replace(/[\\/]+$/, '')
}

/** Last path segment — the name shown on the pane's folder chip. */
export function folderName(path: string): string {
  const seg = path.split(/[\\/]/).filter(Boolean)
  return seg.pop() ?? path
}

/**
 * Pin a terminal to `folder` (undefined = back to the project root).
 *
 * The folder is where the process STARTS, so a live pane can only honour it
 * by respawning: the folder is part of the pty session id, and the old pty
 * is retired here. A `--resume <id>` binding is dropped to its bare CLI —
 * that transcript belongs to the previous folder and would not resolve here.
 */
export function setLeafFolder(
  dispatch: ((action: PaneAction) => void) | null,
  leaf: PaneLeaf,
  folder: string | undefined
): void {
  const next = folder?.trim() ? cleanFolder(folder) : undefined
  if ((next ?? '') === (leaf.folder?.trim() ?? '')) return
  const command = resumeToken(leaf.command) ? (cliName(leaf.command) ?? undefined) : leaf.command
  const oldSid = commandSessionId(leaf)
  const newSid = commandSessionId({ ...leaf, command, cwd: undefined, folder: next })
  if (next) rememberFolder(next)
  if (oldSid !== newSid) void getPty()?.kill(oldSid)?.catch(() => {})
  dispatch?.({ type: 'update', leafId: leaf.id, patch: { command, cwd: undefined, folder: next } })
}
