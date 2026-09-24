/* ── Avengers Compound — ops floor shell ───────────────────────────────
 * The architecture around the crew:
 *  · Floor     graphite polished resin (clear-coated, env reflections)
 *              with cyan light rings inlaid around the hub.
 *  · Dais      raised annular platform carrying the outer console tier,
 *              lit nosing along its inner edge.
 *  · Walls     white composite panels; back wall is full-height glazing
 *              onto the compound; walls facing the camera hide themselves
 *              (Sims-style cutaway) so the diorama never occludes itself.
 *  · Exterior  compound lawn, apron, tree line, the distant main building
 *              — what the glazing looks out on.
 * Everything static is baked into module-level matrices and drawn through
 * <Inst>; the only per-frame work is four camera-side tests. */
import { useEffect, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { P } from './palette'
import { AG, Inst, mT, mR, mS, glowMat, lightMat } from './shared'
import { ROOM, ROOM_W, ROOM_D, ROOM_CX, ROOM_CZ, HUB, DAIS, LANDING_PAD, GLAZING } from './layout'

const { minX, maxX, minZ, maxZ, h: H, wall: WT } = ROOM
/** exterior grade — the building slab stands proud of the lawn by this much */
export const GRADE_Y = -0.34

/* ══ materials ═══════════════════════════════════════════════════════ */
const wallMat = new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.7, metalness: 0.02 })
const wallShadeMat = new THREE.MeshStandardMaterial({ color: P.wallShade, roughness: 0.75 })
const trimMat = new THREE.MeshStandardMaterial({ color: P.wallTrim, roughness: 0.35, metalness: 0.7 })
const capMat = new THREE.MeshStandardMaterial({ color: '#30353e', roughness: 0.5, metalness: 0.4 })
const mullionMat = new THREE.MeshStandardMaterial({ color: '#262a31', roughness: 0.35, metalness: 0.6 })
const plinthMat = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.8 })
const daisMat = new THREE.MeshPhysicalMaterial({
  color: '#1c2028',
  roughness: 0.32,
  metalness: 0.2,
  clearcoat: 1,
  clearcoatRoughness: 0.1
})
const daisRiserMat = new THREE.MeshStandardMaterial({ color: '#dfe3e9', roughness: 0.45, metalness: 0.05 })
const DAIS_MATS = [daisMat, daisRiserMat]
const windowGlass = new THREE.MeshPhysicalMaterial({
  color: '#bfe3f5',
  transparent: true,
  opacity: 0.1,
  roughness: 0.04,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  depthWrite: false,
  side: THREE.DoubleSide
})
const glassSheen = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.05,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide
})
const floorLineMat = new THREE.MeshBasicMaterial({
  color: P.floorLine,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const stripMat = lightMat(P.holoCyan)
const coveMat = lightMat('#eaf6ff')

/* ══ floor ═══════════════════════════════════════════════════════════
 * Large-format resin tiles (1.5 m) painted once; a paired roughness canvas
 * keeps seams matte against the glossy field so the env map picks out
 * the grid only where light rakes across it. */
function lcg(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function paintFloor(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const PX = 56 // px per metre
  const W = Math.round(ROOM_W * PX)
  const D = Math.round(ROOM_D * PX)
  const c = document.createElement('canvas')
  c.width = W
  c.height = D
  const g = c.getContext('2d')!
  const rc = document.createElement('canvas')
  rc.width = W
  rc.height = D
  const rg = rc.getContext('2d')!
  const rnd = lcg(71)
  g.fillStyle = P.floor
  g.fillRect(0, 0, W, D)
  rg.fillStyle = '#3a3a3a' // glossy field
  rg.fillRect(0, 0, W, D)
  const tile = 1.5 * PX
  // per-tile tonal drift — resin never pours perfectly even
  for (let x = 0; x < W; x += tile) {
    for (let y = 0; y < D; y += tile) {
      const v = rnd()
      g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${0.012 + rnd() * 0.02})`
      g.fillRect(x, y, tile, tile)
    }
  }
  // fine aggregate
  for (let i = 0; i < 5000; i++) {
    const v = 40 + rnd() * 40
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},0.35)`
    g.fillRect(rnd() * W, rnd() * D, 1.2, 1.2)
  }
  g.strokeStyle = 'rgba(4,6,9,0.9)'
  rg.strokeStyle = 'rgb(170,170,170)'
  g.lineWidth = 1.6
  rg.lineWidth = 2
  // tile grid is centred on the hub so the rings sit square in it
  const ox = ((HUB.x - minX) * PX) % tile
  const oz = ((HUB.z - minZ) * PX) % tile
  for (let x = ox - tile * 0.5; x <= W; x += tile) {
    for (const ctx of [g, rg]) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, D)
      ctx.stroke()
    }
  }
  for (let y = oz - tile * 0.5; y <= D; y += tile) {
    for (const ctx of [g, rg]) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
  }
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const rough = new THREE.CanvasTexture(rc)
  rough.anisotropy = 8
  return { map, rough }
}

/* inlaid light rings + radial spokes around the hub */
const RING_RADII = [1.95] as const
const ringGeos = RING_RADII.map((r) => new THREE.RingGeometry(r - 0.018, r + 0.018, 160))
const SPOKE_MATS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + Math.PI / 12
  const r0 = 2.05
  const r1 = 2.55
  const rm = (r0 + r1) / 2
  return mT(HUB.x + Math.sin(a) * rm, 0.004, HUB.z - Math.cos(a) * rm)
    .multiply(mR(0, -a, 0))
    .multiply(mR(-Math.PI / 2, 0, 0))
    .multiply(mS(0.03, r1 - r0, 1))
})

