/* ── city streets ──────────────────────────────────────────────────────
 * Everything at pavement level, emitted into a shared `Batch`: curbs and
 * sidewalks with paving joints, road paint (double yellow, lane dashes,
 * zebra crosswalks, stop bars, a red bus lane), manholes + storm drains,
 * street trees in iron-guarded pits, lantern streetlamps, cobra-head
 * avenue lights, traffic signals with glowing heads + ped signals, and
 * fire hydrants. The asphalt slabs themselves are plain meshes in
 * CityBlock (they carry the grainy asphalt material).
 *
 * Also exports the shared prop builders (`tree`, `lantern`, `bench`) the
 * park and street-life layers reuse, plus LAMP_SPOTS for the additive
 * light pools CityBlock lays under every lamp.
 */
import * as THREE from 'three'
import { Batch, h01, jit, pick, tm } from './kit'
import { CITY, CITY_COLORS } from './layout'

const C = CITY_COLORS
const RW = CITY.roadW / 2 // 3.5
const CURB = 0.16
export const WALK_OUT = 5.55 // building line (outer sidewalk edge)
const AW = CITY.avenueW / 2
const AWALK = CITY.avenueWalk
export const AVENUES = [CITY.avenueWX, CITY.avenueEX]
export const LIM = 150 // street extent along x/z — fog eats the rest
export const WALK_Y = 0.08 // sidewalk top
export const CURB_Y = 0.1

/** main-road x-segments between the avenue intersections */
export const MAIN_SEGS: [number, number][] = [
  [-LIM, CITY.avenueWX - AW],
  [CITY.avenueWX + AW, CITY.avenueEX - AW],
  [CITY.avenueEX + AW, LIM]
]

/** x inside an avenue roadway (+ a margin) */
export const inAvenue = (x: number, m = 0) => AVENUES.some((a) => Math.abs(x - a) < AW + m)

// ── shared prop builders ─────────────────────────────────────────────

export const GREENS = ['#4f7a3a', '#5b8641', '#46703a', '#648f47', '#3f6634', '#6f9a4c']
const SUNLIT = ['#7fa654', '#8bb05c', '#76a04f']

export type TreeStyle = 'round' | 'tall' | 'wide' | 'blossom' | 'amber'

/** layered-canopy tree: trunk + limbs + 4-7 overlapping foliage blobs,
 *  darker underside, sun-warmed top. `s` scales the whole tree. */
