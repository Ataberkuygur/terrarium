// ── orchestration layout — hub + ring of subagent cards ──────────────
// Pure geometry in WORLD pixels, independent of the window: the canvas
// pans/zooms over it, so a card's place and size never depend on how big
// the window happens to be — a network reopens exactly as it was left.
// The hub sits at the origin; subagent slot k is fixed forever (right,
// left, right, left … centred on the hub, then below, then above, then
// outer columns), so adding or removing an agent never shuffles others.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface Slot extends Rect {
  side: Side
}

export interface NetworkLayout {
  hub: Rect
  slots: Slot[]
}

/** Default card sizes (world px) — readable 13px text at zoom 1. */
export const HUB_W = 860
export const HUB_H = 580
export const AGENT_W = 620
export const AGENT_H = 390
/** Tether run between the hub and the first column — clear breathing room. */
const GAP_X = 150
const GAP_Y = 36
const COL_GAP = 70
const PER_COL = 3
/** Row order inside a column: centred on the hub, then below, then above. */
const ROW_OFF = [0, 1, -1]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const HUB_RECT: Rect = { x: 0, y: 0, w: HUB_W, h: HUB_H }

/** World rect of subagent slot `k` (stable for the life of the network). */
export function slotRect(k: number): Slot {
  const side: Side = k % 2 === 0 ? 'right' : 'left'
  const j = Math.floor(k / 2)
  const col = Math.floor(j / PER_COL)
  const off = ROW_OFF[j % PER_COL]
  const step = AGENT_W + COL_GAP
  const x = side === 'right' ? HUB_W + GAP_X + col * step : -GAP_X - AGENT_W - col * step
  const y = HUB_H / 2 - AGENT_H / 2 + off * (AGENT_H + GAP_Y)
  return { side, x, y, w: AGENT_W, h: AGENT_H }
}

export function layoutNetwork(slots: number[]): NetworkLayout {
  return { hub: { ...HUB_RECT }, slots: slots.map(slotRect) }
}

/**
 * First view of a network: everything when it fits at a readable zoom,
 * otherwise the orchestrator, centred and readable.
 */
export function initialView(
  bounds: Rect,
  hub: Rect,
  W: number,
  H: number
): { x: number; y: number; z: number } {
  const m = 28
  const fitAll = Math.min(1, (W - 2 * m) / bounds.w, (H - 2 * m) / bounds.h)
  const fitHub = Math.min(1, (W - 2 * m) / hub.w, (H - 2 * m) / hub.h)
  const readable = 0.78
  const z = fitAll >= readable ? fitAll : Math.min(fitHub, Math.max(fitAll, readable))
  const c = fitAll >= readable ? bounds : hub
  return { z, x: W / 2 - (c.x + c.w / 2) * z, y: H / 2 - (c.y + c.h / 2) * z }
}

export interface TetherGeom {
  /** Card-side anchor + outward normal. */
  a: [number, number]
  na: [number, number]
  /** Hub-side anchor + outward normal. */
  b: [number, number]
  nb: [number, number]
}

/**
 * Where a card's tether meets the card and the hub. Hub anchors are
 * spread along the facing edge in proportion to the card's position, so
 * a column of tethers fans out instead of converging on one point.
 */
export function tetherGeom(slot: Slot, hub: Rect): TetherGeom {
  const inset = 26
  // a column's centre card meets the hub mid-edge; cards above/below fan
  // out toward the corners
  const hcy = hub.y + hub.h / 2
  const mapY = (y: number) =>
    hcy + clamp((y - hcy) / (hub.h / 2 + AGENT_H + GAP_Y), -1, 1) * (hub.h / 2 - inset)
  const mapX = (x: number) =>
    hub.x + inset + clamp((x - hub.x) / Math.max(1, hub.w), 0, 1) * (hub.w - 2 * inset)
  const scx = slot.x + slot.w / 2
  const scy = slot.y + slot.h / 2
  switch (slot.side) {
    case 'right':
      return { a: [slot.x, scy], na: [-1, 0], b: [hub.x + hub.w, mapY(scy)], nb: [1, 0] }
    case 'left':
      return { a: [slot.x + slot.w, scy], na: [1, 0], b: [hub.x, mapY(scy)], nb: [-1, 0] }
    case 'top':
      return { a: [scx, slot.y + slot.h], na: [0, 1], b: [mapX(scx), hub.y], nb: [0, -1] }
    case 'bottom':
      return { a: [scx, slot.y], na: [0, -1], b: [mapX(scx), hub.y + hub.h], nb: [0, 1] }
  }
}