/* the Avengers "A" inlaid in brushed steel on the front floor — reads as
 * a crest from the default camera, lies flat so it never blocks anything */
const EMBLEM_Z = 3.45
const inlayMat = new THREE.MeshStandardMaterial({
  color: '#4c545f',
  roughness: 0.42,
  metalness: 0.75,
  envMapIntensity: 0.55,
  polygonOffset: true,
  polygonOffsetFactor: -2
})
const emblemRingGeo = new THREE.RingGeometry(0.62, 0.7, 96)
const EMBLEM_GLYPH = [
  // legs (flat on the floor: local x → world x, local y → world −z)
  mT(-0.17, 0, 0.02)
    .multiply(mR(0, 0, -0.36))
    .multiply(mS(0.13, 0.95, 1)),
  mT(0.17, 0, 0.02)
    .multiply(mR(0, 0, 0.36))
    .multiply(mS(0.13, 0.95, 1)),
  // crossbar running out through the ring
  mT(0.2, -0.13, 0).multiply(mS(0.82, 0.09, 1))
]
const emblemArrowGeo = new THREE.CircleGeometry(0.1, 3)

export function FloorEmblem(): JSX.Element {
  return (
    <group position={[HUB.x, 0.003, EMBLEM_Z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={emblemRingGeo} material={inlayMat} receiveShadow />
      <Inst geo={AG.unitPlane} mat={inlayMat} mats={EMBLEM_GLYPH} receiveShadow />
      <mesh position={[0.64, -0.13, 0]} geometry={emblemArrowGeo} material={inlayMat} />
      <mesh
        position={[0, 0, 0.001]}
        scale={[1.9, 1.9, 1]}
        geometry={AG.unitPlane}
        material={glowMat(P.holoCyan, 0.08)}
      />
    </group>
  )
}

/* ══ dais ════════════════════════════════════════════════════════════ */
function daisGeometry(): THREE.ExtrudeGeometry {
  // shape space (sx, sy) → world (x, −z) after the −π/2 X-rotation
  const a0 = Math.PI / 2 - DAIS.half
  const a1 = Math.PI / 2 + DAIS.half
  const s = new THREE.Shape()
  s.absarc(0, 0, DAIS.rOut, a0, a1, false)
  s.lineTo(Math.cos(a1) * DAIS.rIn, Math.sin(a1) * DAIS.rIn)
  s.absarc(0, 0, DAIS.rIn, a1, a0, true)
  s.closePath()
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: DAIS.h,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
    curveSegments: 72
  })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, -0.015, 0)
  return geo
}
const DAIS_GEO = daisGeometry()
/** lit nosing — torus arc along the dais' inner edge */
const NOSING_GEO = new THREE.TorusGeometry(DAIS.rIn + 0.012, 0.014, 6, 120, DAIS.half * 2)
/** riser shadow line — thin darker arc along the foot of the riser */
const FOOT_GLOW_GEO = new THREE.RingGeometry(DAIS.rIn - 0.35, DAIS.rIn, 96, 1, Math.PI / 2 - DAIS.half, DAIS.half * 2)

