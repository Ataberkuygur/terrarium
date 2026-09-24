/* ── Avengers identities — costumes on the shared Character rig ────────────
 * Ten fixed identities for the Stark facility theme. Readability at diorama
 * scale comes from silhouette + suit graphics + signature props: Hulk's
 * body, Spider-Man's webbed suit and lenses, Iron Man's armour and
 * faceplate, Cap's cowl and shield, Thor's cape and hammer…
 *
 * Suit graphics are painted once into canvas textures (module level) and
 * mapped through the rig's UV layout (see Character.tsx profileSolid):
 * torso/head u wraps around the body with u=0 at the front centre, v runs
 * bottom→top; limb capsules wrap u around and run v along the limb.
 *
 * Mount cheat-sheet (see Character.tsx):
 *   headgear      → head group; head r≈0.085, face at +z (masked shell ×1.035)
 *   chest         → sternum surface (0, 0.025, chestZ); +z = outward
 *   torsoOverlay  → torso origin (waist at y≈-0.17, neck base y≈0.29)
 *   backMount     → back surface; visible side faces −z
 *   shoulderMount → deltoid centre, +x = outward (mirrored on the left)
 *   forearmMount  → forearm centre, limb runs along −y
 *   right/leftHand→ palm centre; props hang along local −y */

import * as THREE from 'three'
import type { ReactNode } from 'react'
import { RoundedBox } from '@react-three/drei'
import { AG } from './shared'
import { HEAD_GEOMETRY, type CharacterCostume } from '../Character'
import type { Agent } from '@shared/types'

export interface AvengersIdentity {
  id: string
  label: string
  costume: CharacterCostume
}

/* ── canvas texture helpers ─────────────────────────────────────────────── */
type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void

function canvasTexture(w: number, h: number, paint: Paint): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (g) paint(g, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

/** radial spider web centred at (cx, cy) px; sx/sy = px per metre so the
 * web stays round on non-square UV layouts; drawn twice across the u seam */
function radialWeb(
  g: CanvasRenderingContext2D,
  w: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  rays: number,
  radii: readonly number[],
  width: number
): void {
  g.lineWidth = width
  g.lineCap = 'round'
  for (const ox of [-w, 0, w]) {
    const x0 = cx + ox
    g.beginPath()
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + 0.12
      const r = radii[radii.length - 1] * 1.6
      g.moveTo(x0, cy)
      g.lineTo(x0 + Math.cos(a) * r * sx, cy + Math.sin(a) * r * sy)
    }
    g.stroke()
    for (const r of radii) {
      g.beginPath()
      for (let k = 0; k <= rays; k++) {
        const a = (k / rays) * Math.PI * 2 + 0.12
        const px = x0 + Math.cos(a) * r * sx
        const py = cy + Math.sin(a) * r * sy
        if (k === 0) g.moveTo(px, py)
        else {
          // strands sag toward the centre between rays — reads as webbing
          const am = ((k - 0.5) / rays) * Math.PI * 2 + 0.12
          g.quadraticCurveTo(x0 + Math.cos(am) * r * 0.86 * sx, cy + Math.sin(am) * r * 0.86 * sy, px, py)
        }
      }
      g.stroke()
    }
  }
}

/** web grid for limb capsules — meridians + sagging rings */
function limbWeb(g: CanvasRenderingContext2D, w: number, h: number, cols: number, rows: number, width: number): void {
  g.lineWidth = width
  g.beginPath()
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * w
    g.moveTo(x, 0)
    g.lineTo(x, h)
  }
  for (let j = 1; j < rows; j++) {
    const y = (j / rows) * h
    g.moveTo(0, y)
    for (let i = 0; i < cols; i++) {
      const x1 = ((i + 1) / cols) * w
      g.quadraticCurveTo(((i + 0.5) / cols) * w, y + h / rows / 3.2, x1, y)
    }
  }
  g.stroke()
}

/** v (0 bottom → 1 top) → canvas y */
const vy = (v: number, h: number): number => (1 - v) * h

/* ── Spider-Man suit ────────────────────────────────────────────────────── */
const SPIDEY_RED = '#c21f2b'
const SPIDEY_BLUE = '#1d3c9c'
const WEB_LINE = 'rgba(12,8,10,0.92)'

const spideyTorsoTex = canvasTexture(1024, 512, (g, w, h) => {
  g.fillStyle = SPIDEY_RED
  g.fillRect(0, 0, w, h)
  g.strokeStyle = WEB_LINE
  // chest web from the sternum emblem, back web from between the blades
  const sx = w / 0.84
  const sy = h / 0.53
  const radii = [0.035, 0.07, 0.108, 0.15, 0.2, 0.26, 0.33]
  radialWeb(g, w, 0, vy(0.45, h), sx, sy, 16, radii, 2.4)
  radialWeb(g, w, w * 0.5, vy(0.52, h), sx, sy, 16, radii, 2.4)
  // blue side panels — armpit to hip, widening toward the waist
  g.fillStyle = SPIDEY_BLUE
  for (const c of [0.25, 0.75]) {
    g.beginPath()
    g.moveTo((c - 0.035) * w, vy(0.66, h))
    g.quadraticCurveTo((c - 0.1) * w, vy(0.4, h), (c - 0.12) * w, vy(0.0, h))
    g.lineTo((c + 0.12) * w, vy(0.0, h))
    g.quadraticCurveTo((c + 0.1) * w, vy(0.4, h), (c + 0.035) * w, vy(0.66, h))
    g.closePath()
    g.fill()
  }
  // red belt line over the blue
  g.fillStyle = SPIDEY_RED
  g.fillRect(0, vy(0.2, h), w, h * 0.05)
  g.strokeStyle = WEB_LINE
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(0, vy(0.2, h))
  g.lineTo(w, vy(0.2, h))
  g.moveTo(0, vy(0.15, h))
  g.lineTo(w, vy(0.15, h))
  g.stroke()
})

const spideyLimbTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = SPIDEY_RED
  g.fillRect(0, 0, w, h)
  g.strokeStyle = WEB_LINE
  limbWeb(g, w, h, 8, 9, 3.2)
})

