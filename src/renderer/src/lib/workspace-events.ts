// ── workspace-events — palette → view command bridge ──────────────────
// The command palette drives the workspace from anywhere via
// window CustomEvents. But App renders only the active view and the
// workspace chunk is lazy, so an event fired right after setView can land
// before the target's listener exists. fireWorkspaceEvent therefore also
// stashes its payload in sessionStorage; the live listener AND the
// mount-drain both take() the same stash — first consumer wins, so a
// command is applied exactly once whether the view was mounted or not.

/** CustomEvent name — detail: preset id ('solo' | 'split' | 'grid' | 'code' | 'watch'). */
export const APPLY_PRESET_EVENT = 'terrarium:apply-preset'
/** CustomEvent name — detail: { kind: PaneKind } — split a fresh leaf into the workspace. */
export const SPAWN_PANE_EVENT = 'terrarium:spawn-pane'

const STASH_PREFIX = 'terrarium.cmd.'
/** A stash older than this predates the current session — ignore it. */
const STASH_TTL_MS = 30_000

/** Dispatch `name` on window now AND stash `value` for a view mounting a beat later. */
export function fireWorkspaceEvent(name: string, value?: unknown): void {
  try {
    sessionStorage.setItem(STASH_PREFIX + name, JSON.stringify({ v: value, at: Date.now() }))
  } catch {
    /* storage unavailable — the live event still fires */
  }
  window.dispatchEvent(new CustomEvent(name, { detail: value }))
}

/**
 * Take (and clear) the stash for `name`. Returns the payload when a fresh
 * one exists, undefined otherwise. Consume-once: the live listener and the
 * mount-drain race here, so a command lands exactly once.
 */
export function takeWorkspaceEvent<T = unknown>(name: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(STASH_PREFIX + name)
    if (raw === null) return undefined
    sessionStorage.removeItem(STASH_PREFIX + name)
    const parsed = JSON.parse(raw) as { v?: T; at?: unknown }
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > STASH_TTL_MS) return undefined
    return parsed.v
  } catch {
    return undefined
  }
}