export function Dais(): JSX.Element {
  return (
    <group position={[HUB.x, 0, HUB.z]}>
      {/* graphite deck (extrude caps) over white composite risers (sides) */}
      <mesh geometry={DAIS_GEO} material={DAIS_MATS} receiveShadow castShadow />
      {/* lit nosing on the inner lip */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh
          position={[0, 0, DAIS.h - 0.03]}
          rotation={[0, 0, Math.PI / 2 - DAIS.half]}
          geometry={NOSING_GEO}
          material={stripMat}
        />
        {/* cyan wash spilling onto the floor at the foot of the riser */}
        <mesh position={[0, 0, 0.004]} geometry={FOOT_GLOW_GEO} material={daisFootMat} />
      </group>
    </group>
  )
}
const daisFootMat = new THREE.MeshBasicMaterial({
  color: P.holoDeep,
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})

/* ══ walls ═══════════════════════════════════════════════════════════
 * Each wall is a group the cutaway can hide as a unit. Back wall = glazing
 * between graphite mullions under a white soffit band. */
const GLAZE_X0 = GLAZING.x0
const GLAZE_X1 = GLAZING.x1
const GLAZE_CX = (GLAZE_X0 + GLAZE_X1) / 2
const GLAZE_TOP = 3.3
const MULLION_XS: number[] = []
for (let x = GLAZE_X0; x <= GLAZE_X1 + 0.01; x += (GLAZE_X1 - GLAZE_X0) / 6) MULLION_XS.push(x)

const BACK_SOLID = [
  // solid left half — the Hall of Armor pods mount into it
  mT((minX + GLAZE_X0) / 2, H / 2, minZ - WT / 2).multiply(mS(GLAZE_X0 - minX + 0.001, H, WT)),
  // right corner pier
  mT(maxX - 0.35, H / 2, minZ - WT / 2).multiply(mS(0.7 + 0.001, H, WT)),
  // soffit band over the glazing
  mT((GLAZE_X0 + maxX) / 2, (GLAZE_TOP + H) / 2, minZ - WT / 2).multiply(mS(maxX - GLAZE_X0, H - GLAZE_TOP, WT))
]
const BACK_MULLIONS = [
  ...MULLION_XS.map((x) => mT(x, GLAZE_TOP / 2, minZ - 0.02).multiply(mS(0.07, GLAZE_TOP, 0.14))),
  // sill + transom
  mT(GLAZE_CX, 0.03, minZ - 0.02).multiply(mS(GLAZE_X1 - GLAZE_X0, 0.06, 0.16)),
  mT(GLAZE_CX, 2.45, minZ - 0.02).multiply(mS(GLAZE_X1 - GLAZE_X0, 0.045, 0.1))
]
/* faint diagonal sheen bands on the glass — sells "glass" from any angle */
const SHEEN_MATS = [0.5, 1.2, 3.9, 4.5, 6.7].map((x, i) =>
  mT(x, GLAZE_TOP / 2, minZ - 0.03)
    .multiply(mR(0, 0, 0.5))
    .multiply(mS(i % 2 ? 0.18 : 0.42, GLAZE_TOP * 1.3, 1))
)

const SIDE_PANEL_Z = [-4.4, -2.8, -1.2, 0.4, 2.0, 3.6]
const LEFT_WALL = [mT(minX - WT / 2, H / 2, ROOM_CZ).multiply(mS(WT, H, ROOM_D + WT * 2))]
const RIGHT_WALL = [mT(maxX + WT / 2, H / 2, ROOM_CZ).multiply(mS(WT, H, ROOM_D + WT * 2))]
const LEFT_SEAMS = SIDE_PANEL_Z.map((z) => mT(minX + 0.012, H / 2 + 0.2, z).multiply(mS(0.02, H - 0.4, 0.025)))
const RIGHT_SEAMS = SIDE_PANEL_Z.filter((z) => z > -1).map((z) =>
  mT(maxX - 0.012, H / 2 + 0.2, z).multiply(mS(0.02, H - 0.4, 0.025))
)
/* light coves — a lit reveal under the soffit on all three walls */
const COVE_BACK = [mT(ROOM_CX, GLAZE_TOP + 0.03, minZ + 0.03).multiply(mS(ROOM_W - 0.2, 0.02, 0.02))]
const COVE_LEFT = [mT(minX + 0.03, 3.42, ROOM_CZ).multiply(mS(0.02, 0.02, ROOM_D - 0.2))]
const COVE_RIGHT = [mT(maxX - 0.03, 3.42, ROOM_CZ).multiply(mS(0.02, 0.02, ROOM_D - 0.2))]
const SOFFIT_LIP = [
  mT(minX + 0.08, 3.46, ROOM_CZ).multiply(mS(0.16, 0.06, ROOM_D)),
  mT(maxX - 0.08, 3.46, ROOM_CZ).multiply(mS(0.16, 0.06, ROOM_D))
]
/* baseboards — slim aluminium kick with a cyan reveal above */
const BASE_LEFT = [mT(minX + 0.015, 0.05, ROOM_CZ).multiply(mS(0.03, 0.1, ROOM_D))]
const BASE_RIGHT = [mT(maxX - 0.015, 0.05, ROOM_CZ).multiply(mS(0.03, 0.1, ROOM_D))]
/* wall caps — the diorama's finished top edge */
const CAP_BACK = [mT(ROOM_CX, H + 0.04, minZ - WT / 2).multiply(mS(ROOM_W + WT * 2 + 0.08, 0.08, WT + 0.08))]
const CAP_LEFT = [mT(minX - WT / 2, H + 0.04, ROOM_CZ).multiply(mS(WT + 0.08, 0.08, ROOM_D + WT * 2 + 0.08))]
const CAP_RIGHT = [mT(maxX + WT / 2, H + 0.04, ROOM_CZ).multiply(mS(WT + 0.08, 0.08, ROOM_D + WT * 2 + 0.08))]

/* front edge — open cutaway: a low graphite lip with a lit reveal */
const FRONT_LIP = [mT(ROOM_CX, 0.04, maxZ + 0.06).multiply(mS(ROOM_W + WT * 2, 0.08, 0.12))]
const FRONT_STRIP = [mT(ROOM_CX, 0.06, maxZ + 0.125).multiply(mS(ROOM_W + WT * 2 - 0.1, 0.012, 0.01))]

/* the building slab — white plinth standing on the lawn */
const PLINTH = [
  mT(ROOM_CX, GRADE_Y / 2 - 0.001, ROOM_CZ).multiply(mS(ROOM_W + WT * 2 + 0.3, -GRADE_Y, ROOM_D + WT * 2 + 0.3))
]

/** hides a wall group whenever the camera stands on its outer side — the
 * diorama is a dollhouse, walls between viewer and crew step aside */
function useCutaway(refs: {
  back: React.RefObject<THREE.Group | null>
  left: React.RefObject<THREE.Group | null>
  right: React.RefObject<THREE.Group | null>
}) {
  useFrame(({ camera }) => {
    const p = camera.position
    const m = 0.4
    if (refs.back.current) refs.back.current.visible = p.z > minZ - m
    if (refs.left.current) refs.left.current.visible = p.x > minX - m
    if (refs.right.current) refs.right.current.visible = p.x < maxX + m
  })
}

/** wall-mounted fixtures ride their wall's cutaway: the group hides when
 * the camera stands outside that wall, exactly like the wall itself */
export function Cutaway({ side, children }: { side: 'back' | 'left' | 'right'; children: ReactNode }): JSX.Element {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ camera }) => {
    const g = ref.current
    if (!g) return
    const p = camera.position
    const m = 0.4
    g.visible = side === 'back' ? p.z > minZ - m : side === 'left' ? p.x > minX - m : p.x < maxX + m
  })
  return <group ref={ref}>{children}</group>
}

