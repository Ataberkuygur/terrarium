// ── clip history — the clipboard panel's backing store ─────────────────
// Images: the watcher in index.ts already saves every copied image as
// ~/.terrarium/clipboard/clip-<ms>.png; this lists them and serves cached
// thumbnails. Texts: polled on the same tick, deduped (a re-copy moves to
// the top), capped, persisted to texts.json. Copies flagged by password
// managers (ExcludeClipboardContentFromMonitorProcessing) are never kept.

import { clipboard, ClipboardItem, ipcMain, nativeImage } from 'electron'
import { join, resolve, sep } from 'path'
import { promises as fs, mkdirSync, readFileSync, writeFileSync } from 'fs'

export interface ClipText {
  id: string
  text: string
  at: number
}

export interface ClipImage {
  path: string
  at: number
}

const TEXT_CAP = 50
const TEXT_MAX_CHARS = 20_000
const IMAGE_CAP = 120
const THUMB_W = 240
const MUTE_MS = 2500
const SECRET_FORMATS = [
  'ExcludeClipboardContentFromMonitorProcessing',
  'Clipboard Viewer Ignore'
].map((f) => `electron application/osclipboard;format="${f}"`)

let dir = ''
let texts: ClipText[] = []
let lastText: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let muteUntil = 0
const thumbs = new Map<string, { dataUrl: string; width: number; height: number }>()

const textsFile = () => join(dir, 'texts.json')

function loadTexts(): void {
  try {
    const raw = JSON.parse(readFileSync(textsFile(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return
    texts = raw
      .filter(
        (t): t is ClipText =>
          !!t && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.at === 'number'
      )
      .slice(0, TEXT_CAP)
  } catch {
    texts = []
  }
}

function saveTexts(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(textsFile(), JSON.stringify(texts))
    } catch {
      /* disk hiccup — next change retries */
    }
  }, 400)
}

/** A copy made from the panel itself shouldn't come back as a "new" clip. */
export function clipImageMuted(): boolean {
  return Date.now() < muteUntil
}

async function isSecret(): Promise<boolean> {
  for (const f of SECRET_FORMATS) {
    if (await clipboard.has(f).catch(() => false)) return true
  }
  return false
}

/** One watcher tick for text — cheap: has() gate, then a string compare. */
export async function pollClipboardText(send: (channel: string, payload: unknown) => void): Promise<void> {
  if (!dir) return
  if (!(await clipboard.has('text/plain'))) return
  const text = await clipboard.readText()
  if (text === lastText) return
  const first = lastText === null
  lastText = text
  // the clipboard as it stood at launch is history already, not a new copy
  if (first && texts.some((t) => t.text === text)) return
  if (!text.trim() || (await isSecret())) return
  const body = text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text
  const at = Date.now()
  texts = [{ id: `t${at}`, text: body, at }, ...texts.filter((t) => t.text !== body)].slice(0, TEXT_CAP)
  saveTexts()
  send('clipboard:text', { at })
}

async function listImages(): Promise<ClipImage[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  return names
    .map((n) => /^clip-(\d+)\.png$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ path: join(dir, m[0]), at: Number(m[1]) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, IMAGE_CAP)
}

/** Only files the watcher wrote — never an arbitrary renderer-supplied path. */
function ownImage(p: unknown): string | null {
  if (typeof p !== 'string') return null
  const abs = resolve(p)
  if (!abs.startsWith(resolve(dir) + sep)) return null
  return /[\\/]clip-\d+\.png$/.test(abs) ? abs : null
}

async function thumb(p: unknown): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const abs = ownImage(p)
  if (!abs) return null
  const hit = thumbs.get(abs)
  if (hit) return hit
  const buf = await fs.readFile(abs).catch(() => null)
  if (!buf) return null
  const img = nativeImage.createFromBuffer(buf)
  const { width, height } = img.getSize()
  const small = width > THUMB_W ? img.resize({ width: THUMB_W }) : img
  const out = { dataUrl: small.toDataURL(), width, height }
  if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value!)
  thumbs.set(abs, out)
  return out
}

export function registerClipHistory(home: string): void {
  dir = join(home, 'clipboard')
  loadTexts()

  ipcMain.handle('clip:list', async () => ({ images: await listImages(), texts }))
  ipcMain.handle('clip:thumb', (_e, p: unknown) => thumb(p))
  ipcMain.handle('clip:remove', async (_e, ref: { kind: 'image' | 'text'; id: string }) => {
    if (ref?.kind === 'text') {
      texts = texts.filter((t) => t.id !== ref.id)
      saveTexts()
      return true
    }
    const abs = ownImage(ref?.id)
    if (!abs) return false
    thumbs.delete(abs)
    await fs.unlink(abs).catch(() => {})
    return true
  })
  ipcMain.handle('clip:copy', async (_e, ref: { kind: 'image' | 'text'; id: string }) => {
    if (ref?.kind === 'text') {
      const t = texts.find((x) => x.id === ref.id)
      if (!t) return false
      await clipboard.writeText(t.text)
      return true
    }
    const abs = ownImage(ref?.id)
    const buf = abs ? await fs.readFile(abs).catch(() => null) : null
    if (!buf) return false
    muteUntil = Date.now() + MUTE_MS
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })])
    return true
  })
}
