/* ── city buildings ────────────────────────────────────────────────────
 * Procedural NYC building types, all emitted into a shared `Batch`:
 *
 *   brownstone   raised stoop + iron rail, rusticated garden level,
 *                lintels/sills, heavy bracketed cornice, chimneys
 *   walkup       brick tenement: storefront + striped awning + sign band,
 *                front fire escape, bracketed cornice, rooftop water tower
 *   deco         limestone setback tower: vertical piers, dark spandrels,
 *                bronze base, stepped crown with glowing fins + spire
 *   glass        modern curtain-wall tower: mullions, spandrel lines,
 *                lit office cells, louvered mechanical crown
 *   modern       concrete mid-rise with ribbon windows + roof garden
 *   prewar       limestone-and-brick apartment block, rusticated base
 *
 * Every building is a list of Masses (axis-aligned boxes) plus face
 * dressing. Faces are named by compass: 's' faces +z (the camera side),
 * 'n' faces -z, 'e' +x, 'w' -x. `street` names the face that fronts a
 * sidewalk (storefronts, stoops); `open` lists which other faces are
 * exposed and deserve windows (party walls stay blank — never visible).
 *
 * `lod` 1 drops sills/lintels/fire escapes for the far rows — windows stay.
 */
import * as THREE from 'three'
import { Batch, h01, jit, pick, tm } from './kit'

// ── palette ──────────────────────────────────────────────────────────

export const PAL = {
  brownstone: ['#7a4e3c', '#845743', '#6e4637', '#8d6149'],
  brick: ['#a24f3a', '#9a4a36', '#b0603f', '#8e4634', '#a8573e'],
  tan: ['#c29a6b', '#b8875a', '#c9a57a', '#b99470'],
  limestone: ['#e0d3b8', '#d8c8a8', '#e6dcc8', '#d4c3a3'],
  painted: ['#9fae94', '#8fa3b4', '#c27a5a', '#d6a39a', '#b7b08e', '#c9b48a'],
  concrete: ['#c8c3ba', '#bdb8b0', '#d3cfc6', '#aeb0ae'],
  glass: ['#3f6f7c', '#45688a', '#4f7f86', '#3b5f78', '#56808f'],
  trimLight: ['#efe6d2', '#e7dcc4', '#f2ecdf'],
  trimDark: ['#2f4a3c', '#2a2b2e', '#4a2f2a', '#2e3b4d'],
  awning: ['#2f6b4f', '#8c2f3a', '#2c4a73', '#d19a2e', '#c0583a', '#5a3d6b', '#1f5c5a'],
  sign: ['#1f2a33', '#6b1f24', '#1d3a2e', '#2d2a45', '#3b2a1e'],
  roof: ['#6d6660', '#7c756c', '#625d58', '#857d71'],
  paneDark: ['#2c3a47', '#34485a', '#3f566b', '#2a3440', '#4a6378'],
  paneSky: ['#7894ab', '#88a2b6', '#6e8ba3'],
  lit: ['#ffd49a', '#ffe2b0', '#f7c27c', '#ffecc8', '#ffcf8a'],
  metal: '#2b2d31',
  wood: '#7d5a40'
}

/* golden hour: only a scatter of interiors are lit yet */
const LIT_SCALE = 0.5

// ── masses & faces ───────────────────────────────────────────────────

export interface Mass {
  x0: number
  x1: number
  z0: number
  z1: number
  y0: number
  y1: number
}

export type FaceId = 'n' | 's' | 'e' | 'w'

interface Face {
  id: FaceId
  /** outward normal sign along its axis */
  sgn: 1 | -1
  /** true when the face is perpendicular to z (tangent runs along x) */
  alongX: boolean
  /** plane coordinate (z for n/s faces, x for e/w faces) */
  p: number
  a0: number
  a1: number
}

function face(m: Mass, id: FaceId): Face {
  switch (id) {
    case 's':
      return { id, sgn: 1, alongX: true, p: m.z1, a0: m.x0, a1: m.x1 }
    case 'n':
      return { id, sgn: -1, alongX: true, p: m.z0, a0: m.x0, a1: m.x1 }
    case 'e':
      return { id, sgn: 1, alongX: false, p: m.x1, a0: m.z0, a1: m.z1 }
    default:
      return { id, sgn: -1, alongX: false, p: m.x0, a0: m.z0, a1: m.z1 }
  }
}

type Col = THREE.ColorRepresentation | THREE.Color

/** place a face-aligned slab: `u` along the face, `out` = distance from
 *  the wall plane to the slab's center, `thick` = depth off the wall */
function fput(
  B: Batch,
  kind: Parameters<Batch['box']>[0],
  F: Face,
  u: number,
  y: number,
  w: number,
  h: number,
  out: number,
  thick: number,
  color: Col
): void {
  const c = F.p + F.sgn * out
  if (F.alongX) B.box(kind, u, y, c, w, h, thick, color)
  else B.box(kind, c, y, u, thick, h, w, color)
}

