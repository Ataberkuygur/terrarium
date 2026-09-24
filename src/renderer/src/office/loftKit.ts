/**
 * Loft kit — module-level materials, geometries and the batching builder
 * the loft interior is assembled with.
 *
 * Every static piece of furniture in the loft is authored as a small
 * function that drops primitives into a `Kit` (box / cylinder / sphere /
 * custom geometry, each with a local transform under a push/pop stack).
 * The kit groups identical (geometry, material, castShadow) triples, so the
 * whole room — hundreds of parts — renders as a few dozen instanced draws
 * (see `BatchView` in Props.tsx). Nothing here allocates per frame.
 */

import * as THREE from 'three'
import { L } from './palette'
import { mT, mS } from './shared'
import { oakTex, brickTex, keyboardTex, fabricTex, panelTex, blobTex } from './Textures'
import { surfaceAssets, surfaceTexture, microSurface } from './SurfaceMaterials'
import { beveledBox, upholsteredBox, profileSolid } from './ModelGeometry'

/* ── materials ─────────────────────────────────────────────────────────── */

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p)
const basic = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1
  })

/* oak floor — the photo maps stream in asynchronously; until they land the
 * color map shows a flat mid-oak swatch instead of a white floor */
function floorMaterial() {
  const swatch = document.createElement('canvas')
  swatch.width = swatch.height = 2
  const g = swatch.getContext('2d')
  if (g) {
    g.fillStyle = '#7d5c3e'
    g.fillRect(0, 0, 2, 2)
  }
  const rep: [number, number] = [10, 6.25]
  const m = std({
    roughness: 0.62,
    map: surfaceTexture(surfaceAssets.wood.color, 'color', rep, swatch),
    roughnessMap: surfaceTexture(surfaceAssets.wood.roughness, 'roughness', rep),
    normalMap: surfaceTexture(surfaceAssets.wood.normal, 'normal', rep),
    normalScale: new THREE.Vector2(0.36, 0.36)
  })
  // the photo is a deep brown — lift it toward honey oak (color channels
  // > 1 brighten the map; the shader doesn't clamp)
  m.color.setRGB(1.36, 1.27, 1.16)
  return m
}

function tintedOak(color: THREE.ColorRepresentation, repeat: [number, number] = [1, 1]) {
  const t = oakTex().clone()
  t.repeat.set(repeat[0], repeat[1])
  t.needsUpdate = true
  return std({ map: t, color, roughness: 0.55 })
}

