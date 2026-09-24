/* ── Avengers Compound — Stark-tech furniture ──────────────────────────
 *  · ConsoleSet     every console's static body (glass-black slab, white
 *                   blade legs, emitter bar, under-glow) — instanced across
 *                   the whole desk list, a handful of draws total.
 *  · ConsoleHolo    the per-hero live part: three floating holo panes + a
 *                   projected keyboard, tinted by status (cyan working,
 *                   amber waiting, green done, dim idle, dark asleep).
 *  · StandbySet     unmanned consoles — one small dim standby glyph each.
 *  · ChairSet       white shell task chairs, instanced; the scene feeds
 *                   per-desk transforms (big heroes get a pushed-back,
 *                   scaled-up chair).
 *  · HoloTable      the hub — round briefing table projecting a rotating
 *                   globe, orbit rings, a holo city and data cards.
 *  · StarkBar       walnut + quartz bar with a lit bottle wall.
 *  · LoungeSet      sectional, armchairs, coffee table, rug, lamp.
 *  · MissionWall    the big left-wall screen: world map + telemetry.
 * Holograms are additive, unlit, toneMapped:false — no postprocessing;
 * the glow is layered transparent planes. All components are local-space
 * unless they take world placement from layout. */
import * as THREE from 'three'
import { useMemo, useRef, type JSX } from 'react'
import { useFrame } from '@react-three/fiber'
import { AG, AM, Inst, mT, mR, mS, hash01, glowMat, fadeTexture, glowTexture } from './shared'
import { P } from './palette'
import {
  DESK,
  HUB,
  BAR,
  BAR_STOOLS,
  SOFA,
  ARMCHAIRS,
  COFFEE_TABLE,
  LOUNGE_RUG,
  ROOM,
  MISSION_WALL,
  type FacilityDesk
} from './layout'
import { beveledBox, upholsteredBox } from '../ModelGeometry'
import { Cutaway } from './Room'
import type { AgentStatus } from '@shared/types'

/* ══ painted holo textures ═══════════════════════════════════════════
 * White-on-black canvases drawn once, used with ADDITIVE blending: black
 * is invisible, white takes the material tint. So one texture set serves
 * every status colour. Deterministic (fixed-seed LCG). */
function lcg(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  draw(g)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** pane chrome: tinted glass fill, hairline border, bold corner brackets */
function paneChrome(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = 'rgba(255,255,255,0.17)'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = 2
  g.strokeRect(2, 2, w - 4, h - 4)
  g.strokeStyle = '#fff'
  g.lineWidth = 4
  const k = 18
  for (const [x, y, sx, sy] of [
    [3, 3, 1, 1],
    [w - 3, 3, -1, 1],
    [3, h - 3, 1, -1],
    [w - 3, h - 3, -1, -1]
  ]) {
    g.beginPath()
    g.moveTo(x + sx * k, y)
    g.lineTo(x, y)
    g.lineTo(x, y + sy * k)
    g.stroke()
  }
  // header rule + title blocks
  g.fillStyle = 'rgba(255,255,255,0.8)'
  g.fillRect(14, 12, 54, 7)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(74, 12, 30, 7)
  g.fillRect(w - 44, 12, 30, 7)
  g.fillStyle = 'rgba(255,255,255,0.3)'
  g.fillRect(12, 26, w - 24, 1.5)
}

function uiVariant(v: number): THREE.CanvasTexture {
  const W = 384
  const H = 224
  return canvasTex(W, H, (g) => {
    const r = lcg(101 + v * 977)
    paneChrome(g, W, H)
    const kind = v % 4
    if (kind === 0) {
      // code editor — indented lines, a highlighted cursor row
      for (let i = 0; i < 12; i++) {
        const y = 38 + i * 14
        const ind = Math.floor(r() * 4) * 14
        g.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`
        g.fillRect(18 + ind, y, 30 + r() * 150, 6)
        if (r() > 0.6) {
          g.fillStyle = 'rgba(255,255,255,0.9)'
          g.fillRect(24 + ind + 160, y, 20 + r() * 50, 6)
        }
      }
      g.fillStyle = 'rgba(255,255,255,0.14)'
      g.fillRect(12, 38 + 5 * 14 - 4, W - 24, 14)
      // minimap strip
      for (let i = 0; i < 26; i++) {
        g.fillStyle = 'rgba(255,255,255,0.3)'
        g.fillRect(W - 40, 36 + i * 6.6, 8 + r() * 16, 3)
      }
    } else if (kind === 1) {
      // telemetry — framed waveform + bar histogram + arc gauge
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 1.5
      g.strokeRect(16, 38, 220, 92)
      g.strokeStyle = '#fff'
      g.lineWidth = 2.5
      g.beginPath()
      for (let i = 0; i <= 44; i++) {
        const x = 18 + i * 5
        const y = 84 + Math.sin(i * 0.45 + v) * 22 * (0.4 + r() * 0.8)
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
      for (let i = 0; i < 14; i++) {
        const hh = 12 + r() * 58
        g.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`
        g.fillRect(18 + i * 15.5, 206 - hh, 10, hh)
      }
      g.lineWidth = 8
      g.strokeStyle = 'rgba(255,255,255,0.18)'
      g.beginPath()
      g.arc(308, 96, 44, 0, Math.PI * 2)
      g.stroke()
      g.strokeStyle = '#fff'
      g.beginPath()
      g.arc(308, 96, 44, -Math.PI / 2, -Math.PI / 2 + (0.4 + r() * 0.5) * Math.PI * 2)
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.8)'
      g.fillRect(290, 90, 36, 12)
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`
        g.fillRect(262, 160 + i * 11, 40 + r() * 60, 5)
      }
    } else if (kind === 2) {
      // radar sweep + contact list
      g.strokeStyle = 'rgba(255,255,255,0.45)'
      g.lineWidth = 1.5
      for (const rr of [30, 56, 82]) {
        g.beginPath()
        g.arc(110, 124, rr, 0, Math.PI * 2)
        g.stroke()
      }
      g.beginPath()
      g.moveTo(28, 124)
      g.lineTo(192, 124)
      g.moveTo(110, 42)
      g.lineTo(110, 206)
      g.stroke()
      const sweep = g.createLinearGradient(110, 124, 190, 60)
      sweep.addColorStop(0, 'rgba(255,255,255,0.55)')
      sweep.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = sweep
      g.beginPath()
      g.moveTo(110, 124)
      g.arc(110, 124, 82, -1.2, -0.5)
      g.fill()
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2
        const d = 15 + r() * 62
        g.fillStyle = '#fff'
        g.fillRect(110 + Math.cos(a) * d - 3, 124 + Math.sin(a) * d - 3, 6, 6)
      }
      for (let i = 0; i < 9; i++) {
        g.fillStyle = `rgba(255,255,255,${i === 2 ? 0.95 : 0.35 + r() * 0.35})`
        g.fillRect(222, 44 + i * 18, 60 + r() * 80, 7)
      }
    } else {
      // schematic — armor wireframe rings + callouts
      g.strokeStyle = 'rgba(255,255,255,0.8)'
      g.lineWidth = 2
      g.beginPath()
      g.ellipse(120, 70, 18, 22, 0, 0, Math.PI * 2) // helmet
      g.stroke()
      g.strokeRect(96, 96, 48, 58) // torso
      g.beginPath()
      g.arc(120, 116, 8, 0, Math.PI * 2) // reactor
      g.stroke()
      for (const [x1, y1, x2, y2] of [
        [96, 100, 70, 150],
        [144, 100, 170, 150],
        [108, 154, 104, 206],
        [132, 154, 136, 206]
      ]) {
        g.beginPath()
        g.moveTo(x1, y1)
        g.lineTo(x2, y2)
        g.stroke()
      }
      g.strokeStyle = 'rgba(255,255,255,0.4)'
      g.lineWidth = 1
      for (let i = 0; i < 5; i++) {
        const y = 52 + i * 34
        g.beginPath()
        g.moveTo(150, y)
        g.lineTo(220, y)
        g.stroke()
        g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.5})`
        g.fillRect(226, y - 4, 50 + r() * 90, 8)
      }
    }
  })
}

