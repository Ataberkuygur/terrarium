// ── update notice ────────────────────────────────────────────────────
// Corner card for GitHub Releases auto-updates (main/updater.ts). Appears
// when a newer Terrarium is found, shows the background download, and one
// click restarts into the new version — terminal sessions survive (they
// live in the detached pty supervisor). Dismissable until the next launch.
// In dev builds or a plain browser the updater reports 'disabled' /
// is absent, so nothing renders.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownToLine, Loader2, RotateCw, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/updater'

export function UpdateNotice() {
  const [s, setS] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    const u = window.terrarium?.updater
    if (!u) return
    let alive = true
    u.get().then((v) => alive && setS(v)).catch(() => {})
    const off = u.onStatus((v) => setS(v))
    return () => {
      alive = false
      off()
    }
  }, [])

  const offer = s && (s.state === 'available' || s.state === 'downloading' || s.state === 'ready') ? s : null
  const show = !!offer && dismissed !== offer.version

  const install = () => {
    void window.terrarium?.updater?.install().then(setS)
  }

  const busy = !!offer && offer.state !== 'ready' && !!offer.installQueued
  const pct = offer?.percent ?? 0

  return (
    <AnimatePresence>
      {show && offer && (
        <motion.div
          key="update"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          className="fixed bottom-3 left-3 z-50 w-[280px] select-none overflow-hidden rounded-xl border border-[var(--border-default)] bg-popover/95 shadow-lg-dark backdrop-blur-xl"
          role="status"
        >
          <div className="flex items-start gap-2.5 px-3 pt-3">
            <div
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
            >
              <ArrowDownToLine size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-t1">New update available</div>
              <div className="tnum text-[11.5px] text-t3">
                v{offer.current} → v{offer.version}
              </div>
            </div>
            <button
              type="button"
              aria-label="Later"
              title="Later"
              onClick={() => setDismissed(offer.version ?? '')}
              className="-mr-1 rounded-md p-1 text-t4 transition-colors hover:bg-n4 hover:text-t2"
            >
              <X size={13} />
            </button>
          </div>

          {offer.state !== 'ready' && (
            <div className="mx-3 mt-2.5 h-1 overflow-hidden rounded-full bg-n4">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${Math.max(4, pct)}%`, background: 'var(--color-accent)' }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 px-3 pb-3 pt-2.5">
            <span className="tnum text-[11px] text-t4">
              {offer.state === 'ready' ? 'Downloaded · ready' : `Downloading… ${pct}%`}
            </span>
            <button
              type="button"
              onClick={install}
              disabled={busy}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:opacity-70"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              {offer.state === 'ready' ? 'Restart & update' : busy ? 'Updating…' : 'Update'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
