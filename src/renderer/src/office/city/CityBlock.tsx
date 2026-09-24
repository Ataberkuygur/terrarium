/* ── city block ─────────────────────────────────────────────────────────────
 * Everything around the HQ tower: a golden-hour NYC block at miniature-
 * diorama scale.
 *
 *   ground     warm paved city slab + grainy asphalt main road and two
 *              cross avenues that open depth vistas left and right
 *   street     curbs, jointed sidewalks, lane paint, zebras, bus lane,
 *              manholes, trees in iron pits, lanterns, signals, hydrants
 *   hero row   the HQ's neighbours on the far sidewalk — a brownstone
 *              row with stoops, an art-deco setback tower, brick walk-ups
 *              with fire escapes and water towers, a corner glass tower
 *   park       pocket park with fountain, beds, kiosk, grove (park.ts)
 *   rows       three receding rows of procedurally varied buildings
 *              (height-capped so nothing out-shouts the HQ), then hazy
 *              silhouettes that melt into the horizon fog
 *   traffic    cabs, sedans, SUVs, a van and a city bus (Traffic.tsx)
 *
 * All static geometry funnels into two Batches (near block with shadows,
 * far skyline without) — a couple of dozen instanced draws in total. The
 * only per-frame work is the traffic driver and the fountain water, both
 * mounted only while `animated`.
 */
import { useCallback, useMemo, useRef, type JSX, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Batch, BatchMeshes, KIT_MAT, h01, pick, tm } from './kit'
import { CITY, CITY_COLORS } from './layout'
import { brownstone, deco, fillRow, glassTower, modern, prewar, walkup, PAL, waterTower } from './buildings'
import { AVENUES, LAMP_SPOTS, LIM, WALK_OUT, bench, buildPlazas, buildStreet, hazeColor, lantern, tree } from './street'
import { FOUNTAIN, buildPark } from './park'
import { Traffic } from './Traffic'

const C = CITY_COLORS
const AW = CITY.avenueW / 2
const AWALK = CITY.avenueWalk
/* building-lot limits either side of each avenue (sidewalk outer edges) */
const AV_W0 = CITY.avenueWX - AW - 0.16 - AWALK // west avenue, west lot line
const AV_W1 = CITY.avenueWX + AW + 0.16 + AWALK // west avenue, east lot line
const AV_E0 = CITY.avenueEX - AW - 0.16 - AWALK
const AV_E1 = CITY.avenueEX + AW + 0.16 + AWALK
const ZF = -WALK_OUT - 0.02 // far-side building line

// ── static block ─────────────────────────────────────────────────────

