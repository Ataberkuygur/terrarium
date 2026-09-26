// ── downloads — the Downloads panel's backing store ─────────────────────
// Lists the newest files in the OS Downloads folder (top level, finished
// downloads only), serves thumbnails — the image itself for pictures, the
// shell icon for everything else — and starts native file drags so an item
// can be dropped on a terminal (its path goes in) or out onto any other app
// (Explorer, a browser upload, a chat). The folder is watched; a change is
// pushed to the renderer as 'downloads:changed'. Every path a renderer sends
// back must resolve to a file directly inside the Downloads folder.

import { app, ipcMain, nativeImage, shell, type NativeImage } from 'electron'
import { basename, dirname, extname, join, resolve } from 'path'
import { promises as fs, watch, type FSWatcher } from 'fs'

export interface DownloadItem {
  path: string
  name: string
  size: number
  /** Last modified, ms epoch — when the download finished. */
  at: number
}

const CAP = 60
const THUMB_W = 240
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
/** In-flight / system entries — never shown. */
const SKIP = /\.(crdownload|part|partial|download|tmp|opdownload)$|^desktop\.ini$|^~\$|^\./i

let dir = ''
let watcher: FSWatcher | null = null
let changeTimer: ReturnType<typeof setTimeout> | null = null
const thumbs = new Map<string, { at: number; dataUrl: string; width: number; height: number }>()

async function list(): Promise<DownloadItem[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((e) => e.isFile() && !SKIP.test(e.name))
  const stats = await Promise.all(
    files.map(async (e) => {
      const path = join(dir, e.name)
      const st = await fs.stat(path).catch(() => null)
      return st ? { path, name: e.name, size: st.size, at: st.mtimeMs } : null
    })
  )
  return stats
    .filter((x): x is DownloadItem => !!x)
    .sort((a, b) => b.at - a.at)
    .slice(0, CAP)
}

/** Only a file directly inside Downloads — never an arbitrary renderer-supplied path. */
function ownFile(p: unknown): string | null {
  if (typeof p !== 'string' || !dir) return null
  const abs = resolve(p)
  return dirname(abs).toLowerCase() === resolve(dir).toLowerCase() && !SKIP.test(basename(abs)) ? abs : null
}

async function iconFor(abs: string): Promise<NativeImage> {
  return app.getFileIcon(abs, { size: 'large' }).catch(() => nativeImage.createEmpty())
}

async function thumb(p: unknown): Promise<{ dataUrl: string; width: number; height: number; icon: boolean } | null> {
  const abs = ownFile(p)
  if (!abs) return null
  const st = await fs.stat(abs).catch(() => null)
  if (!st) return null
  const hit = thumbs.get(abs)
  if (hit && hit.at === st.mtimeMs) return { ...hit, icon: !IMAGE_EXT.has(extname(abs).toLowerCase()) }
  let img = IMAGE_EXT.has(extname(abs).toLowerCase())
    ? nativeImage.createFromPath(abs)
    : nativeImage.createEmpty()
  const icon = img.isEmpty()
  if (icon) img = await iconFor(abs)
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  const small = !icon && width > THUMB_W ? img.resize({ width: THUMB_W }) : img
  const out = { at: st.mtimeMs, dataUrl: small.toDataURL(), width, height }
  if (thumbs.size > 200) thumbs.delete(thumbs.keys().next().value!)
  thumbs.set(abs, out)
  return { dataUrl: out.dataUrl, width, height, icon }
}

function watchDir(send: (channel: string, payload: unknown) => void): void {
  try {
    watcher = watch(dir, { persistent: false }, () => {
      // a download writes in bursts (temp file → rename) — settle first
      if (changeTimer) clearTimeout(changeTimer)
      changeTimer = setTimeout(() => {
        changeTimer = null
        send('downloads:changed', { at: Date.now() })
      }, 700)
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    watcher = null // folder missing / unreadable — the panel still lists on open
  }
}

export function registerDownloads(send: (channel: string, payload: unknown) => void): void {
  try {
    dir = app.getPath('downloads')
  } catch {
    return
  }
  watchDir(send)
  app.on('will-quit', () => watcher?.close())

  ipcMain.handle('dl:list', async () => ({ dir, files: await list() }))
  ipcMain.handle('dl:thumb', (_e, p: unknown) => thumb(p))
  ipcMain.handle('dl:open', async (_e, p: unknown) => {
    const abs = ownFile(p)
    return abs ? (await shell.openPath(abs)) === '' : false
  })
  ipcMain.handle('dl:reveal', (_e, p: unknown) => {
    const abs = ownFile(p)
    if (abs) shell.showItemInFolder(abs)
    else if (dir) void shell.openPath(dir)
    return !!abs
  })
  // Native drag (webContents.startDrag) — the only kind other apps accept.
  // Must be started from the renderer's dragstart, so it's a send, not invoke.
  // Synchronous on purpose: the OS drag has to begin while the button is
  // still down, so the icon comes from the thumbnail the panel already
  // loaded (never an async shell lookup here).
  ipcMain.on('dl:drag', (e, p: unknown) => {
    const abs = ownFile(p)
    if (!abs) return
    const cached = thumbs.get(abs)
    let icon = cached ? nativeImage.createFromDataURL(cached.dataUrl) : nativeImage.createEmpty()
    if (!icon.isEmpty() && icon.getSize().width > 64) icon = icon.resize({ width: 64 })
    if (icon.isEmpty()) icon = nativeImage.createFromDataURL(TRANSPARENT_PX)
    try {
      e.sender.startDrag({ file: abs, icon })
    } catch {
      /* drag already over / sender gone */
    }
  })
}

const TRANSPARENT_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