const UI_VARIANTS = 8
let uiCache: THREE.CanvasTexture[] | null = null
function uiTextures(): THREE.CanvasTexture[] {
  if (!uiCache) uiCache = Array.from({ length: UI_VARIANTS }, (_, i) => uiVariant(i))
  return uiCache
}

let kbCache: THREE.CanvasTexture | null = null
function keyboardTexture(): THREE.CanvasTexture {
  if (kbCache) return kbCache
  kbCache = canvasTex(256, 96, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.08)'
    g.fillRect(0, 0, 256, 96)
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.lineWidth = 1.5
    g.strokeRect(2, 2, 252, 92)
    for (let row = 0; row < 4; row++) {
      const n = 12 - (row === 3 ? 4 : 0)
      const kw = 17
      const off = row * 5 + (row === 3 ? 40 : 0)
      for (let i = 0; i < n; i++) {
        g.fillStyle = 'rgba(255,255,255,0.55)'
        g.fillRect(12 + off + i * (kw + 2.5), 10 + row * 20, row === 3 && i === 3 ? kw * 3 : kw, 15)
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.8)'
    g.strokeRect(222, 12, 26, 72)
  })
  return kbCache
}

let standbyCache: THREE.CanvasTexture | null = null
function standbyTexture(): THREE.CanvasTexture {
  if (standbyCache) return standbyCache
  standbyCache = canvasTex(128, 128, (g) => {
    g.strokeStyle = '#fff'
    g.lineWidth = 5
    g.beginPath()
    g.arc(64, 64, 50, 0, Math.PI * 2)
    g.stroke()
    // the "A" — two legs + the arrow crossbar
    g.lineWidth = 9
    g.beginPath()
    g.moveTo(42, 98)
    g.lineTo(64, 28)
    g.lineTo(86, 98)
    g.moveTo(50, 72)
    g.lineTo(104, 72)
    g.stroke()
  })
  return standbyCache
}

/* status → hologram tint */
export type HoloState = 'work' | 'wait' | 'done' | 'idle' | 'off'
export function holoState(status: AgentStatus, asleep: boolean): HoloState {
  if (asleep || status === 'offline') return 'off'
  if (status === 'working') return 'work'
  if (status === 'waiting') return 'wait'
  if (status === 'done') return 'done'
  return 'idle'
}
const TINT: Record<Exclude<HoloState, 'off'>, { color: string; opacity: number }> = {
  work: { color: '#7fdcff', opacity: 1 },
  wait: { color: '#ffb54d', opacity: 1 },
  done: { color: '#72f0a6', opacity: 1 },
  idle: { color: '#5fb8e0', opacity: 0.5 }
}

const holoMatCache = new Map<string, THREE.MeshBasicMaterial>()
function holoPaneMat(tex: THREE.Texture, state: Exclude<HoloState, 'off'>, key: string): THREE.MeshBasicMaterial {
  const k = `${key}|${state}`
  let m = holoMatCache.get(k)
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: tex,
      // pushed past 1.0 — additive + toneMapped:false reads as emitted light
      color: new THREE.Color(TINT[state].color).multiplyScalar(1.7),
      transparent: true,
      opacity: TINT[state].opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
    holoMatCache.set(k, m)
  }
  return m
}

/* ══ console body — instanced across every desk ══════════════════════ */
const CG = {
  top: beveledBox(DESK.w, 0.05, DESK.d, 0.018),
  blade: beveledBox(0.07, 1, DESK.d - 0.12, 0.02),
  foot: beveledBox(0.16, 0.035, DESK.d - 0.02, 0.012),
  modesty: beveledBox(DESK.w - 0.24, 0.36, 0.03, 0.01),
  emitter: beveledBox(DESK.w - 0.2, 0.045, 0.07, 0.015),
  pane: new THREE.PlaneGeometry(1, 1)
} as const

const deskAt = (d: FacilityDesk) => mT(d.x, d.y, d.z).multiply(mR(0, d.rotY, 0))