function addMass(B: Batch, m: Mass, color: Col, kind: 'solid' | 'glass' = 'solid'): Mass {
  B.box(kind, (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, (m.z0 + m.z1) / 2, m.x1 - m.x0, m.y1 - m.y0, m.z1 - m.z0, color)
  return m
}

/** inset copy of a mass (setbacks) */
const inset = (m: Mass, dx: number, dzFront: number, dzBack: number, y0: number, y1: number): Mass => ({
  x0: m.x0 + dx,
  x1: m.x1 - dx,
  z0: m.z0 + dzBack,
  z1: m.z1 - dzFront,
  y0,
  y1
})

// ── windows ──────────────────────────────────────────────────────────

interface WinOpts {
  y0: number // bottom of the first windowed floor
  floors: number
  fh: number // floor-to-floor
  cols: number
  ww: number // window width
  wh: number // window height
  sill: number // window bottom above the floor line
  margin: number // clear band at each face edge
  lit: number // probability a pane is lit
  seed: string
  trim?: Col | null // sill + lintel color (null → none)
  lintelH?: number
  skip?: (c: number, r: number) => boolean
  sky?: number // probability a dark pane mirrors the sky
  frame?: Col | null // thin frame surround behind the pane
}

function windows(B: Batch, F: Face, o: WinOpts, lod: number): void {
  const span = F.a1 - F.a0 - o.margin * 2
  if (span <= o.ww * 0.8) return
  const pitch = span / o.cols
  const sky = o.sky ?? 0.18
  for (let r = 0; r < o.floors; r++) {
    const yb = o.y0 + r * o.fh + o.sill
    const yc = yb + o.wh / 2
    for (let c = 0; c < o.cols; c++) {
      if (o.skip?.(c, r)) continue
      const u = F.a0 + o.margin + (c + 0.5) * pitch
      const k = r * 131 + c
      const lit = h01(o.seed + F.id, k) < o.lit * LIT_SCALE
      if (o.frame && lod === 0)
        fput(B, 'solid', F, u, yc, o.ww + 0.07, o.wh + 0.07, 0.012, 0.024, o.frame)
      if (lit) fput(B, 'lit', F, u, yc, o.ww, o.wh, 0.018, 0.02, jit(pick(PAL.lit, o.seed, k), o.seed, k, 0.06).multiplyScalar(0.86))
      else {
        const pal = h01(o.seed + 'sk' + F.id, k) < sky ? PAL.paneSky : PAL.paneDark
        fput(B, 'pane', F, u, yc, o.ww, o.wh, 0.018, 0.02, pick(pal, o.seed + 'p', k))
      }
      if (o.trim && lod === 0) {
        // projecting sill + a slightly wider lintel/header
        fput(B, 'solid', F, u, yb - 0.025, o.ww + 0.1, 0.045, 0.045, 0.09, o.trim)
        const lh = o.lintelH ?? 0.07
        fput(B, 'solid', F, u, yb + o.wh + lh / 2 + 0.01, o.ww + 0.12, lh, 0.025, 0.05, o.trim)
      }
    }
  }
}

// ── roofs ────────────────────────────────────────────────────────────

interface RoofOpts {
  parapet: Col
  roof?: Col
  seed: string
  lod: number
  clutter?: boolean
  parapetH?: number
}

function roof(B: Batch, m: Mass, o: RoofOpts): void {
  const w = m.x1 - m.x0
  const d = m.z1 - m.z0
  const cx = (m.x0 + m.x1) / 2
  const cz = (m.z0 + m.z1) / 2
  const ph = o.parapetH ?? 0.16
  const t = 0.09
  const y = m.y1
  // tar/gravel roof deck
  B.box('solid', cx, y + 0.01, cz, w - 0.02, 0.02, d - 0.02, o.roof ?? pick(PAL.roof, o.seed, 1))
  // parapet ring
  B.box('solid', cx, y + ph / 2, m.z1 - t / 2, w, ph, t, o.parapet)
  B.box('solid', cx, y + ph / 2, m.z0 + t / 2, w, ph, t, o.parapet)
  B.box('solid', m.x0 + t / 2, y + ph / 2, cz, t, ph, d - 2 * t, o.parapet)
  B.box('solid', m.x1 - t / 2, y + ph / 2, cz, t, ph, d - 2 * t, o.parapet)
  if (!o.clutter) return
  // stair bulkhead toward the back
  const bw = Math.min(1.1, w * 0.3)
  const bx = cx + (h01(o.seed, 3) - 0.5) * (w - bw - 0.4)
  B.stand('solid', bx, y, m.z0 + 0.9, bw, 0.62, 0.9, jit(o.parapet, o.seed, 4, 0.06))
  B.stand('solid', bx, y + 0.62, m.z0 + 0.9, bw + 0.08, 0.05, 0.98, '#57534e')
  if (o.lod > 0) return
  // AC units + vents
  const nAc = 1 + Math.floor(h01(o.seed, 5) * 3)
  for (let i = 0; i < nAc; i++) {
    const ax = m.x0 + 0.5 + h01(o.seed, 10 + i) * Math.max(0.1, w - 1)
    const az = cz + (h01(o.seed, 20 + i) - 0.3) * (d - 1.2) * 0.8
    if (Math.abs(ax - bx) < bw / 2 + 0.3 && az < m.z0 + 1.5) continue
    B.stand('solid', ax, y, az, 0.42, 0.26, 0.32, '#b9bcbf')
    B.stand('cylMetal', ax, y + 0.26, az, 0.2, 0.02, 0.2, '#3a3d42')
  }
  if (h01(o.seed, 30) < 0.6) {
    const vx = m.x0 + 0.4 + h01(o.seed, 31) * (w - 0.8)
    B.stand('cylMetal', vx, y, m.z1 - 0.6, 0.1, 0.35, 0.1, '#8d9196')
  }
}

/** NYC rooftop water tower — stilts, wood tank with steel hoops, cone cap */
export function waterTower(B: Batch, x: number, y: number, z: number, s = 1): void {
  const legH = 0.55 * s
  const r = 0.36 * s
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ])
    B.stand('metal', x + dx * r * 0.62, y, z + dz * r * 0.62, 0.045 * s, legH, 0.045 * s, PAL.metal)
  B.stand('metal', x, y + legH * 0.45, z, r * 1.3, 0.03, 0.03, PAL.metal)
  B.stand('metal', x, y + legH * 0.45, z, 0.03, 0.03, r * 1.3, PAL.metal)
  B.stand('solid', x, y + legH, z, r * 1.7, 0.04 * s, r * 1.7, '#4a4038')
  const tankH = 0.62 * s
  B.stand('cyl', x, y + legH + 0.04 * s, z, r * 2, tankH, r * 2, jit(PAL.wood, 'wt', Math.round(x * 10), 0.06))
  for (const f of [0.22, 0.55, 0.85])
    B.stand('cylMetal', x, y + legH + 0.04 * s + tankH * f, z, r * 2.04, 0.025 * s, r * 2.04, '#3b3a38')
  B.stand('cone', x, y + legH + 0.04 * s + tankH, z, r * 2.15, 0.3 * s, r * 2.15, '#4b3e34')
  B.stand('metal', x, y + legH + tankH + 0.3 * s, z, 0.03, 0.12 * s, 0.03, PAL.metal)
}

