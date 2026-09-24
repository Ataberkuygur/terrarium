/* ── Avengers Compound — ops floor layout ──────────────────────────────
 * One room, one focal point: the round holo briefing table (HUB) with the
 * crew consoles wrapped around it in two mission-control tiers — an inner
 * ring on the floor and an outer ring on a raised dais against the glass.
 * Every console faces the hub, so from the default front-¾ camera the
 * heroes face the viewer across the hologram.
 *
 *   back wall (−z)  Hall of Armor pods (left half) + floor-to-ceiling
 *                   glazing onto the compound lawn and Quinjet pad (right)
 *   left wall (−x)  mission wall screen, Cap's shield, Mjölnir
 *   right wall (+x) Stark bar (back) + lounge sectional (front)
 *   front (+z)      open dollhouse cutaway, inlaid floor crest
 *
 * Desk ids keep the engine contract (desk-0…desk-N resolve by id); the
 * slot order fills each tier center-out so any crew size reads balanced.
 * Self-contained on purpose — nothing here depends on the loft layout
 * beyond the DeskSpot shape. */
import type { DeskSpot } from '../layout'

export type { DeskSpot } from '../layout'

/** deterministic 0..1 hash from a string id (layout jitter — no Math.random).
 * Same FNV-1a variant as the loft's, kept local so this theme never breaks
 * when the loft layout moves. */
export function hash01(id: string, salt = 0): number {
  let h = 2166136261 + salt
  for (const c of id) h = ((h ^ c.charCodeAt(0)) * 16777619) >>> 0
  return (h % 1000) / 1000
}

/* ── shell ─────────────────────────────────────────────────────────────── */
export const ROOM = {
  minX: -8.3,
  maxX: 8.3,
  minZ: -6,
  maxZ: 4.4,
  h: 3.8,
  wall: 0.22
} as const
export const ROOM_W = ROOM.maxX - ROOM.minX
export const ROOM_D = ROOM.maxZ - ROOM.minZ
export const ROOM_CX = (ROOM.minX + ROOM.maxX) / 2
export const ROOM_CZ = (ROOM.minZ + ROOM.maxZ) / 2

/* ── the hub — holo briefing table ─────────────────────────────────────── */
export const HUB = { x: 0, z: 0.7, r: 1.25 } as const

/** console tiers — radius of the desk center from the hub, dais height,
 * slot count and the angular half-span (θ measured from −z toward +x) */
export const TIER1 = { r: 3.0, y: 0, slots: 6, half: (80 * Math.PI) / 180 } as const
export const TIER2 = { r: 4.72, y: 0.3, slots: 8, half: (70 * Math.PI) / 180 } as const
/** raised dais under tier 2 — annular sector around the hub */
export const DAIS = { rIn: 4.12, rOut: 5.8, half: (80 * Math.PI) / 180, h: TIER2.y } as const
/** overflow ring — continues tier 1 around the front flanks for crews > 14 */
export const TIER1_FLANK = [100, 122].flatMap((deg) => [-deg, deg]).map((d) => (d * Math.PI) / 180)

/* ── console desk dims (shared with props-tech) ────────────────────────── */
export const DESK = { w: 1.42, d: 0.7, top: 0.76, seatZ: 0.56 } as const

/** facility desk — the loft DeskSpot plus dais elevation + tier */
export interface FacilityDesk extends DeskSpot {
  /** floor elevation (tier-2 dais) — everything at the station rides on it */
  y: number
  tier: 1 | 2 | 3
}

/** hub-facing desk at polar angle θ (0 = straight behind the hub) */
function ringDesk(id: string, r: number, theta: number, y: number, tier: 1 | 2 | 3): FacilityDesk {
  return {
    id,
    x: HUB.x + r * Math.sin(theta),
    z: HUB.z - r * Math.cos(theta),
    // local −z (monitor side) points at the hub
    rotY: Math.PI - theta,
    y,
    tier
  }
}

/** slot indices ordered center-out, alternating left/right */
function centerOut(n: number): number[] {
  const mid = (n - 1) / 2
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
  return idx
}

function tierAngles(slots: number, half: number): number[] {
  return Array.from({ length: slots }, (_, i) => -half + (2 * half * i) / (slots - 1))
}

const T1_ANG = tierAngles(TIER1.slots, TIER1.half)
const T2_ANG = tierAngles(TIER2.slots, TIER2.half)

/** the 14 permanent consoles — desk-0…5 inner ring, desk-6…13 dais */
export const CONSOLES: FacilityDesk[] = [
  ...centerOut(TIER1.slots).map((s, i) => ringDesk(`desk-${i}`, TIER1.r, T1_ANG[s], TIER1.y, 1)),
  ...centerOut(TIER2.slots).map((s, i) => ringDesk(`desk-${TIER1.slots + i}`, TIER2.r, T2_ANG[s], TIER2.y, 2))
]
export const DESKS: FacilityDesk[] = CONSOLES

/** overflow desk i (≥ 14): four front-flank ring slots, then a front row */
function overflowDesk(i: number): FacilityDesk {
  const k = i - CONSOLES.length
  if (k < TIER1_FLANK.length) return ringDesk(`desk-${i}`, TIER1.r, TIER1_FLANK[k], 0, 3)
  // beyond the ring: a front row either side of the flank desks
  const j = k - TIER1_FLANK.length
  const FRONT_X = [-0.9, 0.9, -4.3, 4.3, -6.0, 6.0]
  return {
    id: `desk-${i}`,
    x: FRONT_X[j % FRONT_X.length],
    z: 3.3 + Math.floor(j / FRONT_X.length) * 0.4,
    rotY: 0,
    y: 0,
    tier: 3
  }
}

