// ── app-zoom — whole-UI zoom, renderer side ──────────────────────────
// Main owns the factor (src/main/app-zoom.ts: webContents zoom + caption
// overlay height + persistence + Ctrl+= / Ctrl+- / Ctrl+0). This is the
// shared hook the titlebar pill and the Settings section read. A preload
// that predates the API (app not restarted since the update) reports
// `available: false` so the UI can say so instead of silently vanishing.

import { useEffect, useState } from 'react'

export const APP_ZOOM_MIN = 0.5
export const APP_ZOOM_MAX = 2
/** Quick picks shown in Settings. */
export const APP_ZOOM_PRESETS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const
/** −/+ walk this ladder (mirrors main's Ctrl+= / Ctrl+- steps). */
const LADDER = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export interface AppZoom {
  /** Current factor (1 = 100%). */
  factor: number
  /** False until the app restarts onto a preload that exposes zoom. */
  available: boolean
  set(factor: number): void
  /** One rung up (+1) or down (-1) the zoom ladder. */
  step(dir: 1 | -1): void
  reset(): void
}

export function useAppZoom(): AppZoom {
  const api = window.terrarium?.appZoom
  const [factor, setFactor] = useState(1)
  useEffect(() => {
    if (!api) return
    void api.get().then(setFactor).catch(() => undefined)
    return api.onChange(setFactor)
  }, [api])
  const set = (f: number) => {
    if (!api) return
    const clamped = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, f))
    void api.set(clamped).then(setFactor).catch(() => undefined)
  }
  return {
    factor,
    available: !!api,
    set,
    step: (dir) => {
      const next =
        dir > 0
          ? LADDER.find((s) => s > factor + 0.001)
          : [...LADDER].reverse().find((s) => s < factor - 0.001)
      set(next ?? factor)
    },
    reset: () => set(1)
  }
}
