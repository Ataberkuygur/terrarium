/* ── Avengers Compound — the iconic pieces ─────────────────────────────
 *  · ArmorHall     five lit display pods along the back wall, each holding
 *                  a full-size suit (Mk II silver, War Machine, Mk 42 gold,
 *                  Mk III, Mk 85) — glowing reactor, eyes and repulsors.
 *  · ShieldDisplay Cap's shield upright on a white plinth.
 *  · MissionWall   the big left-wall screen: dotted world map + telemetry.
 *  · MjolnirPedestal  the hammer resting head-down on a stone plinth.
 *  · Quinjet       parked on the pad outside the glazing.
 *  · WallEmblem    big backlit Avengers "A" over the bar.
 *
 * Same discipline as the rest of the theme: repeated sub-meshes are baked
 * into module-level matrices and drawn once through <Inst>; geometry and
 * materials at module scope; nothing here runs per frame. */
import * as THREE from 'three'
import type { JSX } from 'react'
import { AG, AM, Inst, mT, mR, mS, glowMat, lightMat, fadeTexture, glowTexture } from './shared'
import { P } from './palette'
import { ARMOR_HALL, WALL_EMBLEM } from './layout'
import { profileSolid, beveledBox, type ProfileRing } from '../ModelGeometry'

/* ══ Iron suit — part geometry (suit-local, feet at y 0, faces +z) ═══ */
const SG = {
  boot: beveledBox(0.145, 0.11, 0.29, 0.04),
  shin: profileSolid(
    [
      [0.08, 0.07, 0.076],
      [0.28, 0.084, 0.092],
      [0.46, 0.072, 0.08],
      [0.52, 0.062, 0.068]
    ] as ProfileRing[],
    16
  ),
  knee: new THREE.SphereGeometry(0.062, 14, 10),
  thigh: profileSolid(
    [
      [0.54, 0.074, 0.08],
      [0.72, 0.098, 0.104],
      [0.9, 0.108, 0.112],
      [0.96, 0.1, 0.104]
    ] as ProfileRing[],
    16
  ),
  pelvis: profileSolid(
    [
      [0.86, 0.1, 0.09],
      [0.94, 0.165, 0.115],
      [1.02, 0.175, 0.12],
      [1.08, 0.15, 0.105]
    ] as ProfileRing[],
    20
  ),
  abdomen: profileSolid(
    [
      [1.05, 0.135, 0.095],
      [1.14, 0.142, 0.1],
      [1.22, 0.15, 0.105]
    ] as ProfileRing[],
    20
  ),
  chest: profileSolid(
    [
      [1.2, 0.155, 0.108],
      [1.3, 0.2, 0.13, 0.01],
      [1.42, 0.225, 0.14, 0.015],
      [1.52, 0.215, 0.125, 0.005],
      [1.58, 0.15, 0.1],
      [1.6, 0.08, 0.07]
    ] as ProfileRing[],
    24
  ),
  pauldron: new THREE.SphereGeometry(0.1, 16, 12),
  /* arm pieces hang from their pivot (y 0) downward */
  upperArm: profileSolid(
    [
      [-0.3, 0.058, 0.062],
      [-0.15, 0.07, 0.072],
      [0, 0.072, 0.074]
    ] as ProfileRing[],
    14
  ),
  forearm: profileSolid(
    [
      [-0.27, 0.074, 0.078],
      [-0.19, 0.082, 0.085],
      [-0.08, 0.07, 0.073],
      [0, 0.056, 0.056]
    ] as ProfileRing[],
    14
  ),
  hand: new THREE.SphereGeometry(0.055, 12, 10),
  neck: new THREE.CylinderGeometry(0.055, 0.065, 0.08, 14),
  helmet: profileSolid(
    [
      [1.62, 0.07, 0.08],
      [1.66, 0.1, 0.11],
      [1.76, 0.108, 0.12],
      [1.84, 0.098, 0.112],
      [1.89, 0.07, 0.085],
      [1.915, 0.02, 0.03]
    ] as ProfileRing[],
    20
  ),
  face: new THREE.SphereGeometry(0.1, 16, 12),
  eye: new THREE.BoxGeometry(0.042, 0.011, 0.01),
  reactorRing: new THREE.TorusGeometry(0.042, 0.009, 8, 24),
  reactorCore: new THREE.CircleGeometry(0.036, 20),
  palm: new THREE.CircleGeometry(0.022, 14),
  cannon: new THREE.CylinderGeometry(0.035, 0.04, 0.34, 12),
  cannonBarrel: new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8)
} as const

