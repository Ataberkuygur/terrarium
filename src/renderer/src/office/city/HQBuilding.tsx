/* ── HQBuilding — the company tower (hero of the city view) ────────────
 * Two skins over one floor/interaction scaffold. Each department floor is
 * a double-height slab (two storeys of vision glass) whose base carries
 * an integrated signage band — dept name, member count, hue chip, level
 * number — painted into the spandrel itself, with a hairline accent light
 * in the dept hue wrapping all four faces.
 *
 *   'loft'     — an elegant Manhattan office tower. Limestone + champagne
 *                aluminum podium with double-height lobby glazing, a
 *                revolving door, a cable-stayed canopy, brass TERRARIUM
 *                letters and a warm lobby glimpsed through the glass.
 *                Curtain wall with a real mullion/fin rhythm, graphite
 *                spandrels and sky-tinted pane variance over lit office
 *                interiors (ceilings, pendant lights, desks, people).
 *                Setback crown: louvered mechanical screen, lit lantern,
 *                pyramid cap and a spire with a blinking aviation light.
 *
 *   'avengers' — the Avengers (ex-Stark) Tower. Dark navy glass shaft,
 *                white-metal spine blade, cyan arc-tech floor lines. The
 *                crown flares out asymmetrically to the east in stacked
 *                cantilevered storeys under an angled glass roof; the
 *                circled Avengers "A" (extruded Shape) hangs on the crown
 *                face; a quinjet landing pad juts off the flare.
 *
 * Interaction (contract) — per-floor invisible hit volume: hover washes
 * the floor + brightens its sign and switches to the pointer cursor; a
 * tap (≤6 px travel, the isClick guard the office scenes use against
 * camera drags) fires onFloorClick(dept.id).
 *
 * Perf — one skin mounts at a time; every repeated part (panes, fins,
 * interiors, desks, people, lamps…) is baked into instanced sets in
 * useMemo, never touched per frame. Per-frame work: two beacon sprites
 * blinking (one material opacity each). */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { CITY, floorBaseY } from './layout'
import { isClick } from '../RpgControls'
import { G, mR, mS, mT } from '../shared'
import { Inst } from '../Inst'
import { microSurface } from '../SurfaceMaterials'
import { beveledBox } from '../ModelGeometry'
import { AG, AM } from '../avengers/shared'
import { P } from '../avengers/palette'
import type { Department } from '../../lib/departments'

export interface HQBuildingProps {
  departments: Department[]
  /** deptId → member count — shown on the floor's name plate */
  counts?: Record<string, number>
  /** click a floor slab → enter that department's interior */
  onFloorClick?: (deptId: string) => void
  /** tower skin — Manhattan glass tower ('loft') or the Avengers tower */
  theme?: 'loft' | 'avengers'
}

type HQTheme = 'loft' | 'avengers'

// ── layout (tower-local; the group origin is hqX, ground, hqZ) ────────

const { hqW: W, hqD: D, lobbyH, floorH } = CITY
const FZ = D / 2 // street facade plane — world CITY.hqFacadeZ
/* building-side edge of the far sidewalk, tower-local — the forecourt
 * plaza runs from the facade out to exactly this line */
const WALK_EDGE = CITY.walkFarZ - CITY.walkW / 2 - CITY.hqZ
const PLAZA_Y = 0.075 // plaza top — flush with the sidewalk
const BASE_Y = PLAZA_Y + 0.09 // top of the granite base course

/* per-department slab section: sign band, storey A, mid spandrel, storey B */
const BAND = 0.6
const MID = 0.1
const GL = (floorH - BAND - MID) / 2
const LEDGE = 0.04 // projecting lip under each sign band

/* podium */
const GZ = FZ - 0.36 // recessed lobby glass line
const PIER = 0.6 // stone end piers flanking the storefront
const GX = W / 2 - PIER // storefront half-width
const FASCIA_Y = 1.42 // underside of the sign fascia
const DOOR_Y = 1.1 // door head / canopy transom
const DESK_Z = 1.45 // lobby reception desk

interface BodySpec {
  w: number
  d: number
  cz: number // body center z — the front face always lands on FZ
  back: number
  inset: number // corner pilaster zone
  ring: number // depth of the lit office ring behind the glass
}
const BODY: Record<HQTheme, BodySpec> = {
  loft: { w: 6.2, d: 5.2, cz: FZ - 2.6, back: FZ - 5.2, inset: 0.26, ring: 1.05 },
  avengers: { w: 5.6, d: 5.0, cz: FZ - 2.5, back: FZ - 5.0, inset: 0.14, ring: 1.0 }
}

const ID = new THREE.Matrix4()
const ROT_DOWN = mR(Math.PI / 2, 0, 0) // unit plane facing -y
const ROT_UP = mR(-Math.PI / 2, 0, 0) // unit plane facing +y

const B = (x: number, y: number, z: number, w: number, h: number, d: number) =>
  mT(x, y, z).multiply(mS(w, h, d))

/* rod between two points — unit cylinder (r .5, h 1) stretched along a→b */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Matrix4 {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(2 * r, len, 2 * r))
}

/* stable per-(id, salt) random in [0,1) — a full avalanche mix so
 * neighbouring salts don't correlate */
function rand(id: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function once<T>(make: () => T): () => T {
  let v: T | undefined
  return () => (v ??= make())
}

// ── canvas textures ────────────────────────────────────────────────────

const SANS = '"Inter","Segoe UI","SF Pro Text",system-ui,sans-serif'
const MONO = '"JetBrains Mono Variable","JetBrains Mono",monospace'

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function canvasTex(c: HTMLCanvasElement, paint: () => void, color = true): THREE.CanvasTexture {
  paint()
  const t = new THREE.CanvasTexture(c)
  if (color) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  document.fonts.ready.then(() => {
    paint()
    t.needsUpdate = true
  })
  return t
}

/* the circled Avengers "A" in unit space (ring radius 1, +y up): the
 * forward-leaning A whose left leg breaks out of the ring bottom-left,
 * apex piercing the top, arrow crossbar exiting right */
const A_LEG: [number, number][] = [
  [-0.98, -1.1],
  [0.22, 1.18],
  [0.54, 0.6],
  [0.54, -0.8],
  [0.25, -0.8],
  [0.25, 0.36],
  [-0.63, -1.1]
]
const A_BAR: [number, number][] = [
  [-0.32, -0.31],
  [1.0, -0.31],
  [1.0, -0.46],
  [1.38, -0.2],
  [1.0, 0.06],
  [1.0, -0.09],
  [-0.32, -0.09]
]
const A_RING = [1, 0.84] as const

function drawALogo(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath()
  g.arc(cx, cy, r * A_RING[0], 0, Math.PI * 2)
  g.arc(cx, cy, r * A_RING[1], 0, Math.PI * 2, true)
  g.fill('evenodd')
  for (const poly of [A_LEG, A_BAR]) {
    g.beginPath()
    poly.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy - y * r) : g.moveTo(cx + x * r, cy - y * r)))
    g.closePath()
    g.fill()
  }
}

/* floor name plate — painted per floor. Loft: graphite band, champagne
 * hairlines, warm-white tracked caps, hue chip, count pill, level no.
 * Avengers: dark tech glass, cyan corner brackets + scan lines. */