/** Inset rect for the focus view (one subagent blown up over the web). */
export function expandedRect(W: number, H: number): Rect {
  const w = Math.min(W - 48, Math.max(W * 0.72, 720))
  const h = Math.min(H - 40, Math.max(H * 0.84, 420))
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

// ── tiled "Workspace" layout ─────────────────────────────────────────
// The Canvas alternative for people who'd rather not pan and zoom: the
// orchestrator fills the middle of the window and subagents tile the four
// bands around it — never overlapping, always all on screen. Subagent k's
// band depends on k alone (first round left → right → top → bottom, every
// later round top → bottom → left → right), so a new agent only ever
// splits one band further:
//   4 agents → top 1 · right 1 · left 1 · bottom 1
//   5 agents → top 2 · …          6 agents → top 2 · bottom 2 · …
// Every band splits into COLUMNS — side by side, full band height — so a
// tile never gets squashed into a short strip. The orchestrator keeps a
// fixed, centred rect: bands are always reserved, empty ones stay empty.

const FIRST_ROUND: Side[] = ['left', 'right', 'top', 'bottom']
const NEXT_ROUNDS: Side[] = ['top', 'bottom', 'left', 'right']

/** Band of subagent `k` in the tiled layout. */
export function tileSide(k: number): Side {
  return (k < 4 ? FIRST_ROUND : NEXT_ROUNDS)[k % 4]
}

/**
 * Band sizes as fractions of the window: left/right = width of ONE side
 * column (the band is that × its column count), top/bottom = band height.
 */
export interface TileFractions {
  left: number
  right: number
  top: number
  bottom: number
}

export const DEFAULT_TILE_FRACTIONS: TileFractions = { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25 }

/** Per-band limits — the orchestrator always keeps the lion's share. */
export const TILE_MAX = { side: 0.32, band: 0.38 }
export const TILE_MIN = { side: 0.08, band: 0.14 }
/** Share of the inner width the orchestrator never gives up to side columns. */
const HUB_MIN = 0.36

export function clampFractions(f: TileFractions): TileFractions {
  const side = (v: number) => clamp(v, TILE_MIN.side, TILE_MAX.side)
  const band = (v: number) => clamp(v, TILE_MIN.band, TILE_MAX.band)
  return { left: side(f.left), right: side(f.right), top: band(f.top), bottom: band(f.bottom) }
}

export interface TileLayout {
  hub: Rect
  /** One rect per subagent, in agent order. */
  slots: Slot[]
  /** Agents per band. */
  count: Record<Side, number>
  /** Bands with no agent yet — reserved, drawn as empty slots. */
  empty: Slot[]
  /** Band that receives the next subagent. */
  next: Side
  /** Band edges facing the hub (px) — where the resize gutters sit. */
  edges: Record<Side, number>
  /** The middle row's vertical span (left/right gutters run along it). */
  mid: { y0: number; y1: number }
}

/**
 * Screen rects for a hub + `n` subagents tiled into a W×H window.
 *
 * The orchestrator never grows into space no agent uses: all four bands are
 * always reserved and opposite bands are sized alike, so the hub stays the
 * same size, dead centre, from zero agents up. Empty bands stay empty (the
 * view draws them as slots). Left/right widen by one column per agent on
 * the fuller side — mirrored on the other — until the hub would drop below
 * HUB_MIN of the width; past that the columns narrow instead.
 */
export function tileNetwork(n: number, W: number, H: number, fr: TileFractions, gap = 8, pad = 8): TileLayout {
  const f = clampFractions(fr)
  const count: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
  const sideOf: Side[] = []
  for (let k = 0; k < n; k++) {
    const s = tileSide(k)
    sideOf.push(s)
    count[s]++
  }
  const innerW = W - 2 * pad
  const innerH = H - 2 * pad

  // top/bottom: one shared height; left/right: one shared width
  const bandH = Math.round(innerH * Math.max(f.top, f.bottom))
  const colW = innerW * Math.max(f.left, f.right)
  const cols = Math.max(1, count.left, count.right)
  const sideMax = (innerW * (1 - HUB_MIN) - 2 * gap) / 2
  const sideW = Math.round(Math.min(sideMax, cols * colW + (cols - 1) * gap))

  const y0 = pad + bandH + gap
  const y1 = H - pad - bandH - gap
  const x0 = pad + sideW + gap
  const x1 = W - pad - sideW - gap
  const hub: Rect = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }

  const region: Record<Side, Slot> = {
    top: { side: 'top', x: pad, y: pad, w: innerW, h: bandH },
    bottom: { side: 'bottom', x: pad, y: H - pad - bandH, w: innerW, h: bandH },
    left: { side: 'left', x: pad, y: y0, w: sideW, h: y1 - y0 },
    right: { side: 'right', x: W - pad - sideW, y: y0, w: sideW, h: y1 - y0 }
  }

  // split a region into `k` equal columns, gaps between
  const cells = (r: Slot, k: number): Slot[] => {
    const size = (r.w - gap * (k - 1)) / k
    return Array.from({ length: k }, (_, i) => {
      const a = Math.round(r.x + i * (size + gap))
      const b = Math.round(r.x + i * (size + gap) + size)
      return { ...r, x: a, w: b - a }
    })
  }
  // left columns run hub-outward (the first agent hugs the hub); a new
  // agent on either side opens a column at the window edge
  const bandCells: Record<Side, Slot[]> = {
    top: count.top ? cells(region.top, count.top) : [],
    bottom: count.bottom ? cells(region.bottom, count.bottom) : [],
    left: count.left ? cells(region.left, count.left).reverse() : [],
    right: count.right ? cells(region.right, count.right) : []
  }
  const used: Record<Side, number> = { left: 0, right: 0, top: 0, bottom: 0 }
  const slots = sideOf.map((side) => bandCells[side][used[side]++])

  const sides: Side[] = ['left', 'right', 'top', 'bottom']
  return {
    hub,
    slots,
    count,
    empty: sides.filter((s) => count[s] === 0).map((s) => region[s]),
    next: tileSide(n),
    edges: {
      top: pad + bandH + gap / 2,
      bottom: H - pad - bandH - gap / 2,
      left: pad + sideW + gap / 2,
      right: W - pad - sideW - gap / 2
    },
    mid: { y0, y1 }
  }
}