export const LM = {
  // shell
  floor: floorMaterial(),
  slabSide: std({ color: L.slabSide, roughness: 0.9 }),
  slabCap: std({ color: L.slabCap, roughness: 0.8 }),
  wallCut: std({ color: L.wallCut, roughness: 0.9 }),
  plaster: std({ color: L.plaster, roughness: 0.95, ...microSurface('stone') }),
  plasterShade: std({ color: L.plasterShade, roughness: 0.95 }),
  brick: std({
    map: brickTex('map'),
    bumpMap: brickTex('bump'),
    bumpScale: 0.025,
    roughness: 0.92,
    color: '#f4e9e2'
  }),
  baseboard: std({ color: L.baseboard, roughness: 0.6 }),
  concrete: std({ color: L.concrete, roughness: 0.85, ...microSurface('stone') }),
  steel: std({ color: L.steel, roughness: 0.42, metalness: 0.55, ...microSurface('metal') }),
  steelSoft: std({ color: L.steelSoft, roughness: 0.55, metalness: 0.35 }),
  glass: new THREE.MeshStandardMaterial({
    color: '#e6f0f4',
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: 0.12,
    depthWrite: false
  }),
  windowGlass: new THREE.MeshStandardMaterial({
    color: '#f4efe6',
    roughness: 0.02,
    metalness: 0.3,
    transparent: true,
    opacity: 0.08,
    depthWrite: false
  }),
  // invisible shadow caster — the ceiling/walls keep the room shaded even
  // when their visible meshes are cut away toward the camera
  shadowProxy: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),

  // wood + surfaces
  oak: tintedOak('#ffffff'),
  oakLong: tintedOak('#ffffff', [2, 1]),
  oakDark: tintedOak('#b98f63'),
  walnut: tintedOak('#8a6242'),
  laminate: std({ color: L.laminate, roughness: 0.5 }),
  stone: std({ color: '#ece8e1', roughness: 0.28, ...microSurface('stone') }),
  tile: std({ color: '#f1eee8', roughness: 0.25 }),
  grout: std({ color: '#cfc8bd', roughness: 0.9 }),
  cabinet: std({ color: '#7f9476', roughness: 0.6 }),
  cream: std({ color: L.cream, roughness: 0.6 }),

  // desk kit
  deskFrame: std({ color: L.deskFrame, roughness: 0.45, metalness: 0.5, ...microSurface('metal') }),
  tray: std({ color: L.tray, roughness: 0.7, metalness: 0.2 }),
  felt: std({ color: '#7d8a78', roughness: 1, bumpMap: fabricTex(), bumpScale: 0.01 }),
  feltDark: std({ color: '#4f535a', roughness: 1, bumpMap: fabricTex(), bumpScale: 0.01 }),
  deskPad: std({ color: '#3b3d42', roughness: 0.95, bumpMap: fabricTex(), bumpScale: 0.004 }),
  bezel: std({ color: L.bezel, roughness: 0.35, metalness: 0.3 }),
  monitorBack: std({ color: L.monitorBack, roughness: 0.45, metalness: 0.35 }),
  aluminium: std({ color: '#c9ccd1', roughness: 0.32, metalness: 0.75, ...microSurface('metal') }),
  screenOff: std({ color: L.screenOff, roughness: 0.15, metalness: 0.4 }),
  screenCode: new THREE.MeshBasicMaterial({ map: panelTex('code'), toneMapped: false, color: '#d9d9d9' }),
  screenDocs: new THREE.MeshBasicMaterial({ map: panelTex('docs'), toneMapped: false, color: '#d0d0d0' }),
  screenLock: new THREE.MeshBasicMaterial({ map: panelTex('lock'), toneMapped: false, color: '#7a7a7a' }),
  keyboard: std({ map: keyboardTex(), roughness: 0.55 }),
  keyboardLight: std({ color: '#e9e6df', roughness: 0.5 }),
  plasticDark: std({ color: '#26282d', roughness: 0.5 }),
  plasticLight: std({ color: '#ecebe7', roughness: 0.45 }),
  paint: std({ color: '#ffffff', roughness: 0.6 }), // instance-colored parts
  ceramic: std({ color: '#ffffff', roughness: 0.35 }), // instance-colored mugs/pots
  paper: std({ color: '#f5f2ea', roughness: 0.95 }),
  ledOn: basic('#8ff0b8'),
  ledAmber: basic('#ffc66b'),

  // chairs
  chairFabric: std({ color: L.chairFabric, roughness: 0.95, ...microSurface('fabric') }),
  chairMesh: std({ color: '#2a2c31', roughness: 0.9, bumpMap: fabricTex(), bumpScale: 0.012 }),
  chairShell: std({ color: L.chairShell, roughness: 0.45, metalness: 0.2 }),
  caster: std({ color: L.caster, roughness: 0.5 }),

  // soft furnishings
  velvet: std({ color: L.sofa, roughness: 0.9, ...microSurface('fabric') }),
  velvetLight: std({ color: L.sofaCushion, roughness: 0.9, ...microSurface('fabric') }),
  mustard: std({ color: L.mustard, roughness: 0.9, ...microSurface('fabric') }),
  sage: std({ color: L.sage, roughness: 0.92, ...microSurface('fabric') }),
  linen: std({ color: '#e8dfcf', roughness: 0.95, ...microSurface('fabric') }),
  leather: std({ color: L.leather, roughness: 0.55 }),
  brass: std({ color: '#b8904f', roughness: 0.3, metalness: 0.85, ...microSurface('metal') }),

  // plants
  leafDark: std({ color: L.leafDark, roughness: 0.7, side: THREE.DoubleSide }),
  leaf: std({ color: L.leaf, roughness: 0.7, side: THREE.DoubleSide }),
  leafLight: std({ color: L.leafLight, roughness: 0.7, side: THREE.DoubleSide }),
  snake: std({ color: '#4e7a4a', roughness: 0.6, side: THREE.DoubleSide }),
  trunk: std({ color: '#6b513c', roughness: 0.9 }),
  soil: std({ color: '#3a2b20', roughness: 1 }),
  potTerracotta: std({ color: L.potTerracotta, roughness: 0.85 }),
  potCream: std({ color: L.potCream, roughness: 0.6 }),
  potCharcoal: std({ color: L.potCharcoal, roughness: 0.55 }),

  // light
  bulb: basic('#fff1d6'),
  bulbWarm: basic(L.warmBulb),
  lampGlow: basic('#ffe2b3', 0.9),
  shadeInner: new THREE.MeshBasicMaterial({ color: '#ffe7c4', toneMapped: false, side: THREE.BackSide }),
  // soft contact decal — the canvas is black with a radial alpha falloff
  blob: new THREE.MeshBasicMaterial({
    map: blobTex(),
    transparent: true,
    depthWrite: false,
    opacity: 0.6,
    toneMapped: false
  })
}