export function Room({ onDeselect }: { onDeselect?: () => void }): JSX.Element {
  const { map, rough } = useMemo(paintFloor, [])
  useEffect(
    () => () => {
      map.dispose()
      rough.dispose()
    },
    [map, rough]
  )
  const back = useRef<THREE.Group>(null)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  useCutaway({ back, left, right })

  return (
    <group>
      {/* polished resin floor — tap on empty floor clears the selection;
          e.delta filters the pointerup at the end of a camera pan */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[ROOM_CX, 0, ROOM_CZ]}
        receiveShadow
        onClick={(e) => e.delta <= 6 && onDeselect?.()}
      >
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshPhysicalMaterial
          map={map}
          roughness={0.34}
          roughnessMap={rough}
          metalness={0.15}
          clearcoat={1}
          clearcoatRoughness={0.14}
          envMapIntensity={1.1}
        />
      </mesh>
      <Inst geo={AG.unitBox} mat={plinthMat} mats={PLINTH} receiveShadow />

      {/* inlaid light rings + spokes around the hub */}
      <group position={[HUB.x, 0.004, HUB.z]} rotation={[-Math.PI / 2, 0, 0]}>
        {ringGeos.map((g, i) => (
          <mesh key={i} geometry={g} material={floorLineMat} />
        ))}
      </group>
      <Inst geo={AG.unitPlane} mat={floorLineMat} mats={SPOKE_MATS} />

      {/* back wall — glazing onto the compound */}
      <group ref={back}>
        <Inst geo={AG.unitBox} mat={wallMat} mats={BACK_SOLID} castShadow receiveShadow />
        <Inst geo={AG.unitBox} mat={mullionMat} mats={BACK_MULLIONS} castShadow />
        <mesh position={[GLAZE_CX, GLAZE_TOP / 2, minZ - 0.02]} material={windowGlass}>
          <planeGeometry args={[GLAZE_X1 - GLAZE_X0, GLAZE_TOP]} />
        </mesh>
        <Inst geo={AG.unitPlane} mat={glassSheen} mats={SHEEN_MATS} />
        <Inst geo={AG.unitBox} mat={coveMat} mats={COVE_BACK} />
        <Inst geo={AG.unitBox} mat={capMat} mats={CAP_BACK} />
      </group>

      {/* left wall — the Hall of Armor mounts into it */}
      <group ref={left}>
        <Inst geo={AG.unitBox} mat={wallMat} mats={LEFT_WALL} castShadow receiveShadow />
        <Inst geo={AG.unitBox} mat={wallShadeMat} mats={LEFT_SEAMS} />
        <Inst geo={AG.unitBox} mat={coveMat} mats={COVE_LEFT} />
        <Inst geo={AG.unitBox} mat={wallMat} mats={SOFFIT_LIP.slice(0, 1)} />
        <Inst geo={AG.unitBox} mat={trimMat} mats={BASE_LEFT} />
        <Inst geo={AG.unitBox} mat={capMat} mats={CAP_LEFT} />
      </group>

      {/* right wall — bar + lounge side */}
      <group ref={right}>
        <Inst geo={AG.unitBox} mat={wallMat} mats={RIGHT_WALL} castShadow receiveShadow />
        <Inst geo={AG.unitBox} mat={wallShadeMat} mats={RIGHT_SEAMS} />
        <Inst geo={AG.unitBox} mat={coveMat} mats={COVE_RIGHT} />
        <Inst geo={AG.unitBox} mat={wallMat} mats={SOFFIT_LIP.slice(1)} />
        <Inst geo={AG.unitBox} mat={trimMat} mats={BASE_RIGHT} />
        <Inst geo={AG.unitBox} mat={capMat} mats={CAP_RIGHT} />
      </group>

      {/* open front — lit lip */}
      <Inst geo={AG.unitBox} mat={capMat} mats={FRONT_LIP} />
      <Inst geo={AG.unitBox} mat={stripMat} mats={FRONT_STRIP} />
    </group>
  )
}