const spideyMaskTex = canvasTexture(1024, 512, (g, w, h) => {
  g.fillStyle = SPIDEY_RED
  g.fillRect(0, 0, w, h)
  g.strokeStyle = WEB_LINE
  const sx = w / 0.53
  const sy = h / 0.282
  radialWeb(g, w, 0, vy(0.55, h), sx, sy, 18, [0.012, 0.026, 0.043, 0.062, 0.085, 0.112, 0.145, 0.19, 0.25], 2.6)
})

const matSpideyTorso = new THREE.MeshStandardMaterial({ map: spideyTorsoTex, roughness: 0.55 })
const matSpideyLimb = new THREE.MeshStandardMaterial({ map: spideyLimbTex, roughness: 0.55 })
const matSpideyMask = new THREE.MeshStandardMaterial({ map: spideyMaskTex, roughness: 0.5 })
const matSpideyBlue = new THREE.MeshStandardMaterial({ color: SPIDEY_BLUE, roughness: 0.55 })
const matSpiderBlack = new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 0.5 })
const matLensWhite = new THREE.MeshStandardMaterial({ color: '#f3f6fa', roughness: 0.18, metalness: 0.1, emissive: '#dfe8f2', emissiveIntensity: 0.25 })

/** lens teardrop for the RIGHT eye (outer tip at +x, up) — mirror for left */
const lensGeo = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.52, -0.3)
  s.bezierCurveTo(-0.66, 0.12, -0.3, 0.46, 0.12, 0.46)
  s.bezierCurveTo(0.42, 0.46, 0.62, 0.42, 0.68, 0.3)
  s.bezierCurveTo(0.56, -0.12, 0.1, -0.44, -0.52, -0.3)
  return new THREE.ShapeGeometry(s, 16)
})()

function SpideyLens({ side }: { side: -1 | 1 }) {
  return (
    <group position={[side * 0.038, 0.026, 0.083]} rotation={[-0.05, side * 0.44, side * -0.14]} scale={[side, 1, 1]}>
      <mesh geometry={lensGeo} material={matSpiderBlack} scale={0.062} />
      <mesh geometry={lensGeo} material={matLensWhite} scale={0.05} position={[0.002, 0.001, 0.0015]} />
    </group>
  )
}

/** chest spider: two body segments + 8 legs bent outward */
function SpiderEmblem({ size = 1, material = matSpiderBlack }: { size?: number; material?: THREE.Material }) {
  const legs: [number, number, number][] = [
    [0.02, 0.012, 0.75],
    [0.022, 0.002, 0.3],
    [0.022, -0.008, -0.25],
    [0.02, -0.02, -0.7]
  ]
  return (
    <group scale={size}>
      <mesh geometry={AG.sphere} material={material} scale={[0.014, 0.016, 0.006]} position={[0, 0.012, 0.002]} />
      <mesh geometry={AG.sphere} material={material} scale={[0.018, 0.028, 0.007]} position={[0, -0.018, 0.002]} />
      {legs.flatMap(([x, y, a], i) =>
        [-1, 1].map((s) => (
          <group key={`${i}${s}`} position={[s * 0.008, y, 0.003]} rotation={[0, 0, s * a]}>
            <mesh geometry={AG.unitBox} material={material} scale={[0.032, 0.004, 0.004]} position={[s * 0.016, 0, 0]} />
            <mesh
              geometry={AG.unitBox}
              material={material}
              scale={[0.026, 0.004, 0.004]}
              position={[s * (0.03 + 0.009), (y > 0 ? 1 : -1) * 0.008, 0]}
              rotation={[0, 0, s * (y > 0 ? 0.9 : -0.9)]}
            />
          </group>
        ))
      )}
    </group>
  )
}

/* ── Iron Man armour ────────────────────────────────────────────────────── */
const IM_RED = '#a8121b'
const IM_GOLD = '#d4a640'

const ironTorsoTex = canvasTexture(512, 256, (g, w, h) => {
  g.fillStyle = IM_RED
  g.fillRect(0, 0, w, h)
  // gold abdomen plates (front, wraps the u seam)
  for (const ox of [0, w]) {
    g.fillStyle = IM_GOLD
    g.fillRect(ox - 0.085 * w, vy(0.44, h), 0.17 * w, (0.44 - 0.1) * h)
    g.strokeStyle = 'rgba(60,30,10,0.85)'
    g.lineWidth = 2.5
    g.beginPath()
    for (let v = 0.16; v < 0.44; v += 0.07) {
      g.moveTo(ox - 0.085 * w, vy(v, h))
      g.lineTo(ox + 0.085 * w, vy(v, h))
    }
    g.moveTo(ox, vy(0.44, h))
    g.lineTo(ox, vy(0.1, h))
    g.stroke()
  }
  // plate seams — under-pec arc, side seams, back spine
  g.strokeStyle = 'rgba(40,6,8,0.9)'
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0.1 * w, vy(0.5, h))
  g.quadraticCurveTo(0.03 * w, vy(0.44, h), 0, vy(0.46, h))
  g.moveTo(0.9 * w, vy(0.5, h))
  g.quadraticCurveTo(0.97 * w, vy(0.44, h), w, vy(0.46, h))
  for (const x of [0.2, 0.3, 0.7, 0.8]) {
    g.moveTo(x * w, vy(0.05, h))
    g.lineTo(x * w, vy(0.62, h))
  }
  g.moveTo(0.5 * w, 0)
  g.lineTo(0.5 * w, h)
  g.stroke()
})

const matIronRed = new THREE.MeshStandardMaterial({ color: IM_RED, metalness: 0.62, roughness: 0.3 })
const matIronGold = new THREE.MeshStandardMaterial({ color: IM_GOLD, metalness: 0.78, roughness: 0.28 })
const matIronTorso = new THREE.MeshStandardMaterial({ map: ironTorsoTex, metalness: 0.62, roughness: 0.3 })
const matIronDark = new THREE.MeshStandardMaterial({ color: '#2a1414', metalness: 0.4, roughness: 0.5 })
const matGlowWhite = new THREE.MeshBasicMaterial({ color: '#eafcff', toneMapped: false })
const matArcRing = new THREE.MeshBasicMaterial({ color: '#7fd6ff', toneMapped: false })
const matArcHalo = new THREE.MeshBasicMaterial({ color: '#7fd6ff', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })


const ironHelmet: ReactNode = (
  <group>
    {/* faceplate — a slimmer copy of the skull pushed forward, so only the
        face panel breaks through the red helmet shell */}
    <mesh geometry={HEAD_GEOMETRY} material={matIronGold} scale={[0.9, 0.93, 1.02]} position={[0, -0.014, 0.012]} />

    {[-1, 1].map((s) => (
      <group key={s}>
        <mesh
          geometry={AG.unitBox}
          material={matGlowWhite}
          scale={[0.036, 0.008, 0.004]}
          position={[s * 0.034, 0.022, 0.093]}
          rotation={[0, s * 0.38, s * 0.16]}
        />
        {/* cheek seam */}
        <mesh geometry={AG.unitBox} material={matIronDark} scale={[0.003, 0.05, 0.003]} position={[s * 0.052, -0.05, 0.075]} rotation={[0.15, s * 0.6, s * 0.2]} />
      </group>
    ))}
    <mesh geometry={AG.unitBox} material={matIronDark} scale={[0.04, 0.0035, 0.004]} position={[0, -0.074, 0.088]} />
  </group>
)

const arcReactor: ReactNode = (
  <group position={[0, 0.02, 0.004]}>
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.074, 0.01, 0.074]} geometry={AG.cyl} material={matIronDark} />
    <mesh scale={[0.058, 0.058, 0.058]} geometry={AG.torus} material={matArcRing} position={[0, 0, 0.005]} />
    <mesh scale={[0.026, 0.026, 0.01]} geometry={AG.sphere} material={matGlowWhite} position={[0, 0, 0.006]} />
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.085, 0.002, 0.085]} geometry={AG.cyl} material={matArcHalo} position={[0, 0, 0.009]} />
  </group>
)

const ironPauldron: ReactNode = (
  <group>
    <mesh geometry={AG.sphere} material={matIronRed} scale={[0.135, 0.115, 0.125]} position={[0.014, 0.014, 0]} />
    <mesh geometry={AG.torus} material={matIronGold} scale={[0.12, 0.12, 0.13]} position={[0.016, -0.035, 0]} rotation={[Math.PI / 2, 0, 0]} />
  </group>
)

const repulsor: ReactNode = (
  <mesh geometry={AG.sphere} material={matArcRing} scale={[0.026, 0.026, 0.026]} position={[0, -0.02, 0.02]} />
)

/* ── Captain America ────────────────────────────────────────────────────── */
const CAP_BLUE = '#1f3a70'
const CAP_RED = '#b3242c'
const CAP_LEATHER = '#6b4a2f'

const capTorsoTex = canvasTexture(512, 256, (g, w, h) => {
  g.fillStyle = CAP_BLUE
  g.fillRect(0, 0, w, h)
  // subtle scale-mail texture
  g.strokeStyle = 'rgba(255,255,255,0.05)'
  g.lineWidth = 1
  for (let y = 0; y < h; y += 8) {
    g.beginPath()
    for (let x = (y / 8) % 2 ? 0 : 6; x < w; x += 12) g.arc(x, y, 6, 0, Math.PI)
    g.stroke()
  }
  // red/white abdomen stripes wrapping the front seam
  const stripes = 7
  for (const ox of [0, w]) {
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 === 0 ? CAP_RED : '#eef0f4'
      const x = ox - 0.11 * w + (i / stripes) * 0.22 * w
      g.fillRect(x, vy(0.43, h), (0.22 / stripes) * w + 1, (0.43 - 0.12) * h)
    }
  }
  // leather harness straps over the chest and back
  g.strokeStyle = CAP_LEATHER
  g.lineWidth = 9
  g.beginPath()
  for (const x of [0.13, 0.87, 0.4, 0.6]) {
    g.moveTo(x * w, vy(1, h))
    g.lineTo(x * w, vy(0.43, h))
  }
  g.stroke()
})

const matCapTorso = new THREE.MeshStandardMaterial({ map: capTorsoTex, roughness: 0.62 })
const matCapBlue = new THREE.MeshStandardMaterial({ color: CAP_BLUE, roughness: 0.62 })
const matCapRed = new THREE.MeshStandardMaterial({ color: CAP_RED, roughness: 0.45, metalness: 0.2 })
const matWhite = new THREE.MeshStandardMaterial({ color: '#f2f4f8', roughness: 0.4 })
const matShieldWhite = new THREE.MeshStandardMaterial({ color: '#eceef2', roughness: 0.32, metalness: 0.35 })
const matShieldBlue = new THREE.MeshStandardMaterial({ color: '#1f3f8a', roughness: 0.32, metalness: 0.35 })
const matShieldRed = new THREE.MeshStandardMaterial({ color: '#b01e27', roughness: 0.32, metalness: 0.35 })
const matLeather = new THREE.MeshStandardMaterial({ color: CAP_LEATHER, roughness: 0.78 })

/** unit 5-point star (tip r = 1) facing +z — scale per use */
const starGeo = (() => {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
})()

/** the cowl's "A" — outline with a notch and a triangular counter */
const letterAGeo = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.5, -0.5)
  s.lineTo(-0.22, -0.5)
  s.lineTo(-0.14, -0.26)
  s.lineTo(0.14, -0.26)
  s.lineTo(0.22, -0.5)
  s.lineTo(0.5, -0.5)
  s.lineTo(0.1, 0.5)
  s.lineTo(-0.1, 0.5)
  s.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-0.07, -0.08)
  hole.lineTo(0.07, -0.08)
  hole.lineTo(0, 0.16)
  hole.closePath()
  s.holes.push(hole)
  return new THREE.ShapeGeometry(s)
})()