export function ConsoleSet({ desks }: { desks: FacilityDesk[] }): JSX.Element {
  const m = useMemo(() => {
    const T = DESK.top
    const top: THREE.Matrix4[] = []
    const blade: THREE.Matrix4[] = []
    const foot: THREE.Matrix4[] = []
    const modesty: THREE.Matrix4[] = []
    const emitter: THREE.Matrix4[] = []
    const slit: THREE.Matrix4[] = []
    const edge: THREE.Matrix4[] = []
    const under: THREE.Matrix4[] = []
    for (const d of desks) {
      const a = deskAt(d)
      top.push(a.clone().multiply(mT(0, T - 0.025, 0)))
      for (const s of [-1, 1]) {
        blade.push(
          a
            .clone()
            .multiply(mT(s * (DESK.w / 2 - 0.16), (T - 0.05) / 2, -0.02))
            .multiply(mS(1, T - 0.05, 1))
        )
        foot.push(a.clone().multiply(mT(s * (DESK.w / 2 - 0.16), 0.018, -0.02)))
      }
      modesty.push(a.clone().multiply(mT(0, T - 0.26, -DESK.d / 2 + 0.08)))
      emitter.push(a.clone().multiply(mT(0, T + 0.022, -DESK.d / 2 + 0.07)))
      slit.push(
        a
          .clone()
          .multiply(mT(0, T + 0.046, -DESK.d / 2 + 0.07))
          .multiply(mS(DESK.w - 0.3, 0.004, 0.012))
      )
      edge.push(
        a
          .clone()
          .multiply(mT(0, T - 0.03, DESK.d / 2 + 0.004))
          .multiply(mS(DESK.w - 0.1, 0.01, 0.008))
      )
      under.push(
        a
          .clone()
          .multiply(mT(0, 0.006, -0.05))
          .multiply(mR(-Math.PI / 2, 0, 0))
          .multiply(mS(DESK.w + 0.6, DESK.d + 0.7, 1))
      )
    }
    return { top, blade, foot, modesty, emitter, slit, edge, under }
  }, [desks])
  return (
    <group>
      <Inst geo={CG.top} mat={AM.benchTop} mats={m.top} castShadow receiveShadow />
      <Inst geo={CG.blade} mat={AM.steel} mats={m.blade} castShadow />
      <Inst geo={CG.foot} mat={AM.graphite} mats={m.foot} />
      <Inst geo={CG.modesty} mat={AM.graphite} mats={m.modesty} castShadow />
      <Inst geo={CG.emitter} mat={AM.darkMetal} mats={m.emitter} castShadow />
      <Inst geo={AG.unitBox} mat={AM.holoSolid} mats={m.slit} />
      <Inst geo={AG.unitBox} mat={AM.holoSolid} mats={m.edge} />
      <Inst geo={AG.unitPlane} mat={glowMat(P.holoCyan, 0.16)} mats={m.under} />
    </group>
  )
}

/* ══ per-hero holo panes ═════════════════════════════════════════════
 * Local-space (the scene wraps it in the desk transform). Panes face +z —
 * the chair side — and float above the emitter bar. */
const PANES = [
  { x: 0, y: 0.4, z: -0.25, w: 0.8, h: 0.46, ry: 0 },
  { x: -0.64, y: 0.36, z: -0.14, w: 0.5, h: 0.34, ry: 0.5 },
  { x: 0.64, y: 0.36, z: -0.14, w: 0.5, h: 0.34, ry: -0.5 }
] as const
function keyboardMat(state: Exclude<HoloState, 'off'>): THREE.MeshBasicMaterial {
  return holoPaneMat(keyboardTexture(), state, 'kb')
}

export function ConsoleHolo({ state, seed }: { state: HoloState; seed: string }): JSX.Element | null {
  const tex = uiTextures()
  if (state === 'off') return null
  const T = DESK.top
  const v0 = Math.floor(hash01(seed, 3) * UI_VARIANTS)
  return (
    <group>
      {PANES.map((p, i) => {
        const vi = (v0 + i * 3) % UI_VARIANTS
        return (
          <group key={i} position={[p.x, T + p.y, p.z]} rotation={[-0.06, p.ry, 0]}>
            {/* soft halo behind the pane — fake bloom */}
            <mesh
              position={[0, 0, -0.012]}
              scale={[p.w * 1.5, p.h * 1.8, 1]}
              geometry={CG.pane}
              material={glowMat(TINT[state].color, 0.14)}
            />
            <mesh scale={[p.w, p.h, 1]} geometry={CG.pane} material={holoPaneMat(tex[vi], state, `ui${vi}`)} />
          </group>
        )
      })}
      {/* projection fan from the emitter up to the main pane */}
      <mesh
        position={[0, T + 0.2, -DESK.d / 2 + 0.07]}
        rotation={[-0.25, 0, 0]}
        scale={[0.74, 0.34, 1]}
        geometry={CG.pane}
        material={beamMat(state)}
      />
      {/* holo keyboard projected on the glass */}
      <mesh
        position={[0, T + 0.003, 0.14]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.52, 0.19, 1]}
        geometry={CG.pane}
        material={keyboardMat(state)}
      />
    </group>
  )
}

const beamCache = new Map<string, THREE.MeshBasicMaterial>()
function beamMat(state: Exclude<HoloState, 'off'>): THREE.MeshBasicMaterial {
  let m = beamCache.get(state)
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: TINT[state].color,
      map: fadeTexture(),
      transparent: true,
      opacity: 0.16 * TINT[state].opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
    beamCache.set(state, m)
  }
  return m
}

/* ══ standby glyphs on unmanned consoles ═════════════════════════════ */
const standbyMat = new THREE.MeshBasicMaterial({
  map: standbyTexture(),
  color: P.holoCyan,
  transparent: true,
  opacity: 0.32,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false
})
export function StandbySet({ desks }: { desks: FacilityDesk[] }): JSX.Element {
  const mats = useMemo(
    () =>
      desks.map((d) =>
        deskAt(d)
          .multiply(mT(0, DESK.top + 0.24, -0.24))
          .multiply(mS(0.26, 0.26, 1))
      ),
    [desks]
  )
  return <Inst geo={CG.pane} mat={standbyMat} mats={mats} />
}

/* ══ chairs — white shell task chairs, instanced ═════════════════════
 * Chair-local: seat centred at origin xz, occupant faces −z (the desk);
 * the back rises at +z. Seat top lands at 0.5 × scale. */