function labelTexture(
  name: string,
  count: number,
  hue: number,
  level: number,
  stark: boolean,
  aspect: number
): THREE.CanvasTexture {
  const H = 128
  const Wc = Math.round(H * aspect)
  const [c, g] = makeCanvas(Wc, H)
  const accent = `hsl(${hue}, 68%, ${stark ? 62 : 60}%)`
  const paint = () => {
    g.clearRect(0, 0, Wc, H)
    const bg = g.createLinearGradient(0, 0, 0, H)
    if (stark) {
      bg.addColorStop(0, '#0f1823')
      bg.addColorStop(1, '#070c13')
    } else {
      bg.addColorStop(0, '#2b2e34')
      bg.addColorStop(0.5, '#212429')
      bg.addColorStop(1, '#17191d')
    }
    g.fillStyle = bg
    g.fillRect(0, 0, Wc, H)
    if (stark) {
      g.fillStyle = 'rgba(111,212,255,0.045)'
      for (let y = 2; y < H; y += 5) g.fillRect(0, y, Wc, 1)
      // corner brackets
      g.strokeStyle = 'rgba(111,212,255,0.85)'
      g.lineWidth = 3
      const br = (x: number, y: number, dx: number, dy: number) => {
        g.beginPath()
        g.moveTo(x + dx * 26, y)
        g.lineTo(x, y)
        g.lineTo(x, y + dy * 26)
        g.stroke()
      }
      br(10, 12, 1, 1)
      br(10, H - 12, 1, -1)
      br(Wc - 10, 12, -1, 1)
      br(Wc - 10, H - 12, -1, -1)
    } else {
      // champagne hairlines — top catch light, bottom reveal
      g.fillStyle = 'rgba(236,222,196,0.32)'
      g.fillRect(0, 6, Wc, 2)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(0, H - 5, Wc, 5)
    }

    // hue chip
    g.save()
    g.shadowColor = accent
    g.shadowBlur = 16
    g.fillStyle = accent
    g.beginPath()
    if (stark) {
      g.moveTo(58, 40)
      g.lineTo(76, 64)
      g.lineTo(58, 88)
      g.lineTo(40, 64)
    } else g.roundRect(42, 34, 12, 60, 6)
    g.fill()
    g.restore()

    // name — tracked caps, auto-fit
    const label = name.toUpperCase()
    let size = 92
    const room = Wc - 460
    const setFont = () => {
      g.font = `700 ${size}px ${SANS}`
      g.letterSpacing = `${Math.round(size * 0.1)}px`
    }
    setFont()
    while (size > 30 && g.measureText(label).width > room) {
      size -= 2
      setFont()
    }
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillStyle = stark ? '#eaf7ff' : '#f6f0e4'
    if (stark) {
      g.shadowColor = 'rgba(111,212,255,0.7)'
      g.shadowBlur = 10
    }
    const nx = stark ? 100 : 84
    g.fillText(label, nx, 67)
    g.shadowBlur = 0
    const nameW = g.measureText(label).width

    // member-count pill
    if (count > 0) {
      g.font = `600 54px ${SANS}`
      g.letterSpacing = '1px'
      const txt = String(count)
      const tw = g.measureText(txt).width
      const px = nx + nameW + 30
      const pw = tw + 96
      g.beginPath()
      g.roundRect(px, 28, pw, 72, 36)
      g.fillStyle = stark ? 'rgba(111,212,255,0.14)' : 'rgba(255,255,255,0.08)'
      g.fill()
      g.lineWidth = 3
      g.strokeStyle = stark ? 'rgba(111,212,255,0.85)' : accent
      g.stroke()
      // person glyph
      g.fillStyle = stark ? '#9fe4ff' : 'rgba(246,240,228,0.9)'
      g.beginPath()
      g.arc(px + 36, 50, 9, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.roundRect(px + 22, 62, 28, 20, [12, 12, 3, 3])
      g.fill()
      g.fillStyle = stark ? '#eaf7ff' : '#f6f0e4'
      g.fillText(txt, px + 64, 67)
    }

    // level number, right aligned
    g.font = `500 34px ${MONO}`
    g.letterSpacing = '6px'
    g.textAlign = 'right'
    g.fillStyle = stark ? 'rgba(111,212,255,0.8)' : 'rgba(226,208,172,0.75)'
    const lv = `${stark ? 'LVL' : 'FL'} ${String(level + 2).padStart(2, '0')}`
    g.fillText(lv, Wc - (stark ? 48 : 40), 66)
    g.letterSpacing = '0px'
    if (!stark) {
      g.fillStyle = 'rgba(226,208,172,0.35)'
      g.fillRect(Wc - 232, 36, 2, 58)
    } else {
      g.fillStyle = 'rgba(111,212,255,0.55)'
      for (let k = 0; k < 5; k++) g.fillRect(Wc - 300 + k * 12, 78 - k * 7, 6, 12 + k * 7)
    }
  }
  return canvasTex(c, paint)
}

/* TERRARIUM fascia sign — brass letters on dark bronze (loft), cyan-white
 * on gunmetal glass (avengers). Aspect ≈ 15.3. */
const signTex = {
  loft: once(() => signTexture(false)),
  avengers: once(() => signTexture(true))
}
function signTexture(stark: boolean): THREE.CanvasTexture {
  const [c, g] = makeCanvas(2048, 134)
  const paint = () => {
    const bg = g.createLinearGradient(0, 0, 0, 134)
    bg.addColorStop(0, stark ? '#1a222d' : '#2a251f')
    bg.addColorStop(1, stark ? '#0b1017' : '#15120f')
    g.fillStyle = bg
    g.fillRect(0, 0, 2048, 134)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `${stark ? 600 : 500} 84px ${SANS}`
    g.letterSpacing = '46px'
    const fill = g.createLinearGradient(0, 30, 0, 104)
    if (stark) {
      fill.addColorStop(0, '#f2fbff')
      fill.addColorStop(1, '#9fe0ff')
    } else {
      fill.addColorStop(0, '#fff0cc')
      fill.addColorStop(0.55, '#e8c587')
      fill.addColorStop(1, '#b98d4f')
    }
    g.shadowColor = stark ? 'rgba(111,212,255,0.95)' : 'rgba(255,205,130,0.75)'
    g.shadowBlur = 18
    g.fillStyle = fill
    g.fillText('TERRARIUM', 1024 + 23, 70)
    g.shadowBlur = 0
    g.letterSpacing = '0px'
    g.fillStyle = stark ? 'rgba(111,212,255,0.7)' : 'rgba(232,197,135,0.55)'
    g.fillRect(150, 66, 190, 3)
    g.fillRect(2048 - 340, 66, 190, 3)
  }
  return canvasTex(c, paint)
}

/* plaza paving — 2×2 slightly varied stone tiles with joints; repeat is
 * set by the caller's plaza size (one texture per skin) */
const pavingTex = {
  loft: once(() => pavingTexture(false)),
  avengers: once(() => pavingTexture(true))
}
function pavingTexture(stark: boolean): THREE.CanvasTexture {
  const [c, g] = makeCanvas(256, 256)
  const paint = () => {
    const tones = stark ? ['#3b3f46', '#373b42', '#3f434a', '#393d44'] : ['#cfc8ba', '#c8c1b2', '#d4cdbf', '#cbc4b6']
    let seed = 7
    for (let k = 0; k < 4; k++) {
      const x = (k % 2) * 128
      const y = Math.floor(k / 2) * 128
      g.fillStyle = tones[k]
      g.fillRect(x, y, 128, 128)
      for (let s = 0; s < 260; s++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const px = x + (seed % 128)
        const py = y + ((seed >>> 8) % 128)
        g.fillStyle = (seed >>> 16) % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
        g.fillRect(px, py, 2, 2)
      }
    }
    g.fillStyle = stark ? 'rgba(0,0,0,0.45)' : 'rgba(80,70,58,0.45)'
    for (const p of [0, 128]) {
      g.fillRect(p, 0, 3, 256)
      g.fillRect(0, p, 256, 3)
    }
  }
  const t = canvasTex(c, paint)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/* lobby feature wall — walnut slats + bronze lift doors (loft); white
 * composite panels + cyan light line + the "A" (avengers). 1024×256. */
const wallTex = {
  loft: once(() => lobbyWallTexture(false)),
  avengers: once(() => lobbyWallTexture(true))
}
function lobbyWallTexture(stark: boolean): THREE.CanvasTexture {
  const [c, g] = makeCanvas(1024, 256)
  const paint = () => {
    if (stark) {
      g.fillStyle = '#d9e1ea'
      g.fillRect(0, 0, 1024, 256)
      g.fillStyle = 'rgba(40,60,80,0.35)'
      for (let x = 0; x <= 1024; x += 128) g.fillRect(x, 0, 2, 256)
      g.fillRect(0, 128, 1024, 2)
      g.fillStyle = '#6fd4ff'
      g.fillRect(0, 196, 1024, 5)
      g.fillStyle = '#1e2733'
      drawALogo(g, 512, 104, 62)
    } else {
      for (let x = 0; x < 1024; x += 16) {
        g.fillStyle = (x / 16) % 2 ? '#8a5a36' : '#7a4e2e'
        g.fillRect(x, 0, 16, 256)
        g.fillStyle = 'rgba(0,0,0,0.25)'
        g.fillRect(x + 14, 0, 2, 256)
      }
      // three bronze lift doors
      for (const cx of [392, 512, 632]) {
        const lg = g.createLinearGradient(cx - 44, 0, cx + 44, 0)
        lg.addColorStop(0, '#6b5134')
        lg.addColorStop(0.5, '#b8925f')
        lg.addColorStop(1, '#6b5134')
        g.fillStyle = '#2a2016'
        g.fillRect(cx - 50, 86, 100, 170)
        g.fillStyle = lg
        g.fillRect(cx - 44, 92, 88, 164)
        g.fillStyle = 'rgba(0,0,0,0.4)'
        g.fillRect(cx - 1, 92, 2, 164)
        g.fillStyle = '#ffe2a6'
        g.fillRect(cx - 12, 70, 24, 6)
      }
    }
    // grazing downlight wash from the ceiling
    const wash = g.createLinearGradient(0, 0, 0, 256)
    wash.addColorStop(0, stark ? 'rgba(255,255,255,0.35)' : 'rgba(255,226,170,0.45)')
    wash.addColorStop(0.5, 'rgba(255,255,255,0)')
    wash.addColorStop(1, 'rgba(0,0,0,0.25)')
    g.fillStyle = wash
    g.fillRect(0, 0, 1024, 256)
    for (let x = 64; x < 1024; x += 128) {
      const r = g.createRadialGradient(x, 0, 4, x, 0, 110)
      r.addColorStop(0, stark ? 'rgba(220,245,255,0.5)' : 'rgba(255,230,180,0.55)')
      r.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = r
      g.fillRect(x - 110, 0, 220, 130)
    }
  }
  return canvasTex(c, paint)
}

/* quinjet pad deck — rounded deck plate with panel seams, landing ring,
 * the "A", hazard chevrons; alpha outside the rounded rect */
const padTex = once((): THREE.CanvasTexture => {
  const [c, g] = makeCanvas(512, 512)
  const paint = () => {
    g.clearRect(0, 0, 512, 512)
    g.beginPath()
    g.roundRect(4, 4, 504, 504, 60)
    g.fillStyle = '#2d333c'
    g.fill()
    g.save()
    g.clip()
    g.fillStyle = 'rgba(0,0,0,0.3)'
    for (let p = 64; p < 512; p += 64) {
      g.fillRect(p, 0, 2, 512)
      g.fillRect(0, p, 512, 2)
    }
    g.restore()
    g.lineWidth = 6
    g.setLineDash([22, 14])
    g.strokeStyle = 'rgba(238,244,253,0.85)'
    g.beginPath()
    g.roundRect(26, 26, 460, 460, 44)
    g.stroke()
    g.setLineDash([])
    g.strokeStyle = '#6fd4ff'
    g.lineWidth = 9
    g.beginPath()
    g.arc(256, 256, 170, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = 'rgba(238,244,253,0.7)'
    g.lineWidth = 4
    g.beginPath()
    g.arc(256, 256, 150, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = 'rgba(238,244,253,0.85)'
    drawALogo(g, 256, 256, 92)
    g.fillStyle = '#e8b93a'
    for (const [x, y, s] of [
      [60, 60, 1],
      [452, 452, -1]
    ] as const) {
      for (let k = 0; k < 3; k++) {
        g.beginPath()
        g.moveTo(x + s * k * 22, y)
        g.lineTo(x + s * (k * 22 + 12), y)
        g.lineTo(x + s * (k * 22 + 34), y + s * 22)
        g.lineTo(x + s * (k * 22 + 22), y + s * 22)
        g.fill()
      }
    }
  }
  return canvasTex(c, paint)
})

/* crown storey emissive band — black (no emission) with a bright cool
 * ceiling-light band near the top and a soft interior spill below */
const crownBandTex = once((): THREE.CanvasTexture => {
  const [c, g] = makeCanvas(16, 128)
  const paint = () => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, 16, 128)
    const s = g.createLinearGradient(0, 0, 0, 128)
    s.addColorStop(0, 'rgba(0,0,0,0)')
    s.addColorStop(0.16, 'rgba(210,240,255,1)')
    s.addColorStop(0.24, 'rgba(160,220,255,0.55)')
    s.addColorStop(0.6, 'rgba(60,110,150,0.25)')
    s.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = s
    g.fillRect(0, 0, 16, 128)
  }
  return canvasTex(c, paint)
})

/* loft crown lantern — warm interior glow, brighter at the ceiling
 * lights, with a mezzanine line across the middle */
const lanternTex = once((): THREE.CanvasTexture => {
  const [c, g] = makeCanvas(32, 128)
  const paint = () => {
    const v = g.createLinearGradient(0, 0, 0, 128)
    v.addColorStop(0, '#f7c77a')
    v.addColorStop(0.1, '#fff4d6')
    v.addColorStop(0.45, '#ffd999')
    v.addColorStop(0.55, '#f1b867')
    v.addColorStop(0.62, '#fff0cc')
    v.addColorStop(1, '#e9a453')
    g.fillStyle = v
    g.fillRect(0, 0, 32, 128)
    g.fillStyle = 'rgba(90,55,20,0.55)'
    g.fillRect(0, 56, 32, 5)
  }
  return canvasTex(c, paint)
})

/* soft radial halo — beacons, the emblem's backglow */
const haloTex = once((): THREE.CanvasTexture => {
  const [c, g] = makeCanvas(128, 128)
  const paint = () => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.clearRect(0, 0, 128, 128)
    g.fillStyle = r
    g.fillRect(0, 0, 128, 128)
  }
  return canvasTex(c, paint)
})

// ── geometries (module singletons) ─────────────────────────────────────

const GEO = {
  bevel: beveledBox(1, 1, 1, 0.02),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  sphereLo: new THREE.SphereGeometry(0.5, 8, 6),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  person: new THREE.CapsuleGeometry(0.055, 0.12, 3, 8),
  drum: new THREE.CylinderGeometry(0.42, 0.42, 1, 28, 1, true),
  spire: new THREE.CylinderGeometry(0.012, 0.075, 1, 10),
  pyramid: new THREE.ConeGeometry(0.5, 1, 4, 1),
  jetBody: new THREE.CapsuleGeometry(0.1, 0.42, 4, 12),
  aLogo: (() => {
    const ring = new THREE.Shape()
    ring.absarc(0, 0, A_RING[0], 0, Math.PI * 2, false)
    const hole = new THREE.Path()
    hole.absarc(0, 0, A_RING[1], 0, Math.PI * 2, true)
    ring.holes.push(hole)
    const poly = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
    return new THREE.ExtrudeGeometry([ring, poly(A_LEG), poly(A_BAR)], {
      depth: 0.09,
      bevelEnabled: false,
      curveSegments: 40
    })
  })(),
  padDeck: (() => {
    const s = new THREE.Shape()
    const w = 2.8
    const d = 2.5
    const r = 0.34
    s.moveTo(-w / 2 + r, -d / 2)
    s.lineTo(w / 2 - r, -d / 2)
    s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r)
    s.lineTo(w / 2, d / 2 - r)
    s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2)
    s.lineTo(-w / 2 + r, d / 2)
    s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r)
    s.lineTo(-w / 2, -d / 2 + r)
    s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2)
    return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false, curveSegments: 6 })
  })(),
  bracket: new THREE.ExtrudeGeometry(
    new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2.3, 0), new THREE.Vector2(0, -0.85)]),
    { depth: 0.16, bevelEnabled: false }
  )
}
const PAD_W = 2.8
const PAD_D = 2.5