const capCowl: ReactNode = (
  <group>
    <mesh geometry={letterAGeo} material={matWhite} scale={0.042} position={[0, 0.09, 0.089]} rotation={[-0.62, 0, 0]} />
    {[-1, 1].map((s) => (
      <group key={s} position={[s * 0.1, 0.045, 0.012]} rotation={[0, s * 1.25, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={AG.unitBox} material={matWhite} scale={[0.026 - i * 0.005, 0.006, 0.003]} position={[s * -0.004, 0.012 - i * 0.011, 0]} rotation={[0, 0, s * (0.35 - i * 0.1)]} />
        ))}
      </group>
    ))}
  </group>
)

const capChest: ReactNode = <mesh geometry={starGeo} material={matWhite} scale={[0.05, 0.05, 0.05]} position={[0, 0.045, 0.004]} />

const capShield: ReactNode = (
  <group rotation={[0, Math.PI, 0]} position={[0, -0.02, -0.02]}>
    {/* concentric rings stacked outward from the back (visible side +z after the flip) */}
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.26, 0.02, 0.26]} geometry={AG.cyl} material={matShieldRed} />
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.205, 0.024, 0.205]} geometry={AG.cyl} material={matShieldWhite} position={[0, 0, 0.002]} />
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.15, 0.028, 0.15]} geometry={AG.cyl} material={matShieldRed} position={[0, 0, 0.004]} />
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.095, 0.032, 0.095]} geometry={AG.cyl} material={matShieldBlue} position={[0, 0, 0.006]} />
    <mesh geometry={starGeo} material={matShieldWhite} scale={[0.042, 0.042, 0.042]} position={[0, 0, 0.023]} />
  </group>
)

const leatherGauntlet: ReactNode = (
  <mesh geometry={AG.cyl} material={matLeather} scale={[0.07, 0.1, 0.07]} position={[0, -0.05, 0]} />
)

/* ── Thor ───────────────────────────────────────────────────────────────── */
const matThorArmor = new THREE.MeshStandardMaterial({ color: '#2b2e36', roughness: 0.45, metalness: 0.35 })
const matSilver = new THREE.MeshStandardMaterial({ color: '#c3c8d0', metalness: 0.85, roughness: 0.25 })
const matHammer = new THREE.MeshStandardMaterial({ color: '#8f98a3', metalness: 0.75, roughness: 0.32 })
const matHandleWrap = new THREE.MeshStandardMaterial({ color: '#5a3b22', roughness: 0.85 })

const thorChest: ReactNode = (
  <group>
    {[0.095, 0.03, -0.035].flatMap((y, row) =>
      [-1, 1].map((s) => (
        <mesh
          key={`${row}${s}`}
          geometry={AG.cyl}
          material={matSilver}
          rotation={[Math.PI / 2 - 0.15, 0, 0]}
          scale={[0.042, 0.008, 0.042]}
          position={[s * 0.052, y, -row * 0.008]}
        />
      ))
    )}
  </group>
)

const thorClasps: ReactNode = (
  <group>
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.cyl} material={matSilver} rotation={[Math.PI / 2 - 0.35, 0, 0]} scale={[0.05, 0.012, 0.05]} position={[s * 0.115, 0.215, 0.07]} />
    ))}
  </group>
)

const silverBracer: ReactNode = (
  <group>
    <mesh geometry={AG.cyl} material={matSilver} scale={[0.072, 0.11, 0.072]} position={[0, -0.04, 0]} />
    <mesh geometry={AG.torus} material={matSilver} scale={[0.075, 0.075, 0.075]} position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]} />
  </group>
)

const mjolnir: ReactNode = (
  <group position={[0, -0.01, 0.01]}>
    <mesh scale={[0.026, 0.2, 0.026]} geometry={AG.cyl} material={matHandleWrap} position={[0, -0.09, 0]} />
    {[-0.04, -0.08, -0.12, -0.16].map((y) => (
      <mesh key={y} geometry={AG.torus} material={matHandleWrap} scale={[0.03, 0.03, 0.03]} rotation={[Math.PI / 2, 0, 0.3]} position={[0, y, 0]} />
    ))}
    <mesh scale={[0.036, 0.02, 0.036]} geometry={AG.cyl} material={matHammer} position={[0, 0.015, 0]} />
    <mesh geometry={AG.torus} material={matHandleWrap} scale={[0.03, 0.03, 0.03]} position={[0, 0.045, 0]} />
    <RoundedBox args={[0.13, 0.078, 0.078]} radius={0.012} position={[0, -0.225, 0]} material={matHammer} />
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.cyl} material={matSilver} rotation={[0, 0, Math.PI / 2]} scale={[0.052, 0.006, 0.052]} position={[s * 0.066, -0.225, 0]} />
    ))}
  </group>
)

/* ── Hulk ───────────────────────────────────────────────────────────────── */
const HULK_SKIN = '#679a3f'
const matHulk = new THREE.MeshStandardMaterial({ color: HULK_SKIN, roughness: 0.58 })
const matHulkShade = new THREE.MeshStandardMaterial({ color: '#5e9139', roughness: 0.62 })
const matHulkShorts = new THREE.MeshStandardMaterial({ color: '#4d2d86', roughness: 0.85 })

/** chest/ab/trap musculature on the 'hulk' torso profile */
const hulkMuscles: ReactNode = (
  <group>
    {/* pecs */}
    {[-1, 1].map((s) => (
      <mesh key={`p${s}`} geometry={AG.sphere} material={matHulk} scale={[0.2, 0.13, 0.07]} position={[s * 0.098, 0.13, 0.118]} rotation={[0.2, s * 0.28, s * 0.08]} />
    ))}
    {/* abs — three rows */}
    {[0.01, -0.06, -0.13].flatMap((y, row) =>
      [-1, 1].map((s) => (
        <mesh key={`a${row}${s}`} geometry={AG.sphere} material={matHulkShade} scale={[0.052, 0.042, 0.026]} position={[s * 0.038, y, 0.126 - row * 0.009]} />
      ))
    )}
    {/* traps rising into the neck */}
    {[-1, 1].map((s) => (
      <mesh key={`t${s}`} geometry={AG.sphere} material={matHulk} scale={[0.2, 0.11, 0.14]} position={[s * 0.1, 0.262, -0.012]} rotation={[0, 0, s * -0.35]} />
    ))}
    {/* lats — the V taper from behind */}
    {[-1, 1].map((s) => (
      <mesh key={`l${s}`} geometry={AG.sphere} material={matHulkShade} scale={[0.1, 0.24, 0.16]} position={[s * 0.21, 0.06, -0.02]} />
    ))}
  </group>
)

