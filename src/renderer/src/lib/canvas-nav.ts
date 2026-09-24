// ── canvas-nav — pan & zoom for pane surfaces ────────────────────────
// Canvas-style navigation for the workspace grid and the orchestration
// web, built in two layers so it is both smooth and sharp:
//
//   gesture  — the "world" element gets one GPU transform,
//              translate(x,y) scale(z / layoutZ), eased toward the target
//              every frame. No React work, no terminal refits.
//   at rest  — ~140ms after the gesture stops, `layoutZoom` commits: the
//              integrator re-lays content out at `rect * layoutZoom`
//              (terminal fonts scale with it — crisp glyphs) and the
//              transform's scale drops back to 1 in the same frame.
//
// Terminals under the world take `zoom` (see Terminal): font scales, the
// cols×rows grid stays put, so a zoom never resizes a pty.
//
// Gestures:  Ctrl/⌘ + wheel outside terminals → zoom around the pointer
//            (inside a terminal Ctrl+wheel stays that terminal's font zoom)
//            wheel over empty canvas → pan (Shift = horizontal)
//            drag empty canvas, or middle-drag anywhere → pan
//            double-click empty canvas → fit

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react'

export interface CanvasView {
  x: number
  y: number
  z: number
}

export const IDENTITY_VIEW: CanvasView = { x: 0, y: 0, z: 1 }

/** Settled canvas zoom — terminals under a pan/zoom surface scale by it. */
export const CanvasZoomContext = createContext(1)

export function useCanvasZoom(): number {
  return useContext(CanvasZoomContext)
}

/**
 * Saved views keyed by surface id (a network, the grid), persisted to
 * localStorage so pan/zoom survives tab/view switches, reloads and
 * restarts. Keeps the most recently saved `cap` entries.
 */
export function persistedViews(storageKey: string, cap = 40) {
  let views: Record<string, CanvasView> | null = null
  const all = (): Record<string, CanvasView> => {
    if (!views) {
      views = {}
      try {
        const raw = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, unknown>
        for (const [id, v] of Object.entries(raw ?? {})) {
          const { x, y, z } = (v ?? {}) as Record<string, unknown>
          if (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && z > 0 && Number.isFinite(x + y + z)) {
            views[id] = { x, y, z }
          }
        }
      } catch {
        /* corrupt / unavailable — start fresh */
      }
    }
    return views
  }
  return {
    get: (id: string): CanvasView | undefined => all()[id],
    set(id: string, v: CanvasView): void {
      const cur = all()
      delete cur[id] // re-insert last → insertion order = recency
      cur[id] = { x: v.x, y: v.y, z: v.z }
      const ids = Object.keys(cur)
      for (const old of ids.slice(0, Math.max(0, ids.length - cap))) delete cur[old]
      try {
        localStorage.setItem(storageKey, JSON.stringify(cur))
      } catch {
        /* storage full / unavailable — the in-memory copy still holds */
      }
    }
  }
}

export interface PanZoomOpts {
  min?: number
  max?: number
  /** Initial view (e.g. restored per network). */
  initial?: CanvasView
  /** Whether a pointer/wheel target counts as empty canvas. */
  isBackground?: (el: Element) => boolean
  /** Keep the view sane for the current viewport size (W×H). */
  clamp?: (v: CanvasView, W: number, H: number) => CanvasView
  /** Gestures off (e.g. while a card is blown up). */
  disabled?: boolean
  /** Double-click on empty canvas. */
  onFit?: () => void
  /** Called with the committed view (end of gesture). */
  onCommit?: (v: CanvasView) => void
  /** 'x' = horizontal-only canvas: the plain wheel pans sideways (pair it
   * with a clamp that pins y). Default 'both'. */
  panAxis?: 'x' | 'both'
}

export interface PanZoom {
  /** Committed view — `z` is the zoom content is laid out at. */
  view: CanvasView
  /** Same as view.z — lay content out at rect * layoutZoom. */
  layoutZoom: number
  /** A gesture is running — suspend layout transitions. */
  zooming: boolean
  /** Attach to the translated/scaled world element. */
  worldRef: RefObject<HTMLDivElement | null>
  /** Animate to a view. */
  setView(v: CanvasView, animate?: boolean): void
  /** Zoom by `factor` around a host-relative point (default: centre). */
  zoomBy(factor: number, cx?: number, cy?: number): void
}

interface Target extends CanvasView {
  /** Keep this screen point pinned to this world point while easing. */
  anchor?: { px: number; py: number; wx: number; wy: number }
}

const EASE = 0.3 // per-frame approach toward the target
const SETTLE_MS = 140