export function tree(B: Batch, x: number, y: number, z: number, s: number, seed: string, style: TreeStyle = 'round'): void {
  const trunk = jit(C.treeTrunk, seed, 1, 0.05)
  const th = (style === 'tall' ? 1.0 : 0.85) * s
  B.stand('cyl', x, y, z, 0.1 * s, th, 0.1 * s, trunk)
  B.stand('cyl', x, y, z, 0.16 * s, 0.08 * s, 0.16 * s, trunk) // root flare
  // two limbs forking into the crown
  B.put('cyl', tm(x + 0.1 * s, y + th * 0.95, z, 0.06 * s, 0.5 * s, 0.06 * s, 0, 0, -0.5), trunk)
  B.put('cyl', tm(x - 0.08 * s, y + th * 0.98, z + 0.05 * s, 0.055 * s, 0.45 * s, 0.055 * s, 0, 0.3, 0.55), trunk)
  const base = style === 'blossom' ? ['#e7a5b4', '#d9899e', '#f0bccb'] : style === 'amber' ? ['#c98f3a', '#d6a044', '#b8782f'] : GREENS
  const top = style === 'blossom' ? ['#f6cfd8'] : style === 'amber' ? ['#e6b85a'] : SUNLIT
  const cy = y + th + 0.45 * s
  if (style === 'tall') {
    // columnar poplar — stacked narrowing blobs
    for (let i = 0; i < 4; i++) {
      const r = (0.62 - i * 0.1) * s
      B.put('foliage', tm(x, cy + i * 0.42 * s, z, r, r * 1.4, r, h01(seed, i) * 3), jit(pick(base, seed, i), seed, i + 10, 0.05))
    }
    B.put('foliage', tm(x + 0.05 * s, cy + 1.6 * s, z, 0.26 * s, 0.4 * s, 0.26 * s), jit(pick(top, seed, 5), seed, 11, 0.04))
    return
  }
  const wide = style === 'wide' ? 1.3 : 1
  const n = 5 + Math.floor(h01(seed, 2) * 3)
  // main mass
  B.put('foliage', tm(x, cy, z, 1.05 * s * wide, 0.85 * s, 1.0 * s * wide, h01(seed, 3) * 6), jit(pick(base, seed, 4), seed, 5, 0.05))
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + h01(seed, 20 + i) * 0.8
    const rr = (0.34 + h01(seed, 30 + i) * 0.14) * s * wide
    const bs = (0.55 + h01(seed, 40 + i) * 0.25) * s
    const by = cy + (h01(seed, 50 + i) - 0.35) * 0.4 * s
    const up = by > cy + 0.05 * s
    B.put(
      'foliage',
      tm(x + Math.cos(a) * rr, by, z + Math.sin(a) * rr, bs * wide, bs * 0.85, bs * wide, a),
      jit(up ? pick(top, seed, 60 + i) : pick(base, seed, 60 + i), seed, 70 + i, 0.05)
    )
  }
  // crown cap catching the low sun
  B.put('foliage', tm(x - 0.08 * s, cy + 0.38 * s, z + 0.06 * s, 0.6 * s * wide, 0.5 * s, 0.6 * s * wide, 1), jit(pick(top, seed, 90), seed, 91, 0.04))
}

/** cast-iron lantern post (sidewalks, park) — returns the lantern height */
export function lantern(B: Batch, x: number, y: number, z: number, s = 1): number {
  const iron = '#262a2c'
  B.stand('cylMetal', x, y, z, 0.2 * s, 0.14 * s, 0.2 * s, iron)
  B.stand('cylMetal', x, y + 0.14 * s, z, 0.12 * s, 0.1 * s, 0.12 * s, iron)
  B.stand('cylMetal', x, y + 0.24 * s, z, 0.065 * s, 1.35 * s, 0.065 * s, iron)
  B.stand('cylMetal', x, y + 1.55 * s, z, 0.12 * s, 0.05 * s, 0.12 * s, iron)
  const ly = y + 1.6 * s
  B.stand('litCyl', x, ly, z, 0.2 * s, 0.26 * s, 0.2 * s, '#ffd892')
  // frame posts around the glass
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ])
    B.stand('metal', x + dx * 0.075 * s, ly, z + dz * 0.075 * s, 0.018 * s, 0.26 * s, 0.018 * s, iron)
  B.stand('cone', x, ly + 0.26 * s, z, 0.3 * s, 0.14 * s, 0.3 * s, iron)
  B.stand('sphere', x, ly + 0.39 * s, z, 0.05 * s, 0.05 * s, 0.05 * s, iron)
  return ly + 0.13 * s
}

/** park / sidewalk bench: cast-iron ends, wood slats; faces +z at yaw 0 */
export function bench(B: Batch, x: number, y: number, z: number, yaw: number, wood = '#9a6d44'): void {
  const c = Math.cos(yaw)
  const sn = Math.sin(yaw)
  // local (lx, lz) → world
  const P = (lx: number, lz: number): [number, number] => [x + lx * c + lz * sn, z - lx * sn + lz * c]
  const iron = '#2b2e30'
  for (const lx of [-0.36, 0.36]) {
    const [ax, az] = P(lx, 0)
    B.put('metal', tm(ax, y + 0.13, az, 0.04, 0.26, 0.3, yaw), iron)
    const [bx, bz] = P(lx, -0.14)
    B.put('metal', tm(bx, y + 0.34, bz, 0.035, 0.36, 0.035, yaw, -0.12), iron)
  }
  for (let i = 0; i < 3; i++) {
    const [sx, sz] = P(0, 0.1 - i * 0.1)
    B.put('solid', tm(sx, y + 0.27, sz, 0.86, 0.03, 0.075, yaw), jit(wood, 'bench', i, 0.05))
  }
  for (let i = 0; i < 2; i++) {
    const [sx, sz] = P(0, -0.15)
    B.put('solid', tm(sx, y + 0.38 + i * 0.1, sz - 0.0, 0.86, 0.065, 0.028, yaw, -0.12), jit(wood, 'bench', i + 5, 0.05))
  }
}