/** small planted roof garden — raised beds with shrubs + a pergola */
function roofGarden(B: Batch, m: Mass, seed: string): void {
  const w = m.x1 - m.x0
  const d = m.z1 - m.z0
  const y = m.y1
  const n = Math.max(2, Math.floor(w / 1.3))
  for (let i = 0; i < n; i++) {
    const x = m.x0 + 0.6 + (i * (w - 1.2)) / Math.max(1, n - 1)
    const z = m.z1 - 0.55
    B.stand('solid', x, y, z, 0.8, 0.18, 0.4, '#6b5343')
    B.put('foliage', tm(x - 0.15, y + 0.3, z, 0.42, 0.34, 0.36), jit('#557a3e', seed, i, 0.08))
    B.put('foliage', tm(x + 0.18, y + 0.34, z, 0.36, 0.42, 0.34), jit('#6a8d45', seed, i + 50, 0.08))
  }
  if (d > 3 && w > 2.6) {
    const px = m.x0 + w * 0.3
    const pz = m.z0 + d * 0.45
    for (const [dx, dz] of [
      [-0.6, -0.4],
      [0.6, -0.4],
      [-0.6, 0.4],
      [0.6, 0.4]
    ])
      B.stand('solid', px + dx, y, pz + dz, 0.05, 0.62, 0.05, '#e9e2d4')
    for (let k = 0; k < 5; k++) B.stand('solid', px - 0.6 + k * 0.3, y + 0.62, pz, 0.04, 0.04, 1.0, '#e9e2d4')
    B.put('foliage', tm(px + 1.1, y + 0.45, pz + 0.2, 0.7, 0.9, 0.7), jit('#4f7438', seed, 99, 0.06))
  }
}

// ── storefront ───────────────────────────────────────────────────────

interface StoreOpts {
  h: number // storefront height
  seed: string
  awning?: Col | null
  sign?: Col | null
  frame?: Col
  bays?: number
  lod: number
}

/** ground-floor shopfront on face F between u0..u1 */
function storefront(B: Batch, F: Face, u0: number, u1: number, o: StoreOpts): void {
  const w = u1 - u0
  const uc = (u0 + u1) / 2
  const frame = o.frame ?? '#2b2c2f'
  const bays = o.bays ?? Math.max(1, Math.round(w / 1.1))
  const gy0 = 0.2
  const gy1 = o.h - 0.34
  // bulkhead + frame surround
  fput(B, 'solid', F, uc, 0.1, w, 0.2, 0.03, 0.06, frame)
  fput(B, 'solid', F, uc, (gy0 + gy1) / 2, w, gy1 - gy0 + 0.06, 0.01, 0.02, frame)
  // glowing shop interior — each bay slightly different warmth
  const bw = w / bays
  for (let i = 0; i < bays; i++) {
    const u = u0 + (i + 0.5) * bw
    const isDoor = i === Math.floor(bays / 2) && bays > 1
    const col = isDoor ? '#3a3026' : jit(pick(PAL.lit, o.seed + 'sf', i), o.seed, i, 0.1).multiplyScalar(0.92)
    fput(B, isDoor ? 'pane' : 'lit', F, u, (gy0 + gy1) / 2, bw - 0.08, gy1 - gy0 - 0.02, 0.025, 0.02, col)
    if (!isDoor && o.lod === 0) {
      // transom bar across the glass
      fput(B, 'solid', F, u, gy1 - 0.16, bw - 0.08, 0.035, 0.04, 0.02, frame)
    }
  }
  // sign band
  if (o.sign) {
    fput(B, 'solid', F, uc, o.h - 0.18, w - 0.1, 0.24, 0.045, 0.06, o.sign)
    if (o.lod === 0) {
      // lettered shop name, glowing — one quad in the shared sign atlas
      const sw = Math.min(w - 0.3, 1.9)
      const c = F.p + F.sgn * 0.078
      B.sign({
        x: F.alongX ? uc : c,
        y: o.h - 0.18,
        z: F.alongX ? c : uc,
        w: sw,
        h: Math.min(0.22, sw / 5),
        face: F.id,
        row: Math.floor(h01(o.seed, 77) * 1000)
      })
    }
  }
  // striped awning — sloped canopy + valance
  if (o.awning && o.lod === 0) {
    const stripes = Math.max(4, Math.round(w / 0.22))
    const sw = (w - 0.1) / stripes
    const proj = 0.5
    const drop = 0.22
    const len = Math.hypot(proj, drop)
    const ang = Math.atan2(drop, proj)
    const yTop = o.h - 0.34
    for (let i = 0; i < stripes; i++) {
      const u = u0 + 0.05 + (i + 0.5) * sw
      const col = i % 2 ? '#f1eadb' : o.awning
      const cOut = F.p + F.sgn * (proj / 2)
      const y = yTop - drop / 2
      if (F.alongX) B.put('solid', tm(u, y, cOut, sw, 0.025, len, 0, F.sgn * ang), col)
      else B.put('solid', tm(cOut, y, u, len, 0.025, sw, 0, 0, -F.sgn * ang), col)
      fput(B, 'solid', F, u, yTop - drop - 0.07, sw, 0.14, proj, 0.02, col)
    }
  }
}

// ── fire escape ──────────────────────────────────────────────────────

