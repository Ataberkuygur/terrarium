/**
 * Loft furniture — desks, task chairs, lounge, kitchen, meeting room,
 * plants and shelving, authored as kit functions and rendered as
 * instanced batches.
 *
 * Authoring convention: every piece is built around its own floor-level
 * origin with its "front" (the side a person uses) toward local +z.
 * Desk exception (shared with layout.ts): desk local +z is the CHAIR side,
 * the monitors sit toward local −z.
 */

import { memo, useMemo } from 'react'
import * as THREE from 'three'
import type { Agent } from '@shared/types'
import { Inst } from './Inst'
import { MonitorScreen } from './MonitorScreen'
import { Kit, LM, LG, type BatchGroup } from './loftKit'
import {
  DESK,
  SEAT_Z,
  ISLAND,
  KITCHEN,
  LOUNGE,
  MEETING_ROOM,
  NOOK,
  FRONT_BENCH,
  PRINT_STATION,
  IN,
  hash01,
  type DeskSpot
} from './layout'

/* ── batch renderer ────────────────────────────────────────────────────── */

export function BatchView({ groups }: { groups: BatchGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <Inst
          key={`${g.key}:${g.mats.length}`}
          geo={g.geo}
          mat={g.mat}
          mats={g.mats}
          colors={g.colors}
          castShadow={g.cast}
          receiveShadow
        />
      ))}
    </>
  )
}

/* ── small shared palettes ─────────────────────────────────────────────── */

const BOOK_COLORS = [
  '#b8674a', '#d2a13f', '#8ea184', '#3d4a5c', '#e9e1d3', '#6f5a48', '#a4553d', '#4f6d7a', '#c98e6b', '#2f2b28'
]
const MUG_COLORS = ['#efe9df', '#2f3136', '#b8674a', '#8ea184', '#d2a13f', '#6f8aa0']
const POT_COLORS = ['#e6ded1', '#b86a4c', '#3a3b3e', '#cfc2ae']

/* ── plants ────────────────────────────────────────────────────────────── */

/** broad-leaf floor plant (monstera) */
export function monstera(k: Kit, x: number, z: number, s = 1, pot: THREE.Material = LM.potCream, seed = 1) {
  k.push(x, 0, z)
  k.mesh(LG.pot, pot, 0, 0, 0, { s: [0.36 * s, 0.42 * s, 0.36 * s] })
  k.cyl(LM.soil, 0, 0.405 * s, 0, 0.17 * s, 0.01, { cast: false })
  const n = 9
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + seed
    const tilt = 0.35 + hash01(`m${seed}`, i) * 0.75
    const L = (0.34 + hash01(`ml${seed}`, i) * 0.22) * s
    const stem = (0.22 + hash01(`ms${seed}`, i) * 0.3) * s
    const mat = i % 3 === 0 ? LM.leafLight : i % 3 === 1 ? LM.leaf : LM.leafDark
    k.push(0, 0.39 * s, 0, a)
    k.cyl(LM.leafDark, 0, Math.cos(tilt * 0.6) * stem * 0.5, Math.sin(tilt * 0.6) * stem * 0.5, 0.008, stem, {
      rx: tilt * 0.6,
      cast: false
    })
    k.mesh(LG.broadLeaf, mat, 0, Math.cos(tilt * 0.6) * stem, Math.sin(tilt * 0.6) * stem, {
      rx: tilt + 0.25,
      s: L
    })
    k.pop()
  }
  k.pop()
}

/** tall fiddle-leaf fig — trunk with a leafy crown */
export function fig(k: Kit, x: number, z: number, h = 1.9, pot: THREE.Material = LM.potTerracotta, seed = 3) {
  k.push(x, 0, z)
  k.mesh(LG.pot, pot, 0, 0, 0, { s: [0.3, 0.38, 0.3] })
  k.cyl(LM.soil, 0, 0.365, 0, 0.14, 0.01, { cast: false })
  k.cyl(LM.trunk, 0, 0.36 + (h - 0.36) * 0.4, 0, 0.022, (h - 0.36) * 0.8, { rz: 0.04 })
  const n = 26
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const y = h * (0.52 + t * 0.46)
    const a = i * 2.2 + seed
    const r = 0.05 + (1 - Math.abs(t - 0.45) * 1.6) * 0.1
    const mat = i % 3 === 0 ? LM.leafDark : i % 3 === 1 ? LM.leaf : LM.leafLight
    k.push(Math.sin(a) * r * 0.3, y, Math.cos(a) * r * 0.3, a)
    k.mesh(LG.figLeaf, mat, 0, 0, 0, {
      rx: 0.7 + hash01(`f${seed}`, i) * 0.7,
      s: 0.22 + hash01(`fs${seed}`, i) * 0.1
    })
    k.pop()
  }
  k.pop()
}

/** snake plant — upright sword blades */
export function snakePlant(k: Kit, x: number, z: number, s = 1, pot: THREE.Material = LM.potCharcoal, seed = 5) {
  k.push(x, 0, z)
  k.cyl(pot, 0, 0.16 * s, 0, 0.14 * s, 0.32 * s)
  k.cyl(LM.soil, 0, 0.32 * s, 0, 0.125 * s, 0.01, { cast: false })
  for (let i = 0; i < 11; i++) {
    const a = i * 2.7 + seed
    const r = hash01(`s${seed}`, i) * 0.08 * s
    k.mesh(LG.blade, i % 2 ? LM.snake : LM.leafDark, Math.sin(a) * r, 0.31 * s, Math.cos(a) * r, {
      ry: a,
      rx: (hash01(`st${seed}`, i) - 0.3) * 0.35,
      s: [s * 1.2, (0.45 + hash01(`sh${seed}`, i) * 0.45) * s, s]
    })
  }
  k.pop()
}