type Slot = 'red' | 'gold' | 'silver' | 'gun' | 'dark'
interface Scheme {
  helmet: Slot
  face: Slot
  chest: Slot
  abdomen: Slot
  pelvis: Slot
  pauldron: Slot
  upperArm: Slot
  forearm: Slot
  hand: Slot
  thigh: Slot
  knee: Slot
  shin: Slot
  boot: Slot
  cannon?: boolean
  eyes: string
}
const SLOT_MAT: Record<Slot, THREE.Material> = {
  red: AM.ironRed,
  gold: AM.ironGold,
  silver: AM.steelHi,
  gun: AM.warMachine,
  dark: AM.darkMetal
}
const MK_II: Scheme = {
  helmet: 'silver',
  face: 'silver',
  chest: 'silver',
  abdomen: 'dark',
  pelvis: 'silver',
  pauldron: 'silver',
  upperArm: 'silver',
  forearm: 'silver',
  hand: 'silver',
  thigh: 'silver',
  knee: 'dark',
  shin: 'silver',
  boot: 'silver',
  eyes: '#d9f5ff'
}
const WAR_MACHINE: Scheme = {
  helmet: 'gun',
  face: 'silver',
  chest: 'gun',
  abdomen: 'dark',
  pelvis: 'gun',
  pauldron: 'gun',
  upperArm: 'dark',
  forearm: 'gun',
  hand: 'dark',
  thigh: 'gun',
  knee: 'dark',
  shin: 'gun',
  boot: 'gun',
  cannon: true,
  eyes: '#ffffff'
}
const MK_42: Scheme = {
  helmet: 'red',
  face: 'gold',
  chest: 'gold',
  abdomen: 'red',
  pelvis: 'gold',
  pauldron: 'gold',
  upperArm: 'red',
  forearm: 'gold',
  hand: 'gold',
  thigh: 'gold',
  knee: 'red',
  shin: 'gold',
  boot: 'gold',
  eyes: '#d9f5ff'
}
const MK_III: Scheme = {
  helmet: 'red',
  face: 'gold',
  chest: 'red',
  abdomen: 'gold',
  pelvis: 'red',
  pauldron: 'red',
  upperArm: 'gold',
  forearm: 'red',
  hand: 'red',
  thigh: 'gold',
  knee: 'red',
  shin: 'red',
  boot: 'red',
  eyes: '#d9f5ff'
}
const MK_85: Scheme = { ...MK_III, upperArm: 'red', thigh: 'red', shin: 'gold', pelvis: 'gold' }
/** left → right along the back wall; the Mk 85 hero suit takes the centre pod */
const SUITS: Scheme[] = [MK_II, WAR_MACHINE, MK_85, MK_III, MK_42]

/* arm chain — shoulder pivot, slight outward swing, soft elbow bend */
function armMats(side: -1 | 1) {
  const shoulder = mT(side * 0.265, 1.49, 0).multiply(mR(0.04, 0, side * 0.13))
  const elbow = shoulder
    .clone()
    .multiply(mT(0, -0.3, 0))
    .multiply(mR(-0.16, 0, -side * 0.05))
  const wrist = elbow.clone().multiply(mT(0, -0.29, 0))
  return { shoulder, elbow, wrist }
}
const ARMS = { L: armMats(-1), R: armMats(1) }