function fireEscape(B: Batch, F: Face, u0: number, u1: number, y0: number, floors: number, fh: number): void {
  const w = u1 - u0
  const uc = (u0 + u1) / 2
  const dep = 0.42
  const M = PAL.metal
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * fh
    // platform grate + front/side rails + balusters
    fput(B, 'metal', F, uc, y, w, 0.025, dep / 2, dep, M)
    fput(B, 'metal', F, uc, y + 0.3, w, 0.022, dep - 0.01, 0.022, M)
    fput(B, 'metal', F, uc, y + 0.15, w, 0.014, dep - 0.01, 0.014, M)
    const nb = Math.max(3, Math.round(w / 0.24))
    for (let i = 0; i <= nb; i++) fput(B, 'metal', F, u0 + (i * w) / nb, y + 0.15, 0.014, 0.3, dep - 0.01, 0.014, M)
    for (const uu of [u0, u1]) {
      const c = F.p + F.sgn * (dep / 2)
      if (F.alongX) B.box('metal', uu, y + 0.3, c, 0.022, 0.022, dep, M)
      else B.box('metal', c, y + 0.3, uu, dep, 0.022, 0.022, M)
    }
    // stair to the next platform, alternating direction
    if (f < floors - 1) {
      const run = Math.min(w * 0.55, 0.85)
      const dir = f % 2 ? -1 : 1
      const us = dir > 0 ? u0 + 0.12 : u1 - 0.12
      const um = us + (dir * run) / 2
      const len = Math.hypot(run, fh)
      const ang = Math.atan2(fh, run) * dir
      const c = F.p + F.sgn * (dep * 0.62)
      if (F.alongX) B.put('metal', tm(um, y + fh / 2, c, len, 0.03, 0.14, 0, 0, ang), M)
      else B.put('metal', tm(c, y + fh / 2, um, 0.14, 0.03, len, 0, -ang, 0), M)
    }
  }
  // drop ladder under the lowest platform
  const c = F.p + F.sgn * (dep * 0.8)
  for (const du of [-0.08, 0.08]) {
    const u = u1 - 0.25 + du
    if (F.alongX) B.box('metal', u, y0 - 0.35, c, 0.02, 0.7, 0.02, M)
    else B.box('metal', c, y0 - 0.35, u, 0.02, 0.7, 0.02, M)
  }
}

// ── cornice ──────────────────────────────────────────────────────────

function cornice(B: Batch, m: Mass, faces: FaceId[], color: Col, lod: number, size = 1): void {
  const y = m.y1
  for (const id of faces) {
    const F = face(m, id)
    const len = F.a1 - F.a0
    const uc = (F.a0 + F.a1) / 2
    // frieze band, crown mold
    fput(B, 'solid', F, uc, y - 0.2 * size, len, 0.16 * size, 0.035, 0.07, color)
    fput(B, 'solid', F, uc, y + 0.05 * size, len + 0.2 * size, 0.12 * size, 0.1 * size, 0.2 * size, color)
    if (lod === 0) {
      // brackets / dentils under the crown
      const n = Math.max(3, Math.round(len / 0.34))
      for (let i = 0; i <= n; i++)
        fput(B, 'solid', F, F.a0 + (i * len) / n, y - 0.06 * size, 0.06, 0.14 * size, 0.07 * size, 0.1 * size, color)
    }
  }
}

// ── building types ───────────────────────────────────────────────────

export interface Lot {
  x0: number
  x1: number
  z0: number
  z1: number
  street: FaceId
  open?: FaceId[] // other exposed faces (windows)
  seed: string
  lod?: number
}

/** sidewalk-facing faces first, then any exposed sides */
const facesOf = (L: Lot): FaceId[] => [L.street, ...(L.open ?? []).filter((f) => f !== L.street)]

