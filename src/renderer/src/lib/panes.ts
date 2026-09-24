/**
 * panes.ts — binary-split pane tree for the Workspace view.
 *
 * Pure TypeScript: no React, no DOM, no side effects. Every op returns a new
 * tree (structurally shared — untouched subtrees keep their reference) and
 * never mutates, so the whole module is unit-testable and safe to drive from
 * useReducer, zustand, or a plain reducer in the host app.
 *
 * Tree shape:
 *   leaf  — { type:'leaf', id, kind, refId, title?, dirty?, attention? }
 *   split — { type:'split', id, dir, ratio, a, b }   (a gets `ratio`, b the rest)
 */

import type { AgentDomain } from '@shared/types'
import { isAutoTerminalTitle, latinNameForId } from './latin-names'

// ── types ────────────────────────────────────────────────────────────────────

export type PaneKind = 'terminal' | 'file' | 'browser' | 'note' | 'chat'

/**
 * 'row' = children laid out side by side (flex-row → a vertical divider).
 * 'col' = children stacked vertically (flex-col → a horizontal divider).
 * Splitting "vertically" in the UI (Ctrl+\) produces a 'row' split.
 */
export type SplitDir = 'row' | 'col'

export interface PaneLeaf {
  type: 'leaf'
  id: string
  kind: PaneKind
  /**
   * Opaque content reference owned by the integrator: a terminal session id,
   * a file path, a URL, a note id… `null` = unbound (renders the EmptyPane stub).
   */
  refId: string | null
  /** Display title for the pane header; falls back to refId basename / kind. */
  title?: string
  /** Unsaved-changes indicator dot. */
  dirty?: boolean
  /** Needs-attention indicator dot (terminal bell, waiting agent…). */
  attention?: boolean
  /**
   * Agent this pane belongs to (agent-bound terminals wake/sleep their
   * owner on I/O; chat panes thread to that agent). Optional.
   */
  agentId?: string
  /**
   * Terminal/command binding for `terminal` leaves — the shell command the
   * pane spawns (e.g. 'claude', 'codex', 'powershell.exe'). Saved layouts
   * carry it so a preset restores the exact CLI lineup.
   */
  command?: string
  /**
   * Working-dir override for `terminal` leaves — defaults to the project
   * root. Session resumes set it to the transcript's own cwd (claude
   * `--resume` only works in the dir the session was created in).
   */
  cwd?: string
  /**
   * Scope binding for `browser` leaves — id of the terminal leaf this pane
   * is driven by. Set at spawn time when a terminal was focused; absent =
   * general browser. The pane shows a scope chip and its prompt bar types
   * into the bound terminal's pty. Saved layouts carry it (remapped to the
   * fresh terminal ids cloneTree mints).
   */
  bindLeafId?: string
  /**
   * Detected work area for `terminal` leaves — filled by the domain
   * classifier (Jev, heuristic fallback). Drives the office nametag's
   * 'Name — Domain' label and the session rail's grouping.
   */
  domain?: AgentDomain
  /**
   * User-assigned category — files the leaf under a custom rail group that
   * sorts ahead of the domain groups and can be hidden from the grid via
   * the rail's eye toggle. Free-form (trimmed; empty = unset). The name
   * registry, hidden set, and CLI-session memory live in lib/categories.ts.
   */
  category?: string
}

export interface PaneSplit {
  type: 'split'
  id: string
  dir: SplitDir
  /** Fraction of space allocated to `a`; `b` receives `1 - ratio`. */
  ratio: number
  a: PaneNode
  b: PaneNode
}

export type PaneNode = PaneLeaf | PaneSplit

// ── constants ────────────────────────────────────────────────────────────────

/** Hard ceiling on leaf panes — keeps the office readable. */
export const MAX_LEAVES = 8
/** Splits can never squash a child below this fraction. */
export const RATIO_MIN = 0.15
export const RATIO_MAX = 0.85
export const DEFAULT_RATIO = 0.5

// Spawnable kinds — 'file'/'note' stay in the type (legacy saved layouts
// still deserialize + render their EmptyPane stubs) but can't be spawned:
// no content renderer exists for them, so the buttons produced dead panes.
export const PANE_KINDS: readonly PaneKind[] = ['terminal', 'browser', 'chat']