/** part → its local matrices (both sides for paired limbs) */
const PART_LOCAL: Record<keyof Omit<Scheme, 'cannon' | 'eyes'>, { geo: THREE.BufferGeometry; local: THREE.Matrix4[] }> =
  {
    boot: { geo: SG.boot, local: [-1, 1].map((s) => mT(s * 0.1, 0.05, 0.035)) },
    shin: { geo: SG.shin, local: [-1, 1].map((s) => mT(s * 0.1, 0, 0)) },
    knee: { geo: SG.knee, local: [-1, 1].map((s) => mT(s * 0.1, 0.53, 0.015).multiply(mS(1, 1, 1.05))) },
    thigh: { geo: SG.thigh, local: [-1, 1].map((s) => mT(s * 0.1, 0, 0)) },
    pelvis: { geo: SG.pelvis, local: [mT(0, 0, 0)] },
    abdomen: { geo: SG.abdomen, local: [mT(0, 0, 0.005)] },
    chest: { geo: SG.chest, local: [mT(0, 0, 0)] },
    pauldron: {
      geo: SG.pauldron,
      local: [-1, 1].map((s) =>
        mT(s * 0.255, 1.525, 0)
          .multiply(mR(0, 0, -s * 0.35))
          .multiply(mS(1.3, 0.72, 1.18))
      )
    },
    upperArm: { geo: SG.upperArm, local: [ARMS.L.shoulder, ARMS.R.shoulder] },
    forearm: { geo: SG.forearm, local: [ARMS.L.elbow, ARMS.R.elbow] },
    hand: {
      geo: SG.hand,
      local: [ARMS.L.wrist, ARMS.R.wrist].map((w) =>
        w
          .clone()
          .multiply(mT(0, -0.04, 0))
          .multiply(mS(0.85, 1.25, 0.65))
      )
    },
    helmet: { geo: SG.helmet, local: [mT(0, 0, -0.005)] },
    face: { geo: SG.face, local: [mT(0, 1.745, 0.05).multiply(mS(0.92, 1.1, 0.72))] }
  }

/* ══ display pods ════════════════════════════════════════════════════
 * Pod-local: the pod faces +z, straight into the room off the back wall.
 * Width 1.3, depth 0.9, height 3.0. */
const POD = { w: 1.3, d: 0.9, h: 3.0 } as const
const PED_TOP = 0.16
const PODS = Array.from({ length: ARMOR_HALL.count }, (_, i) => ARMOR_HALL.x0 + i * ARMOR_HALL.pitch)
/** pod roots in world space — +z of the pod points into the room */
const POD_ROOT = PODS.map((x) => mT(x, 0, ARMOR_HALL.z))
const SUIT_ROOT = POD_ROOT.map((r, i) =>
  r
    .clone()
    .multiply(mT(0, PED_TOP, 0.44))
    .multiply(mR(0, (i - 2) * -0.06, 0))
)