/** NYC fire hydrant — squat red body, silver bonnet, side nozzles */
export function hydrant(B: Batch, x: number, y: number, z: number): void {
  const red = '#b5362c'
  B.stand('cyl', x, y, z, 0.16, 0.04, 0.16, red)
  B.stand('cyl', x, y + 0.04, z, 0.11, 0.2, 0.11, red)
  B.stand('cyl', x, y + 0.24, z, 0.15, 0.035, 0.15, red)
  B.stand('sphere', x, y + 0.24, z, 0.12, 0.1, 0.12, '#c9ccce')
  B.put('cylMetal', tm(x + 0.07, y + 0.16, z, 0.05, 0.06, 0.05, 0, 0, Math.PI / 2), '#c9ccce')
  B.put('cylMetal', tm(x - 0.07, y + 0.16, z, 0.05, 0.06, 0.05, 0, 0, Math.PI / 2), '#c9ccce')
  B.put('cylMetal', tm(x, y + 0.16, z + 0.07, 0.06, 0.06, 0.06, 0, Math.PI / 2), red)
}

// ── lamp + signal builders ───────────────────────────────────────────

export const LAMP_SPOTS: [number, number, number][] = [] // x, z, radius — light pools

/** traffic signal on a pole: heads face ±x (main-road traffic), with a
 *  pedestrian signal facing along the crosswalk (±z) */
function signal(B: Batch, x: number, z: number, mastToward: number, seed: string): void {
  const pole = '#3b4038'
  const y = WALK_Y
  B.stand('cylMetal', x, y, z, 0.12, 0.1, 0.12, pole)
  B.stand('cylMetal', x, y, z, 0.06, 2.35, 0.06, pole)
  B.stand('sphere', x, y + 2.35, z, 0.07, 0.07, 0.07, pole)
  // mast arm reaching over the road toward mastToward (z)
  const reach = Math.abs(mastToward - z)
  const dir = Math.sign(mastToward - z)
  B.box('metal', x, y + 2.25, z + (dir * reach) / 2, 0.045, 0.045, reach, pole)
  B.put('metal', tm(x, y + 2.05, z + dir * 0.3, 0.03, 0.03, 0.62, 0, dir * 0.72), pole)
  // hanging heads along the arm
  for (const f of [0.55, 0.92]) {
    const hz = z + dir * reach * f
    B.box('solid', x, y + 1.97, hz, 0.14, 0.4, 0.14, '#1f2224')
    B.box('solid', x, y + 2.2, hz, 0.02, 0.06, 0.02, pole)
    for (const sx of [-1, 1]) {
      // red / amber dim, green lit
      B.box('solid', x + sx * 0.072, y + 2.1, hz, 0.012, 0.085, 0.085, '#5a1d18')
      B.box('solid', x + sx * 0.072, y + 1.97, hz, 0.012, 0.085, 0.085, '#5a4415')
      B.box('lit', x + sx * 0.074, y + 1.84, hz, 0.012, 0.085, 0.085, '#6dffb4')
      // visors
      for (const yy of [2.15, 2.02, 1.89]) B.box('solid', x + sx * 0.095, y + yy, hz, 0.05, 0.012, 0.1, '#1f2224')
    }
  }
  // ped signal: box on the pole, lit hand facing both crosswalk ends
  B.box('solid', x, y + 1.3, z, 0.15, 0.16, 0.15, '#1f2224')
  const walk = h01(seed, 1) < 0.5
  for (const sz of [-1, 1]) B.box('lit', x, y + 1.3, z + sz * 0.077, 0.11, 0.11, 0.008, walk ? '#e9f2ff' : '#ff8a3d')
  // push button
  B.box('solid', x + 0.05, y + 0.95, z, 0.05, 0.08, 0.05, '#c9b23a')
}

