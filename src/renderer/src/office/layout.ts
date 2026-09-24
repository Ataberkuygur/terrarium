/**
 * Loft layout — the default-theme office interior (16 × 10 m, dollhouse
 * cutaway: the camera-facing walls fold away at runtime).
 *
 * Floor plan (x →, z ↓ toward the default camera):
 *
 *   back wall (z −5): three steel-frame windows, sun comes in from here
 *   ┌──────────┬───────────────────────────────┬────────────┐
 *   │ kitchen  │  pod A0 (desk 0-3)  pod A1 (4-7) │  meeting   │
 *   │ + island │                                  │  room      │
 *   │          │  pod B0 (8-11)      pod B1 (12-15)│ (glass)   │
 *   │ lounge   │                                  │ standing   │
 *   │ (sofa)   │   planter bench        reading    │ desks 16-17│
 *   └──────────┴───────────────────────────────┴────────────┘
 *   front wall (z +5) — cut away toward the camera
 *
 * Desk convention: desk local +z is the chair side, local −z the monitor
 * side. A seated agent faces local −z (toward the monitor).
 *
 * Exports kept for other modules: ROOM (RpgControls, shared.ts), ZONES
 * (shared.ts rug materials), domainOfDesk / hash01 / COFFEE_TABLE / MEETING
 * and the DeskSpot/ZoneSpec types (avengers/layout.ts re-exports them).
 */

import type { AgentDomain } from '@shared/types'

/* ── types ─────────────────────────────────────────────────────────────── */

export interface DeskSpot {
  id: string
  x: number
  z: number
  /** desk rotation around Y (rad) — rotates local +z (chair side) into world */
  rotY: number
  /** standing-height desk — the agent works standing, no chair */
  tall?: boolean
}

export type ZonePropKind =
  | 'posterBoard'
  | 'pinBoard'
  | 'moodBoard'
  | 'easel'
  | 'serverRack'
  | 'shelf'
  | 'credenza'
  | 'whiteboard'
  | 'plant'
  | 'plantBig'

export interface ZoneProp {
  kind: ZonePropKind
  at: [number, number]
  rotY?: number
}

export interface ZoneSpec {
  /** zone anchor — rugs center here */
  center: [number, number]
  deskSpots: DeskSpot[]
  rugSize: [number, number]
  rugTint: string
  accent: string
  props: ZoneProp[]
}

/* ── shell ─────────────────────────────────────────────────────────────── */

export const ROOM = { w: 16, d: 10, h: 3.4, wall: 0.24 }
/** inner wall faces */
export const IN = {
  x0: -ROOM.w / 2 + ROOM.wall / 2,
  x1: ROOM.w / 2 - ROOM.wall / 2,
  z0: -ROOM.d / 2 + ROOM.wall / 2,
  z1: ROOM.d / 2 - ROOM.wall / 2
}

/** back-wall steel windows — x center, width; sill/head shared */
export const WINDOWS = [
  { x: -4.7, y: 1.72, w: 3.0, h: 2.5 },
  { x: -0.2, y: 1.72, w: 3.6, h: 2.5 },
  { x: 4.9, y: 1.72, w: 3.0, h: 2.5 }
]
export const SILL_Y = 0.47
export const HEAD_Y = 2.97

/* ── desks ─────────────────────────────────────────────────────────────── */

/** desk top footprint + heights (the seated rig puts hips at ≈0.53 × scale) */
export const DESK = { w: 1.36, d: 0.76, h: 0.74, tallH: 1.06 }
/** chair/agent offset from desk center along local +z */
export const SEAT_Z = 0.66
/** standing agent offset from a tall desk's center along local +z */
export const STAND_Z = 0.62

/** pod centers — four 2×2 back-to-back pods on the loft floor */
export const PODS: [number, number][] = [
  [-2.2, -2.55], // A0
  [2.2, -2.55], // A1
  [-2.2, 1.3], // B0
  [2.2, 1.3] // B1
]
const POD_DX = DESK.w / 2 + 0.02
const POD_DZ = DESK.d / 2 + 0.03