/* ══ exterior — the compound grounds ═════════════════════════════════ */
const apronMat = new THREE.MeshStandardMaterial({ color: P.concrete, roughness: 0.85 })
const tarmacMat = new THREE.MeshStandardMaterial({ color: P.tarmac, roughness: 0.8 })
const padLineMat = new THREE.MeshStandardMaterial({ color: '#e9c24a', roughness: 0.6 })
const padWhiteMat = new THREE.MeshStandardMaterial({ color: '#e8eaec', roughness: 0.6 })
const treeMat = new THREE.MeshStandardMaterial({ color: P.tree, roughness: 0.9 })
const treeDarkMat = new THREE.MeshStandardMaterial({ color: P.treeDark, roughness: 0.9 })
const trunkMat = new THREE.MeshStandardMaterial({ color: P.trunk, roughness: 0.9 })
const hillMat = new THREE.MeshStandardMaterial({ color: '#5f7a55', roughness: 1 })
const bldgMat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.7 })
const bldgGlass = new THREE.MeshStandardMaterial({ color: '#34495c', roughness: 0.15, metalness: 0.6 })

/* mown-stripe lawn, painted once */
function paintLawn(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = P.lawn
  g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)'
    g.fillRect(i * 32, 0, 32, 256)
  }
  const rnd = lcg(5)
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(20,40,10,0.18)' : 'rgba(200,220,150,0.08)'
    g.fillRect(rnd() * 256, rnd() * 256, 2, 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(14, 14)
  tex.anisotropy = 8
  return tex
}