/** little tabletop plant (succulent / pothos) at a surface height */
export function smallPlant(k: Kit, x: number, y: number, z: number, seed = 0, trailing = false) {
  k.push(x, y, z)
  const col = POT_COLORS[Math.floor(hash01('pp', seed) * POT_COLORS.length)]
  k.cyl(LM.ceramic, 0, 0.045, 0, 0.05, 0.09, { color: col })
  k.cyl(LM.soil, 0, 0.088, 0, 0.044, 0.006, { cast: false })
  const n = trailing ? 9 : 7
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + seed
    const mat = i % 2 ? LM.leaf : LM.leafLight
    if (trailing) {
      const drop = (i / n) * 0.28
      k.push(Math.sin(a) * 0.07, 0.07 - drop, Math.cos(a) * 0.07 + 0.02, a)
      k.mesh(LG.figLeaf, mat, 0, 0, 0, { rx: 2.2, s: 0.09 })
      k.pop()
    } else {
      k.push(0, 0.085, 0, a)
      k.mesh(LG.broadLeaf, mat, 0, 0, 0, { rx: 0.5 + hash01('sp', i + seed) * 0.6, s: 0.11 })
      k.pop()
    }
  }
  k.pop()
}

/* ── seating ───────────────────────────────────────────────────────────── */

/** ergonomic task chair — 5-star base, casters, gas lift, mesh back,
 * armrests. Seat top ≈ 0.50. The sitter faces local −z. */
export function taskChair(k: Kit) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3
    k.push(0, 0, 0, a)
    k.box(LM.chairShell, 0, 0.085, 0.15, 0.042, 0.03, 0.3, { rx: -0.1 })
    k.box(LM.chairShell, 0, 0.055, 0.29, 0.03, 0.03, 0.03)
    k.mesh(LG.cylLo, LM.caster, 0, 0.028, 0.3, { rz: Math.PI / 2, s: [0.05, 0.026, 0.05] })
    k.pop()
  }
  k.cyl(LM.chairShell, 0, 0.1, 0, 0.045, 0.05)
  k.cyl(LM.chairShell, 0, 0.17, 0, 0.033, 0.12)
  k.cyl(LM.aluminium, 0, 0.3, 0, 0.02, 0.18)
  k.box(LM.chairShell, 0, 0.405, 0.02, 0.2, 0.045, 0.24)
  k.mesh(LG.seat, LM.chairFabric, 0, 0.455, 0)
  // spine + mesh backrest
  k.box(LM.chairShell, 0, 0.53, 0.27, 0.06, 0.2, 0.03, { rx: 0.1 })
  k.mesh(LG.seatBack, LM.chairMesh, 0, 0.87, 0.3, { rx: 0.14 })
  k.box(LM.chairShell, 0, 0.62, 0.285, 0.36, 0.05, 0.03, { rx: 0.14 }) // lumbar bar
  // armrests
  for (const sx of [-1, 1]) {
    k.box(LM.chairShell, sx * 0.27, 0.55, 0.05, 0.03, 0.2, 0.05)
    k.box(LM.chairShell, sx * 0.27, 0.46, 0.06, 0.03, 0.03, 0.2)
    k.box(LM.chairFabric, sx * 0.27, 0.66, 0.01, 0.075, 0.03, 0.25)
  }
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: 0.85, cast: false })
}

/** molded shell chair on oak legs (meeting room / island) — faces +z */
function shellChair(k: Kit, seat: THREE.Material = LM.cream) {
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ]) {
    k.cyl(LM.oak, sx * 0.17, 0.21, sz * 0.17, 0.014, 0.44, { rx: sz * 0.12, rz: -sx * 0.12 })
  }
  k.box(LM.steel, 0, 0.42, 0, 0.3, 0.02, 0.3)
  k.mesh(LG.seat, seat, 0, 0.46, 0.01, { s: [0.9, 0.8, 0.92] })
  k.mesh(LG.seatBack, seat, 0, 0.7, -0.21, { rx: -0.2, s: [0.92, 0.72, 0.9] })
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: 0.7, cast: false })
}

/** bar stool — oak seat, black splayed legs, foot ring */
function barStool(k: Kit) {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    k.push(0, 0, 0, a)
    k.cyl(LM.steel, 0, 0.36, 0.12, 0.013, 0.74, { rx: 0.16 })
    k.pop()
  }
  k.mesh(LG.torus, LM.steel, 0, 0.3, 0, { rx: Math.PI / 2, s: [0.36, 0.36, 0.3] })
  k.cyl(LM.oak, 0, 0.74, 0, 0.18, 0.04)
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: 0.6, cast: false })
}

/** three-seat sofa — sitter faces +z, seat top ≈ 0.48 */
export function sofa(k: Kit) {
  const W = 2.3
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ]) {
    k.cyl(LM.walnut, sx * 1.06, 0.06, sz * 0.36, 0.022, 0.12)
  }
  k.box(LM.velvet, 0, 0.22, 0, W, 0.2, 0.92)
  for (const x of [-0.74, 0, 0.74]) {
    k.mesh(LG.cushion, LM.velvetLight, x, 0.4, 0.07, { s: [1.1, 1, 0.98] })
    k.mesh(LG.cushionBack, LM.velvetLight, x, 0.64, -0.24, { rx: -0.2, s: [1.08, 1, 1] })
  }
  k.box(LM.velvet, 0, 0.52, -0.39, W, 0.62, 0.16)
  for (const sx of [-1, 1]) k.mesh(LG.armchairArm, LM.velvet, sx * (W / 2 - 0.07), 0.46, 0.0, { s: [1.1, 1.05, 1.28] })
  k.mesh(LG.pillow, LM.mustard, -0.84, 0.6, -0.12, { ry: 0.35, rx: -0.3, rz: 0.12 })
  k.mesh(LG.pillow, LM.sage, 0.86, 0.6, -0.12, { ry: -0.3, rx: -0.3, rz: -0.1 })
  k.mesh(LG.pillow, LM.linen, 0.5, 0.58, -0.08, { ry: -0.15, rx: -0.35, s: 0.85 })
  // folded throw over the left arm
  k.box(LM.linen, -1.08, 0.66, 0.1, 0.22, 0.03, 0.5, { rz: -0.1 })
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: [2.7, 1, 1.4], cast: false })
}