function buildBlock(): Batch {
  const B = new Batch()
  LAMP_SPOTS.length = 0 // rebuilt with the street (HMR-safe)
  buildStreet(B)
  buildPlazas(B)
  buildPark(B)

  // ── hero row east of the HQ: brownstones → deco tower → walk-up ──
  const bsColors = ['#7a4e3c', '#9c6a50', '#6e4637', '#b4876a']
  const bsFloors = [4, 4, 5, 4]
  for (let i = 0; i < 4; i++) {
    const x0 = 5.5 + i * 2.12
    brownstone(B, { x0, x1: x0 + 2.1, z0: ZF - 7, z1: ZF, street: 's', seed: `bs${i}`, open: i === 0 ? ['w'] : [] }, bsFloors[i], bsColors[i])
  }
  deco(B, { x0: 14.1, x1: 20.3, z0: ZF - 7.2, z1: ZF - 0.2, street: 's', open: ['w', 'e'], seed: 'deco' }, [3.8, 1.5, 1.0], { spire: 1.2, stone: '#c7ad86', spandrel: '#4a3b30' })
  walkup(B, { x0: 20.45, x1: AV_E0 - 0.05, z0: ZF - 7, z1: ZF, street: 's', open: ['e'], seed: 'wuE' }, 5, { color: '#a24f3a', tower: true })

  // ── west of the avenue: corner pre-war, walk-ups, brownstones, glass ──
  prewar(B, { x0: AV_W0 - 6.6, x1: AV_W0 - 0.05, z0: ZF - 7.5, z1: ZF, street: 's', open: ['e'], seed: 'pwW' }, 7, { store: true, color: '#b8875a' })
  walkup(B, { x0: AV_W0 - 10.2, x1: AV_W0 - 6.7, z0: ZF - 7, z1: ZF, street: 's', seed: 'wuW1' }, 4, { color: '#9a4a36' })
  walkup(B, { x0: AV_W0 - 13.3, x1: AV_W0 - 10.3, z0: ZF - 7, z1: ZF, street: 's', seed: 'wuW2' }, 5, { color: '#c29a6b' })
  for (let i = 0; i < 2; i++) {
    const x1 = AV_W0 - 13.4 - i * 2.12
    brownstone(B, { x0: x1 - 2.1, x1, z0: ZF - 7, z1: ZF, street: 's', seed: `bsW${i}` }, 4)
  }
  glassTower(B, { x0: AV_W0 - 24.6, x1: AV_W0 - 17.8, z0: ZF - 7.5, z1: ZF, street: 's', open: ['e'], seed: 'glW' }, 11)
  fillRow(B, -LIM + 60, AV_W0 - 24.7, ZF, 7, 's', 9, 'rowW', 1)

  // ── east of the avenue: glass corner tower, pre-war, walk-ups ──
  glassTower(B, { x0: AV_E1 + 0.05, x1: AV_E1 + 6.4, z0: ZF - 7.5, z1: ZF, street: 's', open: ['w'], seed: 'glE' }, 11.5, { tint: '#3f6f7c' })
  prewar(B, { x0: AV_E1 + 6.5, x1: AV_E1 + 11.6, z0: ZF - 7, z1: ZF, street: 's', seed: 'pwE' }, 6, { store: true })
  walkup(B, { x0: AV_E1 + 11.7, x1: AV_E1 + 14.7, z0: ZF - 7, z1: ZF, street: 's', seed: 'wuE1' }, 5, { color: '#b0603f' })
  walkup(B, { x0: AV_E1 + 14.8, x1: AV_E1 + 18, z0: ZF - 7, z1: ZF, street: 's', seed: 'wuE2' }, 4, { color: '#c9a57a' })
  modern(B, { x0: AV_E1 + 18.1, x1: AV_E1 + 23.5, z0: ZF - 7, z1: ZF, street: 's', seed: 'moE' }, 5)
  fillRow(B, AV_E1 + 23.6, LIM - 60, ZF, 7, 's', 9, 'rowE', 1)

  // ── backyards between the hero row and row two: lawns, trees, fences ──
  for (const [x0, x1] of [
    [5.5, AV_E0 - 0.2],
    [-LIM + 75, AV_W0 - 0.2],
    [AV_E1 + 0.2, LIM - 75]
  ] as [number, number][]) {
    const zb = ZF - 7.4
    const zc = -19.4 + 0.2
    B.box('flat', (x0 + x1) / 2, 0.02, (zb + zc) / 2, x1 - x0, 0.04, zb - zc, '#7f8f5c')
    for (let x = x0 + 2.1; x < x1 - 0.5; x += 2.1) B.box('solid', x, 0.3, (zb + zc) / 2, 0.05, 0.6, zb - zc, '#8a6b4c')
    for (let i = 0; x0 + 1 + i * 3.1 < x1 - 1; i++) {
      if (h01('by', i + Math.round(x0)) < 0.35) continue
      tree(B, x0 + 1 + i * 3.1 + h01('byx', i) * 0.8, 0.04, zc + 1.4 + h01('byz', i) * 2.4, 0.95 + h01('bys', i) * 0.35, `by${Math.round(x0)}${i}`, h01('byt', i) < 0.2 ? 'tall' : 'round')
    }
  }

  // ── second row: faces the park + peeks over the hero row ──
  const Z2 = -19.4
  fillRow(B, AV_W1 + 0.1, -6.6, Z2, 7, 's', 8.6, 'r2park', 0, ['prewar', 'walkup', 'modern', 'prewar', 'brownstone', 'walkup'], ['w'])
  fillRow(B, -6.5, 5.3, Z2, 7, 's', 8.5, 'r2hq', 1, ['modern', 'prewar'])
  fillRow(B, 5.4, AV_E0 - 0.1, Z2, 7, 's', 10, 'r2e', 0, ['prewar', 'walkup', 'glass', 'modern', 'prewar'], ['e'])
  fillRow(B, -LIM + 70, AV_W0 - 0.1, Z2, 7, 's', 10.5, 'r2w2', 1, undefined, ['e'])
  fillRow(B, AV_E1 + 0.1, LIM - 70, Z2, 7, 's', 10.5, 'r2e2', 1, undefined, ['w'])
  // ── third + fourth rows (simplified detail) ──
  for (const [z, hm, seed] of [
    [-29, 10, 'r3'],
    [-39.5, 11, 'r4']
  ] as [number, number, string][]) {
    fillRow(B, -LIM + 75, AV_W0 - 0.1, z, 8, 's', hm, `${seed}a`, 1, ['prewar', 'modern', 'glass', 'walkup', 'prewar'], ['e'])
    fillRow(B, AV_W1 + 0.1, AV_E0 - 0.1, z, 8, 's', hm, `${seed}b`, 1, ['prewar', 'modern', 'glass', 'prewar', 'deco'], ['w', 'e'])
    fillRow(B, AV_E1 + 0.1, LIM - 75, z, 8, 's', hm, `${seed}c`, 1, ['prewar', 'modern', 'glass', 'walkup', 'prewar'], ['w'])
  }

  // ── camera side, beyond the avenues (frames the edges when orbiting) ──
  fillRow(B, -LIM + 75, AV_W0 - 0.1, WALK_OUT + 0.02, 7, 'n', 8, 'nW', 1, undefined, ['s', 'e'])
  fillRow(B, AV_E1 + 0.1, LIM - 75, WALK_OUT + 0.02, 7, 'n', 8, 'nE', 1, undefined, ['s', 'w'])
  // ── camera side between the avenues: a promenade park ──
  // stone wall at the sidewalk, deep lawn, gravel promenade with lamps +
  // benches, and tree rows kept back from the camera's sightline so the
  // near curb stays visible
  const nx0 = AV_W1
  const nx1 = AV_E0
  const ncx = (nx0 + nx1) / 2
  const nw = nx1 - nx0
  const NZ0 = WALK_OUT
  const NZ1 = WALK_OUT + 22
  B.box('flat', ncx, 0.1, (NZ0 + NZ1) / 2, nw, 0.2, NZ1 - NZ0, C.grass)
  for (let x = nx0 + 0.6; x < nx1 - 1; x += 2.4) B.box('flat', x + 0.6, 0.201, (NZ0 + 0.4 + NZ1) / 2, 1.2, 0.002, NZ1 - NZ0 - 0.4, C.grassDark)
  B.box('solid', ncx, 0.16, NZ0 + 0.12, nw, 0.32, 0.22, '#bfb3a0')
  B.box('solid', ncx, 0.335, NZ0 + 0.12, nw + 0.04, 0.04, 0.28, '#d2c7b4')
  for (const [x, z] of [
    [nx0 + 0.11, (NZ0 + NZ1) / 2],
    [nx1 - 0.11, (NZ0 + NZ1) / 2]
  ])
    B.box('solid', x, 0.16, z, 0.22, 0.32, NZ1 - NZ0, '#bfb3a0')
  // promenade path + edging
  const PZ = NZ0 + 3.2
  B.box('flat', ncx, 0.205, PZ, nw - 0.6, 0.01, 1.5, C.path)
  for (const dz of [-0.78, 0.78]) B.box('flat', ncx, 0.21, PZ + dz, nw - 0.6, 0.02, 0.06, '#b9a98a')
  for (let x = nx0 + 2; x < nx1 - 1; x += 5.2) {
    lantern(B, x, 0.2, PZ - 0.95, 0.95)
    LAMP_SPOTS.push([x, PZ - 0.95, 0.8])
    bench(B, x + 2.6, 0.2, PZ + 1.05, Math.PI)
  }
  // clipped shrubs along the wall
  for (let i = 0; i < 18; i++) {
    const x = nx0 + 1.1 + i * ((nw - 2.2) / 17)
    const sz = 0.5 + h01('nps', i) * 0.25
    B.put('foliage', tm(x, 0.3 + sz * 0.3, NZ0 + 0.75, sz * 1.5, sz * 0.8, sz), pick(['#4f7a3a', '#5b8641', '#46703a'], 'np', i))
  }
  // tree rows: the first stays out of the centre sightline
  const rows: [number, number][] = [
    [NZ0 + 5.6, 9],
    [NZ0 + 9.2, 0],
    [NZ0 + 13.2, 0],
    [NZ0 + 17.4, 0]
  ]
  rows.forEach(([z, clear], r) => {
    for (let i = 0; nx0 + 1.4 + i * 3.6 < nx1 - 1; i++) {
      const x = nx0 + 1.4 + i * 3.6 + (r % 2) * 1.8 + (h01('ntx', r * 50 + i) - 0.5) * 0.9
      if (x > nx1 - 1 || Math.abs(x - 4) < clear) continue
      if (h01('ntk', r * 50 + i) < 0.2) continue
      const st = h01('nts', r * 50 + i)
      tree(B, x, 0.2, z + (h01('ntz', r * 50 + i) - 0.5) * 1.2, 1.1 + st * 0.35, `np${r}${i}`, st < 0.12 ? 'tall' : st > 0.9 ? 'amber' : st > 0.8 ? 'wide' : 'round')
    }
  })
  return B
}