/* ── Black Widow ────────────────────────────────────────────────────────── */
const matCatsuit = new THREE.MeshStandardMaterial({ color: '#17191f', roughness: 0.34, metalness: 0.22 })
const matWidowRed = new THREE.MeshBasicMaterial({ color: '#e0232f', toneMapped: false })
const matBiteGlow = new THREE.MeshBasicMaterial({ color: '#8fd8ff', toneMapped: false })

const widowBuckle: ReactNode = (
  <group position={[0, -0.17, 0.074]}>
    <mesh geometry={AG.cyl} material={matSilver} rotation={[Math.PI / 2, 0, 0]} scale={[0.044, 0.008, 0.044]} />
    <mesh geometry={AG.cone} material={matWidowRed} scale={[0.022, 0.016, 0.004]} position={[0, 0.008, 0.006]} rotation={[0, 0, Math.PI]} />
    <mesh geometry={AG.cone} material={matWidowRed} scale={[0.022, 0.016, 0.004]} position={[0, -0.008, 0.006]} />
    {/* zip line up the front */}
    <mesh geometry={AG.unitBox} material={matSilver} scale={[0.004, 0.2, 0.003]} position={[0, 0.2, -0.002]} rotation={[-0.08, 0, 0]} />
  </group>
)

const widowBites: ReactNode = (
  <group position={[0, -0.06, 0]}>
    <mesh geometry={AG.cyl} material={matSilver} scale={[0.072, 0.035, 0.072]} />
    <mesh geometry={AG.sphere} material={matBiteGlow} scale={[0.016, 0.016, 0.016]} position={[0.018, 0, 0.032]} />
    <mesh geometry={AG.sphere} material={matBiteGlow} scale={[0.016, 0.016, 0.016]} position={[-0.018, 0, 0.032]} />
  </group>
)

/* ── Scarlet Witch ──────────────────────────────────────────────────────── */
const matWanda = new THREE.MeshStandardMaterial({ color: '#b21f33', roughness: 0.55 })
const matWandaDark = new THREE.MeshStandardMaterial({ color: '#4a1520', roughness: 0.6 })
const matChaos = new THREE.MeshBasicMaterial({ color: '#ff3b4f', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
const matChaosCore = new THREE.MeshBasicMaterial({ color: '#ffb0b8', toneMapped: false })

const wandaTiara: ReactNode = (
  <group position={[0, 0.055, 0.005]}>
    <mesh geometry={AG.torus} material={matWanda} scale={[0.2, 0.2, 0.2]} rotation={[Math.PI / 2 + 0.32, 0, 0]} />
    <mesh geometry={AG.cone} material={matWanda} scale={[0.03, 0.07, 0.014]} position={[0, 0.03, 0.093]} rotation={[-0.3, 0, 0]} />
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.cone} material={matWanda} scale={[0.02, 0.05, 0.012]} position={[s * 0.04, 0.022, 0.085]} rotation={[-0.3, s * 0.35, s * -0.45]} />
    ))}
  </group>
)

const chaosMagic: ReactNode = (
  <group position={[0, -0.05, 0.03]}>
    <mesh geometry={AG.sphere} material={matChaosCore} scale={[0.022, 0.022, 0.022]} />
    <mesh geometry={AG.sphere} material={matChaos} scale={[0.05, 0.05, 0.05]} />
    <mesh geometry={AG.torus} material={matChaos} scale={[0.07, 0.07, 0.07]} rotation={[1.1, 0.4, 0]} />
    <mesh geometry={AG.sphere} material={matChaos} scale={[0.02, 0.02, 0.02]} position={[0.05, 0.04, 0.01]} />
    <mesh geometry={AG.sphere} material={matChaos} scale={[0.015, 0.015, 0.015]} position={[-0.04, 0.06, -0.01]} />
  </group>
)

/* ── Loki ───────────────────────────────────────────────────────────────── */
const matLokiGreen = new THREE.MeshStandardMaterial({ color: '#1f4a32', roughness: 0.5, metalness: 0.1 })
const matLokiBlack = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.45, metalness: 0.15 })
const matGold = new THREE.MeshStandardMaterial({ color: '#d4af5a', metalness: 0.8, roughness: 0.28 })
const matGemBlue = new THREE.MeshBasicMaterial({ color: '#7fe3ff', toneMapped: false })

/** tube swept along points with a radius tapering r0 → r1 (horns, blades) */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, segs = 24, radial = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points)
  const frames = curve.computeFrenetFrames(segs, false)
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const c = curve.getPointAt(t)
    const r = r0 + (r1 - r0) * t
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a) * r)
      const b = frames.binormals[i].clone().multiplyScalar(Math.sin(a) * r)
      pos.push(c.x + n.x + b.x, c.y + n.y + b.y, c.z + n.z + b.z)
      if (i < segs && j < radial) {
        const k = i * (radial + 1) + j
        const k2 = k + radial + 1
        idx.push(k, k2, k + 1, k + 1, k2, k2 + 1)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Loki's horn — rises from the temple, sweeps up and back */
const hornGeo = taperedTube(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.012, 0.06, 0.02),
    new THREE.Vector3(0.018, 0.14, 0.0),
    new THREE.Vector3(0.012, 0.2, -0.07),
    new THREE.Vector3(0.0, 0.215, -0.15)
  ],
  0.02,
  0.002
)

