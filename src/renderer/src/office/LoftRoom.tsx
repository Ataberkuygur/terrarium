/**
 * Loft shell — diorama plinth, oak floor, brick + plaster walls with steel
 * windows, the city backdrop, ducts, rugs and wall-mounted dressing.
 *
 * Dollhouse cutaway: each wall is a `CutWall` that checks, per frame, which
 * side of its plane the camera is on. Walls between the camera and the
 * room collapse to a low cut stub (dark section cap on top), so orbiting
 * never buries the crew behind a wall. The room keeps its interior shading
 * regardless: invisible shadow-proxy walls + ceiling (colorWrite off) always
 * cast into the sun's shadow map, so daylight only enters through the
 * window openings.
 */

import { memo, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { isClick } from './RpgControls'
import { Kit, LM, LG, worldBox } from './loftKit'
import { BatchView, smallPlant } from './Props'
import {
  ROOM,
  IN,
  WINDOWS,
  SILL_Y,
  HEAD_Y,
  LOUNGE,
  NOOK,
  ISLAND,
  KITCHEN,
  PODS,
  WORKSTATION_PODS
} from './layout'
import { skylineTex, rugTex, artTex, shaftTex, neonTex, type RugKind } from './Textures'

const H = ROOM.h
const T = ROOM.wall
const STUB_H = 0.26
/** camera must be this far inside a wall's plane before the wall shows */
const CUT_MARGIN = 1.2

/* ── materials local to the shell ──────────────────────────────────────── */

const exterior = new THREE.MeshStandardMaterial({ color: '#d8d0c4', roughness: 0.95 })
const duct = new THREE.MeshStandardMaterial({ color: '#b3b7bb', roughness: 0.38, metalness: 0.65 })
const radiator = new THREE.MeshStandardMaterial({ color: '#efebe4', roughness: 0.45 })
const whiteboard = new THREE.MeshStandardMaterial({ color: '#f7f7f4', roughness: 0.2 })
const backdrop = (() => {
  const t = skylineTex().clone()
  t.wrapS = THREE.RepeatWrapping
  t.repeat.set(2, 1)
  t.needsUpdate = true
  return new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: '#f2efe9' })
})()
const neon = new THREE.MeshBasicMaterial({
  map: neonTex(),
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const shaft = new THREE.MeshBasicMaterial({
  map: shaftTex(),
  color: '#ffd9a8',
  transparent: true,
  opacity: 0.38,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false
})
const rugMats = new Map<RugKind, THREE.MeshStandardMaterial>()
function rugMat(kind: RugKind) {
  let m = rugMats.get(kind)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: rugTex(kind), roughness: 1 })
    rugMats.set(kind, m)
  }
  return m
}
const artMats = [0, 1, 2, 3, 4, 5].map(
  (i) => new THREE.MeshStandardMaterial({ map: artTex(i), roughness: 0.8 })
)

/** BoxGeometry material order: +x, −x, +y, −y, +z, −z */
type FaceMats = [THREE.Material, THREE.Material, THREE.Material, THREE.Material, THREE.Material, THREE.Material]

interface Seg {
  geo: THREE.BufferGeometry
}

/* ── wall segmentation ─────────────────────────────────────────────────── */

/** back wall (z = −5): full-width bottom + top bands, piers between windows */
function backSegs(stub: boolean): Seg[] {
  const z = -ROOM.d / 2
  const L = ROOM.w + T
  if (stub) return [{ geo: worldBox(L, STUB_H, T, [0, STUB_H / 2, z]) }]
  const segs: Seg[] = [
    { geo: worldBox(L, SILL_Y, T, [0, SILL_Y / 2, z]) },
    { geo: worldBox(L, H - HEAD_Y, T, [0, (H + HEAD_Y) / 2, z]) }
  ]
  const edges = [-L / 2, ...WINDOWS.flatMap((w) => [w.x - w.w / 2, w.x + w.w / 2]), L / 2]
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i]
    const b = edges[i + 1]
    segs.push({ geo: worldBox(b - a, HEAD_Y - SILL_Y, T, [(a + b) / 2, (SILL_Y + HEAD_Y) / 2, z]) })
  }
  return segs
}

function sideSegs(sx: -1 | 1, stub: boolean): Seg[] {
  const x = (sx * ROOM.w) / 2
  const h = stub ? STUB_H : H
  return [{ geo: worldBox(T, h, ROOM.d - T, [x, h / 2, 0]) }]
}