const podMats = {
  back: new THREE.MeshStandardMaterial({ color: '#1d2129', roughness: 0.5, metalness: 0.4 }),
  backlight: new THREE.MeshBasicMaterial({
    color: '#dff3ff',
    map: fadeTexture(),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),
  cone: new THREE.MeshBasicMaterial({
    color: '#fff1d6',
    map: fadeTexture(),
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
}

const across = (f: (r: THREE.Matrix4, i: number) => THREE.Matrix4[]) => POD_ROOT.flatMap(f)
const POD_BACK = across((r) => [
  r
    .clone()
    .multiply(mT(0, POD.h / 2, 0.03))
    .multiply(mS(POD.w, POD.h, 0.06))
])
const POD_FIN = across((r) =>
  [-1, 1].map((s) =>
    r
      .clone()
      .multiply(mT(s * (POD.w / 2), POD.h / 2, POD.d / 2))
      .multiply(mS(0.08, POD.h, POD.d))
  )
)
const POD_HEADER = across((r) => [
  r
    .clone()
    .multiply(mT(0, POD.h - 0.14, POD.d / 2))
    .multiply(mS(POD.w, 0.28, POD.d))
])
const POD_HEAD_STRIP = across((r) => [
  r
    .clone()
    .multiply(mT(0, POD.h - 0.2, POD.d + 0.003))
    .multiply(mS(POD.w - 0.2, 0.018, 0.01))
])
const POD_DOWNLIGHT = across((r) => [
  r
    .clone()
    .multiply(mT(0, POD.h - 0.285, POD.d / 2))
    .multiply(mR(Math.PI / 2, 0, 0))
    .multiply(mS(0.5, 0.5, 1))
])
const POD_BACKLIGHT = across((r) => [
  r
    .clone()
    .multiply(mT(0, 1.15, 0.065))
    .multiply(mS(0.95, 2.3, 1))
])
const POD_CONE = across((r) =>
  [0, Math.PI / 2].map((a) =>
    r
      .clone()
      .multiply(mT(0, 1.4, 0.44))
      .multiply(mR(0, a, 0))
      .multiply(mR(Math.PI, 0, 0))
      .multiply(mS(0.95, 2.7, 1))
  )
)
const POD_PED = across((r) => [
  r
    .clone()
    .multiply(mT(0, PED_TOP / 2, 0.44))
    .multiply(mS(0.84, PED_TOP, 0.84))
])
const POD_PED_RING = across((r) => [
  r
    .clone()
    .multiply(mT(0, PED_TOP + 0.002, 0.44))
    .multiply(mR(Math.PI / 2, 0, 0))
    .multiply(mS(0.41, 0.41, 1.4))
])
const POD_GLASS = across((r) => [
  r
    .clone()
    .multiply(mT(0, (POD.h - 0.28) / 2, POD.d - 0.01))
    .multiply(mS(POD.w - 0.08, POD.h - 0.28, 1))
])
const POD_SHEEN = across((r) => [
  r
    .clone()
    .multiply(mT(0.25, 1.4, POD.d - 0.005))
    .multiply(mR(0, 0, 0.4))
    .multiply(mS(0.14, 3.0, 1))
])
const POD_FLOOR_GLOW = across((r) => [
  r
    .clone()
    .multiply(mT(0, 0.01, POD.d + 0.35))
    .multiply(mR(-Math.PI / 2, 0, 0))
    .multiply(mS(1.6, 1.3, 1))
])
const POD_PLATE = across((r) => [
  r
    .clone()
    .multiply(mT(0, PED_TOP * 0.55, 0.44 + 0.425))
    .multiply(mS(0.26, 0.05, 0.01))
])
const glassSheenMat = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.06,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide
})

/* suit draw list — one <Inst> per (part, material) across all five pods */
const SUIT_DRAW: { geo: THREE.BufferGeometry; mat: THREE.Material; mats: THREE.Matrix4[] }[] = []
{
  for (const [part, spec] of Object.entries(PART_LOCAL) as [
    keyof typeof PART_LOCAL,
    (typeof PART_LOCAL)[keyof typeof PART_LOCAL]
  ][]) {
    const bySlot = new Map<Slot, THREE.Matrix4[]>()
    SUITS.forEach((scheme, i) => {
      const slot = scheme[part]
      const list = bySlot.get(slot) ?? []
      for (const l of spec.local) list.push(SUIT_ROOT[i].clone().multiply(l))
      bySlot.set(slot, list)
    })
    for (const [slot, mats] of bySlot) SUIT_DRAW.push({ geo: spec.geo, mat: SLOT_MAT[slot], mats })
  }
}
const NECK = SUIT_ROOT.map((r) => r.clone().multiply(mT(0, 1.6, 0)))
const EYES = SUIT_ROOT.flatMap((r) =>
  [-1, 1].map((s) =>
    r
      .clone()
      .multiply(mT(s * 0.037, 1.772, 0.121))
      .multiply(mR(0, s * 0.28, -s * 0.12))
  )
)
const REACTOR_RING = SUIT_ROOT.map((r) =>
  r
    .clone()
    .multiply(mT(0, 1.405, 0.152))
    .multiply(mR(-0.12, 0, 0))
)
const REACTOR_CORE = SUIT_ROOT.map((r) =>
  r
    .clone()
    .multiply(mT(0, 1.405, 0.153))
    .multiply(mR(-0.12, 0, 0))
)
const REACTOR_GLOW = SUIT_ROOT.map((r) =>
  r
    .clone()
    .multiply(mT(0, 1.405, 0.17))
    .multiply(mS(0.34, 0.34, 1))
)
const PALMS = SUIT_ROOT.flatMap((r) =>
  [ARMS.L.wrist, ARMS.R.wrist].map((w, k) =>
    r
      .clone()
      .multiply(w)
      .multiply(mT(k ? -0.045 : 0.045, -0.045, 0.01))
      .multiply(mR(0, k ? -Math.PI / 2 : Math.PI / 2, 0))
  )
)
const CANNON = SUIT_ROOT.flatMap((r, i) =>
  SUITS[i].cannon
    ? [
        r
          .clone()
          .multiply(mT(0.2, 1.64, -0.06))
          .multiply(mR(Math.PI / 2 - 0.15, 0, 0))
      ]
    : []
)
const CANNON_BARREL = SUIT_ROOT.flatMap((r, i) =>
  SUITS[i].cannon
    ? [-1, 1].map((s) =>
        r
          .clone()
          .multiply(mT(0.2 + s * 0.016, 1.665, 0.17))
          .multiply(mR(Math.PI / 2 - 0.15, 0, 0))
      )
    : []
)
const eyeMat = lightMat('#e8fbff')

export function ArmorHall(): JSX.Element {
  return (
    <group>
      {/* pod shells — graphite back, white fins + header, lit strips */}
      <Inst geo={AG.unitBox} mat={podMats.back} mats={POD_BACK} receiveShadow />
      <Inst geo={AG.unitBox} mat={AM.whiteGloss} mats={POD_FIN} castShadow receiveShadow />
      <Inst geo={AG.unitBox} mat={AM.whitePanel} mats={POD_HEADER} castShadow />
      <Inst geo={AG.unitBox} mat={AM.holoSolid} mats={POD_HEAD_STRIP} />
      <Inst geo={AG.disc} mat={lightMat('#fff4e0')} mats={POD_DOWNLIGHT} />
      <Inst geo={AG.unitPlane} mat={podMats.backlight} mats={POD_BACKLIGHT} />
      <Inst geo={AG.unitPlane} mat={podMats.cone} mats={POD_CONE} />
      <Inst geo={AG.cylHi} mat={AM.graphite} mats={POD_PED} receiveShadow />
      <Inst geo={AG.ring} mat={AM.holoSolid} mats={POD_PED_RING} />
      <Inst geo={AG.unitBox} mat={lightMat('#ffd9a0')} mats={POD_PLATE} />

      {/* the suits */}
      {SUIT_DRAW.map((d, i) => (
        <Inst key={i} geo={d.geo} mat={d.mat} mats={d.mats} castShadow />
      ))}
      <Inst geo={SG.neck} mat={AM.darkMetal} mats={NECK} />
      <Inst geo={SG.eye} mat={eyeMat} mats={EYES} />
      <Inst geo={SG.reactorRing} mat={AM.arcRing} mats={REACTOR_RING} />
      <Inst geo={SG.reactorCore} mat={AM.arcCore} mats={REACTOR_CORE} />
      <Inst geo={AG.unitPlane} mat={glowMat(P.arcRing, 0.6)} mats={REACTOR_GLOW} />
      <Inst geo={SG.palm} mat={AM.arcCore} mats={PALMS} />
      <Inst geo={SG.cannon} mat={AM.darkMetal} mats={CANNON} castShadow />
      <Inst geo={SG.cannonBarrel} mat={AM.steel} mats={CANNON_BARREL} />

      {/* glass fronts + sheen, warm light pooled on the floor */}
      <Inst geo={AG.unitPlane} mat={AM.glass} mats={POD_GLASS} />
      <Inst geo={AG.unitPlane} mat={glassSheenMat} mats={POD_SHEEN} />
      <Inst geo={AG.unitPlane} mat={glowMat('#ffe2b5', 0.22)} mats={POD_FLOOR_GLOW} />
    </group>
  )
}

/* ══ Cap's shield — upright on a white display plinth ════════════════ */
function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer
    const a = Math.PI / 2 + (i * Math.PI) / 5
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  return s
}
const STAR_GEO = new THREE.ExtrudeGeometry(starShape(0.1, 0.04), { depth: 0.012, bevelEnabled: false })
/** shallow dish — a sphere cap, so the rings read convex like the real shield */
function dish(r: number, depth: number): THREE.BufferGeometry {
  const R = (r * r + depth * depth) / (2 * depth)
  const theta = Math.asin(r / R)
  const g = new THREE.SphereGeometry(R, 48, 8, 0, Math.PI * 2, 0, theta)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, -(R - depth))
  return g
}
const SHIELD_RINGS: { geo: THREE.BufferGeometry; mat: THREE.Material; z: number }[] = [
  {
    geo: dish(0.38, 0.07),
    mat: new THREE.MeshPhysicalMaterial({ color: P.shieldRed, roughness: 0.3, metalness: 0.5, clearcoat: 0.8 }),
    z: 0
  },
  {
    geo: dish(0.3, 0.045),
    mat: new THREE.MeshPhysicalMaterial({ color: P.shieldWhite, roughness: 0.3, metalness: 0.5, clearcoat: 0.8 }),
    z: 0.026
  },
  {
    geo: dish(0.22, 0.026),
    mat: new THREE.MeshPhysicalMaterial({ color: P.shieldRed, roughness: 0.3, metalness: 0.5, clearcoat: 0.8 }),
    z: 0.046
  },
  {
    geo: dish(0.145, 0.013),
    mat: new THREE.MeshPhysicalMaterial({ color: P.shieldBlue, roughness: 0.3, metalness: 0.5, clearcoat: 0.8 }),
    z: 0.06
  }
]
const shieldBack = new THREE.MeshStandardMaterial({ color: '#8f969f', roughness: 0.4, metalness: 0.8 })

