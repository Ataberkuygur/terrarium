/* ── street life ────────────────────────────────────────────────────────
 * The "alive" layer of the miniature city:
 *
 *   crowd      ~40 half-metre minifigs — commuters striding both main
 *              sidewalks and the avenue walks, a dog walker, people
 *              waiting at the bus shelter, chatting pairs, park-goers on
 *              the fountain benches and a slow pair circling the plaza
 *   pigeons    a small flock pecking and hopping on the plaza + walks
 *   furniture  bus shelter with a glowing ad panel, sidewalk benches,
 *              green NYC litter baskets, newspaper boxes, a USPS box, a
 *              bike-share dock with bikes, and a hot-dog cart
 *
 * Cost model: every figure part (torso, head, hair, legs, arms) is ONE
 * InstancedMesh for the whole crowd — 7 draws for 40 people — and the
 * furniture is a static Batch. Deliberately NOT office/Character: those
 * rigs are far too heavy for extras. All motion lives in one useFrame in
 * <CrowdMotion>, mounted only while `animated`; static mode bakes the
 * crowd at its t=0 pose and does zero per-frame work. Positions derive
 * from clock.elapsedTime (no drift) and nothing allocates per frame.
 */
import { useLayoutEffect, useMemo, useRef, type JSX, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Batch, BatchMeshes, h01, jit, pick, tm } from './kit'
import { CITY } from './layout'
import { AVENUES, WALK_Y, bench } from './street'
import { FOUNTAIN, PARK_BENCHES, PLAZA_R } from './park'

// ── palettes ─────────────────────────────────────────────────────────

const TOPS = ['#c9563c', '#3f5f8a', '#d8b13c', '#4f7a4a', '#8a5fa8', '#2f2f35', '#e9e4da', '#b8443f', '#6b8fb3', '#a07850', '#1f4f5a', '#d98aa0']
const BOTTOMS = ['#2b3040', '#3a3b40', '#b5a47e', '#1d1e22', '#3e5a80', '#5a4a3a']
const SKINS = ['#f3cdb3', '#e6b594', '#d09a74', '#b57c55', '#8d5b3c', '#6b4330']
const HAIR = ['#1d1a18', '#3b2618', '#6b4a2c', '#c9a15a', '#8c8c8c', '#8a3a22']

// ── figure parts ─────────────────────────────────────────────────────

type FigPart = 'torso' | 'head' | 'hair' | 'leg' | 'arm' | 'bag'

const hairGeo = new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)
const PART_GEO: Record<FigPart, THREE.BufferGeometry> = {
  torso: new THREE.CapsuleGeometry(0.066, 0.13, 4, 10),
  head: new THREE.SphereGeometry(0.056, 12, 10),
  hair: hairGeo,
  leg: new THREE.CapsuleGeometry(0.027, 0.12, 3, 8),
  arm: new THREE.CapsuleGeometry(0.019, 0.1, 3, 8),
  bag: new THREE.BoxGeometry(1, 1, 1)
}
const figMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 })
const skinMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })
const PART_MAT: Record<FigPart, THREE.Material> = {
  torso: figMat,
  head: skinMat,
  hair: figMat,
  leg: figMat,
  arm: figMat,
  bag: figMat
}
const PARTS = Object.keys(PART_GEO) as FigPart[]

type Mode = 'walkX' | 'walkZ' | 'stand' | 'sit' | 'circle'

interface Fig {
  mode: Mode
  x: number
  y: number
  z: number
  dir: 1 | -1 // walk direction / circle sense
  speed: number // u/s (circle: rad/s)
  span: [number, number] // wrap range for walkers
  yaw: number // facing for stand/sit
  phase: number
  gait: number
  scale: number
  top: THREE.Color
  bottom: THREE.Color
  skin: THREE.Color
  hair: THREE.Color
  bag: THREE.Color | null
  dog?: boolean
}