export function usePanZoom(hostRef: RefObject<HTMLElement | null>, opts: PanZoomOpts = {}): PanZoom {
  const min = opts.min ?? 0.4
  const max = opts.max ?? 2.5
  const worldRef = useRef<HTMLDivElement | null>(null)
  const initial = opts.initial ?? IDENTITY_VIEW
  const [view, setViewState] = useState<CanvasView>(initial)
  const [zooming, setZooming] = useState(false)
  const live = useRef<CanvasView>(initial)
  const target = useRef<Target>(initial)
  const layoutZ = useRef(initial.z)
  layoutZ.current = view.z
  const optsRef = useRef(opts)
  optsRef.current = opts

  const size = () => {
    const el = hostRef.current
    return { W: el?.clientWidth ?? 0, H: el?.clientHeight ?? 0 }
  }
  const clampView = (v: CanvasView): CanvasView => {
    const z = Math.min(max, Math.max(min, v.z))
    const { W, H } = size()
    const c = optsRef.current.clamp
    return c ? c({ ...v, z }, W, H) : { ...v, z }
  }
  const paint = () => {
    const w = worldRef.current
    if (!w) return
    const v = live.current
    const s = v.z / layoutZ.current
    // whole DEVICE pixels: an offset that splits a device pixel makes the
    // compositor resample terminal canvases — soft text
    const dpr = window.devicePixelRatio || 1
    const x = Math.round(v.x * dpr) / dpr
    const y = Math.round(v.y * dpr) / dpr
    w.style.transformOrigin = '0 0'
    if (Math.abs(s - 1) > 1e-4) {
      // mid-gesture: GPU layer, smoothness over sharpness
      w.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`
    } else {
      // at rest: no forced compositing layer (it drops text to grayscale
      // AA and can resample) — a plain 2D offset, or nothing at all
      w.style.transform = x || y ? `translate(${x}px, ${y}px)` : ''
    }
  }

  // React never owns the transform — re-apply after every render (this is
  // also where a settle's new layoutZ drops the scale back to 1)
  useLayoutEffect(paint)

  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const gesture = useRef(false)
  const settle = useCallback(() => {
    clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      const v = { ...live.current }
      setViewState(v)
      optsRef.current.onCommit?.(v)
      // transitions stay off through the relayout frame
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          gesture.current = false
          setZooming(false)
          // terminals re-align to device pixels at their new position
          window.dispatchEvent(new Event('terrarium:layout-settled'))
        })
      )
    }, SETTLE_MS)
  }, [])
  const beginGesture = () => {
    clearTimeout(settleTimer.current)
    if (!gesture.current) {
      gesture.current = true
      setZooming(true)
    }
  }

  // one rAF loop eases live → target; exact when anchored (cursor zoom)
  const raf = useRef(0)
  const tick = useCallback(() => {
    raf.current = 0
    const cur = live.current
    const t = target.current
    const lz = Math.log(cur.z) + (Math.log(t.z) - Math.log(cur.z)) * EASE
    let z = Math.exp(lz)
    const done = Math.abs(Math.log(t.z) - lz) < 0.002
    if (done) z = t.z
    let x: number
    let y: number
    if (t.anchor) {
      x = t.anchor.px - t.anchor.wx * z
      y = t.anchor.py - t.anchor.wy * z
    } else {
      x = done ? t.x : cur.x + (t.x - cur.x) * EASE
      y = done ? t.y : cur.y + (t.y - cur.y) * EASE
    }
    const settled = done && Math.abs(x - t.x) < 0.5 && Math.abs(y - t.y) < 0.5
    live.current = settled ? { x: t.x, y: t.y, z: t.z } : { x, y, z }
    paint()
    if (settled) settle()
    else raf.current = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle])
  const run = () => {
    beginGesture()
    if (!raf.current) raf.current = requestAnimationFrame(tick)
  }

  const setView = useCallback(
    (v: CanvasView, animate = true) => {
      const c = clampView(v)
      target.current = c
      if (!animate) {
        live.current = c
        beginGesture()
        paint()
        settle()
        return
      }
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, settle, tick]
  )

  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const { W, H } = size()
      const px = cx ?? W / 2
      const py = cy ?? H / 2
      const base = target.current
      const z = Math.min(max, Math.max(min, base.z * factor))
      if (z === base.z) return
      // pin the world point under the cursor (as currently seen)
      const cur = live.current
      const wx = (px - cur.x) / cur.z
      const wy = (py - cur.y) / cur.z
      const c = clampView({ z, x: px - wx * z, y: py - wy * z })
      const pinned = Math.abs(c.x - (px - wx * z)) < 0.5 && Math.abs(c.y - (py - wy * z)) < 0.5
      target.current = pinned ? { ...c, anchor: { px, py, wx, wy } } : c
      run()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, tick]
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const isBg = (t: EventTarget | null) =>
      t instanceof Element && (optsRef.current.isBackground?.(t) ?? t === host)
    // direct manipulation: live and target move together, no easing
    const jumpTo = (v: CanvasView) => {
      const c = clampView(v)
      live.current = c
      target.current = c
      paint()
    }

    const onWheel = (e: WheelEvent) => {
      if (optsRef.current.disabled) return
      // inside a terminal the wheel is the terminal's: plain = scrollback,
      // Ctrl = that terminal's own font zoom — the canvas zooms outside it
      if (e.target instanceof Element && e.target.closest('.terrarium-terminal')) return
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const r = host.getBoundingClientRect()
        const unit = e.deltaMode === 1 ? 0.05 : 0.0022
        const d = Math.max(-240, Math.min(240, e.deltaY))
        zoomBy(Math.exp(-d * unit), e.clientX - r.left, e.clientY - r.top)
        return
      }
      if (!isBg(e.target)) return
      e.preventDefault()
      cancelAnimationFrame(raf.current)
      raf.current = 0
      const cur = live.current
      if (optsRef.current.panAxis === 'x') {
        // either wheel axis scrolls the strip sideways
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        jumpTo({ ...cur, x: cur.x - d })
      } else {
        jumpTo({
          ...cur,
          x: cur.x - (e.shiftKey ? e.deltaY : e.deltaX),
          y: cur.y - (e.shiftKey ? 0 : e.deltaY)
        })
      }
      beginGesture()
      settle()
    }

    let drag: { id: number; sx: number; sy: number; ox: number; oy: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (optsRef.current.disabled) return
      const middle = e.button === 1
      if (!middle && !(e.button === 0 && isBg(e.target))) return
      if (middle) e.preventDefault() // no autoscroll puck
      cancelAnimationFrame(raf.current)
      raf.current = 0
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: live.current.x, oy: live.current.y }
      host.style.cursor = 'grabbing'
      beginGesture()
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      jumpTo({ ...live.current, x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy })
    }
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return
      drag = null
      host.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      settle()
    }
    const onDbl = (e: MouseEvent) => {
      if (!optsRef.current.disabled && isBg(e.target)) optsRef.current.onFit?.()
    }
    // middle-click autoscroll / paste — swallowed on the canvas
    const onAux = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }

    // The host is overflow:hidden but still scrollable by the browser —
    // typing into a terminal's hidden textarea (or focusing anything near
    // an edge) scrolls it into view, shifting the world behind the view's
    // back. The view owns all movement: pin the host's scroll at 0.
    const onScroll = () => {
      if (host.scrollLeft || host.scrollTop) {
        host.scrollLeft = 0
        host.scrollTop = 0
      }
    }

    host.addEventListener('scroll', onScroll)
    host.addEventListener('wheel', onWheel, { passive: false, capture: true })
    host.addEventListener('pointerdown', onDown, { capture: true })
    host.addEventListener('dblclick', onDbl)
    host.addEventListener('auxclick', onAux)
    host.addEventListener('mousedown', onAux)
    return () => {
      host.removeEventListener('scroll', onScroll)
      host.removeEventListener('wheel', onWheel, { capture: true })
      host.removeEventListener('pointerdown', onDown, { capture: true })
      host.removeEventListener('dblclick', onDbl)
      host.removeEventListener('auxclick', onAux)
      host.removeEventListener('mousedown', onAux)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef, zoomBy, settle])

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current)
      cancelAnimationFrame(raf.current)
      // unmounted mid-gesture (tab switch right after a zoom) — commit
      // where it was headed so a restored view doesn't jump back
      if (gesture.current) {
        const t = target.current
        optsRef.current.onCommit?.({ x: t.x, y: t.y, z: t.z })
      }
    },
    []
  )

  return { view, layoutZoom: view.z, zooming, worldRef, setView, zoomBy }
}

/** View that fits `bounds` (world units at z=1) into W×H, centred, never above `maxZ`. */
export function fitView(
  bounds: { x: number; y: number; w: number; h: number },
  W: number,
  H: number,
  maxZ = 1,
  margin = 16
): CanvasView {
  const z = Math.min(
    maxZ,
    (W - 2 * margin) / Math.max(1, bounds.w),
    (H - 2 * margin) / Math.max(1, bounds.h)
  )
  return {
    z,
    x: (W - bounds.w * z) / 2 - bounds.x * z,
    y: (H - bounds.h * z) / 2 - bounds.y * z
  }
}