// ── far skyline: silhouettes receding into the haze ──────────────────

function buildFar(): Batch {
  const B = new Batch()
  const camY = 11
  for (let ring = 0; ring < 5; ring++) {
    const zBase = -52 - ring * 22
    const n = 26 + ring * 4
    for (let i = 0; i < n; i++) {
      const k = ring * 97 + i
      const x = -140 + (i + h01('fx', k) * 0.6) * (280 / n)
      if (AVENUES.some((a) => Math.abs(x - a) < 4 + ring)) continue
      const z = zBase - h01('fz', k) * 12
      const D = Math.hypot(x - 5, z - 25)
      const center = Math.abs(x) < 24
      const cap = center ? 4 + D * 0.045 : 6 + D * 0.07
      const h = cap * (0.5 + h01('fh', k) * 0.5)
      const w = 4 + h01('fw', k) * 6
      const d = 4 + h01('fd', k) * 5
      const col = hazeColor('far', k).lerp(new THREE.Color('#c9b9ab'), ring * 0.12)
      B.box('solid', x, h / 2, z, w, h, d, col)
      const r = h01('fr', k)
      if (r < 0.35) {
        // setback + crown
        B.box('solid', x, h + h * 0.08, z, w * 0.66, h * 0.16, d * 0.66, col.clone().offsetHSL(0, 0, 0.03))
        if (r < 0.12) B.box('cone', x, h + h * 0.16 + 1.2, z, w * 0.3, 2.4, w * 0.3, col.clone().offsetHSL(0, 0, 0.05))
      } else if (r < 0.55) {
        waterTower(B, x + w * 0.2, h, z, 1.4)
      }
      // faint floor banding on the camera face so masses read as towers
      if (ring < 3) {
        const rows = Math.floor(h / 1.4)
        const band = col.clone().offsetHSL(0, 0, -0.035)
        for (let j = 1; j < rows; j++) B.box('solid', x, j * 1.4, z + d / 2 + 0.03, w * 0.86, 0.5, 0.05, band)
        if (h01('fwr', k) < 0.4) B.box('lit', x, Math.floor(rows * h01('fwy', k)) * 1.4 + 0.7, z + d / 2 + 0.06, w * 0.5, 0.2, 0.04, pick(PAL.lit, 'fl', k))
      }
    }
  }
  // two hazy Manhattan landmarks far off to the sides — pure flavour,
  // deep enough in the fog that they never compete with the HQ
  landmark(B, 78, -112, 'empire')
  landmark(B, -70, -118, 'chrysler')

  // side wings of the skyline for orbiting views (east / west of the rows)
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1
    const x = side * (80 + h01('sx', i) * 55)
    const z = 30 - (i / 26) * 110
    const h = 8 + h01('sh', i) * 14
    const w = 5 + h01('sw', i) * 6
    B.box('solid', x, h / 2, z, w, h, 5 + h01('sd', i) * 5, hazeColor('side', i))
  }
  return B
}