/** lounge armchair — faces +z, seat top ≈ 0.46 */
export function armchair(k: Kit, mat: THREE.Material = LM.mustard) {
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ]) {
    k.cyl(LM.walnut, sx * 0.3, 0.09, sz * 0.28, 0.018, 0.18, { rx: sz * 0.12, rz: -sx * 0.12 })
  }
  k.box(mat, 0, 0.25, 0, 0.78, 0.14, 0.76)
  k.mesh(LG.armchairSeat, mat, 0, 0.38, 0.05)
  k.mesh(LG.armchairBack, mat, 0, 0.62, -0.3, { rx: -0.16 })
  for (const sx of [-1, 1]) k.mesh(LG.armchairArm, mat, sx * 0.36, 0.43, 0.0, { s: [1, 0.9, 1.02] })
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: 1.2, cast: false })
}

/* ── tables, lamps, shelving ───────────────────────────────────────────── */

function coffeeTable(k: Kit) {
  k.mesh(LG.roundTop, LM.oak, 0, 0.39, 0, { s: [1.0, 0.035, 1.0] })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    k.cyl(LM.walnut, Math.sin(a) * 0.3, 0.19, Math.cos(a) * 0.3, 0.02, 0.38, { rx: Math.cos(a) * 0.12, rz: -Math.sin(a) * 0.12 })
  }
  // styling: book stack, vase with sprigs, small tray
  k.box(LM.paint, -0.12, 0.425, 0.08, 0.28, 0.035, 0.2, { ry: 0.3, color: '#3d4a5c' })
  k.box(LM.paint, -0.12, 0.455, 0.08, 0.24, 0.025, 0.17, { ry: 0.22, color: '#e9e1d3' })
  k.cyl(LM.ceramic, 0.16, 0.48, -0.1, 0.05, 0.14, { color: '#b8674a' })
  for (let i = 0; i < 3; i++) k.cyl(LM.leafDark, 0.16 + (i - 1) * 0.015, 0.62, -0.1, 0.003, 0.2, { rz: (i - 1) * 0.25, cast: false })
  k.cyl(LM.ceramic, 0.14, 0.415, 0.2, 0.035, 0.05, { color: '#efe9df' })
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: 1.3, cast: false })
}

function sideTable(k: Kit, withLamp = false) {
  k.mesh(LG.roundTop, LM.oak, 0, 0.52, 0, { s: [0.5, 0.03, 0.5] })
  k.cyl(LM.steel, 0, 0.26, 0, 0.018, 0.5)
  k.cyl(LM.steel, 0, 0.01, 0, 0.16, 0.02)
  if (withLamp) {
    k.cyl(LM.ceramic, 0, 0.62, 0, 0.06, 0.18, { color: '#efe6d6' })
    k.mesh(LG.cone, LM.linen, 0, 0.8, 0, { s: [0.26, 0.16, 0.26] })
    k.sphere(LM.bulbWarm, 0, 0.74, 0, 0.03, { cast: false })
  } else {
    k.cyl(LM.ceramic, 0.05, 0.585, 0.03, 0.04, 0.1, { color: '#2f3136' })
    k.box(LM.paint, -0.06, 0.55, -0.04, 0.16, 0.03, 0.22, { ry: 0.4, color: '#d2a13f' })
  }
}

/** drum-shade floor lamp — the warm practical in the lounge */
function floorLamp(k: Kit) {
  k.cyl(LM.steel, 0, 0.012, 0, 0.16, 0.024)
  k.cyl(LM.brass, 0, 0.78, 0, 0.012, 1.52)
  k.mesh(LG.cyl, LM.linen, 0, 1.6, 0, { s: [0.42, 0.3, 0.42] })
  k.mesh(LG.cyl, LM.shadeInner, 0, 1.6, 0, { s: [0.4, 0.29, 0.4], cast: false })
  k.sphere(LM.bulbWarm, 0, 1.54, 0, 0.045, { cast: false })
}

/** open oak bookshelf — faces +z */
function bookshelf(k: Kit, w = 1.6, h = 2.1, d = 0.34, seed = 1) {
  k.box(LM.oakDark, 0, h / 2, -d / 2 + 0.008, w, h, 0.016)
  for (const sx of [-1, 1]) k.box(LM.oak, (sx * w) / 2, h / 2, 0, 0.03, h, d)
  const levels = [0.06, 0.48, 0.9, 1.32, 1.74]
  for (const y of [...levels, h]) k.box(LM.oak, 0, y - 0.015, 0, w, 0.03, d)
  levels.forEach((y, li) => {
    let x = -w / 2 + 0.05
    let j = 0
    while (x < w / 2 - 0.08) {
      const r = hash01(`bk${seed}-${li}`, j)
      if (r < 0.12 && x < w / 2 - 0.3) {
        // object gap: a plant or a ceramic
        if (li % 2 === 0) smallPlant(k, x + 0.09, y, 0.02, li + j + seed, li === 1)
        else k.cyl(LM.ceramic, x + 0.08, y + 0.08, 0, 0.055, 0.16, { color: MUG_COLORS[(li + j) % MUG_COLORS.length] })
        x += 0.22
      } else {
        const bw = 0.025 + hash01(`bw${seed}`, li * 40 + j) * 0.03
        const bh = 0.22 + hash01(`bh${seed}`, li * 40 + j) * 0.12
        const lean = r > 0.93 ? 0.22 : 0
        k.mesh(LG.book, LM.paint, x + bw / 2 + lean * 0.3, y + bh / 2, 0.01, {
          s: [bw, bh, 0.22],
          rz: -lean,
          color: BOOK_COLORS[Math.floor(hash01(`bc${seed}`, li * 40 + j) * BOOK_COLORS.length)]
        })
        x += bw + 0.004 + lean * 0.12
      }
      j++
    }
  })
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0.05, { s: [w * 1.2, 1, 0.8], cast: false })
}

/* ── desks ─────────────────────────────────────────────────────────────── */

export type MonitorKind = 'single' | 'dual' | 'laptop'

interface MonitorSpec {
  x: number
  z: number
  ry: number
  big: boolean
  laptop: boolean
  main: boolean
}

const DESK_TILT = -0.08

function deskNum(d: DeskSpot) {
  const n = parseInt(d.id.replace(/\D+/g, ''), 10)
  return isNaN(n) ? 0 : n
}