/* tree scatter — deterministic, keeps clear of the building + pad */
interface Tree {
  x: number
  z: number
  s: number
  dark: boolean
}
function scatterTrees(): Tree[] {
  const out: Tree[] = []
  const rnd = lcg(907)
  let guard = 0
  while (out.length < 64 && guard++ < 3000) {
    const x = -34 + rnd() * 68
    const z = -36 + rnd() * 50
    // keep clear: building + apron, pad, the front lawn the camera looks over
    if (x > minX - 4 && x < maxX + 4 && z > minZ - 4.5 && z < maxZ + 6) continue
    if (Math.hypot(x - LANDING_PAD.x, z - LANDING_PAD.z) < LANDING_PAD.r + 2.5) continue
    if (z > 2 && Math.abs(x) < 16) continue
    if (x > 2 && x < 18 && z < -21 && z > -29) continue // main building
    out.push({ x, z, s: 0.8 + rnd() * 0.7, dark: rnd() > 0.55 })
  }
  return out
}
const TREES = scatterTrees()
const TRUNK_MATS = TREES.map((t) => mT(t.x, GRADE_Y + 0.6 * t.s, t.z).multiply(mS(0.22 * t.s, 1.2 * t.s, 0.22 * t.s)))
const CROWN_A = TREES.filter((t) => !t.dark).flatMap((t) => [
  mT(t.x, GRADE_Y + 2.1 * t.s, t.z).multiply(mS(2.1 * t.s, 2.3 * t.s, 2.1 * t.s)),
  mT(t.x + 0.35 * t.s, GRADE_Y + 2.9 * t.s, t.z - 0.2 * t.s).multiply(mS(1.4 * t.s, 1.6 * t.s, 1.4 * t.s))
])
const CROWN_B = TREES.filter((t) => t.dark).map((t) =>
  mT(t.x, GRADE_Y + 2.4 * t.s, t.z).multiply(mS(1.7 * t.s, 3.6 * t.s, 1.7 * t.s))
)

/* landing pad markings — ring, H, edge lights */
const PAD_EDGE_LIGHTS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2
  return mT(
    LANDING_PAD.x + Math.cos(a) * (LANDING_PAD.r - 0.25),
    GRADE_Y + 0.06,
    LANDING_PAD.z + Math.sin(a) * (LANDING_PAD.r - 0.25)
  ).multiply(mS(0.12, 0.08, 0.12))
})
const padRingGeo = new THREE.RingGeometry(LANDING_PAD.r - 0.75, LANDING_PAD.r - 0.55, 96)