/** stepped-setback landmark silhouette (flat, fogged) */
function landmark(B: Batch, x: number, z: number, kind: 'empire' | 'chrysler'): void {
  const col = new THREE.Color('#8a8fa0')
  const tiers: [number, number, number][] =
    kind === 'empire'
      ? [
          [11, 7, 9],
          [8, 6, 8],
          [5.5, 4.5, 6],
          [3.4, 2.8, 3]
        ]
      : [
          [8, 7, 13],
          [6, 5.2, 5],
          [4.2, 4.2, 2]
        ]
  let y = 0
  tiers.forEach(([w, d, h], i) => {
    B.box('solid', x, y + h / 2, z, w, h, d, col.clone().offsetHSL(0, 0, i * 0.012))
    y += h
  })
  if (kind === 'empire') {
    B.box('cyl', x, y + 1.2, z, 1.8, 2.4, 1.8, col)
    B.box('cone', x, y + 5.2, z, 0.5, 5.6, 0.5, col)
  } else {
    // terraced crown: shrinking arched rings, then a needle
    for (let i = 0; i < 5; i++) B.box('cone', x, y + 0.9 + i * 1.1, z, 4 - i * 0.7, 1.8, 4 - i * 0.7, col.clone().offsetHSL(0, 0, 0.02))
    B.box('cone', x, y + 8, z, 0.35, 5, 0.35, col)
  }
}

