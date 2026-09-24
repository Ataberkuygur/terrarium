/* ── city kit ──────────────────────────────────────────────────────────
 * The procedural building-block toolkit every static piece of the city is
 * assembled from. A `Batch` collects (matrix, color) pairs per part kind —
 * solid masonry, window panes, lit glass, foliage, cylinders… — and
 * <BatchMeshes> renders each kind as ONE InstancedMesh with per-instance
 * color. The whole block (buildings, street furniture, park) funnels into
 * a single batch, so hundreds of shapes cost ~a dozen draw calls.
 *
 * Materials are module singletons. The opaque ones get a tiny shader
 * patch (`groundAO`) that darkens surfaces near y=0 — a cheap baked
 * contact-occlusion that makes every building and prop sit ON the street
 * instead of floating over it, with zero extra passes.
 *
 * Determinism: all variation flows through `h01` (string-seeded hash), so
 * the city is pixel-identical on every mount.
 */
import { useLayoutEffect, useMemo, useRef, type JSX } from 'react'
import * as THREE from 'three'
import { beveledBox, sculptedCanopy } from '../ModelGeometry'

// ── deterministic hash ───────────────────────────────────────────────

/** FNV-style string hash → [0,1). Same input, same output, every launch. */
export function h01(key: string, n = 0): number {
  let h = 2166136261 ^ n
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= n * 374761393
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** pick from a list by hash */
export const pick = <T,>(list: readonly T[], key: string, n = 0): T =>
  list[Math.floor(h01(key, n) * list.length) % list.length]

// ── transforms ───────────────────────────────────────────────────────

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler(0, 0, 0, 'YXZ') // yaw applied last: tilts stay local

/** translate · rotate(yaw ∘ pitch ∘ roll) · scale — fresh Matrix4 (module-build time only) */
export function tm(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  ry = 0,
  rx = 0,
  rz = 0
): THREE.Matrix4 {
  _p.set(x, y, z)
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'))
  _s.set(sx, sy, sz)
  return new THREE.Matrix4().compose(_p, _q, _s)
}

/** color with a small hashed lightness/hue wobble — breaks up repeats */
export function jit(hex: THREE.ColorRepresentation, key: string, n = 0, amt = 0.05): THREE.Color {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  const dl = (h01(key, n) - 0.5) * 2 * amt
  const dh = (h01(key, n + 7919) - 0.5) * amt * 0.25
  return c.setHSL((hsl.h + dh + 1) % 1, hsl.s, THREE.MathUtils.clamp(hsl.l + dl, 0, 1))
}

// ── ground contact occlusion shader patch ────────────────────────────

/* Darkens diffuse near the ground: fake ambient occlusion where walls
 * meet pavement. Works for instanced + plain meshes; world-space y. */
function groundAO(mat: THREE.Material, strength = 0.3, height = 1.6): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCityY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cityWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cityWp = instanceMatrix * cityWp;
        #endif
        cityWp = modelMatrix * cityWp;
        vCityY = cityWp.y;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCityY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(${(1 - strength).toFixed(3)}, 1.0, smoothstep(0.0, ${height.toFixed(3)}, vCityY));`
      )
  }
  mat.customProgramCacheKey = () => `cityAO-${strength}-${height}`
  return mat
}

// ── materials ────────────────────────────────────────────────────────

const W = '#ffffff'

export const KIT_MAT = {
  /* masonry, concrete, paint — per-instance tinted */
  solid: groundAO(new THREE.MeshStandardMaterial({ color: W, roughness: 0.86, metalness: 0 })),
  /* painted iron, poles, fire escapes — a touch of sheen */
  metal: groundAO(new THREE.MeshStandardMaterial({ color: W, roughness: 0.45, metalness: 0.55 }), 0.2),
  /* ground-level surfaces (paint, paving, curbs) — no contact darkening */
  flat: new THREE.MeshStandardMaterial({ color: W, roughness: 0.92, metalness: 0 }),
  /* curtain wall — tinted reflective glass that picks up the HDRI */
  glass: groundAO(
    new THREE.MeshStandardMaterial({ color: W, roughness: 0.12, metalness: 0.72, envMapIntensity: 1.15 }),
    0.2
  ),
  /* window panes — dark glass with a soft reflection */
  pane: new THREE.MeshStandardMaterial({ color: W, roughness: 0.2, metalness: 0.55, envMapIntensity: 0.9 }),
  /* lit glass / signage / lamps — unlit, not tone mapped: fake glow */
  lit: new THREE.MeshBasicMaterial({ color: W, toneMapped: false }),
  /* foliage — rough, slightly subsurface-y via emissive lift */
  foliage: groundAO(
    new THREE.MeshStandardMaterial({ color: W, roughness: 0.95, metalness: 0, flatShading: false }),
    0.35,
    1.2
  ),
  /* translucent water */
  water: new THREE.MeshStandardMaterial({
    color: '#7fc0dc',
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: 0.82,
    envMapIntensity: 1.4
  })
}

// ── geometries (unit-sized, scaled per instance) ─────────────────────

const canopy = sculptedCanopy()
canopy.scale(1 / 1.1, 1 / 1.1, 1 / 1.1) // radius .55 → diameter ≈1

export const KIT_GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 12),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  canopy,
  bevel: beveledBox(1, 1, 1, 0.16, 2)
}

// ── part kinds ───────────────────────────────────────────────────────

export type Kind =
  | 'solid'
  | 'metal'
  | 'glass'
  | 'pane'
  | 'lit'
  | 'cyl'
  | 'cylMetal'
  | 'cone'
  | 'sphere'
  | 'litSphere'
  | 'litCyl'
  | 'foliage'
  | 'bevel'
  | 'flat'
  | 'flatCyl'

interface KindDef {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  cast: boolean
  receive: boolean
}

const KINDS: Record<Kind, KindDef> = {
  solid: { geo: KIT_GEO.box, mat: KIT_MAT.solid, cast: true, receive: true },
  metal: { geo: KIT_GEO.box, mat: KIT_MAT.metal, cast: true, receive: false },
  glass: { geo: KIT_GEO.box, mat: KIT_MAT.glass, cast: true, receive: true },
  pane: { geo: KIT_GEO.box, mat: KIT_MAT.pane, cast: false, receive: true },
  lit: { geo: KIT_GEO.box, mat: KIT_MAT.lit, cast: false, receive: false },
  cyl: { geo: KIT_GEO.cyl, mat: KIT_MAT.solid, cast: true, receive: true },
  cylMetal: { geo: KIT_GEO.cylLo, mat: KIT_MAT.metal, cast: true, receive: false },
  cone: { geo: KIT_GEO.cone, mat: KIT_MAT.solid, cast: true, receive: true },
  sphere: { geo: KIT_GEO.sphere, mat: KIT_MAT.solid, cast: true, receive: true },
  litSphere: { geo: KIT_GEO.sphere, mat: KIT_MAT.lit, cast: false, receive: false },
  litCyl: { geo: KIT_GEO.cylLo, mat: KIT_MAT.lit, cast: false, receive: false },
  foliage: { geo: KIT_GEO.canopy, mat: KIT_MAT.foliage, cast: true, receive: true },
  bevel: { geo: KIT_GEO.bevel, mat: KIT_MAT.solid, cast: true, receive: true },
  flat: { geo: KIT_GEO.box, mat: KIT_MAT.flat, cast: false, receive: true },
  flatCyl: { geo: KIT_GEO.cyl, mat: KIT_MAT.flat, cast: false, receive: true }
}

const KIND_ORDER = Object.keys(KINDS) as Kind[]

interface PartSet {
  mats: THREE.Matrix4[]
  cols: THREE.Color[]
}

/** a lettered shop-sign quad: centre, facing axis/sign, size, atlas row */
export interface SignQuad {
  x: number
  y: number
  z: number
  w: number
  h: number
  /** outward normal: 's' +z, 'n' -z, 'e' +x, 'w' -x */
  face: 'n' | 's' | 'e' | 'w'
  row: number
}

/** Accumulates instanced parts for one or more static sub-scenes. */
export class Batch {
  readonly sets: Partial<Record<Kind, PartSet>> = {}
  readonly signs: SignQuad[] = []

  sign(q: SignQuad): void {
    this.signs.push(q)
  }

  put(kind: Kind, m: THREE.Matrix4, color: THREE.ColorRepresentation | THREE.Color): void {
    let s = this.sets[kind]
    if (!s) s = this.sets[kind] = { mats: [], cols: [] }
    s.mats.push(m)
    s.cols.push(color instanceof THREE.Color ? color : new THREE.Color(color))
  }

  /** axis-aligned (optionally yawed) scaled part centered at x,y,z */
  box(
    kind: Kind,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation | THREE.Color,
    ry = 0
  ): void {
    this.put(kind, tm(x, y, z, sx, sy, sz, ry), color)
  }

  /** part whose BOTTOM sits at y (handy for anything standing on ground) */
  stand(
    kind: Kind,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: THREE.ColorRepresentation | THREE.Color,
    ry = 0
  ): void {
    this.put(kind, tm(x, y + sy / 2, z, sx, sy, sz, ry), color)
  }

  count(): number {
    let n = 0
    for (const k of KIND_ORDER) n += this.sets[k]?.mats.length ?? 0
    return n
  }
}

// ── shop-sign atlas ──────────────────────────────────────────────────

export const SIGN_NAMES = [
  'CAFÉ',
  'DELI',
  'PIZZA',
  'BAKERY',
  'BOOKS',
  'FLOWERS',
  'LAUNDRY',
  'DINER',
  'MARKET',
  'GALLERY',
  'WINE BAR',
  'RAMEN',
  'BAGELS',
  'PHARMACY',
  'HARDWARE',
  'TAILOR'
]
const SIGN_ROWS = SIGN_NAMES.length
const SIGN_FONTS = ['700 40px Georgia, serif', '800 38px "Segoe UI", Arial, sans-serif', 'italic 700 40px Georgia, serif', '700 36px "Arial Black", Arial, sans-serif']
const SIGN_INK = ['#ffe7b0', '#fff6e6', '#ffd27a', '#f6efe2']

let _signTex: THREE.CanvasTexture | null = null
function signTex(): THREE.CanvasTexture {
  if (_signTex) return _signTex
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 64 * SIGN_ROWS
  const g = c.getContext('2d')!
  const paint = () => {
    g.clearRect(0, 0, c.width, c.height)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    SIGN_NAMES.forEach((name, i) => {
      g.font = SIGN_FONTS[i % SIGN_FONTS.length]
      g.fillStyle = SIGN_INK[i % SIGN_INK.length]
      const y = i * 64 + 34
      // letter-spaced caps read better at thumbnail scale
      const spaced = name.split('').join(String.fromCharCode(8202))
      g.fillText(spaced, 256, y, 480)
    })
  }
  paint()
  _signTex = new THREE.CanvasTexture(c)
  _signTex.colorSpace = THREE.SRGBColorSpace
  _signTex.anisotropy = 8
  document.fonts?.ready.then(() => {
    paint()
    if (_signTex) _signTex.needsUpdate = true
  })
  return _signTex
}

const RIGHT: Record<SignQuad['face'], [number, number]> = { s: [1, 0], n: [-1, 0], e: [0, -1], w: [0, 1] }

/** merges every sign quad of a batch into one textured draw */
function signGeometry(signs: SignQuad[]): THREE.BufferGeometry {
  const pos = new Float32Array(signs.length * 12)
  const uv = new Float32Array(signs.length * 8)
  const idx: number[] = []
  signs.forEach((q, i) => {
    const [rx, rz] = RIGHT[q.face]
    const hw = q.w / 2
    const hh = q.h / 2
    const corners: [number, number, number, number, number][] = [
      [-hw, -hh, 0, 0, 0],
      [hw, -hh, 0, 1, 0],
      [hw, hh, 0, 1, 1],
      [-hw, hh, 0, 0, 1]
    ]
    const v0 = 1 - (q.row % SIGN_ROWS + 1) / SIGN_ROWS
    const v1 = 1 - (q.row % SIGN_ROWS) / SIGN_ROWS
    corners.forEach(([a, b, , u, v], k) => {
      pos.set([q.x + rx * a, q.y + b, q.z + rz * a], i * 12 + k * 3)
      uv.set([u, v0 + (v1 - v0) * v], i * 8 + k * 2)
    })
    const o = i * 4
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  return geo
}

let _signMat: THREE.MeshBasicMaterial | null = null
const signMat = () =>
  (_signMat ??= new THREE.MeshBasicMaterial({
    map: signTex(),
    transparent: true,
    alphaTest: 0.2,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide
  }))

function Signs({ signs }: { signs: SignQuad[] }): JSX.Element {
  const geo = useMemo(() => signGeometry(signs), [signs])
  return <mesh geometry={geo} material={signMat()} renderOrder={3} />
}

// ── renderer ─────────────────────────────────────────────────────────

/* flat, unlit silhouette material for the far skyline — per-instance
 * colour + scene fog only, so distant masses read as layered haze */
const UNLIT = new THREE.MeshBasicMaterial({ color: '#ffffff' })

function ColorInst({ def, set, shadows, unlit }: { def: KindDef; set: PartSet; shadows: boolean; unlit: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    for (let i = 0; i < set.mats.length; i++) {
      m.setMatrixAt(i, set.mats[i])
      m.setColorAt(i, set.cols[i])
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [set])
  return (
    <instancedMesh
      ref={ref}
      args={[def.geo, unlit && def.mat !== KIT_MAT.lit ? UNLIT : def.mat, set.mats.length]}
      castShadow={shadows && def.cast}
      receiveShadow={shadows && def.receive}
    />
  )
}

/** Renders every non-empty kind of a batch as one instanced draw each. */
export function BatchMeshes({
  batch,
  shadows = true,
  unlit = false
}: {
  batch: Batch
  shadows?: boolean
  /** flat unlit shading (far silhouettes) */
  unlit?: boolean
}): JSX.Element {
  return (
    <group>
      {KIND_ORDER.map((k) => {
        const s = batch.sets[k]
        return s && s.mats.length ? <ColorInst key={k} def={KINDS[k]} set={s} shadows={shadows} unlit={unlit} /> : null
      })}
      {batch.signs.length > 0 && <Signs signs={batch.signs} />}
    </group>
  )
}
