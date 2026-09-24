// ── modal ────────────────────────────────────────────────────────────
// Centered overlay dialog — portal-free (the app root is overflow-hidden
// and flat, so fixed positioning is enough). AnimatePresence lives inside
// so callers only toggle `open` and still get the spring exit. Esc uses
// the capture phase like AgentEditor so a modal wins over view-level
// handlers; inputs/textareas keep Esc for their own cancel behaviour.

import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from './cx'
import { Button } from './Button'

export type ModalSize = 'sm' | 'md' | 'lg'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** pinned action row — right-aligned, separated by a hairline */
  footer?: ReactNode
  size?: ModalSize
  /** aria-label fallback when `title` isn't a plain string */
  ariaLabel?: string
}

const SIZES: Record<ModalSize, string> = {
  sm: 'w-[380px]',
  md: 'w-[480px]',
  lg: 'w-[640px]'
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  ariaLabel
}: ModalProps) {
  // Esc closes — capture phase so this wins over other window-level
  // handlers; skip when the keypress came from a field being edited
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
        return
      }
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* backdrop */}
          <motion.div
            className="absolute inset-0 bg-[rgba(4,5,7,0.62)] backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          {/* panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={cx(
              'relative flex max-h-[85vh] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-popover shadow-[var(--shadow-pop),0_32px_80px_-24px_rgba(0,0,0,0.7)]',
              SIZES[size]
            )}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            {title != null && (
              <div className="pane-head flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] pr-2.5 pl-5">
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-t1">{title}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="text-t3"
                >
                  <X size={14} strokeWidth={1.8} />
                </Button>
              </div>
            )}

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

            {footer != null && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-n2/60 px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default Modal