export function ShieldDisplay(): JSX.Element {
  return (
    <group>
      {/* stepped white plinth with a lit reveal */}
      <mesh position={[0, 0.04, 0]} scale={[1.0, 0.08, 1.0]} geometry={AG.cylHi} material={AM.graphite} receiveShadow />
      <mesh
        position={[0, 0.45, 0]}
        scale={[0.62, 0.8, 0.62]}
        geometry={AG.cylHi}
        material={AM.whiteGloss}
        castShadow
        receiveShadow
      />
      <mesh
        position={[0, 0.86, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.31, 0.31, 1.5]}
        geometry={AG.ring}
        material={AM.holoSolid}
      />
      <mesh position={[0, 0.87, 0]} scale={[0.66, 0.03, 0.66]} geometry={AG.cylHi} material={AM.graphite} />
      {/* cradle */}
      <mesh position={[0, 0.94, -0.02]} scale={[0.24, 0.1, 0.1]} geometry={AG.unitBox} material={AM.darkMetal} />
      {/* the shield, stood upright, leaning back a touch */}
      <group position={[0, 1.3, 0]} rotation={[-0.14, 0, 0]}>
        <mesh
          position={[0, 0, -0.012]}
          scale={[0.76, 0.03, 0.76]}
          geometry={AG.cylHi}
          rotation={[Math.PI / 2, 0, 0]}
          material={shieldBack}
          castShadow
        />
        {SHIELD_RINGS.map((r, i) => (
          <mesh key={i} position={[0, 0, r.z]} geometry={r.geo} material={r.mat} castShadow={i === 0} />
        ))}
        <mesh position={[0, 0, 0.068]} geometry={STAR_GEO} material={SHIELD_RINGS[1].mat} />
      </group>
      {/* spot pool */}
      <mesh
        position={[0, 0.09, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.2, 2.2, 1]}
        geometry={AG.unitPlane}
        material={glowMat('#fff0d8', 0.2)}
      />
    </group>
  )
}