function mkFig(seed: string, n: number, over: Partial<Fig> & Pick<Fig, 'mode' | 'x' | 'z'>): Fig {
  const speed = 0.55 + h01(seed, n + 1) * 0.35
  return {
    y: WALK_Y,
    dir: 1,
    speed,
    span: [-40, 40],
    yaw: 0,
    phase: h01(seed, n + 2) * Math.PI * 2,
    gait: 6.2 + speed * 2.4,
    scale: 0.92 + h01(seed, n + 3) * 0.16,
    top: jit(pick(TOPS, seed, n + 4), seed, n + 5, 0.05),
    bottom: new THREE.Color(pick(BOTTOMS, seed, n + 6)),
    skin: new THREE.Color(pick(SKINS, seed, n + 7)),
    hair: new THREE.Color(pick(HAIR, seed, n + 8)),
    bag: h01(seed, n + 9) < 0.35 ? jit(pick(['#5a3a24', '#1f1f22', '#8c2f3a', '#c9a15a'], seed, n + 10), seed, n, 0.05) : null,
    ...over
  }
}

/* bus shelter + seating spots */
const SHELTER_X = 9.8
const SHELTER_Z = -4.12

function buildCrowd(): Fig[] {
  const F: Fig[] = []
  let n = 0
  // main-road sidewalks: two opposing lanes per side
  const lanes: [number, 1 | -1, number][] = [
    [-4.72, 1, 7],
    [-5.1, -1, 6],
    [4.5, -1, 6],
    [4.86, 1, 6]
  ]
  for (const [z, dir, count] of lanes) {
    for (let i = 0; i < count; i++) {
      const x = -34 + (i + h01('cx', n) * 0.7) * (68 / count)
      F.push(mkFig('crowd', n * 13, { mode: 'walkX', x, z: z + (h01('cz', n) - 0.5) * 0.12, dir, span: [-36, 36] }))
      n++
    }
  }
  // a dog walker on the near walk
  F.push(mkFig('crowd', 999, { mode: 'walkX', x: -6, z: 4.7, dir: 1, speed: 0.5, span: [-36, 36], dog: true, top: new THREE.Color('#2f4a3c') }))
  // avenue walkers heading up/down the far-side avenue sidewalks
  for (const ax of AVENUES) {
    for (const s of [-1, 1]) {
      const x = ax + s * (CITY.avenueW / 2 + 0.16 + 0.75)
      for (let i = 0; i < 2; i++) {
        F.push(mkFig('ave', n * 7, { mode: 'walkZ', x, z: -8 - i * 12 - h01('az', n) * 5, dir: s > 0 ? 1 : -1, span: [-40, -6] }))
        n++
      }
    }
  }
  // waiting at the bus shelter (two seated, two standing)
  F.push(mkFig('bus', 1, { mode: 'sit', x: SHELTER_X - 0.25, y: WALK_Y + 0.11, z: SHELTER_Z - 0.09, yaw: 0 }))
  F.push(mkFig('bus', 2, { mode: 'sit', x: SHELTER_X + 0.35, y: WALK_Y + 0.11, z: SHELTER_Z - 0.09, yaw: 0 }))
  F.push(mkFig('bus', 3, { mode: 'stand', x: SHELTER_X + 1.3, z: -4.05, yaw: -1.2 }))
  F.push(mkFig('bus', 4, { mode: 'stand', x: SHELTER_X - 1.35, z: -4.1, yaw: 0.4 }))
  // chatting pairs
  for (const [x, z] of [
    [3.3, -5.34],
    [-17.5, 5.25],
    [22.2, -5.34]
  ]) {
    F.push(mkFig('chat', Math.round(x * 10), { mode: 'stand', x: x - 0.18, z, yaw: Math.PI / 2 }))
    F.push(mkFig('chat', Math.round(x * 10) + 50, { mode: 'stand', x: x + 0.18, z, yaw: -Math.PI / 2 }))
  }
  // hot-dog customers
  F.push(mkFig('hd', 1, { mode: 'stand', x: -8.25, z: -4.46, yaw: Math.PI * 0.9 }))
  // park: bench sitters + a slow pair circling the plaza + kiosk queue
  PARK_BENCHES.forEach(([bx, by, bz, yaw], i) => {
    if (i === 1) return
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    for (const lx of i === 0 ? [-0.2, 0.2] : [0.15]) {
      F.push(mkFig('pk', Math.round(i * 10 + lx * 10), { mode: 'sit', x: bx + lx * c + 0.03 * sn, y: by + 0.11, z: bz - lx * sn + 0.03 * c, yaw }))
    }
  })
  for (let i = 0; i < 2; i++)
    F.push(mkFig('circ', i, { mode: 'circle', x: FOUNTAIN.x, y: FOUNTAIN.y + 0.01, z: FOUNTAIN.z, speed: 0.16, phase: i * 0.25, dir: 1 }))
  const kx = CITY.gardenX + CITY.gardenW / 2 - 2.0
  const kz = CITY.gardenZ - CITY.gardenD / 2 + 2.2
  F.push(mkFig('kq', 1, { mode: 'stand', x: kx, y: 0.15, z: kz + 0.95, yaw: Math.PI }))
  F.push(mkFig('kq', 2, { mode: 'stand', x: kx + 0.1, y: 0.15, z: kz + 1.4, yaw: Math.PI }))
  return F
}