/** per-desk monitor arrangement — deterministic by desk id */
export function monitorLayout(d: DeskSpot): MonitorSpec[] {
  const kind: MonitorKind = d.tall
    ? 'laptop'
    : (['single', 'dual', 'laptop', 'dual', 'single', 'laptop'] as const)[deskNum(d) % 6]
  if (kind === 'dual')
    return [
      { x: -0.2, z: -0.2, ry: 0.12, big: true, laptop: false, main: true },
      { x: 0.42, z: -0.16, ry: -0.36, big: false, laptop: false, main: false }
    ]
  if (kind === 'laptop')
    return [
      { x: -0.12, z: -0.22, ry: 0.04, big: true, laptop: false, main: true },
      { x: 0.46, z: -0.02, ry: -0.42, big: false, laptop: true, main: false }
    ]
  return [{ x: 0, z: -0.22, ry: 0, big: true, laptop: false, main: true }]
}

function deskH(d: DeskSpot) {
  return d.tall ? DESK.tallH : DESK.h
}

/** monitor center height above the desk top */
const MON_Y = 0.33
const MON_Y_SMALL = 0.29

/** the static half of a workstation — frame, top, monitors (bodies),
 * keyboard, styling props. Screens live in the dynamic kit. */
function deskStatic(k: Kit, d: DeskSpot) {
  const h = deskH(d)
  const n = deskNum(d)
  const white = hash01(d.id, 1) < 0.42
  k.push(d.x, 0, d.z, d.rotY)

  // top: oak core, optional white linoleum inlay
  k.mesh(LG.deskTop, LM.oak, 0, h - 0.018, 0)
  if (white) k.box(LM.laminate, 0, h + 0.0008, 0, DESK.w - 0.03, 0.0016, DESK.d - 0.03, { cast: false })

  // sled frame
  const legH = h - 0.036
  for (const sx of [-1, 1]) {
    const x = sx * (DESK.w / 2 - 0.08)
    for (const sz of [-1, 1]) k.box(LM.deskFrame, x, legH / 2, sz * 0.28, 0.04, legH, 0.04)
    k.box(LM.deskFrame, x, 0.012, 0, 0.05, 0.024, 0.68)
    k.box(LM.deskFrame, x, h - 0.056, 0, 0.05, 0.04, 0.68)
    for (const gz of [-0.33, 0.33]) k.box(LM.caster, x, 0.004, gz, 0.05, 0.008, 0.04, { cast: false })
  }
  k.box(LM.deskFrame, 0, h - 0.07, -0.26, DESK.w - 0.2, 0.04, 0.04)
  // cable tray + power strip + drop cable
  k.box(LM.tray, 0, h - 0.13, -0.24, 0.9, 0.08, 0.13)
  k.box(LM.caster, 0.38, 0.5 * (h - 0.13), -0.3, 0.018, h - 0.13, 0.018, { cast: false })

  // felt privacy screen on the pod center line (one per back-to-back pair)
  if (!d.tall && d.rotY === 0) {
    k.box(n % 8 < 4 ? LM.felt : LM.feltDark, 0, h + 0.2, -DESK.d / 2 - 0.03, DESK.w - 0.02, 0.4, 0.024)
    k.box(LM.deskFrame, 0, h + 0.4, -DESK.d / 2 - 0.03, DESK.w - 0.02, 0.012, 0.03)
  }

  // monitors (bodies + stands)
  for (const m of monitorLayout(d)) {
    k.push(m.x, h, m.z, m.ry)
    if (m.laptop) {
      k.box(LM.aluminium, 0, 0.035, 0.02, 0.26, 0.012, 0.2, { rx: 0.25 }) // stand
      k.mesh(LG.laptopBase, LM.aluminium, 0, 0.075, 0.03, { rx: 0.25 })
      k.mesh(LG.laptopLid, LM.aluminium, 0, 0.19, -0.1, { rx: -0.2 })
    } else {
      const cy = m.big ? MON_Y : MON_Y_SMALL
      k.box(LM.aluminium, 0, 0.006, 0.02, 0.24, 0.012, 0.18)
      k.box(LM.aluminium, 0, cy * 0.5, -0.03, 0.05, cy, 0.02, { rx: 0.08 })
      k.push(0, cy, 0, 0, DESK_TILT)
      k.mesh(m.big ? LG.monitor : LG.monitorSmall, LM.bezel, 0, 0, 0)
      k.mesh(LG.monitorHump, LM.monitorBack, 0, -0.02, -0.035)
      k.box(LM.ledOn, m.big ? 0.27 : 0.23, m.big ? -0.186 : -0.158, 0.014, 0.012, 0.004, 0.004, { cast: false })
      k.pop()
    }
    k.pop()
  }

  // keyboard + mouse on a felt pad
  const main = monitorLayout(d)[0]
  const kx = main.x * 0.5
  k.box(LM.deskPad, kx + 0.1, h + 0.002, 0.14, 0.86, 0.004, 0.34, { cast: false })
  const lightKb = hash01(d.id, 4) < 0.5
  k.box(lightKb ? LM.plasticLight : LM.plasticDark, kx, h + 0.011, 0.13, 0.44, 0.016, 0.14)
  k.box(lightKb ? LM.keyboardLight : LM.keyboard, kx, h + 0.0205, 0.13, 0.42, 0.003, 0.12, { cast: false })
  k.mesh(LG.sphere, lightKb ? LM.plasticLight : LM.plasticDark, kx + 0.33, h + 0.012, 0.15, { s: [0.06, 0.03, 0.1] })

  // styling — deterministic variety, kept to the desk's outer corners
  const r = (salt: number) => hash01(d.id, salt)
  const mug = MUG_COLORS[Math.floor(r(5) * MUG_COLORS.length)]
  const mugX = r(6) < 0.5 ? 0.56 : -0.56
  k.cyl(LM.ceramic, mugX, h + 0.05, 0.16, 0.038, 0.1, { color: mug })
  k.mesh(LG.mugHandle, LM.ceramic, mugX + 0.045, h + 0.05, 0.16, { rz: -Math.PI / 2, color: mug })
  k.cyl(LM.soil, mugX, h + 0.098, 0.16, 0.032, 0.004, { cast: false })
  if (r(7) < 0.55) {
    // closed notebook + pen
    const nx = -mugX * 0.92
    k.box(LM.paint, nx, h + 0.008, 0.18, 0.17, 0.014, 0.23, { ry: 0.25 * Math.sign(nx), color: r(8) < 0.5 ? '#2f2b28' : '#b8674a' })
    k.box(LM.paper, nx, h + 0.0155, 0.18, 0.16, 0.002, 0.22, { ry: 0.25 * Math.sign(nx), cast: false })
    k.cyl(LM.steel, nx + 0.03, h + 0.02, 0.2, 0.004, 0.14, { rx: Math.PI / 2, ry: 0.4 })
  }
  const lampSide = main.x < 0 ? 1 : -1
  if (r(9) < 0.4 && !d.tall) {
    // articulated desk lamp at the back corner, head angled over the desk
    const lx = lampSide * 0.56
    k.push(lx, h, -0.3, lampSide > 0 ? -0.5 : 0.5)
    k.cyl(LM.steel, 0, 0.012, 0, 0.06, 0.024)
    k.cyl(LM.steel, 0, 0.2, 0.05, 0.008, 0.37, { rx: 0.27 })
    k.sphere(LM.steel, 0, 0.38, 0.1, 0.014)
    k.cyl(LM.steel, 0, 0.37, 0.22, 0.008, 0.24, { rx: Math.PI / 2 + 0.08 })
    k.mesh(LG.cone, LM.steel, 0, 0.32, 0.35, { s: [0.13, 0.11, 0.13], rx: 0.35 })
    k.cyl(LM.lampGlow, 0, 0.265, 0.37, 0.055, 0.004, { rx: 0.35, cast: false })
    k.pop()
  } else if (r(10) < 0.7) {
    smallPlant(k, lampSide * 0.56, h, -0.26, n, false)
  }
  if (r(11) < 0.3 && !d.tall) {
    // book stack by the monitor
    k.box(LM.paint, -lampSide * 0.52, h + 0.02, -0.3, 0.22, 0.04, 0.16, { color: BOOK_COLORS[n % BOOK_COLORS.length] })
    k.box(LM.paint, -lampSide * 0.52, h + 0.055, -0.3, 0.2, 0.03, 0.15, { ry: 0.2, color: BOOK_COLORS[(n + 3) % BOOK_COLORS.length] })
  }

  if (d.tall) {
    // anti-fatigue mat for the standing agent
    k.box(LM.feltDark, 0, 0.006, 0.62, 0.7, 0.012, 0.48, { cast: false })
  } else if (r(12) < 0.5) {
    // mobile pedestal under the desk, away from the sitter's knees
    const px = main.x < 0 ? 0.42 : -0.42
    k.box(white ? LM.laminate : LM.oak, px, 0.3, -0.1, 0.4, 0.56, 0.5)
    for (const y of [0.14, 0.33, 0.49]) k.box(LM.caster, px, y, 0.152, 0.36, 0.006, 0.004, { cast: false })
    k.box(LM.steel, px, 0.52, 0.155, 0.12, 0.012, 0.012, { cast: false })
  }
  k.mesh(LG.blob, LM.blob, 0, 0.003, -0.05, { s: [1.7, 1, 1.0], cast: false })
  k.pop()
}