/** Display names for generated leaf titles ('Terminal 1', 'File 2'…). */
export const PANE_KIND_LABELS: Record<PaneKind, string> = {
  terminal: 'Terminal',
  file: 'File',
  browser: 'Browser',
  note: 'Note',
  chat: 'Chat'
}

// ── construction ─────────────────────────────────────────────────────────────

let counter = 0

/** Unique-enough pane/split id (crypto-backed when available). */
export function newPaneId(prefix = 'pane'): string {
  counter = (counter + 1) % 0xffff
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10) ??
    Math.random().toString(36).slice(2, 12)
  return `${prefix}-${counter.toString(36)}${rand}`
}

export function createLeaf(
  kind: PaneKind,
  opts: {
    id?: string
    refId?: string | null
    title?: string
    agentId?: string
    command?: string
    cwd?: string
    bindLeafId?: string
    domain?: AgentDomain
    category?: string
  } = {}
): PaneLeaf {
  return {
    type: 'leaf',
    id: opts.id ?? newPaneId(),
    kind,
    refId: opts.refId ?? null,
    title: opts.title,
    agentId: opts.agentId,
    command: opts.command,
    cwd: opts.cwd,
    bindLeafId: opts.bindLeafId,
    domain: opts.domain,
    category: opts.category
  }
}

/**
 * The hash suffix of a command-bound session id — '' when the binding is
 * empty. Lets callers test whether a supervisor session (sid `leaf:hash`,
 * cwd exposed via PtySessionInfo) runs a given command without knowing
 * which leaf spawned it.
 */
export function commandSessionKey(
  command: string | undefined,
  cwd: string | undefined
): string {
  const key = `${command?.trim() ?? ''}|${cwd?.trim() ?? ''}`
  if (!key.replace('|', '').trim()) return ''
  // djb2-style char hash — stable across reloads so a restored layout
  // derives the same id; a collision would only alias two sessions.
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Terminal session id ← command binding. Sessions key off the leaf id;
 * folding the bound command into it means picking a different CLI changes
 * `sid` → the Terminal spawns a fresh pty instead of reattaching to the
 * old shell. Clearing the binding returns the bare leaf id — which
 * reattaches to the original session if it's still alive. Shared by
 * render-leaf (spawn) and BrowserPane (boundSid for the pane bridge).
 */
export function commandSessionId(leaf: PaneLeaf): string {
  const key = commandSessionKey(leaf.command, leaf.cwd)
  return key ? `${leaf.id}:${key}` : leaf.id
}

// ── queries ──────────────────────────────────────────────────────────────────

/** Leaves in visual order (a before b, depth-first). */
export function collectLeaves(tree: PaneNode | null): PaneLeaf[] {
  if (!tree) return []
  if (tree.type === 'leaf') return [tree]
  return [...(tree.a ? collectLeaves(tree.a) : []), ...(tree.b ? collectLeaves(tree.b) : [])]
}

export function leafCount(tree: PaneNode | null): number {
  if (!tree) return 0
  if (tree.type === 'leaf') return 1
  return (tree.a ? leafCount(tree.a) : 0) + (tree.b ? leafCount(tree.b) : 0)
}

export function findLeaf(tree: PaneNode | null, id: string): PaneLeaf | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.id === id ? tree : null
  return (tree.a ? findLeaf(tree.a, id) : null) ?? (tree.b ? findLeaf(tree.b, id) : null)
}

export function findSplit(tree: PaneNode | null, id: string): PaneSplit | null {
  if (!tree || tree.type === 'leaf') return null
  if (tree.id === id) return tree
  return (tree.a ? findSplit(tree.a, id) : null) ?? (tree.b ? findSplit(tree.b, id) : null)
}

/** The split node that directly contains `childId`, if any. */
export function findParentSplit(tree: PaneNode | null, childId: string): PaneSplit | null {
  if (!tree || tree.type === 'leaf') return null
  if (tree.a?.id === childId || tree.b?.id === childId) return tree
  return (tree.a ? findParentSplit(tree.a, childId) : null) ?? (tree.b ? findParentSplit(tree.b, childId) : null)
}

export function firstLeaf(tree: PaneNode | null): PaneLeaf | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree
  return (tree.a ? firstLeaf(tree.a) : null) ?? (tree.b ? firstLeaf(tree.b) : null)
}

