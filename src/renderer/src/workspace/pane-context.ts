// ── pane-context — dispatch bridge for pane bodies ──────────────────────────
// Leaf content (EmptyPane quick actions, future editors) lives deep inside
// PaneHost's recursion — prop-drilling dispatch through every split would be
// noise. WorkspaceView provides its dispatch here; pane bodies consume it.
// Null when a pane renders outside a WorkspaceView (previews, tests).

import { createContext, useContext } from 'react'
import type { PaneAction } from '../lib/panes'

export const PaneDispatchContext = createContext<((action: PaneAction) => void) | null>(null)

/** PaneAction dispatch from the enclosing WorkspaceView, or null outside one. */
export function usePaneDispatch(): ((action: PaneAction) => void) | null {
  return useContext(PaneDispatchContext)
}
