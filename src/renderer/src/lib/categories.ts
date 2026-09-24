// ── categories — user-named pane groupings, hidden set, session memory ──────
// The session rail groups leaves by their bound agent's domain (or the
// classified work area for unbound terminals). A leaf can instead be filed
// under a user-created category (leaf.category): those groups sort ahead of
// the domain sections, and any group — custom or built-in — can be hidden
// from the pane grid with the rail's eye toggle. Three localStorage keys:
//   terrarium.categories         ordered registry of created names — the
//                                rail's custom-group order
//   terrarium.categories.hidden  group keys currently hidden (custom names
//                                AND built-in keys: 'frontend', 'panes', …)
//   terrarium.sessionCategory    "<cli>:<sessionId>" → category, so resuming
//                                a past CLI session re-files its pane
// The reactive copies live in the zustand store; this module is the
// persistence layer — pure, no React.

import { cliName, resumeToken } from '@shared/cli-sessions'
import { isAgentDomain, type PaneLeaf } from './panes'

export const CATEGORIES_KEY = 'terrarium.categories'
export const CATEGORIES_HIDDEN_KEY = 'terrarium.categories.hidden'
export const SESSION_CATEGORY_KEY = 'terrarium.sessionCategory'

// ── string-list storage ─────────────────────────────────────────────────────

/** Reads a JSON string array, dropping blanks and case-insensitive dupes. */
function readStringList(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const v of parsed) {
      if (typeof v !== 'string' || !v.trim()) continue
      const k = v.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(v.trim())
    }
    return out
  } catch {
    return [] // storage unavailable / corrupt — non-fatal
  }
}

function writeStringList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

// ── registry ────────────────────────────────────────────────────────────────

/** The ordered registry of user-created category names. */
export function listCategories(): string[] {
  return readStringList(CATEGORIES_KEY)
}

/** Replaces the registry wholesale; persists as given. */
export function saveCategories(list: string[]): void {
  writeStringList(CATEGORIES_KEY, list)
}

/**
 * Registers `name` (trimmed) at the END of the registry — creation order is
 * the rail's custom-group order. Dedupes case-insensitively. Returns the list.
 */
export function addCategory(name: string): string[] {
  const list = listCategories()
  const key = name.trim()
  if (!key || list.some((c) => c.toLowerCase() === key.toLowerCase())) return list
  const next = [...list, key]
  saveCategories(next)
  return next
}

/**
 * Drops `name` from the registry, the hidden set, and the session memory
 * (leaves keep their tag — the group just sorts with the unknowns). Returns
 * the registry list.
 */
export function removeCategory(name: string): string[] {
  const key = name.trim().toLowerCase()
  const next = listCategories().filter((c) => c.toLowerCase() !== key)
  saveCategories(next)
  writeStringList(
    CATEGORIES_HIDDEN_KEY,
    listHidden().filter((c) => c.toLowerCase() !== key)
  )
  const map = readSessionMap()
  let touched = false
  for (const k of Object.keys(map)) {
    if (map[k].toLowerCase() === key) {
      delete map[k]
      touched = true
    }
  }
  if (touched) writeSessionMap(map)
  return next
}

// ── hidden set ──────────────────────────────────────────────────────────────

/** Group keys currently hidden from the pane grid. */
export function listHidden(): string[] {
  return readStringList(CATEGORIES_HIDDEN_KEY)
}

/** Adds or drops `name` in the hidden set; returns the persisted list. */
export function setHidden(name: string, hidden: boolean): string[] {
  const key = name.trim()
  if (!key) return listHidden()
  const list = listHidden()
  const has = list.some((c) => c.toLowerCase() === key.toLowerCase())
  if (has === hidden) return list
  const next = hidden
    ? [...list, key]
    : list.filter((c) => c.toLowerCase() !== key.toLowerCase())
  writeStringList(CATEGORIES_HIDDEN_KEY, next)
  return next
}

// ── session memory ──────────────────────────────────────────────────────────

function readSessionMap(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SESSION_CATEGORY_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeSessionMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(SESSION_CATEGORY_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Key shape for the session→category memory: "<cli>:<sessionId>". */
export function sessionCatKey(cli: string, sessionId: string): string {
  return `${cli}:${sessionId}`
}

// lib/live-cli registers this (it imports us — the reverse import would
// close a cycle through the store): a shell leaf's hand-started CLI session.
let liveSessionResolver:
  | ((leaf: PaneLeaf) => { cli: string; sessionId: string | null } | null)
  | null = null

export function setLiveSessionResolver(fn: typeof liveSessionResolver): void {
  liveSessionResolver = fn
}

/**
 * Files the CLI session a leaf is bound to under `category`. Needs both a
 * CLI executable and a resume token in leaf.command — a plain shell has no
 * session to remember, so it's a no-op. Blank/undefined deletes the entry.
 */
export function rememberSessionCategory(leaf: PaneLeaf, category: string | undefined): void {
  let cli = cliName(leaf.command)
  let token = resumeToken(leaf.command)
  // a CLI the user started/resumed by hand inside a shell pane (lib/live-cli)
  const live = liveSessionResolver?.(leaf)
  if (live) {
    cli = live.cli
    token = live.sessionId
  }
  if (!cli || !token) return
  const map = readSessionMap()
  const key = sessionCatKey(cli, token)
  const name = category?.trim()
  if (name) map[key] = name
  else if (!(key in map)) return
  else delete map[key]
  writeSessionMap(map)
}

/** The category a past CLI session was filed under, if any. */
export function categoryForSession(cli: string, sessionId: string): string | undefined {
  return readSessionMap()[sessionCatKey(cli, sessionId)]
}

// ── rail grouping ───────────────────────────────────────────────────────────

/**
 * The session-rail group a leaf belongs to — the single source for both the
 * rail's grouping and the workspace's hidden-pane filter:
 *   1. leaf.category (user filing wins)
 *   2. bound agent's domain — 'general' when the agent is gone or stale
 *   3. an unbound terminal's classified work area
 *   4. 'panes' for everything else
 * `agentDomain` is the resolved domain of leaf.agentId's agent.
 */
export function groupKeyForLeaf(leaf: PaneLeaf, agentDomain?: string): string {
  const cat = leaf.category?.trim()
  if (cat) return cat
  if (leaf.agentId) return agentDomain && isAgentDomain(agentDomain) ? agentDomain : 'general'
  return leaf.kind === 'terminal' && leaf.domain && isAgentDomain(leaf.domain)
    ? leaf.domain
    : 'panes'
}
