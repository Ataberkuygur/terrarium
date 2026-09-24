/* ── Character rig — the crew's shared procedural body ─────────────────────
 * One rig for every person in the office. Civilians get hash-derived
 * streetwear (skin, hair, outfit, body type, eyewear vary per agent id);
 * themed scenes pass a CharacterCostume that can recolour, swap whole suit
 * materials (canvas-textured webbing, armour), reshape the body (torso
 * profile, limb girth, hands, head), change footwear, cover the head (full
 * mask / cowl) and mount props (head, chest, back, shoulders, forearms,
 * hands, torso overlay).
 *
 * Placement contract (scenes depend on it): root sits at floor level;
 * standing height ≈ 1.5 × build; seated poses keep the hips at local
 * y≈0.53 (lounge ≈0.13) whatever the build — oversized characters are
 * shifted down so they still land on the seat. */

import { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { G, M } from './shared'
import { microSurface } from './SurfaceMaterials'
import type { Agent } from '@shared/types'

/* ── civilian palettes ──────────────────────────────────────────────────── */
const SKIN_TONES = [
  '#f6cfb6', // fair peach
  '#eabb99', // light warm
  '#d59d78', // golden tan
  '#bf8456', // warm amber
  '#96623f', // rich bronze
  '#6f452e' // deep espresso
]

// natural hair — saturated anime colours made the crew read as toys
const CREATOR_HAIR_COLORS = [
  '#161412', // black
  '#2b1f17', // dark brown
  '#4a3223', // chestnut
  '#76502f', // warm brown
  '#b88a55', // dirty blond
  '#8a3e2c', // auburn
  '#8d8c88' // silver
]

const PANTS_COLORS = ['#262a33', '#39414f', '#4a5a74', '#5b4d3d', '#2f3d33', '#1f2229']

export type Pose = 'sit' | 'stand' | 'lounge' | 'slump' | 'slumpStand' | 'standWork'

/** FNV-1a + murmur finaliser — ids that differ only in their last character
 * (agent-1, agent-2…) must still land on unrelated traits */
function hashId(id: string) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/* ── lathe-style solids (torso, pelvis, head) ───────────────────────────── */
type Ring = readonly [y: number, xRadius: number, zRadius: number, zOffset?: number]

/** Elliptical rings stacked along y → closed solid. UV: u wraps around
 * (u=0 is the front, +z; u=0.25 is +x), v runs bottom→top. Suit textures
 * in costume files rely on that layout. */
function profileSolid(rings: readonly Ring[], segments = 24): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz, offset = 0] = rings[r]
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2
      positions.push(Math.sin(a) * rx, y, Math.cos(a) * rz + offset)
      uvs.push(s / segments, r / (rings.length - 1))
      if (r < rings.length - 1 && s < segments) {
        const i = r * (segments + 1) + s
        const j = i + segments + 1
        indices.push(i, i + 1, j, i + 1, j + 1, j)
      }
    }
  }
  for (const r of [0, rings.length - 1]) {
    const center = positions.length / 3
    positions.push(0, rings[r][0], rings[r][3] ?? 0)
    uvs.push(0.5, r ? 1 : 0)
    for (let s = 0; s < segments; s++) {
      const i = r * (segments + 1) + s
      if (r === 0) indices.push(center, i + 1, i)
      else indices.push(center, i, i + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // weld the seam normals so the back seam doesn't show a crease
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
  const nx = new THREE.Vector3()
  const ny = new THREE.Vector3()
  for (let r = 0; r < rings.length; r++) {
    const a = r * (segments + 1)
    const b = a + segments
    nx.fromBufferAttribute(normal, a)
    ny.fromBufferAttribute(normal, b)
    nx.add(ny).normalize()
    normal.setXYZ(a, nx.x, nx.y, nx.z)
    normal.setXYZ(b, nx.x, nx.y, nx.z)
  }
  normal.needsUpdate = true
  return geometry
}

const limb = (radius: number, jointDistance: number, segments = 14) =>
  new THREE.CapsuleGeometry(radius, Math.max(0.01, jointDistance - radius * 2), 6, segments)

/** A cloak panel: hangs from y=0 down to y=-1, widens toward the hem,
 * wraps around the shoulders at the top and ripples into soft folds. */
function capeGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 10, 12)
  g.translate(0, -0.5, 0)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const t = -p.getY(i) // 0 top → 1 hem
    const w = 0.78 + 0.46 * t
    const wrap = (1 - Math.min(1, t * 3)) * 0.1 * (x * 2) * (x * 2) // shoulder wrap
    const folds = Math.sin(x * Math.PI * 5) * 0.018 * t
    p.setXYZ(i, x * w, p.getY(i), wrap + folds - 0.07 * t * t)
  }
  g.computeVertexNormals()
  return g
}

