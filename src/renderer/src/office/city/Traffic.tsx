/* ── traffic ───────────────────────────────────────────────────────────
 * Low-poly vehicles on the main road: yellow cabs, sedans, SUVs, a
 * delivery van and an MTA-style city bus. Each vehicle is a recipe of
 * local parts (painted body, tapered glass cabin, roof panel, bumpers,
 * tires + hubs, head/tail lamps, taxi roof sign…); every part type is one
 * InstancedMesh shared by the whole fleet, so ~40 vehicles cost 8 draws.
 *
 * Moving traffic keeps right (eastbound on the camera side), each lane at
 * one steady speed so cars never overlap, wrapping at ±WRAP. Parked cars
 * line both curbs. Only the moving vehicles are rewritten per frame, and
 * the driver only mounts while `animated` — static mode is fully parked.
 */
import { useLayoutEffect, useMemo, useRef, type JSX, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { beveledBox, vehicleCab } from '../ModelGeometry'
import { tm } from './kit'

// ── part meshes ──────────────────────────────────────────────────────

type PartId = 'paint' | 'glass' | 'glassBox' | 'dark' | 'tire' | 'hub' | 'lamp' | 'blob'

const tireGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14)
tireGeo.rotateX(Math.PI / 2) // axle along z
const hubGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10)
hubGeo.rotateX(Math.PI / 2)
const blobGeo = new THREE.CircleGeometry(0.5, 20)
blobGeo.rotateX(-Math.PI / 2)

const PART_GEO: Record<PartId, THREE.BufferGeometry> = {
  paint: beveledBox(1, 1, 1, 0.14, 3),
  glass: vehicleCab(),
  glassBox: new THREE.BoxGeometry(1, 1, 1),
  dark: new THREE.BoxGeometry(1, 1, 1),
  tire: tireGeo,
  hub: hubGeo,
  lamp: new THREE.BoxGeometry(1, 1, 1),
  blob: blobGeo
}

const PART_MAT: Record<PartId, THREE.Material> = {
  paint: new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.32,
    metalness: 0.25,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.1
  }),
  glass: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.3 }),
  glassBox: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.3 }),
  dark: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, metalness: 0.1 }),
  tire: new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.9 }),
  hub: new THREE.MeshStandardMaterial({ color: '#c3c7cc', roughness: 0.35, metalness: 0.8 }),
  lamp: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
  blob: new THREE.MeshBasicMaterial({ color: '#0e0f12', transparent: true, opacity: 0.32, depthWrite: false })
}
const PART_IDS = Object.keys(PART_GEO) as PartId[]
const SHADOW_CASTERS: PartId[] = ['paint', 'glass', 'glassBox']

// ── vehicle recipes ──────────────────────────────────────────────────

type VehKind = 'sedan' | 'cab' | 'suv' | 'van' | 'bus'

interface Part {
  id: PartId
  m: THREE.Matrix4
  c: THREE.Color
}

const GLASS = '#1f2a33'
const HEAD = '#fff3d4'
const TAIL = '#e0321f'
const DARK = '#26282b'

