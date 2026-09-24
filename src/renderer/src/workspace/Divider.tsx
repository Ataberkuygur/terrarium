import { useRef, useState } from 'react'
import clsx from 'clsx'
import { clampRatio, type SplitDir } from '../lib/panes'

export interface DividerProps {
  /** Direction of the parent split: 'row' → vertical bar (col-resize). */
  dir: SplitDir
  /**
   * Live-drag callback — fires on every pointermove with the clamped ratio.
   * PaneHost uses it to mutate flexGrow directly on the DOM (no re-render).
   */
  onPreview?: (ratio: number) => void
  /** Fires once on pointerup with the final ratio — dispatch setRatio here. */
  onCommit: (ratio: number) => void
}

/**
 * 6px hit area with a centered 1px hairline. Drag math is absolute: the
 * divider's center tracks the pointer (with grab offset so it doesn't jump),
 * converted to a ratio against the parent split's bounding rect.
 */
export function Divider({ dir, onPreview, onCommit }: DividerProps) {
  const el = useRef<HTMLDivElement>(null)
  const active = useRef(false)
  const grabOffset = useRef(0)
  const liveRatio = useRef(NaN)
  const [dragging, setDragging] = useState(false)

  const endDrag = (commit: boolean) => {
    if (!active.current) return
    active.current = false
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    // only commit if a move actually produced a ratio (plain click = no-op)
    if (commit && !Number.isNaN(liveRatio.current)) onCommit(liveRatio.current)
    liveRatio.current = NaN
  }

  return (
    <div
      ref={el}
      role="separator"
      aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
      className={clsx(
        'group/div relative shrink-0 touch-none',
        dir === 'row' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      )}
      onPointerDown={(e) => {
        e.preventDefault()
        const self = el.current
        if (!self) return
        self.setPointerCapture(e.pointerId)
        const me = self.getBoundingClientRect()
        // distance from pointer to divider center, so the bar doesn't snap
        grabOffset.current =
          dir === 'row' ? e.clientX - (me.left + me.width / 2) : e.clientY - (me.top + me.height / 2)
        liveRatio.current = NaN
        active.current = true
        setDragging(true)
        document.body.style.cursor = dir === 'row' ? 'col-resize' : 'row-resize'
        document.body.style.userSelect = 'none'
      }}
      onPointerMove={(e) => {
        if (!active.current) return
        const parent = el.current?.parentElement
        if (!parent) return
        const rect = parent.getBoundingClientRect()
        const center =
          dir === 'row'
            ? e.clientX - grabOffset.current - rect.left
            : e.clientY - grabOffset.current - rect.top
        const size = dir === 'row' ? rect.width : rect.height
        if (size <= 0) return
        const r = clampRatio(center / size)
        liveRatio.current = r
        onPreview?.(r)
      }}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(false)}
    >
      {/* 1px hairline — subtle at rest, strong on hover, accent while dragging */}
      <div
        className={clsx(
          'absolute transition-colors duration-100',
          dir === 'row'
            ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
          dragging
            ? 'bg-[var(--color-accent)]'
            : 'bg-[var(--border-subtle)] group-hover/div:bg-[var(--border-strong)]'
        )}
      />
    </div>
  )
}