const GEO = {
  pelvis: profileSolid([
    [-0.09, 0.126, 0.082],
    [-0.02, 0.137, 0.088],
    [0.07, 0.118, 0.074]
  ], 24),
  head: profileSolid([
    [-0.145, 0.043, 0.052, 0.018],
    [-0.128, 0.066, 0.067, 0.02],
    [-0.095, 0.08, 0.075, 0.017],
    [-0.04, 0.087, 0.081, 0.011],
    [0.025, 0.086, 0.08, 0.004],
    [0.08, 0.075, 0.07, -0.006],
    [0.118, 0.052, 0.048, -0.011],
    [0.137, 0.012, 0.012, -0.011]
  ], 28),
  neck: new THREE.CylinderGeometry(0.034, 0.043, 0.12, 16),
  collar: new THREE.TorusGeometry(0.064, 0.008, 8, 24),
  deltoid: new THREE.SphereGeometry(0.052, 16, 12),
  elbow: new THREE.SphereGeometry(0.035, 12, 10),
  upperArm: limb(0.034, 0.23),
  forearm: limb(0.03, 0.22),
  cuff: new THREE.TorusGeometry(0.033, 0.006, 8, 18),
  palm: new THREE.SphereGeometry(0.037, 14, 10),
  thumb: limb(0.01, 0.045, 8),
  finger: limb(0.0075, 0.038, 8),
  thigh: limb(0.052, 0.34, 16),
  knee: new THREE.SphereGeometry(0.045, 14, 10),
  calf: limb(0.042, 0.33, 16),
  ankle: new THREE.SphereGeometry(0.034, 12, 8),
  eyeWhite: new THREE.SphereGeometry(0.0135, 14, 10),
  iris: new THREE.SphereGeometry(0.0075, 12, 8),
  pupil: new THREE.SphereGeometry(0.0038, 8, 6),
  brow: new THREE.CapsuleGeometry(0.0048, 0.03, 4, 8),
  noseBridge: new THREE.CapsuleGeometry(0.006, 0.045, 4, 8),
  noseTip: new THREE.SphereGeometry(0.012, 12, 8),
  nostril: new THREE.SphereGeometry(0.003, 6, 5),
  lip: new THREE.CapsuleGeometry(0.005, 0.04, 4, 10),
  smile: new THREE.TorusGeometry(0.02, 0.0042, 6, 14, Math.PI * 0.72),
  ear: new THREE.SphereGeometry(0.02, 12, 8),
  // hair shell — tilted back so the fringe sits above the brows (the old
  // full cap slid down over the eyes and blanked every face)
  hairCap: new THREE.SphereGeometry(0.104, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
  // cowl — covers the ears and nape, leaves the face open
  cowl: new THREE.SphereGeometry(0.11, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
  hairLock: limb(0.012, 0.06, 8),
  hairClump: new THREE.SphereGeometry(0.032, 12, 8),
  bun: new THREE.SphereGeometry(0.046, 14, 10),
  curls: new THREE.IcosahedronGeometry(0.03, 1),
  headBand: new THREE.TorusGeometry(0.106, 0.011, 8, 24, Math.PI),
  headCup: new THREE.CylinderGeometry(0.034, 0.034, 0.028, 16),
  sunglassLens: new THREE.BoxGeometry(0.075, 0.034, 0.008),
  sunglassBridge: new THREE.BoxGeometry(0.026, 0.005, 0.008),
  glassRim: new THREE.TorusGeometry(0.02, 0.0028, 6, 18),
  shoeSole: new THREE.BoxGeometry(0.092, 0.032, 0.205),
  shoeToe: new THREE.SphereGeometry(0.046, 14, 10),
  shoeLace: new THREE.BoxGeometry(0.052, 0.004, 0.01),
  bootShaft: new THREE.CylinderGeometry(1, 0.92, 1, 18),
  toe: new THREE.SphereGeometry(0.016, 8, 6),
  hemTooth: new THREE.ConeGeometry(0.02, 0.055, 4),
  band: new THREE.CylinderGeometry(1, 1, 1, 28, 1, true),
  zipper: new THREE.BoxGeometry(0.009, 0.26, 0.006),
  button: new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10),
  hood: new THREE.TorusGeometry(0.095, 0.022, 10, 24, Math.PI * 1.35),
  cape: capeGeometry(),
  laptopBase: new THREE.BoxGeometry(0.31, 0.014, 0.21),
  laptopLid: new THREE.BoxGeometry(0.31, 0.19, 0.012),
  laptopScreen: new THREE.PlaneGeometry(0.28, 0.16)
} as const

/** head solid — costume files build helmets/faceplates that hug the skull */
export const HEAD_GEOMETRY: THREE.BufferGeometry = GEO.head

/* ── body types ─────────────────────────────────────────────────────────── */
export type TorsoShape = 'default' | 'athletic' | 'female' | 'hulk'

const TORSO_RINGS: Record<TorsoShape, readonly Ring[]> = {
  default: [
    [-0.24, 0.112, 0.073],
    [-0.18, 0.104, 0.067],
    [-0.05, 0.108, 0.071],
    [0.06, 0.132, 0.081],
    [0.17, 0.152, 0.086],
    [0.245, 0.145, 0.078],
    [0.29, 0.07, 0.052]
  ],
  athletic: [
    [-0.24, 0.11, 0.072],
    [-0.18, 0.1, 0.066],
    [-0.06, 0.104, 0.07],
    [0.06, 0.14, 0.084, 0.004],
    [0.17, 0.166, 0.09, 0.006],
    [0.245, 0.16, 0.08],
    [0.29, 0.072, 0.053]
  ],
  female: [
    [-0.24, 0.122, 0.078],
    [-0.17, 0.104, 0.068],
    [-0.07, 0.088, 0.062],
    [0.03, 0.104, 0.07, 0.004],
    [0.11, 0.12, 0.084, 0.012],
    [0.19, 0.128, 0.074, 0.004],
    [0.245, 0.124, 0.066],
    [0.29, 0.06, 0.048]
  ],
  hulk: [
    [-0.24, 0.152, 0.104],
    [-0.17, 0.146, 0.102],
    [-0.06, 0.168, 0.114, 0.006],
    [0.05, 0.22, 0.134, 0.012],
    [0.15, 0.255, 0.142, 0.012],
    [0.225, 0.25, 0.124, 0.002],
    [0.29, 0.13, 0.084]
  ]
}

interface ShapeSpec {
  rings: readonly Ring[]
  geo: THREE.BufferGeometry
  pelvis: readonly [number, number, number]
  armX: number
  armY: number
  hipX: number
  chestZ: number
  backZ: number
  neck: readonly [girth: number, length: number]
  headY: number
  headZ: number
  /** idle arm roll toward the body (radians) — negative swings big arms
   * outward so fists clear the thighs */
  armSplay: number
}

const SHAPES: Record<TorsoShape, ShapeSpec> = {
  default: {
    rings: TORSO_RINGS.default,
    geo: profileSolid(TORSO_RINGS.default, 28),
    pelvis: [1, 1, 1],
    armX: 0.168,
    armY: 0.18,
    hipX: 0.073,
    chestZ: 0.088,
    backZ: -0.096,
    neck: [1, 1],
    headY: 0.43,
    headZ: 0,
    armSplay: 0.11
  },
  athletic: {
    rings: TORSO_RINGS.athletic,
    geo: profileSolid(TORSO_RINGS.athletic, 28),
    pelvis: [0.98, 1, 0.98],
    armX: 0.184,
    armY: 0.185,
    hipX: 0.074,
    chestZ: 0.096,
    backZ: -0.1,
    neck: [1.08, 1],
    headY: 0.43,
    headZ: 0,
    armSplay: 0.13
  },
  female: {
    rings: TORSO_RINGS.female,
    geo: profileSolid(TORSO_RINGS.female, 28),
    pelvis: [1.06, 1, 1.04],
    armX: 0.148,
    armY: 0.182,
    hipX: 0.074,
    chestZ: 0.096,
    backZ: -0.09,
    neck: [0.88, 1.05],
    headY: 0.435,
    headZ: 0,
    armSplay: 0.1
  },
  hulk: {
    rings: TORSO_RINGS.hulk,
    geo: profileSolid(TORSO_RINGS.hulk, 32),
    pelvis: [1.3, 1.12, 1.28],
    armX: 0.29,
    armY: 0.165,
    hipX: 0.112,
    chestZ: 0.148,
    backZ: -0.13,
    neck: [2.1, 0.6],
    headY: 0.385,
    headZ: 0.05,
    armSplay: -0.1
  }
}

/** half-extents of the torso at height y (linear between rings) — wraps
 * belts and coat skirts snugly around any body type */
function ringAt(rings: readonly Ring[], y: number): { rx: number; rz: number; off: number } {
  if (y <= rings[0][0]) return { rx: rings[0][1], rz: rings[0][2], off: rings[0][3] ?? 0 }
  for (let i = 1; i < rings.length; i++) {
    const [y1, rx1, rz1, o1 = 0] = rings[i]
    const [y0, rx0, rz0, o0 = 0] = rings[i - 1]
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0)
      return { rx: rx0 + (rx1 - rx0) * t, rz: rz0 + (rz1 - rz0) * t, off: o0 + (o1 - o0) * t }
    }
  }
  const last = rings[rings.length - 1]
  return { rx: last[1], rz: last[2], off: last[3] ?? 0 }
}

/* ── costume contract ───────────────────────────────────────────────────── */
export interface Physique {
  /** limb girth multipliers */
  arms?: number
  /** extra forearm girth on top of `arms` (Hulk's are the biggest part) */
  forearms?: number
  legs?: number
  /** arm length multiplier (Hulk's knuckles hang low) */
  armLength?: number
  hands?: number
  head?: number
}

export type Footwear = 'sneaker' | 'boot' | 'bare'
export type Expression = 'neutral' | 'smile' | 'smirk' | 'angry'

/** Themed character override — the office themes (e.g. the Avengers
 * facility) supply fixed identities instead of hash-derived streetwear.
 * All fields optional; absent fields fall back to the hash behaviour.
 * `*Material` fields take shared module-level materials (never mutated). */