function recipe(kind: VehKind, color: string): Part[] {
  const P: Part[] = []
  const add = (id: PartId, m: THREE.Matrix4, c: string) => P.push({ id, m, c: new THREE.Color(c) })
  const wheels = (L: number, W: number, r: number, xs: number[]) => {
    for (const x of xs)
      for (const s of [-1, 1]) {
        add('tire', tm(x, r, s * (W / 2 - 0.05), r * 2, r * 2, 0.1), '#ffffff')
        add('hub', tm(x, r, s * (W / 2 - 0.0), r * 1.1, r * 1.1, 0.02), '#ffffff')
      }
    add('blob', tm(0, 0.004, 0, L + 0.25, 1, W + 0.25), '#ffffff')
  }
  const lamps = (L: number, W: number, y: number, h = 0.05) => {
    for (const s of [-1, 1]) {
      add('lamp', tm(L / 2 + 0.004, y, s * (W / 2 - 0.1), 0.015, h, 0.11), HEAD)
      add('lamp', tm(-L / 2 - 0.004, y, s * (W / 2 - 0.09), 0.015, h, 0.09), TAIL)
    }
  }
  if (kind === 'sedan' || kind === 'cab') {
    const L = 1.32
    const W = 0.58
    add('paint', tm(0, 0.21, 0, L, 0.22, W), color)
    add('paint', tm(0.02, 0.26, 0, L * 0.98, 0.1, W * 0.96), color) // shoulder
    add('glass', tm(-0.08, 0.41, 0, 0.72, 0.2, W * 0.9), GLASS)
    add('paint', tm(-0.1, 0.515, 0, 0.5, 0.03, W * 0.72), color)
    for (const s of [-1, 1]) add('dark', tm(s * (L / 2 + 0.005), 0.14, 0, 0.04, 0.07, W - 0.06), DARK)
    add('dark', tm(L / 2 + 0.004, 0.22, 0, 0.012, 0.05, 0.22), '#3b3e42') // grille
    wheels(L, W, 0.105, [0.42, -0.42])
    lamps(L, W, 0.25)
    if (kind === 'cab') {
      add('dark', tm(0, 0.2, 0, L * 0.86, 0.035, W + 0.008), '#1c1d1f') // checker band
      add('lamp', tm(-0.08, 0.565, 0, 0.1, 0.06, 0.26), '#fff0bf') // roof sign
    }
  } else if (kind === 'suv') {
    const L = 1.46
    const W = 0.64
    add('paint', tm(0, 0.25, 0, L, 0.28, W), color)
    add('glass', tm(-0.12, 0.5, 0, 0.98, 0.23, W * 0.92), GLASS)
    add('paint', tm(-0.14, 0.625, 0, 0.82, 0.035, W * 0.8), color)
    for (const s of [-1, 1]) add('dark', tm(-0.14, 0.655, s * W * 0.34, 0.8, 0.025, 0.025), DARK) // roof rails
    for (const s of [-1, 1]) add('dark', tm(s * (L / 2 + 0.005), 0.16, 0, 0.05, 0.09, W - 0.06), DARK)
    add('dark', tm(0, 0.13, 0, L - 0.2, 0.05, W + 0.01), DARK) // cladding
    wheels(L, W, 0.12, [0.46, -0.46])
    lamps(L, W, 0.31)
  } else if (kind === 'van') {
    const L = 1.56
    const W = 0.64
    add('paint', tm(-0.1, 0.4, 0, L - 0.2, 0.6, W), color)
    add('paint', tm(L / 2 - 0.16, 0.25, 0, 0.3, 0.3, W * 0.96), color) // hood
    add('glassBox', tm(L / 2 - 0.22, 0.52, 0, 0.16, 0.22, W * 0.9), GLASS)
    add('glassBox', tm(0.42, 0.52, 0, 0.3, 0.18, W + 0.006), GLASS)
    add('paint', tm(-0.25, 0.36, 0, 0.9, 0.1, W + 0.008), '#d8452f') // livery stripe
    for (const s of [-1, 1]) add('dark', tm(s * (L / 2 + 0.005), 0.14, 0, 0.05, 0.08, W - 0.06), DARK)
    wheels(L, W, 0.115, [0.5, -0.5])
    lamps(L, W, 0.3)
  } else {
    // bus
    const L = 3.3
    const W = 0.8
    add('paint', tm(0, 0.53, 0, L, 0.84, W), color)
    add('paint', tm(0, 0.3, 0, L + 0.006, 0.09, W + 0.008), '#2458a8') // MTA blue band
    add('glassBox', tm(-0.1, 0.7, 0, L - 0.5, 0.26, W + 0.008), GLASS)
    add('glassBox', tm(L / 2 + 0.003, 0.64, 0, 0.02, 0.4, W - 0.12), GLASS)
    add('lamp', tm(L / 2 + 0.012, 0.89, 0, 0.012, 0.07, 0.42), '#ffb347') // destination sign
    add('paint', tm(-0.2, 1.0, 0, 1.0, 0.1, 0.56), '#d9dcdf') // roof HVAC
    for (const s of [-1, 1]) add('dark', tm(s * (L / 2 + 0.005), 0.16, 0, 0.05, 0.1, W - 0.06), DARK)
    for (let i = 0; i < 6; i++) add('dark', tm(-L / 2 + 0.5 + i * 0.44, 0.7, W / 2 + 0.006, 0.03, 0.26, 0.004), '#dfe2e4')
    wheels(L, W, 0.14, [1.05, -1.05])
    lamps(L, W, 0.25, 0.07)
  }
  return P
}

