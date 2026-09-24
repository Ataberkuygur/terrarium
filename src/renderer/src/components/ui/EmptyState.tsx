// ── empty state ──────────────────────────────────────────────────────
// Centered placeholder for empty lists/panels: a quiet icon tile, a
// title, an optional hint, and an optional action (usually a Button).
// Width is capped so hints wrap into a tidy column, not a wide banner.

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  hint?: string
  /** e.g. <Button size="sm" variant="secondary">New card</Button> */
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex h-full w-full items-center justify-center', className)}>
      <div className="flex max-w-[260px] flex-col items-center gap-2 text-center">
        <div className="mb-1.5 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-gradient-to-b from-n4 to-n3 text-t3 shadow-[var(--shadow-card)]">
          <Icon size={17} strokeWidth={1.6} />
        </div>
        <p className="text-[13px] font-medium tracking-[-0.005em] text-t1">{title}</p>
        {hint != null && hint !== '' && (
          <p className="text-[12px] leading-relaxed text-t3">{hint}</p>
        )}
        {action != null && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

export default EmptyState