export interface CharacterCostume {
  skin?: string
  hair?: string // hair colour; 'none' hides the hair entirely
  /** 0 spiky · 1 quiff · 2 bun · 3 swept · 4 bob · 5 ponytail · 6 curls · 7 buzz */
  hairStyle?: number
  hairLong?: boolean // long hair down the back (Wanda, Thor, Loki…)
  shirt?: string
  accent?: string
  pants?: string
  shoes?: string
  eyes?: string
  scale?: number // multiplies the character build (Hulk ≈ 1.4)
  sunglasses?: boolean
  glasses?: boolean
  headphones?: boolean
  hoodie?: boolean
  /** 'full' (or legacy 'spidey') covers the whole head with maskMaterial;
   * 'cowl' covers skull + ears and leaves the face open (Cap) */
  mask?: 'spidey' | 'full' | 'cowl'
  /** beard/goatee colour — jaw-mounted mesh (Tony, Thor, Strange) */
  beard?: string
  /** mounts inside the animated head group — horns, lenses, faceplates */
  headgear?: ReactNode
  /** torso-front emblem, mounted on the sternum surface */
  chest?: ReactNode
  /** torso-local overlay at the torso origin — musculature, armour plates */
  torsoOverlay?: ReactNode
  cape?: { color: string; length?: number; width?: number }
  /** open coat skirt from the waist (Wanda, Strange, Loki) */
  coat?: { color: string; length?: number; flare?: number; gap?: number }
  /** mounted on the back of the torso — Cap's shield */
  backMount?: ReactNode
  /** mounts at the right-hand tip — Mjölnir, sceptre */
  rightHand?: ReactNode
  leftHand?: ReactNode
  /** both shoulders (mirrored for the left) — pauldrons */
  shoulderMount?: ReactNode
  /** both forearms (mirrored) — bracers, gauntlets, Widow's bites */
  forearmMount?: ReactNode
  /** sleeve/forearm colour override — defaults to the shirt (uniform
   * sleeves). Bare-armed heroes (Hulk, Thor) set skin tones. */
  arms?: string
  torsoShape?: TorsoShape
  physique?: Physique
  footwear?: Footwear
  /** boot shaft height up the calf (0..0.33) */
  bootHeight?: number
  /** belt band colour around the waist (costumes only; civilians always wear one) */
  belt?: string
  /** torn shorts — bare calves + ragged hem below the knee (Hulk) */
  shorts?: boolean
  expression?: Expression
  heavyBrow?: boolean
  /** jaw width multiplier — >1 adds a square jaw block */
  jaw?: number
  /** forward hunch added to standing poses (radians) */
  hunch?: number
  torsoMaterial?: THREE.Material
  pelvisMaterial?: THREE.Material
  sleeveMaterial?: THREE.Material
  forearmMaterial?: THREE.Material
  handMaterial?: THREE.Material
  thighMaterial?: THREE.Material
  calfMaterial?: THREE.Material
  bootMaterial?: THREE.Material
  maskMaterial?: THREE.Material
}

/* ── module-level materials (shared, never mutated) ─────────────────────── */
const matRubber = new THREE.MeshStandardMaterial({ color: '#1c1d21', roughness: 0.9 })
const matEyeWhite = new THREE.MeshStandardMaterial({ color: '#f4efe8', roughness: 0.28 })
const matPupil = new THREE.MeshBasicMaterial({ color: '#101214' })
const matGlint = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
const matNostril = new THREE.MeshBasicMaterial({ color: '#4b3029' })
const matLipTop = new THREE.MeshStandardMaterial({ color: '#9c6258', roughness: 0.65 })
const matLipBottom = new THREE.MeshStandardMaterial({ color: '#b17668', roughness: 0.68 })
const matEarInner = new THREE.MeshStandardMaterial({ color: '#b87966', roughness: 0.7 })
const matTeeth = new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.4 })
const matMouth = new THREE.MeshBasicMaterial({ color: '#2a1414' })
const matGlassFrame = new THREE.MeshStandardMaterial({ color: '#1d1f24', roughness: 0.4, metalness: 0.3 })
const matHeadCushion = new THREE.MeshBasicMaterial({ color: '#6f7885', toneMapped: false })

/* ── hands & arms ───────────────────────────────────────────────────────── */
function Hand({ side, mat }: { side: -1 | 1; mat: THREE.Material }) {
  return (
    <group>
      <mesh geometry={GEO.palm} material={mat} scale={[0.82, 1.15, 0.58]} castShadow />
      <mesh position={[side * 0.028, -0.012, 0.012]} rotation={[0.35, 0, side * 0.75]} geometry={GEO.thumb} material={mat} />
      {[-0.016, 0, 0.016].map((x) => (
        <mesh key={x} position={[x, -0.043, 0.004]} rotation={[0.12, 0, x * 1.5]} geometry={GEO.finger} material={mat} />
      ))}
    </group>
  )
}

interface ArmProps {
  side: -1 | 1
  upperMat: THREE.Material
  forearmMat: THREE.Material
  handMat: THREE.Material
  elbowRef: RefObject<THREE.Group | null>
  handContent?: ReactNode
  girth: number
  forearm: number
  len: number
  handScale: number
  cuff: boolean
  shoulderMount?: ReactNode
  forearmMount?: ReactNode
}

function Arm({ side, upperMat, forearmMat, handMat, elbowRef, handContent, girth: g, forearm, len, handScale, cuff, shoulderMount, forearmMount }: ArmProps) {
  return (
    <group>
      <mesh geometry={GEO.deltoid} material={upperMat} scale={[1.02 * g ** 0.82, 1.18 * g ** 0.72, 0.94 * g ** 0.82]} castShadow />
      <mesh position={[0, -0.115 * len, 0]} scale={[g, len, g]} geometry={GEO.upperArm} material={upperMat} castShadow />
      {shoulderMount && <group scale={[side * g, g, g]}>{shoulderMount}</group>}
      <group ref={elbowRef} position={[0, -0.23 * len, 0]}>
        <mesh geometry={GEO.elbow} material={upperMat} scale={g * 0.96} />
        <mesh position={[0, -0.11 * len, 0]} scale={[g * 0.97 * forearm, len, g * 0.97 * forearm]} geometry={GEO.forearm} material={forearmMat} castShadow />
        {cuff && <mesh position={[0, -0.205 * len, 0]} rotation={[Math.PI / 2, 0, 0]} geometry={GEO.cuff} material={upperMat} />}
        {forearmMount && (
          <group position={[0, -0.13 * len, 0]} scale={[side * g, len, g]}>
            {forearmMount}
          </group>
        )}
        <group position={[0, -0.235 * len - (handScale - 1) * 0.03, 0]}>
          <group scale={handScale}>
            <Hand side={side} mat={handMat} />
          </group>
          {handContent}
        </group>
      </group>
    </group>
  )
}

/* ── legs & footwear ────────────────────────────────────────────────────── */
interface FootSpec {
  kind: Footwear
  upper: string
  bootMat: THREE.Material
  bootHeight: number
  skinMat: THREE.Material
}

function Sneaker({ upper }: { upper: string }) {
  return (
    <group>
      <mesh position={[0, 0.018, 0.045]} geometry={GEO.shoeSole} material={M.sneakerWhite} castShadow />
      <RoundedBox args={[0.084, 0.058, 0.15]} radius={0.018} position={[0, 0.06, 0.018]} castShadow>
        <meshStandardMaterial color={upper} roughness={0.62} {...microSurface('fabric')} />
      </RoundedBox>
      <mesh position={[0, 0.052, 0.105]} scale={[1, 0.68, 0.82]} geometry={GEO.shoeToe} material={M.sneakerWhite} />
      {[-0.004, 0.012, 0.028].map((z) => (
        <mesh key={z} position={[0, 0.092, z]} geometry={GEO.shoeLace} material={M.sneakerWhite} />
      ))}
    </group>
  )
}

function Boot({ mat }: { mat: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, 0.011, 0.04]} scale={[0.094, 0.022, 0.2]} geometry={G.unitBox} material={matRubber} castShadow />
      <RoundedBox args={[0.088, 0.075, 0.19]} radius={0.026} position={[0, 0.052, 0.038]} material={mat} castShadow />
      <RoundedBox args={[0.08, 0.07, 0.1]} radius={0.028} position={[0, 0.09, 0.0]} material={mat} />
    </group>
  )
}

function BareFoot({ mat, big }: { mat: THREE.Material; big: number }) {
  return (
    <group scale={[big, big * 0.9, 1 + (big - 1) * 0.55]}>
      <RoundedBox args={[0.092, 0.058, 0.19]} radius={0.026} position={[0, 0.03, 0.04]} material={mat} castShadow />
      {[-0.03, -0.01, 0.01, 0.029].map((x, i) => (
        <mesh key={x} position={[x, 0.018, 0.132 - Math.abs(i - 1.2) * 0.006]} scale={[1, 0.85, 1.15]} geometry={GEO.toe} material={mat} />
      ))}
    </group>
  )
}