/** Brownstone rowhouse. Street face must be 's' or 'n'. */
export function brownstone(B: Batch, L: Lot, floors = 4, color?: Col): number {
  const lod = L.lod ?? 0
  const col = color ?? pick(PAL.brownstone, L.seed)
  const base = 0.62
  const fh = 0.9
  const H = base + floors * fh + 0.12
  const stoopD = 0.95
  // body sits back from the lot's street line by the stoop depth
  const sgn = L.street === 's' ? 1 : -1
  const m: Mass =
    L.street === 's'
      ? { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1 - stoopD, y0: 0, y1: H }
      : { x0: L.x0, x1: L.x1, z0: L.z0 + stoopD, z1: L.z1, y0: 0, y1: H }
  addMass(B, m, col)
  const F = face(m, L.street)
  const w = L.x1 - L.x0
  const trim = jit(col, L.seed + 't', 0, 0.08).offsetHSL(0, -0.05, 0.08)
  // rusticated garden level
  fput(B, 'solid', F, (F.a0 + F.a1) / 2, base / 2, w, base, 0.02, 0.04, jit(col, L.seed, 2, 0.04).offsetHSL(0, 0, -0.06))
  for (let i = 1; i < 4; i++) fput(B, 'solid', F, (F.a0 + F.a1) / 2, (base * i) / 4, w, 0.018, 0.045, 0.012, jit(col, L.seed, 3).offsetHSL(0, 0, -0.12))
  // stoop on the left or right bay
  const left = h01(L.seed, 9) < 0.5
  const doorU = left ? F.a0 + w * 0.22 : F.a1 - w * 0.22
  const sw = 0.62
  const steps = 5
  const rise = base / steps
  for (let k = 1; k <= steps; k++) {
    const depth = ((steps - k + 1) / steps) * stoopD
    B.box('solid', doorU, (k * rise) / 2, F.p + sgn * (depth / 2), sw, k * rise, depth, jit(col, L.seed, 40 + k, 0.03))
  }
  B.box('solid', doorU, base / 2, F.p + sgn * 0.06, sw + 0.02, base, 0.12, col)
  // cheek walls + sloped iron handrails
  for (const s of [-1, 1]) {
    const u = doorU + s * (sw / 2 + 0.04)
    B.box('solid', u, base * 0.45, F.p + sgn * (stoopD * 0.45), 0.08, base * 0.9, stoopD * 0.9, jit(col, L.seed, 50, 0.03).offsetHSL(0, 0, -0.03))
    if (lod === 0) {
      const len = Math.hypot(stoopD, base)
      const ang = Math.atan2(base, stoopD) * sgn
      B.put('metal', tm(u, base * 0.5 + 0.34, F.p + sgn * (stoopD / 2), 0.025, 0.025, len, 0, ang), PAL.metal)
      B.stand('metal', u, base * 0.02, F.p + sgn * (stoopD - 0.03), 0.03, 0.4, 0.03, PAL.metal)
      B.stand('sphere', u, 0.4, F.p + sgn * (stoopD - 0.03), 0.06, 0.06, 0.06, PAL.metal)
    }
  }
  // door with stone surround + small pediment, glowing transom
  const doorCol = pick(['#2f2219', '#23362c', '#5a2626', '#1f2b3a', '#3a2a1c'], L.seed, 11)
  fput(B, 'solid', F, doorU, base + 0.42, 0.5, 0.86, 0.02, 0.04, trim)
  fput(B, 'solid', F, doorU, base + 0.36, 0.34, 0.66, 0.04, 0.03, doorCol)
  fput(B, 'lit', F, doorU, base + 0.76, 0.3, 0.08, 0.045, 0.02, '#ffd9a3')
  fput(B, 'solid', F, doorU, base + 0.92, 0.6, 0.07, 0.07, 0.12, trim)
  // windows: parlor floor (tall), upper floors, basement
  const cols = 3
  const doorCol0 = left ? 0 : cols - 1
  windows(B, F, {
    y0: base,
    floors: 1,
    fh,
    cols,
    ww: 0.36,
    wh: 0.66,
    sill: 0.1,
    margin: 0.12,
    lit: 0.35,
    seed: L.seed + 'p',
    trim,
    lintelH: 0.1,
    skip: (c) => c === doorCol0,
    frame: '#e9e2d2'
  }, lod)
  windows(B, F, {
    y0: base + fh,
    floors: floors - 1,
    fh,
    cols,
    ww: 0.34,
    wh: 0.54,
    sill: 0.16,
    margin: 0.12,
    lit: 0.22,
    seed: L.seed + 'u',
    trim,
    frame: '#e9e2d2'
  }, lod)
  windows(B, F, { y0: 0.1, floors: 1, fh: base, cols, ww: 0.3, wh: 0.26, sill: 0.08, margin: 0.12, lit: 0.25, seed: L.seed + 'b', trim: null, skip: (c) => c === doorCol0 }, lod)
  // side windows if exposed
  for (const id of (L.open ?? []).filter((f) => f === 'e' || f === 'w')) {
    const S = face(m, id)
    windows(B, S, { y0: base + fh, floors: floors - 1, fh, cols: Math.max(2, Math.round((S.a1 - S.a0) / 1.2)), ww: 0.32, wh: 0.5, sill: 0.18, margin: 0.4, lit: 0.18, seed: L.seed + 's' + id, trim }, lod)
  }
  // areaway fence at the lot line (skip the stoop)
  if (lod === 0) {
    const zf = F.p + sgn * (stoopD - 0.03)
    const segs: [number, number][] = [
      [L.x0 + 0.04, doorU - sw / 2 - 0.1],
      [doorU + sw / 2 + 0.1, L.x1 - 0.04]
    ]
    for (const [a, b] of segs) {
      if (b - a < 0.1) continue
      B.box('metal', (a + b) / 2, 0.36, zf, b - a, 0.025, 0.025, PAL.metal)
      const n = Math.max(2, Math.round((b - a) / 0.12))
      for (let i = 0; i <= n; i++) B.stand('metal', a + ((b - a) * i) / n, 0, zf, 0.014, 0.36, 0.014, PAL.metal)
    }
  }
  // bracketed cornice + chimneys
  cornice(B, m, facesOf(L).filter((f) => f === L.street), pick(['#3a2a22', '#4b3a2e', trim.getStyle()], L.seed, 12), lod, 1.1)
  roof(B, m, { parapet: jit(col, L.seed, 60, 0.04), seed: L.seed, lod, clutter: false, parapetH: 0.08 })
  if (lod === 0) {
    B.stand('solid', left ? m.x1 - 0.3 : m.x0 + 0.3, H, m.z0 + 1.2, 0.28, 0.42, 0.34, jit('#8a4b38', L.seed, 70))
    B.stand('cylMetal', left ? m.x1 - 0.3 : m.x0 + 0.3, H + 0.42, m.z0 + 1.2, 0.08, 0.1, 0.08, '#555')
    if (h01(L.seed, 71) < 0.5) B.stand('pane', (m.x0 + m.x1) / 2, H, (m.z0 + m.z1) / 2, 0.5, 0.12, 0.6, '#9fb4c4')
  }
  return H
}

/** Brick walk-up tenement with storefront, fire escape, water tower. */
export function walkup(
  B: Batch,
  L: Lot,
  floors = 5,
  opts: { color?: Col; fireEscape?: boolean; tower?: boolean; awning?: boolean; storeH?: number } = {}
): number {
  const lod = L.lod ?? 0
  const col = opts.color ?? pick(PAL.brick, L.seed)
  const trim = pick(PAL.trimLight, L.seed, 1)
  const sh = opts.storeH ?? 1.15
  const fh = 0.88
  const H = sh + floors * fh + 0.2
  const m: Mass = { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, y0: 0, y1: H }
  addMass(B, m, col)
  const F = face(m, L.street)
  const w = F.a1 - F.a0
  // storefront + belt course
  storefront(B, F, F.a0 + 0.12, F.a1 - 0.12, {
    h: sh,
    seed: L.seed,
    awning: opts.awning === false ? null : pick(PAL.awning, L.seed, 3),
    sign: pick(PAL.sign, L.seed, 4),
    lod
  })
  fput(B, 'solid', F, (F.a0 + F.a1) / 2, sh + 0.03, w + 0.04, 0.08, 0.04, 0.08, trim)
  // side pilasters framing the shop
  for (const u of [F.a0 + 0.06, F.a1 - 0.06]) fput(B, 'solid', F, u, sh / 2, 0.12, sh, 0.03, 0.06, trim)
  const cols = Math.max(2, Math.round(w / 0.72))
  windows(B, F, { y0: sh + 0.05, floors, fh, cols, ww: 0.32, wh: 0.52, sill: 0.14, margin: 0.18, lit: 0.2, seed: L.seed + 'w', trim, lintelH: 0.08, frame: '#ece6da' }, lod)
  for (const id of (L.open ?? []).filter((f) => f !== L.street)) {
    const S = face(m, id)
    const sc = Math.max(2, Math.round((S.a1 - S.a0) / 0.9))
    windows(B, S, { y0: sh + 0.05, floors, fh, cols: sc, ww: 0.3, wh: 0.5, sill: 0.14, margin: 0.3, lit: 0.16, seed: L.seed + id, trim }, lod)
  }
  if ((opts.fireEscape ?? true) && lod === 0 && cols >= 3) {
    const pitch = (w - 0.36) / cols
    const u0 = F.a0 + 0.18 + pitch * 0.12
    const u1 = F.a0 + 0.18 + pitch * Math.min(cols, 2.88)
    fireEscape(B, F, u0, Math.min(u1, F.a1 - 0.2), sh + 0.05, floors, fh)
  }
  cornice(B, m, facesOf(L), pick([trim, '#6b3a2c', '#2f3b33', '#3b3632'], L.seed, 5), lod)
  roof(B, m, { parapet: jit(col, L.seed, 6, 0.05), seed: L.seed, lod, clutter: true })
  if (opts.tower ?? h01(L.seed, 7) < 0.45) {
    const tx = (m.x0 + m.x1) / 2 + (h01(L.seed, 8) - 0.5) * (w - 1.2)
    waterTower(B, tx, H, m.z0 + Math.min(2.2, (m.z1 - m.z0) * 0.4), 0.9 + h01(L.seed, 9) * 0.25)
  }
  return H
}

