// ── Tethers — hub ↔ subagent connectors ──────────────────────────────
// One SVG under the cards: a thin, quiet curve from each subagent to the
// hub. The line brightens slightly while its subagent is producing
// output; nothing else moves.
//
// The drawn geometry eases toward the layout at roughly the cards' CSS
// transition pace, so lines stay glued to gliding cards. A single ~30fps
// rAF loop writes `d` straight onto the path nodes — no React re-render
// per frame; paused while the window is hidden. Attributes are written
// only when their value changes (easing snaps once within a hair of the
// target), so a settled canvas costs no paint at all.

import { useEffect, useRef } from 'react'
import { nodeIo } from '../lib/orchestration'
import { tetherGeom, type NetworkLayout, type Rect, type Slot } from './layout'

interface TetherRefs {
  line?: SVGPathElement | null
  capA?: SVGCircleElement | null
  capB?: SVGCircleElement | null
  /** Last values written — skip identical writes (each one repaints the SVG). */
  d?: string
  op?: string
  a?: string
  b?: string
}

/** Within this many world px the ease lands — else it creeps forever. */
const SNAP_PX = 0.05

export function Tethers({
  W,
  H,
  layout,
  sids,
  dimmed,
  z = 1,
  snap = false
}: {
  W: number
  H: number
  /** Canvas zoom — lines are drawn in world units and scaled. */
  z?: number
  /** Track the layout 1:1 (dragging/zooming) instead of easing. */
  snap?: boolean
  layout: NetworkLayout
  /** Session id per slot, same order as layout.slots. */
  sids: string[]
  /** A card is blown up — the lines recede. */
  dimmed: boolean
}) {
  const refs = useRef<TetherRefs[]>([])
  const live = useRef({ W, H, layout, sids, snap })
  live.current = { W, H, layout, sids, snap }

  useEffect(() => {
    const shown: { hub?: Rect; slots: Slot[] } = { slots: [] }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let raf = 0
    let last = 0
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || ts - last < 33) return
      last = ts
      const { W, H, layout, sids, snap } = live.current
      const now = Date.now()
      const k = reduce || snap ? 1 : 0.26
      const step = (c: number, t: number) => (Math.abs(t - c) < SNAP_PX ? t : c + (t - c) * k)
      const ease = (cur: Rect | undefined, to: Rect): Rect =>
        cur
          ? { x: step(cur.x, to.x), y: step(cur.y, to.y), w: step(cur.w, to.w), h: step(cur.h, to.h) }
          : { ...to }
      const hub = (shown.hub = ease(shown.hub, layout.hub))
      shown.slots.length = layout.slots.length
      layout.slots.forEach((target, i) => {
        const r = refs.current[i]
        const slot = (shown.slots[i] = { ...ease(shown.slots[i], target), side: target.side })
        if (!r?.line) return
        const g = tetherGeom(slot, hub)
        const [ax, ay] = g.a
        const [bx, by] = g.b
        const L = Math.min(160, Math.max(24, Math.hypot(bx - ax, by - ay) * 0.45))
        const f = (v: number) => v.toFixed(1)
        const d =
          `M${f(ax)},${f(ay)} C${f(ax + g.na[0] * L)},${f(ay + g.na[1] * L)} ` +
          `${f(bx + g.nb[0] * L)},${f(by + g.nb[1] * L)} ${f(bx)},${f(by)}`
        if (d !== r.d) {
          r.d = d
          r.line.setAttribute('d', d)
        }
        const sid = sids[i]
        const out = sid ? nodeIo(sid).outAt : 0
        const active = out ? Math.max(0, 1 - (now - out) / 2500) : 0
        // ~12 brightness levels — a decaying glow, not 30 repaints a second
        const op = (0.14 + 0.22 * Math.round(active * 12) / 12).toFixed(3)
        if (op !== r.op) {
          r.op = op
          r.line.setAttribute('stroke-opacity', op)
        }
        const a = `${f(ax)},${f(ay)}`
        if (a !== r.a) {
          r.a = a
          r.capA?.setAttribute('cx', f(ax))
          r.capA?.setAttribute('cy', f(ay))
        }
        const b = `${f(bx)},${f(by)}`
        if (b !== r.b) {
          r.b = b
          r.capB?.setAttribute('cx', f(bx))
          r.capB?.setAttribute('cy', f(by))
        }
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <svg
      width={W * z}
      height={H * z}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      style={{ transition: 'opacity 240ms ease', opacity: dimmed ? 0.3 : 1 }}
      aria-hidden
    >
      <g transform={`scale(${z})`} fill="none">
        {layout.slots.map((_, i) => {
          const r = (refs.current[i] ??= {})
          return (
            <g key={i}>
              <path
                ref={(el) => {
                  // a fresh element has none of the cached attributes
                  if (el !== r.line) r.d = r.op = undefined
                  r.line = el
                }}
                stroke="#ffffff"
                strokeOpacity={0.14}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle ref={(el) => {
                  if (el !== r.capA) r.a = undefined
                  r.capA = el
                }} r={2} fill="rgba(255,255,255,0.28)" />
              <circle ref={(el) => {
                  if (el !== r.capB) r.b = undefined
                  r.capB = el
                }} r={2} fill="rgba(255,255,255,0.28)" />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