/* ── geometries ────────────────────────────────────────────────────────── */

export const DESK_TOP = { w: 1.36, d: 0.76, t: 0.036 }

/** broad leaf (monstera / fiddle-fig) — tip at +y, folded along the rib,
 * drooping toward +z. Unit length. */
function broadLeaf(width = 0.62, droop = 0.22): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 6, 10)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5 // 0 stem … 1 tip
    const w = Math.pow(Math.max(0.001, Math.sin(Math.min(1, t * 1.05) * Math.PI)), 0.7) * width
    const x = p.getX(i) * w
    const fold = Math.abs(x) * 0.35
    p.setXYZ(i, x, t, fold + droop * t * t)
  }
  g.computeVertexNormals()
  return g
}

/** snake-plant blade — tall narrow sword leaf, unit height */
function bladeLeaf(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 2, 8)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5
    const w = (0.09 * Math.pow(Math.sin(Math.min(1, t * 0.98 + 0.08) * Math.PI), 0.5)) * (1 - t * 0.3)
    const x = p.getX(i) * w
    p.setXYZ(i, x, t, Math.abs(x) * 0.5 + 0.04 * t * t)
  }
  g.computeVertexNormals()
  return g
}

/** tapered planter pot, unit height/radius-ish, origin at the base */
const potProfile = profileSolid(
  [
    [0, 0.4, 0.4],
    [0.04, 0.42, 0.42],
    [0.9, 0.5, 0.5],
    [0.94, 0.52, 0.52],
    [1, 0.52, 0.52]
  ],
  20
)

