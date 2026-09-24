/* ── Avengers Compound — shared registry ───────────────────────────────
 * Re-exports the loft's matrix helpers + instancing so every prop file
 * uses the same baked-transform discipline. Facility-wide geometries /
 * materials live here; prop-specific ones live at module scope in the
 * prop file that owns them.
 *
 * External consumers: city/HQBuilding (AG.cone/cyl/sphere, AM.arcCore/
 * arcRing/darkMetal/holoSolid/screenDark/steelHi) and characters.tsx
 * (AG.*) — keep every existing key; only ever add. */

import * as THREE from 'three'
import { P } from './palette'
import { microSurface } from '../SurfaceMaterials'

export { mT, mR, mS } from '../shared'
export { Inst } from '../Inst'
export { hash01 } from './layout'

/* ── shared small geometries (facility-wide) ───────────────────────────── */
export const AG = {
  unitBox: new THREE.BoxGeometry(1, 1, 1),
  unitPlane: new THREE.PlaneGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  cylHi: new THREE.CylinderGeometry(0.5, 0.5, 1, 40),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  sphereHi: new THREE.SphereGeometry(0.5, 28, 20),
  cone: new THREE.ConeGeometry(0.5, 1, 12),
  torus: new THREE.TorusGeometry(0.5, 0.06, 10, 24),
  /** unit ring in the XY plane — tube radius tiny, scale x/y for radius */
  ring: new THREE.TorusGeometry(1, 0.012, 6, 96),
  disc: new THREE.CircleGeometry(0.5, 48),
  ledDot: new THREE.SphereGeometry(0.012, 6, 6)
} as const

/* ── radial glow sprite — the fake-bloom workhorse ─────────────────────
 * White radial falloff painted once; tinted per material. Used flat on the
 * floor as light pools / fake reflections and upright as halos. */
let glowTexCache: THREE.CanvasTexture | null = null
export function glowTexture(): THREE.CanvasTexture {
  if (glowTexCache) return glowTexCache
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  glowTexCache = tex
  return tex
}

/** vertical fade strip (opaque bottom → clear top) — light shafts, beams */
let fadeTexCache: THREE.CanvasTexture | null = null
export function fadeTexture(): THREE.CanvasTexture {
  if (fadeTexCache) return fadeTexCache
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 128, 0, 0)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 8, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  fadeTexCache = tex
  return tex
}

const glowMats = new Map<string, THREE.MeshBasicMaterial>()
/** cached additive glow material — one per (color, opacity) pair */
export function glowMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`
  let m = glowMats.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      map: glowTexture(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
    glowMats.set(key, m)
  }
  return m
}

const emissiveMats = new Map<string, THREE.MeshBasicMaterial>()
/** cached unlit "light source" material (LED strips, lit signage) */
export function lightMat(color: string): THREE.MeshBasicMaterial {
  let m = emissiveMats.get(color)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false })
    emissiveMats.set(color, m)
  }
  return m
}

/* ── shared materials ──────────────────────────────────────────────────── */
export const AM = {
  darkMetal: new THREE.MeshStandardMaterial({
    color: '#22262f',
    roughness: 0.42,
    metalness: 0.55,
    ...microSurface('metal')
  }),
  graphite: new THREE.MeshStandardMaterial({ color: '#2b3039', roughness: 0.55, metalness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({
    color: '#8b95a6',
    roughness: 0.35,
    metalness: 0.7,
    ...microSurface('metal')
  }),
  steelHi: new THREE.MeshStandardMaterial({
    color: '#c7cfdb',
    roughness: 0.25,
    metalness: 0.85,
    ...microSurface('metal')
  }),
  whitePanel: new THREE.MeshStandardMaterial({ color: P.wall, roughness: 0.62, metalness: 0.05 }),
  whiteGloss: new THREE.MeshPhysicalMaterial({
    color: P.chairShell,
    roughness: 0.28,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2
  }),
  benchTop: new THREE.MeshPhysicalMaterial({
    color: P.benchTop,
    roughness: 0.4,
    metalness: 0.25,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.25
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: P.glassBlue,
    transparent: true,
    opacity: 0.16,
    roughness: 0.05,
    metalness: 0,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  holo: new THREE.MeshBasicMaterial({
    color: P.holoCyan,
    transparent: true,
    opacity: 0.35,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  holoAdd: new THREE.MeshBasicMaterial({
    color: P.holoCyan,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  holoSolid: new THREE.MeshBasicMaterial({ color: P.holoCyan, toneMapped: false }),
  holoDeep: new THREE.MeshBasicMaterial({ color: P.holoDeep, toneMapped: false }),
  holoWhite: new THREE.MeshBasicMaterial({ color: P.holoWhite, toneMapped: false }),
  screenDark: new THREE.MeshStandardMaterial({ color: P.screenDark, roughness: 0.2, metalness: 0.3 }),
  arcCore: new THREE.MeshBasicMaterial({ color: P.arcCore, toneMapped: false }),
  arcRing: new THREE.MeshBasicMaterial({ color: P.arcRing, toneMapped: false }),
  ironRed: new THREE.MeshPhysicalMaterial({
    color: P.ironRed,
    roughness: 0.28,
    metalness: 0.55,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15
  }),
  ironGold: new THREE.MeshPhysicalMaterial({
    color: P.ironGold,
    roughness: 0.26,
    metalness: 0.85,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2
  }),
  warMachine: new THREE.MeshStandardMaterial({
    color: P.warMachine,
    roughness: 0.38,
    metalness: 0.75,
    ...microSurface('metal')
  }),
  rackBody: new THREE.MeshStandardMaterial({ color: P.rackBody, roughness: 0.6, metalness: 0.3 }),
  ledGreen: new THREE.MeshBasicMaterial({ color: P.rackLed, toneMapped: false }),
  ledWarn: new THREE.MeshBasicMaterial({ color: P.ledWarn, toneMapped: false }),
  ledAlert: new THREE.MeshBasicMaterial({ color: P.alert, toneMapped: false }),
  logo: new THREE.MeshStandardMaterial({
    color: P.logo,
    roughness: 0.3,
    metalness: 0.6,
    ...microSurface('metal')
  }),
  cable: new THREE.MeshStandardMaterial({ color: '#14161b', roughness: 0.9 })
} as const