// ── fleet ────────────────────────────────────────────────────────────

interface Vehicle {
  kind: VehKind
  color: string
  z: number
  dir: 1 | -1
  x0: number
  speed: number // 0 = parked
}

const SEDANS = ['#b83a36', '#2f4f7a', '#d9d6ce', '#2b2d31', '#6f7f86', '#8a2b3a', '#3c6b5a', '#c9a24f', '#e8e4dc', '#4a5a6e']
const SUVS = ['#1f2124', '#e6e3dc', '#3d5446', '#5b6a78', '#7a2d2a']
const CAB = '#f2b91e'
const WRAP = 75

const LANES: { z: number; dir: 1 | -1; speed: number; fleet: VehKind[] }[] = [
  { z: 0.8, dir: 1, speed: 3.2, fleet: ['cab', 'sedan', 'suv', 'cab', 'sedan', 'sedan'] },
  { z: 2.0, dir: 1, speed: 2.5, fleet: ['sedan', 'van', 'cab', 'suv', 'sedan'] },
  { z: -0.8, dir: -1, speed: 3.0, fleet: ['sedan', 'cab', 'suv', 'sedan', 'cab', 'sedan'] },
  { z: -2.0, dir: -1, speed: 2.1, fleet: ['bus', 'sedan', 'cab', 'suv'] }
]

function buildFleet(): Vehicle[] {
  const V: Vehicle[] = []
  let n = 0
  const colorFor = (k: VehKind) =>
    k === 'cab' ? CAB : k === 'suv' ? SUVS[n % SUVS.length] : k === 'van' ? '#eeeeea' : k === 'bus' ? '#e9ecee' : SEDANS[(n * 7) % SEDANS.length]
  LANES.forEach((ln, li) => {
    const gap = (2 * WRAP) / ln.fleet.length
    ln.fleet.forEach((k, i) => {
      V.push({ kind: k, color: colorFor(k), z: ln.z, dir: ln.dir, x0: -WRAP + i * gap + li * 4.3, speed: ln.speed })
      n++
    })
  })
  // parked along both curbs (clear of hydrants, crosswalks, bus stop)
  const near = [-17.6, -15.8, -9.6, -7.8, 4.4, 6.3, 12.2, 14.0, 17.8, 35.2, 37.1, -30.4, -32.3, -39.5]
  const far = [-17.0, -13.4, -11.6, -8.4, 17.2, 19.0, 21.2, 33.6, 35.6, -29.6, -34.0, 43.0]
  near.forEach((x, i) => {
    const k: VehKind = i % 5 === 3 ? 'suv' : i % 7 === 5 ? 'van' : 'sedan'
    V.push({ kind: k, color: k === 'van' ? '#eeeeea' : k === 'suv' ? SUVS[(i + 2) % SUVS.length] : SEDANS[(i * 3 + 1) % SEDANS.length], z: 3.02, dir: 1, x0: x, speed: 0 })
  })
  far.forEach((x, i) => {
    const k: VehKind = i % 4 === 1 ? 'suv' : i === 6 ? 'cab' : 'sedan'
    V.push({ kind: k, color: k === 'cab' ? CAB : k === 'suv' ? SUVS[i % SUVS.length] : SEDANS[(i * 5 + 4) % SEDANS.length], z: -3.02, dir: -1, x0: x, speed: 0 })
  })
  return V
}