function podDesks(pod: number): DeskSpot[] {
  const [cx, cz] = PODS[pod]
  const base = pod * 4
  return [
    // far side — agents face the camera (+z)
    { id: `desk-${base}`, x: cx - POD_DX, z: cz - POD_DZ, rotY: Math.PI },
    { id: `desk-${base + 1}`, x: cx + POD_DX, z: cz - POD_DZ, rotY: Math.PI },
    // near side — agents face the windows, screens toward the camera
    { id: `desk-${base + 2}`, x: cx - POD_DX, z: cz + POD_DZ, rotY: 0 },
    { id: `desk-${base + 3}`, x: cx + POD_DX, z: cz + POD_DZ, rotY: 0 }
  ]
}

export const WORKSTATION_PODS: DeskSpot[] = [
  ...podDesks(0),
  ...podDesks(1),
  ...podDesks(2),
  ...podDesks(3),
  // standing desks along the right wall — agents face +x (toward the camera)
  { id: 'desk-16', x: 6.75, z: 0.35, rotY: -Math.PI / 2, tall: true },
  { id: 'desk-17', x: 6.75, z: 1.95, rotY: -Math.PI / 2, tall: true }
]

export const DESKS: DeskSpot[] = WORKSTATION_PODS

/** extra desks for very large crews — a bench row along the front */
function overflowDesk(i: number): DeskSpot {
  const k = i - WORKSTATION_PODS.length
  const col = k % 6
  const row = Math.floor(k / 6)
  return { id: `desk-${i}`, x: -3.6 + col * 1.44, z: 3.35 + row * 1.5, rotY: Math.PI }
}

/** every desk the loft shows for `sessionCount` agents — the fixed set is
 * always furnished (empty desks stand ready), overflow grows a front row */
export function getOfficeDesks(sessionCount: number): DeskSpot[] {
  if (sessionCount <= WORKSTATION_PODS.length) return WORKSTATION_PODS
  const desks = [...WORKSTATION_PODS]
  for (let i = WORKSTATION_PODS.length; i < sessionCount; i++) desks.push(overflowDesk(i))
  return desks
}

/** desk spot by id — unknown ids fall back by numeric index, then desk-0 */
export function deskById(id: string, deskList?: DeskSpot[]): DeskSpot {
  const index = parseInt(id.replace(/\D+/g, ''), 10)
  const list =
    deskList ?? (!isNaN(index) && index >= DESKS.length ? getOfficeDesks(index + 1) : DESKS)
  const found = list.find((d) => d.id === id)
  if (found) return found
  if (!isNaN(index) && list[index]) return list[index]
  return list[0]
}

/** desk-local (lx, lz) → world (x, z) */
export function deskLocal(spot: { x: number; z: number; rotY: number }, lx: number, lz: number) {
  const s = Math.sin(spot.rotY)
  const c = Math.cos(spot.rotY)
  return [spot.x + lx * c + lz * s, spot.z - lx * s + lz * c] as const
}

/* ── domain zones — kept for the shared rug materials + domainOfDesk ───── */

const D = (i: number) => DESKS[i]
export const ZONES: Record<AgentDomain, ZoneSpec> = {
  frontend: {
    center: PODS[0],
    deskSpots: [D(1)],
    rugSize: [3.2, 3.0],
    rugTint: '#d4aec8',
    accent: '#d79cc6',
    props: []
  },
  backend: {
    center: PODS[1],
    deskSpots: [D(2), D(3)],
    rugSize: [3.2, 3.0],
    rugTint: '#3c414a',
    accent: '#457052',
    props: []
  },
  marketing: {
    center: PODS[2],
    deskSpots: [D(6)],
    rugSize: [3.2, 3.0],
    rugTint: '#dfb87e',
    accent: '#d97f35',
    props: []
  },
  design: {
    center: PODS[3],
    deskSpots: [D(5)],
    rugSize: [3.2, 3.0],
    rugTint: '#bcd0c2',
    accent: '#66b394',
    props: []
  },
  research: {
    center: PODS[1],
    deskSpots: [D(4)],
    rugSize: [3.2, 3.0],
    rugTint: '#c8ad82',
    accent: '#bb8f4c',
    props: []
  },
  legal: {
    center: PODS[3],
    deskSpots: [D(7)],
    rugSize: [3.2, 3.0],
    rugTint: '#3f4844',
    accent: '#b9955a',
    props: []
  },
  general: {
    center: PODS[0],
    deskSpots: [D(0), D(8)],
    rugSize: [3.2, 3.0],
    rugTint: '#939eab',
    accent: '#7b8ea3',
    props: []
  }
}