// ── materials (module singletons — never mutated at runtime) ──────────

const std = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
const basic = (color: string) => new THREE.MeshBasicMaterial({ color, toneMapped: false })
const additive = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })
const glassMat = (color: string, opacity: number, metalness: number, env: number) =>
  new THREE.MeshPhysicalMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.05,
    metalness,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: env,
    depthWrite: false
  })

/* skin-independent */
const CM = {
  tint: new THREE.MeshBasicMaterial({ toneMapped: false }), // tinted per instance
  people: std('#ffffff', 0.8), // tinted per instance
  skin: std('#d6b393', 0.7),
  leaf: std('#4f7d3f', 0.85),
  leafDark: std('#3d6a35', 0.9),
  trunk: std('#5d4a36', 0.9),
  beaconRed: basic('#ff4b3e')
}

/* loft — limestone, champagne aluminum, dark bronze, warm interiors */
const LM = {
  glass: glassMat('#ffffff', 0.7, 0.55, 1.7), // tinted per pane
  lobbyGlass: glassMat('#dfe9ec', 0.16, 0.1, 0.8),
  frame: std('#d8d4cb', 0.28, 0.8, microSurface('metal')),
  bronze: std('#4b3d2f', 0.36, 0.7, microSurface('metal')),
  spandrel: std('#2f3a46', 0.2, 0.65),
  mid: std('#4e6072', 0.15, 0.7, { envMapIntensity: 1.5 }),
  core: std('#1b2027', 0.95),
  stone: std('#e0d9cb', 0.72, 0, microSurface('stone')),
  granite: std('#57534d', 0.45, 0.1, microSurface('stone')),
  carpet: std('#4b4741', 0.95),
  lobbyFloor: std('#b8a78e', 0.25, 0.05, { emissive: '#6e5536', emissiveIntensity: 0.9 }),
  desk: std('#dcd6ca', 0.6),
  deskPanel: std('#5e564d', 0.7),
  hedge: std('#3e6b35', 0.9),
  paving: new THREE.MeshStandardMaterial({ roughness: 0.8 }), // map bound lazily
  wall: new THREE.MeshBasicMaterial({ toneMapped: false }), // map bound lazily
  lantern: basic('#ffcf7e'),
  glow: basic('#ffe7bb'),
  veil: additive('#ffe9c6', 0.28)
}

/* avengers — navy glass, white metal, gunmetal, arc-reactor cyan */
const SM = {
  glass: glassMat('#ffffff', 0.74, 0.65, 1.8), // tinted per pane
  lobbyGlass: glassMat('#cfe2ef', 0.18, 0.2, 0.9),
  white: std('#dde4ec', 0.28, 0.65, microSurface('metal')),
  gun: std('#2a303a', 0.3, 0.8, microSurface('metal')),
  spandrel: std('#131a24', 0.18, 0.7),
  core: std('#0d1219', 0.95),
  granite: std('#2c3036', 0.4, 0.15, microSurface('stone')),
  carpet: std('#1c222b', 0.9),
  lobbyFloor: std('#27303b', 0.15, 0.3, { emissive: '#1d3d55', emissiveIntensity: 0.8 }),
  desk: std('#c9d2dc', 0.4, 0.3),
  deskPanel: std('#252b35', 0.5, 0.5),
  hedge: std('#35603c', 0.9),
  crownGlass: new THREE.MeshStandardMaterial({
    color: '#1d3149',
    roughness: 0.1,
    metalness: 0.85,
    emissive: '#ffffff',
    envMapIntensity: 1.6
  }), // emissiveMap bound lazily
  roofGlass: std('#223a55', 0.08, 0.9, { envMapIntensity: 1.8 }),
  padDeck: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, alphaTest: 0.5 }), // map lazily
  padUnder: std('#3a414c', 0.5, 0.6),
  jetHull: std('#56687f', 0.35, 0.6),
  logoFace: basic('#f1f9ff'),
  logoSide: std('#9aa9ba', 0.22, 0.9),
  paving: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }),
  wall: new THREE.MeshBasicMaterial({ toneMapped: false }),
  cyan: AM.holoSolid,
  veil: additive('#9fe4ff', 0.28)
}

/* bind canvas maps on first use (keeps module import DOM-free) */
const bindMaps = once(() => {
  const lp = pavingTex.loft().clone()
  lp.repeat.set((W + 1.8) / 1.2, (WALK_EDGE + D / 2 + 0.5) / 1.2)
  lp.needsUpdate = true
  LM.paving.map = lp
  const sp = pavingTex.avengers().clone()
  sp.repeat.copy(lp.repeat)
  sp.needsUpdate = true
  SM.paving.map = sp
  LM.wall.map = wallTex.loft()
  SM.wall.map = wallTex.avengers()
  SM.crownGlass.emissiveMap = crownBandTex()
  SM.padDeck.map = padTex()
  LM.lantern.map = lanternTex()
  LM.lantern.color.set('#ffffff')
  for (const m of [LM.paving, SM.paving, LM.wall, SM.wall, SM.crownGlass, SM.padDeck, LM.lantern]) m.needsUpdate = true
  return true
})

// ── instanced helper ───────────────────────────────────────────────────

interface Tinted {
  mats: THREE.Matrix4[]
  colors: THREE.Color[]
}
const tinted = (): Tinted => ({ mats: [], colors: [] })

/* Inst + per-instance colors. Colors are written before the first frame
 * (layout effect) so three compiles the instanceColor path from the start. */
function TintInst({ geo, mat, set }: { geo: THREE.BufferGeometry; mat: THREE.Material; set: Tinted }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    for (let i = 0; i < set.mats.length; i++) {
      m.setMatrixAt(i, set.mats[i])
      m.setColorAt(i, set.colors[i])
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [set])
  return <instancedMesh ref={ref} args={[geo, mat, set.mats.length]} />
}

// ── curtain-wall system (shared by both skins) ─────────────────────────

type FaceKey = 'front' | 'east' | 'west' | 'back'
interface Face {
  key: FaceKey
  idx: number
  base: THREE.Matrix4 // face-local frame: x along the face, z outward
  len: number
}
function bodyFaces(b: BodySpec): Face[] {
  return [
    { key: 'front', idx: 0, base: mT(0, 0, FZ), len: b.w },
    { key: 'east', idx: 1, base: mT(b.w / 2, 0, b.cz).multiply(mR(0, Math.PI / 2, 0)), len: b.d },
    { key: 'west', idx: 2, base: mT(-b.w / 2, 0, b.cz).multiply(mR(0, -Math.PI / 2, 0)), len: b.d },
    { key: 'back', idx: 3, base: mT(0, 0, b.back).multiply(mR(0, Math.PI, 0)), len: b.w }
  ]
}
/** face-local transform: u along the face, y world height, o outward */
function fm(
  f: Face,
  u: number,
  y: number,
  o: number,
  sx: number,
  sy: number,
  sz: number,
  rot: THREE.Matrix4 = ID
): THREE.Matrix4 {
  return f.base.clone().multiply(mT(u, y, o)).multiply(rot).multiply(mS(sx, sy, sz))
}
function bayGrid(f: Face, b: BodySpec, target: number) {
  const span = f.len - 2 * b.inset
  const n = Math.max(3, Math.round(span / target))
  const bw = span / n
  return { n, bw, span, u: (k: number) => -span / 2 + (k + 0.5) * bw, edge: (k: number) => -span / 2 + k * bw }
}

interface Storey {
  y0: number
  y1: number
  dept: number
  s: number
}
function storeyList(n: number): Storey[] {
  const out: Storey[] = []
  for (let i = 0; i < n; i++) {
    const b = floorBaseY(i)
    out.push({ y0: b + BAND, y1: b + BAND + GL, dept: i, s: 0 })
    out.push({ y0: b + BAND + GL + MID, y1: b + floorH, dept: i, s: 1 })
  }
  return out
}

interface FacadeStyle {
  bayTarget: number
  litP: number
  wallLit: string
  wallDim: string
  ceilLit: string
  ceilDim: string
  lamp: string
  screen: string
  screenOff: string
  glass: string[]
  sky: string // upper panes blend toward this (sky reflection)
  skyMix: number
  shirts: string[]
  fin: [front: number, side: number]
}

const LOFT_FACADE: FacadeStyle = {
  bayTarget: 0.56,
  litP: 0.6,
  wallLit: '#f0d3a0',
  wallDim: '#2c333c',
  ceilLit: '#ffecc8',
  ceilDim: '#474e57',
  lamp: '#fff7e4',
  screen: '#cfe6ff',
  screenOff: '#1c232c',
  glass: ['#5f88a8', '#57809f', '#6890ad', '#4f7896', '#7399b4', '#5b84a3', '#7fa2ba'],
  sky: '#a9cde6',
  skyMix: 0.6,
  shirts: ['#4f6d8f', '#8b5e4a', '#d9d4c8', '#3f5d4a', '#7a6a8e', '#b9864f', '#5a6570', '#9c4a4a'],
  fin: [0.11, 0.06]
}
const STARK_FACADE: FacadeStyle = {
  bayTarget: 0.5,
  litP: 0.7,
  wallLit: '#a9d8f5',
  wallDim: '#1a2432',
  ceilLit: '#e8f7ff',
  ceilDim: '#26323f',
  lamp: '#e6f8ff',
  screen: '#6fd4ff',
  screenOff: '#0f1822',
  glass: ['#5b7c9b', '#51718f', '#6686a3', '#4b6987', '#6f8ea8'],
  sky: '#8fb8d8',
  skyMix: 0.4,
  shirts: ['#2f3a4a', '#6d7888', '#a92c22', '#d9a441', '#3c4a5e', '#c9d2dc'],
  fin: [0.07, 0.05]
}