/** world transform of a desk's main screen, for the live MonitorScreen */
export function mainScreenPlacement(d: DeskSpot) {
  const m = monitorLayout(d)[0]
  return {
    position: [m.x, deskH(d) + MON_Y, m.z] as [number, number, number],
    ry: m.ry
  }
}

/* ── desk bank: static workstation batch + occupancy-driven chairs/screens ── */

function occupancyKey(desks: DeskSpot[], occupied: ReadonlySet<string>) {
  return desks.map((d) => (occupied.has(d.id) ? '1' : '0')).join('')
}

export const DeskBank = memo(function DeskBank({
  desks,
  occupied
}: {
  desks: DeskSpot[]
  occupied: ReadonlySet<string>
}) {
  // desks share one static batch with the commons furniture — one draw per
  // (geometry, material) for the whole furnished floor
  const statics = useMemo(() => {
    const k = new Kit()
    buildCommons(k)
    for (const d of desks) deskStatic(k, d)
    return k.build()
  }, [desks])

  const key = occupancyKey(desks, occupied)
  const dynamic = useMemo(() => {
    const k = new Kit()
    for (const d of desks) {
      const on = key[desks.indexOf(d)] === '1'
      const h = deskH(d)
      k.push(d.x, 0, d.z, d.rotY)
      // screens: main screen is live (MonitorScreen) when occupied; the
      // secondary screens show static work or sit dark
      for (const m of monitorLayout(d)) {
        if (m.main && on) continue
        k.push(m.x, h, m.z, m.ry)
        if (m.laptop) {
          k.mesh(LG.laptopScreen, on ? LM.screenCode : LM.screenOff, 0, 0.19, -0.094, { rx: -0.2, cast: false })
        } else {
          const cy = m.big ? MON_Y : MON_Y_SMALL
          k.push(0, cy, 0, 0, DESK_TILT)
          // occupied → secondary shows static work; empty → the main screen
          // idles on a dim lock screen, secondaries sleep
          const mat = on
            ? hash01(d.id, 3) < 0.5
              ? LM.screenCode
              : LM.screenDocs
            : m.main
              ? LM.screenLock
              : LM.screenOff
          k.mesh(m.big ? LG.screen : LG.screenSmall, mat, 0, 0, 0.0135, { cast: false })
          k.pop()
        }
        k.pop()
      }
      // chair: pulled out for the sitter, tucked + slightly askew when empty
      if (!d.tall) {
        if (on) k.push(0, 0, SEAT_Z)
        else k.push((hash01(d.id, 14) - 0.5) * 0.12, 0, SEAT_Z - 0.2, (hash01(d.id, 15) - 0.5) * 0.5)
        taskChair(k)
        k.pop()
      }
      k.pop()
    }
    return k.build()
  }, [desks, key])

  return (
    <>
      <BatchView groups={statics} />
      <BatchView groups={dynamic} />
    </>
  )
})