/* ══ Mjölnir on its plinth ═══════════════════════════════════════════ */
const HAMMER_HEAD = beveledBox(0.3, 0.17, 0.17, 0.03)
const hammerMats = {
  head: new THREE.MeshStandardMaterial({ color: '#8d949c', roughness: 0.35, metalness: 0.9 }),
  knot: new THREE.MeshStandardMaterial({ color: '#5e656d', roughness: 0.4, metalness: 0.9 }),
  leather: new THREE.MeshStandardMaterial({ color: '#5a3a24', roughness: 0.8 }),
  stone: new THREE.MeshStandardMaterial({ color: '#8b8f94', roughness: 0.95 }),
  stoneDark: new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 1 })
}
const WRAP_MATS = Array.from({ length: 7 }, (_, i) =>
  mT(0, 0.13 + i * 0.034, 0)
    .multiply(mR(Math.PI / 2, 0, 0))
    .multiply(mR(0.3, 0, 0))
)
const wrapGeo = new THREE.TorusGeometry(0.027, 0.006, 6, 14)

export function MjolnirPedestal(): JSX.Element {
  return (
    <group>
      {/* rough stone plinth on a graphite base */}
      <mesh position={[0, 0.04, 0]} scale={[1.0, 0.08, 1.0]} geometry={AG.cylHi} material={AM.graphite} receiveShadow />
      <mesh
        position={[0, 0.25, 0]}
        rotation={[0, 0.3, 0]}
        scale={[0.66, 0.42, 0.58]}
        geometry={beveledStone}
        material={hammerMats.stone}
        castShadow
        receiveShadow
      />
      <mesh
        position={[0.04, 0.48, -0.02]}
        rotation={[0.05, 0.9, 0.04]}
        scale={[0.5, 0.1, 0.44]}
        geometry={beveledStone}
        material={hammerMats.stoneDark}
        castShadow
        receiveShadow
      />
      {/* hammer — head down, handle up; hero-scaled so it reads at a glance */}
      <group position={[0.04, 0.53, -0.02]} rotation={[0, 0.5, 0.03]} scale={1.7}>
        <mesh position={[0, 0.085, 0]} geometry={HAMMER_HEAD} material={hammerMats.head} castShadow />
        {/* knotwork faces */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 0.151, 0.085, 0]}
            scale={[0.01, 0.1, 0.1]}
            geometry={AG.unitBox}
            material={hammerMats.knot}
          />
        ))}
        <mesh
          position={[0, 0.3, 0]}
          scale={[0.045, 0.3, 0.045]}
          geometry={AG.cyl}
          material={hammerMats.leather}
          castShadow
        />
        <Inst geo={wrapGeo} mat={hammerMats.leather} mats={WRAP_MATS} />
        <mesh position={[0, 0.465, 0]} scale={[0.07, 0.04, 0.07]} geometry={AG.cyl} material={hammerMats.head} />
        {/* wrist strap */}
        <mesh
          position={[0, 0.52, 0.03]}
          rotation={[0.4, 0, 0]}
          scale={[0.6, 1, 1]}
          geometry={strapGeo}
          material={hammerMats.leather}
        />
      </group>
      {/* faint storm-blue shimmer + warm spot pool */}
      <sprite position={[0.04, 0.95, -0.02]} scale={1.3} material={stormHalo} />
      <mesh
        position={[0, 0.09, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.2, 2.2, 1]}
        geometry={AG.unitPlane}
        material={glowMat('#fff0d8', 0.2)}
      />
    </group>
  )
}
const beveledStone = beveledBox(1, 1, 1, 0.12)
const strapGeo = new THREE.TorusGeometry(0.06, 0.008, 6, 20)
const stormHalo = new THREE.SpriteMaterial({
  map: glowTexture(),
  color: '#9fd0ff',
  transparent: true,
  opacity: 0.25,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})

