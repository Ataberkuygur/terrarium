/* ── Avengers Compound — atmosphere ────────────────────────────────────
 * The "alive" layer, all cheap:
 *  1. HoloMotes   — cyan sparks orbiting the hub hologram (one InstancedMesh,
 *                   matrices rewritten in a single useFrame, zero allocs).
 *  2. SunShafts   — slanted additive light planes falling through the back
 *                   glazing; fake volumetrics, static.
 *  3. DustMotes   — slow warm dust drifting inside those shafts.
 * No postprocessing anywhere — glow is additive, unlit, toneMapped:false. */
import { useMemo, useRef, type JSX } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { AG, Inst, mT, mR, mS, fadeTexture } from './shared'
import { P } from './palette'
import { HUB, ROOM } from './layout'

const _m = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()

interface Mote {
  cx: number
  cy: number
  cz: number
  r: number
  speed: number
  phase: number
  bob: number
  bobSpeed: number
  scale: number
}

function lcg(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function buildMotes(): { holo: Mote[]; dust: Mote[] } {
  const r = lcg(1337)
  const holo: Mote[] = []
  for (let i = 0; i < 46; i++) {
    holo.push({
      cx: HUB.x,
      cy: 1.1 + r() * 1.7,
      cz: HUB.z,
      r: 0.35 + r() * 0.95,
      speed: (0.2 + r() * 0.35) * (r() < 0.5 ? 1 : -1),
      phase: r() * Math.PI * 2,
      bob: 0.05 + r() * 0.14,
      bobSpeed: 0.4 + r() * 0.9,
      scale: 0.5 + r() * 1.0
    })
  }
  const dust: Mote[] = []
  for (let i = 0; i < 40; i++) {
    dust.push({
      cx: -0.5 + r() * (ROOM.maxX - 1.5),
      cy: 0.4 + r() * 2.6,
      cz: ROOM.minZ + 0.5 + r() * 4.5,
      r: 0.2 + r() * 0.6,
      speed: 0.05 + r() * 0.08,
      phase: r() * Math.PI * 2,
      bob: 0.1 + r() * 0.25,
      bobSpeed: 0.1 + r() * 0.2,
      scale: 0.5 + r() * 0.8
    })
  }
  return { holo, dust }
}

const holoMoteMat = new THREE.MeshBasicMaterial({
  color: P.holoCyan,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const dustMat = new THREE.MeshBasicMaterial({
  color: '#fff1d8',
  transparent: true,
  opacity: 0.35,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})

function writeMotes(im: THREE.InstancedMesh, motes: Mote[], t: number) {
  for (let i = 0; i < motes.length; i++) {
    const m = motes[i]
    const a = m.phase + t * m.speed
    _v.set(m.cx + Math.cos(a) * m.r, m.cy + Math.sin(t * m.bobSpeed + m.phase * 3) * m.bob, m.cz + Math.sin(a) * m.r)
    const tw = m.scale * (0.7 + 0.3 * Math.sin(t * 2.3 + m.phase * 5))
    _s.set(tw, tw, tw)
    _m.compose(_v, _q, _s)
    im.setMatrixAt(i, _m)
  }
  im.instanceMatrix.needsUpdate = true
}

function Motes(): JSX.Element {
  const holoRef = useRef<THREE.InstancedMesh>(null)
  const dustRef = useRef<THREE.InstancedMesh>(null)
  const motes = useMemo(buildMotes, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (holoRef.current) writeMotes(holoRef.current, motes.holo, t)
    if (dustRef.current) writeMotes(dustRef.current, motes.dust, t)
  })
  return (
    <group>
      <instancedMesh ref={holoRef} args={[AG.ledDot, holoMoteMat, motes.holo.length]} frustumCulled={false} />
      <instancedMesh ref={dustRef} args={[AG.ledDot, dustMat, motes.dust.length]} frustumCulled={false} />
    </group>
  )
}

/* ── sun shafts through the glazing ───────────────────────────────────
 * Tall quads leaning in from the back wall along the sun direction, faded
 * toward the floor end. Two crossed planes per shaft so they hold up from
 * any orbit angle. */
const shaftMat = new THREE.MeshBasicMaterial({
  color: '#fff0d6',
  map: fadeTexture(),
  transparent: true,
  opacity: 0.045,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false
})
const SHAFT_XS = [0.3, 1.7, 3.1, 4.5, 5.9, 7.1]
const SHAFT_MATS = SHAFT_XS.flatMap((x, i) =>
  [0, Math.PI / 2].map((a) =>
    mT(x - 0.9, 1.45, ROOM.minZ + 1.35)
      .multiply(mR(0.62, -0.35, 0)) // lean into the room with the sun
      .multiply(mR(0, a, 0))
      .multiply(mR(0, 0, Math.PI)) // bright end at the glass
      .multiply(mS(1.1 + (i % 2) * 0.4, 3.6, 1))
  )
)

export function LabAtmosphere(): JSX.Element {
  return (
    <group>
      <Motes />
      <Inst geo={AG.unitPlane} mat={shaftMat} mats={SHAFT_MATS} />
    </group>
  )
}
