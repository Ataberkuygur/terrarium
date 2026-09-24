/* ── pocket park ───────────────────────────────────────────────────────
 * The green pause west of the HQ: a raised lawn behind a stone curb and
 * wrought-iron fence, gate piers with lanterns at the sidewalk entrance,
 * gravel paths meeting at a paved round plaza with a two-tier fountain,
 * benches around it, tulip beds, clipped hedges, a coffee kiosk with
 * umbrella tables, and a grove of layered-canopy trees (one blossom, one
 * amber accent). Static parts go into the shared Batch; the fountain's
 * moving water is rendered by CityBlock from FOUNTAIN.
 */
import { Batch, h01, jit, pick, tm } from './kit'
import { CITY, CITY_COLORS } from './layout'
import { bench, lantern, tree, LAMP_SPOTS, type TreeStyle } from './street'

const C = CITY_COLORS
export const PARK = {
  x0: CITY.gardenX - CITY.gardenW / 2,
  x1: CITY.gardenX + CITY.gardenW / 2,
  z0: CITY.gardenZ - CITY.gardenD / 2,
  z1: CITY.gardenZ + CITY.gardenD / 2
}
const PY = 0.14 // lawn top
const cx = CITY.gardenX
const cz = CITY.gardenZ - 0.6 // plaza a touch north of center
export const FOUNTAIN = { x: cx, z: cz, y: PY }
export const PLAZA_R = 2.7

/** plaza benches (x, y, z, yaw) — StreetLife seats a few park-goers here */
export const PARK_BENCHES: [number, number, number, number][] = [0, 1, 2, 3].map((i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2
  const r = PLAZA_R - 0.35
  const bx = cx + Math.cos(a) * r
  const bz = cz + Math.sin(a) * r
  return [bx, PY + 0.012, bz, Math.atan2(cx - bx, cz - bz)]
})

const FLOWERS = ['#d8394a', '#f2c43c', '#f28bb0', '#fbf3e4', '#9b6cc9', '#f07a3a']