export const LG = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), // floor-facing +y
  planeV: new THREE.PlaneGeometry(1, 1), // wall-facing +z
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.CylinderGeometry(0.3, 0.5, 1, 18), // tapered (top radius .3)
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  hemi: new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  torus: new THREE.TorusGeometry(0.5, 0.06, 8, 20),
  mugHandle: new THREE.TorusGeometry(0.028, 0.007, 6, 12, Math.PI),
  pot: potProfile,
  deskTop: beveledBox(DESK_TOP.w, DESK_TOP.t, DESK_TOP.d, 0.012, 2),
  monitor: beveledBox(0.64, 0.385, 0.026, 0.01, 2),
  monitorSmall: beveledBox(0.55, 0.33, 0.024, 0.009, 2),
  monitorHump: beveledBox(0.34, 0.2, 0.05, 0.02, 2),
  screen: new THREE.PlaneGeometry(0.61, 0.352),
  screenSmall: new THREE.PlaneGeometry(0.52, 0.3),
  laptopLid: beveledBox(0.32, 0.21, 0.01, 0.004, 1),
  laptopBase: beveledBox(0.32, 0.012, 0.22, 0.004, 1),
  laptopScreen: new THREE.PlaneGeometry(0.29, 0.18),
  seat: upholsteredBox(0.5, 0.085, 0.47),
  seatBack: beveledBox(0.46, 0.52, 0.055, 0.025, 3),
  cushion: upholsteredBox(0.66, 0.16, 0.7),
  cushionBack: upholsteredBox(0.66, 0.42, 0.2),
  pillow: upholsteredBox(0.4, 0.34, 0.12),
  armchairSeat: upholsteredBox(0.62, 0.16, 0.6),
  armchairBack: upholsteredBox(0.74, 0.46, 0.18),
  armchairArm: upholsteredBox(0.13, 0.3, 0.72),
  roundTop: new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  broadLeaf: broadLeaf(),
  figLeaf: broadLeaf(0.5, 0.12),
  blade: bladeLeaf(),
  book: beveledBox(1, 1, 1, 0.04, 1),
  blob: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
}

/* ── world-scaled UVs for architectural boxes ───────────────────────────
 * BoxGeometry maps 0..1 per face, which stretches brick across segments
 * of different sizes. This rebuilds the uvs from vertex positions (plus
 * the box's world offset) so courses line up across adjacent segments. */
export function worldBox(
  w: number,
  h: number,
  d: number,
  at: [number, number, number],
  tile = 0.64
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + at[0]
    const y = p.getY(i) + at[1]
    const z = p.getZ(i) + at[2]
    const nx = Math.abs(n.getX(i))
    const ny = Math.abs(n.getY(i))
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile)
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile)
    else uv.setXY(i, x / tile, y / tile)
  }
  g.translate(at[0], at[1], at[2])
  return g
}

/* ── material families ──────────────────────────────────────────────────
 * Plain MeshStandardMaterials that differ only in color (steel, plastics,
 * paint, fabrics sharing a bump map…) render through one white "family"
 * material per surface recipe, with the original color moved into the
 * instance color. Cuts the loft's draw calls roughly in half. Materials
 * with color maps, transparency or emissive stay as they are. */
interface Family {
  mat: THREE.MeshStandardMaterial
  color: THREE.Color
}
const families = new Map<string, THREE.MeshStandardMaterial>()
const familyCache = new WeakMap<THREE.Material, Family | null>()
function familyOf(m: THREE.Material): Family | null {
  const hit = familyCache.get(m)
  if (hit !== undefined) return hit
  let fam: Family | null = null
  if (
    m instanceof THREE.MeshStandardMaterial &&
    !(m instanceof THREE.MeshPhysicalMaterial) &&
    !m.map &&
    !m.transparent &&
    !m.alphaMap &&
    !m.normalMap &&
    !m.roughnessMap &&
    m.emissive.getHex() === 0 &&
    m.side === THREE.FrontSide
  ) {
    // coarse surface buckets — at diorama scale roughness 0.45 vs 0.5 is
    // invisible, but every distinct recipe costs a draw call
    const rough = Math.round(m.roughness * 5) / 5
    const metal = Math.round(m.metalness * 3) / 3
    const key = [rough, metal, m.bumpMap?.uuid ?? '-', m.bumpScale.toFixed(3)].join('|')
    let fm = families.get(key)
    if (!fm) {
      fm = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: rough,
        metalness: metal,
        bumpMap: m.bumpMap,
        bumpScale: m.bumpScale
      })
      families.set(key, fm)
    }
    fam = { mat: fm, color: m.color.clone() }
  }
  familyCache.set(m, fam)
  return fam
}

/* ── the batching builder ──────────────────────────────────────────────── */