/** avenue "cobra head" light — tall pole, arm over the roadway */
function cobra(B: Batch, x: number, z: number, armX: number): void {
  const pole = '#5b6068'
  const y = WALK_Y
  B.stand('cylMetal', x, y, z, 0.13, 0.2, 0.13, pole)
  B.stand('cylMetal', x, y, z, 0.055, 2.6, 0.055, pole)
  const dir = Math.sign(armX)
  const len = Math.abs(armX)
  B.put('metal', tm(x + (dir * len) / 2, y + 2.66, z, len, 0.04, 0.04, 0, 0, dir * 0.12), pole)
  B.box('solid', x + dir * len, y + 2.72, z, 0.36, 0.08, 0.16, pole)
  B.box('lit', x + dir * len, y + 2.67, z, 0.3, 0.02, 0.11, '#ffe2a6')
  LAMP_SPOTS.push([x + dir * len, z, 1.1])
}

// ── the street ───────────────────────────────────────────────────────

export function buildStreet(B: Batch): void {
  const walkC = C.sidewalk
  const curbC = C.curb
  const joint = '#9d968b'

  // ── main-road curbs + sidewalks (split at the avenues) ──
  for (const [a, b] of MAIN_SEGS) {
    const cx = (a + b) / 2
    const w = b - a
    for (const s of [-1, 1]) {
      B.box('flat', cx, CURB_Y / 2, s * (RW + CURB / 2), w, CURB_Y, CURB, curbC)
      B.box('flat', cx, WALK_Y / 2, s * (RW + CURB + (WALK_OUT - RW - CURB) / 2), w, WALK_Y, WALK_OUT - RW - CURB, jit(walkC, 'walk', s, 0.02))
      // curb-side furniture strip in slightly darker pavers
      B.box('flat', cx, WALK_Y + 0.0015, s * (RW + CURB + 0.38), w, 0.003, 0.62, '#aca597')
      // paving joints — cross joints every 0.95 within ±70
      const j0 = Math.max(a, -70)
      const j1 = Math.min(b, 70)
      for (let x = Math.ceil(j0 / 0.95) * 0.95; x < j1; x += 0.95)
        B.box('flat', x, WALK_Y + 0.002, s * (RW + CURB + 0.69 + (WALK_OUT - RW - CURB - 0.69) / 2), 0.022, 0.004, WALK_OUT - RW - CURB - 0.69, joint)
      B.box('flat', cx, WALK_Y + 0.002, s * (RW + CURB + 0.69), w, 0.004, 0.022, joint)
    }
  }
  // ── avenue curbs + sidewalks (both sides, both directions) ──
  for (const ax of AVENUES) {
    for (const zs of [-1, 1]) {
      const zA = zs * (RW + CURB)
      const zB = zs * LIM
      const zc = (zA + zB) / 2
      const len = Math.abs(zB - zA)
      for (const s of [-1, 1]) {
        const cx = ax + s * (AW + CURB / 2)
        B.box('flat', cx, CURB_Y / 2, zc, CURB, CURB_Y, len, curbC)
        // sidewalk from the main-road building line outward
        const wz0 = zs * WALK_OUT
        const wzc = (wz0 + zB) / 2
        const wlen = Math.abs(zB - wz0)
        B.box('flat', ax + s * (AW + CURB + AWALK / 2), WALK_Y / 2, wzc, AWALK, WALK_Y, wlen, jit(walkC, 'aw', s + zs, 0.02))
        for (let k = 1; k * 0.95 < Math.min(wlen, 60); k++)
          B.box('flat', ax + s * (AW + CURB + AWALK / 2), WALK_Y + 0.002, wz0 + zs * k * 0.95, AWALK, 0.004, 0.022, joint)
      }
      // avenue paint: double yellow + stop bar + zebra at the corner
      B.box('flat', ax - 0.06, 0.022, zc + zs * 2, 0.06, 0.004, len - 4, C.laneYellow)
      B.box('flat', ax + 0.06, 0.022, zc + zs * 2, 0.06, 0.004, len - 4, C.laneYellow)
      const zw0 = zs * (RW + CURB + 0.15)
      for (let i = 0; i < 9; i++) {
        const x = ax - AW + 0.35 + i * ((2 * AW - 0.7) / 8)
        B.box('flat', x, 0.022, zw0 + zs * 0.85, 0.28, 0.004, 1.5, C.crosswalk)
      }
      B.box('flat', ax, 0.022, zs * (RW + CURB + 2.05), 2 * AW - 0.3, 0.004, 0.12, C.laneMark)
    }
  }

  // ── main-road paint ──
  for (const [a, b] of MAIN_SEGS) {
    const a2 = a + (a > -LIM ? 2.2 : 0)
    const b2 = b - (b < LIM ? 2.2 : 0)
    const cx = (a2 + b2) / 2
    const w = b2 - a2
    // double yellow center line (broken at the mid-block crosswalk)
    const yellow = (x0: number, x1: number) => {
      for (const s of [-1, 1]) B.box('flat', (x0 + x1) / 2, 0.022, s * 0.07, x1 - x0, 0.004, 0.06, C.laneYellow)
    }
    if (a2 < 0 && b2 > 0) {
      yellow(a2, -1.9)
      yellow(1.9, b2)
    } else yellow(a2, b2)
    // parking-lane edge lines
    for (const s of [-1, 1]) B.box('flat', cx, 0.022, s * 2.55, w, 0.004, 0.05, C.laneMark)
    // lane dashes
    const pitch = CITY.laneDashLen + CITY.laneGapLen
    for (let x = a2 + 0.6; x < b2 - 0.6; x += pitch) {
      if (Math.abs(x) < 2.4) continue
      for (const s of [-1, 1]) B.box('flat', x, 0.022, s * 1.35, CITY.laneDashLen, 0.004, 0.06, C.laneMark)
    }
    // zebra + stop bars at the avenue-side ends
    for (const end of [a, b]) {
      if (Math.abs(end) >= LIM) continue
      const dir = end === a ? 1 : -1 // pointing into the segment
      for (let i = 0; i < 11; i++) {
        const z = -RW + 0.35 + i * ((2 * RW - 0.7) / 10)
        B.box('flat', end + dir * 1.0, 0.022, z, 1.5, 0.004, 0.3, C.crosswalk)
      }
      B.box('flat', end + dir * 2.05, 0.022, dir > 0 ? RW / 2 : -RW / 2, 0.12, 0.004, RW - 0.2, C.laneMark)
    }
  }
  // mid-block zebra at the HQ entrance + stop bars
  for (let i = 0; i < 11; i++) {
    const z = -RW + 0.35 + i * ((2 * RW - 0.7) / 10)
    B.box('flat', 0, 0.022, z, 1.7, 0.004, 0.32, C.crosswalk)
  }
  B.box('flat', -1.55, 0.022, RW / 2, 0.12, 0.004, RW - 0.2, C.laneMark)
  B.box('flat', 1.55, 0.022, -RW / 2, 0.12, 0.004, RW - 0.2, C.laneMark)
  // red bus lane in front of the bus stop (far side, westbound curb lane)
  B.box('flat', 10, 0.0215, -3.02, 9, 0.003, 0.9, '#9c3b33')
  for (const x of [7.5, 12.5]) B.box('flat', x, 0.023, -3.02, 0.9, 0.003, 0.08, C.laneMark)

  // asphalt patches + utility cuts (subtle tone breaks)
  for (let i = 0; i < 18; i++) {
    const x = -60 + h01('patch', i) * 120
    if (Math.abs(x) < 2.5 || inAvenue(x, 1)) continue
    const z = (h01('patchz', i) - 0.5) * 5.6
    B.box('flat', x, 0.0205, z, 0.8 + h01('pw', i) * 2.4, 0.002, 0.4 + h01('pd', i) * 0.9, h01('pc', i) < 0.5 ? '#35373c' : '#44464b', (h01('pr', i) - 0.5) * 0.1)
  }
  // manholes (off the wheel tracks) + storm drains at the curbs
  for (const [x, z] of [
    [-13.5, -0.8],
    [-4.8, 0.75],
    [6.6, -0.75],
    [17, 0.8],
    [36, -0.75],
    [-36, 0.8]
  ]) {
    B.box('flatCyl', x, 0.022, z, 0.52, 0.004, 0.52, '#2c2e31')
    B.box('flatCyl', x, 0.0245, z, 0.4, 0.002, 0.4, '#3b3d40')
  }
  for (const [x, s] of [
    [-9, -1],
    [5, 1],
    [15, -1],
    [-17, 1],
    [21, 1],
    [-31, -1],
    [34, 1]
  ]) {
    B.box('flat', x, 0.022, s * (RW - 0.18), 0.6, 0.004, 0.26, '#232527')
    for (let k = 0; k < 5; k++) B.box('flat', x - 0.24 + k * 0.12, 0.0245, s * (RW - 0.18), 0.03, 0.002, 0.22, '#3a3c3f')
  }

  // ── street trees + lanterns on both main sidewalks ──
  const busStop = (x: number, s: number) => s < 0 && x > 7.6 && x < 11.6
  for (const s of [-1, 1]) {
    const zt = s * (RW + CURB + 0.38)
    for (let k = -9; k <= 9; k++) {
      const x = k * 6.8 + (s > 0 ? 1.7 : 0)
      if (inAvenue(x, 1.8)) continue
      // lanterns midway between trees
      const lx = x + 3.4
      if (!inAvenue(lx, 1.8) && Math.abs(lx) > 1.4 && !busStop(lx, s)) {
        lantern(B, lx, WALK_Y, zt)
        LAMP_SPOTS.push([lx, zt, 0.95])
      }
      if (Math.abs(x) < (s < 0 ? 5.6 : 2.2)) continue // keep the HQ entrance clear
      if (busStop(x, s)) continue
      // tree pit: soil + iron guard
      B.box('flat', x, WALK_Y + 0.003, zt, 0.66, 0.006, 0.66, '#4a3a2c')
      for (const [dx, dz, w, d] of [
        [0, -0.33, 0.66, 0.02],
        [0, 0.33, 0.66, 0.02],
        [-0.33, 0, 0.02, 0.66],
        [0.33, 0, 0.02, 0.66]
      ])
        B.box('metal', x + dx, WALK_Y + 0.1, zt + dz, w, 0.02, d, '#2a2d2f')
      for (const [dx, dz] of [
        [-0.33, -0.33],
        [0.33, -0.33],
        [-0.33, 0.33],
        [0.33, 0.33]
      ])
        B.stand('metal', x + dx, WALK_Y, zt + dz, 0.025, 0.12, 0.025, '#2a2d2f')
      tree(B, x, WALK_Y, zt, 0.85 + h01('st', k * 3 + s) * 0.2, `st${k}${s}`, h01('sts', k * 5 + s) < 0.12 ? 'amber' : 'round')
    }
  }
  // avenue trees + cobra lights along the avenue sidewalks
  for (const ax of AVENUES) {
    for (const s of [-1, 1]) {
      const x = ax + s * (AW + CURB + 0.35)
      for (const zs of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const z = zs * (WALK_OUT + 2.2 + k * 6.5)
          if (k % 2 === 0) cobra(B, x, z + zs * 0.8, -s * 1.2)
          tree(B, x, WALK_Y, z + zs * 3.3, 0.8 + h01('at', k) * 0.25, `av${ax}${s}${zs}${k}`)
        }
      }
    }
  }

  // ── signals: mid-block crosswalk + avenue corners ──
  signal(B, 1.15, -(RW + CURB + 0.3), -1.35, 'sigA')
  signal(B, -1.15, RW + CURB + 0.3, 1.35, 'sigB')
  for (const ax of AVENUES) {
    signal(B, ax + AW + 0.45, -(RW + CURB + 0.3), -1.5, `sa${ax}`)
    signal(B, ax - AW - 0.45, RW + CURB + 0.3, 1.5, `sb${ax}`)
  }

  // ── hydrants ──
  for (const [x, s] of [
    [-5.2, -1],
    [14.6, -1],
    [-19.6, 1],
    [9.4, 1],
    [31.8, -1],
    [-27.2, -1]
  ])
    hydrant(B, x, WALK_Y, s * (RW + CURB + 0.3))
}

