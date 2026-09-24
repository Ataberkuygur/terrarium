// ── app zoom — whole-UI scale, owned by main ─────────────────────────
// Electron's default menu zooms the page on Ctrl+= / Ctrl+- / Ctrl+0, but
// the Windows caption buttons (titleBarOverlay) stay 40 device px tall —
// zoom out and the app's own bars slide underneath them. Main owns zoom
// instead: the shortcuts are intercepted before the menu sees them, the
// overlay height follows the factor, the factor persists across launches
// and the renderer is told so its titlebar can keep the caption lane clear.
//
// Page zoom changes devicePixelRatio, so xterm re-rasterises crisply; the
// terminals' CSS-px area changes, so their grids refit (the pty resize is
// debounced in Terminal — one redraw per zoom step, not a storm).

import { ipcMain, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ZOOM_IPC = {
  get: 'terrarium:zoom:get',
  set: 'terrarium:zoom:set',
  changed: 'terrarium:zoom:changed'
} as const

/** Matches the renderer titlebar's h-10 at zoom 1. */
const TITLEBAR_H = 40
const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const MIN = STEPS[0]
const MAX = STEPS[STEPS.length - 1]

let current = 1
let handlersBound = false
/** Latest window's apply — IPC handlers are bound once, windows may come back (macOS). */
let applyLatest: ((f: number) => void) | null = null

function read(file: string): number {
  try {
    const f = Number((JSON.parse(readFileSync(file, 'utf8')) as { factor?: unknown }).factor)
    return Number.isFinite(f) && f >= MIN && f <= MAX ? f : 1
  } catch {
    return 1
  }
}

export function initAppZoom(win: BrowserWindow, home: string): void {
  const file = join(home, 'zoom.json')
  current = read(file)

  const apply = (factor: number) => {
    if (win.isDestroyed()) return
    const f = Math.min(MAX, Math.max(MIN, Math.round(factor * 100) / 100))
    current = f
    win.webContents.setZoomFactor(f)
    if (process.platform !== 'darwin') {
      try {
        win.setTitleBarOverlay({
          color: '#0a0b0d',
          symbolColor: '#ecedef',
          height: Math.round(TITLEBAR_H * f)
        })
      } catch {
        /* no overlay on this platform/config */
      }
    }
    try {
      writeFileSync(file, JSON.stringify({ factor: f }))
    } catch {
      /* non-fatal */
    }
    win.webContents.send(ZOOM_IPC.changed, f)
  }
  applyLatest = apply
  const step = (dir: 1 | -1) => {
    const i = STEPS.findIndex((s) => s >= current - 1e-3)
    const at = i === -1 ? STEPS.length - 1 : i
    const exact = Math.abs(STEPS[at] - current) < 1e-3
    const next = dir > 0 ? STEPS[Math.min(STEPS.length - 1, exact ? at + 1 : at)] : STEPS[Math.max(0, at - 1)]
    apply(next)
  }

  // a reload resets page zoom state in the renderer — re-assert it
  win.webContents.on('did-finish-load', () => apply(current))

  // shortcuts before the default menu's zoom roles (preventDefault here
  // suppresses both the page keydown and the menu accelerator)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
    const k = input.key
    const code = input.code
    if (k === '=' || k === '+' || code === 'NumpadAdd') {
      e.preventDefault()
      step(1)
    } else if (k === '-' || k === '_' || code === 'NumpadSubtract') {
      e.preventDefault()
      step(-1)
    } else if ((k === '0' || code === 'Numpad0') && !input.shift) {
      e.preventDefault()
      apply(1)
    }
  })

  // Ctrl+wheel outside the pan/zoom canvases (they swallow it themselves)
  win.webContents.on('zoom-changed', (_e, dir) => step(dir === 'in' ? 1 : -1))

  if (!handlersBound) {
    handlersBound = true
    ipcMain.handle(ZOOM_IPC.get, () => current)
    ipcMain.handle(ZOOM_IPC.set, (_e, f: unknown) => {
      if (typeof f === 'number' && Number.isFinite(f)) applyLatest?.(f)
      return current
    })
  }
}