/* ══ Quinjet ═════════════════════════════════════════════════════════
 * ~8.4 m nose-to-tail, sitting on its gear. Jet-local: nose +z, up +y.
 * Fuselage is a lofted profile along the long axis. */
function lofted(rings: readonly ProfileRing[], seg = 28): THREE.BufferGeometry {
  const g = profileSolid(rings, seg)
  g.rotateX(Math.PI / 2) // profile y → +z (nose), ring z → −y
  return g
}
const QG = {
  body: lofted([
    [-4.2, 0.7, 0.28],
    [-3.6, 1.2, 0.5],
    [-2.4, 1.5, 0.66, -0.05],
    [-0.6, 1.55, 0.74, -0.08],
    [1.0, 1.25, 0.72, -0.1],
    [2.4, 0.78, 0.56, -0.06],
    [3.4, 0.4, 0.34, 0.04],
    [4.1, 0.1, 0.12, 0.1],
    [4.25, 0.02, 0.03, 0.12]
  ] as ProfileRing[]),
  canopy: new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
  wing: (() => {
    const s = new THREE.Shape()
    // planform in (span x, chord z): root 2.4 chord → tip 1.05, forward-swept tip
    s.moveTo(0, -1.4)
    s.lineTo(0, 1.0)
    s.lineTo(3.3, 0.55)
    s.lineTo(3.45, -0.4)
    s.lineTo(3.1, -0.6)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.09,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2
    })
    g.rotateX(Math.PI / 2)
    return g
  })(),
  fin: (() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(-1.5, 0)
    s.lineTo(-1.9, 1.35)
    s.lineTo(-1.2, 1.35)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 1
    })
    g.rotateY(-Math.PI / 2) // shape x → −z (chord runs aft), y stays up
    return g
  })(),
  nacelle: new THREE.CylinderGeometry(0.34, 0.38, 1.6, 20),
  intake: new THREE.TorusGeometry(0.3, 0.05, 8, 20),
  exhaust: new THREE.CircleGeometry(0.28, 20),
  gear: new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8),
  wheel: new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14)
} as const
const jetMats = {
  hull: new THREE.MeshPhysicalMaterial({
    color: '#4a5563',
    roughness: 0.38,
    metalness: 0.55,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3
  }),
  panel: new THREE.MeshStandardMaterial({ color: '#2c323b', roughness: 0.45, metalness: 0.6 }),
  canopy: new THREE.MeshPhysicalMaterial({ color: '#c89b3c', roughness: 0.05, metalness: 0.9, clearcoat: 1 }),
  tire: new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.9 })
}

