// ── kbd ──────────────────────────────────────────────────────────────
// Keyboard-hint chip — thin typed wrapper over the shared `.kbd` class
// so JSX reads `<Kbd>Ctrl K</Kbd>` and styling stays in styles.css.

import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
}

export function Kbd({ children, className, ...rest }: KbdProps) {
  return (
    <kbd className={cx('kbd', className)} {...rest}>
      {children}
    </kbd>
  )
}

export default Kbd