export interface ChairPlacement {
  x: number
  y: number
  z: number
  rotY: number
  scale: number
}
const CHG = {
  seat: upholsteredBox(0.52, 0.08, 0.5),
  shell: beveledBox(0.56, 0.05, 0.54, 0.02),
  back: beveledBox(0.5, 0.46, 0.06, 0.028),
  backPad: upholsteredBox(0.4, 0.3, 0.035),
  arm: beveledBox(0.05, 0.03, 0.34, 0.012),
  armPost: new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8),
  column: new THREE.CylinderGeometry(0.03, 0.03, 0.34, 10),
  hub: new THREE.CylinderGeometry(0.06, 0.08, 0.05, 14),
  leg: beveledBox(0.3, 0.03, 0.05, 0.012),
  caster: new THREE.SphereGeometry(0.028, 8, 6)
} as const
const CHAIR_PARTS: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4[]; shadow?: boolean }[] = [
  { geo: CHG.shell, mat: AM.whiteGloss, local: [mT(0, 0.44, 0)], shadow: true },
  {
    geo: CHG.seat,
    mat: new THREE.MeshStandardMaterial({ color: '#b7bec9', roughness: 0.8 }),
    local: [mT(0, 0.49, -0.01)]
  },
  { geo: CHG.back, mat: AM.whiteGloss, local: [mT(0, 0.76, 0.27).multiply(mR(-0.16, 0, 0))], shadow: true },
  {
    geo: CHG.backPad,
    mat: new THREE.MeshStandardMaterial({ color: '#dde2e8', roughness: 0.75 }),
    local: [mT(0, 0.74, 0.235).multiply(mR(-0.16, 0, 0))]
  },
  {
    geo: AG.unitBox,
    mat: AM.holoSolid,
    local: [
      mT(0, 0.975, 0.31)
        .multiply(mR(-0.16, 0, 0))
        .multiply(mS(0.3, 0.012, 0.01))
    ]
  },
  { geo: CHG.arm, mat: AM.whiteGloss, local: [-1, 1].map((s) => mT(s * 0.29, 0.66, 0.02)) },
  { geo: CHG.armPost, mat: AM.steelHi, local: [-1, 1].map((s) => mT(s * 0.29, 0.56, 0.08)) },
  { geo: CHG.column, mat: AM.steelHi, local: [mT(0, 0.25, 0)] },
  { geo: CHG.hub, mat: AM.graphite, local: [mT(0, 0.1, 0)] },
  {
    geo: CHG.leg,
    mat: AM.graphite,
    local: [0, 1, 2, 3, 4].map((i) =>
      mR(0, (i / 5) * Math.PI * 2, 0)
        .multiply(mT(0.15, 0.07, 0))
        .multiply(mR(0, 0, -0.12))
    )
  },
  {
    geo: CHG.caster,
    mat: AM.graphite,
    local: [0, 1, 2, 3, 4].map((i) => mR(0, (i / 5) * Math.PI * 2, 0).multiply(mT(0.29, 0.028, 0)))
  }
]

export function ChairSet({ chairs }: { chairs: ChairPlacement[] }): JSX.Element {
  const draws = useMemo(() => {
    const roots = chairs.map((c) =>
      mT(c.x, c.y, c.z)
        .multiply(mR(0, c.rotY, 0))
        // wider + deeper for the big guy — seat height never changes (the
        // rig keeps every build's seated hips at the same height)
        .multiply(mS(c.scale, 1, c.scale))
    )
    return CHAIR_PARTS.map((p) => ({
      ...p,
      mats: roots.flatMap((r) => p.local.map((l) => r.clone().multiply(l)))
    }))
  }, [chairs])
  return (
    <group>
      {draws.map((d, i) => (
        <Inst key={`${i}-${d.mats.length}`} geo={d.geo} mat={d.mat} mats={d.mats} castShadow={d.shadow} />
      ))}
    </group>
  )
}

/* ══ holo briefing table — the hub ═══════════════════════════════════ */
const HT = {
  pedestal: new THREE.CylinderGeometry(0.62, 0.86, 0.78, 48),
  plinth: new THREE.CylinderGeometry(1.05, 1.12, 0.08, 64),
  top: new THREE.CylinderGeometry(HUB.r, HUB.r - 0.04, 0.07, 72),
  topMat: new THREE.MeshStandardMaterial({ color: '#12151b', roughness: 0.55, metalness: 0.4, envMapIntensity: 0.35 }),
  topInset: new THREE.CircleGeometry(HUB.r - 0.14, 72),
  lens: new THREE.CylinderGeometry(0.2, 0.24, 0.03, 40),
  globe: new THREE.SphereGeometry(0.55, 48, 32),
  globeWire: new THREE.SphereGeometry(0.565, 24, 14),
  beam: new THREE.CylinderGeometry(0.5, 0.28, 0.9, 40, 1, true),
  cityBox: new THREE.BoxGeometry(1, 1, 1)
} as const

/** equirect dotted world map — continent blobs sampled on a lat/long grid */
let globeCache: THREE.CanvasTexture | null = null
function globeTexture(): THREE.CanvasTexture {
  if (globeCache) return globeCache
  const blobs: [number, number, number, number][] = [
    [0.2, 0.3, 0.1, 0.12], // N america
    [0.14, 0.2, 0.05, 0.06],
    [0.29, 0.64, 0.045, 0.16], // S america
    [0.51, 0.27, 0.045, 0.07], // europe
    [0.54, 0.54, 0.07, 0.16], // africa
    [0.7, 0.3, 0.14, 0.12], // asia
    [0.76, 0.46, 0.05, 0.06],
    [0.85, 0.7, 0.055, 0.06], // australia
    [0.38, 0.14, 0.04, 0.04] // greenland
  ]
  globeCache = canvasTex(512, 256, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.06)'
    g.fillRect(0, 0, 512, 256)
    g.strokeStyle = 'rgba(255,255,255,0.22)'
    g.lineWidth = 1
    for (let x = 0; x <= 512; x += 32) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, 256)
      g.stroke()
    }
    for (let y = 0; y <= 256; y += 32) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(512, y)
      g.stroke()
    }
    for (let y = 4; y < 256; y += 6) {
      for (let x = 4; x < 512; x += 6) {
        const u = x / 512
        const v = y / 256
        let inside = false
        for (const [bx, by, rx, ry] of blobs) {
          const dx = (u - bx) / rx
          const dy = (v - by) / ry
          if (dx * dx + dy * dy < 1 + Math.sin(u * 60 + v * 40) * 0.18) inside = true
        }
        if (inside) {
          g.fillStyle = 'rgba(255,255,255,0.95)'
          g.fillRect(x - 1.6, y - 1.6, 3.2, 3.2)
        }
      }
    }
    // a few hot-spot markers
    for (const [u, v] of [
      [0.22, 0.36],
      [0.52, 0.28],
      [0.74, 0.34],
      [0.3, 0.62]
    ]) {
      g.strokeStyle = '#fff'
      g.lineWidth = 2
      g.beginPath()
      g.arc(u * 512, v * 256, 7, 0, Math.PI * 2)
      g.stroke()
    }
  })
  return globeCache
}