const lokiHelmet: ReactNode = (
  <group>
    {/* crown band across the brow + cheek guards */}
    <mesh geometry={AG.torus} material={matGold} scale={[0.19, 0.19, 0.2]} position={[0, 0.058, 0.004]} rotation={[Math.PI / 2 + 0.3, 0, 0]} />
    <mesh geometry={AG.cone} material={matGold} scale={[0.02, 0.05, 0.012]} position={[0, 0.085, 0.09]} rotation={[-0.3, 0, Math.PI]} />
    {[-1, 1].map((s) => (
      <group key={s}>
        <mesh geometry={AG.unitBox} material={matGold} scale={[0.012, 0.09, 0.05]} position={[s * 0.086, -0.02, 0.035]} rotation={[0.1, 0, s * -0.08]} />
        <group position={[s * 0.06, 0.088, 0.03]} scale={[s, 1, 1]}>
          <mesh geometry={hornGeo} material={matGold} castShadow />
        </group>
      </group>
    ))}
  </group>
)

const lokiArmor: ReactNode = (
  <group>
    {/* gold V plates across the chest */}
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.unitBox} material={matGold} scale={[0.1, 0.022, 0.012]} position={[s * 0.05, 0.14, 0.086]} rotation={[-0.15, s * 0.25, s * -0.5]} />
    ))}
    <mesh geometry={AG.unitBox} material={matGold} scale={[0.024, 0.16, 0.01]} position={[0, 0.02, 0.078]} />
  </group>
)

const lokiPauldron: ReactNode = (
  <group>
    <mesh geometry={AG.sphere} material={matGold} scale={[0.125, 0.095, 0.125]} position={[0.012, 0.018, 0]} />
    <mesh geometry={AG.sphere} material={matLokiBlack} scale={[0.11, 0.05, 0.115]} position={[0.02, -0.02, 0]} />
  </group>
)

const goldBracer: ReactNode = <mesh geometry={AG.cyl} material={matGold} scale={[0.07, 0.1, 0.07]} position={[0, -0.04, 0]} />

const lokiSceptre: ReactNode = (
  <group position={[0, -0.02, 0.035]} rotation={[0.25, 0, 0]}>
    <mesh geometry={AG.cyl} material={matGold} scale={[0.018, 0.56, 0.018]} position={[0, 0.02, 0]} />
    <group position={[0, -0.27, 0]} rotation={[Math.PI, 0, 0]}>
      <mesh geometry={AG.sphere} material={matGemBlue} scale={[0.04, 0.05, 0.04]} position={[0, 0.03, 0]} />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={AG.cone} material={matGold} scale={[0.012, 0.075, 0.008]} position={[s * 0.028, 0.045, 0]} rotation={[0, 0, s * -0.35]} />
      ))}
    </group>
  </group>
)

/* ── Doctor Strange ─────────────────────────────────────────────────────── */
const matCloak = new THREE.MeshStandardMaterial({ color: '#a3242f', roughness: 0.8, side: THREE.DoubleSide })
const matStrangeBlue = new THREE.MeshStandardMaterial({ color: '#253f86', roughness: 0.7 })
const matStrangeNavy = new THREE.MeshStandardMaterial({ color: '#1a2448', roughness: 0.75 })
const matWraps = new THREE.MeshStandardMaterial({ color: '#b8a17c', roughness: 0.85 })
const matGrey = new THREE.MeshStandardMaterial({ color: '#8b8e93', roughness: 0.7 })
const matAgamotto = new THREE.MeshBasicMaterial({ color: '#5fe08f', toneMapped: false })

const mandalaTex = canvasTexture(256, 256, (g, w) => {
  const c = w / 2
  g.clearRect(0, 0, w, w)
  g.strokeStyle = '#ffae3d'
  g.fillStyle = '#ffae3d'
  g.shadowColor = '#ff8a1a'
  g.shadowBlur = 8
  g.lineWidth = 5
  for (const r of [118, 100, 62]) {
    g.beginPath()
    g.arc(c, c, r, 0, Math.PI * 2)
    g.stroke()
  }
  g.lineWidth = 3
  for (const off of [0, Math.PI / 4]) {
    g.beginPath()
    for (let i = 0; i <= 4; i++) {
      const a = off + (i / 4) * Math.PI * 2
      const x = c + Math.cos(a) * 88
      const y = c + Math.sin(a) * 88
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    g.fillRect(c + Math.cos(a) * 108 - 3, c + Math.sin(a) * 108 - 3, 6, 6)
  }
})
mandalaTex.wrapS = THREE.ClampToEdgeWrapping
const matMandala = new THREE.MeshBasicMaterial({
  map: mandalaTex,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false
})
const mandalaGeo = new THREE.PlaneGeometry(1, 1)

const strangeCollar: ReactNode = (
  <group position={[0, 0.3, -0.06]}>
    <mesh geometry={AG.unitBox} material={matCloak} scale={[0.14, 0.17, 0.014]} position={[0, 0.03, -0.02]} rotation={[-0.3, 0, 0]} />
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.unitBox} material={matCloak} scale={[0.1, 0.15, 0.014]} position={[s * 0.085, 0.02, 0.02]} rotation={[-0.15, s * -0.75, s * -0.12]} />
    ))}
  </group>
)

const eyeOfAgamotto: ReactNode = (
  <group position={[0, 0.01, 0.004]}>
    <mesh geometry={AG.cyl} material={matGold} rotation={[Math.PI / 2, 0, 0]} scale={[0.056, 0.012, 0.056]} />
    <mesh geometry={AG.sphere} material={matAgamotto} scale={[0.026, 0.018, 0.012]} position={[0, 0, 0.008]} />
  </group>
)

const strangeTemples: ReactNode = (
  <group>
    {[-1, 1].map((s) => (
      <mesh key={s} geometry={AG.sphere} material={matGrey} scale={[0.022, 0.05, 0.05]} position={[s * 0.086, 0.02, 0.0]} />
    ))}
  </group>
)

const spellShield: ReactNode = (
  <group position={[0, -0.06, 0.07]}>
    <mesh geometry={mandalaGeo} material={matMandala} scale={[0.24, 0.24, 1]} />
  </group>
)