function frontSegs(stub: boolean): Seg[] {
  const z = ROOM.d / 2
  const L = ROOM.w + T
  if (stub) return [{ geo: worldBox(L, STUB_H, T, [0, STUB_H / 2, z]) }]
  // entrance opening at x = DOOR.x
  const a = DOOR.x - DOOR.w / 2
  const b = DOOR.x + DOOR.w / 2
  return [
    { geo: worldBox(a + L / 2, H, T, [(-L / 2 + a) / 2, H / 2, z]) },
    { geo: worldBox(L / 2 - b, H, T, [(b + L / 2) / 2, H / 2, z]) },
    { geo: worldBox(DOOR.w, H - DOOR.h, T, [DOOR.x, (H + DOOR.h) / 2, z]) }
  ]
}

const DOOR = { x: -3.6, w: 1.7, h: 2.5 }

/* ── wall dressing (kit-built, lives inside the wall's cut group) ──────── */

function windowsKit(k: Kit) {
  const z = -ROOM.d / 2
  for (const w of WINDOWS) {
    const h = HEAD_Y - SILL_Y
    const cy = (SILL_Y + HEAD_Y) / 2
    // outer frame
    k.box(LM.steel, w.x, HEAD_Y - 0.035, z, w.w, 0.07, 0.08)
    k.box(LM.steel, w.x, SILL_Y + 0.035, z, w.w, 0.07, 0.08)
    for (const sx of [-1, 1]) k.box(LM.steel, w.x + (sx * (w.w - 0.07)) / 2, cy, z, 0.07, h, 0.08)
    // crittall grid
    const nv = Math.max(2, Math.round(w.w / 0.62))
    for (let i = 1; i < nv; i++) k.box(LM.steel, w.x - w.w / 2 + (i * w.w) / nv, cy, z, 0.032, h, 0.05)
    for (const f of [0.34, 0.68]) k.box(LM.steel, w.x, SILL_Y + h * f, z, w.w, 0.032, 0.05)
    k.box(LM.steel, w.x, SILL_Y + h * 0.84, z, w.w, 0.045, 0.06) // transom
    k.box(LM.windowGlass, w.x, cy, z, w.w - 0.1, h - 0.1, 0.006, { cast: false })
    // deep concrete sill + a cast-iron radiator beneath
    k.box(LM.concrete, w.x, SILL_Y - 0.015, z + T / 2 + 0.05, w.w + 0.16, 0.05, 0.22)
    const rw = w.w * 0.7
    const fins = Math.floor(rw / 0.075)
    for (let i = 0; i < fins; i++) {
      k.box(radiator, w.x - rw / 2 + i * 0.075 + 0.035, 0.27, z + T / 2 + 0.1, 0.05, 0.34, 0.1)
    }
    k.box(radiator, w.x, 0.12, z + T / 2 + 0.1, rw, 0.03, 0.06)
    k.cyl(LM.steel, w.x - rw / 2 - 0.05, 0.15, z + T / 2 + 0.1, 0.012, 0.3, { cast: false })
  }
  // sill plants
  smallPlant(k, WINDOWS[0].x - 1.1, SILL_Y + 0.01, z + T / 2 + 0.06, 3, true)
  smallPlant(k, WINDOWS[0].x + 0.9, SILL_Y + 0.01, z + T / 2 + 0.06, 8)
  smallPlant(k, WINDOWS[1].x + 1.3, SILL_Y + 0.01, z + T / 2 + 0.06, 5)
  smallPlant(k, WINDOWS[2].x - 1.2, SILL_Y + 0.01, z + T / 2 + 0.06, 13, true)
  // industrial wall clock on the left pier, warm neon on the right pier
  const zf = z + T / 2
  const pierL = (WINDOWS[0].x + WINDOWS[0].w / 2 + WINDOWS[1].x - WINDOWS[1].w / 2) / 2
  k.cyl(LM.steel, pierL, 2.25, zf + 0.03, 0.27, 0.05, { rx: Math.PI / 2 })
  k.cyl(LM.cream, pierL, 2.25, zf + 0.056, 0.24, 0.004, { rx: Math.PI / 2, cast: false })
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    k.box(LM.steel, pierL + Math.sin(a) * 0.2, 2.25 + Math.cos(a) * 0.2, zf + 0.06, 0.012, 0.035, 0.004, { rz: -a, cast: false })
  }
  k.box(LM.steel, pierL + 0.05, 2.28, zf + 0.064, 0.014, 0.13, 0.004, { rz: -1.05, cast: false })
  k.box(LM.steel, pierL - 0.04, 2.3, zf + 0.066, 0.01, 0.18, 0.004, { rz: 0.6, cast: false })
  const pierR = (WINDOWS[1].x + WINDOWS[1].w / 2 + WINDOWS[2].x - WINDOWS[2].w / 2) / 2
  k.box(LM.steelSoft, pierR, 2.3, zf + 0.012, 1.36, 0.46, 0.012, { cast: false })
  k.mesh(LG.planeV, neon, pierR, 2.3, zf + 0.03, { s: [1.3, 0.41, 1], cast: false })
  // spiral duct along the top of the back wall
  const dz = IN.z0 + 0.3
  k.mesh(LG.cyl, duct, 0, 3.0, dz, { rz: Math.PI / 2, s: [0.34, ROOM.w - 0.6, 0.34] })
  for (let x = -7; x <= 7; x += 1.4) {
    k.mesh(LG.torus, duct, x, 3.0, dz, { ry: Math.PI / 2, s: [0.37, 0.37, 0.5] })
    k.box(LM.steel, x, 3.26, dz, 0.03, 0.2, 0.03, { cast: false })
  }
  // diffuser drops toward the room
  for (const x of [-4.7, -0.2, 4.9]) {
    k.box(duct, x, 2.8, dz + 0.18, 0.4, 0.12, 0.16)
    k.box(LM.steelSoft, x, 2.8, dz + 0.265, 0.36, 0.08, 0.01, { cast: false })
  }
}