// ── plazas + lot ground ──────────────────────────────────────────────

/** stone forecourt pads that meet the sidewalk (HQ flanks, park gate) */
export function buildPlazas(B: Batch): void {
  const pave = C.plaza
  // HQ block plaza — fills the lot around + behind the tower
  B.box('flat', -0.5, 0.02, -12.4, 11.8, 0.04, 13.6, '#bdb3a2')
  for (let i = 0; i < 12; i++) B.box('flat', -6.1 + i * 1.0, 0.042, -12.4, 0.02, 0.003, 13.6, '#aca290')
  for (let j = 0; j < 14; j++) B.box('flat', -0.5, 0.042, -18.7 + j * 1.0, 11.8, 0.003, 0.02, '#aca290')
  // rear courtyard: a pair of shade trees, benches, planters
  for (const [x, z] of [
    [-4.2, -16.4],
    [3.6, -16.8]
  ]) {
    B.stand('solid', x, 0.04, z, 1.2, 0.26, 1.2, '#b9ae9b')
    B.stand('flat', x, 0.3, z, 1.08, 0.02, 1.08, '#4a3a2c')
    tree(B, x, 0.3, z, 1.2, `hqr${x}`, 'wide')
    bench(B, x + 1.2, 0.04, z + 0.6, -Math.PI / 2)
  }
  // HQ forecourt between facade and sidewalk + side strips
  B.box('flat', CITY.hqX, 0.03, (CITY.hqFacadeZ - WALK_OUT) / 2, CITY.hqW + 2.6, 0.06, Math.abs(CITY.hqFacadeZ) - WALK_OUT + 0.1, pave)
  for (const s of [-1, 1]) {
    const x = CITY.hqX + s * (CITY.hqW / 2 + 0.65)
    B.box('flat', x, 0.03, -10.2, 1.3, 0.06, 9.2, pave)
    // granite planter with a clipped shrub pair
    B.stand('solid', x, 0.06, -7.6, 0.9, 0.34, 0.9, '#bdb4a4')
    B.stand('flat', x, 0.4, -7.6, 0.8, 0.02, 0.8, '#4a3a2c')
    B.put('foliage', tm(x, 0.62, -7.6, 0.72, 0.52, 0.72), jit('#4f7a3a', 'hqp', s, 0.05))
    tree(B, x, 0.06, -10.6, 0.9, `hqt${s}`, 'tall')
  }
  // paving grid on the forecourt
  for (let i = -5; i <= 5; i++) B.box('flat', CITY.hqX + i * 0.95, 0.062, -6.15, 0.02, 0.003, 1.1, '#b3ab9c')
}

/** stable color for a far silhouette (fogged, desaturated) */
export function hazeColor(seed: string, n: number): THREE.Color {
  return jit(pick(['#7c8394', '#858a99', '#767f91', '#8a8a96', '#7d8898', '#8f8d98'], seed, n), seed, n + 3, 0.04)
}