interface FacadeSets {
  glass: Tinted
  walls: Tinted
  ceils: Tinted
  lamps: Tinted
  screens: Tinted
  people: Tinted
  accents: Tinted
  floors: THREE.Matrix4[]
  desks: THREE.Matrix4[]
  deskPanels: THREE.Matrix4[]
  heads: THREE.Matrix4[]
  plants: THREE.Matrix4[]
  fins: THREE.Matrix4[]
  transoms: THREE.Matrix4[]
  spandrels: THREE.Matrix4[]
  mids: THREE.Matrix4[]
  ledges: THREE.Matrix4[]
  pilasters: THREE.Matrix4[]
  core: THREE.Matrix4[]
}

function buildFacade(
  depts: Department[],
  b: BodySpec,
  st: FacadeStyle,
  accent: (d: Department) => THREE.Color
): FacadeSets {
  const out: FacadeSets = {
    glass: tinted(),
    walls: tinted(),
    ceils: tinted(),
    lamps: tinted(),
    screens: tinted(),
    people: tinted(),
    accents: tinted(),
    floors: [],
    desks: [],
    deskPanels: [],
    heads: [],
    plants: [],
    fins: [],
    transoms: [],
    spandrels: [],
    mids: [],
    ledges: [],
    pilasters: [],
    core: []
  }
  const n = depts.length
  if (n === 0) return out
  const H = n * floorH
  const midY = lobbyH + H / 2
  const faces = bodyFaces(b)
  const stories = storeyList(n)
  const glassCols = st.glass.map((c) => new THREE.Color(c))
  const shirts = st.shirts.map((c) => new THREE.Color(c))
  const cWallLit = new THREE.Color(st.wallLit)
  const cWallDim = new THREE.Color(st.wallDim)
  const cCeilLit = new THREE.Color(st.ceilLit)
  const cCeilDim = new THREE.Color(st.ceilDim)
  const cLamp = new THREE.Color(st.lamp)
  const cScreen = new THREE.Color(st.screen)
  const cScreenOff = new THREE.Color(st.screenOff)
  const cSky = new THREE.Color(st.sky)

  for (const f of faces) {
    const g = bayGrid(f, b, st.bayTarget)
    const inside = f.key !== 'back'
    const finD = f.key === 'front' || f.key === 'east' ? st.fin[0] : st.fin[1]

    // vertical fins at every bay line (corners belong to pilasters) — broken
    // by each sign band so the band reads as a continuous belt
    for (let i = 0; i < n; i++) {
      const fy0 = floorBaseY(i) + BAND
      const fh = floorH - BAND
      for (let k = 1; k < g.n; k++) {
        const dk = k % 2 ? finD : Math.min(finD, 0.045)
        out.fins.push(fm(f, g.edge(k), fy0 + fh / 2, dk / 2 - 0.005, 0.035, fh, dk))
      }
    }

    // per-department bands: sign/spandrel band, ledge, accent line, mid spandrel
    for (let i = 0; i < n; i++) {
      const base = floorBaseY(i)
      out.spandrels.push(fm(f, 0, base + BAND / 2, -0.012, g.span + 0.01, BAND, 0.03))
      out.mids.push(fm(f, 0, base + BAND + GL + MID / 2, -0.012, g.span + 0.01, MID, 0.03))
      out.ledges.push(fm(f, 0, base + LEDGE / 2, 0.035, f.len + 0.2, LEDGE, 0.11))
      out.accents.mats.push(fm(f, 0, base + BAND - 0.014, 0.026, g.span, 0.022, 0.03))
      out.accents.colors.push(accent(depts[i]))
    }

    for (const s of stories) {
      const d = depts[s.dept]
      const h = s.y1 - s.y0
      const cy = (s.y0 + s.y1) / 2
      // glass-edge transoms
      out.transoms.push(
        fm(f, 0, s.y0 + 0.008, 0.012, g.span, 0.02, 0.04),
        fm(f, 0, s.y1 - 0.008, 0.012, g.span, 0.02, 0.04)
      )
      if (inside) {
        const fy = s.y0 + 0.003 + f.idx * 0.002
        out.floors.push(fm(f, 0, fy, -b.ring / 2, g.span, b.ring, 1, ROT_UP))
      }
      for (let k = 0; k < g.n; k++) {
        const u = g.u(k)
        const salt = f.idx * 7919 + s.dept * 613 + s.s * 211 + k * 31
        // pane — sky-tinted variance, a few panes brighter (sky catch)
        const gc = glassCols[Math.floor(rand(d.id, salt) * glassCols.length)].clone()
        gc.lerp(cSky, (0.15 + 0.55 * (s.y1 - lobbyH) / H) * st.skyMix)
        gc.multiplyScalar(0.92 + rand(d.id, salt + 1) * 0.16)
        out.glass.mats.push(fm(f, u, cy, 0, g.bw, h, 1))
        out.glass.colors.push(gc)
        if (!inside) continue

        // occupancy — zones of 2 bays share lights so offices read as rooms
        const zoneLit = rand(d.id, f.idx * 97 + s.s * 13 + Math.floor(k / 4) * 5 + s.dept * 3) < st.litP
        const on = zoneLit ? rand(d.id, salt + 2) > 0.1 : rand(d.id, salt + 2) < 0.06
        const corner = k === 0 || k === g.n - 1
        const lvl = 0.78 + rand(d.id, salt + 3) * 0.3

        if (!corner) {
          out.walls.mats.push(fm(f, u, cy, -b.ring, g.bw + 0.004, h, 0.04))
          out.walls.colors.push((on ? cWallLit : cWallDim).clone().multiplyScalar(on ? lvl * 0.7 : lvl))
        }
        const cyC = s.y1 - 0.004 - f.idx * 0.003
        out.ceils.mats.push(fm(f, u, cyC, -b.ring / 2, g.bw, b.ring, 1, ROT_DOWN))
        out.ceils.colors.push((on ? cCeilLit : cCeilDim).clone().multiplyScalar(on ? 0.9 : lvl))
        if (on) {
          out.lamps.mats.push(fm(f, u, s.y1 - 0.085, -b.ring * 0.42, g.bw * 0.62, 0.016, 0.05))
          out.lamps.colors.push(cLamp)
        }

        // furniture + people
        const r = rand(d.id, salt + 4)
        if (r < (on ? 0.82 : 0.45)) {
          const du = u + (rand(d.id, salt + 5) - 0.5) * 0.06
          out.desks.push(fm(f, du, s.y0 + 0.2, -0.4, g.bw * 0.8, 0.024, 0.24))
          out.deskPanels.push(fm(f, du, s.y0 + 0.1, -0.285, g.bw * 0.74, 0.18, 0.02))
          out.screens.mats.push(fm(f, du + 0.04, s.y0 + 0.29, -0.34, 0.17, 0.11, 0.015))
          out.screens.colors.push(on ? cScreen.clone().multiplyScalar(0.7 + rand(d.id, salt + 6) * 0.3) : cScreenOff)
          if (on && rand(d.id, salt + 7) < 0.62) {
            out.people.mats.push(fm(f, du, s.y0 + 0.25, -0.6, 1, 1, 1))
            out.people.colors.push(shirts[Math.floor(rand(d.id, salt + 8) * shirts.length)])
            out.heads.push(fm(f, du, s.y0 + 0.44, -0.6, 0.1, 0.1, 0.1))
          }
        } else if (r > 0.9) {
          out.plants.push(fm(f, u, s.y0 + 0.14, -0.3, 0.18, 0.26, 0.18))
        } else if (on && r > 0.78) {
          // someone standing at the glass
          out.people.mats.push(fm(f, u, s.y0 + 0.2, -0.22, 1, 1.35, 1))
          out.people.colors.push(shirts[Math.floor(rand(d.id, salt + 9) * shirts.length)])
          out.heads.push(fm(f, u, s.y0 + 0.46, -0.22, 0.1, 0.1, 0.1))
        }
      }
    }
  }

  // corner pilasters
  const ps = b.inset + 0.04
  for (const sx of [-1, 1])
    for (const zf of [FZ, b.back]) {
      const sz = zf === FZ ? 1 : -1
      out.pilasters.push(
        B(sx * (b.w / 2 - b.inset + ps / 2), midY + 0.02, zf - sz * (b.inset - ps / 2), ps, H + 0.04, ps)
      )
    }
  // dark building core behind the office ring
  out.core.push(B(0, midY, b.cz, b.w - 2 * b.ring - 0.06, H, b.d - 2 * b.ring - 0.06))
  return out
}

/* renders one facade set with the skin's materials */
function Facade({
  sets,
  glass,
  frame,
  spandrel,
  mid,
  core,
  carpet,
  desk,
  deskPanel,
  pilaster
}: {
  sets: FacadeSets
  glass: THREE.Material
  frame: THREE.Material
  spandrel: THREE.Material
  mid: THREE.Material
  core: THREE.Material
  carpet: THREE.Material
  desk: THREE.Material
  deskPanel: THREE.Material
  pilaster: THREE.Material
}): JSX.Element {
  return (
    <group>
      {/* interior — core, floors, lit walls/ceilings, lamps, desks, people */}
      <Inst geo={G.unitBox} mat={core} mats={sets.core} />
      <Inst geo={G.unitPlane} mat={carpet} mats={sets.floors} />
      <TintInst geo={G.unitBox} mat={CM.tint} set={sets.walls} />
      <TintInst geo={G.unitPlane} mat={CM.tint} set={sets.ceils} />
      <TintInst geo={G.unitBox} mat={CM.tint} set={sets.lamps} />
      <Inst geo={G.unitBox} mat={desk} mats={sets.desks} />
      <Inst geo={G.unitBox} mat={deskPanel} mats={sets.deskPanels} />
      <TintInst geo={G.unitBox} mat={CM.tint} set={sets.screens} />
      <TintInst geo={GEO.person} mat={CM.people} set={sets.people} />
      <Inst geo={GEO.sphereLo} mat={CM.skin} mats={sets.heads} />
      <Inst geo={GEO.sphereLo} mat={CM.leaf} mats={sets.plants} />
      {/* envelope — spandrels, ledges, accent lines, glass, fins, pilasters */}
      <Inst geo={G.unitBox} mat={spandrel} mats={sets.spandrels} />
      <Inst geo={G.unitBox} mat={mid} mats={sets.mids} />
      <Inst geo={G.unitBox} mat={frame} mats={sets.ledges} />
      <Inst geo={G.unitBox} mat={frame} mats={sets.transoms} />
      <TintInst geo={G.unitBox} mat={CM.tint} set={sets.accents} />
      <TintInst geo={G.unitPlane} mat={glass} set={sets.glass} />
      <Inst geo={G.unitBox} mat={frame} mats={sets.fins} />
      <Inst geo={GEO.bevel} mat={pilaster} mats={sets.pilasters} />
    </group>
  )
}

// ── FloorSlab — name plate, hover wash and hit volume per department ──