const htMats = {
  globe: new THREE.MeshBasicMaterial({
    color: '#8fe3ff',
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  }),
  wire: new THREE.MeshBasicMaterial({
    color: P.holoDeep,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),
  beam: new THREE.MeshBasicMaterial({
    color: P.holoCyan,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false
  }),
  city: new THREE.MeshBasicMaterial({
    color: '#58c6f0',
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),
  inset: new THREE.MeshBasicMaterial({
    color: P.holoDeep,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  })
}

const globeHalo = new THREE.SpriteMaterial({
  map: glowTexture(),
  color: P.holoCyan,
  transparent: true,
  opacity: 0.2,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})

/* holo city ring on the table top — deterministic block heights */
const CITY_MATS: THREE.Matrix4[] = []
{
  const r = lcg(4242)
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2
    const d = 0.5 + r() * 0.55
    const hgt = 0.03 + Math.pow(r(), 2.2) * 0.26
    const w = 0.04 + r() * 0.05
    CITY_MATS.push(
      mT(Math.cos(a) * d, 0.905 + hgt / 2, Math.sin(a) * d)
        .multiply(mR(0, a, 0))
        .multiply(mS(w, hgt, w * (0.8 + r() * 0.6)))
    )
  }
}
const ORBIT_RINGS: { r: number; tilt: [number, number, number]; speed: number }[] = [
  { r: 0.78, tilt: [1.2, 0, 0.3], speed: 0.35 },
  { r: 0.9, tilt: [1.75, 0.4, -0.2], speed: -0.22 },
  { r: 0.68, tilt: [Math.PI / 2, 0, 0], speed: 0.6 }
]
const CARD_COUNT = 4

export function HoloTable(): JSX.Element {
  const globe = useRef<THREE.Group>(null)
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const cards = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  htMats.globe.map = globeTexture()
  const uiTex = uiTextures()

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    if (globe.current) globe.current.rotation.y += dt * 0.18
    for (let i = 0; i < rings.current.length; i++) {
      const m = rings.current[i]
      if (m) m.rotation.z += dt * ORBIT_RINGS[i].speed
    }
    if (cards.current) cards.current.rotation.y -= dt * 0.08
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.025 * Math.sin(t * 2.1)
  })

  return (
    <group>
      {/* floor plinth + sculpted pedestal */}
      <mesh position={[0, 0.04, 0]} geometry={HT.plinth} material={AM.graphite} receiveShadow />
      <mesh position={[0, 0.47, 0]} geometry={HT.pedestal} material={AM.graphite} castShadow receiveShadow />
      {/* lit band where pedestal meets the top */}
      <mesh
        position={[0, 0.83, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.66, 0.66, 1.4]}
        geometry={AG.ring}
        material={AM.holoSolid}
      />
      {/* glass-black table top, cyan rim, emitter lens */}
      <mesh position={[0, 0.865, 0]} geometry={HT.top} material={HT.topMat} castShadow receiveShadow />
      <mesh
        position={[0, 0.9, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[HUB.r - 0.01, HUB.r - 0.01, 1.6]}
        geometry={AG.ring}
        material={AM.holoSolid}
      />
      <mesh position={[0, 0.902, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={HT.topInset} material={htMats.inset} />
      <mesh position={[0, 0.915, 0]} geometry={HT.lens} material={AM.arcRing} />

      {/* holo city ring projected on the top */}
      <Inst geo={HT.cityBox} mat={htMats.city} mats={CITY_MATS} />

      {/* projection beam + the globe */}
      <mesh ref={beam} position={[0, 1.36, 0]} geometry={HT.beam} material={htMats.beam} />
      <group position={[0, 2.12, 0]}>
        <group ref={globe} rotation={[0.35, 0, 0.2]}>
          <mesh geometry={HT.globe} material={htMats.globe} />
          <mesh geometry={HT.globeWire} material={htMats.wire} />
        </group>
        {/* inner glow — camera-facing sprite, fake bloom */}
        <sprite scale={1.7} material={globeHalo} />
        {ORBIT_RINGS.map((o, i) => (
          <mesh
            key={i}
            ref={(m) => {
              rings.current[i] = m
            }}
            rotation={o.tilt}
            scale={[o.r, o.r, 1.5]}
            geometry={AG.ring}
            material={AM.holoSolid}
          />
        ))}
      </group>

      {/* data cards orbiting the globe */}
      <group ref={cards} position={[0, 1.55, 0]}>
        {Array.from({ length: CARD_COUNT }, (_, i) => {
          const a = (i / CARD_COUNT) * Math.PI * 2 + 0.4
          return (
            <mesh
              key={i}
              position={[Math.sin(a) * 1.05, (i % 2) * 0.22, Math.cos(a) * 1.05]}
              rotation={[0, a, 0]}
              scale={[0.46, 0.27, 1]}
              geometry={AG.unitPlane}
              material={holoPaneMat(uiTex[(i * 3 + 1) % UI_VARIANTS], 'work', `card${(i * 3 + 1) % UI_VARIANTS}`)}
            />
          )
        })}
      </group>

      {/* floor glow pool — the fake reflection of the hologram */}
      <mesh
        position={[0, 0.09, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[4.2, 4.2, 1]}
        geometry={AG.unitPlane}
        material={glowMat(P.holoCyan, 0.16)}
      />
    </group>
  )
}

/* ══ Stark bar ═══════════════════════════════════════════════════════
 * Counter runs along z at BAR.x, customers on the −x side; the lit back
 * bar hangs on the right wall. World-space (reads BAR from layout). */
const barMats = {
  walnut: new THREE.MeshStandardMaterial({ color: P.walnut, roughness: 0.55 }),
  walnutDark: new THREE.MeshStandardMaterial({ color: P.walnutDark, roughness: 0.6 }),
  quartz: new THREE.MeshPhysicalMaterial({ color: '#f2f3f4', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }),
  brass: new THREE.MeshStandardMaterial({ color: P.brass, roughness: 0.3, metalness: 0.9 }),
  shelfGlass: new THREE.MeshBasicMaterial({ color: '#ffe2b0', transparent: true, opacity: 0.85, toneMapped: false }),
  backlight: new THREE.MeshBasicMaterial({ color: '#ffcf8a', toneMapped: false }),
  bottleAmber: new THREE.MeshPhysicalMaterial({
    color: '#b86a1c',
    roughness: 0.1,
    transmission: 0,
    transparent: true,
    opacity: 0.9,
    clearcoat: 1
  }),
  bottleGreen: new THREE.MeshPhysicalMaterial({
    color: '#2f6b3a',
    roughness: 0.1,
    transparent: true,
    opacity: 0.9,
    clearcoat: 1
  }),
  bottleClear: new THREE.MeshPhysicalMaterial({
    color: '#d9e6ea',
    roughness: 0.05,
    transparent: true,
    opacity: 0.6,
    clearcoat: 1
  }),
  stoolSeat: new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.6 })
}
const bottleGeo = new THREE.CylinderGeometry(0.035, 0.038, 0.24, 10)
const neckGeo = new THREE.CylinderGeometry(0.012, 0.02, 0.08, 8)

const BAR_BACK_X = ROOM.maxX - 0.02
const BAR_Z0 = BAR.z - BAR.len / 2
const SHELF_YS = [1.25, 1.62, 1.99]
const BOTTLES: { amber: THREE.Matrix4[]; green: THREE.Matrix4[]; clear: THREE.Matrix4[]; necks: THREE.Matrix4[] } = {
  amber: [],
  green: [],
  clear: [],
  necks: []
}
{
  const r = lcg(777)
  for (const y of SHELF_YS) {
    for (let z = BAR_Z0 + 0.2; z < BAR_Z0 + BAR.len - 0.15; z += 0.1 + r() * 0.07) {
      if (r() < 0.18) continue
      const s = 0.8 + r() * 0.45
      const m = mT(BAR_BACK_X - 0.16, y + 0.12 * s + 0.012, z).multiply(mS(1, s, 1))
      const pick = r()
      ;(pick < 0.5 ? BOTTLES.amber : pick < 0.72 ? BOTTLES.green : BOTTLES.clear).push(m)
      BOTTLES.necks.push(mT(BAR_BACK_X - 0.16, y + 0.24 * s + 0.05, z))
    }
  }
}

const FLUTE_MATS = Array.from({ length: 16 }, (_, i) =>
  mT(BAR.x - 0.315, 0.52, BAR_Z0 + 0.15 + i * ((BAR.len - 0.3) / 15)).multiply(mS(0.02, 0.9, 0.05))
)

export function StarkBar(): JSX.Element {
  const cz = BAR.z
  return (
    <group>
      {/* counter — walnut body, quartz top, brass foot rail, warm under-glow */}
      <mesh
        position={[BAR.x, 0.52, cz]}
        scale={[0.62, 1.04, BAR.len]}
        geometry={AG.unitBox}
        material={barMats.walnut}
        castShadow
        receiveShadow
      />
      <mesh
        position={[BAR.x - 0.06, 1.065, cz]}
        scale={[0.82, 0.05, BAR.len + 0.12]}
        geometry={AG.unitBox}
        material={barMats.quartz}
        castShadow
        receiveShadow
      />
      <mesh
        position={[BAR.x - 0.33, 0.9, cz]}
        scale={[0.02, 0.02, BAR.len - 0.1]}
        geometry={AG.unitBox}
        material={barMats.backlight}
      />
      <mesh
        position={[BAR.x - 0.42, 0.18, cz]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[0.035, BAR.len - 0.2, 0.035]}
        geometry={AG.cyl}
        material={barMats.brass}
      />
      {[-1, 0, 1].map((k) => (
        <mesh
          key={k}
          position={[BAR.x - 0.37, 0.18, cz + k * (BAR.len / 2 - 0.3)]}
          scale={[0.1, 0.02, 0.02]}
          geometry={AG.unitBox}
          material={barMats.brass}
        />
      ))}
      {/* vertical walnut fluting on the counter front */}
      <Inst geo={AG.unitBox} mat={barMats.walnutDark} mats={FLUTE_MATS} />
      <mesh
        position={[BAR.x - 0.9, 0.02, cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.4, BAR.len + 1.2, 1]}
        geometry={AG.unitPlane}
        material={glowMat('#ffb766', 0.16)}
      />

      {/* back bar — walnut wall panel, lit glass shelves, bottles; rides
          the right wall's cutaway */}
      <Cutaway side="right">
        <mesh
          position={[BAR_BACK_X - 0.03, 1.6, cz]}
          scale={[0.06, 3.2, BAR.len + 0.4]}
          geometry={AG.unitBox}
          material={barMats.walnutDark}
          receiveShadow
        />
        <mesh
          position={[BAR_BACK_X - 0.065, 1.62, cz]}
          scale={[0.01, 1.05, BAR.len - 0.2]}
          geometry={AG.unitBox}
          material={glowMat('#ffc47a', 0.35)}
        />
        {SHELF_YS.map((y) => (
          <group key={y}>
            <mesh
              position={[BAR_BACK_X - 0.17, y, cz]}
              scale={[0.26, 0.024, BAR.len - 0.1]}
              geometry={AG.unitBox}
              material={barMats.shelfGlass}
            />
            <mesh
              position={[BAR_BACK_X - 0.29, y - 0.014, cz]}
              scale={[0.01, 0.01, BAR.len - 0.1]}
              geometry={AG.unitBox}
              material={barMats.brass}
            />
          </group>
        ))}
        <Inst geo={bottleGeo} mat={barMats.bottleAmber} mats={BOTTLES.amber} />
        <Inst geo={bottleGeo} mat={barMats.bottleGreen} mats={BOTTLES.green} />
        <Inst geo={bottleGeo} mat={barMats.bottleClear} mats={BOTTLES.clear} />
        <Inst geo={neckGeo} mat={AM.darkMetal} mats={BOTTLES.necks} />
        {/* back counter below the shelves */}
        <mesh
          position={[BAR_BACK_X - 0.28, 0.46, cz]}
          scale={[0.5, 0.92, BAR.len]}
          geometry={AG.unitBox}
          material={barMats.walnut}
          castShadow
          receiveShadow
        />
        <mesh
          position={[BAR_BACK_X - 0.28, 0.935, cz]}
          scale={[0.54, 0.03, BAR.len + 0.04]}
          geometry={AG.unitBox}
          material={barMats.quartz}
        />
      </Cutaway>

      {/* bar stools — brass column, dark leather seat */}
      {BAR_STOOLS.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <mesh position={[0, 0.015, 0]} scale={[0.4, 0.03, 0.4]} geometry={AG.cyl} material={barMats.brass} />
          <mesh position={[0, 0.39, 0]} scale={[0.06, 0.75, 0.06]} geometry={AG.cyl} material={barMats.brass} />
          <mesh
            position={[0, 0.28, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[0.17, 0.17, 1.2]}
            geometry={AG.ring}
            material={barMats.brass}
          />
          <mesh
            position={[0, 0.79, 0]}
            scale={[0.4, 0.07, 0.4]}
            geometry={AG.cyl}
            material={barMats.stoolSeat}
            castShadow
          />
        </group>
      ))}
    </group>
  )
}