/** the live main screen of an occupied desk */
export function DeskScreen({ spot, agent, on }: { spot: DeskSpot; agent: Agent; on: boolean }) {
  const p = mainScreenPlacement(spot)
  const seed = hash01(agent.id, 31) * 10 + 1
  return (
    <group position={[spot.x, 0, spot.z]} rotation={[0, spot.rotY, 0]}>
      <group position={p.position} rotation={[DESK_TILT, p.ry, 0, 'YXZ']}>
        <group position={[0, 0, 0.0135]}>
          <MonitorScreen
            domain={agent.domain}
            hue={agent.hue}
            on={on}
            seed={seed}
            geometry={LG.screen}
            offMaterial={LM.screenOff}
          />
        </group>
      </group>
    </group>
  )
}

/* ── commons: lounge, kitchen, meeting room, nook, front bench ─────────── */

function lounge(k: Kit) {
  const s = LOUNGE.sofa
  k.push(s.x, 0, s.z, s.rotY)
  sofa(k)
  k.pop()
  k.push(LOUNGE.table.x, 0, LOUNGE.table.z)
  coffeeTable(k)
  k.pop()
  LOUNGE.armchairs.forEach((a, i) => {
    k.push(a.x, 0, a.z, a.rotY)
    armchair(k, i === 0 ? LM.mustard : LM.sage)
    k.pop()
  })
  k.push(LOUNGE.lamp.x, 0, LOUNGE.lamp.z)
  floorLamp(k)
  k.pop()
  k.push(-7.45, 0, 1.35)
  sideTable(k, false)
  k.pop()
  const sh = LOUNGE.shelf
  k.push(sh.x + 0.17, 0, sh.z, sh.rotY)
  bookshelf(k, 1.7, 2.1, 0.34, 7)
  k.pop()
  monstera(k, -7.45, 4.55, 1.1, LM.potTerracotta, 2)
  snakePlant(k, -4.35, 4.6, 1.1, LM.potCream, 4)
}

function kitchen(k: Kit) {
  // counter run along the left wall; local +z faces into the room (+x),
  // local +x runs toward the back wall (−z)
  k.push(KITCHEN.x, 0, KITCHEN.z, KITCHEN.rotY)
  const len = 2.3
  const cx = -0.35 // counter center (fridge takes the back end)
  k.box(LM.caster, cx, 0.05, 0.02, len, 0.1, 0.52)
  k.box(LM.cabinet, cx, 0.48, 0, len, 0.76, 0.6)
  for (let i = 0; i <= 4; i++) k.box(LM.grout, cx - len / 2 + (i * len) / 4, 0.48, 0.302, 0.006, 0.74, 0.004, { cast: false })
  for (let i = 0; i < 4; i++) k.box(LM.brass, cx - len / 2 + ((i + 0.5) * len) / 4, 0.8, 0.315, 0.14, 0.014, 0.02)
  k.box(LM.stone, cx, 0.885, 0.02, len + 0.02, 0.04, 0.64)
  // sink + faucet
  k.box(LM.steelSoft, cx - 0.55, 0.906, 0.04, 0.5, 0.004, 0.36, { cast: false })
  k.cyl(LM.brass, cx - 0.55, 1.03, -0.2, 0.014, 0.26)
  k.box(LM.brass, cx - 0.55, 1.15, -0.12, 0.024, 0.024, 0.18)
  // espresso machine + grinder + cups
  k.box(LM.aluminium, cx + 0.3, 1.08, -0.05, 0.4, 0.34, 0.4)
  k.box(LM.plasticDark, cx + 0.3, 1.26, -0.05, 0.42, 0.02, 0.42)
  k.box(LM.plasticDark, cx + 0.3, 0.915, 0.12, 0.34, 0.02, 0.14)
  k.cyl(LM.steel, cx + 0.22, 1.02, 0.17, 0.03, 0.05)
  k.cyl(LM.steel, cx + 0.38, 1.02, 0.17, 0.03, 0.05)
  for (let i = 0; i < 4; i++) k.cyl(LM.ceramic, cx + 0.16 + i * 0.09, 1.3, -0.08, 0.032, 0.06, { color: '#efe9df' })
  k.cyl(LM.plasticDark, cx + 0.62, 1.02, -0.1, 0.07, 0.24)
  k.cyl(LM.glass, cx + 0.62, 1.2, -0.1, 0.06, 0.12)
  // kettle, fruit bowl, jars
  k.cyl(LM.steelSoft, cx - 1.0, 0.99, -0.12, 0.07, 0.18)
  k.mesh(LG.hemi, LM.ceramic, cx - 0.15, 0.905, 0.12, { rx: Math.PI, s: [0.26, 0.12, 0.26], color: '#e9e1d3' })
  for (let i = 0; i < 4; i++) k.sphere(LM.paint, cx - 0.15 + Math.sin(i * 2) * 0.05, 0.94, 0.12 + Math.cos(i * 2) * 0.05, 0.035, { color: i % 2 ? '#e38b3a' : '#d9b04a' })
  // fridge at the back end
  k.box(LM.cream, 1.14, 0.93, 0, 0.72, 1.86, 0.66)
  k.box(LM.grout, 1.14, 1.3, 0.332, 0.7, 0.006, 0.004, { cast: false })
  k.box(LM.brass, 0.84, 1.55, 0.35, 0.02, 0.36, 0.03)
  k.box(LM.brass, 0.84, 0.95, 0.35, 0.02, 0.22, 0.03)
  k.pop()

  // island with stools — local x runs along world −z
  k.push(ISLAND.x, 0, ISLAND.z, Math.PI / 2)
  k.box(LM.walnut, 0, 0.47, -0.08, 1.9, 0.9, 0.56)
  k.box(LM.oak, 0, 0.95, 0, ISLAND.len, 0.05, 0.84)
  for (const sx of [-1, 1]) k.box(LM.steel, sx * 1.02, 0.46, 0.3, 0.05, 0.9, 0.05)
  for (const sx of [-1, 1]) {
    k.push(sx * 0.62, 0, 0.62, Math.PI)
    barStool(k)
    k.pop()
  }
  // island styling
  k.box(LM.aluminium, -0.35, 0.985, 0.05, 0.3, 0.012, 0.21, { ry: 0.3 })
  k.cyl(LM.ceramic, 0.25, 1.03, -0.1, 0.035, 0.1, { color: '#b8674a' })
  k.cyl(LM.ceramic, 0.36, 1.03, -0.05, 0.035, 0.1, { color: '#efe9df' })
  smallPlant(k, 0.78, 0.975, -0.15, 11)
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: [2.6, 1, 1.4], cast: false })
  k.pop()

  // pendant globes over the island
  for (const dz of [-0.75, 0, 0.75]) {
    const x = ISLAND.x
    const z = ISLAND.z + dz
    k.cyl(LM.steel, x, 2.85, z, 0.004, 1.1, { cast: false })
    k.cyl(LM.brass, x, 2.28, z, 0.02, 0.05, { cast: false })
    k.sphere(LM.lampGlow, x, 2.14, z, 0.12, { cast: false })
  }
  k.box(LM.steel, ISLAND.x, 3.39, ISLAND.z, 0.06, 0.03, 1.8, { cast: false })
  monstera(k, -7.4, -1.25, 0.95, LM.potCharcoal, 8)
}

