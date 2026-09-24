// ── clip target — where clipboard clips land ───────────────────────────
// Every mounted <Terminal> registers here and reports focus, so "attach"
// in ClipPeek / the clipboard panel goes to the terminal the user last
// clicked into — workspace pane or orchestration card alike — instead of
// guessing. Drags carry CLIP_MIME; Terminal accepts the drop and inserts
// the same text an attach would.

import { useSyncExternalStore, type DragEvent } from 'react'
import { getPty } from './ipc'

export const CLIP_MIME = 'application/x-terrarium-clip'

export type ClipPayload = { kind: 'image'; path: string } | { kind: 'text'; text: string }

interface TerminalHandle {
  el: HTMLElement
  paste(text: string): void
  focus(): void
}

const terminals = new Map<string, TerminalHandle[]>()
let lastSid: string | null = null
let version = 0
const subs = new Set<() => void>()
const notify = () => {
  version++
  subs.forEach((cb) => cb())
}

export function registerClipTerminal(sid: string, handle: TerminalHandle): () => void {
  terminals.set(sid, [...(terminals.get(sid) ?? []), handle])
  return () => {
    const rest = (terminals.get(sid) ?? []).filter((h) => h !== handle)
    if (rest.length) terminals.set(sid, rest)
    else terminals.delete(sid)
    if (lastSid === sid && !rest.length) notify()
  }
}

export function noteTerminalFocus(sid: string): void {
  if (lastSid === sid) return
  lastSid = sid
  notify()
}

/** The on-screen view of a session (a sid can be shown twice, e.g. focus view). */
function visibleHandle(sid: string): TerminalHandle | null {
  const all = terminals.get(sid) ?? []
  return all.find((h) => h.el.isConnected && h.el.offsetParent) ?? all[0] ?? null
}

/** Terminal the user last focused, while it's still mounted. */
export function activeClipTarget(): string | null {
  return lastSid && terminals.has(lastSid) ? lastSid : null
}

export function useClipTarget(): string | null {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version
  )
  return activeClipTarget()
}

/** What an attach types: an image's path (quoted when it has spaces), or the text. */
export function clipText(p: ClipPayload): string {
  if (p.kind === 'text') return p.text
  return /\s/.test(p.path) ? `"${p.path}"` : p.path
}

/** Insert into a terminal (bracketed paste through xterm). false = no target. */
export function insertClip(p: ClipPayload, sid: string | null = activeClipTarget()): boolean {
  if (!sid) return false
  const h = visibleHandle(sid)
  const text = clipText(p)
  // a path goes in with a trailing space so the next word doesn't glue on
  const out = p.kind === 'image' ? `${text} ` : text
  if (h) {
    h.paste(out)
    h.focus()
  } else {
    getPty()?.write(sid, out)
  }
  noteTerminalFocus(sid)
  return true
}

export function setClipDrag(e: DragEvent, p: ClipPayload): void {
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData(CLIP_MIME, JSON.stringify(p))
  e.dataTransfer.setData('text/plain', clipText(p))
}

export function readClipDrag(dt: DataTransfer): ClipPayload | null {
  const raw = dt.getData(CLIP_MIME)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as ClipPayload
    if (p.kind === 'image' && typeof p.path === 'string') return p
    if (p.kind === 'text' && typeof p.text === 'string') return p
  } catch {
    /* foreign payload */
  }
  return null
}

export function isClipDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(CLIP_MIME)
}

// ── host bridge (narrowed like ClipPeek — lib/ipc.ts predates it) ──
export interface ClipHistoryBridge {
  list(): Promise<{ images: { path: string; at: number }[]; texts: { id: string; text: string; at: number }[] }>
  thumb(path: string): Promise<{ dataUrl: string; width: number; height: number } | null>
  remove(kind: 'image' | 'text', id: string): Promise<boolean>
  copy(kind: 'image' | 'text', id: string): Promise<boolean>
  onText(cb: () => void): () => void
}

export function clipHistoryBridge(): ClipHistoryBridge | undefined {
  return (window.terrarium as { clipHistory?: ClipHistoryBridge } | undefined)?.clipHistory
}