function leftWallKit(k: Kit) {
  const x = IN.x0
  // kitchen backsplash (subway tile) + open oak shelves
  const kz = KITCHEN.z - 0.35
  k.box(LM.tile, x + 0.01, 1.2, kz, 0.02, 0.6, 2.3)
  for (let r = 1; r < 6; r++) k.box(LM.grout, x + 0.022, 0.9 + r * 0.1, kz, 0.002, 0.006, 2.28, { cast: false })
  for (let c = -11; c <= 11; c++) k.box(LM.grout, x + 0.022, 1.2, kz + c * 0.1, 0.002, 0.58, 0.006, { cast: false })
  for (const y of [1.72, 2.12]) {
    k.box(LM.oak, x + 0.14, y, kz, 0.26, 0.04, 2.0)
    for (const dz of [-0.8, 0.8]) k.box(LM.brass, x + 0.03, y - 0.06, kz + dz, 0.04, 0.1, 0.02)
  }
  for (let i = 0; i < 6; i++) k.cyl(LM.ceramic, x + 0.14, 1.78, kz - 0.8 + i * 0.12, 0.035, 0.09, { color: ['#efe9df', '#2f3136', '#b8674a', '#8ea184'][i % 4] })
  for (let i = 0; i < 4; i++) k.cyl(LM.glass, x + 0.14, 2.2, kz + 0.2 + i * 0.16, 0.05, 0.14)
  smallPlant(k, x + 0.14, 1.74, kz + 0.55, 17, true)
  smallPlant(k, x + 0.14, 2.14, kz - 0.7, 19, true)
  // lounge gallery wall over the sofa
  const gz = LOUNGE.sofa.z
  const frames: [number, number, number, number, number][] = [
    // z, y, w, h, art
    [gz - 0.62, 1.55, 0.62, 0.78, 0],
    [gz + 0.2, 1.72, 0.78, 0.98, 1],
    [gz + 0.95, 1.5, 0.5, 0.64, 2]
  ]
  for (const [z, y, w, h, a] of frames) {
    k.box(LM.walnut, x + 0.02, y, z, 0.035, h, w)
    k.box(LM.paper, x + 0.04, y, z, 0.004, h - 0.06, w - 0.06, { cast: false })
    k.mesh(LG.planeV, artMats[a], x + 0.043, y, z, { ry: Math.PI / 2, s: [w - 0.14, h - 0.14, 1], cast: false })
  }
  // brass sconces flanking the gallery
  for (const dz of [-1.25, 1.55]) {
    k.box(LM.brass, x + 0.03, 1.9, gz + dz, 0.02, 0.14, 0.08)
    k.cyl(LM.brass, x + 0.1, 1.95, gz + dz, 0.008, 0.14, { rz: Math.PI / 2 })
    k.mesh(LG.cone, LM.linen, x + 0.17, 2.0, gz + dz, { s: [0.14, 0.13, 0.14] })
    k.sphere(LM.bulbWarm, x + 0.17, 1.97, gz + dz, 0.025, { cast: false })
  }
  // duct along the left wall top
  const dx = IN.x0 + 0.3
  k.mesh(LG.cyl, duct, dx, 3.0, 0, { rx: Math.PI / 2, s: [0.3, ROOM.d - 1.2, 0.3] })
  for (let z = -4; z <= 4; z += 1.4) k.mesh(LG.torus, duct, dx, 3.0, z, { s: [0.33, 0.33, 0.5] })
  baseboard(k, 'x', x, -ROOM.d / 2 + T, ROOM.d / 2 - T)
}

