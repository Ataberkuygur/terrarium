// ── CityScene — street-level miniature city view ───────────────────
// The Office tab's establishing shot: the camera sits south of the main
// road looking north at the HQ tower — one floor per department, click a
// floor to enter that department's interior. Composes CitySky + CityBlock
// + HQBuilding + StreetLife inside a single Canvas; OrbitControls gives a
// gentle look-around without ever leaving the across-the-road anchor.
//
// Lighting is a late-afternoon rig: one warm golden-hour key sun (the
// scene's only shadow caster — a tight ±35u ortho box over the HQ + road
// band), a cool hemisphere dome, and a weak cool rim from behind-right
// for silhouette separation. theme='avengers' adds a cyan arc-reactor
// point light floating just off the HQ crown.

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Environment, OrbitControls, PerformanceMonitor } from '@react-three/drei'
import type { Department } from '../../lib/departments'
import { CITY, towerHeight } from './layout'
import { CitySky, SKY_LOW } from './CitySky'
import { HQBuilding } from './HQBuilding'
import { CityBlock } from './CityBlock'
import { StreetLife } from './StreetLife'
import { surfaceAssets } from '../SurfaceMaterials'

/* layout tuples are `as const` (readonly) — spread into mutable triples
 * for the R3F/drei prop types */
const CAM_POS: [number, number, number] = [...CITY.camPos]

/* key sun — front-left-high but on a shallow ~26° arc so the light reads
 * golden-hour and the floor slabs drag soft shadows down the facade.
 * The target pulls the shadow frustum's center onto the HQ + road band
 * instead of the world origin — tighter coverage for the same texels. */
const SUN_POS: [number, number, number] = [-33, 15.5, 9]
const SUN_TARGET: [number, number, number] = [2, 2, -10]
/* cool rim — behind-right-high, opposite the key; fills silhouettes,
 * casts nothing */
const RIM_POS: [number, number, number] = [22, 20, -30]

/* initial polar angle from camPos→camTarget is ≈1.50 rad (offset nearly
 * horizontal: dy 1.8 over r ≈26.4). maxPolarAngle is set a hair above it
 * (1.54 ≈ 88°) so the establishing shot isn't re-framed by the clamp on
 * the first controls update — still bounded below eye level, so the view
 * can never dip under the ground plane. */
const POLAR_MIN = 0.9
const POLAR_MAX = 1.54

/* Shadow flags are a scene-level decision: CityBlock marks its own
 * meshes, but HQBuilding is authored shadow-agnostic — this wrapper
 * traverses it and flags every visible mesh to receive, plus cast when
 * the material is fully opaque (transparent glass panes and additive
 * hover veils must not punch solid silhouettes into the shadow map).
 * Runs every commit, so instanced sets rebuilt on dept/theme changes
 * get re-flagged too. */
function HqShadows({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null)
  useEffect(() => {
    g.current?.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.visible) return
      m.receiveShadow = true
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      m.castShadow = mats.every((mm) => !mm.transparent)
    })
  })
  return <group ref={g}>{children}</group>
}

/* Frames the tower + street on mount / dept-count / viewport changes, then
 * hands control back to the user — never runs per frame. The shot is a
 * low 3/4 establishing view: ~8° above the horizon, slightly east of the
 * HQ axis, far enough back that the road + near curb sit in the bottom
 * band and the crown clears the skyline with sky above it. */
function CityFraming({ floorCount }: { floorCount: number }): null {
  const { camera, size } = useThree()
  const controls = useThree((s) => s.controls) as {
    target: THREE.Vector3
    update: () => void
  } | null
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !controls) return
    const h = towerHeight(Math.max(1, floorCount)) + 1.5
    const aspect = Math.max(0.6, size.width / Math.max(1, size.height))
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const distance = Math.max(33, ((h + 5) / (2 * tan)) * 1.12, 17.5 / (tan * aspect))
    const target = new THREE.Vector3(CITY.hqX + 0.6, Math.min(h * 0.36, 9), CITY.hqZ + 1.2)
    camera.position.copy(target).add(FRAME_DIR.clone().multiplyScalar(distance))
    controls.target.copy(target)
    controls.update()
  }, [camera, controls, floorCount, size.width, size.height])
  return null
}
const FRAME_DIR = new THREE.Vector3(0.15, 0.14, 1).normalize()

export interface CitySceneProps {
  departments: Department[] // from lib/departments
  counts?: Record<string, number> // deptId -> member count
  onEnterDept: (deptId: string) => void
  /** true while the view is hidden — Canvas gets frameloop='never' so the
   *  mounted scene stops burning GPU (same pattern as OfficeScene). */
  paused?: boolean
  /** tower skin — forwarded to HQBuilding; 'avengers' also mounts the
   *  cyan arc-reactor accent light at the crown. Default 'loft'. */
  theme?: 'loft' | 'avengers'
}