// ── pigeons ──────────────────────────────────────────────────────────

interface Bird {
  hx: number
  hz: number
  y: number
  range: number
  x: number
  z: number
  fx: number
  fz: number
  tx: number
  tz: number
  yaw: number
  hop: number // 0..1 progress, 1 = idle
  wait: number
  peckF: number
  peckP: number
  seed: number
}

function buildBirds(): Bird[] {
  const spots: [number, number, number, number][] = [
    [FOUNTAIN.x + 1.2, FOUNTAIN.z + 2.0, 0.16, 0.7],
    [FOUNTAIN.x - 1.4, FOUNTAIN.z + 1.7, 0.16, 0.7],
    [FOUNTAIN.x + 0.3, FOUNTAIN.z + 2.3, 0.16, 0.6],
    [-9.4, -5.2, WALK_Y, 0.8],
    [-8.8, -4.7, WALK_Y, 0.6],
    [6.4, 5.0, WALK_Y, 0.8],
    [2.2, -5.25, WALK_Y, 0.7]
  ]
  return spots.map(([x, z, y, r], i) => ({
    hx: x,
    hz: z,
    y,
    range: r,
    x,
    z,
    fx: x,
    fz: z,
    tx: x,
    tz: z,
    yaw: h01('pg', i) * 6.28,
    hop: 1,
    wait: 0.4 + h01('pw', i) * 2,
    peckF: 1.6 + h01('pf', i) * 1.2,
    peckP: h01('pp', i) * 6.28,
    seed: i * 7 + 3
  }))
}

const birdBodyGeo = new THREE.SphereGeometry(0.05, 10, 8)
const birdHeadGeo = new THREE.SphereGeometry(0.026, 8, 6)
const birdMat = new THREE.MeshStandardMaterial({ color: '#6d717c', roughness: 0.85 })
const birdHeadMat = new THREE.MeshStandardMaterial({ color: '#4a5b5e', roughness: 0.7, metalness: 0.2 })

const dogMat = new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.8 })

// ── static street furniture ──────────────────────────────────────────

