// ── clip peek ────────────────────────────────────────────────────────
// Edge peek for clipboard images. Main watches the system clipboard and
// pushes `clipboard:image` events (a ≤360px thumbnail dataURL plus the
// saved PNG path under ~/.terrarium/clipboard/) — see src/preload/index.ts.
// Each event slides this card in from the right edge with a pop, holds
// for 12s, and pauses while hovered; the newest event always wins and
// re-arms the timer. In a plain browser `window.terrarium` is absent, so
// nothing subscribes and the panel never renders.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, FolderOpen, ImageIcon, Paperclip, X } from 'lucide-react'
import type { TaskCard } from '@shared/types'
import { spawnPop } from '../lib/sfx'
import { getEngine } from '../lib/ipc'
import { useApp } from '../lib/store'
import { Button } from './ui'

/** payload pushed by main on `clipboard:image` */
interface ClipboardImage {
  dataUrl: string
  path: string
  width: number
  height: number
  at: number
}

// The Window.terrarium declaration in lib/ipc.ts predates the clipboard
// bridge — narrow to the members this panel needs rather than widening
// shared types from a leaf component.
interface ClipboardBridge {
  onClipboardImage?: (cb: (e: ClipboardImage) => void) => () => void
  showItem?: (path: string) => Promise<unknown>
}

function clipboardBridge(): ClipboardBridge | undefined {
  return window.terrarium as ClipboardBridge | undefined
}

const HOLD_MS = 12_000
const COPIED_MS = 1_200

export function ClipPeek() {
  const [clip, setClip] = useState<ClipboardImage | null>(null)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  // card picker open — the auto-dismiss timer stays parked while choosing
  const [picking, setPicking] = useState(false)
  const cards = useApp((s) => s.cards)
  const agents = useApp((s) => s.agents)
  const dismissTimer = useRef<number | null>(null)
  const copiedTimer = useRef<number | null>(null)
  const hovered = useRef(false)

  const clearDismiss = useCallback(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
  }, [])

  const armDismiss = useCallback(() => {
    clearDismiss()
    dismissTimer.current = window.setTimeout(() => setVisible(false), HOLD_MS)
  }, [clearDismiss])

  // subscribe once — no-op outside Electron
  useEffect(() => {
    const off = clipboardBridge()?.onClipboardImage?.((e) => {
      setClip(e)
      setCopied(false)
      setPicking(false)
      setVisible(true)
      spawnPop()
      // while hovered the leave handler re-arms — never fire under the cursor
      if (!hovered.current) armDismiss()
    })
    return () => {
      off?.()
      clearDismiss()
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current)
        copiedTimer.current = null
      }
    }
  }, [armDismiss, clearDismiss])

  const copyPath = () => {
    if (!clip) return
    navigator.clipboard?.writeText(clip.path).then(
      () => {
        setCopied(true)
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
        copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      },
      () => {
        /* clipboard write denied — leave the button honest */
      }
    )
  }

  const reveal = () => {
    if (clip) void clipboardBridge()?.showItem?.(clip.path)
  }

  // ── attach-to-card ──
  // The peek holds the absolute PNG path (clip.path); attaching appends a
  // markdown image embed to the card body via the engine, then closes.
  const startPick = () => {
    clearDismiss() // choosing a card can outlast HOLD_MS — park the timer
    setPicking(true)
  }

  const cancelPick = () => {
    setPicking(false)
    if (!hovered.current) armDismiss()
  }

  const attach = (card: TaskCard) => {
    if (!clip) return
    const body = (card.body ? card.body + '\n\n' : '') + `![clipboard](<${clip.path}>)`
    void getEngine().updateCard(card.id, { body })
    setPicking(false)
    setVisible(false)
  }

  const openCards = cards.filter((c) => c.status !== 'done')
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name

  return (
    <AnimatePresence>
      {visible && clip !== null && (
        <motion.aside
          key={clip.at}
          aria-label="Clipboard image"
          className="fixed top-14 right-3 z-40 w-[300px] select-none overflow-hidden rounded-xl border border-[var(--border-default)] bg-popover/95 shadow-[var(--shadow-pop)] backdrop-blur-xl"
          initial={{ x: '115%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '115%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          onMouseEnter={() => {
            hovered.current = true
            clearDismiss()
          }}
          onMouseLeave={() => {
            hovered.current = false
            if (!picking) armDismiss()
          }}
        >
          {/* header — kind + dims + dismiss */}
          <div className="pane-head flex h-10 items-center gap-2 border-b border-[var(--border-subtle)] pr-1.5 pl-3">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-subtle text-accent">
              <ImageIcon size={11} strokeWidth={2} />
            </span>
            <span className="text-[12px] font-medium text-t1">Clipboard image</span>
            <span className="tnum ml-auto rounded-full bg-n3 px-1.5 text-[10px] leading-4 font-medium text-t3">
              {clip.width}×{clip.height}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVisible(false)}
              aria-label="Dismiss"
            >
              <X size={13} />
            </Button>
          </div>

          {/* thumbnail */}
          <div className="p-2.5">
            <img
              src={clip.dataUrl}
              alt={`Clipboard capture ${clip.width}×${clip.height}`}
              title={clip.path}
              draggable={false}
              className="h-auto max-h-[280px] w-full rounded-lg border border-[var(--border-subtle)] bg-sunken object-contain"
            />
          </div>

          {/* actions / attach picker — picking swaps the grid for a card list */}
          {picking ? (
            <div className="border-t border-[var(--border-subtle)] px-2.5 py-2">
              <div className="mb-1 flex items-center gap-2 pl-1">
                <span className="micro-label">Attach to card</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={cancelPick}
                  aria-label="Back"
                  className="ml-auto h-5 w-5"
                >
                  <X size={12} />
                </Button>
              </div>
              {openCards.length === 0 ? (
                <p className="py-3 text-center text-[11.5px] text-t4">
                  No open cards — create one on the board.
                </p>
              ) : (
                <div className="scroll-thin max-h-[180px] overflow-y-auto">
                  {openCards.map((c) => {
                    const who = agentName(c.assigneeId)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => attach(c)}
                        title={c.title}
                        className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] text-t2 transition-colors hover:bg-n4 hover:text-t1"
                      >
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className="shrink-0 text-[10.5px] text-t4">
                          {who ? `${who} · ` : ''}
                          {c.status}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 border-t border-[var(--border-subtle)] px-2.5 py-2">
              <Button variant="secondary" size="md" onClick={copyPath}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy path'}
              </Button>
              <Button variant="ghost" size="md" onClick={reveal}>
                <FolderOpen size={13} />
                Reveal
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={startPick}
                className="col-span-2 w-full"
              >
                <Paperclip size={13} />
                Attach to card…
              </Button>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

export default ClipPeek