/** Pre-war apartment block: rusticated limestone base, brick shaft. */
export function prewar(B: Batch, L: Lot, floors = 7, opts: { color?: Col; store?: boolean } = {}): number {
  const lod = L.lod ?? 0
  const col = opts.color ?? pick([...PAL.brick, ...PAL.tan], L.seed)
  const stone = pick(PAL.limestone, L.seed, 1)
  const baseH = 1.25
  const fh = 0.88
  const H = baseH + floors * fh + 0.25
  const m: Mass = { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, y0: 0, y1: H }
  addMass(B, m, col)
  const faces = facesOf(L)
  for (const id of faces) {
    const F = face(m, id)
    const w = F.a1 - F.a0
    const uc = (F.a0 + F.a1) / 2
    // stone base + string courses
    fput(B, 'solid', F, uc, baseH / 2, w + 0.02, baseH, 0.02, 0.05, stone)
    if (lod === 0) for (let i = 1; i < 4; i++) fput(B, 'solid', F, uc, (baseH * i) / 4, w + 0.03, 0.02, 0.05, 0.02, jit(stone, L.seed, i).offsetHSL(0, 0, -0.1))
    fput(B, 'solid', F, uc, baseH + 0.04, w + 0.06, 0.09, 0.05, 0.1, stone)
    fput(B, 'solid', F, uc, baseH + fh * 2 + 0.02, w + 0.02, 0.06, 0.03, 0.06, stone)
    const cols = Math.max(2, Math.round(w / 0.78))
    windows(B, F, { y0: baseH + 0.06, floors, fh, cols, ww: 0.34, wh: 0.54, sill: 0.14, margin: 0.22, lit: 0.2, seed: L.seed + id, trim: stone, lintelH: 0.09, frame: '#3a3430' }, lod)
    if (id === L.street && opts.store) {
      storefront(B, F, F.a0 + 0.2, uc - 0.5, { h: baseH, seed: L.seed + 'a', awning: pick(PAL.awning, L.seed, 12), sign: pick(PAL.sign, L.seed, 13), lod })
      storefront(B, F, uc + 0.5, F.a1 - 0.2, { h: baseH, seed: L.seed + 'b', awning: pick(PAL.awning, L.seed, 14), sign: pick(PAL.sign, L.seed, 15), lod })
      // lobby entrance w/ canopy
      fput(B, 'lit', F, uc, 0.45, 0.5, 0.8, 0.025, 0.02, '#ffdca6')
      fput(B, 'solid', F, uc, 0.95, 0.8, 0.05, 0.35, 0.7, '#2d2a28')
    } else {
      windows(B, F, { y0: 0.2, floors: 1, fh: baseH, cols, ww: 0.36, wh: 0.6, sill: 0.1, margin: 0.22, lit: 0.3, seed: L.seed + 'g' + id, trim: null }, lod)
    }
  }
  cornice(B, m, faces, stone, lod, 1.2)
  roof(B, m, { parapet: jit(col, L.seed, 20, 0.05), seed: L.seed, lod, clutter: true })
  if (h01(L.seed, 21) < 0.55) waterTower(B, m.x0 + 1 + h01(L.seed, 22) * (m.x1 - m.x0 - 2), H, m.z0 + 1.6, 1.1)
  return H
}