let _block: Batch | null = null
let _far: Batch | null = null
const blockBatch = () => (_block ??= buildBlock())
const farBatch = () => (_far ??= buildFar())

// ── materials for the big slabs ──────────────────────────────────────

/* speckled asphalt/paving grain — one small canvas, cloned per surface
 * so each slab can carry its own world-scaled repeat */
let _grain: HTMLCanvasElement | null = null
function grainCanvas(): HTMLCanvasElement {
  if (_grain) return _grain
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#808080'
  g.fillRect(0, 0, 128, 128)
  let s = 7
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(96 + rnd() * 70)
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1 + Math.floor(rnd() * 2), 1)
  }
  _grain = c
  return c
}
function grainTex(rx: number, ry: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(grainCanvas())
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const ROAD_LEN = LIM * 2
const asphaltMain = new THREE.MeshStandardMaterial({
  color: '#6a6c73',
  map: grainTex(ROAD_LEN / 3, CITY.roadW / 3),
  roughness: 0.93
})
const asphaltAve = new THREE.MeshStandardMaterial({
  color: '#6a6c73',
  map: grainTex(CITY.avenueW / 3, LIM / 3),
  roughness: 0.93
})
const groundMat = new THREE.MeshStandardMaterial({
  color: '#aaa194',
  map: grainTex(CITY.groundW / 4, CITY.groundD / 4),
  roughness: 0.95
})
/* additive warm pool under each lamp — fake light, no bloom */
const poolMat = new THREE.MeshBasicMaterial({
  color: '#ffcf8a',
  transparent: true,
  opacity: 0.045,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const poolGeo = new THREE.CircleGeometry(1, 24)
poolGeo.rotateX(-Math.PI / 2)

function LampPools(): JSX.Element {
  const spots = LAMP_SPOTS
  const mats = useMemo(() => spots.map(([x, z, r], i) => tm(x, 0.09 + (i % 3) * 0.001, z, r, 1, r)), [spots])
  const bake = useCallback(
    (m: THREE.InstancedMesh | null) => {
      if (!m) return
      mats.forEach((M, i) => m.setMatrixAt(i, M))
      m.instanceMatrix.needsUpdate = true
      m.computeBoundingSphere()
    },
    [mats]
  )
  return (
    <instancedMesh
      ref={bake}
      args={[poolGeo, poolMat, Math.max(1, mats.length)]}
      renderOrder={2}
    />
  )
}

// ── fountain water ───────────────────────────────────────────────────

const jetMat = new THREE.MeshStandardMaterial({
  color: '#dff3ff',
  transparent: true,
  opacity: 0.55,
  roughness: 0.1,
  emissive: '#9fd4ee',
  emissiveIntensity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide
})
const rippleGeo = new THREE.RingGeometry(0.9, 1, 32)
rippleGeo.rotateX(-Math.PI / 2)
const rippleMats = [0, 1, 2].map(
  () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false })
)

function FountainMotion({ jet, ripples }: { jet: RefObject<THREE.Mesh | null>; ripples: RefObject<THREE.Group | null> }): null {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (jet.current) jet.current.scale.y = 1 + Math.sin(t * 5.3) * 0.06 + Math.sin(t * 8.1) * 0.03
    const g = ripples.current
    if (!g) return
    for (let i = 0; i < g.children.length; i++) {
      const k = (((t * 0.35 + i / g.children.length) % 1) + 1) % 1
      const s = 0.3 + k * 0.85
      g.children[i].scale.set(s, 1, s)
      rippleMats[i].opacity = 0.3 * (1 - k)
    }
  })
  return null
}