const wristWraps: ReactNode = <mesh geometry={AG.cyl} material={matWraps} scale={[0.07, 0.1, 0.07]} position={[0, -0.05, 0]} />

/* ── Black Panther ──────────────────────────────────────────────────────── */
const pantherTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#15151b'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = 'rgba(160,150,205,0.45)'
  g.lineWidth = 2
  const s = 42
  g.beginPath()
  for (let y = 0; y <= h; y += s) {
    g.moveTo(0, y)
    g.lineTo(w, y)
  }
  for (let x = -h; x <= w; x += s) {
    g.moveTo(x, h)
    g.lineTo(x + h * 0.577, 0)
    g.moveTo(x + h * 0.577, h)
    g.lineTo(x, 0)
  }
  g.stroke()
})
pantherTex.wrapT = THREE.RepeatWrapping
pantherTex.repeat.set(2, 1)
const matPanther = new THREE.MeshStandardMaterial({ map: pantherTex, roughness: 0.42, metalness: 0.35 })
const matPantherLens = new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.9, roughness: 0.15 })

const pantherHead: ReactNode = (
  <group>
    {[-1, 1].map((s) => (
      <group key={s}>
        <group position={[s * 0.036, 0.026, 0.082]} rotation={[-0.05, s * 0.42, s * -0.2]} scale={[s, 1, 1]}>
          <mesh geometry={lensGeo} material={matPantherLens} scale={[0.036, 0.022, 1]} />
        </group>
        <mesh geometry={AG.cone} material={matPanther} scale={[0.036, 0.05, 0.02]} position={[s * 0.056, 0.122, -0.01]} rotation={[0, 0, s * -0.35]} />
      </group>
    ))}
  </group>
)

const pantherNecklace: ReactNode = (
  <group position={[0, 0.265, 0.01]}>
    <mesh geometry={AG.torus} material={matSilver} scale={[0.165, 0.165, 0.13]} rotation={[Math.PI / 2 + 0.25, 0, 0]} />
    {[-2, -1, 0, 1, 2].map((i) => (
      <mesh key={i} geometry={AG.cone} material={matSilver} scale={[0.014, 0.03, 0.008]} position={[i * 0.024, -0.03 + Math.abs(i) * 0.008, 0.074 - Math.abs(i) * 0.01]} rotation={[0.2, 0, Math.PI]} />
    ))}
  </group>
)