interface LegProps {
  side: -1 | 1
  hip: readonly [number, number, number]
  thighPitch: number
  calfPitch: number
  yaw?: number
  thighMat: THREE.Material
  calfMat: THREE.Material
  girth: number
  foot: FootSpec
  hem: boolean
}

function Leg({ side, hip, thighPitch, calfPitch, yaw = 0, thighMat, calfMat, girth: g, foot, hem }: LegProps) {
  const shaft = foot.kind === 'boot' ? foot.bootHeight : 0
  return (
    <group position={hip} rotation={[thighPitch, yaw, side * 0.025]}>
      <mesh position={[0, -0.17, 0]} scale={[g, 1, g]} geometry={GEO.thigh} material={thighMat} castShadow />
      <group position={[0, -0.34, 0]} rotation={[calfPitch, 0, 0]}>
        <mesh geometry={GEO.knee} material={thighMat} scale={[g, 1, g]} />
        <mesh position={[0, -0.165, 0]} scale={[g * 0.96, 1, g * 0.96]} geometry={GEO.calf} material={calfMat} castShadow />
        <mesh position={[0, -0.325, 0.005]} geometry={GEO.ankle} material={shaft > 0 ? foot.bootMat : calfMat} scale={g} />
        {hem &&
          Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2
            const r = 0.05 * g
            const l = 0.8 + ((i * 7) % 5) * 0.12
            return (
              <mesh
                key={i}
                position={[Math.sin(a) * r, -0.035 - l * 0.02, Math.cos(a) * r]}
                rotation={[Math.PI + Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25]}
                scale={[g, l, g * 0.6]}
                geometry={GEO.hemTooth}
                material={thighMat}
              />
            )
          })}
        {shaft > 0 && (
          <mesh position={[0, -0.33 + shaft / 2, 0.002]} scale={[0.049 * g, shaft, 0.051 * g]} geometry={GEO.bootShaft} material={foot.bootMat} castShadow />
        )}
        <group position={[0, -0.37, 0.02]} rotation={[-thighPitch - calfPitch, 0, 0]}>
          {foot.kind === 'bare' ? (
            <BareFoot mat={foot.skinMat} big={g} />
          ) : foot.kind === 'boot' ? (
            <group scale={[g, 1, 1 + (g - 1) * 0.4]}>
              <Boot mat={foot.bootMat} />
            </group>
          ) : (
            <Sneaker upper={foot.upper} />
          )}
        </group>
      </group>
    </group>
  )
}

interface LegSetProps {
  thighMat: THREE.Material
  calfMat: THREE.Material
  girth: number
  hipX: number
  foot: FootSpec
  hem: boolean
}

function StandingLegs({ hipX, ...rest }: LegSetProps) {
  return (
    <group>
      <Leg side={-1} hip={[-hipX, 0.78, 0]} thighPitch={0.025} calfPitch={-0.025} yaw={0.025} {...rest} />
      <Leg side={1} hip={[hipX, 0.78, 0]} thighPitch={-0.015} calfPitch={0.015} yaw={-0.025} {...rest} />
    </group>
  )
}

/** seated legs — oversized builds (the rig keeps their hips on the seat)
 * open the knee so shins that are longer than the seat is high still plant
 * the feet on the floor instead of sinking through it */
function SeatedLegs({ hipX, build, ...rest }: LegSetProps & { build: number }) {
  const drop = 0.53 / build - 0.04
  const open = drop < 0.44 ? Math.acos(Math.max(0.2, drop / 0.44)) : 0
  return (
    <group>
      <Leg side={-1} hip={[-hipX - 0.002, 0.53, 0.02]} thighPitch={-1.32} calfPitch={1.32 - open} {...rest} />
      <Leg side={1} hip={[hipX + 0.002, 0.53, 0.02]} thighPitch={-1.28} calfPitch={1.28 - open} {...rest} />
    </group>
  )
}

function LoungeLegs({ hipX, ...rest }: LegSetProps) {
  return (
    <group>
      <Leg side={-1} hip={[-hipX - 0.002, 0.13, 0.08]} thighPitch={-1.42} calfPitch={1.12} {...rest} />
      <Leg side={1} hip={[hipX + 0.002, 0.13, 0.08]} thighPitch={-1.36} calfPitch={1.03} {...rest} />
    </group>
  )
}

/* ── face & head ────────────────────────────────────────────────────────── */
interface FaceProps {
  skinMat: THREE.Material
  hairMat: THREE.Material
  eyeMat: THREE.Material
  eyewear: 'none' | 'sunglasses' | 'glasses'
  expression: Expression
  heavyBrow: boolean
  jaw: number
}

function Mouth({ expression }: { expression: Expression }) {
  if (expression === 'smile' || expression === 'smirk') {
    const tilt = expression === 'smirk' ? 0.22 : 0
    return (
      <group position={[expression === 'smirk' ? 0.006 : 0, -0.066, 0.091]} rotation={[0.15, 0, tilt]}>
        {/* arc opening upward */}
        <mesh rotation={[0, 0, Math.PI + Math.PI * 0.14]} scale={[1, 0.62, 0.6]} geometry={GEO.smile} material={matLipTop} />
      </group>
    )
  }
  if (expression === 'angry') {
    return (
      <group position={[0, -0.078, 0.089]}>
        {/* bared-teeth grimace */}
        <RoundedBox args={[0.058, 0.024, 0.012]} radius={0.005} material={matMouth} />
        <mesh position={[0, 0.004, 0.005]} scale={[0.05, 0.008, 0.006]} geometry={G.unitBox} material={matTeeth} />
        <mesh position={[0, -0.005, 0.005]} scale={[0.046, 0.007, 0.006]} geometry={G.unitBox} material={matTeeth} />
        <mesh position={[0, 0.015, 0.002]} rotation={[0, 0, Math.PI / 2]} scale={[0.8, 1.25, 0.55]} geometry={GEO.lip} material={matLipTop} />
      </group>
    )
  }
  return (
    <group>
      <mesh position={[0, -0.072, 0.091]} rotation={[0, 0, Math.PI / 2]} scale={[0.8, 1, 0.55]} geometry={GEO.lip} material={matLipTop} />
      <mesh position={[0, -0.08, 0.089]} rotation={[0, 0, Math.PI / 2]} scale={[0.7, 0.72, 0.45]} geometry={GEO.lip} material={matLipBottom} />
    </group>
  )
}

