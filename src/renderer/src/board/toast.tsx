// ── board toasts — "Moved 3 tasks to Done · Undo" ────────────────────
// One stack at the bottom of the board. A toast may carry an undo; the
// most recent undoable toast is what Ctrl+Z reverts.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Undo2, X } from 'lucide-react'
import clsx from 'clsx'

export interface Toast {
  id: number
  text: string
  tone?: 'info' | 'error'
  undo?: () => void | Promise<void>
}

const TTL_MS = 6000
const MAX = 3

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current
      setToasts((cur) => [...cur, { ...t, id }].slice(-MAX))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), t.tone === 'error' ? TTL_MS * 1.5 : TTL_MS)
      )
      return id
    },
    [dismiss]
  )

  /** Run the newest undo (Ctrl+Z). False when nothing is undoable. */
  const undoLast = useCallback((): boolean => {
    const last = [...toasts].reverse().find((t) => t.undo)
    if (!last) return false
    dismiss(last.id)
    void last.undo?.()
    return true
  }, [toasts, dismiss])

  useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => clearTimeout(t))
  }, [])

  return { toasts, push, dismiss, undoLast }
}

export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pop-in pointer-events-auto flex h-9 items-center gap-2.5 rounded-xl border bg-popover pr-1.5 pl-3.5 text-[12px] shadow-[var(--shadow-pop)] [transform-origin:bottom_center]',
            t.tone === 'error'
              ? 'border-[rgba(229,72,77,0.4)] text-[var(--color-needs)]'
              : 'border-[var(--border-default)] text-t1'
          )}
        >
          {t.tone === 'error' && <AlertTriangle size={12} className="shrink-0" />}
          <span className="max-w-[420px] truncate">{t.text}</span>
          {t.undo && (
            <button
              onClick={() => {
                onDismiss(t.id)
                void t.undo?.()
              }}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent-subtle"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={11} /> Undo
            </button>
          )}
          <button
            onClick={() => onDismiss(t.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-t4 transition-colors hover:bg-n4 hover:text-t1"
            aria-label="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