/**
 * Terminal leaves carry worker names, not 'Terminal N' — every terminal
 * whose title is missing or matches an auto-generated pattern gets a
 * deterministic Latin name derived from its leaf id (same id → same name
 * across reloads; collision-probed against names already on the board).
 * Idempotent: a named leaf and user-typed titles pass through untouched.
 */
export function ensureTerminalNames(tree: PaneNode | null): PaneNode | null {
  if (!tree) return tree
  const leaves = collectLeaves(tree)
  const taken = new Set<string>()
  for (const l of leaves) {
    if (l.title && !(l.kind === 'terminal' && isAutoTerminalTitle(l.title))) {
      taken.add(l.title)
    }
  }
  let changed = false
  const named = leaves.map((l) => {
    if (l.kind !== 'terminal' || !isAutoTerminalTitle(l.title)) return l
    const title = latinNameForId(l.id, taken)
    taken.add(title)
    changed = true
    return { ...l, title }
  })
  if (!changed) return tree
  const byId = new Map(named.map((l) => [l.id, l]))
  const walk = (n: PaneNode): PaneNode =>
    n.type === 'leaf'
      ? (byId.get(n.id) ?? n)
      : { ...n, a: n.a ? walk(n.a) : n.a, b: n.b ? walk(n.b) : n.b }
  return walk(tree)
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio))
}

// ── internal walker ──────────────────────────────────────────────────────────

/**
 * Replaces the leaf `id` via `fn`. Returning null from `fn` removes the leaf
 * and collapses its parent split so the sibling takes the whole space.
 * Preserves references on untouched subtrees.
 */
function replaceLeaf(
  node: PaneNode,
  id: string,
  fn: (leaf: PaneLeaf) => PaneNode | null
): PaneNode | null {
  if (!node) return null
  if (node.type === 'leaf') return node.id === id ? fn(node) : node
  const a = node.a ? replaceLeaf(node.a, id, fn) : null
  if (a === null) return node.b ?? null
  const b = node.b ? replaceLeaf(node.b, id, fn) : null
  if (b === null) return a
  if (a === node.a && b === node.b) return node
  return { ...node, a, b }
}

/** Bottom-up map over split nodes; preserves references where unchanged. */
function mapSplits(node: PaneNode, fn: (split: PaneSplit) => PaneNode): PaneNode {
  if (!node) return node
  if (node.type === 'leaf') return node
  const a = node.a ? mapSplits(node.a, fn) : node.a
  const b = node.b ? mapSplits(node.b, fn) : node.b
  const self: PaneSplit = a === node.a && b === node.b ? node : { ...node, a, b }
  return fn(self)
}

// ── ops ──────────────────────────────────────────────────────────────────────

/**
 * Splits the leaf `id` along `dir`, placing `newLeaf` as the second child at
 * 50/50. No-ops (same reference) when the leaf doesn't exist or MAX_LEAVES is
 * reached. On an empty workspace (`tree === null`) the new leaf becomes root.
 */
export function splitLeaf(
  tree: PaneNode | null,
  leafId: string,
  dir: SplitDir,
  newLeaf: PaneLeaf,
  splitId: string = newPaneId('split')
): PaneNode | null {
  if (tree === null) return newLeaf
  if (leafCount(tree) >= MAX_LEAVES) return tree
  return replaceLeaf(tree, leafId, (leaf) => ({
    type: 'split',
    id: splitId,
    dir,
    ratio: DEFAULT_RATIO,
    a: leaf,
    b: newLeaf
  }))
}

/**
 * Removes the leaf `id`. Its parent split collapses and the sibling subtree
 * expands into the freed space. Closing the last leaf returns null.
 */
export function closeLeaf(tree: PaneNode | null, leafId: string): PaneNode | null {
  if (!tree) return null
  return replaceLeaf(tree, leafId, () => null)
}

/**
 * View-filtered copy of the tree: leaves rejected by `keep` drop out and
 * splits collapse exactly like closeLeaf (lone surviving child takes the
 * space). The input tree is untouched — use it to hide panes from the grid
 * without disturbing their sessions or the persisted layout.
 */
export function filterLeaves(
  tree: PaneNode | null,
  keep: (leaf: PaneLeaf) => boolean
): PaneNode | null {
  if (!tree) return null
  if (tree.type === 'leaf') return keep(tree) ? tree : null
  const a = tree.a ? filterLeaves(tree.a, keep) : null
  const b = tree.b ? filterLeaves(tree.b, keep) : null
  if (!a) return b
  if (!b) return a
  if (a === tree.a && b === tree.b) return tree
  return { ...tree, a, b }
}