const DESK_DOMAIN = new Map<string, AgentDomain>()
for (const [domain, zone] of Object.entries(ZONES) as [AgentDomain, ZoneSpec][]) {
  for (const d of zone.deskSpots) DESK_DOMAIN.set(d.id, domain)
}

export function domainOfDesk(id: string): AgentDomain {
  return DESK_DOMAIN.get(id) ?? 'general'
}

/** deterministic 0..1 hash from a string id (layout jitter — no Math.random) */
export function hash01(id: string, salt = 0) {
  let h = 2166136261 + salt
  for (const c of id) h = ((h ^ c.charCodeAt(0)) * 16777619) >>> 0
  return (h % 1000) / 1000
}

/* ── commons ───────────────────────────────────────────────────────────── */

/** lounge: sofa against the left wall facing +x, rug, coffee table, armchairs */
export const LOUNGE = {
  sofa: { x: -7.35, z: 2.9, rotY: Math.PI / 2 },
  table: { x: -6.15, z: 2.9 },
  armchairs: [
    { x: -4.9, z: 2.05, rotY: -Math.PI / 2 - 0.5 },
    { x: -4.9, z: 3.85, rotY: -Math.PI / 2 + 0.5 }
  ],
  rug: { x: -6.05, z: 2.95, w: 3.4, d: 3.0 },
  lamp: { x: -7.45, z: 4.45 },
  shelf: { x: -7.78, z: 0.35, rotY: Math.PI / 2 }
}

/** idle-agent seats in the commons: [x, rootY, z, rotY, pose] */
export interface LoungeSeat {
  x: number
  y: number
  z: number
  rotY: number
  pose: 'lounge' | 'sit' | 'stand'
}
/* lounge-pose hips ride ≈0.14 above the root (× crew scale), so the root
 * sits that far below the cushion top: sofa ≈0.48, armchair ≈0.46 */
export const LOUNGE_SEATS: LoungeSeat[] = [
  { x: -7.12, y: 0.33, z: 2.5, rotY: Math.PI / 2, pose: 'lounge' },
  { x: -7.12, y: 0.33, z: 3.4, rotY: Math.PI / 2, pose: 'lounge' },
  { x: -4.93, y: 0.3, z: 2.07, rotY: -Math.PI / 2 - 0.5, pose: 'lounge' },
  { x: -4.93, y: 0.3, z: 3.83, rotY: -Math.PI / 2 + 0.5, pose: 'lounge' },
  // kitchen island stools, then standing at the coffee bar
  { x: -5.55, y: 0.0, z: -3.9, rotY: -Math.PI / 2, pose: 'stand' },
  { x: -5.55, y: 0.0, z: -2.6, rotY: -Math.PI / 2, pose: 'stand' },
  { x: -6.8, y: 0.0, z: -1.4, rotY: -Math.PI / 2 - 0.4, pose: 'stand' },
  { x: 5.6, y: 0.0, z: 3.9, rotY: Math.PI, pose: 'stand' }
]

/** kitchenette counter along the left wall's rear stretch (faces +x) */
export const KITCHEN = { x: -7.5, z: -3.4, len: 3.0, rotY: Math.PI / 2 }
/** bar-height island parallel to the counter */
export const ISLAND = { x: -6.15, z: -3.25, len: 2.2 }

/** glass meeting room in the back-right corner */
export const MEETING_ROOM = { x0: 4.3, z1: -1.25, table: { x: 6.2, z: -3.15 } }

/** reading nook in the front-right corner */
export const NOOK = { x: 5.4, z: 3.8 }

/** print + storage credenza outside the meeting room glass */
export const PRINT_STATION = { x: 6.05, z: -0.98, len: 2.3 }

/** planter bench / low credenza strip along the front edge */
export const FRONT_BENCH = { x: 0, z: 4.45, len: 5.6 }

/* ── legacy commons (still re-exported by avengers/layout.ts) ───────────── */

export const COFFEE_TABLE = { x: -6.35, z: 3.3 }
export const MEETING = { x: -3.3, z: 2.9 }