interface Slot {
  id: PartId
  idx: number
  local: THREE.Matrix4
}

interface FleetData {
  vehicles: Vehicle[]
  slots: Slot[][] // per vehicle
  counts: Record<PartId, number>
  colors: Record<PartId, THREE.Color[]>
}

function layoutFleet(): FleetData {
  const vehicles = buildFleet()
  const counts = Object.fromEntries(PART_IDS.map((p) => [p, 0])) as Record<PartId, number>
  const colors = Object.fromEntries(PART_IDS.map((p) => [p, [] as THREE.Color[]])) as Record<PartId, THREE.Color[]>
  const slots = vehicles.map((v) =>
    recipe(v.kind, v.color).map((p) => {
      colors[p.id].push(p.c)
      return { id: p.id, idx: counts[p.id]++, local: p.m }
    })
  )
  return { vehicles, slots, counts, colors }
}

const wrapX = (x: number) => ((((x + WRAP) % (2 * WRAP)) + 2 * WRAP) % (2 * WRAP)) - WRAP

// frame-loop scratch — zero per-frame allocation
const _car = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _one = new THREE.Vector3(1, 1, 1)
const _up = new THREE.Vector3(0, 1, 0)

type MeshRefs = Record<PartId, RefObject<THREE.InstancedMesh | null>>

function writeVehicle(data: FleetData, refs: MeshRefs, i: number, x: number): void {
  const v = data.vehicles[i]
  _pos.set(x, 0, v.z)
  _q.setFromAxisAngle(_up, v.dir > 0 ? 0 : Math.PI)
  _car.compose(_pos, _q, _one)
  for (const s of data.slots[i]) {
    const mesh = refs[s.id].current
    if (!mesh) continue
    _m.multiplyMatrices(_car, s.local)
    mesh.setMatrixAt(s.idx, _m)
  }
}

function Driver({ data, refs }: { data: FleetData; refs: MeshRefs }): null {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    for (let i = 0; i < data.vehicles.length; i++) {
      const v = data.vehicles[i]
      if (!v.speed) continue
      writeVehicle(data, refs, i, wrapX(v.x0 + v.dir * v.speed * t))
    }
    for (const id of PART_IDS) {
      const m = refs[id].current
      if (m) m.instanceMatrix.needsUpdate = true
    }
  })
  return null
}

/** the main road's traffic — parked when `animated` is false */
export function Traffic({ animated = true }: { animated?: boolean }): JSX.Element {
  const data = useMemo(layoutFleet, [])
  const paint = useRef<THREE.InstancedMesh>(null)
  const glass = useRef<THREE.InstancedMesh>(null)
  const glassBox = useRef<THREE.InstancedMesh>(null)
  const dark = useRef<THREE.InstancedMesh>(null)
  const tire = useRef<THREE.InstancedMesh>(null)
  const hub = useRef<THREE.InstancedMesh>(null)
  const lamp = useRef<THREE.InstancedMesh>(null)
  const blob = useRef<THREE.InstancedMesh>(null)
  const refs: MeshRefs = { paint, glass, glassBox, dark, tire, hub, lamp, blob }

  useLayoutEffect(() => {
    for (let i = 0; i < data.vehicles.length; i++) writeVehicle(data, refs, i, data.vehicles[i].x0)
    for (const id of PART_IDS) {
      const m = refs[id].current
      if (!m) continue
      data.colors[id].forEach((c, k) => m.setColorAt(k, c))
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  return (
    <group>
      {PART_IDS.map((id) => (
        <instancedMesh
          key={id}
          ref={refs[id]}
          args={[PART_GEO[id], PART_MAT[id], data.counts[id]]}
          frustumCulled={false}
          castShadow={SHADOW_CASTERS.includes(id)}
          receiveShadow={id === 'paint'}
        />
      ))}
      {animated && <Driver data={data} refs={refs} />}
    </group>
  )
}