/* main compound building across the lawn — long white block, glass band */
const BLDG = [
  mT(9.5, GRADE_Y + 2.6, -25).multiply(mS(15, 5.2, 6)),
  mT(19, GRADE_Y + 1.9, -22.5).multiply(mS(6, 3.8, 9))
]
const BLDG_GLASS = [
  mT(9.5, GRADE_Y + 2.9, -21.98).multiply(mS(14.2, 1.5, 0.05)),
  mT(15.97, GRADE_Y + 1.8, -22.5).multiply(mS(0.05, 1.3, 8.2))
]
const HILLS = [
  mT(-20, -3, -48).multiply(mS(40, 12, 14)),
  mT(16, -4, -52).multiply(mS(46, 14, 16)),
  mT(-2, -5, -58).multiply(mS(60, 16, 14))
]
/* apron walk around the building + a path out to the pad */
const APRON = [
  mT(ROOM_CX, GRADE_Y + 0.01, ROOM_CZ).multiply(mS(ROOM_W + 3.2, 0.02, ROOM_D + 3.2)),
  mT(LANDING_PAD.x, GRADE_Y + 0.01, (minZ - 1.6 + LANDING_PAD.z + LANDING_PAD.r) / 2).multiply(
    mS(2.4, 0.02, Math.abs(minZ - 1.6 - (LANDING_PAD.z + LANDING_PAD.r)))
  )
]

export function Exterior(): JSX.Element {
  const lawn = useMemo(paintLawn, [])
  useEffect(() => () => lawn.dispose(), [lawn])
  return (
    <group>
      {/* the lawn — a big disc so its edge dissolves into the fog */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GRADE_Y, -6]} receiveShadow>
        <circleGeometry args={[70, 48]} />
        <meshStandardMaterial map={lawn} roughness={0.95} />
      </mesh>
      <Inst geo={AG.unitBox} mat={apronMat} mats={APRON} receiveShadow />

      {/* Quinjet pad — tarmac disc, yellow ring, white H, edge lights */}
      <group position={[LANDING_PAD.x, GRADE_Y + 0.03, LANDING_PAD.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={tarmacMat}>
          <circleGeometry args={[LANDING_PAD.r, 64]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} geometry={padRingGeo} material={padLineMat} />
        <group rotation={[0, 0.5, 0]} position={[0, 0.006, 0]}>
          {[-0.9, 0.9].map((x) => (
            <mesh
              key={x}
              position={[x, 0, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={[0.35, 2.6, 1]}
              geometry={AG.unitPlane}
              material={padWhiteMat}
            />
          ))}
          <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1.5, 0.35, 1]} geometry={AG.unitPlane} material={padWhiteMat} />
        </group>
      </group>
      <Inst geo={AG.cyl} mat={lightMat('#ffd27a')} mats={PAD_EDGE_LIGHTS} />

      {/* tree line */}
      <Inst geo={AG.cylLo} mat={trunkMat} mats={TRUNK_MATS} castShadow />
      <Inst geo={AG.sphere} mat={treeMat} mats={CROWN_A} castShadow />
      <Inst geo={AG.cone} mat={treeDarkMat} mats={CROWN_B} castShadow />

      {/* main compound building + rolling hills beyond (fogged) */}
      <Inst geo={AG.unitBox} mat={bldgMat} mats={BLDG} castShadow receiveShadow />
      <Inst geo={AG.unitBox} mat={bldgGlass} mats={BLDG_GLASS} />
      <Inst geo={AG.sphere} mat={hillMat} mats={HILLS} />

      {/* warm pad glow pooled on the tarmac */}
      <mesh
        position={[LANDING_PAD.x, GRADE_Y + 0.05, LANDING_PAD.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[LANDING_PAD.r * 2.3, LANDING_PAD.r * 2.3, 1]}
        geometry={AG.unitPlane}
        material={glowMat('#ffcf80', 0.08)}
      />
    </group>
  )
}