function Face({ skinMat, hairMat, eyeMat, eyewear, expression, heavyBrow, jaw }: FaceProps) {
  const angry = expression === 'angry'
  return (
    <group>
      {eyewear !== 'sunglasses' && (
        <group>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.038, 0.018, 0.077]}>
              <mesh scale={[1.4, angry ? 0.62 : 0.8, 0.34]} geometry={GEO.eyeWhite} material={matEyeWhite} />
              <mesh position={[0, -0.001, 0.006]} scale={[1.05, 1.05, 0.42]} geometry={GEO.iris} material={eyeMat} />
              <mesh position={[0, -0.001, 0.009]} scale={[1, 1, 0.35]} geometry={GEO.pupil} material={matPupil} />
              <mesh position={[side * 0.003, 0.003, 0.011]} scale={[0.4, 0.4, 0.2]} geometry={GEO.pupil} material={matGlint} />
            </group>
          ))}
          {[-1, 1].map((side) => {
            const tilt = angry ? side * 0.42 : side * -0.12
            return (
              <mesh
                key={side}
                position={[side * 0.039, angry ? 0.042 : 0.047, 0.08]}
                rotation={[0.1, side * -0.12, Math.PI / 2 + tilt]}
                scale={heavyBrow ? [1.6, 1.15, 1.4] : [1, 1, 1]}
                geometry={GEO.brow}
                material={hairMat}
              />
            )
          })}
        </group>
      )}
      {eyewear === 'sunglasses' && (
        <group position={[0, 0.022, 0.086]}>
          <mesh position={[-0.041, 0, 0]} geometry={GEO.sunglassLens} material={M.sunglassGlass} />
          <mesh position={[0.041, 0, 0]} geometry={GEO.sunglassLens} material={M.sunglassGlass} />
          <mesh position={[0, 0.006, 0]} geometry={GEO.sunglassBridge} material={M.metalMid} />
        </group>
      )}
      {eyewear === 'glasses' && (
        <group position={[0, 0.018, 0.09]}>
          <mesh position={[-0.039, 0, 0]} scale={[1.15, 0.85, 1]} geometry={GEO.glassRim} material={matGlassFrame} />
          <mesh position={[0.039, 0, 0]} scale={[1.15, 0.85, 1]} geometry={GEO.glassRim} material={matGlassFrame} />
          <mesh position={[0, 0.004, 0]} scale={[0.02, 0.004, 0.004]} geometry={G.unitBox} material={matGlassFrame} />
        </group>
      )}
      {heavyBrow && (
        <RoundedBox args={[0.13, 0.022, 0.03]} radius={0.01} position={[0, 0.05, 0.062]} rotation={[-0.2, 0, 0]} material={skinMat} />
      )}
      {jaw > 1 && (
        <RoundedBox args={[0.13 * jaw, 0.06, 0.1]} radius={0.024} position={[0, -0.1, 0.012]} material={skinMat} castShadow />
      )}
      <mesh position={[0, -0.008, 0.083]} rotation={[0.08, 0, 0]} scale={jaw > 1 ? [1.5, 1, 1.2] : [1, 1, 1]} geometry={GEO.noseBridge} material={skinMat} />
      <mesh position={[0, -0.04, 0.092]} scale={jaw > 1 ? [1.5, 0.9, 1] : [1, 0.78, 0.9]} geometry={GEO.noseTip} material={skinMat} />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.011, -0.048, 0.095]} geometry={GEO.nostril} material={matNostril} />
      ))}
      <Mouth expression={expression} />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.087, -0.002, -0.003]} rotation={[0, side * 0.18, 0]}>
          <mesh scale={[0.48, 1.05, 0.72]} geometry={GEO.ear} material={skinMat} />
          <mesh position={[side * 0.007, 0, 0.004]} scale={[0.2, 0.58, 0.28]} geometry={GEO.ear} material={matEarInner} />
        </group>
      ))}
    </group>
  )
}

function Hair({ style, long, material }: { style: number; long: boolean; material: THREE.Material }) {
  return (
    <group>
      {style !== 7 && (
        <mesh position={[0, 0.024, -0.006]} rotation={[-0.45, 0, 0]} scale={[1.05, 1.03, 1.08]} geometry={GEO.hairCap} material={material} castShadow />
      )}
      {style === 7 && (
        <mesh position={[0, 0.02, -0.004]} rotation={[-0.45, 0, 0]} scale={[0.93, 0.95, 0.96]} geometry={GEO.hairCap} material={material} />
      )}
      {/* sideburns */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.08, -0.004, 0.012]} rotation={[0.1, 0, side * 0.06]} scale={[0.75, 0.55, 0.75]} geometry={GEO.hairLock} material={material} />
      ))}
      {long && (
        <group>
          <RoundedBox args={[0.16, 0.3, 0.05]} radius={0.02} position={[0, -0.14, -0.074]} rotation={[0.1, 0, 0]} material={material} castShadow />
          {[-1, 1].map((side) => (
            <RoundedBox key={side} args={[0.035, 0.2, 0.06]} radius={0.015} position={[side * 0.086, -0.075, -0.02]} rotation={[0.05, 0, side * -0.06]} material={material} />
          ))}
        </group>
      )}
      {style === 0 && (
        <group>
          {[
            [-0.045, 0.118, 0.02, -0.3],
            [0.0, 0.132, 0.018, -0.1],
            [0.046, 0.116, 0.014, 0.28],
            [-0.018, 0.125, -0.045, -0.15],
            [0.03, 0.12, -0.04, 0.18],
            [0.0, 0.1, 0.07, 0.0]
          ].map(([x, y, z, rz], i) => (
            <mesh key={i} position={[x, y, z]} rotation={[-0.35, 0, rz]} scale={[1.2, 0.62, 1]} geometry={GEO.hairClump} material={material} />
          ))}
        </group>
      )}
      {style === 1 && (
        <group>
          <mesh position={[0, 0.07, -0.006]} rotation={[-0.3, 0, 0]} scale={[0.92, 0.55, 0.95]} geometry={GEO.hairCap} material={material} />
          {[-0.028, 0.006, 0.04].map((x, i) => (
            <mesh key={i} position={[x, 0.108, 0.05]} rotation={[-0.9, (i - 1) * 0.18, -0.22]} geometry={GEO.hairLock} material={material} />
          ))}
        </group>
      )}
      {style === 2 && (
        <group>
          <mesh position={[0, 0.118, -0.064]} geometry={GEO.bun} material={material} />
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.078, 0.0, 0.04]} rotation={[0.22, side * 0.28, side * 0.1]} scale={[0.8, 0.7, 0.8]} geometry={GEO.hairLock} material={material} />
          ))}
        </group>
      )}
      {style === 3 && (
        <group>
          {[
            [-0.052, 0.095, 0.058, -0.45],
            [-0.01, 0.108, 0.062, -0.25],
            [0.036, 0.103, 0.057, 0.18],
            [0.067, 0.074, 0.035, 0.34]
          ].map(([x, y, z, rz], i) => (
            <mesh key={i} position={[x, y, z]} rotation={[-0.72, 0, rz]} geometry={GEO.hairLock} material={material} />
          ))}
        </group>
      )}
      {style === 4 && (
        <group>
          {/* bob — full sides to the jaw + a heavy fringe */}
          {[-1, 1].map((side) => (
            <RoundedBox key={side} args={[0.04, 0.15, 0.13]} radius={0.018} position={[side * 0.086, -0.035, -0.012]} rotation={[0, 0, side * -0.08]} material={material} castShadow />
          ))}
          <RoundedBox args={[0.17, 0.12, 0.05]} radius={0.022} position={[0, -0.03, -0.075]} material={material} />
          <mesh position={[0.012, 0.076, 0.066]} rotation={[-0.6, 0, -0.3]} scale={[1.9, 0.6, 0.9]} geometry={GEO.hairClump} material={material} />
        </group>
      )}
      {style === 5 && (
        <group>
          {/* ponytail — tie at the crown, tail swinging down the back */}
          <mesh position={[0, 0.06, -0.1]} scale={[0.7, 0.7, 0.7]} geometry={GEO.bun} material={material} />
          <RoundedBox args={[0.05, 0.2, 0.05]} radius={0.022} position={[0, -0.05, -0.125]} rotation={[0.22, 0, 0]} material={material} castShadow />
        </group>
      )}
      {style === 6 && (
        <group>
          {/* curls — clustered icosahedra over the crown */}
          {[
            [-0.06, 0.09, 0.03],
            [0, 0.12, 0.03],
            [0.06, 0.09, 0.03],
            [-0.075, 0.06, -0.04],
            [0.075, 0.06, -0.04],
            [-0.035, 0.12, -0.05],
            [0.035, 0.12, -0.05],
            [0, 0.085, -0.095],
            [-0.06, 0.02, -0.08],
            [0.06, 0.02, -0.08]
          ].map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]} scale={1.25} geometry={GEO.curls} material={material} />
          ))}
        </group>
      )}
    </group>
  )
}