/* ══ lounge ══════════════════════════════════════════════════════════ */
const loungeMats = {
  sofa: new THREE.MeshStandardMaterial({ color: P.sofaBase, roughness: 0.9 }),
  cushion: new THREE.MeshStandardMaterial({ color: P.sofaCushion, roughness: 0.95 }),
  throwPillow: new THREE.MeshStandardMaterial({ color: '#8c2a24', roughness: 0.9 }),
  pillowGold: new THREE.MeshStandardMaterial({ color: '#c49a45', roughness: 0.85 }),
  rug: new THREE.MeshStandardMaterial({ color: P.rug, roughness: 1 }),
  rugBorder: new THREE.MeshStandardMaterial({ color: '#4a515d', roughness: 1 }),
  tableGlass: new THREE.MeshPhysicalMaterial({ color: '#1a1e24', roughness: 0.1, clearcoat: 1, metalness: 0.2 }),
  lampShade: new THREE.MeshBasicMaterial({ color: '#ffe3b8', toneMapped: false }),
  leaf: new THREE.MeshStandardMaterial({ color: P.plant, roughness: 0.8 }),
  pot: new THREE.MeshStandardMaterial({ color: '#e7e9ec', roughness: 0.6 })
}
const lampHalo = new THREE.SpriteMaterial({
  map: glowTexture(),
  color: '#ffcf94',
  transparent: true,
  opacity: 0.45,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const LG = {
  seat: upholsteredBox(1.05, 0.16, 0.74),
  back: upholsteredBox(1.05, 0.42, 0.18),
  arm: beveledBox(0.2, 0.52, 0.86, 0.06),
  base: beveledBox(1, 0.22, 0.86, 0.04),
  pillow: upholsteredBox(0.36, 0.34, 0.1)
} as const

function Sofa({ seats }: { seats: number }): JSX.Element {
  const w = seats * 1.05
  return (
    <group>
      <mesh
        position={[0, 0.17, 0]}
        scale={[w + 0.1, 1, 1]}
        geometry={LG.base}
        material={loungeMats.sofa}
        castShadow
        receiveShadow
      />
      {Array.from({ length: seats }, (_, i) => {
        const x = (i - (seats - 1) / 2) * 1.05
        return (
          <group key={i}>
            <mesh position={[x, 0.36, 0.04]} geometry={LG.seat} material={loungeMats.cushion} castShadow />
            <mesh
              position={[x, 0.62, -0.33]}
              rotation={[-0.12, 0, 0]}
              geometry={LG.back}
              material={loungeMats.cushion}
              castShadow
            />
          </group>
        )
      })}
      <mesh
        position={[0, 0.5, -0.4]}
        scale={[w + 0.1, 0.62, 0.1]}
        geometry={AG.unitBox}
        material={loungeMats.sofa}
        castShadow
      />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 + 0.1), 0.3, 0]} geometry={LG.arm} material={loungeMats.sofa} castShadow />
      ))}
    </group>
  )
}