function Fountain({ animated }: { animated: boolean }): JSX.Element {
  const jet = useRef<THREE.Mesh>(null)
  const ripples = useRef<THREE.Group>(null)
  const fy = FOUNTAIN.y + 0.012
  return (
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      {/* basin water + upper bowl water */}
      <mesh position={[0, fy + 0.25, 0]} material={KIT_MAT.water}>
        <cylinderGeometry args={[1.14, 1.14, 0.03, 40]} />
      </mesh>
      <mesh position={[0, fy + 0.745, 0]} material={KIT_MAT.water}>
        <cylinderGeometry args={[0.5, 0.5, 0.02, 28]} />
      </mesh>
      {/* central jet + falling sheet into the basin */}
      <mesh ref={jet} position={[0, fy + 1.1, 0]} material={jetMat}>
        <cylinderGeometry args={[0.02, 0.07, 0.5, 10, 1, true]} />
      </mesh>
      <mesh position={[0, fy + 0.5, 0]} material={jetMat}>
        <cylinderGeometry args={[0.56, 0.95, 0.46, 32, 1, true]} />
      </mesh>
      {/* expanding ripple rings on the basin */}
      <group ref={ripples} position={[0, fy + 0.27, 0]}>
        {rippleMats.map((m, i) => (
          <mesh key={i} geometry={rippleGeo} material={m} scale={[0.4 + i * 0.3, 1, 0.4 + i * 0.3]} />
        ))}
      </group>
      {animated && <FountainMotion jet={jet} ripples={ripples} />}
    </group>
  )
}

// ── component ────────────────────────────────────────────────────────

/**
 * CityBlock — the full street environment around the HQ tower.
 * `animated` toggles the traffic and the fountain; everything else is
 * static instanced geometry built once per session.
 */
export function CityBlock({ animated = true }: { animated?: boolean }): JSX.Element {
  const block = blockBatch()
  const far = farBatch()
  return (
    <group>
      {/* paved city ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={groundMat} receiveShadow>
        <planeGeometry args={[CITY.groundW, CITY.groundD]} />
      </mesh>
      {/* asphalt: main road + both avenues (split at the intersections) */}
      <mesh position={[0, -0.01, CITY.roadZ]} material={asphaltMain} receiveShadow>
        <boxGeometry args={[ROAD_LEN, 0.06, CITY.roadW]} />
      </mesh>
      {AVENUES.map((ax) =>
        [-1, 1].map((s) => (
          <mesh key={`${ax}${s}`} position={[ax, -0.01, s * (CITY.roadW / 2 + LIM / 2)]} material={asphaltAve} receiveShadow>
            <boxGeometry args={[CITY.avenueW + 0.02, 0.06, LIM]} />
          </mesh>
        ))
      )}
      <BatchMeshes batch={block} />
      <BatchMeshes batch={far} shadows={false} unlit />
      <LampPools />
      <Fountain animated={animated} />
      <Traffic animated={animated} />
    </group>
  )
}