interface HeadProps {
  skinMat: THREE.Material
  hairMat: THREE.Material
  eyeMat: THREE.Material
  maskMat: THREE.Material
  hairStyle: number
  hairLong: boolean
  hideHair: boolean
  eyewear: 'none' | 'sunglasses' | 'glasses'
  headphones: boolean
  mask: 'none' | 'full' | 'cowl'
  beard?: string
  headgear?: ReactNode
  expression: Expression
  heavyBrow: boolean
  jaw: number
}

function Head(p: HeadProps) {
  if (p.mask === 'full') {
    return (
      <group>
        <mesh geometry={GEO.head} material={p.maskMat} scale={[1.035, 1.035, 1.035]} castShadow />
        {p.headgear}
      </group>
    )
  }
  return (
    <group>
      <mesh geometry={GEO.head} material={p.skinMat} castShadow />
      <Face
        skinMat={p.skinMat}
        hairMat={p.hairMat}
        eyeMat={p.eyeMat}
        eyewear={p.eyewear}
        expression={p.expression}
        heavyBrow={p.heavyBrow}
        jaw={p.jaw}
      />
      {p.mask === 'cowl' ? (
        <mesh position={[0, 0.022, -0.004]} rotation={[-0.6, 0, 0]} scale={[1.02, 1.03, 1.06]} geometry={GEO.cowl} material={p.maskMat} castShadow />
      ) : (
        !p.hideHair && <Hair style={p.hairStyle} long={p.hairLong} material={p.hairMat} />
      )}
      {p.beard && (
        <group position={[0, -0.1, 0.05]}>
          <RoundedBox args={[0.07, 0.05, 0.036]} radius={0.014}>
            <meshStandardMaterial color={p.beard} roughness={0.85} {...microSurface('fabric')} />
          </RoundedBox>
          {/* moustache */}
          <mesh position={[0, 0.037, 0.024]} scale={[0.056, 0.011, 0.014]} geometry={G.unitBox}>
            <meshStandardMaterial color={p.beard} roughness={0.85} />
          </mesh>
          {/* jaw-line strap up toward the sideburns */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.052, 0.035, -0.035]} rotation={[0.25, side * 0.55, 0]} scale={[0.018, 0.075, 0.03]} geometry={G.unitBox}>
              <meshStandardMaterial color={p.beard} roughness={0.85} />
            </mesh>
          ))}
        </group>
      )}
      {p.headgear}
      {p.headphones && (
        <group position={[0, 0.015, -0.006]}>
          <mesh rotation={[-0.12, 0, 0]} geometry={GEO.headBand} material={M.metalMid} />
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.102, -0.012, 0]} rotation={[0, 0, Math.PI / 2]}>
              <mesh geometry={GEO.headCup} material={M.metalMid} />
              <mesh position={[0, 0.016, 0]} scale={[0.76, 0.2, 0.76]} geometry={GEO.headCup} material={matHeadCushion} />
            </group>
          ))}
        </group>
      )}
    </group>
  )
}

/* ── torso ──────────────────────────────────────────────────────────────── */
interface TorsoProps {
  spec: ShapeSpec
  torsoMat: THREE.Material
  pelvisMat: THREE.Material
  accentMat: THREE.Material
  neckMat: THREE.Material
  innerMat: THREE.Material
  costume?: CharacterCostume
  outfit: Outfit
  seated: boolean
}

/** civilian outfit variants — costumed characters always get 'suit' */
type Outfit = 'tee' | 'hoodie' | 'jacket' | 'shirt' | 'suit'

function Torso({ spec, torsoMat, pelvisMat, accentMat, neckMat, innerMat, costume: c, outfit, seated }: TorsoProps) {
  const waist = ringAt(spec.rings, -0.17)
  const coatTop = ringAt(spec.rings, -0.2)
  const coatLen = c?.coat ? (seated ? Math.min(0.16, c.coat.length ?? 0.5) : c.coat.length ?? 0.5) : 0
  const gap = c?.coat?.gap ?? 0.7
  const coatGeo = useMemo(
    () =>
      c?.coat
        ? new THREE.CylinderGeometry(1, c.coat.flare ?? 1.45, 1, 28, 1, true, gap / 2, Math.PI * 2 - gap)
        : null,
    [c?.coat, gap]
  )
  const civilian = outfit !== 'suit'
  return (
    <group>
      <mesh geometry={spec.geo} material={torsoMat} castShadow />
      <mesh position={[0, -0.25, 0.004]} scale={spec.pelvis} geometry={GEO.pelvis} material={pelvisMat} castShadow />
      {civilian && (
        <group>
          <mesh position={[0, -0.17, waist.rz + waist.off - 0.004]} scale={[waist.rx * 2.1, 0.025, 0.015]} geometry={G.unitBox} material={M.cable} />
          <mesh position={[0, 0.285, 0.006]} rotation={[Math.PI / 2, 0, 0]} geometry={GEO.collar} material={accentMat} />
        </group>
      )}
      {c?.belt && (
        <mesh position={[0, -0.17, waist.off]} scale={[waist.rx * 1.06, 0.034, waist.rz * 1.08]} geometry={GEO.band}>
          <meshStandardMaterial color={c.belt} roughness={0.6} metalness={0.15} side={THREE.DoubleSide} />
        </mesh>
      )}
      {outfit === 'shirt' && (
        <group>
          {[-0.02, 0.05, 0.12, 0.19].map((y) => (
            <mesh key={y} position={[0, y, spec.chestZ + 0.002 - Math.abs(y - 0.1) * 0.03]} rotation={[Math.PI / 2, 0, 0]} geometry={GEO.button} material={accentMat} />
          ))}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.035, 0.262, 0.05]} rotation={[0.5, side * 0.4, side * 0.6]} scale={[0.05, 0.035, 0.008]} geometry={G.unitBox} material={torsoMat} />
          ))}
        </group>
      )}
      {outfit === 'jacket' && (
        <group>
          {/* open jacket showing the tee underneath */}
          <RoundedBox args={[0.09, 0.36, 0.02]} radius={0.008} position={[0, 0.02, spec.chestZ - 0.012]} material={innerMat} />
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.05, 0.19, spec.chestZ - 0.004]} rotation={[0, 0, side * 0.35]} scale={[0.03, 0.14, 0.014]} geometry={G.unitBox} material={torsoMat} />
          ))}
        </group>
      )}
      {outfit === 'hoodie' && (
        <group>
          <mesh position={[0, 0.27, -0.012]} rotation={[0.18, 0, Math.PI]} geometry={GEO.hood} material={torsoMat} />
          <RoundedBox args={[0.19, 0.1, 0.026]} radius={0.012} position={[0, -0.065, spec.chestZ - 0.008]} material={accentMat} />
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.025, 0.18, spec.chestZ + 0.002]} scale={[0.004, 0.07, 0.004]} geometry={G.unitBox} material={M.sneakerWhite} />
          ))}
        </group>
      )}
      <mesh position={[0, 0.315 - (1 - spec.neck[1]) * 0.05, 0.006]} scale={[spec.neck[0], spec.neck[1], spec.neck[0]]} geometry={GEO.neck} material={neckMat} />
      {c?.torsoOverlay}
      {c?.chest && <group position={[0, 0.025, spec.chestZ]}>{c.chest}</group>}
      {c?.backMount && <group position={[0, 0.035, spec.backZ]}>{c.backMount}</group>}
      {c?.cape && (
        <group position={[0, 0.24, spec.backZ + 0.02]} rotation={[seated ? 0.35 : 0.06, 0, 0]}>
          <mesh
            scale={[c.cape.width ?? 0.4, (c.cape.length ?? 0.62) * (seated ? 0.62 : 1), 1]}
            geometry={GEO.cape}
            castShadow
          >
            <meshStandardMaterial color={c.cape.color} roughness={0.78} side={THREE.DoubleSide} {...microSurface('fabric')} />
          </mesh>
        </group>
      )}
      {c?.coat && coatGeo && (
        <mesh position={[0, -0.2 - coatLen / 2, coatTop.off]} scale={[coatTop.rx * 1.08, coatLen, coatTop.rz * 1.12]} geometry={coatGeo} castShadow>
          <meshStandardMaterial color={c.coat.color} roughness={0.72} side={THREE.DoubleSide} {...microSurface('fabric')} />
        </mesh>
      )}
    </group>
  )
}

