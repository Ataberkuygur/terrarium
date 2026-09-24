// ── terminal-render — which xterm renderer draws the text ────────────
// WebGL is fastest but antialiases glyphs in grayscale; on low-density
// screens (devicePixelRatio < ~1.75 — 100–150% Windows scaling, or any
// app zoom-out) that reads soft next to the ClearType UI around it. The
// DOM renderer draws real text through the browser and stays as crisp as
// the rest of the app. 'auto' picks by density; the choice is live — every
// terminal swaps renderer on the event below without losing its session.

export type TerminalRenderMode = 'auto' | 'crisp' | 'gpu'

const KEY = 'terrarium.terminal.renderer'
export const TERMINAL_RENDER_EVENT = 'terrarium:terminal-renderer'
/** A surface holding terminals just became visible — every pane repaints. */
export const TERMINALS_REPAINT_EVENT = 'terrarium:terminals-repaint'
/** At or above this density WebGL's grayscale AA is indistinguishable. */
const CRISP_BELOW_DPR = 1.75

export function terminalRenderMode(): TerminalRenderMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'crisp' || v === 'gpu' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function setTerminalRenderMode(mode: TerminalRenderMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* storage unavailable — the event still switches live terminals */
  }
  window.dispatchEvent(new CustomEvent(TERMINAL_RENDER_EVENT, { detail: mode }))
}

/** Should terminals use WebGL right now? */
export function webglPreferred(mode = terminalRenderMode()): boolean {
  if (mode === 'gpu') return true
  if (mode === 'crisp') return false
  return (window.devicePixelRatio || 1) >= CRISP_BELOW_DPR
}

/**
 * Font size whose rendered height is a whole number of device pixels —
 * fractional glyph sizes can't hint to the pixel grid and look smeared.
 */
export function pixelSnappedFont(cssSize: number, dpr = window.devicePixelRatio || 1): number {
  return Math.max(1, Math.round(cssSize * dpr)) / dpr
}

// ── WebGL context budget ─────────────────────────────────────────────
// Chromium keeps ~16 live WebGL contexts per renderer process and, past
// that, silently kills the OLDEST one (webglcontextlost) — i.e. some other
// terminal (or the Office three.js canvas) goes blank. Both workspace mode
// layers stay mounted, so pane counts add up fast. Cap how many terminals
// hold a context; the rest draw with the DOM renderer. After any loss,
// stop handing out new contexts for a while so fallbacks don't re-create
// contexts that evict yet another terminal (a blanking cascade).
const MAX_WEBGL_TERMINALS = 8
const LOSS_COOLDOWN_MS = 60_000
let liveWebgl = 0
let lastLossAt = 0

export function tryAcquireWebglSlot(): boolean {
  if (liveWebgl >= MAX_WEBGL_TERMINALS) return false
  if (lastLossAt && Date.now() - lastLossAt < LOSS_COOLDOWN_MS) return false
  liveWebgl++
  return true
}

export function releaseWebglSlot(): void {
  liveWebgl = Math.max(0, liveWebgl - 1)
}

export function noteWebglContextLoss(): void {
  lastLossAt = Date.now()
}

// ── coordinated texture-atlas rebuild ────────────────────────────────
// The WebGL addon SHARES one glyph atlas between every terminal with the
// same font/size/theme/dpr (CharAtlasCache). `clearTextureAtlas()` wipes
// the shared pages but only clears the CALLING terminal's render model —
// every other terminal on that atlas keeps vertices pointing at glyphs
// that no longer exist and draws blank until each cell changes again.
// So never clear one terminal's atlas alone: batch every live terminal's
// clear into a single synchronous pass (the first wipes the pages, the
// rest just drop their models — clearTexture no-ops on an empty atlas).
const atlasClearers = new Set<() => void>()
let atlasRaf = 0

export function registerAtlasClearer(fn: () => void): () => void {
  atlasClearers.add(fn)
  return () => {
    atlasClearers.delete(fn)
  }
}

export function requestAtlasRebuild(): void {
  if (atlasRaf) return
  atlasRaf = requestAnimationFrame(() => {
    atlasRaf = 0
    for (const fn of atlasClearers) {
      try {
        fn()
      } catch {
        /* disposed terminal */
      }
    }
  })
}