/** Sets a split's ratio, clamped to [RATIO_MIN, RATIO_MAX]. */
export function setRatio(
  tree: PaneNode | null,
  splitId: string,
  ratio: number
): PaneNode | null {
  if (!tree) return null
  const r = clampRatio(ratio)
  return mapSplits(tree, (s) => (s.id === splitId ? { ...s, ratio: r } : s))
}

/** Patches leaf fields (title, refId, dirty, attention…). Id/type are immutable. */
export function updateLeaf(
  tree: PaneNode | null,
  leafId: string,
  patch: Partial<Omit<PaneLeaf, 'type' | 'id'>>
): PaneNode | null {
  if (!tree) return null
  return replaceLeaf(tree, leafId, (leaf) => ({ ...leaf, ...patch, type: 'leaf', id: leaf.id }))
}

/**
 * Sets (or clears) a terminal leaf's CLI binding — the shell command it
 * spawns on restore. Blank input clears the binding. Pure equivalent of
 * dispatch({ type:'update', leafId, patch:{ command } }).
 */
export function setLeafCommand(
  tree: PaneNode | null,
  leafId: string,
  command: string | undefined
): PaneNode | null {
  const c = command?.trim()
  return updateLeaf(tree, leafId, { command: c ? c : undefined })
}

/**
 * Swaps two leaves' positions (drag-reorder). Leaf objects trade places whole
 * — ids included — so content bound to the leaf id (terminal sessions) moves
 * with the pane. No-ops on missing ids or a self-drop.
 */
export function swapLeaves(tree: PaneNode | null, aId: string, bId: string): PaneNode | null {
  if (!tree || aId === bId) return tree
  const a = findLeaf(tree, aId)
  const b = findLeaf(tree, bId)
  if (!a || !b) return tree
  const walk = (node: PaneNode): PaneNode => {
    if (node.type === 'leaf') {
      if (node.id === aId) return b
      if (node.id === bId) return a
      return node
    }
    const na = walk(node.a)
    const nb = walk(node.b)
    return na === node.a && nb === node.b ? node : { ...node, a: na, b: nb }
  }
  return walk(tree)
}

export type RebalanceMode = 'tidy'

function nodeWeight(n: PaneNode | null | undefined, dir: SplitDir): number {
  if (!n) return 0
  if (n.type === 'leaf') return 1
  if (n.dir === dir) {
    return nodeWeight(n.a, dir) + nodeWeight(n.b, dir)
  }
  return Math.max(nodeWeight(n.a, dir), nodeWeight(n.b, dir))
}

/**
 * 'tidy' distributes space evenly across every split along its axis.
 * Nested splits in the same direction (e.g. 3 columns) get exact proportional
 * shares (33%/33%/33%), while 2x2 grids get 50%/50% both ways.
 * Leaves, sessions, and tree structure are completely preserved.
 */
export function rebalance(tree: PaneNode | null, _mode: RebalanceMode = 'tidy'): PaneNode | null {
  if (!tree) return null
  return mapSplits(tree, (s) => {
    const wa = nodeWeight(s.a, s.dir)
    const wb = nodeWeight(s.b, s.dir)
    const target = wa + wb > 0 ? clampRatio(wa / (wa + wb)) : DEFAULT_RATIO
    return Math.abs(s.ratio - target) < 0.001 ? s : { ...s, ratio: target }
  })
}

/** Convenience alias for rebalance(tree, 'tidy'). */
export function tidy(tree: PaneNode | null): PaneNode | null {
  return rebalance(tree, 'tidy')
}

// ── layout presets ───────────────────────────────────────────────────────────

/**
 * Icon keys for the preset bar. panes.ts stays React-free, so the view maps
 * these to Lucide components (see PRESET_ICONS in WorkspaceView).
 */
export type PresetIcon = 'solo' | 'split' | 'grid' | 'code' | 'watch'

export interface PanePreset {
  id: string
  label: string
  icon: PresetIcon
  /** Shortcut hint for tooltips — the view binds Ctrl+<index+1>. */
  kbd: string
  /** Builds a fresh tree: new leaf/split ids, sequential per-kind titles. */
  build(): PaneNode
}

function presetLeaf(kind: PaneKind, n: number): PaneLeaf {
  return createLeaf(kind, { title: `${PANE_KIND_LABELS[kind]} ${n}` })
}