export interface BatchGroup {
  key: string
  geo: THREE.BufferGeometry
  mat: THREE.Material
  mats: THREE.Matrix4[]
  colors?: THREE.Color[]
  cast: boolean
}

export interface PartOpts {
  rx?: number
  ry?: number
  rz?: number
  color?: THREE.ColorRepresentation
  cast?: boolean
}

const WHITE = new THREE.Color('#ffffff')

/** yaw → pitch → roll (Euler 'YXZ'): tilts happen in the part's own yawed
 * frame, which is what furniture authoring wants (a monitor turned 20°
 * still leans back about its own axis) */
export function mYPR(rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
}

export class Kit {
  private groups = new Map<string, { g: BatchGroup; cols: (THREE.Color | null)[] }>()
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]

  private get top() {
    return this.stack[this.stack.length - 1]
  }

  /** enter a child frame: translate then yaw/pitch/roll */
  push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): this {
    const m = this.top.clone().multiply(mT(x, y, z))
    if (rx || ry || rz) m.multiply(mYPR(rx, ry, rz))
    this.stack.push(m)
    return this
  }

  /** enter a uniformly scaled frame */
  pushScale(s: number): this {
    this.stack.push(this.top.clone().multiply(mS(s, s, s)))
    return this
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop()
    return this
  }

  /** raw add — `local` is post-multiplied onto the current frame */
  add(geo: THREE.BufferGeometry, material: THREE.Material, local: THREE.Matrix4, opts: PartOpts = {}) {
    const cast = opts.cast ?? true
    // untextured solid materials collapse into their surface family —
    // same draw call, the color rides per instance
    const fam = familyOf(material)
    const mat = fam ? fam.mat : material
    if (fam && opts.color === undefined) opts = { ...opts, color: fam.color }
    // one draw per (geometry, material): the group casts if any part does
    const key = `${geo.uuid}|${mat.uuid}`
    let e = this.groups.get(key)
    if (!e) {
      e = { g: { key, geo, mat, mats: [], cast }, cols: [] }
      this.groups.set(key, e)
    } else if (cast) e.g.cast = true
    e.g.mats.push(this.top.clone().multiply(local))
    e.cols.push(opts.color !== undefined ? new THREE.Color(opts.color) : null)
  }

  private local(x: number, y: number, z: number, sx: number, sy: number, sz: number, o: PartOpts) {
    const m = mT(x, y, z)
    if (o.rx || o.ry || o.rz) m.multiply(mYPR(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0))
    return m.multiply(mS(sx, sy, sz))
  }

  /** axis-aligned (in the current frame) box, center + size */
  box(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, o: PartOpts = {}) {
    this.add(LG.box, mat, this.local(x, y, z, sx, sy, sz, o), o)
  }

  /** vertical cylinder, center + radius + height */
  cyl(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, o: PartOpts = {}) {
    this.add(r < 0.03 ? LG.cylLo : LG.cyl, mat, this.local(x, y, z, r * 2, h, r * 2, o), o)
  }

  sphere(mat: THREE.Material, x: number, y: number, z: number, r: number, o: PartOpts = {}) {
    this.add(LG.sphere, mat, this.local(x, y, z, r * 2, r * 2, r * 2, o), o)
  }

  /** any geometry at (x,y,z) with rotation + (uniform or per-axis) scale */
  mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    o: PartOpts & { s?: number | [number, number, number] } = {}
  ) {
    const s = o.s ?? 1
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s
    this.add(geo, mat, this.local(x, y, z, sx, sy, sz, o), o)
  }

  /** finished groups — colors resolved (white where an instance had none) */
  build(): BatchGroup[] {
    const out: BatchGroup[] = []
    for (const { g, cols } of this.groups.values()) {
      const any = cols.some((c) => c !== null)
      out.push(any ? { ...g, colors: cols.map((c) => c ?? WHITE) } : g)
    }
    return out
  }
}
