import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Maximize2, PictureInPicture2, X } from 'lucide-react'
import { useApp } from '../lib/store'
import { OfficeView } from '../views/OfficeView'

const RECT_KEY = 'terrarium.office.pip.rect'
const MIN_W = 280
const MIN_H = 180
const MAX_VW = 0.7
const MAX_VH = 0.7
const SNAP = 24 // px from an edge - snap on drag release
const MARGIN = 16 // snapped / default edge margin
const DEFAULT_W = 360
const DEFAULT_H = 220

interface PipRect {
  x: number
  y: number
  w: number
  h: number
}

function clampRect(r: PipRect): PipRect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, vw * MAX_VW))
  const h = Math.min(Math.max(r.h, MIN_H), Math.max(MIN_H, vh * MAX_VH))
  const x = Math.min(Math.max(r.x, 0), Math.max(0, vw - w))
  const y = Math.min(Math.max(r.y, 0), Math.max(0, vh - h))
  return { x, y, w, h }
}

function snapRect(r: PipRect): PipRect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let { x, y } = r
  if (x < SNAP) x = MARGIN
  else if (x + r.w > vw - SNAP) x = Math.max(MARGIN, vw - r.w - MARGIN)
  if (y < SNAP) y = MARGIN
  else if (y + r.h > vh - SNAP) y = Math.max(MARGIN, vh - r.h - MARGIN)
  return { ...r, x, y }
}

function loadRect(): PipRect | null {
  try {
    const raw = localStorage.getItem(RECT_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<PipRect>
    if (
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.w === 'number' &&
      typeof r.h === 'number'
    ) {
      return r as PipRect
    }
    return null
  } catch {
    return null
  }
}

function saveRect(r: PipRect): void {
  try {
    localStorage.setItem(RECT_KEY, JSON.stringify(r))
  } catch {
    /* storage unavailable - non-fatal */
  }
}

function defaultRect(): PipRect {
  return {
    x: Math.max(MARGIN, window.innerWidth - DEFAULT_W - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - DEFAULT_H - MARGIN),
    w: DEFAULT_W,
    h: DEFAULT_H
  }
}

/**
 * Persistent office host - OfficeView mounts exactly once inside, so the R3F
 * Canvas (WebGL context, camera, loaded assets) survives every tab switch.
 *
 *   office : dock fills <main>, scene runs        - the normal office tab
 *   pip    : dock becomes a fixed floating window - same tree, scene runs
 *   hidden : display:none + frameloop 'never'     - mounted, zero GPU burn
 *
 * The header chrome and resize grip stay mounted in every mode (display
 * toggled, never conditionally rendered) so the tree shape - and therefore
 * OfficeView's position in it - never changes.
 */
export function OfficeDock() {
  const view = useApp((s) => s.view)
  const officePiP = useApp((s) => s.officePiP)
  const setView = useApp((s) => s.setView)
  const setOfficePiP = useApp((s) => s.setOfficePiP)

  const mode: 'office' | 'pip' | 'hidden' =
    view === 'office' ? 'office' : officePiP ? 'pip' : 'hidden'
  const pip = mode === 'pip'

  const [rect, setRect] = useState<PipRect>(() => clampRect(loadRect() ?? defaultRect()))
  const rectRef = useRef(rect)
  rectRef.current = rect
  // active pointer-gesture teardown - lets unmount cancel an in-flight drag
  // (StrictMode-safe: nothing is registered until a pointerdown)
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  // keep the floater inside the viewport across window resizes
  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Shared pointer-tracker: streams clamped rects during the gesture,
   *  runs 'commit' (e.g. edge snap) once on release, then persists. */
  const track = (
    e: ReactPointerEvent,
    onMove: (dx: number, dy: number) => PipRect,
    commit?: (r: PipRect) => PipRect
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent) =>
      setRect(clampRect(onMove(ev.clientX - sx, ev.clientY - sy)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cleanupRef.current = null
      setRect((r) => {
        const next = commit ? commit(clampRect(r)) : clampRect(r)
        saveRect(next)
        return next
      })
    }
    cleanupRef.current = up
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // buttons in the header stay clickable - never start a drag from them
    if ((e.target as HTMLElement).closest('button')) return
    const orig = rectRef.current
    track(e, (dx, dy) => ({ ...orig, x: orig.x + dx, y: orig.y + dy }), snapRect)
  }

  const onGripPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const orig = rectRef.current
    track(e, (dx, dy) => ({ ...orig, w: orig.w + dx, h: orig.h + dy }))
  }

  return (
    <div
      className={
        pip
          ? 'fixed z-40 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900/85 shadow-2xl shadow-black/50 backdrop-blur-xl'
          : 'flex h-full flex-col'
      }
      style={
        pip
          ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
          : mode === 'hidden'
            ? { display: 'none' }
            : undefined
      }
    >
      {/* mini-player title bar - drag handle */}
      <div
        className="h-8 shrink-0 cursor-move select-none items-center gap-1.5 border-b border-white/10 px-2"
        style={{ display: pip ? 'flex' : 'none' }}
        onPointerDown={onHeaderPointerDown}
      >
        <PictureInPicture2 size={12} className="shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide text-white/85">
          Office
        </span>
        <button
          onClick={() => setView('office')}
          title="Back to Office tab"
          className="cursor-pointer rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Maximize2 size={12} />
        </button>
        <button
          onClick={() => setOfficePiP(false)}
          title="Close mini player"
          className="cursor-pointer rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      {/* the office - same mounted subtree in all three modes */}
      <div className="relative min-h-0 flex-1">
        <OfficeView mini={pip} paused={mode === 'hidden'} />
      </div>

      {/* corner resize grip */}
      <div
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize text-neutral-500 transition-colors hover:text-neutral-300"
        style={{ display: pip ? 'block' : 'none' }}
        onPointerDown={onGripPointerDown}
      >
        <svg viewBox="0 0 12 12" className="h-full w-full" fill="none" aria-hidden="true">
          <path
            d="M11 2 L2 11 M11 6.5 L6.5 11"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}