function buildFurniture(): Batch {
  const B = new Batch()
  const y = WALK_Y
  // bus shelter: frame, glass back + side, roof, lit ad panel, bench, sign
  const sx = SHELTER_X
  const sz = SHELTER_Z
  const frame = '#3b4046'
  for (const dx of [-1.05, 1.05])
    for (const dz of [-0.3, 0.25]) B.stand('metal', sx + dx, y, sz + dz, 0.04, 1.12, 0.04, frame)
  B.stand('pane', sx, y + 0.1, sz - 0.3, 2.06, 0.95, 0.02, '#9fc0d0')
  B.stand('pane', sx - 1.05, y + 0.1, sz - 0.03, 0.02, 0.95, 0.52, '#9fc0d0')
  B.stand('solid', sx, y + 1.12, sz - 0.02, 2.3, 0.06, 0.82, '#2f3338')
  B.stand('lit', sx, y + 1.13, sz + 0.395, 2.2, 0.035, 0.012, '#d9ecff')
  B.stand('solid', sx + 1.05, y + 0.12, sz - 0.03, 0.06, 0.92, 0.56, frame)
  B.stand('lit', sx + 1.085, y + 0.2, sz - 0.03, 0.01, 0.76, 0.44, '#f4d9a8')
  B.stand('lit', sx + 1.09, y + 0.45, sz - 0.03, 0.012, 0.3, 0.32, '#e26a4a')
  bench(B, sx, y, sz - 0.1, 0, '#3f4a52')
  B.stand('metal', sx + 1.45, y, -3.82, 0.035, 1.35, 0.035, frame)
  B.stand('solid', sx + 1.45, y + 1.12, -3.82, 0.03, 0.26, 0.24, '#2458a8')
  B.stand('lit', sx + 1.47, y + 1.2, -3.82, 0.005, 0.07, 0.18, '#ffffff')
  // sidewalk benches on the near walk (backs to the plaza)
  for (const x of [-4.2, 7.2, -13.8, 18.4]) bench(B, x, y, 5.36, Math.PI)
  // NYC litter baskets
  for (const [x, z] of [
    [-6.2, -4.12],
    [4.9, -4.12],
    [13.7, -4.12],
    [-1.9, 4.12],
    [9.8, 4.12],
    [-19.4, 4.12],
    [-19.4, -4.12]
  ]) {
    B.stand('cyl', x, y, z, 0.22, 0.34, 0.22, '#2e5a3e')
    for (const f of [0.08, 0.2, 0.32]) B.stand('cylMetal', x, y + f, z, 0.23, 0.02, 0.23, '#23452f')
  }
  // newspaper boxes by the brownstones + near the HQ corner
  const boxes = ['#2c5ea8', '#c8342c', '#e5b52e', '#2f7a4a', '#e9e4da']
  for (const [x0, z, rot] of [
    [5.35, -5.25, 0],
    [-3.2, 5.3, Math.PI]
  ] as [number, number, number][]) {
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 0.3
      B.stand('solid', x, y, z, 0.24, 0.34, 0.22, pick(boxes, 'nb' + x0, i), rot)
      B.stand('solid', x, y + 0.34, z, 0.26, 0.03, 0.24, '#3a3d42', rot)
      B.stand('pane', x, y + 0.17, z + (rot ? -0.112 : 0.112), 0.16, 0.1, 0.005, '#cfd8dc', rot)
    }
  }
  // USPS mailbox
  B.stand('solid', 1.6, y, 5.28, 0.28, 0.08, 0.3, '#1f3f7a')
  B.stand('bevel', 1.6, y + 0.08, 5.28, 0.28, 0.4, 0.3, '#2451a0')
  B.stand('cyl', 1.6, y + 0.42, 5.28, 0.28, 0.08, 0.3, '#2451a0')
  // bike-share dock with bikes (near walk)
  for (let i = 0; i < 6; i++) {
    const x = 11.8 + i * 0.36
    B.stand('metal', x, y, 6.2, 0.06, 0.34, 0.08, '#4a5058')
    B.stand('lit', x, y + 0.26, 6.155, 0.03, 0.03, 0.005, '#57e389')
    if (i === 4) continue
    const bc = '#2b6fd1'
    // wheels (discs on edge), frame, seat, bars
    const bz = 5.95
    for (const dz of [-0.19, 0.19]) B.put('cylMetal', tm(x, y + 0.13, bz + dz, 0.25, 0.02, 0.25, 0, 0, Math.PI / 2), '#1d1f22')
    B.put('metal', tm(x, y + 0.2, bz, 0.02, 0.02, 0.36), bc)
    B.put('metal', tm(x, y + 0.26, bz + 0.07, 0.022, 0.12, 0.022), bc)
    B.put('solid', tm(x, y + 0.33, bz + 0.07, 0.05, 0.02, 0.09), '#1d1f22')
    B.put('metal', tm(x, y + 0.34, bz - 0.16, 0.2, 0.02, 0.02), '#1d1f22')
    B.put('solid', tm(x, y + 0.2, bz - 0.2, 0.1, 0.06, 0.08), bc)
  }
  // hot-dog cart by the park gate — steel cart, striped umbrella
  const hx = -8.4
  const hz = -4.02
  B.stand('bevel', hx, y + 0.12, hz, 0.8, 0.34, 0.44, '#c9ced3')
  B.stand('solid', hx, y + 0.46, hz, 0.84, 0.04, 0.48, '#9aa1a8')
  B.stand('lit', hx, y + 0.3, hz + 0.225, 0.5, 0.1, 0.01, '#ffe08a')
  for (const dx of [-0.28, 0.28]) B.put('cylMetal', tm(hx + dx, y + 0.1, hz + 0.23, 0.2, 0.03, 0.2, 0, Math.PI / 2), '#23262a')
  B.stand('metal', hx + 0.3, y + 0.48, hz, 0.025, 0.6, 0.025, '#d0d4d8')
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    B.put('solid', tm(hx + 0.3 + Math.cos(a) * 0.2, y + 1.05, hz + Math.sin(a) * 0.2, 0.3, 0.02, 0.19, -a, 0, 0.28), i % 2 ? '#f2c43c' : '#2c5ea8')
  }
  B.stand('cone', hx + 0.3, y + 1.04, hz, 0.12, 0.08, 0.12, '#2c5ea8')
  return B
}

