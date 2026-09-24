// ── pane-events — DOM event bridge from pane bodies to the host app ──────────
// EmptyPane quick actions can't bind real content themselves (the terminal
// engine / file picker / browser host live in the integrator). They fire
// `terrarium:pane-spawn` on window; the parent listens and wires content in.

import type { PaneKind } from '../lib/panes'

/** CustomEvent name for "bind real content to this leaf" requests. */
export const PANE_SPAWN_EVENT = 'terrarium:pane-spawn'

export interface PaneSpawnDetail {
  leafId: string
  kind: PaneKind
}

/** Fire the pane-spawn request upward — safe to call from any pane body. */
export function emitPaneSpawn(detail: PaneSpawnDetail): void {
  window.dispatchEvent(new CustomEvent<PaneSpawnDetail>(PANE_SPAWN_EVENT, { detail }))
}