function meetingRoom(k: Kit) {
  const { x0, z1 } = MEETING_ROOM
  const x1 = IN.x1
  const z0 = IN.z0
  const H = 2.55
  // floor-to-rail glass on two sides, steel mullions
  const zPosts = [z0, z0 + (z1 - z0) / 3, z0 + (2 * (z1 - z0)) / 3, z1]
  for (const z of zPosts) k.box(LM.steel, x0, H / 2, z, 0.05, H, 0.05)
  k.box(LM.steel, x0, H, (z0 + z1) / 2, 0.06, 0.06, z1 - z0)
  k.box(LM.steel, x0, 0.03, (z0 + z1) / 2, 0.06, 0.06, z1 - z0)
  for (let i = 0; i < 3; i++) {
    const za = zPosts[i]
    const zb = zPosts[i + 1]
    k.box(LM.glass, x0, H / 2, (za + zb) / 2, 0.012, H - 0.06, zb - za - 0.05, { cast: false })
  }
  // front side with a door opening at the left end
  const door = [x0, x0 + 1.0]
  const xPosts = [door[1], door[1] + (x1 - door[1]) / 2, x1]
  for (const x of [x0, ...xPosts]) k.box(LM.steel, x, H / 2, z1, 0.05, H, 0.05)
  k.box(LM.steel, (x0 + x1) / 2, H, z1, x1 - x0, 0.06, 0.06)
  k.box(LM.steel, (door[1] + x1) / 2, 0.03, z1, x1 - door[1], 0.06, 0.06)
  k.box(LM.steel, (door[0] + door[1]) / 2, 2.12, z1, door[1] - door[0], 0.05, 0.05)
  k.box(LM.glass, (door[0] + door[1]) / 2, 2.34, z1, door[1] - door[0] - 0.05, 0.4, 0.012, { cast: false })
  for (let i = 0; i < 2; i++) {
    const xa = xPosts[i]
    const xb = xPosts[i + 1]
    k.box(LM.glass, (xa + xb) / 2, H / 2, z1, xb - xa - 0.05, H - 0.06, 0.012, { cast: false })
  }
  // open glass door leaf swung into the room
  k.push(door[1] - 0.03, 0, z1, -1.2)
  k.box(LM.glass, -0.47, 1.05, 0, 0.92, 2.06, 0.012, { cast: false })
  k.box(LM.steel, -0.93, 1.05, 0, 0.03, 2.06, 0.03)
  k.box(LM.steel, -0.47, 0.02, 0, 0.92, 0.04, 0.03)
  k.box(LM.brass, -0.82, 1.05, 0.03, 0.02, 0.4, 0.02)
  k.pop()
  // frosted band at eye height
  k.box(LM.plasticLight, x0 + 0.01, 1.35, (z0 + z1) / 2, 0.004, 0.08, z1 - z0 - 0.1, { cast: false })

  // table + chairs
  const t = MEETING_ROOM.table
  k.push(t.x, 0, t.z)
  k.box(LM.oak, 0, 0.73, 0, 2.0, 0.04, 1.0)
  for (const sx of [-1, 1]) {
    k.box(LM.steel, sx * 0.8, 0.36, 0, 0.05, 0.71, 0.7)
    k.box(LM.steel, sx * 0.8, 0.02, 0, 0.08, 0.04, 0.8)
  }
  k.box(LM.steel, 0, 0.66, 0, 1.6, 0.04, 0.05)
  for (const x of [-0.6, 0, 0.6]) {
    for (const sz of [-1, 1]) {
      k.push(x + (hash01('mc', x * 10 + sz) - 0.5) * 0.1, 0, sz * 0.78, sz > 0 ? Math.PI : 0)
      shellChair(k, LM.cream)
      k.pop()
    }
  }
  // table styling: laptop, notebooks, water carafe
  k.box(LM.aluminium, -0.5, 0.757, 0.18, 0.3, 0.012, 0.21, { ry: 0.2 })
  k.box(LM.paint, 0.35, 0.757, -0.2, 0.2, 0.012, 0.26, { ry: -0.3, color: '#2f2b28' })
  k.cyl(LM.glass, 0.05, 0.84, 0, 0.05, 0.18)
  k.cyl(LM.glass, 0.18, 0.8, 0.08, 0.03, 0.1)
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: [3, 1, 2.2], cast: false })
  k.pop()
  // linear pendant over the table
  k.box(LM.steel, t.x, 2.35, t.z, 1.5, 0.05, 0.08, { cast: false })
  k.box(LM.bulb, t.x, 2.322, t.z, 1.44, 0.006, 0.05, { cast: false })
  for (const dx of [-0.6, 0.6]) k.cyl(LM.steel, t.x + dx, 2.88, t.z, 0.004, 1.05, { cast: false })
  k.box(LM.steel, t.x, 3.39, t.z, 1.4, 0.03, 0.06, { cast: false })
  // display on a slim floor stand at the room's end
  k.push(x1 - 0.3, 0, t.z, -Math.PI / 2)
  k.box(LM.steel, 0, 0.02, 0, 0.6, 0.03, 0.4)
  k.box(LM.steel, 0, 0.7, -0.05, 0.06, 1.4, 0.04)
  k.box(LM.bezel, 0, 1.35, 0, 1.3, 0.76, 0.04)
  k.box(LM.screenDocs, 0, 1.35, 0.021, 1.26, 0.72, 0.002, { cast: false })
  k.pop()
  monstera(k, x1 - 0.35, z0 + 0.35, 1.0, LM.potCream, 6)
  snakePlant(k, x0 + 0.3, z1 - 0.3, 0.9, LM.potTerracotta, 9)
}

