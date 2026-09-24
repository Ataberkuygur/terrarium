// ── tooltip ──────────────────────────────────────────────────────────
// CSS-only tooltip — no portals, no JS positioning. The wrapper is a
// named `group/tt` so the tip reveals on hover or keyboard focus
// (focus-within) with a 150 ms intent delay on entry and instant hide
// on exit. A rotated square carries the border onto the arrow.
// Caveat: clipped by overflow-hidden ancestors — fine for chrome rows.

import type { ReactNode } from 'react'
import { cx } from './cx'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  content: ReactNode
  side?: TooltipSide
  children: ReactNode
  className?: string
}

const POSITIONS: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1.5 -translate-y-1/2'
}

// arrow straddles the tip edge facing the trigger; the two border sides
// shown are the ones forming the rotated corner that points at it
const ARROWS: Record<TooltipSide, string> = {
  top: 'top-full left-1/2 -translate-x-1/2 -translate-y-1/2 border-b border-r',
  bottom: 'bottom-full left-1/2 -translate-x-1/2 translate-y-1/2 border-t border-l',
  left: 'left-full top-1/2 -translate-x-1/2 -translate-y-1/2 border-t border-r',
  right: 'right-full top-1/2 translate-x-1/2 -translate-y-1/2 border-b border-l'
}

export function Tooltip({ content, side = 'top', children, className }: TooltipProps) {
  return (
    <span className={cx('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 scale-95 rounded-md border border-[var(--border-default)] bg-popover px-2 py-1 text-[11.5px] whitespace-nowrap text-t1 opacity-0 shadow-md-dark transition-[opacity,scale] duration-100 group-hover/tt:scale-100 group-hover/tt:opacity-100 group-hover/tt:delay-150 group-focus-within/tt:scale-100 group-focus-within/tt:opacity-100 group-focus-within/tt:delay-150',
          POSITIONS[side]
        )}
      >
        {content}
        <span
          aria-hidden
          className={cx(
            'absolute block h-1.5 w-1.5 rotate-45 border-[var(--border-default)] bg-popover',
            ARROWS[side]
          )}
        />
      </span>
    </span>
  )
}

export default Tooltip