/* ── the character ──────────────────────────────────────────────────────── */
export function Character({
  agent,
  pose,
  costume: c
}: {
  agent: Agent
  pose: Pose
  costume?: CharacterCostume
}) {
  const h = hashId(agent.id)

  /* civilian identity — every trait hashed from a different bit range */
  const civFemale = (h >>> 7) % 2 === 0
  const shapeKey: TorsoShape = c?.torsoShape ?? (c ? 'default' : civFemale ? 'female' : 'default')
  const spec = SHAPES[shapeKey]
  const skin = c?.skin ?? SKIN_TONES[h % SKIN_TONES.length]
  const hairColor = c?.hair ?? CREATOR_HAIR_COLORS[(h >>> 2) % CREATOR_HAIR_COLORS.length]
  const civStyles = civFemale ? [2, 4, 5, 6, 3] : [0, 1, 3, 6, 7]
  const hairStyle = c?.hairStyle ?? civStyles[(h >>> 1) % civStyles.length]
  const hairLong = c?.hairLong ?? (civFemale && (h >>> 9) % 3 === 0 && hairStyle !== 5)

  const eyewear: 'none' | 'sunglasses' | 'glasses' = c
    ? c.sunglasses
      ? 'sunglasses'
      : c.glasses
        ? 'glasses'
        : 'none'
    : (h >>> 3) % 6 === 1
      ? 'sunglasses'
      : (h >>> 3) % 6 === 3
        ? 'glasses'
        : 'none'
  const hasHeadphones = c?.headphones ?? (c ? false : (h >>> 2) % 3 === 0)
  const outfit: Outfit = c
    ? c.hoodie
      ? 'hoodie'
      : 'suit'
    : (['tee', 'hoodie', 'jacket', 'shirt'] as const)[(h >>> 4) % 4]
  const expression: Expression = c?.expression ?? ((h >>> 10) % 3 === 0 ? 'smile' : 'neutral')
  const civBeard = !c && !civFemale && (h >>> 8) % 4 === 0 ? hairColor : undefined

  const primaryHue = agent.hue
  const shirtColor = c?.shirt ?? `hsl(${primaryHue}, 52%, 44%)`
  const accentColor = c?.accent ?? `hsl(${(primaryHue + 40) % 360}, 38%, 30%)`
  const innerColor = `hsl(${(primaryHue + 180) % 360}, 18%, 88%)`
  const pantsColor = c?.pants ?? PANTS_COLORS[(h >>> 5) % PANTS_COLORS.length]
  const eyeColor = c?.eyes ?? ['#4a3222', '#2f4f6e', '#3d5a36', '#5b3b24'][(h >>> 11) % 4]

  const skinMat = useMemo(() => new THREE.MeshStandardMaterial({ color: skin, roughness: 0.56, ...microSurface('skin') }), [skin])
  const hairMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: hairColor === 'none' ? '#222' : hairColor, roughness: 0.66, ...microSurface('fabric') }),
    [hairColor]
  )
  const eyeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: eyeColor, roughness: 0.24 }), [eyeColor])
  const shirtMat = useMemo(() => new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.82, ...microSurface('fabric') }), [shirtColor])
  const accentMat = useMemo(() => new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.76, ...microSurface('fabric') }), [accentColor])
  const innerMat = useMemo(() => new THREE.MeshStandardMaterial({ color: innerColor, roughness: 0.85, ...microSurface('fabric') }), [innerColor])
  const pantsMat = useMemo(() => new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.86, ...microSurface('fabric') }), [pantsColor])
  /* streetwear keeps contrast rolled-cuff sleeves over skin; costumed heroes
   * wear uniform sleeves — a bright accent arm reads as an oven mitt */
  const armColor = c?.arms ?? (c ? shirtColor : skin)
  const armMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: armColor, roughness: 0.72, ...microSurface(c?.arms ? 'skin' : 'fabric') }),
    [armColor, c?.arms]
  )
  const shoeColor = c?.shoes ?? accentColor
  const bootMat = useMemo(
    () => c?.bootMaterial ?? new THREE.MeshStandardMaterial({ color: shoeColor, roughness: 0.55, ...microSurface('fabric') }),
    [c?.bootMaterial, shoeColor]
  )

  const mask: 'none' | 'full' | 'cowl' = c?.mask === 'spidey' || c?.mask === 'full' ? 'full' : c?.mask === 'cowl' ? 'cowl' : 'none'
  const maskMat = c?.maskMaterial ?? hairMat
  const torsoMat = c?.torsoMaterial ?? shirtMat
  const pelvisMat = c?.pelvisMaterial ?? pantsMat
  const upperArmMat = c?.sleeveMaterial ?? (c?.arms ? armMat : shirtMat)
  const forearmMat = c?.forearmMaterial ?? (c ? armMat : outfit === 'jacket' || outfit === 'hoodie' ? shirtMat : skinMat)
  const handMat = c?.handMaterial ?? skinMat
  const thighMat = c?.thighMaterial ?? pantsMat
  const calfMat = c?.calfMaterial ?? (c?.shorts ? skinMat : pantsMat)
  const neckMat = mask === 'full' ? maskMat : skinMat

  const ph = c?.physique ?? {}
  const armGirth = ph.arms ?? (civFemale && !c ? 1.0 : 1.1)
  const legGirth = ph.legs ?? (civFemale && !c ? 1.02 : 1.08)
  const armLen = ph.armLength ?? 1
  const handScale = ph.hands ?? 1
  const headScale = ph.head ?? 1
  const foot: FootSpec = {
    kind: c?.footwear ?? (c ? 'boot' : 'sneaker'),
    upper: shoeColor,
    bootMat,
    bootHeight: c?.bootHeight ?? (c ? 0.16 : 0),
    skinMat
  }
  const legSet: LegSetProps = { thighMat, calfMat, girth: legGirth, hipX: spec.hipX, foot, hem: !!c?.shorts }

  const build = (c?.scale ?? 1) * (0.96 + ((h >>> 5) % 8) / 100)

  const root = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const elbowL = useRef<THREE.Group>(null)
  const elbowR = useRef<THREE.Group>(null)
  const seed = (h % 100) / 17
  const splay = spec.armSplay

  const typing = agent.status === 'working'
  const dozing = pose === 'slump' || pose === 'slumpStand'

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed

    // breathing
    if (torso.current) {
      const rate = dozing ? 0.8 : 1.7
      const depth = dozing ? 0.022 : 0.01
      const b = 1 + Math.sin(t * rate) * depth
      torso.current.scale.set(1 + (b - 1) * 0.35, b, 1 + (b - 1) * 0.2)
      if (pose === 'slumpStand') torso.current.rotation.z = Math.sin(t * 0.7) * 0.018
    }

    // head tilts & wandering gaze
    if (headRef.current) {
      if (pose === 'slump') {
        headRef.current.rotation.x = 0.46 + Math.sin(t * 0.5) * 0.035
        headRef.current.rotation.y = Math.sin(t * 0.23 + seed * 3) * 0.11
        headRef.current.rotation.z = 0.1 + Math.sin(t * 0.31) * 0.035
      } else if (pose === 'slumpStand') {
        headRef.current.rotation.x = 0.24 + Math.sin(t * 0.5) * 0.025
        headRef.current.rotation.y = Math.sin(t * 0.19) * 0.045
        headRef.current.rotation.z = 0
      } else {
        const wander = Math.sin(t * 0.4) * 0.13 + Math.sin(t * 0.13) * 0.06
        headRef.current.rotation.y = typing ? wander * 0.75 : wander * 1.1 + Math.sin(t * 0.21 + seed * 2.7) * 0.16
        headRef.current.rotation.x =
          pose === 'standWork'
            ? -0.03 + Math.sin(t * 0.5) * 0.018
            : typing
              ? 0.08 + Math.sin(t * 7) * 0.005
              : Math.sin(t * 0.5) * 0.035
        headRef.current.rotation.z = Math.sin(t * 0.3) * 0.018
      }
    }

    // arms
    if (armL.current && armR.current && elbowL.current && elbowR.current) {
      if (pose === 'standWork') {
        const g = Math.max(0, Math.sin(t * 0.42 + seed * 9.7))
        const gesture = g * g * g * g
        armL.current.rotation.x = -0.48 + Math.sin(t * 8) * 0.025
        armL.current.rotation.z = splay - 0.01
        armR.current.rotation.x = -0.48 - gesture * 0.28 + Math.cos(t * 10) * 0.025
        armR.current.rotation.z = -splay + 0.01 - gesture * 0.14
        elbowL.current.rotation.x = -0.82 + Math.sin(t * 11) * 0.035
        elbowR.current.rotation.x = -0.78 - gesture * 0.38 + Math.cos(t * 13) * 0.035
      } else if (typing && pose === 'sit') {
        const g = Math.max(0, Math.sin(t * 0.38 + seed * 9.7))
        const stretch = g * g * g * g * g
        armL.current.rotation.x = -0.38 + Math.sin(t * 10) * 0.035
        armL.current.rotation.z = splay * 0.7
        armR.current.rotation.x = -0.38 - stretch * 0.34 + Math.cos(t * 12) * 0.035
        armR.current.rotation.z = -splay * 0.7 - stretch * 0.18
        elbowL.current.rotation.x = -0.78 + Math.sin(t * 12) * 0.06
        elbowR.current.rotation.x = -0.76 - stretch * 0.45 + Math.cos(t * 14) * 0.06
      } else if (pose === 'lounge') {
        armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, -0.52, 0.08)
        armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, -0.52, 0.08)
        elbowL.current.rotation.x = THREE.MathUtils.lerp(elbowL.current.rotation.x, -0.9, 0.08)
        elbowR.current.rotation.x = THREE.MathUtils.lerp(elbowR.current.rotation.x, -0.9, 0.08)
      } else if (pose === 'slump') {
        armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, 0.08, 0.08)
        armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, 0.12, 0.08)
        elbowL.current.rotation.x = THREE.MathUtils.lerp(elbowL.current.rotation.x, -0.18, 0.08)
        elbowR.current.rotation.x = THREE.MathUtils.lerp(elbowR.current.rotation.x, -0.2, 0.08)
      } else {
        armL.current.rotation.x = THREE.MathUtils.lerp(armL.current.rotation.x, -0.08, 0.08)
        armR.current.rotation.x = THREE.MathUtils.lerp(armR.current.rotation.x, -0.08, 0.08)
        armL.current.rotation.z = THREE.MathUtils.lerp(armL.current.rotation.z, splay, 0.08)
        armR.current.rotation.z = THREE.MathUtils.lerp(armR.current.rotation.z, -splay, 0.08)
        elbowL.current.rotation.x = THREE.MathUtils.lerp(elbowL.current.rotation.x, -0.16, 0.08)
        elbowR.current.rotation.x = THREE.MathUtils.lerp(elbowR.current.rotation.x, -0.16, 0.08)
      }
    }
  })

  const head = (
    <group ref={headRef} scale={headScale}>
      <Head
        skinMat={skinMat}
        hairMat={hairMat}
        eyeMat={eyeMat}
        maskMat={maskMat}
        hairStyle={hairStyle}
        hairLong={hairLong}
        hideHair={hairColor === 'none'}
        eyewear={eyewear}
        headphones={hasHeadphones}
        mask={mask}
        beard={c?.beard ?? civBeard}
        headgear={c?.headgear}
        expression={expression}
        heavyBrow={!!c?.heavyBrow}
        jaw={c?.jaw ?? 1}
      />
    </group>
  )

  const cuff = !c && outfit !== 'tee'
  const arm = (side: -1 | 1, ref: RefObject<THREE.Group | null>, elbowRef: RefObject<THREE.Group | null>, x: number, z: number, rot: readonly [number, number, number]) => (
    <group ref={ref} position={[side * x, spec.armY, z]} rotation={rot as [number, number, number]}>
      <Arm
        side={side}
        upperMat={upperArmMat}
        forearmMat={forearmMat}
        handMat={handMat}
        elbowRef={elbowRef}
        handContent={side === 1 ? c?.rightHand : c?.leftHand}
        girth={armGirth}
        forearm={ph.forearms ?? 1}
        len={armLen}
        handScale={handScale}
        cuff={cuff}
        shoulderMount={c?.shoulderMount}
        forearmMount={c?.forearmMount}
      />
    </group>
  )
  const torsoProps = { spec, torsoMat, pelvisMat, accentMat, neckMat, innerMat, costume: c, outfit }
  const headPos = (z: number): [number, number, number] => [0, spec.headY, z + spec.headZ]

  if (pose === 'stand' || pose === 'standWork' || pose === 'slumpStand') {
    const lean = (pose === 'slumpStand' ? 0.54 : pose === 'standWork' ? 0.08 : 0) + (c?.hunch ?? 0)
    return (
      <group ref={root} scale={build}>
        <StandingLegs {...legSet} />
        <group ref={torso} position={[0, 0.94, 0]} rotation={[lean, 0, 0]}>
          <Torso {...torsoProps} seated={false} />
          {arm(-1, armL, elbowL, spec.armX, 0.004, [0, 0, 0])}
          {arm(1, armR, elbowR, spec.armX, 0.004, [0, 0, 0])}
          <group position={headPos(0.014)} rotation={[-(c?.hunch ?? 0) * 0.8, 0, 0]}>
            {head}
          </group>
        </group>
      </group>
    )
  }

  if (pose === 'lounge') {
    return (
      <group ref={root} scale={build} position={[0, 0.13 * (1 - build), 0]}>
        <group ref={torso} position={[0, 0.18, -0.04]} rotation={[-0.28, 0, 0]}>
          <Torso {...torsoProps} seated />
          {arm(-1, armL, elbowL, spec.armX, 0.02, [-0.52, 0, 0.06])}
          {arm(1, armR, elbowR, spec.armX, 0.02, [-0.52, 0, -0.06])}
          <group position={headPos(0.02)}>{head}</group>
        </group>
        <group position={[0, 0.36, 0.27]} rotation={[0.5, 0, 0]}>
          <mesh geometry={GEO.laptopBase} material={M.metalMid} />
          <group position={[0, 0.008, -0.095]} rotation={[-0.62, 0, 0]}>
            <mesh position={[0, 0.095, 0]} geometry={GEO.laptopLid} material={M.metalMid} />
            <mesh position={[0, 0.095, 0.008]} geometry={GEO.laptopScreen} material={M.laptopScreen} />
          </group>
        </group>
        <LoungeLegs {...legSet} />
      </group>
    )
  }

  const slump = pose === 'slump'
  return (
    <group ref={root} scale={build} position={[0, 0.53 * (1 - build), 0]}>
      <SeatedLegs {...legSet} build={build} />
      <group ref={torso} position={[0, 0.73, slump ? 0.04 : 0]} rotation={[slump ? 0.38 : (c?.hunch ?? 0) * 0.5, 0, 0]}>
        <Torso {...torsoProps} seated />
        {arm(-1, armL, elbowL, spec.armX, 0.025, [slump ? 0.08 : -0.38, 0, 0.08])}
        {arm(1, armR, elbowR, spec.armX, 0.025, [slump ? 0.12 : -0.38, 0, -0.08])}
        <group position={headPos(0.02)}>{head}</group>
      </group>
    </group>
  )
}
