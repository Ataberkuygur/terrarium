// ── CanvasControls — zoom pill + optional minimap ─────────────────────
// Floating bottom-left chrome (bottom-right belongs to the Office dock) for pan/zoom surfaces (lib/canvas-nav).
// The minimap draws item rects in world units with the visible viewport
// on top; click or drag it to move the view there.

import { useRef, type ReactNode } from 'react'
import { Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import type { CanvasView } from '../lib/canvas-nav'

export interface MinimapItem {
  x: number
  y: number
  w: number
  h: number
  /** Accent-filled (the hub). */
  hub?: boolean
  /** Status-coloured edge. */
  color?: string
}

const btn =
  'flex h-6 w-6 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-30'

export function CanvasControls({
  view,
  onZoom,
  onFit,
  onReset,
  resetTitle,
  minimap,
  hint
}: {
  view: CanvasView
  /** Multiply zoom (around the viewport centre). */
  onZoom: (factor: number) => void
  onFit: () => void
  /** Optional extra action (e.g. restore auto-layout). */
  onReset?: () => void
  resetTitle?: string
  minimap?: {
    items: MinimapItem[]
    /** Viewport size in screen px. */
    W: number
    H: number
    /** Move the view so world point (wx, wy) is centred. */
    onJump: (wx: number, wy: number) => void
  }
  hint?: ReactNode
}) {
  return (
    <div
      data-canvas-ui
      className="pointer-events-auto absolute bottom-3 left-3 z-40 flex flex-col items-start gap-1.5 opacity-60 transition-opacity duration-150 select-none hover:opacity-100"
    >
      {minimap && minimap.items.length > 1 && <Minimap view={view} {...minimap} />}
      <div className="flex h-8 items-center gap-px rounded-[10px] border border-[var(--border-default)] bg-[rgba(22,23,27,0.86)] bg-[image:var(--grad-chrome)] p-[3px] shadow-[var(--shadow-pop)] backdrop-blur-xl">
        {hint && <span className="px-2 text-[10.5px] text-t4">{hint}</span>}
        <button type="button" className={btn} title="Zoom out (Ctrl+wheel)" onClick={() => onZoom(1 / 1.2)}>
          <Minus size={12} />
        </button>
        <button
          type="button"
          onClick={onFit}
          title="Fit (double-click empty canvas)"
          className="tnum h-6 min-w-[44px] rounded-md px-1 text-[11px] font-medium text-t2 transition-colors hover:bg-n4 hover:text-t1"
        >
          {Math.round(view.z * 100)}%
        </button>
        <button type="button" className={btn} title="Zoom in (Ctrl+wheel)" onClick={() => onZoom(1.2)}>
          <Plus size={12} />
        </button>
        <span className="mx-1 h-3.5 w-px bg-[var(--border-default)]" />
        <button type="button" className={btn} title="Fit everything in view" onClick={onFit}>
          <Maximize size={11} />
        </button>
        {onReset && (
          <button type="button" className={btn} title={resetTitle ?? 'Reset'} onClick={onReset}>
            <RotateCcw size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

function Minimap({
  view,
  items,
  W,
  H,
  onJump
}: {
  view: CanvasView
  items: MinimapItem[]
  W: number
  H: number
  onJump: (wx: number, wy: number) => void
}) {
  const ref = useRef<SVGSVGElement>(null)
  // world bounds = items ∪ visible viewport, so the frame never leaves the map
  const vx = -view.x / view.z
  const vy = -view.y / view.z
  const vw = W / view.z
  const vh = H / view.z
  let x0 = vx
  let y0 = vy
  let x1 = vx + vw
  let y1 = vy + vh
  for (const it of items) {
    x0 = Math.min(x0, it.x)
    y0 = Math.min(y0, it.y)
    x1 = Math.max(x1, it.x + it.w)
    y1 = Math.max(y1, it.y + it.h)
  }
  const pad = 20
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 += pad
  const MW = 168
  const s = MW / (x1 - x0)
  const MH = Math.min(120, (y1 - y0) * s)
  const sy = MH / (y1 - y0)
  const k = Math.min(s, sy)

  const jump = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onJump(x0 + (e.clientX - r.left) / k, y0 + (e.clientY - r.top) / k)
  }

  return (
    <svg
      ref={ref}
      width={(x1 - x0) * k}
      height={(y1 - y0) * k}
      className="cursor-pointer rounded-[10px] border border-[var(--border-default)] bg-[rgba(10,11,13,0.88)] shadow-[var(--shadow-pop)] backdrop-blur-xl"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        jump(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) jump(e)
      }}
    >
      {items.map((it, i) => (
        <rect
          key={i}
          x={(it.x - x0) * k}
          y={(it.y - y0) * k}
          width={Math.max(2, it.w * k)}
          height={Math.max(2, it.h * k)}
          rx={1.5}
          className={clsx(!it.hub && 'fill-[#1c1d22]')}
          fill={it.hub ? 'rgba(245,165,36,0.35)' : undefined}
          stroke={it.hub ? '#f5a524' : (it.color ?? '#4a4c55')}
          strokeWidth={1}
        />
      ))}
      <rect
        x={(vx - x0) * k}
        y={(vy - y0) * k}
        width={vw * k}
        height={vh * k}
        fill="rgba(255,255,255,0.04)"
        stroke="rgba(245,165,36,0.6)"
        strokeWidth={1}
        rx={2}
      />
    </svg>
  )
}