function rowSplit(a: PaneNode, b: PaneNode, ratio = DEFAULT_RATIO): PaneSplit {
  return { type: 'split', id: newPaneId('split'), dir: 'row', ratio, a, b }
}

function colSplit(a: PaneNode, b: PaneNode, ratio = DEFAULT_RATIO): PaneSplit {
  return { type: 'split', id: newPaneId('split'), dir: 'col', ratio, a, b }
}

/**
 * One-click layouts for the workspace toolbar. `build()` returns a brand-new
 * tree each call — applying a preset REPLACES the current arrangement (no
 * confirm; the user can rebuild). Order is the keyboard order: Ctrl+1…5 →
 * PRESETS[0…4].
 */
export const PRESETS: readonly PanePreset[] = [
  {
    id: 'solo',
    label: 'Solo',
    icon: 'solo',
    kbd: 'Ctrl+1',
    build: () => presetLeaf('terminal', 1)
  },
  {
    id: 'split',
    label: 'Split',
    icon: 'split',
    kbd: 'Ctrl+2',
    build: () => rowSplit(presetLeaf('terminal', 1), presetLeaf('terminal', 2))
  },
  {
    id: 'grid',
    label: 'Grid',
    icon: 'grid',
    kbd: 'Ctrl+3',
    build: () =>
      colSplit(
        rowSplit(presetLeaf('terminal', 1), presetLeaf('terminal', 2)),
        rowSplit(presetLeaf('terminal', 3), presetLeaf('terminal', 4))
      )
  },
  {
    id: 'code',
    label: 'Code+Term',
    icon: 'code',
    kbd: 'Ctrl+4',
    build: () => rowSplit(presetLeaf('browser', 1), presetLeaf('terminal', 1), 0.55)
  },
  {
    id: 'watch',
    label: 'Watch',
    icon: 'watch',
    kbd: 'Ctrl+5',
    build: () => rowSplit(presetLeaf('terminal', 1), presetLeaf('browser', 1), 0.6)
  }
]

/**
 * Balanced grid of `count` fresh leaves (terminals by default) — backs the
 * toolbar's 4/6/8 split buttons. Two rows of ⌈n/2⌉ columns; the nested
 * row-split ratios shrink left-to-right (1/cols, 1/(cols-1), …, 1/2) so
 * every column lands equal width, and each column stacks its pair 50/50.
 * Like presets, applying this REPLACES the current tree.
 */
export function gridTree(count: number, kind: PaneKind = 'terminal'): PaneNode {
  const n = Math.max(1, Math.min(MAX_LEAVES, Math.floor(count)))
  const leaf = (i: number) => presetLeaf(kind, i + 1)
  if (n === 1) return leaf(0)
  if (n === 2) return rowSplit(leaf(0), leaf(1))
  const cols = Math.ceil(n / 2)
  const col = (i: number): PaneNode =>
    2 * i + 1 < n ? colSplit(leaf(2 * i), leaf(2 * i + 1)) : leaf(2 * i)
  let tree = col(cols - 1)
  for (let i = cols - 2; i >= 0; i--) {
    tree = rowSplit(col(i), tree, 1 / (cols - i))
  }
  return tree
}

// ── reducer ──────────────────────────────────────────────────────────────────

/**
 * Action set covering everything the Workspace chrome can do. Feed to
 * `useReducer(panesReducer, …)` or adapt into your store.
 */
export type PaneAction =
  | { type: 'split'; leafId: string; dir: SplitDir; leaf: PaneLeaf; splitId?: string }
  | { type: 'close'; leafId: string }
  | { type: 'ratio'; splitId: string; ratio: number }
  | { type: 'update'; leafId: string; patch: Partial<Omit<PaneLeaf, 'type' | 'id'>> }
  | { type: 'tidy' }
  | { type: 'swap'; aId: string; bId: string }
  | { type: 'set'; tree: PaneNode | null }

export function panesReducer(tree: PaneNode | null, action: PaneAction): PaneNode | null {
  switch (action.type) {
    case 'split':
      return splitLeaf(tree, action.leafId, action.dir, action.leaf, action.splitId)
    case 'close':
      return closeLeaf(tree, action.leafId)
    case 'ratio':
      return setRatio(tree, action.splitId, action.ratio)
    case 'update':
      return updateLeaf(tree, action.leafId, action.patch)
    case 'tidy':
      return rebalance(tree, 'tidy')
    case 'swap':
      return swapLeaves(tree, action.aId, action.bId)
    case 'set':
      return ensureTerminalNames(action.tree ?? null)
  }
}