const FloorSlab = memo(function FloorSlab({
  dept,
  index,
  count,
  active,
  onHover,
  onFloorClick,
  body,
  stark
}: {
  dept: Department
  index: number
  count: number
  /** this floor currently owns the hover — drives the wash + sign boost */
  active: boolean
  onHover: (deptId: string | null) => void
  onFloorClick?: (deptId: string) => void
  body: BodySpec
  stark: boolean
}): JSX.Element {
  const base = floorBaseY(index)
  const span = body.w - 2 * body.inset
  /* the name plate hangs ON the floor it names: centred on the mid
   * spandrel, i.e. the exact middle of this section's glass (storey A
   * below, storey B above) — well clear of the plain band beneath and the
   * next floor's band above. It floats just proud of the front fins. */
  const signH = 0.46
  const signW = span * 0.8
  const signY = base + BAND + (floorH - BAND) / 2
  const signZ = FZ + (stark ? 0.075 : 0.115)

  /* sign texture — repainted only when name/hue/count/level/skin move */
  const plate = useMemo(
    () => labelTexture(dept.name, count, dept.hue, index, stark, signW / signH),
    [dept.name, dept.hue, count, index, stark, signW]
  )
  useEffect(
    () => () => {
      plate.dispose()
      document.body.style.cursor = '' // never leave a stale pointer behind
    },
    [plate]
  )
  const signTint = active ? '#ffffff' : '#dcdcdc'

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation() // nearest floor wins — don't light the slabs behind
    onHover(dept.id)
    document.body.style.cursor = 'pointer'
  }
  const out = () => {
    /* stacked hit volumes can leave a stale floor clipped behind the one
     * the pointer rests on — only the active floor may release the hover */
    if (!active) return
    onHover(null)
    document.body.style.cursor = ''
  }
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (isClick(e)) onFloorClick?.(dept.id) // ≤6px travel — taps, not drags
  }

  const veil = stark ? SM.veil : LM.veil
  const vh = floorH - BAND
  const vy = base + BAND + vh / 2
  return (
    <group>
      {/* department name plate — front face only, on the floor's own glass */}
      <mesh geometry={G.unitPlane} position={[0, signY, signZ]} scale={[signW, signH, 1]}>
        <meshBasicMaterial map={plate} toneMapped={false} color={signTint} />
      </mesh>
      {/* hover wash — additive veil over the floor's front + east glass */}
      <mesh
        geometry={G.unitPlane}
        material={veil}
        position={[0, vy, FZ + 0.13]}
        scale={[body.w + 0.1, vh, 1]}
        visible={active}
      />
      <mesh
        geometry={G.unitPlane}
        material={veil}
        position={[body.w / 2 + 0.13, vy, body.cz]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[body.d + 0.1, vh, 1]}
        visible={active}
      />
      {/* hit volume — invisible meshes are skipped by the renderer but
          still raycast by R3F pointer events */}
      <mesh
        geometry={G.unitBox}
        position={[0, base + floorH / 2, body.cz]}
        scale={[body.w + 0.4, floorH, body.d + 0.4]}
        visible={false}
        onPointerOver={over}
        onPointerOut={out}
        onClick={click}
      />
    </group>
  )
})

function TowerFloors({
  departments,
  counts,
  onFloorClick,
  body,
  stark
}: {
  departments: Department[]
  counts?: Record<string, number>
  onFloorClick?: (deptId: string) => void
  body: BodySpec
  stark: boolean
}): JSX.Element {
  /* one floor may be highlighted at a time — ownership lives here */
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  return (
    <group>
      {departments.map((d, i) => (
        <FloorSlab
          key={d.id}
          dept={d}
          index={i}
          count={counts?.[d.id] ?? 0}
          active={hoveredId === d.id}
          onHover={setHoveredId}
          onFloorClick={onFloorClick}
          body={body}
          stark={stark}
        />
      ))}
    </group>
  )
}

// ── Beacon — blinking aviation light (sphere + additive sprite halo) ──

function Beacon({
  position,
  color = '#ff4b3e',
  period = 1.8,
  size = 0.7
}: {
  position: [number, number, number]
  color?: string
  period?: number
  size?: number
}): JSX.Element {
  const mat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: haloTex(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [color]
  )
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime % period) / period
    mat.opacity = t < 0.2 ? 0.95 : 0.14
  })
  return (
    <group position={position}>
      <mesh geometry={GEO.sphereLo} material={CM.beaconRed} scale={0.085} />
      <sprite material={mat} scale={size} />
    </group>
  )
}

// ── Podium (shared massing, skin-specific trim) ────────────────────────

/* n-independent podium matrices, both skins */
const PODIUM = (() => {
  const plazaD = WALK_EDGE + D / 2 + 0.5
  const plaza = [B(0, PLAZA_Y / 2, WALK_EDGE - plazaD / 2, W + 1.8, PLAZA_Y, plazaD)]
  const baseCourse = [B(0, (PLAZA_Y + BASE_Y) / 2, 0, W + 0.06, BASE_Y - PLAZA_Y, D + 0.06)]

  const wallH = lobbyH - BASE_Y
  const sideGlassZ0 = -0.3
  const sideGlassZ1 = FZ - 0.9
  const solid: THREE.Matrix4[] = [
    // front end piers (flush with the tower facade above)
    ...[-1, 1].map((s) => B(s * (W / 2 - PIER / 2), BASE_Y + wallH / 2, FZ - 0.45, PIER, wallH, 0.9)),
    // side walls — solid rear half
    ...[-1, 1].map((s) => B(s * (W / 2 - 0.1), BASE_Y + wallH / 2, (-D / 2 + sideGlassZ0) / 2, 0.2, wallH, sideGlassZ0 + D / 2)),
    // back wall
    B(0, BASE_Y + wallH / 2, -D / 2 + 0.1, W, wallH, 0.2),
    // sign fascia over the recessed storefront (its underside is the soffit)
    B(0, (FASCIA_Y + lobbyH) / 2, (GZ - 0.05 + FZ + 0.06) / 2, W, lobbyH - FASCIA_Y, FZ + 0.06 - GZ + 0.05),
    // side fascias over the side glazing
    ...[-1, 1].map((s) =>
      B(s * (W / 2 - 0.1), (FASCIA_Y + lobbyH) / 2, (sideGlassZ0 + sideGlassZ1) / 2, 0.2, lobbyH - FASCIA_Y, sideGlassZ1 - sideGlassZ0 + 0.02)
    ),
    // roof slab
    B(0, lobbyH - 0.05, 0, W - 0.02, 0.1, D - 0.02)
  ]

  // storefront glass: two leaves beside the entrance bay + transom over it
  const glassF = [
    B(-(GX + 0.46) / 2, (BASE_Y + FASCIA_Y) / 2, GZ, GX - 0.46, FASCIA_Y - BASE_Y, 1),
    B((GX + 0.46) / 2, (BASE_Y + FASCIA_Y) / 2, GZ, GX - 0.46, FASCIA_Y - BASE_Y, 1),
    B(0, (DOOR_Y + FASCIA_Y) / 2, GZ, 0.92, FASCIA_Y - DOOR_Y, 1)
  ]
  const sideLen = sideGlassZ1 - sideGlassZ0
  const glassS = [-1, 1].map((s) =>
    mT(s * (W / 2 - 0.08), (BASE_Y + FASCIA_Y) / 2, (sideGlassZ0 + sideGlassZ1) / 2)
      .multiply(mR(0, (s * Math.PI) / 2, 0))
      .multiply(mS(sideLen, FASCIA_Y - BASE_Y, 1))
  )

  // storefront mullions + transom, door frames and pulls
  const mull: THREE.Matrix4[] = []
  const gh = FASCIA_Y - BASE_Y
  for (const x of [0.46, 1.26, 1.96, 2.72]) for (const s of [-1, 1]) mull.push(B(s * x, BASE_Y + gh / 2, GZ + 0.012, 0.045, gh, 0.06))
  mull.push(B(0, DOOR_Y, GZ + 0.012, 2 * GX, 0.05, 0.07))
  mull.push(B(0, BASE_Y + 0.02, GZ + 0.012, 2 * GX, 0.04, 0.07))
  for (const s of [-1, 1]) {
    mull.push(B(s * 0.86, (BASE_Y + DOOR_Y) / 2, GZ + 0.014, 0.03, DOOR_Y - BASE_Y, 0.05)) // meeting stile
    mull.push(B(s * 0.8, 0.62, GZ + 0.05, 0.02, 0.42, 0.02), B(s * 0.92, 0.62, GZ + 0.05, 0.02, 0.42, 0.02)) // pulls
  }
  for (const z of [sideGlassZ0, 0.6, 1.5, sideGlassZ1])
    for (const s of [-1, 1]) mull.push(B(s * (W / 2 - 0.06), BASE_Y + gh / 2, z, 0.06, gh, 0.045))

  // roof coping + terrace balustrade rails beside the shaft
  const coping = [
    B(0, lobbyH + 0.02, FZ + 0.03, W + 0.08, 0.04, 0.14),
    B(0, lobbyH + 0.02, -D / 2 - 0.03, W + 0.08, 0.04, 0.14),
    B(-W / 2 - 0.0, lobbyH + 0.02, 0, 0.14, 0.04, D + 0.08),
    B(W / 2 + 0.0, lobbyH + 0.02, 0, 0.14, 0.04, D + 0.08)
  ]
  const railX0 = 3.1
  const railW = W / 2 - railX0 - 0.05
  const rails: THREE.Matrix4[] = []
  const railGlass: THREE.Matrix4[] = []
  for (const s of [-1, 1]) {
    const cx = s * (railX0 + railW / 2)
    rails.push(B(cx, lobbyH + 0.25, FZ - 0.02, railW, 0.025, 0.035))
    railGlass.push(B(cx, lobbyH + 0.14, FZ - 0.02, railW, 0.2, 1))
    rails.push(B(s * (W / 2 - 0.02), lobbyH + 0.25, 0, 0.035, 0.025, D - 0.1))
    railGlass.push(
      mT(s * (W / 2 - 0.02), lobbyH + 0.14, 0)
        .multiply(mR(0, Math.PI / 2, 0))
        .multiply(mS(D - 0.1, 0.2, 1))
    )
  }

  // roof-terrace planters with shrubs, both sides of the shaft
  const roofPlanters: THREE.Matrix4[] = []
  const roofShrubs: THREE.Matrix4[] = []
  for (const s of [-1, 1])
    for (const z of [2.3, 0.2, -1.9]) {
      roofPlanters.push(B(s * 3.62, lobbyH + 0.1, z, 0.6, 0.2, 1.3))
      roofShrubs.push(B(s * 3.62, lobbyH + 0.25, z, 0.5, 0.18, 1.18))
    }

  // lobby interior
  const lobbyFloor = [
    mT(0, BASE_Y + 0.003, (GZ - 0.8) / 2)
      .multiply(ROT_UP)
      .multiply(mS(W - 0.4, GZ + 0.8, 1))
  ]
  const featureWall = [B(0, (BASE_Y + lobbyH) / 2 - 0.05, 0.3, W - 0.5, lobbyH - BASE_Y - 0.1, 1)]
  const soffitLights: THREE.Matrix4[] = []
  for (let x = -3.1; x <= 3.11; x += 0.62)
    soffitLights.push(mT(x, FASCIA_Y - 0.004, (GZ + FZ) / 2).multiply(ROT_DOWN).multiply(mS(0.09, 0.09, 1)))
  const pendants = [-2.2, -1.1, 0, 1.1, 2.2].map((x) => B(x, 1.22, DESK_Z + 0.2, 0.11, 0.11, 0.11))
  const pendantCords = [-2.2, -1.1, 0, 1.1, 2.2].map((x) => B(x, 1.52, DESK_Z + 0.2, 0.008, 0.6, 0.008))

  // forecourt: planters (granite) + hedges + trees, bollards
  const planters: THREE.Matrix4[] = []
  const hedges: THREE.Matrix4[] = []
  const trunks: THREE.Matrix4[] = []
  const crowns: THREE.Matrix4[] = []
  for (const s of [-1, 1]) {
    const x = s * 2.75
    const z = FZ + 1.25
    planters.push(B(x, PLAZA_Y + 0.17, z, 1.9, 0.34, 0.66))
    hedges.push(B(x, PLAZA_Y + 0.4, z, 1.76, 0.16, 0.54))
    const tx = x + s * 0.55
    trunks.push(B(tx, PLAZA_Y + 0.6, z, 0.05, 0.6, 0.05))
    crowns.push(B(tx, PLAZA_Y + 1.02, z, 0.62, 0.52, 0.62), B(tx + s * 0.14, PLAZA_Y + 0.88, z + 0.1, 0.42, 0.36, 0.42))
  }
  const bollards: THREE.Matrix4[] = []
  const bollardCaps: THREE.Matrix4[] = []
  for (const x of [-4.4, -3.5, -1.3, 1.3, 3.5, 4.4]) {
    bollards.push(B(x, PLAZA_Y + 0.13, WALK_EDGE - 0.3, 0.12, 0.26, 0.12))
    bollardCaps.push(B(x, PLAZA_Y + 0.235, WALK_EDGE - 0.3, 0.125, 0.025, 0.125))
  }

  return {
    plaza,
    baseCourse,
    solid,
    glassF,
    glassS,
    mull,
    coping,
    rails,
    railGlass,
    roofPlanters,
    roofShrubs,
    lobbyFloor,
    featureWall,
    soffitLights,
    pendants,
    pendantCords,
    planters,
    hedges,
    trunks,
    crowns,
    bollards,
    bollardCaps
  }
})()