// ── motion ───────────────────────────────────────────────────────────

const _root = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _t = new THREE.Matrix4()
const _r = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _xAx = new THREE.Vector3(1, 0, 0)

type Refs = Record<FigPart, RefObject<THREE.InstancedMesh | null>>
interface Slots {
  torso: number
  head: number
  hair: number
  leg: number // first of two
  arm: number // first of two
  bag: number // -1 = none
}

const wrap = (v: number, a: number, b: number) => ((((v - a) % (b - a)) + (b - a)) % (b - a)) + a

/** root · local → one instance slot (module scratch, no allocation) */
function setPart(refs: Refs, part: FigPart, idx: number, local: THREE.Matrix4): void {
  const mesh = refs[part].current
  if (!mesh) return
  _m.multiplyMatrices(_root, local)
  mesh.setMatrixAt(idx, _m)
}

/** writes one figure's parts for time t */
function poseFig(f: Fig, s: Slots, refs: Refs, t: number, dogRef: THREE.Group | null): void {
  let x = f.x
  let z = f.z
  let yaw = f.yaw
  let swing = 0
  let bob = 0
  let sit = false
  const ph = t * f.gait + f.phase
  if (f.mode === 'walkX') {
    x = wrap(f.x + f.dir * f.speed * t, f.span[0], f.span[1])
    yaw = (f.dir * Math.PI) / 2
    swing = Math.sin(ph) * 0.55
    bob = Math.abs(Math.cos(ph)) * 0.018
  } else if (f.mode === 'walkZ') {
    z = wrap(f.z + f.dir * f.speed * t, f.span[0], f.span[1])
    yaw = f.dir > 0 ? 0 : Math.PI
    swing = Math.sin(ph) * 0.55
    bob = Math.abs(Math.cos(ph)) * 0.018
  } else if (f.mode === 'circle') {
    const a = f.phase * Math.PI * 2 + t * f.speed * f.dir
    const r = PLAZA_R - 0.95
    x = f.x + Math.cos(a) * r
    z = f.z + Math.sin(a) * r
    yaw = Math.atan2(-Math.sin(a), Math.cos(a)) + (f.dir > 0 ? 0 : Math.PI)
    const ph2 = t * 5.2 + f.phase * 10
    swing = Math.sin(ph2) * 0.4
    bob = Math.abs(Math.cos(ph2)) * 0.012
  } else if (f.mode === 'sit') {
    sit = true
  } else {
    // idle sway + occasional glance
    yaw = f.yaw + Math.sin(t * 0.5 + f.phase) * 0.25
    bob = Math.sin(t * 1.3 + f.phase) * 0.004
  }
  _p.set(x, f.y + bob, z)
  _q.setFromAxisAngle(_up, yaw)
  _s.setScalar(f.scale)
  _root.compose(_p, _q, _s)

  setPart(refs, 'torso', s.torso, _t.makeTranslation(0, sit ? 0.3 : 0.31, 0))
  setPart(refs, 'head', s.head, _t.makeTranslation(0, 0.475, 0))
  setPart(refs, 'hair', s.hair, _t.makeTranslation(0, 0.485, -0.006))
  for (let k = 0; k < 2; k++) {
    const side = k ? -1 : 1
    const legRot = sit ? -Math.PI / 2 : swing * side
    _t.makeTranslation(side * 0.036, 0.19, 0)
    _r.makeRotationAxis(_xAx, legRot)
    _t.multiply(_r)
    _t.multiply(_r.makeTranslation(0, -0.085, 0))
    setPart(refs, 'leg', s.leg + k, _t)
    const armRot = sit ? -0.5 : -swing * side * 0.75
    _t.makeTranslation(side * 0.086, 0.375, 0)
    _r.makeRotationAxis(_xAx, armRot)
    _t.multiply(_r)
    _t.multiply(_r.makeRotationZ(side * 0.08))
    _t.multiply(_r.makeTranslation(0, -0.065, 0))
    setPart(refs, 'arm', s.arm + k, _t)
  }
  if (s.bag >= 0) {
    _t.makeTranslation(0.1, 0.24, 0.02)
    _t.multiply(_r.makeScale(0.04, 0.12, 0.1))
    setPart(refs, 'bag', s.bag, _t)
  }
  if (f.dog && dogRef) {
    // dog trots a leash-length ahead on the curb side
    dogRef.position.set(x + f.dir * 0.42, f.y, z - 0.12)
    dogRef.rotation.y = yaw
    dogRef.position.y = f.y + Math.abs(Math.sin(t * 11)) * 0.012
  }
}