// ── persistence ──────────────────────────────────────────────────────────────

const SERIAL_VERSION = 1

/** Serialize the tree to a JSON string (versioned envelope) for localStorage. */
export function serializePanes(tree: PaneNode | null): string {
  return JSON.stringify({ v: SERIAL_VERSION, tree })
}

/**
 * Restores a tree written by `serializePanes`. Tolerates a bare tree without
 * the envelope, repairs malformed fields (bad kinds/dirs coerced, missing ids
 * regenerated, ratios clamped, leaves beyond MAX_LEAVES dropped), and returns
 * null when the payload is unusable.
 */
export function deserializePanes(json: string | null | undefined): PaneNode | null {
  if (!json) return null
  try {
    const raw: unknown = JSON.parse(json)
    const node =
      raw && typeof raw === 'object' && 'tree' in (raw as Record<string, unknown>)
        ? (raw as { tree: unknown }).tree
        : raw
    return ensureTerminalNames(normalizeNode(node, { leaves: 0 }))
  } catch {
    return null
  }
}

function isPaneKind(v: unknown): v is PaneKind {
  return v === 'terminal' || v === 'file' || v === 'browser' || v === 'note' || v === 'chat'
}

export function isAgentDomain(v: unknown): v is AgentDomain {
  return (
    v === 'frontend' ||
    v === 'backend' ||
    v === 'marketing' ||
    v === 'design' ||
    v === 'research' ||
    v === 'legal' ||
    v === 'general'
  )
}

function normalizeNode(
  raw: unknown,
  budget: { leaves: number; seenIds?: Set<string> }
): PaneNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  if (!budget.seenIds) budget.seenIds = new Set<string>()

  // leaf: explicit tag, or legacy shape carrying a `kind`
  if (n.type === 'leaf' || (!('a' in n) && isPaneKind(n.kind))) {
    if (budget.leaves >= MAX_LEAVES) return null
    budget.leaves++
    // file/note leaves from older saves had placeholder-only bodies and
    // can't be spawned anymore — coerce to a terminal so every restored
    // pane is live rather than a dead stub.
    const kind = isPaneKind(n.kind) ? n.kind : 'terminal'
    let id = typeof n.id === 'string' && n.id ? n.id : newPaneId()
    if (budget.seenIds.has(id)) {
      id = newPaneId()
    }
    budget.seenIds.add(id)
    return {
      type: 'leaf',
      id,
      kind: kind === 'file' || kind === 'note' ? 'terminal' : kind,
      refId: typeof n.refId === 'string' ? n.refId : null,
      title: typeof n.title === 'string' ? n.title : undefined,
      dirty: n.dirty === true ? true : undefined,
      attention: n.attention === true ? true : undefined,
      agentId: typeof n.agentId === 'string' ? n.agentId : undefined,
      command: typeof n.command === 'string' ? n.command : undefined,
      cwd: typeof n.cwd === 'string' ? n.cwd : undefined,
      bindLeafId: typeof n.bindLeafId === 'string' ? n.bindLeafId : undefined,
      domain: isAgentDomain(n.domain) ? n.domain : undefined,
      // free-form, but blank/whitespace means unset
      category:
        typeof n.category === 'string' && n.category.trim() ? n.category.trim() : undefined
    }
  }

  // split: explicit tag, or anything with a/b children
  if (n.type === 'split' || ('a' in n && 'b' in n)) {
    const a = normalizeNode(n.a, budget)
    const b = normalizeNode(n.b, budget)
    if (!a) return b
    if (!b) return a
    let id = typeof n.id === 'string' && n.id ? n.id : newPaneId('split')
    if (budget.seenIds.has(id)) {
      id = newPaneId('split')
    }
    budget.seenIds.add(id)
    return {
      type: 'split',
      id,
      dir: n.dir === 'col' ? 'col' : 'row',
      ratio: clampRatio(typeof n.ratio === 'number' ? n.ratio : DEFAULT_RATIO),
      a,
      b
    }
  }

  return null
}

// ── saved layouts ────────────────────────────────────────────────────────────

