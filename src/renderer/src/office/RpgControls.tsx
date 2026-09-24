// ── RpgControls — top-down sim camera (Youtuber's Life style) ─────────
// Left-drag pans, right-drag rotates, wheel zooms toward the cursor,
// WASD/arrows glide the target. Polar angle is clamped so the view can
// never dip below a tabletop tilt — the loft always reads as a diorama.

import { useEffect, useRef, type ComponentRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import * as THREE from 'three'
import { ROOM } from './layout'

type MapControlsImpl = ComponentRef<typeof MapControls>

// camera-relative pan bounds — the target can roam the whole loft but
// never leaves the walls
const TARGET_MIN_X = -ROOM.w / 2 + 0.6
const TARGET_MAX_X = ROOM.w / 2 - 0.6
const TARGET_MIN_Z = -ROOM.d / 2 + 0.6
const TARGET_MAX_Z = ROOM.d / 2 - 0.6
const PAN_SPEED = 5.2 // m/s at full tilt
const DRAG_CLICK_PX = 6 // > this many px of drag ≠ a click

/** pan-clamp rect for a differently-sized room (e.g. the avengers facility) */
export interface RpgBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
const DEFAULT_BOUNDS: RpgBounds = {
  minX: TARGET_MIN_X,
  maxX: TARGET_MAX_X,
  minZ: TARGET_MIN_Z,
  maxZ: TARGET_MAX_Z
}

export function RpgControls({
  bounds = DEFAULT_BOUNDS,
  maxDistance = 15,
  minDistance = 2.4,
  minPolarAngle = 0.14,
  maxPolarAngle = 1.05,
  target
}: {
  bounds?: RpgBounds
  maxDistance?: number
  /** closest zoom (default 2.4) */
  minDistance?: number
  /** tilt limits in rad from straight-down (defaults 0.14 … 1.05) */
  minPolarAngle?: number
  maxPolarAngle?: number
  /** initial orbit target (default: world origin) — pass a stable
   * (module-level) tuple; a new identity re-applies it */
  target?: [number, number, number]
}) {
  const controls = useRef<MapControlsImpl | null>(null)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const keys = useRef<Record<string, boolean>>({})
  // scratch vectors — allocated once, never per frame
  const fwd = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const move = useRef(new THREE.Vector3())

  useEffect(() => {
    const dom = gl.domElement
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      keys.current[e.code] = true
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }
    const blur = () => {
      keys.current = {}
    }
    // right-click is the rotate button — kill the context menu so it
    // doesn't fight the drag
    const ctx = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    dom.addEventListener('contextmenu', ctx)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      dom.removeEventListener('contextmenu', ctx)
    }
  }, [gl])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const k = keys.current
    const dx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)
    const dz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0)
    if (dx !== 0 || dz !== 0) {
      // pan along the camera's ground-projected axes so "up" is always
      // away-from-viewer regardless of yaw
      camera.getWorldDirection(fwd.current)
      fwd.current.y = 0
      fwd.current.normalize()
      right.current.crossVectors(fwd.current, camera.up).normalize()
      move.current
        .set(0, 0, 0)
        .addScaledVector(fwd.current, -dz)
        .addScaledVector(right.current, dx)
      const speed = PAN_SPEED * (k.ShiftLeft || k.ShiftRight ? 2.2 : 1) * Math.min(dt, 0.05)
      c.target.addScaledVector(move.current, speed)
      camera.position.addScaledVector(move.current, speed)
    }
    // keep the orbit target inside the loft — pan/zoom can't strand the
    // view outside the walls
    const t = c.target
    t.x = Math.min(bounds.maxX, Math.max(bounds.minX, t.x))
    t.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, t.z))
    t.y = Math.min(1.6, Math.max(0, t.y))
    c.update()
  })

  return (
    <MapControls
      ref={controls}
      enableDamping
      dampingFactor={0.09}
      // zoom: close enough to read a monitor, far enough to see the loft
      minDistance={minDistance}
      maxDistance={maxDistance}
      // tilt: near straight-down (0.14) … classic sim angle (~60°) — never
      // eye-level, so the room always reads as a tabletop diorama
      minPolarAngle={minPolarAngle}
      maxPolarAngle={maxPolarAngle}
      panSpeed={1.05}
      zoomToCursor
      makeDefault
      {...(target ? { target } : {})}
    />
  )
}

/** Click-vs-drag guard for mesh onClick — R3F reports the pointerdown→up
 * travel in `event.delta`; pans/right-drag rotates exceed it, taps don't. */
export function isClick(e: { delta: number }): boolean {
  return e.delta <= DRAG_CLICK_PX
}
