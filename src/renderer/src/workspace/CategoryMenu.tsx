// ── CategoryMenu — file panes under a user category ─────────────────────────
// Fixed-position dropdown shared by the rail's row context menu and the
// per-row tag button: lists the category registry (check marks the single
// target's current one), 'New category…' swaps to an inline input (Enter
// creates + assigns), 'Remove category' clears the filing. Assignments patch
// leaf.category through pane dispatch and remember the bound CLI session's
// category so a later resume lands back in its group. Same close idiom as
// LayoutMenu — capture-phase outside pointerdown + Esc (INPUT-guarded) —
// clamped inside the viewport.

import { useEffect, useRef, useState } from 'react'
import { Check, Plus, Tag, X } from 'lucide-react'
import type { PaneAction, PaneLeaf } from '../lib/panes'
import { rememberSessionCategory } from '../lib/categories'
import { useApp } from '../lib/store'
import { usePaneDispatch } from './pane-context'

/**
 * Shared assign action: registers `category` if new (the registry's casing
 * wins so stored categories match group keys exactly), patches every target
 * leaf, and files each leaf's bound CLI session for restore-on-resume.
 * Blank/undefined clears the filing.
 */
export function assignCategory(
  dispatch: ((action: PaneAction) => void) | null,
  targets: PaneLeaf[],
  category: string | undefined
): void {
  const trimmed = category?.trim() ?? ''
  let name: string | undefined
  if (trimmed) {
    useApp.getState().addCategory(trimmed)
    name =
      useApp.getState().categories.find((c) => c.toLowerCase() === trimmed.toLowerCase()) ??
      trimmed
  }
  for (const leaf of targets) {
    dispatch?.({ type: 'update', leafId: leaf.id, patch: { category: name } })
    rememberSessionCategory(leaf, name)
  }
}

// worst-case box for viewport clamping (fixed position, no measuring needed)
const MENU_W = 176
const MENU_H = 280

export function CategoryMenu({
  x,
  y,
  targets,
  onClose
}: {
  /** Anchor point in viewport coords (pointer position / button corner). */
  x: number
  y: number
  /** Leaves the assignment applies to — the caller expands selections. */
  targets: PaneLeaf[]
  onClose: () => void
}) {
  const categories = useApp((s) => s.categories)
  const dispatch = usePaneDispatch()
  const [mode, setMode] = useState<'list' | 'input'>('list')
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside pointerdown and Esc — both capture phase so we win over
  // other handlers. INPUT guard: Esc while the name field is focused is left
  // to the input itself (it backs out of the draft instead of closing).
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const left = Math.max(4, Math.min(x, window.innerWidth - MENU_W - 4))
  const top = Math.max(4, Math.min(y, window.innerHeight - MENU_H - 4))

  const single = targets.length === 1 ? targets[0] : null
  const anyFiled = targets.some((l) => l.category?.trim())

  const assign = (name: string | undefined) => {
    assignCategory(dispatch, targets, name)
    onClose()
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      style={{ left, top }}
      className="fixed z-50 w-44 rounded-lg border border-[var(--border-default)] bg-popover p-1 shadow-md-dark"
    >
      <p className="micro-label px-2 pt-1 pb-0.5">
        Assign category{targets.length > 1 ? ` · ${targets.length} panes` : ''}
      </p>
      <div className="scroll-thin max-h-[168px] overflow-y-auto">
        {categories.length === 0 ? (
          <p className="px-2 py-2 text-[10.5px] leading-relaxed text-t4">
            No categories yet — create one below.
          </p>
        ) : (
          categories.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              onClick={() => assign(c)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11.5px] text-t2 transition-colors hover:bg-n3 hover:text-t1"
            >
              <Tag size={10} strokeWidth={1.75} className="shrink-0 text-t4" />
              <span className="min-w-0 flex-1 truncate">{c}</span>
              {single?.category === c && (
                <Check size={11} strokeWidth={2} className="shrink-0 text-accent" />
              )}
            </button>
          ))
        )}
      </div>

      <div className="my-1 h-px bg-[var(--border-default)]" />

      {mode === 'input' ? (
        <input
          autoFocus
          type="text"
          value={draft}
          spellCheck={false}
          placeholder="Category name…"
          aria-label="New category name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim()) assign(draft)
              else {
                // empty Enter just backs out of the input (CommandMenu idiom)
                setMode('list')
                setDraft('')
              }
            } else if (e.key === 'Escape') {
              // INPUT guard in the window handler leaves Esc to us
              e.stopPropagation()
              setMode('list')
              setDraft('')
            }
          }}
          className="h-6 w-full rounded-md border border-[var(--border-default)] bg-n2 px-2 text-[11.5px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--border-strong)]"
        />
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => setMode('input')}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11.5px] text-t3 transition-colors hover:bg-n3 hover:text-t1"
        >
          <Plus size={11} strokeWidth={1.75} />
          New category…
        </button>
      )}

      {anyFiled && mode === 'list' && (
        <button
          type="button"
          role="menuitem"
          onClick={() => assign(undefined)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11.5px] text-t3 transition-colors hover:bg-n3 hover:text-t1"
        >
          <X size={11} strokeWidth={1.75} />
          Remove category
        </button>
      )}
    </div>
  )
}