export function Quinjet(): JSX.Element {
  return (
    <group>
      {/* lifted onto its gear */}
      <group position={[0, 1.02, 0]}>
        <mesh geometry={QG.body} material={jetMats.hull} castShadow receiveShadow />
        {/* canopy — gold-tinted wraparound */}
        <mesh
          position={[0, 0.2, 2.35]}
          rotation={[-0.08, 0, 0]}
          scale={[0.62, 0.42, 1.25]}
          geometry={QG.canopy}
          material={jetMats.canopy}
        />
        {/* wings — mid-body, slight anhedral */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 1.1, -0.05, -0.4]}
            rotation={[0, 0, s * -0.06]}
            scale={[s, 1, 1]}
            geometry={QG.wing}
            material={jetMats.hull}
            castShadow
            receiveShadow
          />
        ))}
        {/* VTOL nacelles on the wing roots */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 1.75, 0.12, -0.5]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} geometry={QG.nacelle} material={jetMats.panel} castShadow />
            <mesh position={[0, 0, 0.8]} geometry={QG.intake} material={AM.darkMetal} />
            <mesh
              position={[0, 0, -0.81]}
              rotation={[0, Math.PI, 0]}
              geometry={QG.exhaust}
              material={lightMat('#6fc8ff')}
            />
            <sprite position={[0, 0, -0.95]} scale={1.3} material={exhaustHalo} />
          </group>
        ))}
        {/* twin canted tails */}
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 0.62, 0.3, -2.6]}
            rotation={[0, 0, s * -0.42]}
            geometry={QG.fin}
            material={jetMats.hull}
            castShadow
          />
        ))}
        {/* spine + panel lines */}
        <mesh
          position={[0, 0.66, -0.6]}
          scale={[0.5, 0.12, 3.6]}
          geometry={AG.sphere}
          material={jetMats.panel}
          castShadow
        />
        <mesh
          position={[0, 0.02, 3.4]}
          scale={[0.02, 0.02, 0.4]}
          geometry={AG.unitBox}
          material={lightMat('#ff4a3d')}
        />
      </group>
      {/* landing gear */}
      {[
        [0, 3.0],
        [-1.2, -1.2],
        [1.2, -1.2]
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} geometry={QG.gear} material={AM.steel} />
          <mesh
            position={[0, 0.16, 0]}
            rotation={[0, 0, Math.PI / 2]}
            geometry={QG.wheel}
            material={jetMats.tire}
            castShadow
          />
        </group>
      ))}
    </group>
  )
}
const exhaustHalo = new THREE.SpriteMaterial({
  map: glowTexture(),
  color: '#6fc8ff',
  transparent: true,
  opacity: 0.45,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})

/* ══ wall emblem — the big backlit "A" ═══════════════════════════════
 * Local: faces +z. The scene hangs it on the right wall facing −x. */
const EMBLEM_GLYPH = [
  mT(-0.19, -0.02, 0.03)
    .multiply(mR(0, 0, -0.36))
    .multiply(mS(0.15, 1.02, 0.06)),
  mT(0.19, -0.02, 0.03)
    .multiply(mR(0, 0, 0.36))
    .multiply(mS(0.15, 1.02, 0.06)),
  mT(0.14, -0.14, 0.03).multiply(mS(0.72, 0.11, 0.06))
]
export function WallEmblem(): JSX.Element {
  return (
    <group position={[WALL_EMBLEM.x, WALL_EMBLEM.y, WALL_EMBLEM.z]} rotation={[0, -Math.PI / 2, 0]}>
      {/* halo on the wall behind — the backlight */}
      <mesh
        position={[0, 0, -0.005]}
        scale={[2.4, 2.4, 1]}
        geometry={AG.unitPlane}
        material={glowMat('#ffd9a0', 0.4)}
      />
      <mesh position={[0, 0, 0.04]} scale={[0.62, 0.62, 3]} geometry={AG.ring} material={AM.logo} />
      <mesh position={[0, 0, 0.04]} scale={[0.66, 0.66, 3]} geometry={AG.ring} material={AM.logo} />
      <Inst geo={AG.unitBox} mat={AM.logo} mats={EMBLEM_GLYPH} />
      <mesh
        position={[0.54, -0.14, 0.03]}
        rotation={[0, 0, -Math.PI / 2]}
        scale={[0.22, 0.18, 0.06]}
        geometry={AG.cone}
        material={AM.logo}
      />
    </group>
  )
}