/* loft entrance — revolving drum + cable-stayed canopy */
const LOFT_ENTRY = (() => {
  const drumH = DOOR_Y - BASE_Y
  const bronze = [
    mT(0, DOOR_Y + 0.03, GZ).multiply(mS(0.98, 0.07, 0.98)), // drum crown (cylinder)
    mT(0, BASE_Y + 0.01, GZ).multiply(mS(0.94, 0.02, 0.94)),
    mT(0, (BASE_Y + DOOR_Y) / 2, GZ).multiply(mS(0.05, drumH, 0.05)) // center post
  ]
  const wings = [Math.PI / 4, -Math.PI / 4].map((a) =>
    mT(0, (BASE_Y + DOOR_Y) / 2, GZ)
      .multiply(mR(0, a, 0))
      .multiply(mS(0.8, drumH - 0.04, 0.02))
  )
  const cz0 = GZ
  const cz1 = FZ + 0.95
  const canopy = [
    B(0, 1.17, (cz0 + cz1) / 2, 3.1, 0.06, cz1 - cz0), // canopy slab
    B(0, 1.17, cz1, 3.14, 0.11, 0.035) // fascia lip
  ]
  const rods = [-1, 1].map((s) =>
    rod(new THREE.Vector3(s * 1.45, 1.2, cz1 - 0.05), new THREE.Vector3(s * 1.15, 1.7, FZ + 0.06), 0.012)
  )
  const soffit = [mT(0, 1.137, (cz0 + cz1) / 2 + 0.05).multiply(ROT_DOWN).multiply(mS(2.9, cz1 - cz0 - 0.2, 1))]
  return { drumH, bronze, wings, canopy, rods, soffit }
})()

/* avengers entrance — sliding glass doors + cantilevered angled blade */
const STARK_ENTRY = (() => {
  const doorFrame = [
    B(0, DOOR_Y, GZ + 0.03, 1.9, 0.06, 0.08),
    B(-0.94, (BASE_Y + DOOR_Y) / 2, GZ + 0.03, 0.05, DOOR_Y - BASE_Y, 0.08),
    B(0.94, (BASE_Y + DOOR_Y) / 2, GZ + 0.03, 0.05, DOOR_Y - BASE_Y, 0.08)
  ]
  const cyanEdges = [
    B(-0.02, (BASE_Y + DOOR_Y) / 2, GZ + 0.06, 0.018, DOOR_Y - BASE_Y - 0.06, 0.01),
    B(0.02, (BASE_Y + DOOR_Y) / 2, GZ + 0.06, 0.018, DOOR_Y - BASE_Y - 0.06, 0.01)
  ]
  const blade = mT(0, 1.2, (GZ + FZ + 1.3) / 2)
    .multiply(mR(0.14, 0, 0))
    .multiply(mS(3.6, 0.08, FZ + 1.3 - GZ))
  const bladeEdge = mT(0, 1.2, (GZ + FZ + 1.3) / 2)
    .multiply(mR(0.14, 0, 0))
    .multiply(mT(0, -0.05, (FZ + 1.3 - GZ) / 2 - 0.02))
    .multiply(mS(3.5, 0.02, 0.03))
  const soffit = mT(0, 1.2, (GZ + FZ + 1.3) / 2)
    .multiply(mR(0.14, 0, 0))
    .multiply(mT(0, -0.045, 0))
    .multiply(ROT_DOWN)
    .multiply(mS(3.2, FZ + 1.1 - GZ, 1))
  // inlaid cyan light lines in the plaza leading to the doors
  const inlays = [
    B(-1.35, PLAZA_Y + 0.002, (FZ + WALK_EDGE) / 2 + 0.2, 0.035, 0.004, WALK_EDGE - FZ - 0.4),
    B(1.35, PLAZA_Y + 0.002, (FZ + WALK_EDGE) / 2 + 0.2, 0.035, 0.004, WALK_EDGE - FZ - 0.4),
    B(0, PLAZA_Y + 0.002, WALK_EDGE - 0.6, W + 1.2, 0.004, 0.035)
  ]
  // vertical cyan strips on the piers
  const pierStrips = [-1, 1].map((s) => B(s * (W / 2 - PIER / 2), (BASE_Y + FASCIA_Y) / 2, FZ + 0.006, 0.04, FASCIA_Y - BASE_Y - 0.2, 0.01))
  return { doorFrame, cyanEdges, blade, bladeEdge, soffit, inlays, pierStrips }
})()

function Podium({ stark }: { stark: boolean }): JSX.Element {
  bindMaps()
  const M = stark ? SM : LM
  const sign = stark ? signTex.avengers() : signTex.loft()
  const stone = stark ? SM.gun : LM.stone
  const frame = stark ? SM.white : LM.frame
  const trim = stark ? SM.gun : LM.bronze
  const glow = stark ? SM.cyan : LM.glow
  const signH = lobbyH - FASCIA_Y - 0.1
  return (
    <group>
      {/* forecourt plaza + granite base course */}
      <Inst geo={G.unitBox} mat={M.paving} mats={PODIUM.plaza} />
      <Inst geo={G.unitBox} mat={M.granite} mats={PODIUM.baseCourse} />
      {/* podium masonry — piers, walls, fascia, roof */}
      <Inst geo={GEO.bevel} mat={stone} mats={PODIUM.solid} />
      <Inst geo={G.unitBox} mat={frame} mats={PODIUM.coping} />
      {/* storefront */}
      <Inst geo={G.unitPlane} mat={M.lobbyGlass} mats={PODIUM.glassF} />
      <Inst geo={G.unitPlane} mat={M.lobbyGlass} mats={PODIUM.glassS} />
      <Inst geo={G.unitBox} mat={trim} mats={PODIUM.mull} />
      {/* recess soffit downlights */}
      <Inst geo={G.unitPlane} mat={glow} mats={PODIUM.soffitLights} />
      {/* TERRARIUM on the fascia */}
      <mesh geometry={G.unitPlane} position={[0, FASCIA_Y + 0.05 + signH / 2, FZ + 0.062]} scale={[signH * 15.3, signH, 1]}>
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>

      {/* lobby interior glimpsed through the glass */}
      <Inst geo={G.unitPlane} mat={M.lobbyFloor} mats={PODIUM.lobbyFloor} />
      <Inst geo={G.unitPlane} mat={M.wall} mats={PODIUM.featureWall} />
      <mesh geometry={G.unitBox} material={stark ? SM.gun : LM.stone} position={[0, BASE_Y + 0.17, DESK_Z]} scale={[1.9, 0.34, 0.42]} />
      <mesh geometry={G.unitBox} material={stark ? SM.white : LM.bronze} position={[0, BASE_Y + 0.355, DESK_Z]} scale={[2.0, 0.03, 0.5]} />
      <mesh geometry={G.unitBox} material={glow} position={[0, BASE_Y + 0.3, DESK_Z + 0.215]} scale={[1.8, 0.018, 0.01]} />
      <Inst geo={GEO.sphereLo} mat={stark ? SM.cyan : LM.glow} mats={PODIUM.pendants} />
      <Inst geo={G.unitBox} mat={trim} mats={PODIUM.pendantCords} />

      {/* roof terrace — coping, glass balustrade, planters */}
      <Inst geo={G.unitBox} mat={frame} mats={PODIUM.rails} />
      <Inst geo={G.unitPlane} mat={M.lobbyGlass} mats={PODIUM.railGlass} />
      <Inst geo={GEO.bevel} mat={M.granite} mats={PODIUM.roofPlanters} />
      <Inst geo={GEO.bevel} mat={M.hedge} mats={PODIUM.roofShrubs} />

      {/* forecourt planters, trees, bollards */}
      <Inst geo={GEO.bevel} mat={M.granite} mats={PODIUM.planters} />
      <Inst geo={GEO.bevel} mat={M.hedge} mats={PODIUM.hedges} />
      <Inst geo={GEO.cylLo} mat={CM.trunk} mats={PODIUM.trunks} />
      <Inst geo={GEO.sphere} mat={stark ? CM.leafDark : CM.leaf} mats={PODIUM.crowns} />
      <Inst geo={GEO.cyl} mat={trim} mats={PODIUM.bollards} />
      <Inst geo={GEO.cyl} mat={glow} mats={PODIUM.bollardCaps} />

      {stark ? (
        <group>
          <Inst geo={G.unitBox} mat={SM.white} mats={STARK_ENTRY.doorFrame} />
          <Inst geo={G.unitBox} mat={SM.cyan} mats={STARK_ENTRY.cyanEdges} />
          <Inst geo={GEO.bevel} mat={SM.gun} mats={[STARK_ENTRY.blade]} />
          <Inst geo={G.unitBox} mat={SM.cyan} mats={[STARK_ENTRY.bladeEdge]} />
          <Inst geo={G.unitPlane} mat={SM.cyan} mats={[STARK_ENTRY.soffit]} />
          <Inst geo={G.unitBox} mat={SM.cyan} mats={STARK_ENTRY.inlays} />
          <Inst geo={G.unitBox} mat={SM.cyan} mats={STARK_ENTRY.pierStrips} />
          {/* holo ring hovering over the reception desk */}
          <mesh geometry={AG.torus} material={SM.cyan} position={[0, 0.78, DESK_Z]} rotation={[Math.PI / 2, 0, 0]} scale={0.5} />
        </group>
      ) : (
        <group>
          {/* revolving door */}
          <mesh geometry={GEO.drum} material={LM.lobbyGlass} position={[0, (BASE_Y + DOOR_Y) / 2, GZ]} scale={[1, LOFT_ENTRY.drumH, 1]} />
          <Inst geo={GEO.cyl} mat={LM.bronze} mats={LOFT_ENTRY.bronze} />
          <Inst geo={G.unitBox} mat={LM.lobbyGlass} mats={LOFT_ENTRY.wings} />
          {/* cable-stayed canopy + lit soffit */}
          <Inst geo={G.unitBox} mat={LM.frame} mats={LOFT_ENTRY.canopy} />
          <Inst geo={GEO.cylLo} mat={LM.frame} mats={LOFT_ENTRY.rods} />
          <Inst geo={G.unitPlane} mat={LM.glow} mats={LOFT_ENTRY.soffit} />
        </group>
      )}
    </group>
  )
}