function birdStep(b: Bird, dt: number, rnd: () => number): void {
  if (b.hop < 1) {
    b.hop = Math.min(1, b.hop + dt / 0.4)
    b.x = b.fx + (b.tx - b.fx) * b.hop
    b.z = b.fz + (b.tz - b.fz) * b.hop
  } else {
    b.wait -= dt
    if (b.wait <= 0) {
      b.fx = b.x
      b.fz = b.z
      b.tx = b.hx + (rnd() - 0.5) * b.range * 2
      b.tz = b.hz + (rnd() - 0.5) * b.range * 2
      b.yaw = Math.atan2(b.tx - b.fx, b.tz - b.fz)
      b.wait = 0.6 + rnd() * 2.6
      b.hop = 0
    }
  }
}

function writeBird(b: Bird, i: number, body: THREE.InstancedMesh, head: THREE.InstancedMesh, t: number): void {
  const hopY = b.hop < 1 ? Math.sin(b.hop * Math.PI) * 0.08 : 0
  _p.set(b.x, b.y + 0.04 + hopY, b.z)
  _q.setFromAxisAngle(_up, b.yaw)
  _s.set(0.85, 0.75, 1.3)
  _root.compose(_p, _q, _s)
  body.setMatrixAt(i, _root)
  const peck = b.hop < 1 ? 0 : Math.max(0, Math.sin(t * b.peckF + b.peckP)) ** 2
  _root.compose(_p, _q, _s.set(1, 1, 1))
  _t.makeTranslation(0, 0.04 - peck * 0.05, 0.055 + peck * 0.02)
  _m.multiplyMatrices(_root, _t)
  head.setMatrixAt(i, _m)
}

function CrowdMotion({
  figs,
  slots,
  refs,
  birds,
  birdBody,
  birdHead,
  dog
}: {
  figs: Fig[]
  slots: Slots[]
  refs: Refs
  birds: Bird[]
  birdBody: RefObject<THREE.InstancedMesh | null>
  birdHead: RefObject<THREE.InstancedMesh | null>
  dog: RefObject<THREE.Group | null>
}): null {
  const rng = useMemo(() => {
    let s = 4242
    return () => (s = (s * 16807) % 2147483647) / 2147483647
  }, [])
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const step = Math.min(dt, 0.1)
    for (let i = 0; i < figs.length; i++) poseFig(figs[i], slots[i], refs, t, dog.current)
    for (const p of PARTS) {
      const m = refs[p].current
      if (m) m.instanceMatrix.needsUpdate = true
    }
    const bb = birdBody.current
    const bh = birdHead.current
    if (bb && bh) {
      for (let i = 0; i < birds.length; i++) {
        birdStep(birds[i], step, rng)
        writeBird(birds[i], i, bb, bh, t)
      }
      bb.instanceMatrix.needsUpdate = true
      bh.instanceMatrix.needsUpdate = true
    }
  })
  return null
}

