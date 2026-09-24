// ── badge ────────────────────────────────────────────────────────────
// Pill-shaped status/label chip. Status variants are tinted color-mix
// fills of the status hues with a hairline inset ring — the shadcn
// "secondary badge" look, derived from tokens so hues stay canonical.

import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export type BadgeVariant = 'neutral' | 'accent' | 'needs' | 'done' | 'info' | 'warning'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-n4 text-t2 ring-[var(--border-default)]',
  accent: 'bg-accent-subtle text-accent ring-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]',
  needs: 'bg-[color-mix(in_srgb,var(--color-needs)_15%,transparent)] text-needs ring-[color-mix(in_srgb,var(--color-needs)_35%,transparent)]',
  done: 'bg-[color-mix(in_srgb,var(--color-done)_15%,transparent)] text-done ring-[color-mix(in_srgb,var(--color-done)_35%,transparent)]',
  info: 'bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)] text-info ring-[color-mix(in_srgb,var(--color-info)_35%,transparent)]',
  warning:
    'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-warning ring-[color-mix(in_srgb,var(--color-warning)_35%,transparent)]'
}

export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] leading-none font-medium whitespace-nowrap ring-1 ring-inset',
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

export default Badge
