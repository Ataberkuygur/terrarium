// ── LayoutMenu — named workspace layouts ─────────────────────────────────────
// Toolbar dropdown next to the preset pills: save the current pane tree under
// a name (split geometry + each leaf's kind/refId/agentId — and crucially the
// terminal leaves' `command`, so "my CLIs" come back too), list snapshots with
// leaf count + age, apply or delete them. Persisted via 'terrarium.layouts'.
//
// Applying clones the snapshot with FRESH leaf ids — terminal sessions key
// off leaf ids, so a restored layout spawns new sessions instead of
// colliding with live ones (or with a second apply of the same snapshot).

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import {
  cloneTree,
  deleteLayout,
  leafCount,
  listLayouts,
  saveLayout,
  type PaneNode,
  type SavedLayout
} from '../lib/panes'

/** Compact relative time ('now', '5m', '3h', '2d') — same shape as BoardView. */
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function LayoutMenu({
  tree,
  onApply
}: {
  tree: PaneNode | null
  onApply: (t: PaneNode) => void
}) {
  const [open, setOpen] = useState(false)
  const [layouts, setLayouts] = useState<SavedLayout[]>([])
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Re-read the list every time the menu opens; reset the save draft.
  useEffect(() => {
    if (!open) return
    setLayouts(listLayouts())
    setSaving(false)
    setName('')
  }, [open])

  // Close on outside pointerdown and Esc — both capture phase so we win over
  // other handlers. INPUT guard: Esc while the name field is focused is left
  // to the input itself (it cancels the draft instead of closing the menu).
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const apply = (saved: SavedLayout) => {
    onApply(cloneTree(saved.tree))
    setOpen(false)
  }

  const remove = (layoutName: string) => {
    setLayouts(deleteLayout(layoutName))
  }

  const submit = () => {
    const key = name.trim()
    if (!key || !tree) return
    setLayouts(saveLayout(key, tree))
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      {/* trigger — same chrome + button look as the preset pill group */}
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--border-subtle)] p-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="Saved layouts"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-6 items-center gap-1 rounded bg-transparent px-2 text-[11px] text-t3 transition-colors hover:bg-n3 hover:text-t2"
        >
          Layout
          <ChevronDown
            size={11}
            strokeWidth={1.75}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--border-default)] bg-popover p-1 shadow-md-dark"
        >
          {/* saved layouts — scrolls, capped well under 260px total */}
          <div className="scroll-thin max-h-[196px] overflow-y-auto">
            {layouts.length === 0 ? (
              <p className="px-2 py-3 text-[11.5px] leading-relaxed text-t4">
                No saved layouts — arrange panes, then save.
              </p>
            ) : (
              layouts.map((l) => {
                const n = leafCount(l.tree)
                return (
                  <div key={l.name} className="group relative">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => apply(l)}
                      className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-n3"
                    >
                      <span className="truncate text-[12px] text-t2 group-hover:text-t1">
                        {l.name}
                      </span>
                      <span className="tnum text-[10.5px] text-t4">
                        {n} pane{n === 1 ? '' : 's'} · {timeAgo(l.savedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(l.name)}
                      title={`Delete '${l.name}'`}
                      className="invisible absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-t3 transition-colors hover:bg-n4 hover:text-[var(--color-error)] group-hover:visible"
                    >
                      <Trash2 size={11} strokeWidth={1.75} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="my-1 h-px bg-[var(--border-default)]" />

          {saving ? (
            <input
              autoFocus
              type="text"
              value={name}
              spellCheck={false}
              placeholder="Layout name…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  // INPUT guard in the window handler leaves Esc to us:
                  // cancel the draft, keep the menu open.
                  e.stopPropagation()
                  setSaving(false)
                  setName('')
                }
              }}
              className="h-7 w-full rounded-md border border-[var(--border-default)] bg-n2 px-2 text-[12px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--border-strong)]"
            />
          ) : (
            <button
              type="button"
              disabled={!tree}
              onClick={() => setSaving(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-t3 transition-colors hover:bg-n3 hover:text-t1 disabled:pointer-events-none disabled:opacity-35"
            >
              <Plus size={11} strokeWidth={1.75} />
              Save current layout…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
