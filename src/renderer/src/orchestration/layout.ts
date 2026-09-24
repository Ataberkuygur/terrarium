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