export function buildPark(B: Batch): void {
  const { x0, x1, z0, z1 } = PARK
  const w = x1 - x0
  const d = z1 - z0
  // lawn slab + stone edging
  B.box('flat', cx, PY / 2, (z0 + z1) / 2, w, PY, d, C.grass)
  const stone = '#c9bfae'
  B.box('solid', cx, 0.1, z1 - 0.1, w, 0.2, 0.2, stone)
  B.box('solid', cx, 0.1, z0 + 0.1, w, 0.2, 0.2, stone)
  B.box('solid', x0 + 0.1, 0.1, (z0 + z1) / 2, 0.2, 0.2, d, stone)
  B.box('solid', x1 - 0.1, 0.1, (z0 + z1) / 2, 0.2, 0.2, d, stone)
  // mowing stripes — alternating lawn tone
  for (let i = 0; i < 10; i++) {
    if (i % 2) continue
    B.box('flat', x0 + 0.2 + (i + 0.5) * ((w - 0.4) / 10), PY + 0.001, (z0 + z1) / 2, (w - 0.4) / 10, 0.002, d - 0.4, C.grassDark)
  }

  // ── paths: south gate → plaza, west gate → plaza, plaza → northeast ──
  const path = C.path
  const pathEdge = '#b9a98a'
  const gateX = cx
  B.box('flat', gateX, PY + 0.004, (z1 + cz) / 2, 1.5, 0.008, z1 - cz, path)
  B.box('flat', (x0 + cx) / 2, PY + 0.004, cz, cx - x0, 0.008, 1.3, path)
  B.box('flat', cx, PY + 0.004, (z0 + cz) / 2, 1.2, 0.008, cz - z0, path)
  for (const s of [-1, 1]) {
    B.box('flat', gateX + s * 0.78, PY + 0.006, (z1 + cz) / 2, 0.06, 0.012, z1 - cz, pathEdge)
    B.box('flat', (x0 + cx) / 2, PY + 0.006, cz + s * 0.68, cx - x0, 0.012, 0.06, pathEdge)
  }
  // diagonal to the kiosk corner
  {
    const ax = cx + 1.8
    const az = cz + 1.3
    const bx = x1 - 1.6
    const bz = z1 - 3.4
    const len = Math.hypot(bx - ax, bz - az)
    B.put('flat', tm((ax + bx) / 2, PY + 0.003, (az + bz) / 2, len, 0.008, 1.0, -Math.atan2(bz - az, bx - ax)), path)
  }
  // round plaza with a paving ring
  B.box('flatCyl', cx, PY + 0.006, cz, PLAZA_R * 2, 0.012, PLAZA_R * 2, '#d9ceb9')
  B.box('flatCyl', cx, PY + 0.009, cz, PLAZA_R * 2 - 0.3, 0.012, PLAZA_R * 2 - 0.3, '#cfc2aa')
  B.box('flatCyl', cx, PY + 0.012, cz, 3.3, 0.012, 3.3, '#d9ceb9')

  // ── fountain (static stone; water is animated in CityBlock) ──
  const fy = PY + 0.012
  B.stand('cyl', cx, fy, cz, 2.5, 0.3, 2.5, '#d6cbb6')
  B.stand('cyl', cx, fy + 0.3, cz, 2.62, 0.06, 2.62, '#e2d8c4')
  B.stand('cyl', cx, fy, cz, 0.42, 0.7, 0.42, '#d6cbb6')
  B.put('cone', tm(cx, fy + 0.59, cz, 1.1, 0.22, 1.1, 0, Math.PI), '#e2d8c4') // upturned bowl
  B.stand('cyl', cx, fy + 0.7, cz, 1.12, 0.06, 1.12, '#e2d8c4')
  B.stand('cyl', cx, fy + 0.76, cz, 0.2, 0.3, 0.2, '#d6cbb6')
  B.stand('sphere', cx, fy + 1.04, cz, 0.24, 0.2, 0.24, '#e2d8c4')

  // benches around the plaza, facing the fountain
  for (const [bx, by, bz, yaw] of PARK_BENCHES) bench(B, bx, by, bz, yaw)
  // park lanterns at path mouths around the plaza
  for (const [lx, lz] of [
    [cx - 1.0, cz + PLAZA_R + 0.2],
    [cx + 1.0, cz + PLAZA_R + 0.2],
    [cx - PLAZA_R - 0.2, cz - 0.9],
    [cx + 0.9, cz - PLAZA_R - 0.2]
  ]) {
    lantern(B, lx, PY, lz, 0.9)
    LAMP_SPOTS.push([lx, lz, 0.85])
  }

  // ── fence on the edging + gate piers ──
  const iron = '#23272a'
  const fence = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az)
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    for (const y of [0.3, 0.62]) B.box('metal', mx, y, mz, alongX ? len : 0.025, 0.025, alongX ? 0.025 : len, iron)
    const n = Math.round(len / 0.13)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      B.stand('metal', px, 0.2, pz, 0.014, 0.47, 0.014, iron)
      if (i % 2 === 0) B.stand('cone', px, 0.67, pz, 0.035, 0.06, 0.035, iron)
    }
  }
  const gz = z1 - 0.1
  fence(x0 + 0.1, gz, gateX - 1.25, gz)
  fence(gateX + 1.25, gz, x1 - 0.1, gz)
  fence(x0 + 0.1, z0 + 0.1, x0 + 0.1, cz - 1.05)
  fence(x0 + 0.1, cz + 1.05, x0 + 0.1, gz)
  fence(x1 - 0.1, z0 + 0.1, x1 - 0.1, gz)
  // gate piers — stone posts with lantern tops at both gates
  for (const [px, pz] of [
    [gateX - 1.1, gz],
    [gateX + 1.1, gz],
    [x0 + 0.1, cz - 0.9],
    [x0 + 0.1, cz + 0.9]
  ]) {
    B.stand('solid', px, 0, pz, 0.36, 0.78, 0.36, '#cbbfa9')
    B.stand('solid', px, 0.78, pz, 0.44, 0.07, 0.44, '#ddd3c0')
    B.stand('litSphere', px, 0.85, pz, 0.2, 0.22, 0.2, '#ffd892')
    B.stand('cone', px, 1.06, pz, 0.24, 0.1, 0.24, iron)
  }
  // park name plaque on the south gate pier
  B.box('solid', gateX - 1.1, 0.48, gz + 0.185, 0.26, 0.16, 0.012, '#2c3a30')
  B.box('lit', gateX - 1.1, 0.48, gz + 0.192, 0.18, 0.03, 0.004, '#e8d9a8')

  // ── clipped hedges inside the fence ──
  const hedge = C.hedge
  const hedgeRun = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 1.6))
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az)
      B.stand('bevel', px, PY, pz, alongX ? len / n - 0.04 : 0.42, 0.4, alongX ? 0.42 : len / n - 0.04, jit(hedge, 'hg', i + Math.round(ax * 10), 0.05))
    }
  }
  hedgeRun(x0 + 0.45, gz - 0.35, gateX - 1.4, gz - 0.35)
  hedgeRun(gateX + 1.4, gz - 0.35, x1 - 0.45, gz - 0.35)
  hedgeRun(x1 - 0.45, gz - 0.8, x1 - 0.45, z0 + 0.45)
  hedgeRun(x0 + 0.45, z0 + 0.45, x1 - 0.8, z0 + 0.45)

  // ── tulip beds either side of the south path ──
  for (const s of [-1, 1]) {
    const bx = gateX + s * 2.35
    const bz = z1 - 2.45
    const bw = 2.2
    const bd = 2.3
    B.stand('solid', bx, PY, bz, bw + 0.14, 0.12, bd + 0.14, '#b8ad98')
    B.stand('flat', bx, PY + 0.12, bz, bw, 0.01, bd, '#4b3829')
    const rows = 6
    const cols = 7
    for (let r = 0; r < rows; r++) {
      const col = FLOWERS[(r + (s > 0 ? 2 : 0)) % FLOWERS.length]
      for (let c = 0; c < cols; c++) {
        const fx = bx - bw / 2 + 0.16 + (c + (r % 2) * 0.5) * ((bw - 0.32) / cols)
        const fz = bz - bd / 2 + 0.2 + r * ((bd - 0.4) / (rows - 1))
        const k = r * 17 + c + (s > 0 ? 300 : 0)
        B.stand('foliage', fx, PY + 0.12, fz, 0.16, 0.14, 0.16, jit('#4f7a3a', 'lf', k, 0.06))
        B.put('sphere', tm(fx + (h01('fx', k) - 0.5) * 0.05, PY + 0.29 + h01('fy', k) * 0.05, fz, 0.1, 0.12, 0.1), jit(col, 'fl', k, 0.05))
      }
    }
  }
  // round bed at the diagonal path's end
  {
    const bx = x1 - 1.55
    const bz = z1 - 4.6
    B.stand('cyl', bx, PY, bz, 1.4, 0.12, 1.4, '#b8ad98')
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const r = 0.25 + (i % 3) * 0.14
      B.put('sphere', tm(bx + Math.cos(a) * r, PY + 0.2, bz + Math.sin(a) * r, 0.1, 0.1, 0.1), jit(pick(FLOWERS, 'rb', i), 'rb', i, 0.05))
    }
  }

  // ── coffee kiosk + umbrella tables (northeast lawn) ──
  const kx = x1 - 2.0
  const kz = z0 + 2.2
  B.stand('flat', kx - 0.4, PY, kz + 0.8, 3.6, 0.012, 3.0, '#d3c7b1')
  B.stand('solid', kx, PY, kz, 1.25, 0.95, 0.9, '#2f5b46')
  B.stand('solid', kx, PY + 0.95, kz, 1.45, 0.08, 1.1, '#e9e1d0')
  B.box('lit', kx, PY + 0.62, kz + 0.455, 0.9, 0.34, 0.01, '#ffd9a0')
  B.box('solid', kx, PY + 0.44, kz + 0.52, 1.0, 0.04, 0.14, '#e9e1d0')
  for (let i = 0; i < 7; i++) {
    const u = kx - 0.62 + (i + 0.5) * (1.24 / 7)
    B.put('solid', tm(u, PY + 0.88, kz + 0.62, 1.24 / 7, 0.02, 0.36, 0, 0.45), i % 2 ? '#f1eadb' : '#2f5b46')
  }
  const umbrellas = ['#c0583a', '#f1eadb', '#2c4a73']
  for (let i = 0; i < 3; i++) {
    const tx = kx - 1.75 + (i % 2) * 0.35
    const tz = kz + 0.1 + i * 0.95
    B.stand('cylMetal', tx, PY, tz, 0.03, 0.3, 0.03, '#2b2e30')
    B.stand('cyl', tx, PY + 0.3, tz, 0.42, 0.02, 0.42, '#e9e5dc')
    B.stand('cylMetal', tx, PY + 0.3, tz, 0.02, 0.5, 0.02, '#e9e5dc')
    B.stand('cone', tx, PY + 0.66, tz, 0.95, 0.2, 0.95, umbrellas[i])
    for (const a of [0, 2.1, 4.2]) B.stand('bevel', tx + Math.cos(a) * 0.36, PY, tz + Math.sin(a) * 0.36, 0.16, 0.2, 0.16, '#2b2e30')
  }

  // ── trees: a loose grove framing the plaza ──
  const TREES: [number, number, number, TreeStyle][] = [
    [x0 + 1.4, z1 - 1.6, 1.1, 'round'],
    [x0 + 2.2, z1 - 4.4, 0.95, 'wide'],
    [x0 + 1.3, z0 + 3.0, 1.2, 'round'],
    [x0 + 3.0, z0 + 1.3, 1.05, 'tall'],
    [cx - 1.6, z0 + 1.2, 1.25, 'wide'],
    [cx + 2.2, z0 + 1.4, 1.0, 'blossom'],
    [x1 - 1.3, cz + 0.2, 1.05, 'round'],
    [x1 - 1.2, z1 - 1.5, 0.9, 'amber'],
    [cx - 3.6, cz - 2.6, 0.95, 'round'],
    [x0 + 0.9, cz + 2.3, 0.8, 'tall']
  ]
  TREES.forEach(([tx, tz, s, style], i) => tree(B, tx, PY, tz, s * 1.15, `pk${i}`, style))
}