/**
 * A named workspace snapshot: the full pane tree — split dirs/ratios plus
 * each leaf's kind/refId/title/agentId/command — so restoring rebuilds the
 * exact CLI lineup, not just the geometry. Transient flags (dirty,
 * attention) are dropped at save time via cloneTree.
 */
export interface SavedLayout {
  name: string
  tree: PaneNode
  savedAt: number
}

/** localStorage key for the named-layout list (versioned envelope). */
export const LAYOUTS_KEY = 'terrarium.layouts'

/** Hard cap on stored layouts — keeps the picker a menu, not a list. */
export const MAX_SAVED_LAYOUTS = 12

/**
 * Deep-clones a tree with FRESH ids on every node. Terminal sessions key off
 * leaf ids, so applying a saved layout must spawn new sessions — never alias
 * ids that are still live in the current tree or shared across two applies
 * of the same snapshot. Preserves kind/refId/title/agentId/command and split
 * dirs/ratios; transient dirty/attention flags are intentionally dropped.
 */
export function cloneTree(tree: PaneNode): PaneNode {
  if (!tree) return tree
  // Two passes: mint fresh leaf ids first so a browser leaf's bindLeafId
  // can be remapped onto the clone's new terminal ids — a naive copy would
  // leave it pointing at the previous tree's (dead) ids.
  const idMap = new Map<string, string>()
  const mint = (n: PaneNode): void => {
    if (!n) return
    if (n.type === 'leaf') idMap.set(n.id, newPaneId())
    else {
      if (n.a) mint(n.a)
      if (n.b) mint(n.b)
    }
  }
  mint(tree)
  const clone = (n: PaneNode): PaneNode => {
    if (!n) return n
    if (n.type === 'leaf') {
      return {
        type: 'leaf',
        id: idMap.get(n.id) ?? newPaneId(),
        kind: n.kind,
        refId: n.refId,
        title: n.title,
        agentId: n.agentId,
        command: n.command,
        cwd: n.cwd,
        bindLeafId: n.bindLeafId ? idMap.get(n.bindLeafId) : undefined,
        category: n.category
      }
    }
    return {
      type: 'split',
      id: newPaneId('split'),
      dir: n.dir,
      ratio: n.ratio,
      a: clone(n.a),
      b: clone(n.b)
    }
  }
  return clone(tree)
}

function readLayouts(): SavedLayout[] {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // tolerate both the {v, layouts} envelope and a bare array
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { layouts?: unknown }).layouts)
          ? (parsed as { layouts: unknown[] }).layouts
          : []
    const out: SavedLayout[] = []
    const seen = new Set<string>()
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      if (typeof e.name !== 'string' || !e.name.trim() || seen.has(e.name)) continue
      // same repair path as deserializePanes — corrupt trees are skipped
      const tree = normalizeNode(e.tree, { leaves: 0 })
      if (!tree) continue
      seen.add(e.name)
      out.push({
        name: e.name,
        tree,
        savedAt:
          typeof e.savedAt === 'number' && Number.isFinite(e.savedAt) ? e.savedAt : Date.now()
      })
      if (out.length >= MAX_SAVED_LAYOUTS) break
    }
    return out
  } catch {
    return [] // storage unavailable or corrupt — non-fatal
  }
}

function writeLayouts(layouts: SavedLayout[]): void {
  try {
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify({ v: SERIAL_VERSION, layouts }))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

/** All saved layouts, most recently saved first. Corrupt entries skipped. */
export function listLayouts(): SavedLayout[] {
  return readLayouts()
}

/**
 * Upserts `tree` under `name` (trimmed; blank names are a no-op). The stored
 * snapshot is a fresh-id clone so it never shares leaf ids with the live
 * tree. Newest first, capped at MAX_SAVED_LAYOUTS. Returns the list.
 */
export function saveLayout(name: string, tree: PaneNode): SavedLayout[] {
  const layouts = readLayouts()
  const key = name.trim()
  if (!key) return layouts
  const entry: SavedLayout = { name: key, tree: cloneTree(tree), savedAt: Date.now() }
  const next = [entry, ...layouts.filter((l) => l.name !== key)].slice(0, MAX_SAVED_LAYOUTS)
  writeLayouts(next)
  return next
}

/** Removes the layout named `name`; returns the persisted list. */
export function deleteLayout(name: string): SavedLayout[] {
  const next = readLayouts().filter((l) => l.name !== name)
  writeLayouts(next)
  return next
}