function Armchair(): JSX.Element {
  return (
    <group>
      <mesh
        position={[0, 0.17, 0]}
        scale={[0.95, 1, 1]}
        geometry={LG.base}
        material={loungeMats.sofa}
        castShadow
        receiveShadow
      />
      <mesh
        position={[0, 0.36, 0.04]}
        scale={[0.8, 1, 1]}
        geometry={LG.seat}
        material={loungeMats.cushion}
        castShadow
      />
      <mesh
        position={[0, 0.62, -0.33]}
        rotation={[-0.14, 0, 0]}
        scale={[0.8, 1, 1]}
        geometry={LG.back}
        material={loungeMats.cushion}
        castShadow
      />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.52, 0.3, 0]} geometry={LG.arm} material={loungeMats.sofa} castShadow />
      ))}
    </group>
  )
}

/* slim wall display over the sofa — the lounge's news feed */
const TV = { x: ROOM.maxX - 0.03, y: 2.05, z: SOFA.z, w: 2.3, h: 1.28 } as const

export function LoungeSet(): JSX.Element {
  const ui = uiTextures()
  return (
    <group>
      <Cutaway side="right">
        <group position={[TV.x, TV.y, TV.z]} rotation={[0, -Math.PI / 2, 0]}>
          <mesh
            position={[0, 0, 0.025]}
            scale={[TV.w, TV.h, 0.05]}
            geometry={AG.unitBox}
            material={AM.darkMetal}
            castShadow
          />
          <mesh
            position={[0, 0, 0.051]}
            scale={[TV.w - 0.08, TV.h - 0.08, 1]}
            geometry={AG.unitPlane}
            material={AM.screenDark}
          />
          <mesh position={[-0.28, 0.08, 0.053]} scale={[1.55, 0.9, 1]} geometry={AG.unitPlane} material={missionMap} />
          <mesh
            position={[0.76, 0.2, 0.053]}
            scale={[0.6, 0.36, 1]}
            geometry={AG.unitPlane}
            material={holoPaneMat(ui[5], 'work', 'ui5')}
          />
          <mesh
            position={[0.76, -0.24, 0.053]}
            scale={[0.6, 0.36, 1]}
            geometry={AG.unitPlane}
            material={holoPaneMat(ui[2], 'work', 'ui2')}
          />
          <mesh
            position={[0, -0.52, 0.053]}
            scale={[TV.w - 0.2, 0.08, 1]}
            geometry={AG.unitPlane}
            material={holoPaneMat(ui[0], 'wait', 'ui0')}
          />
          <mesh
            position={[0, 0, -0.004]}
            scale={[TV.w * 1.9, TV.h * 2.2, 1]}
            geometry={AG.unitPlane}
            material={glowMat(P.holoCyan, 0.07)}
          />
        </group>
      </Cutaway>
      {/* rug */}
      <mesh
        position={[LOUNGE_RUG.x, 0.006, LOUNGE_RUG.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[LOUNGE_RUG.w + 0.16, LOUNGE_RUG.d + 0.16, 1]}
        geometry={AG.unitPlane}
        material={loungeMats.rugBorder}
        receiveShadow
      />
      <mesh
        position={[LOUNGE_RUG.x, 0.008, LOUNGE_RUG.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[LOUNGE_RUG.w, LOUNGE_RUG.d, 1]}
        geometry={AG.unitPlane}
        material={loungeMats.rug}
        receiveShadow
      />

      <group position={[SOFA.x, 0, SOFA.z]} rotation={[0, SOFA.rotY, 0]}>
        <Sofa seats={3} />
        {/* throw pillows — iron red + gold */}
        <mesh
          position={[-1.42, 0.62, -0.18]}
          rotation={[-0.2, 0.3, 0.1]}
          geometry={LG.pillow}
          material={loungeMats.throwPillow}
          castShadow
        />
        <mesh
          position={[1.42, 0.62, -0.18]}
          rotation={[-0.2, -0.3, -0.1]}
          geometry={LG.pillow}
          material={loungeMats.pillowGold}
          castShadow
        />
      </group>
      {ARMCHAIRS.map((a, i) => (
        <group key={i} position={[a.x, 0, a.z]} rotation={[0, a.rotY, 0]}>
          <Armchair />
        </group>
      ))}

      {/* round coffee table — glass-black top on a brass drum */}
      <group position={[COFFEE_TABLE.x, 0, COFFEE_TABLE.z]}>
        <mesh position={[0, 0.2, 0]} scale={[0.7, 0.36, 0.7]} geometry={AG.cylHi} material={barMats.brass} castShadow />
        <mesh
          position={[0, 0.4, 0]}
          scale={[1.2, 0.04, 1.2]}
          geometry={AG.cylHi}
          material={loungeMats.tableGlass}
          castShadow
          receiveShadow
        />
        {/* a holo-tablet and a coffee cup on top */}
        <mesh
          position={[0.18, 0.43, -0.1]}
          rotation={[0, 0.4, 0]}
          scale={[0.26, 0.015, 0.18]}
          geometry={AG.unitBox}
          material={AM.darkMetal}
        />
        <mesh
          position={[0.18, 0.44, -0.1]}
          rotation={[-Math.PI / 2, 0, -0.4]}
          scale={[0.22, 0.14, 1]}
          geometry={AG.unitPlane}
          material={AM.holoDeep}
        />
        <mesh position={[-0.2, 0.46, 0.14]} scale={[0.08, 0.1, 0.08]} geometry={AG.cyl} material={AM.whiteGloss} />
      </group>

      {/* arc floor lamp over the sofa end + a tall planter */}
      <group position={[7.8, 0, 2.85]}>
        <mesh position={[0, 0.02, 0]} scale={[0.34, 0.04, 0.34]} geometry={AG.cyl} material={AM.graphite} />
        <mesh position={[0, 0.8, 0]} scale={[0.03, 1.6, 0.03]} geometry={AG.cyl} material={barMats.brass} />
        {/* glowing globe shade — reads as a lamp from any angle */}
        <mesh position={[0, 1.66, 0]} scale={0.3} geometry={AG.sphere} material={loungeMats.lampShade} />
        <sprite position={[0, 1.66, 0]} scale={1.1} material={lampHalo} />
        <pointLight position={[-0.4, 1.5, -0.6]} color="#ffd6a0" intensity={2.2} distance={4.5} decay={2} />
      </group>
      <group position={[7.8, 0, 3.8]}>
        <mesh position={[0, 0.3, 0]} scale={[0.5, 0.6, 0.5]} geometry={AG.cyl} material={loungeMats.pot} castShadow />
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * 0.14, 0.95 + (i % 3) * 0.12, Math.sin(a) * 0.14]}
              rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]}
              scale={[0.2, 0.7, 0.08]}
              geometry={AG.sphere}
              material={loungeMats.leaf}
              castShadow
            />
          )
        })}
      </group>
    </group>
  )
}