export function CityScene({
  departments,
  counts,
  onEnterDept,
  paused = false,
  theme = 'loft'
}: CitySceneProps): JSX.Element {
  /* Adaptive pixel ratio — renders at 1.75 when there's headroom, and
   * PerformanceMonitor steps it down to 1 under sustained load (and back
   * up when frames free up). Same pattern as OfficeScene. */
  const [dpr, setDpr] = useState(1.75)

  /* directional-light target — an Object3D parked in the scene so three
   * keeps its matrixWorld fresh; the key sun aims at it, centering the
   * ±35u shadow box on the HQ + road band */
  const sunTarget = useMemo(() => new THREE.Object3D(), [])

  /* arc-reactor accent — hovers just off the crown parapet, in front of
   * the facade, so the cyan wash falls on the tower's upper floors */
  const crownLightY = towerHeight(departments.length) + 0.7

  return (
    <Canvas
      shadows="soft" // PCFSoft — one shadow map total, on the key sun only
      dpr={dpr}
      frameloop={paused ? 'never' : 'always'}
      // street-level 3/4 view across the road at the HQ tower
      camera={{ position: CAM_POS, fov: 42, near: 0.5, far: 520 }}
      gl={{
        antialias: true, // native MSAA — no postprocessing chain
        powerPreference: 'high-performance',
        toneMapping: THREE.NeutralToneMapping, // truer, less washed hues than ACES
        toneMappingExposure: 1.3,
        outputColorSpace: THREE.SRGBColorSpace
      }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* horizon haze — shares CitySky's golden low band so the skyline
          strip melts into the dome; near/far keep the HQ crisp while the
          far silhouettes dissolve */}
      <color attach="background" args={[SKY_LOW]} />
      <fog attach="fog" args={[SKY_LOW, 26, 175]} />

      {/* golden-hour rig — warm key sun front-left-high on a shallow arc
          (the scene's only shadow caster), blue-ish hemisphere fill, and
          a weak cool rim from behind-right that separates rooftops from
          the sky. Point/spot accents stay off — the sun + shadows carry
          the dimension on their own */}
      <ambientLight intensity={0.1} color="#efe4d4" />
      <hemisphereLight args={['#9dbbe8', '#7a6752', 0.36]} />
      <primitive object={sunTarget} position={SUN_TARGET} />
      <directionalLight
        position={SUN_POS}
        target={sunTarget}
        intensity={3.7}
        color="#ffd09a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-42}
        shadow-camera-right={42}
        shadow-camera-top={34}
        shadow-camera-bottom={-34}
        shadow-camera-near={2}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
      />
      <directionalLight position={RIM_POS} intensity={0.5} color="#c3d6f0" />

      {/* arc-reactor ambience — avengers skin only: a small cyan point
          light floating just off the crown, distance-capped so the wash
          stays on the tower's upper floors; casts nothing */}
      {theme === 'avengers' && (
        <pointLight
          position={[CITY.hqX, crownLightY, CITY.hqFacadeZ + 1.6]}
          intensity={6}
          distance={15}
          decay={2}
          color="#6fd8ff"
        />
      )}

      <CitySky />
      {/* local HDRI — reflections on the curtain walls + vehicles;
          the visible sky stays CitySky's authored dome */}
      <Suspense fallback={null}>
        <Environment
          files={surfaceAssets.environment}
          background={false}
          environmentIntensity={0.24}
        />
      </Suspense>
      <CityBlock animated={!paused} />
      <StreetLife animated={!paused} />
      <HqShadows>
        <HQBuilding
          departments={departments}
          counts={counts}
          onFloorClick={onEnterDept}
          theme={theme}
        />
      </HqShadows>

      {/* anchored look-around — orbit target locked at camTarget, pan off,
          tight distance/azimuth/polar clamps keep the user across the road */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={8}
        maxDistance={Math.max(52, towerHeight(departments.length) * 3)}
        minPolarAngle={POLAR_MIN}
        maxPolarAngle={POLAR_MAX}
        minAzimuthAngle={-0.5}
        maxAzimuthAngle={0.5}
      />
      <CityFraming floorCount={departments.length} />

      {/* auto quality: sustained low fps → dpr steps down; headroom → back
          up. flipflops keeps it from oscillating between the two states */}
      <PerformanceMonitor
        ms={250}
        iterations={8}
        step={0.5}
        flipflops={3}
        onDecline={() => setDpr(1)}
        onIncline={() => setDpr(1.75)}
      />
    </Canvas>
  )
}
