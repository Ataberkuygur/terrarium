// ── button ───────────────────────────────────────────────────────────
// Token-driven button primitive — shadcn-grade variants built on the
// terrarium ramp, no dependency. `danger` uses color-mix tints of the error
// hue rather than a solid fill so it reads premium on dark surfaces.
// No asChild: composition stays with the caller, props stay simple.

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'accent'
  | 'danger'

export type ButtonSize = 'sm' | 'md' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** swaps in a spinner and blocks interaction — for async actions */
  loading?: boolean
}

const BASE =
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-quick)] ease-[var(--ease-out-quart)] disabled:pointer-events-none disabled:opacity-40'

const VARIANTS: Record<ButtonVariant, string> = {
  default:
    'bg-t1 text-n1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(0,0,0,0.4)] hover:bg-n12',
  secondary:
    'border border-[var(--border-default)] bg-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-[var(--border-strong)] hover:bg-n5',
  ghost: 'text-t2 hover:bg-n4 hover:text-t1',
  outline:
    'border border-[var(--border-default)] text-t2 hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1',
  accent:
    'bg-accent text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.35),0_4px_14px_-6px_rgba(245,165,36,0.5)] hover:bg-accent-hover',
  danger:
    'border border-[color-mix(in_srgb,var(--color-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_14%,transparent)] text-error hover:bg-[color-mix(in_srgb,var(--color-error)_22%,transparent)]'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3.5 text-[12.5px]',
  icon: 'h-7 w-7'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading = false, disabled, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  )
})

export default Button