/* ══ mission wall — big holo screen on the left wall ═════════════════ */
const missionMap = new THREE.MeshBasicMaterial({
  map: globeTexture(),
  color: new THREE.Color(P.holoCyan).multiplyScalar(1.3),
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
})
const MISSION_SIDE = [0.42, -0.14, -0.62] as const

export function MissionWall(): JSX.Element {
  const ui = uiTextures()
  return (
    <Cutaway side="left">
      <group position={[MISSION_WALL.x, MISSION_WALL.y, MISSION_WALL.z]} rotation={[0, Math.PI / 2, 0]}>
        {/* wash on the wall around the screen */}
        <mesh
          position={[0, 0, 0.002]}
          scale={[5.6, 3.4, 1]}
          geometry={AG.unitPlane}
          material={glowMat(P.holoCyan, 0.1)}
        />
        {/* bezel + dark glass */}
        <mesh
          position={[0, 0, 0.03]}
          scale={[3.7, 2.06, 0.06]}
          geometry={AG.unitBox}
          material={AM.darkMetal}
          castShadow
        />
        <mesh position={[0, 0, 0.061]} scale={[3.56, 1.92, 1]} geometry={AG.unitPlane} material={AM.screenDark} />
        {/* world map + telemetry column */}
        <mesh position={[-0.45, 0.02, 0.064]} scale={[2.5, 1.25, 1]} geometry={AG.unitPlane} material={missionMap} />
        {MISSION_SIDE.map((y, i) => (
          <mesh
            key={i}
            position={[1.22, y, 0.064]}
            scale={[0.95, i === 0 ? 0.62 : 0.44, 1]}
            geometry={AG.unitPlane}
            material={holoPaneMat(ui[(i * 2 + 1) % UI_VARIANTS], 'work', `ui${(i * 2 + 1) % UI_VARIANTS}`)}
          />
        ))}
        {/* lit sill under the screen */}
        <mesh position={[0, -1.08, 0.05]} scale={[3.5, 0.016, 0.02]} geometry={AG.unitBox} material={AM.holoSolid} />
      </group>
    </Cutaway>
  )
}