function rightWallKit(k: Kit) {
  const x = IN.x1
  // big whiteboard behind the standing desks
  const zc = (WORKSTATION_PODS[16].z + WORKSTATION_PODS[17].z) / 2
  k.box(LM.aluminium, x - 0.02, 1.55, zc, 0.03, 1.2, 2.6)
  k.box(whiteboard, x - 0.036, 1.55, zc, 0.004, 1.12, 2.52, { cast: false })
  const marks: [number, number, number, string][] = [
    [-0.9, 1.9, 0.7, '#2f5fa8'],
    [-0.9, 1.78, 0.5, '#2f3136'],
    [-0.9, 1.66, 0.6, '#2f3136'],
    [0.2, 1.95, 0.4, '#b8674a'],
    [0.2, 1.4, 0.9, '#2f3136'],
    [0.2, 1.28, 0.6, '#2f3136'],
    [-0.5, 1.2, 0.8, '#3f7d4f']
  ]
  for (const [dz, y, w, c] of marks) k.box(LM.paint, x - 0.04, y, zc + dz + w / 2, 0.002, 0.018, w, { color: c, cast: false })
  for (let i = 0; i < 5; i++) k.box(LM.paint, x - 0.04, 1.62 - (i % 2) * 0.13, zc + 0.95 + Math.floor(i / 2) * 0.13, 0.002, 0.1, 0.1, { color: ['#ffd166', '#ef8fa3', '#7fb2e5'][i % 3], cast: false })
  k.box(LM.aluminium, x - 0.06, 0.93, zc, 0.07, 0.02, 2.4)
  // meeting-room art
  k.box(LM.walnut, x - 0.02, 1.6, -3.9, 0.035, 0.9, 0.7)
  k.mesh(LG.planeV, artMats[3], x - 0.04, 1.6, -3.9, { ry: -Math.PI / 2, s: [0.6, 0.8, 1], cast: false })
  // nook art
  k.box(LM.walnut, x - 0.02, 1.6, NOOK.z + 0.2, 0.035, 0.7, 0.9)
  k.mesh(LG.planeV, artMats[4], x - 0.04, 1.6, NOOK.z + 0.2, { ry: -Math.PI / 2, s: [0.8, 0.6, 1], cast: false })
  baseboard(k, 'x', x, -ROOM.d / 2 + T, ROOM.d / 2 - T)
}

function frontWallKit(k: Kit) {
  const z = IN.z1
  // steel-and-glass entrance doors
  const { x, w, h } = DOOR
  k.box(LM.steel, x, h - 0.03, z, w, 0.06, T + 0.02)
  for (const sx of [-1, 1]) k.box(LM.steel, x + (sx * (w - 0.06)) / 2, h / 2, z, 0.06, h, T + 0.02)
  k.box(LM.steel, x, h / 2, z, 0.04, h, 0.06)
  for (const sx of [-1, 1]) {
    const cx = x + (sx * w) / 4
    k.box(LM.glass, cx, h / 2, z + T / 2, w / 2 - 0.08, h - 0.1, 0.01, { cast: false })
    for (const f of [0.33, 0.66]) k.box(LM.steel, cx, h * f, z + T / 2, w / 2 - 0.08, 0.025, 0.03)
    k.box(LM.brass, x + sx * 0.08, 1.05, z - 0.04, 0.02, 0.5, 0.02)
  }
  // coat rail + hooks, doormat
  k.box(LM.oak, -5.9, 1.7, z - 0.03, 1.2, 0.08, 0.04)
  for (let i = 0; i < 5; i++) k.box(LM.brass, -6.4 + i * 0.25, 1.66, z - 0.07, 0.02, 0.02, 0.07)
  k.box(LM.paint, -6.15, 1.35, z - 0.1, 0.34, 0.5, 0.1, { color: '#b8674a' })
  k.box(LM.paint, -5.6, 1.4, z - 0.1, 0.3, 0.42, 0.08, { color: '#3d4a5c' })
  k.box(LM.deskPad, x, 0.006, z - 0.55, 1.4, 0.012, 0.8, { cast: false })
  // front art
  k.box(LM.walnut, 1.6, 1.7, z - 0.02, 1.1, 0.8, 0.035)
  k.mesh(LG.planeV, artMats[5], 1.6, 1.7, z - 0.04, { ry: Math.PI, s: [1.0, 0.7, 1], cast: false })
  baseboard(k, 'z', z, -ROOM.w / 2 + T, DOOR.x - DOOR.w / 2)
  baseboard(k, 'z', z, DOOR.x + DOOR.w / 2, ROOM.w / 2 - T)
}