/** Art-deco setback tower: limestone piers, dark spandrels, stepped crown. */
export function deco(B: Batch, L: Lot, tiers: number[] = [5.4, 2.6, 1.7], opts: { stone?: Col; spandrel?: Col; spire?: number } = {}): number {
  const lod = L.lod ?? 0
  const stone = opts.stone ?? pick(PAL.limestone, L.seed)
  const span = opts.spandrel ?? pick(['#3d4b45', '#4a4034', '#3a4250'], L.seed, 1)
  const bronze = '#8a6a3e'
  const fh = 0.85
  const baseH = 1.7
  let m: Mass = { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, y0: 0, y1: baseH }
  addMass(B, m, stone)
  const Fs = face(m, L.street)
  // bronze-framed double-height lobby + shop glass
  storefront(B, Fs, Fs.a0 + 0.25, Fs.a1 - 0.25, { h: baseH, seed: L.seed, awning: null, sign: '#2a241c', frame: bronze, bays: 5, lod })
  fput(B, 'solid', Fs, (Fs.a0 + Fs.a1) / 2, baseH + 0.05, Fs.a1 - Fs.a0 + 0.1, 0.1, 0.05, 0.1, bronze)
  let y = baseH
  let totalH = baseH
  tiers.forEach((th, ti) => {
    const ins = ti === 0 ? 0 : 0.55 * ti + 0.15
    const tm0: Mass = inset({ ...m, x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1 }, ins, ins, ins, y, y + th)
    addMass(B, tm0, jit(stone, L.seed, ti, 0.02))
    const floors = Math.max(1, Math.floor(th / fh))
    for (const id of facesOf(L)) {
      const F = face(tm0, id)
      const w = F.a1 - F.a0
      const cols = Math.max(2, Math.round(w / 0.62))
      const pitch = (w - 0.3) / cols
      for (let c = 0; c < cols; c++) {
        const u = F.a0 + 0.15 + (c + 0.5) * pitch
        // recessed dark spandrel strip per column
        fput(B, 'solid', F, u, y + th / 2 - 0.1, pitch * 0.62, th - 0.35, 0.008, 0.016, span)
      }
      windows(B, F, { y0: y + 0.05, floors, fh: (th - 0.3) / floors, cols, ww: pitch * 0.5, wh: ((th - 0.3) / floors) * 0.58, sill: 0.1, margin: 0.15, lit: 0.24, seed: L.seed + ti + id, trim: null, sky: 0.3 }, lod)
      // piers between columns — the deco verticality
      for (let c = 0; c <= cols; c++) {
        const u = F.a0 + 0.15 + c * pitch
        fput(B, 'solid', F, u, y + th / 2, 0.11, th, 0.04, 0.08, jit(stone, L.seed + 'pier', c, 0.03).offsetHSL(0, 0, 0.04))
        if (lod === 0) fput(B, 'solid', F, u, y + th + 0.12, 0.08, 0.24, 0.04, 0.08, stone)
      }
      // tier coping band
      fput(B, 'solid', F, (F.a0 + F.a1) / 2, y + th - 0.04, w + 0.06, 0.08, 0.04, 0.08, jit(stone, L.seed, 99).offsetHSL(0, 0, 0.05))
    }
    roof(B, tm0, { parapet: stone, seed: L.seed + ti, lod: 1, clutter: false, parapetH: 0.22 })
    y += th
    totalH = y
    m = tm0
  })
  // crown lantern: glowing fins + spire
  const cx = (L.x0 + L.x1) / 2
  const cz = (L.z0 + L.z1) / 2
  const lw = Math.min(L.x1 - L.x0, L.z1 - L.z0) * 0.32
  B.stand('solid', cx, y, cz, lw, 0.9, lw, stone)
  const fins = 5
  for (let i = 0; i < fins; i++) {
    const u = -lw / 2 + ((i + 0.5) * lw) / fins
    for (const s of [-1, 1]) {
      B.stand('lit', cx + u, y + 0.12, cz + s * (lw / 2 + 0.01), 0.05, 0.62, 0.02, '#ffcf85')
      B.stand('lit', cx + s * (lw / 2 + 0.01), y + 0.12, cz + u, 0.02, 0.62, 0.05, '#ffcf85')
    }
  }
  B.stand('solid', cx, y + 0.9, cz, lw * 0.62, 0.35, lw * 0.62, stone)
  const sp = opts.spire ?? 1.4
  B.stand('cone', cx, y + 1.25, cz, lw * 0.34, sp, lw * 0.34, '#b9a27a')
  B.stand('metal', cx, y + 1.25 + sp - 0.1, cz, 0.03, 0.5, 0.03, '#9a9a9a')
  return totalH + 1.25 + sp
}

/** Modern glass curtain-wall tower on a stone podium. */
export function glassTower(B: Batch, L: Lot, h = 11, opts: { tint?: Col; podium?: Col; slant?: boolean } = {}): number {
  const lod = L.lod ?? 0
  const tint = opts.tint ?? pick(PAL.glass, L.seed)
  const pod = opts.podium ?? pick(PAL.concrete, L.seed, 1)
  const ph = 1.4
  const podM: Mass = { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, y0: 0, y1: ph }
  addMass(B, podM, pod)
  const Fs = face(podM, L.street)
  storefront(B, Fs, Fs.a0 + 0.3, Fs.a1 - 0.3, { h: ph, seed: L.seed, awning: null, sign: null, frame: '#3a3d42', bays: 6, lod })
  const tw: Mass = inset(podM, 0.35, 0.35, 0.35, ph, h)
  addMass(B, tw, tint, 'glass')
  const fh = 0.8
  const floors = Math.floor((h - ph - 0.4) / fh)
  const frame = '#b8bec6'
  for (const id of facesOf(L)) {
    const F = face(tw, id)
    const w = F.a1 - F.a0
    const uc = (F.a0 + F.a1) / 2
    const cols = Math.max(3, Math.round(w / 0.55))
    // spandrel lines at each floor
    for (let f = 0; f <= floors; f++) fput(B, 'solid', F, uc, ph + 0.2 + f * fh, w + 0.02, 0.07, 0.015, 0.03, frame)
    // vertical mullions
    if (lod === 0) for (let c = 0; c <= cols; c++) fput(B, 'metal', F, F.a0 + (c * w) / cols, (ph + h) / 2, 0.03, h - ph, 0.012, 0.024, '#9aa2ab')
    // lit office cells scattered in the glass
    for (let f = 0; f < floors; f++)
      for (let c = 0; c < cols; c++)
        if (h01(L.seed + id, f * 97 + c) < 0.14)
          fput(B, 'lit', F, F.a0 + ((c + 0.5) * w) / cols, ph + 0.2 + (f + 0.5) * fh, w / cols - 0.06, fh - 0.14, 0.005, 0.008, jit(pick(PAL.lit, L.seed, f + c), L.seed, f * 7 + c, 0.05).multiplyScalar(0.85))
  }
  // crown: mechanical box with louvers, lit top edge
  const cw = (tw.x1 - tw.x0) * 0.7
  const cd = (tw.z1 - tw.z0) * 0.6
  const cx = (tw.x0 + tw.x1) / 2
  const cz = (tw.z0 + tw.z1) / 2
  roof(B, tw, { parapet: frame, seed: L.seed, lod: 1, clutter: false, parapetH: 0.3 })
  B.stand('solid', cx, h, cz - 0.2, cw, 0.8, cd, '#8d949b')
  if (lod === 0) for (let i = 0; i < 5; i++) B.stand('metal', cx, h + 0.1 + i * 0.13, cz - 0.2 + cd / 2 + 0.01, cw - 0.1, 0.03, 0.02, '#5c636b')
  B.stand('lit', cx, h + 0.8, cz - 0.2, cw + 0.02, 0.03, cd + 0.02, '#fff0d0')
  return h + 0.8
}