// ── component ────────────────────────────────────────────────────────

let _furniture: Batch | null = null

/**
 * Sidewalk life for the miniature city — strolling minifig pedestrians,
 * park-goers, pigeons and the static street furniture.
 * `animated={false}` unmounts the motion loop entirely: zero per-frame
 * work, and the crowd stands at its deterministic t=0 pose.
 */
export function StreetLife({ animated = true }: { animated?: boolean }): JSX.Element {
  const furniture = (_furniture ??= buildFurniture())
  const figs = useMemo(buildCrowd, [])
  const birds = useMemo(buildBirds, [])
  const { slots, counts, colors } = useMemo(() => {
    const counts: Record<FigPart, number> = { torso: 0, head: 0, hair: 0, leg: 0, arm: 0, bag: 0 }
    const colors: Record<FigPart, THREE.Color[]> = { torso: [], head: [], hair: [], leg: [], arm: [], bag: [] }
    const slots = figs.map((f) => {
      const sl: Slots = {
        torso: counts.torso++,
        head: counts.head++,
        hair: counts.hair++,
        leg: counts.leg,
        arm: counts.arm,
        bag: f.bag ? counts.bag++ : -1
      }
      counts.leg += 2
      counts.arm += 2
      colors.torso.push(f.top)
      colors.head.push(f.skin)
      colors.hair.push(f.hair)
      colors.leg.push(f.bottom, f.bottom)
      colors.arm.push(f.top, f.top)
      if (f.bag) colors.bag.push(f.bag)
      return sl
    })
    return { slots, counts, colors }
  }, [figs])

  const torso = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const hair = useRef<THREE.InstancedMesh>(null)
  const leg = useRef<THREE.InstancedMesh>(null)
  const arm = useRef<THREE.InstancedMesh>(null)
  const bag = useRef<THREE.InstancedMesh>(null)
  const refs: Refs = { torso, head, hair, leg, arm, bag }
  const birdBody = useRef<THREE.InstancedMesh>(null)
  const birdHead = useRef<THREE.InstancedMesh>(null)
  const dog = useRef<THREE.Group>(null)

  /* t=0 bake + per-instance colors */
  useLayoutEffect(() => {
    for (let i = 0; i < figs.length; i++) poseFig(figs[i], slots[i], refs, 0, dog.current)
    for (const p of PARTS) {
      const m = refs[p].current
      if (!m) continue
      colors[p].forEach((c, k) => m.setColorAt(k, c))
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    const bb = birdBody.current
    const bh = birdHead.current
    if (bb && bh) {
      birds.forEach((b, i) => writeBird(b, i, bb, bh, 0))
      bb.instanceMatrix.needsUpdate = true
      bh.instanceMatrix.needsUpdate = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figs, slots, colors, birds])

  return (
    <group>
      <BatchMeshes batch={furniture} />
      {PARTS.map((p) => (
        <instancedMesh
          key={p}
          ref={refs[p]}
          args={[PART_GEO[p], PART_MAT[p], Math.max(1, counts[p])]}
          frustumCulled={false}
          castShadow
        />
      ))}
      <instancedMesh ref={birdBody} args={[birdBodyGeo, birdMat, birds.length]} frustumCulled={false} />
      <instancedMesh ref={birdHead} args={[birdHeadGeo, birdHeadMat, birds.length]} frustumCulled={false} />
      {/* the dog — a tiny terrier following its walker */}
      <group ref={dog}>
        <mesh position={[0, 0.07, 0]} scale={[0.07, 0.06, 0.14]} material={dogMat}>
          <boxGeometry />
        </mesh>
        <mesh position={[0, 0.11, 0.08]} scale={[0.06, 0.06, 0.07]} material={dogMat}>
          <boxGeometry />
        </mesh>
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[sx * 0.025, 0.02, sz * 0.05]} scale={[0.018, 0.04, 0.018]} material={dogMat}>
              <boxGeometry />
            </mesh>
          ))
        )}
      </group>
      {animated && (
        <CrowdMotion figs={figs} slots={slots} refs={refs} birds={birds} birdBody={birdBody} birdHead={birdHead} dog={dog} />
      )}
    </group>
  )
}