/** every console for a crew of `sessionCount` — the 14 permanent consoles
 * always stand (unmanned ones idle in standby); bigger crews add overflow */
export function getOfficeDesks(sessionCount: number): FacilityDesk[] {
  if (sessionCount <= CONSOLES.length) return CONSOLES
  const out = [...CONSOLES]
  for (let i = CONSOLES.length; i < sessionCount; i++) out.push(overflowDesk(i))
  return out
}

/** desk spot by id — resolves against THIS layout; unknown ids fall back */
export function deskById(id: string): FacilityDesk {
  const index = parseInt(id.replace(/\D+/g, ''), 10)
  if (isNaN(index) || index < 0) return CONSOLES[0]
  if (index < CONSOLES.length) return CONSOLES[index]
  return overflowDesk(index)
}

/** desk-local (lx, lz) → world xz. Local +z is the chair side. */
export function deskLocal(spot: { x: number; z: number; rotY: number }, lx: number, lz: number) {
  const s = Math.sin(spot.rotY)
  const c = Math.cos(spot.rotY)
  return [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c] as const
}

/* ── lounge + bar — where idle heroes gather ──────────────────────────── */
export const SOFA = { x: 7.62, z: 0.55, rotY: -Math.PI / 2, len: 3.3 } as const
export const ARMCHAIRS = [{ x: 5.45, z: 2.4, rotY: Math.PI * 0.78 }] as const
export const COFFEE_TABLE = { x: 6.35, z: 0.55 } as const
export const LOUNGE_RUG = { x: 6.5, z: 0.8, w: 3.1, d: 4.1 } as const

export const BAR = { x: 6.88, z: -4.15, len: 2.9 } as const // counter runs along z, faces −x
export const BAR_STOOLS = [-5.2, -4.45, -3.7, -2.95].map((z) => ({ x: 6.05, z }))

export type LoungePose = 'lounge' | 'stand'
export interface LoungeSlot {
  x: number
  y: number
  z: number
  rotY: number
  pose: LoungePose
}

/** idle slots in fill order: sofa seats, armchairs, then standing spots at
 * the bar and around the lounge — never two heroes in one spot */
export const LOUNGE_SLOTS: LoungeSlot[] = [
  ...[-1.1, 0.0, 1.1].map((o) => ({
    x: SOFA.x - 0.06,
    y: 0.42,
    z: SOFA.z + o,
    rotY: SOFA.rotY,
    pose: 'lounge' as const
  })),
  ...ARMCHAIRS.map((a) => ({
    x: a.x + Math.sin(a.rotY) * 0.06,
    y: 0.42,
    z: a.z + Math.cos(a.rotY) * 0.06,
    rotY: a.rotY,
    pose: 'lounge' as const
  })),
  // leaning at the bar between the stools, facing the counter (+x)
  ...BAR_STOOLS.slice(0, 3).map((s) => ({
    x: s.x - 0.05,
    y: 0,
    z: s.z + 0.37,
    rotY: Math.PI / 2,
    pose: 'stand' as const
  })),
  // chatting at the lounge edge / by the displays
  { x: 5.85, z: 3.35, y: 0, rotY: -Math.PI * 0.8, pose: 'stand' },
  { x: 5.25, z: -2.45, y: 0, rotY: Math.PI * 0.3, pose: 'stand' },
  { x: 3.7, z: 3.4, y: 0, rotY: Math.PI * 0.75, pose: 'stand' },
  { x: -3.4, z: 3.5, y: 0, rotY: -Math.PI * 0.7, pose: 'stand' }
]

/* ── signature fixtures ───────────────────────────────────────────────── */
/** Hall of Armor — suit pods along the back wall's solid left half, facing +z */
export const ARMOR_HALL = { z: ROOM.minZ, x0: -7.25, pitch: 1.36, count: 5 } as const
/** back-wall glazing span (right of the armor pods) */
export const GLAZING = { x0: -0.75, x1: ROOM.maxX - 0.7 } as const
/** big mission screen on the left wall */
export const MISSION_WALL = { x: ROOM.minX + 0.03, y: 1.95, z: -2.6 } as const
export const SHIELD_STAND = { x: -7.0, z: -0.35, rotY: 0.55 } as const
export const MJOLNIR = { x: -6.75, z: 1.55 } as const
/** Quinjet parked on the pad outside the back glazing */
export const QUINJET = { x: 4.0, z: -10.9, rotY: Math.PI / 2 + 0.12 } as const
export const LANDING_PAD = { x: 4.0, z: -10.9, r: 4.9 } as const
/** big backlit "A" above the bar on the right wall */
export const WALL_EMBLEM = { x: ROOM.maxX - 0.02, y: 2.62, z: -4.15 } as const

/* ── camera ───────────────────────────────────────────────────────────── */
/** default ¾ framing — front-left, looking over the hub at the crew with
 * the armor pods, the glass + Quinjet and the bar/lounge all in shot */
export const CAMERA = {
  position: [-6.4, 8.6, 10.4] as [number, number, number],
  target: [-0.8, 0.5, -0.9] as [number, number, number],
  fov: 34
}
/** orbit-target pan clamp */
export const FACILITY_BOUNDS = { minX: -7, maxX: 7, minZ: -5, maxZ: 3.6 }