/* ── the roster — order matters: Iron Man leads ─────────────────────────── */
export const AVENGERS: AvengersIdentity[] = [
  {
    id: 'iron-man',
    label: 'Iron Man',
    costume: {
      torsoShape: 'athletic',
      scale: 1.05,
      physique: { arms: 1.14, legs: 1.1, hands: 1.12 },
      mask: 'full',
      maskMaterial: matIronRed,
      headgear: ironHelmet,
      torsoMaterial: matIronTorso,
      pelvisMaterial: matIronRed,
      sleeveMaterial: matIronRed,
      forearmMaterial: matIronGold,
      handMaterial: matIronRed,
      thighMaterial: matIronGold,
      calfMaterial: matIronRed,
      bootMaterial: matIronRed,
      footwear: 'boot',
      bootHeight: 0.3,
      belt: '#b8912f',
      chest: arcReactor,
      shoulderMount: ironPauldron,
      rightHand: repulsor,
      leftHand: repulsor
    }
  },
  {
    id: 'captain-america',
    label: 'Captain America',
    costume: {
      torsoShape: 'athletic',
      scale: 1.04,
      skin: '#eec09c',
      eyes: '#3b6ea8',
      mask: 'cowl',
      maskMaterial: matCapBlue,
      headgear: capCowl,
      torsoMaterial: matCapTorso,
      pelvisMaterial: matCapBlue,
      shirt: CAP_BLUE,
      sleeveMaterial: matCapBlue,
      forearmMaterial: matCapBlue,
      handMaterial: matLeather,
      pants: CAP_BLUE,
      shoes: CAP_LEATHER,
      bootMaterial: matLeather,
      footwear: 'boot',
      bootHeight: 0.26,
      belt: CAP_LEATHER,
      forearmMount: leatherGauntlet,
      chest: capChest,
      backMount: capShield
    }
  },
  {
    id: 'thor',
    label: 'Thor',
    costume: {
      torsoShape: 'athletic',
      scale: 1.07,
      physique: { arms: 1.1, legs: 1.06 },
      hair: '#d8b067',
      hairStyle: 3,
      hairLong: true,
      beard: '#c29b55',
      eyes: '#3a6ea5',
      expression: 'smile',
      torsoMaterial: matThorArmor,
      pelvisMaterial: matThorArmor,
      shirt: '#2b2e36',
      arms: '#e0a984',
      skin: '#e0a984',
      pants: '#22252c',
      shoes: '#2c2622',
      footwear: 'boot',
      bootHeight: 0.24,
      cape: { color: '#a3231f', length: 0.78, width: 0.46 },
      chest: thorChest,
      torsoOverlay: thorClasps,
      forearmMount: silverBracer,
      rightHand: mjolnir
    }
  },
  {
    id: 'hulk',
    label: 'Hulk',
    costume: {
      // the body IS the costume: V-taper torso, huge limbs, torn shorts
      torsoShape: 'hulk',
      scale: 1.38,
      physique: { arms: 1.8, forearms: 1.18, legs: 1.55, armLength: 1.1, hands: 1.8, head: 1.0 },
      hunch: 0.16,
      skin: HULK_SKIN,
      eyes: '#3d7a2c',
      hair: '#16181b',
      hairStyle: 0,
      expression: 'angry',
      heavyBrow: true,
      jaw: 1.35,
      torsoMaterial: matHulk,
      pelvisMaterial: matHulkShorts,
      thighMaterial: matHulkShorts,
      arms: HULK_SKIN,
      pants: '#4d2d86',
      shorts: true,
      footwear: 'bare',
      torsoOverlay: hulkMuscles
    }
  },
  {
    id: 'black-widow',
    label: 'Black Widow',
    costume: {
      torsoShape: 'female',
      skin: '#f2cdb3',
      scale: 0.97,
      hair: '#a9402a',
      hairStyle: 4,
      eyes: '#4d6b4a',
      torsoMaterial: matCatsuit,
      pelvisMaterial: matCatsuit,
      sleeveMaterial: matCatsuit,
      forearmMaterial: matCatsuit,
      handMaterial: matCatsuit,
      thighMaterial: matCatsuit,
      calfMaterial: matCatsuit,
      shoes: '#121318',
      footwear: 'boot',
      bootHeight: 0.24,
      belt: '#9aa3ad',
      torsoOverlay: widowBuckle,
      forearmMount: widowBites
    }
  },
  {
    id: 'spider-man',
    label: 'Spider-Man',
    costume: {
      torsoShape: 'athletic',
      scale: 0.97,
      mask: 'full',
      maskMaterial: matSpideyMask,
      headgear: (
        <group>
          <SpideyLens side={-1} />
          <SpideyLens side={1} />
        </group>
      ),
      torsoMaterial: matSpideyTorso,
      pelvisMaterial: matSpideyBlue,
      sleeveMaterial: matSpideyLimb,
      forearmMaterial: matSpideyLimb,
      handMaterial: matSpideyLimb,
      thighMaterial: matSpideyBlue,
      calfMaterial: matSpideyBlue,
      bootMaterial: matSpideyLimb,
      footwear: 'boot',
      bootHeight: 0.22,
      chest: <SpiderEmblem size={2} />,
      backMount: (
        <group rotation={[0, Math.PI, 0]}>
          <SpiderEmblem size={2.8} material={matSpiderBlack} />
        </group>
      )
    }
  },
  {
    id: 'doctor-strange',
    label: 'Doctor Strange',
    costume: {
      torsoShape: 'athletic',
      skin: '#e6bb97',
      hair: '#231e1b',
      hairStyle: 1,
      beard: '#3a3634',
      eyes: '#5d8a8a',
      torsoMaterial: matStrangeBlue,
      pelvisMaterial: matStrangeNavy,
      sleeveMaterial: matStrangeNavy,
      forearmMaterial: matStrangeNavy,
      pants: '#1a2448',
      shoes: '#3c2e22',
      footwear: 'boot',
      bootHeight: 0.2,
      belt: '#8a6a3a',
      coat: { color: '#27418a', length: 0.44, flare: 1.3, gap: 0.5 },
      cape: { color: '#a3242f', length: 0.86, width: 0.5 },
      headgear: strangeTemples,
      torsoOverlay: strangeCollar,
      chest: eyeOfAgamotto,
      forearmMount: wristWraps,
      leftHand: spellShield
    }
  },
  {
    id: 'scarlet-witch',
    label: 'Scarlet Witch',
    costume: {
      torsoShape: 'female',
      skin: '#f0cfb8',
      scale: 0.96,
      hair: '#6b3326',
      hairStyle: 3,
      hairLong: true,
      eyes: '#4a6b3a',
      torsoMaterial: matWanda,
      pelvisMaterial: matWandaDark,
      sleeveMaterial: matWandaDark,
      forearmMaterial: matWandaDark,
      pants: '#241a20',
      shoes: '#3a1219',
      footwear: 'boot',
      bootHeight: 0.28,
      coat: { color: '#9b1f33', length: 0.62, flare: 1.7, gap: 0.9 },
      headgear: wandaTiara,
      rightHand: chaosMagic,
      leftHand: chaosMagic
    }
  },
  {
    id: 'black-panther',
    label: 'Black Panther',
    costume: {
      torsoShape: 'athletic',
      scale: 1.03,
      mask: 'full',
      maskMaterial: matPanther,
      headgear: pantherHead,
      torsoMaterial: matPanther,
      pelvisMaterial: matPanther,
      sleeveMaterial: matPanther,
      forearmMaterial: matPanther,
      handMaterial: matPanther,
      thighMaterial: matPanther,
      calfMaterial: matPanther,
      bootMaterial: matPanther,
      footwear: 'boot',
      bootHeight: 0.33,
      torsoOverlay: pantherNecklace
    }
  },
  {
    id: 'loki',
    label: 'Loki',
    costume: {
      torsoShape: 'default',
      scale: 1.03,
      hair: '#15161a',
      hairStyle: 3,
      hairLong: true,
      eyes: '#3f6b54',
      expression: 'smirk',
      skin: '#f0d2bd',
      torsoMaterial: matLokiGreen,
      pelvisMaterial: matLokiBlack,
      sleeveMaterial: matLokiBlack,
      forearmMaterial: matLokiBlack,
      pants: '#15171a',
      shoes: '#121416',
      footwear: 'boot',
      bootHeight: 0.3,
      coat: { color: '#173a27', length: 0.56, flare: 1.4, gap: 0.55 },
      cape: { color: '#1f5c35', length: 0.84, width: 0.44 },
      headgear: lokiHelmet,
      torsoOverlay: lokiArmor,
      shoulderMount: lokiPauldron,
      forearmMount: goldBracer,
      rightHand: lokiSceptre
    }
  }
]

/** deterministic string hash — same agent always prefers the same Avenger */
export function hashString(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

/** Costume for an agent. Pass the visible crew to keep identities unique
 * within it: agents (in id order) take their hashed hero, or the next free
 * one when it's taken — so a crew never shows two Hulks. */
export function costumeForAgent(agent: Agent, crew?: readonly Agent[]): CharacterCostume {
  const n = AVENGERS.length
  if (!crew || crew.length < 2) return AVENGERS[hashString(agent.id) % n].costume
  const taken = new Set<number>()
  const ordered = [...crew].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const a of ordered) {
    let slot = hashString(a.id) % n
    if (taken.size < n) while (taken.has(slot)) slot = (slot + 1) % n
    taken.add(slot)
    if (a.id === agent.id) return AVENGERS[slot].costume
  }
  return AVENGERS[hashString(agent.id) % n].costume
}