function baseboard(k: Kit, axis: 'x' | 'z', at: number, from: number, to: number) {
  const len = to - from
  const mid = (from + to) / 2
  const inward = axis === 'x' ? -Math.sign(at) : -Math.sign(at)
  if (axis === 'x') k.box(LM.baseboard, at + inward * 0.012, 0.05, mid, 0.024, 0.1, len, { cast: false })
  else k.box(LM.baseboard, mid, 0.05, at + inward * 0.012, len, 0.1, 0.024, { cast: false })
}

/* ── cutaway wall ──────────────────────────────────────────────────────── */

interface WallDef {
  /** a point on the wall plane + the inward normal (x,z) */
  px: number
  pz: number
  nx: number
  nz: number
  mats: FaceMats
  full: Seg[]
  stub: Seg[]
  dressing: (k: Kit) => void
}

function CutWall({ def, extra }: { def: WallDef; extra?: ReactNode }) {
  const fullRef = useRef<THREE.Group>(null)
  const stubRef = useRef<THREE.Group>(null)
  const dressing = useMemo(() => {
    const k = new Kit()
    def.dressing(k)
    return k.build()
  }, [def])
  const stubMats = useMemo<FaceMats>(() => [def.mats[0], def.mats[1], LM.wallCut, def.mats[3], def.mats[4], def.mats[5]], [def])

  useFrame(({ camera }) => {
    const f = fullRef.current
    const s = stubRef.current
    if (!f || !s) return
    const d = (camera.position.x - def.px) * def.nx + (camera.position.z - def.pz) * def.nz
    const show = d > CUT_MARGIN
    if (f.visible !== show) {
      f.visible = show
      s.visible = !show
    }
  })

  return (
    <>
      <group ref={fullRef}>
        {def.full.map((s, i) => (
          <mesh key={i} geometry={s.geo} material={def.mats} receiveShadow />
        ))}
        {/* dark section cap along the wall top — the "cut" edge */}
        <BatchView groups={dressing} />
        {extra}
      </group>
      <group ref={stubRef} visible={false}>
        {def.stub.map((s, i) => (
          <mesh key={i} geometry={s.geo} material={stubMats} receiveShadow />
        ))}
      </group>
    </>
  )
}

/* ── shadow proxies (always cast, never draw) ─────────────────────────── */

const proxySegs: THREE.BufferGeometry[] = [
  ...backSegs(false).map((s) => s.geo),
  ...sideSegs(-1, false).map((s) => s.geo),
  ...sideSegs(1, false).map((s) => s.geo),
  ...frontSegs(false).map((s) => s.geo),
  new THREE.BoxGeometry(ROOM.w + T * 2, 0.2, ROOM.d + T * 2).translate(0, H + 0.1, 0)
]

/* ── rugs ──────────────────────────────────────────────────────────────── */

const RUGS: { kind: RugKind; x: number; z: number; w: number; d: number; ry?: number }[] = [
  { kind: 'lounge', x: LOUNGE.rug.x, z: LOUNGE.rug.z, w: LOUNGE.rug.w, d: LOUNGE.rug.d },
  { kind: 'nook', x: NOOK.x, z: NOOK.z + 0.1, w: 2.9, d: 1.9 },
  { kind: 'runner', x: (KITCHEN.x + 0.31 + ISLAND.x - 0.42) / 2, z: KITCHEN.z - 0.2, w: 0.55, d: 2.1 },
  ...PODS.map(([x, z]) => ({ kind: 'pod' as const, x, z, w: 3.5, d: 3.3 }))
]

/* ── sun shafts — additive sheets from each window head down to its floor
 * patch, leaning with the sun. Fade toward the floor (shaftTex). ── */
