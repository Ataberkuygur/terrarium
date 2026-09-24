// ── MobileButton — pair a phone with the LAN control server ──────────
// Titlebar popover: QR encoding the tokened URL + copyable link.
// The server lives in main (src/main/mobile.ts); this is just the door.

import { useEffect, useRef, useState } from 'react'
import { Smartphone, Copy, Check } from 'lucide-react'
import clsx from 'clsx'

interface MobileInfo {
  url: string
  host: string
  port: number
  ip: string
  qr: string
}

export function MobileButton() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<MobileInfo | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // fetch lazily on first open — QR generation isn't free
  useEffect(() => {
    if (!open || info !== undefined) return
    window.terrarium
      ?.mobileInfo?.()
      .then((i) => setInfo(i))
      .catch(() => setInfo(null))
  }, [open, info])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const copy = async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard denied — the URL is right there to read */
    }
  }

  return (
    <div ref={rootRef} className="no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Control from your phone"
        aria-label="Mobile control"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n4 hover:text-t1"
      >
        <Smartphone size={13} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="pop-surface pop-in absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl p-3">
          <p className="micro-label pb-2">Phone control</p>
          {info === undefined ? (
            <p className="py-6 text-center text-[12px] text-t4">…</p>
          ) : info === null ? (
            <p className="py-4 text-center text-[12px] leading-relaxed text-t4">
              LAN server off — no network interface or ports busy.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
                <img src={info.qr} alt="Scan to open mobile control" className="block w-full" />
              </div>
              <p className="pt-2 text-center text-[11px] leading-snug text-t3">
                Scan on the same Wi-Fi — crew, board &amp; nudges.
              </p>
              <button
                type="button"
                onClick={copy}
                className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n2 text-[11.5px] text-t2 transition-colors hover:text-t1"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Link copied' : 'Copy link'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