function nook(k: Kit) {
  const { x, z } = NOOK
  k.push(x - 0.75, 0, z, 0.4)
  armchair(k, LM.leather)
  k.pop()
  k.push(x + 0.85, 0, z - 0.1, -0.45)
  armchair(k, LM.sage)
  k.pop()
  k.push(x + 0.05, 0, z + 0.1)
  sideTable(k, true)
  k.pop()
  fig(k, IN.x1 - 0.35, IN.z1 - 0.35, 2.0, LM.potCream, 5)
  // low oak credenza against the right wall
  k.push(IN.x1 - 0.23, 0, 3.0, -Math.PI / 2)
  k.box(LM.oak, 0, 0.32, 0, 1.4, 0.56, 0.42)
  k.box(LM.steel, 0, 0.02, 0, 1.3, 0.04, 0.36)
  for (const dx of [-0.35, 0.35]) k.box(LM.grout, dx, 0.32, 0.212, 0.004, 0.5, 0.004, { cast: false })
  k.cyl(LM.ceramic, -0.4, 0.72, 0, 0.08, 0.24, { color: '#b8674a' })
  k.box(LM.paint, 0.25, 0.63, 0, 0.3, 0.06, 0.22, { color: '#3d4a5c' })
  smallPlant(k, 0.5, 0.6, 0.02, 21, true)
  k.pop()
}

function frontBench(k: Kit) {
  const { x, z, len } = FRONT_BENCH
  // two slatted oak planters bracketing a cushioned bench
  for (const sx of [-1, 1]) {
    const px = x + sx * (len / 2 - 0.45)
    k.box(LM.oak, px, 0.24, z, 0.9, 0.48, 0.5)
    for (let i = 0; i < 6; i++) k.box(LM.oakDark, px - 0.375 + i * 0.15, 0.24, z + 0.252, 0.012, 0.44, 0.004, { cast: false })
    k.box(LM.soil, px, 0.47, z, 0.84, 0.02, 0.44, { cast: false })
    snakePlant(k, px - 0.2, z, 0.95, LM.soil, 12 + sx)
    snakePlant(k, px + 0.22, z + 0.02, 0.75, LM.soil, 14 + sx)
  }
  const bw = len - 1.9
  k.box(LM.walnut, x, 0.2, z, bw, 0.05, 0.44)
  for (const sx of [-1, 1]) k.box(LM.steel, x + sx * (bw / 2 - 0.1), 0.1, z, 0.04, 0.2, 0.4)
  k.mesh(LG.cushion, LM.linen, x - 0.55, 0.28, z, { s: [1.5, 0.5, 0.6] })
  k.mesh(LG.cushion, LM.linen, x + 0.55, 0.28, z, { s: [1.5, 0.5, 0.6] })
  k.mesh(LG.pillow, LM.mustard, x + 1.05, 0.42, z - 0.1, { rx: -0.3, ry: -0.2, s: 0.8 })
}

/** low storage credenza with a printer outside the meeting room */
function printStation(k: Kit) {
  const { x, z, len } = PRINT_STATION
  k.push(x, 0, z)
  k.box(LM.laminate, 0, 0.36, 0, len, 0.62, 0.46)
  k.box(LM.oak, 0, 0.685, 0, len + 0.02, 0.03, 0.48)
  k.box(LM.steel, 0, 0.025, 0, len - 0.1, 0.05, 0.4)
  for (let i = 1; i < 4; i++) k.box(LM.grout, -len / 2 + (i * len) / 4, 0.36, 0.232, 0.004, 0.58, 0.004, { cast: false })
  for (let i = 0; i < 4; i++) k.box(LM.steel, -len / 2 + ((i + 0.5) * len) / 4, 0.6, 0.236, 0.12, 0.012, 0.012, { cast: false })
  // printer
  k.box(LM.plasticLight, -0.55, 0.83, 0, 0.5, 0.26, 0.4)
  k.box(LM.plasticDark, -0.55, 0.965, -0.02, 0.44, 0.012, 0.3)
  k.box(LM.paper, -0.55, 0.78, 0.2, 0.3, 0.01, 0.1, { rx: -0.3, cast: false })
  // binders + box files
  for (let i = 0; i < 6; i++) k.box(LM.paint, 0.15 + i * 0.07, 0.84, -0.05, 0.06, 0.28, 0.26, { color: BOOK_COLORS[(i * 3) % BOOK_COLORS.length] })
  smallPlant(k, 0.85, 0.7, 0.0, 27, true)
  k.mesh(LG.blob, LM.blob, 0, 0.004, 0, { s: [len * 1.2, 1, 0.9], cast: false })
  k.pop()
}

/** all static commons furniture (lounge, kitchen, meeting room, nook,
 * front bench, print station, floor plants) — merged into DeskBank's batch */
function buildCommons(k: Kit) {
  lounge(k)
  kitchen(k)
  meetingRoom(k)
  nook(k)
  frontBench(k)
  printStation(k)
  // floor plants that fill corners and aisles
  fig(k, -0.05, -4.35, 1.75, LM.potTerracotta, 1)
  monstera(k, 3.85, -4.45, 0.9, LM.potCharcoal, 4)
  monstera(k, -3.95, 3.15, 0.85, LM.potCream, 9)
  snakePlant(k, 4.15, 3.0, 0.9, LM.potTerracotta, 3)
  fig(k, 4.05, -0.7, 1.9, LM.potCream, 7)
}