// ── LoftShell — Manhattan curtain-wall tower + setback crown ──────────

function loftCrown(n: number, b: BodySpec) {
  const R = lobbyH + n * floorH
  const w1 = b.w - 0.6
  const d1 = b.d - 0.8
  const z1 = b.cz - 0.1
  const t1 = 0.82 // mechanical screen height
  const y1 = R + 0.16
  const w2 = 3.0
  const d2 = 2.4
  const z2 = b.cz - 0.2
  const L0 = y1 + t1 + 0.08 // lantern base
  const lh = 1.3
  const frame: THREE.Matrix4[] = [
    B(0, R + 0.08, b.cz, b.w + 0.2, 0.16, b.d + 0.2), // cornice
    B(0, y1 + t1 + 0.04, z1, w1 + 0.18, 0.08, d1 + 0.18), // screen cap
    B(0, L0 + lh + 0.05, z2, w2 + 0.24, 0.1, d2 + 0.24) // lantern cap
  ]
  const louvers: THREE.Matrix4[] = []
  for (let k = 0; k < 8; k++) {
    const y = y1 + 0.1 + k * 0.092
    louvers.push(
      B(0, y, z1 + d1 / 2 + 0.03, w1 + 0.04, 0.026, 0.05),
      B(0, y, z1 - d1 / 2 - 0.03, w1 + 0.04, 0.026, 0.05),
      B(-w1 / 2 - 0.03, y, z1, 0.05, 0.026, d1 + 0.04),
      B(w1 / 2 + 0.03, y, z1, 0.05, 0.026, d1 + 0.04)
    )
  }
  for (const x of [-w1 / 2, -w1 / 4, 0, w1 / 4, w1 / 2]) louvers.push(B(x, y1 + t1 / 2, z1 + d1 / 2 + 0.05, 0.06, t1, 0.05))
  for (const s of [-1, 1]) for (const z of [z1 + d1 / 2, z1, z1 - d1 / 2]) louvers.push(B(s * (w1 / 2 + 0.05), y1 + t1 / 2, z, 0.05, t1, 0.06))
  const screenBody = [B(0, y1 + t1 / 2, z1, w1, t1, d1)]
  // lantern — lit core behind a fin cage
  const lanternCore = [B(0, L0 + lh / 2, z2, w2 - 0.1, lh, d2 - 0.1)]
  const fins: THREE.Matrix4[] = []
  for (let x = -w2 / 2; x <= w2 / 2 + 0.01; x += w2 / 8) {
    fins.push(B(x, L0 + lh / 2, z2 + d2 / 2, 0.035, lh, 0.1), B(x, L0 + lh / 2, z2 - d2 / 2, 0.035, lh, 0.1))
  }
  for (let z = -d2 / 2 + d2 / 6; z < d2 / 2 - 0.01; z += d2 / 6)
    for (const s of [-1, 1]) fins.push(B((s * w2) / 2, L0 + lh / 2, z2 + z, 0.1, lh, 0.035))
  const pyramid = [
    mT(0, L0 + lh + 0.1 + 0.3, z2)
      .multiply(mS((w2 + 0.1) * Math.SQRT1_2 * 2, 0.6, (d2 + 0.1) * Math.SQRT1_2 * 2))
      .multiply(mR(0, Math.PI / 4, 0))
  ]
  const spireY = L0 + lh + 0.62
  const spire = [mT(0, spireY + 1.15, z2).multiply(mS(1, 2.3, 1))]
  const collars = [
    B(0, spireY + 0.04, z2, 0.2, 0.12, 0.2),
    B(0, spireY + 0.7, z2, 0.11, 0.04, 0.11),
    B(0, spireY + 1.4, z2, 0.08, 0.03, 0.08)
  ]
  // stone corner pylons — the tower's corner piers carried up past the
  // cornice to frame the screen tier; champagne caps
  const pylons: THREE.Matrix4[] = []
  const pylonCaps: THREE.Matrix4[] = []
  const pw = b.inset + 0.06
  for (const sx of [-1, 1])
    for (const zc of [FZ - pw / 2 + 0.03, b.back + pw / 2 - 0.03]) {
      const x = sx * (b.w / 2 - pw / 2 + 0.03)
      pylons.push(B(x, R + 0.55, zc, pw, 1.1, pw))
      pylonCaps.push(B(x, R + 1.13, zc, pw + 0.06, 0.06, pw + 0.06))
    }
  // hvac on the screened roof, peeking above the louvers
  const hvac = [B(-w1 * 0.3, y1 + t1 + 0.2, z1 - d1 * 0.3, 0.8, 0.28, 0.6), B(w1 * 0.32, y1 + t1 + 0.16, z1 - d1 * 0.28, 0.6, 0.2, 0.5)]
  return {
    R,
    frame,
    louvers,
    screenBody,
    lanternCore,
    fins,
    pyramid,
    spire,
    collars,
    hvac,
    pylons,
    pylonCaps,
    signY: y1 + t1 / 2,
    signZ: z1 + d1 / 2 + 0.085,
    tip: [0, spireY + 2.33, z2] as [number, number, number]
  }
}

function LoftShell({ departments, body }: { departments: Department[]; body: BodySpec }): JSX.Element {
  bindMaps()
  const n = departments.length
  const sets = useMemo(
    () => buildFacade(departments, body, LOFT_FACADE, (d) => new THREE.Color().setHSL(d.hue / 360, 0.7, 0.6)),
    [departments, body]
  )
  const crown = useMemo(() => loftCrown(n, body), [n, body])
  const sign = signTex.loft()
  return (
    <group>
      <Facade
        sets={sets}
        glass={LM.glass}
        frame={LM.frame}
        spandrel={LM.spandrel}
        mid={LM.mid}
        core={LM.core}
        carpet={LM.carpet}
        desk={LM.desk}
        deskPanel={LM.deskPanel}
        pilaster={LM.stone}
      />
      {/* setback crown — cornice, louvered screen, lit lantern, spire */}
      <Inst geo={GEO.bevel} mat={LM.frame} mats={crown.frame} />
      <Inst geo={GEO.bevel} mat={LM.stone} mats={crown.pylons} />
      <Inst geo={GEO.bevel} mat={LM.frame} mats={crown.pylonCaps} />
      <Inst geo={G.unitBox} mat={LM.spandrel} mats={crown.screenBody} />
      <Inst geo={G.unitBox} mat={LM.frame} mats={crown.louvers} />
      <Inst geo={G.unitBox} mat={LM.bronze} mats={crown.hvac} />
      <Inst geo={G.unitBox} mat={LM.lantern} mats={crown.lanternCore} />
      <Inst geo={G.unitBox} mat={LM.frame} mats={crown.fins} />
      <Inst geo={GEO.pyramid} mat={LM.frame} mats={crown.pyramid} />
      <Inst geo={GEO.spire} mat={LM.frame} mats={crown.spire} />
      <Inst geo={GEO.cyl} mat={LM.frame} mats={crown.collars} />
      <mesh geometry={G.unitPlane} position={[0, crown.signY, crown.signZ]} scale={[0.24 * 15.3, 0.24, 1]}>
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      <Beacon position={crown.tip} />
    </group>
  )
}

// ── StarkShell — the Avengers tower ────────────────────────────────────

interface FlareStorey {
  y: number // plate bottom
  xE: number // east edge
  zF: number // front edge
}
const FLARE_K = 7
const FLARE_PITCH = 0.42
const FLARE_PLATE = 0.06