/** Concrete mid-rise with ribbon windows and a roof garden. */
export function modern(B: Batch, L: Lot, floors = 6, opts: { color?: Col } = {}): number {
  const lod = L.lod ?? 0
  const col = opts.color ?? pick([...PAL.concrete, ...PAL.painted], L.seed)
  const baseH = 1.2
  const fh = 0.86
  const H = baseH + floors * fh + 0.1
  const m: Mass = { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1, y0: 0, y1: H }
  addMass(B, m, col)
  for (const id of facesOf(L)) {
    const F = face(m, id)
    const w = F.a1 - F.a0
    const uc = (F.a0 + F.a1) / 2
    for (let f = 0; f < floors; f++) {
      const y = baseH + f * fh + fh * 0.5
      fput(B, 'pane', F, uc, y, w - 0.3, fh * 0.52, 0.01, 0.02, pick(PAL.paneDark, L.seed + id, f))
      // lit segments along the ribbon
      const segs = Math.max(2, Math.round(w / 0.7))
      for (let s = 0; s < segs; s++)
        if (h01(L.seed + id + 'r', f * 31 + s) < 0.22)
          fput(B, 'lit', F, F.a0 + 0.15 + ((s + 0.5) * (w - 0.3)) / segs, y, (w - 0.3) / segs - 0.06, fh * 0.5, 0.02, 0.01, jit(pick(PAL.lit, L.seed, s), L.seed, f * 13 + s, 0.05).multiplyScalar(0.9))
      if (lod === 0) {
        for (let s = 0; s <= segs; s++) fput(B, 'metal', F, F.a0 + 0.15 + (s * (w - 0.3)) / segs, y, 0.025, fh * 0.52, 0.025, 0.02, '#5d646c')
        // balcony slabs on the street face every other floor
        if (id === L.street && f % 2 === 1) {
          fput(B, 'solid', F, uc, y - fh * 0.3, w * 0.4, 0.05, 0.2, 0.4, jit(col, L.seed, 5).offsetHSL(0, 0, 0.05))
          fput(B, 'pane', F, uc, y - fh * 0.14, w * 0.4, 0.26, 0.4, 0.015, '#8fb3c7')
        }
      }
    }
    if (id === L.street) storefront(B, F, F.a0 + 0.2, F.a1 - 0.2, { h: baseH, seed: L.seed, awning: h01(L.seed, 3) < 0.5 ? pick(PAL.awning, L.seed, 4) : null, sign: pick(PAL.sign, L.seed, 5), lod })
    else windows(B, F, { y0: 0.25, floors: 1, fh: baseH, cols: Math.max(2, Math.round(w / 1)), ww: 0.5, wh: 0.6, sill: 0, margin: 0.3, lit: 0.3, seed: L.seed + 'g', trim: null }, lod)
  }
  roof(B, m, { parapet: jit(col, L.seed, 8, 0.03), seed: L.seed, lod, clutter: false, parapetH: 0.22 })
  if (lod === 0) roofGarden(B, m, L.seed)
  return H
}

// ── row filling ──────────────────────────────────────────────────────

export type BuildKind = 'brownstone' | 'walkup' | 'prewar' | 'modern' | 'glass' | 'deco'

/**
 * Packs a row of buildings between xa..xb, fronting `street` at zf (the
 * lot's street edge), `depth` deep. Height is capped by `hMax` so rows
 * behind the HQ never out-shout it. `exposedEnds` puts windows on the
 * row's two outer side walls.
 */
export function fillRow(
  B: Batch,
  xa: number,
  xb: number,
  zf: number,
  depth: number,
  street: 's' | 'n',
  hMax: number,
  seed: string,
  lod: number,
  kinds: BuildKind[] = ['walkup', 'prewar', 'modern', 'brownstone', 'walkup', 'prewar', 'glass'],
  alsoOpen: FaceId[] = []
): void {
  let x = xa
  let i = 0
  while (x < xb - 1.8) {
    const k = pick(kinds, seed, i)
    const wantW =
      k === 'brownstone' ? 2.1 : k === 'walkup' ? 2.6 + h01(seed, i + 100) * 1.4 : k === 'glass' ? 5 + h01(seed, i + 200) * 2 : k === 'deco' ? 5.5 : 3.4 + h01(seed, i + 300) * 2.6
    const w = Math.min(wantW, xb - x)
    if (w < 1.8) break
    const z0 = street === 's' ? zf - depth : zf
    const z1 = street === 's' ? zf : zf + depth
    const open: FaceId[] = [...alsoOpen]
    if (i === 0) open.push('w')
    if (x + w >= xb - 1.8) open.push('e')
    const L: Lot = { x0: x + 0.02, x1: x + w - 0.02, z0, z1, street, open, seed: `${seed}${i}`, lod }
    const r = h01(seed, i + 400)
    switch (k) {
      case 'brownstone':
        brownstone(B, L, Math.min(4, Math.max(3, Math.floor((hMax - 0.8) / 0.9))))
        break
      case 'walkup':
        walkup(B, L, Math.max(3, Math.min(6, Math.floor((hMax - 1.4) / 0.88) - Math.floor(r * 2))))
        break
      case 'prewar':
        prewar(B, L, Math.max(4, Math.min(10, Math.floor((hMax - 1.6) / 0.88) - Math.floor(r * 3))), { store: lod === 0 && r < 0.6 })
        break
      case 'modern':
        modern(B, L, Math.max(3, Math.min(9, Math.floor((hMax - 1.4) / 0.86) - Math.floor(r * 3))))
        break
      case 'glass':
        glassTower(B, L, Math.max(6, hMax - 0.8 - r * 3))
        break
      case 'deco':
        deco(B, L, [hMax * 0.5, hMax * 0.18, hMax * 0.12], { spire: 1 })
        break
    }
    x += w
    i++
  }
}