const SUN_DIR = new THREE.Vector3(4.5, -7.2, 11.5).normalize()
const shaftGeos = WINDOWS.map((w) => {
  const z0 = -ROOM.d / 2
  const t = HEAD_Y / -SUN_DIR.y
  const dx = SUN_DIR.x * t
  const dz = SUN_DIR.z * t
  const g = new THREE.BufferGeometry()
  const xa = w.x - w.w / 2 + 0.05
  const xb = w.x + w.w / 2 - 0.05
  // top edge at the window head, bottom edge where its light lands
  const pos = new Float32Array([
    xa, HEAD_Y - 0.05, z0, xb, HEAD_Y - 0.05, z0,
    xa + dx, 0.02, z0 + dz, xb + dx, 0.02, z0 + dz
  ])
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
})

function SunShafts() {
  return (
    <>
      {shaftGeos.map((g, i) => (
        <mesh key={i} geometry={g} material={shaft} renderOrder={2} />
      ))}
    </>
  )
}

/* ── the room ──────────────────────────────────────────────────────────── */

export const LoftRoom = memo(function LoftRoom({ onDeselect }: { onDeselect?: () => void }) {
  const walls = useMemo<WallDef[]>(() => {
    const plasterIn = LM.plaster
    const cut = LM.wallCut
    return [
      {
        px: 0,
        pz: -ROOM.d / 2,
        nx: 0,
        nz: 1,
        mats: [LM.brick, LM.brick, cut, LM.brick, LM.brick, exterior],
        full: backSegs(false),
        stub: backSegs(true),
        dressing: windowsKit
      },
      {
        px: -ROOM.w / 2,
        pz: 0,
        nx: 1,
        nz: 0,
        mats: [plasterIn, exterior, cut, plasterIn, plasterIn, plasterIn],
        full: sideSegs(-1, false),
        stub: sideSegs(-1, true),
        dressing: leftWallKit
      },
      {
        px: ROOM.w / 2,
        pz: 0,
        nx: -1,
        nz: 0,
        mats: [exterior, plasterIn, cut, plasterIn, plasterIn, plasterIn],
        full: sideSegs(1, false),
        stub: sideSegs(1, true),
        dressing: rightWallKit
      },
      {
        px: 0,
        pz: ROOM.d / 2,
        nx: 0,
        nz: -1,
        mats: [LM.brick, LM.brick, cut, LM.brick, exterior, LM.brick],
        full: frontSegs(false),
        stub: frontSegs(true),
        dressing: frontWallKit
      }
    ]
  }, [])

  return (
    <group>
      {/* soft ground shadow under the whole diorama */}
      <mesh geometry={LG.blob} material={LM.blob} position={[0.4, -0.37, 0.5]} scale={[ROOM.w * 1.5, 1, ROOM.d * 1.6]} />
      {/* diorama plinth + oak floor (click = deselect) */}
      <mesh position={[0, -0.18, 0]} material={LM.slabSide} receiveShadow>
        <boxGeometry args={[ROOM.w + T + 0.36, 0.36, ROOM.d + T + 0.36]} />
      </mesh>
      <mesh position={[0, -0.001, 0]} material={LM.slabCap}>
        <boxGeometry args={[ROOM.w + T + 0.37, 0.002, ROOM.d + T + 0.37]} />
      </mesh>
      <mesh
        geometry={LG.plane}
        material={LM.floor}
        scale={[ROOM.w, 1, ROOM.d]}
        position={[0, 0.001, 0]}
        receiveShadow
        onClick={(e) => {
          if (isClick(e)) onDeselect?.()
        }}
      />

      {RUGS.map((r, i) => (
        <mesh
          key={i}
          geometry={LG.box}
          material={rugMat(r.kind)}
          position={[r.x, 0.006, r.z]}
          rotation={[0, r.ry ?? 0, 0]}
          scale={[r.w, 0.01, r.d]}
          receiveShadow
        />
      ))}

      {/* city beyond the back windows — only visible through the openings */}
      <mesh
        geometry={LG.planeV}
        material={backdrop}
        position={[0, 1.05, -ROOM.d / 2 - 1.0]}
        scale={[ROOM.w + 1, 4.5, 1]}
      />

      {walls.map((w, i) => (
        <CutWall key={i} def={w} extra={i === 0 ? <SunShafts /> : undefined} />
      ))}

      {proxySegs.map((g, i) => (
        <mesh key={i} geometry={g} material={LM.shadowProxy} castShadow />
      ))}
    </group>
  )
})