function starkCrown(n: number, b: BodySpec) {
  const R = lobbyH + n * floorH
  const xW = -b.w / 2
  const zB = b.back
  const flare: FlareStorey[] = []
  for (let k = 0; k < FLARE_K; k++) {
    const t = (k + 1) / FLARE_K
    flare.push({
      y: R + 0.08 + k * FLARE_PITCH,
      xE: b.w / 2 + 1.75 * Math.pow(t, 1.8),
      zF: FZ + 0.06 + 0.32 * Math.pow(t, 1.5)
    })
  }
  const top = R + 0.08 + FLARE_K * FLARE_PITCH
  const last = flare[FLARE_K - 1]

  const white: THREE.Matrix4[] = [B(0, R + 0.04, b.cz, b.w + 0.16, 0.08, b.d + 0.16)]
  const glass: THREE.Matrix4[] = []
  const cyan: THREE.Matrix4[] = []
  const mull: THREE.Matrix4[] = []
  const gh = FLARE_PITCH - FLARE_PLATE
  for (const f of flare) {
    const px0 = xW - 0.03
    const px1 = f.xE + 0.03
    const pz0 = zB - 0.03
    const pz1 = f.zF + 0.03
    white.push(B((px0 + px1) / 2, f.y + FLARE_PLATE / 2, (pz0 + pz1) / 2, px1 - px0, FLARE_PLATE, pz1 - pz0))
    cyan.push(
      B((px0 + px1) / 2, f.y + FLARE_PLATE / 2, pz1 + 0.006, px1 - px0, 0.018, 0.012),
      B(px1 + 0.006, f.y + FLARE_PLATE / 2, (pz0 + pz1) / 2, 0.012, 0.018, pz1 - pz0)
    )
    const gx0 = xW + 0.02
    const gx1 = f.xE - 0.04
    const gz0 = zB + 0.02
    const gz1 = f.zF - 0.04
    const gy = f.y + FLARE_PLATE + gh / 2
    glass.push(B((gx0 + gx1) / 2, gy, (gz0 + gz1) / 2, gx1 - gx0, gh, gz1 - gz0))
    for (let x = gx0 + 0.4; x < gx1 - 0.1; x += 0.4) mull.push(B(x, gy, gz1 + 0.01, 0.025, gh, 0.03))
    for (let z = gz1 - 0.4; z > gz0 + 0.1; z -= 0.45) mull.push(B(gx1 + 0.01, gy, z, 0.03, gh, 0.025))
  }
  // top cap plate over the last storey
  white.push(B((xW + last.xE) / 2, top + 0.03, (zB + last.zF) / 2, last.xE - xW + 0.06, 0.06, last.zF - zB + 0.06))

  // angled glass roof — wedge rising west to meet the spine
  const wedgeRise = 1.0
  const wedgeX1 = last.xE - 0.25
  const wedgeZ0 = zB + 0.05
  const wedgeDepth = last.zF - 0.08 - wedgeZ0
  const slopeLen = Math.hypot(wedgeX1 - xW, wedgeRise)
  const slopeA = Math.atan2(-wedgeRise, wedgeX1 - xW)
  const slope = (dz: number, t: number, h: number) =>
    mT((xW + wedgeX1) / 2, top + 0.06 + wedgeRise / 2, wedgeZ0 + wedgeDepth + dz)
      .multiply(mR(0, 0, slopeA))
      .multiply(mS(slopeLen, h, t))
  white.push(slope(0.0, 0.06, 0.06))
  cyan.push(slope(0.035, 0.012, 0.02).multiply(mT(0, -1.2, 0)))
  for (let x = xW + 0.45; x < wedgeX1 - 0.1; x += 0.45) {
    const h = wedgeRise * (1 - (x - xW) / (wedgeX1 - xW))
    mull.push(B(x, top + 0.06 + h / 2, wedgeZ0 + wedgeDepth + 0.01, 0.025, h, 0.03))
  }

  // spine blade on the west-front corner, tallest element
  const spineTop = top + wedgeRise + 0.4
  const spineX0 = xW - 0.55
  const spineX1 = xW + 0.05
  const spineZ0 = FZ - 1.0
  const spineZ1 = FZ + 0.5
  cyan.push(B((spineX0 + spineX1) / 2, (lobbyH + spineTop - 0.4) / 2, spineZ1 + 0.006, 0.05, spineTop - 0.4 - lobbyH - 0.2, 0.012))

  // landing pad off storey 2
  const pk = 3
  const padY = flare[pk].y + FLARE_PLATE
  const padX = flare[pk].xE - 0.2 + PAD_W / 2
  const padZ = FZ - 1.65
  const px1 = padX + PAD_W / 2
  cyan.push(
    B(padX + 0.15, padY - 0.06, padZ + PAD_D / 2 + 0.006, PAD_W - 0.9, 0.025, 0.012),
    B(padX + 0.15, padY - 0.06, padZ - PAD_D / 2 - 0.006, PAD_W - 0.9, 0.025, 0.012),
    B(px1 + 0.006, padY - 0.06, padZ, 0.012, 0.025, PAD_D - 0.9)
  )
  const gun: THREE.Matrix4[] = []
  // hvac/mech on the podium roof behind + mast base on the spine
  gun.push(B((spineX0 + spineX1) / 2, spineTop + 0.08, FZ - 0.3, 0.3, 0.16, 0.3))

  return {
    R,
    top,
    flare,
    white,
    glass,
    cyan,
    mull,
    gun,
    wedge: { x0: xW, x1: wedgeX1, rise: wedgeRise, y: top + 0.06, z: wedgeZ0, depth: wedgeDepth },
    spine: { x0: spineX0, x1: spineX1, z0: spineZ0, z1: spineZ1, top: spineTop },
    pad: { x: padX, y: padY, z: padZ, x0: flare[pk].xE - 0.25 },
    logo: { x: 0.45, y: R + 0.08 + (FLARE_K * FLARE_PITCH) / 2 + 0.02, z: last.zF + 0.16 }
  }
}

/* extruded prism from a side profile in XY, extruded along +z */
function prism(pts: [number, number][], depth: number): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), {
    depth,
    bevelEnabled: false
  })
}

function Quinjet(): JSX.Element {
  const parts = useMemo(
    () => ({
      wings: [-1, 1].map((s) =>
        mT(s * 0.3, 0.12, -0.04)
          .multiply(mR(0, -s * 0.5, s * 0.06))
          .multiply(mS(0.56, 0.03, 0.2))
      ),
      fins: [-1, 1].map((s) =>
        mT(s * 0.1, 0.27, -0.26)
          .multiply(mR(-0.3, 0, -s * 0.45))
          .multiply(mS(0.03, 0.2, 0.16))
      ),
      engines: [-1, 1].map((s) =>
        mT(s * 0.16, 0.12, -0.2)
          .multiply(mR(Math.PI / 2, 0, 0))
          .multiply(mS(0.12, 0.28, 0.12))
      ),
      exhausts: [-1, 1].map((s) =>
        mT(s * 0.16, 0.12, -0.345)
          .multiply(mR(Math.PI / 2, 0, 0))
          .multiply(mS(0.08, 0.015, 0.08))
      )
    }),
    []
  )
  return (
    <group>
      <mesh geometry={GEO.jetBody} material={SM.jetHull} position={[0, 0.14, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={AG.cone} material={SM.jetHull} position={[0, 0.14, 0.36]} rotation={[Math.PI / 2, 0, 0]} scale={[0.2, 0.22, 0.2]} />
      <mesh geometry={GEO.sphereLo} material={AM.screenDark} position={[0, 0.21, 0.14]} scale={[0.17, 0.1, 0.3]} />
      <Inst geo={G.unitBox} mat={SM.jetHull} mats={parts.wings} />
      <Inst geo={G.unitBox} mat={SM.jetHull} mats={parts.fins} />
      <Inst geo={AG.cyl} mat={AM.darkMetal} mats={parts.engines} />
      <Inst geo={AG.cyl} mat={AM.arcRing} mats={parts.exhausts} />
    </group>
  )
}

function StarkShell({ departments, body }: { departments: Department[]; body: BodySpec }): JSX.Element {
  bindMaps()
  const n = departments.length
  const cyan = useMemo(() => new THREE.Color(P.holoCyan), [])
  const sets = useMemo(() => buildFacade(departments, body, STARK_FACADE, () => cyan), [departments, body, cyan])
  const c = useMemo(() => starkCrown(n, body), [n, body])

  /* n-dependent extrusions — rebuilt with the floor count, disposed after */
  const geos = useMemo(() => {
    const s = c.spine
    const wedge = prism(
      [
        [c.wedge.x0, 0],
        [c.wedge.x1, 0],
        [c.wedge.x0, c.wedge.rise]
      ],
      c.wedge.depth
    )
    const spine = prism(
      [
        [s.x0, 0],
        [s.x1, 0],
        [s.x1, s.top - lobbyH - 0.45],
        [s.x0, s.top - lobbyH]
      ],
      s.z1 - s.z0
    )
    return { wedge, spine }
  }, [c])
  useEffect(
    () => () => {
      geos.wedge.dispose()
      geos.spine.dispose()
    },
    [geos]
  )

  const pierX = body.w / 2 + 0.03
  const H = n * floorH
  return (
    <group>
      <Facade
        sets={sets}
        glass={SM.glass}
        frame={SM.white}
        spandrel={SM.spandrel}
        mid={SM.spandrel}
        core={SM.core}
        carpet={SM.carpet}
        desk={SM.desk}
        deskPanel={SM.deskPanel}
        pilaster={SM.gun}
      />
      {/* arc-light seam on the camera-side corner */}
      {H > 0 && (
        <mesh geometry={G.unitBox} material={SM.cyan} position={[pierX, lobbyH + H / 2, FZ + 0.03]} scale={[0.025, H, 0.025]} />
      )}

      {/* flared crown — cantilevered storeys, plates, cyan edges */}
      <Inst geo={G.unitBox} mat={SM.crownGlass} mats={c.glass} />
      <Inst geo={G.unitBox} mat={SM.white} mats={c.white} />
      <Inst geo={G.unitBox} mat={SM.white} mats={c.mull} />
      <Inst geo={G.unitBox} mat={SM.cyan} mats={c.cyan} />
      <Inst geo={GEO.bevel} mat={SM.white} mats={c.gun} />
      {/* angled glass roof */}
      <mesh geometry={geos.wedge} material={SM.roofGlass} position={[0, c.wedge.y, c.wedge.z]} />
      {/* spine blade */}
      <mesh geometry={geos.spine} material={SM.white} position={[0, lobbyH, c.spine.z0]} />
      <mesh
        geometry={GEO.spire}
        material={SM.gun}
        position={[(c.spine.x0 + c.spine.x1) / 2, c.spine.top + 0.5, FZ - 0.3]}
        scale={[0.7, 0.8, 0.7]}
      />
      <Beacon position={[(c.spine.x0 + c.spine.x1) / 2, c.spine.top + 0.92, FZ - 0.3]} size={0.6} />

      {/* the circled "A" on the crown face */}
      <group position={[c.logo.x, c.logo.y, c.logo.z]} scale={1.3}>
        <mesh geometry={G.unitPlane} position={[0.1, 0, -0.06]} scale={[3.6, 3.6, 1]}>
          <meshBasicMaterial
            map={haloTex()}
            color={P.holoCyan}
            transparent
            opacity={0.32}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh geometry={GEO.aLogo} material={[SM.logoFace, SM.logoSide]} position={[0, 0, -0.045]} />
      </group>

      {/* quinjet landing pad */}
      <group>
        <mesh geometry={GEO.padDeck} material={SM.white} position={[c.pad.x, c.pad.y - 0.12, c.pad.z]} rotation={[-Math.PI / 2, 0, 0]} />
        <mesh
          geometry={G.unitPlane}
          material={SM.padDeck}
          position={[c.pad.x, c.pad.y + 0.004, c.pad.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[PAD_W, PAD_D, 1]}
        />
        {[-0.75, 0.75].map((dz) => (
          <mesh
            key={dz}
            geometry={GEO.bracket}
            material={SM.white}
            position={[c.pad.x0, c.pad.y - 0.12, c.pad.z + dz - 0.08]}
          />
        ))}
        <group position={[c.pad.x + 0.1, c.pad.y, c.pad.z]} rotation={[0, -0.9, 0]} scale={1.25}>
          <Quinjet />
        </group>
      </group>
    </group>
  )
}

// ── HQBuilding ─────────────────────────────────────────────────────────

/** the company HQ seen from across the road — one floor per department.
 * `theme` picks the tower skin: 'loft' (default, Manhattan glass tower)
 * or 'avengers' (the Avengers tower). */
export function HQBuilding({ departments, counts, onFloorClick, theme = 'loft' }: HQBuildingProps): JSX.Element {
  const stark = theme === 'avengers'
  const body = BODY[theme]
  return (
    <group position={[CITY.hqX, 0, CITY.hqZ]}>
      <Podium stark={stark} />
      {stark ? <StarkShell departments={departments} body={body} /> : <LoftShell departments={departments} body={body} />}
      <TowerFloors departments={departments} counts={counts} onFloorClick={onFloorClick} body={body} stark={stark} />
    </group>
  )
}
