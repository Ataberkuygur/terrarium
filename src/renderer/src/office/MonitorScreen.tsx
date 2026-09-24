import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { G, M } from './shared'
import type { AgentDomain } from '@shared/types'

const W = 256
const H = 160

/* screen content is keyed to the desk's domain zone — each trade's monitor
 * shows its own artifact: frontend gets a landing mock, backend a terminal,
 * marketing a chart, design a swatch board, research/legal documents. */

function drawContent(
  ctx: CanvasRenderingContext2D,
  domain: AgentDomain,
  hue: number,
  t: number,
  seed: number
) {
  if (domain === 'frontend') {
    // ── mini landing page in a browser window ──
    ctx.fillStyle = '#f4f6fb'
    ctx.fillRect(0, 0, W, H)
    // browser chrome — traffic dots + url pill
    ctx.fillStyle = '#dde2ea'
    ctx.fillRect(0, 0, W, 12)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#e5484d', '#f5a524', '#46a758'][i]
      ctx.beginPath()
      ctx.arc(8 + i * 8, 6, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(34, 2.5, 120, 7)
    ctx.fillStyle = '#9aa4b4'
    ctx.fillRect(38, 5, 46, 2)
    // nav bar
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 12, W, 14)
    ctx.fillStyle = `hsl(${hue} 70% 55%)`
    ctx.beginPath()
    ctx.arc(11, 19, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#c4cad6'
    for (let i = 0; i < 3; i++) ctx.fillRect(170 + i * 24, 17, 18, 4)
    ctx.fillStyle = `hsl(${hue} 70% 55%)`
    ctx.fillRect(226, 14, 24, 9)
    // hero headline + copy
    ctx.fillStyle = '#2a2e38'
    ctx.fillRect(18, 36, 120, 9)
    ctx.fillRect(18, 50, 88, 9)
    ctx.fillStyle = '#aab2c0'
    ctx.fillRect(18, 68, 104, 5)
    ctx.fillRect(18, 78, 80, 5)
    // CTA button — pulses gently
    const pulse = 0.75 + Math.sin(t * 2 + seed) * 0.25
    ctx.fillStyle = `hsl(${hue} 70% ${45 + pulse * 15}%)`
    ctx.fillRect(18, 94, 44, 14)
    // hero art block + feature cards
    ctx.fillStyle = `hsl(${hue} 65% 85%)`
    ctx.fillRect(160, 34, 78, 74)
    ctx.fillStyle = `hsl(${(hue + 40) % 360} 60% 70%)`
    ctx.beginPath()
    ctx.arc(199, 71, 20, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(18 + i * 76, 122, 66, 30)
      ctx.fillStyle = `hsl(${(hue + i * 50) % 360} 60% 72%)`
      ctx.fillRect(23 + i * 76, 127, 14, 14)
      ctx.fillStyle = '#c4cad6'
      ctx.fillRect(42 + i * 76, 128, 36, 4)
      ctx.fillRect(42 + i * 76, 137, 28, 4)
    }
    return
  }

  if (domain === 'backend') {
    // ── terminal — green on near-black, tmux-style status bar ──
    ctx.fillStyle = '#0b120e'
    ctx.fillRect(0, 0, W, H)
    // title bar — window dots + session label
    ctx.fillStyle = '#16241c'
    ctx.fillRect(0, 0, W, 12)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#3f6b4f'
      ctx.beginPath()
      ctx.arc(8 + i * 7, 6, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#3f6b4f'
    ctx.fillRect(30, 4, 46, 4)
    // scrollback — a few dim lines above the live area
    for (let i = 0; i < 10; i++) {
      const indent = ((i * seed) % 4) * 10
      const len = 40 + ((Math.sin(i * 13.7 + seed * 5.3) + 1) / 2) * 140
      const kind = (i + Math.floor(seed)) % 7
      ctx.fillStyle =
        kind === 0 ? '#e0b34c' : kind === 1 ? '#7fd6a4' : kind === 2 ? '#4a6b58' : '#3fae6a'
      const y = 20 + i * 12
      // prompt tick on some lines
      if (i % 4 === 0) {
        ctx.fillStyle = '#57d98a'
        ctx.fillText('›', 8, y + 6)
      }
      ctx.fillRect(18 + indent, y, len, 5)
    }
    // steady block cursor
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = '#57d98a'
      ctx.fillRect(18 + ((Math.floor(t) * seed) % 6) * 12, 136, 7, 9)
    }
    // status bar — session/host/CPU ticks
    ctx.fillStyle = '#123626'
    ctx.fillRect(0, H - 10, W, 10)
    ctx.fillStyle = '#7fd6a4'
    ctx.fillRect(6, H - 6, 24, 3)
    ctx.fillStyle = '#3fae6a'
    ctx.fillRect(36, H - 6, 14, 3)
    ctx.fillStyle = '#2c6b4a'
    ctx.fillRect(W - 52, H - 6, 46, 3)
    // CPU meter — jumps with t
    const cpu = 0.3 + ((Math.sin(t * 1.7 + seed) + 1) / 2) * 0.5
    ctx.fillStyle = '#7fd6a4'
    ctx.fillRect(W - 50, H - 6, 42 * cpu, 3)
    return
  }

  if (domain === 'marketing') {
    // ── campaign dashboard — headline + bar chart + sparkline ──
    ctx.fillStyle = '#fdf8ef'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#2e2a24'
    ctx.fillRect(16, 14, 110, 11)
    ctx.fillRect(16, 30, 70, 7)
    ctx.fillStyle = `hsl(${hue} 70% 55%)`
    ctx.fillRect(180, 14, 60, 22)
    // bar chart
    for (let i = 0; i < 5; i++) {
      const bh = 22 + ((Math.sin(seed * 3 + i * 1.9) + 1) / 2) * 48
      ctx.fillStyle = `hsl(${(hue + i * 14) % 360} 65% ${58 - i * 3}%)`
      ctx.fillRect(20 + i * 30, 128 - bh, 20, bh)
    }
    ctx.fillStyle = '#d9cfbd'
    ctx.fillRect(14, 128, 160, 2)
    // sparkline
    ctx.strokeStyle = `hsl(${hue} 75% 50%)`
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i <= 8; i++) {
      const y = 70 - Math.sin(i * 1.4 + seed + t * 0.4) * 12 - i * 1.5
      if (i === 0) ctx.moveTo(190, y)
      else ctx.lineTo(190 + i * 7, y)
    }
    ctx.stroke()
    return
  }

  if (domain === 'design') {
    // ── swatch grid + artboard ──
    ctx.fillStyle = '#14161c'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#1e212a'
    ctx.fillRect(0, 0, W, 14)
    ctx.fillStyle = `hsl(${hue} 80% 65%)`
    ctx.beginPath()
    ctx.arc(8, 7, 3, 0, Math.PI * 2)
    ctx.fill()
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `hsl(${(hue + i * 40) % 360} 72% 62%)`
      ctx.fillRect(12 + i * 46, 24, 38, 24)
      ctx.fillStyle = '#3a3f4c'
      ctx.fillRect(12 + i * 46, 52, 38, 4)
    }
    ctx.strokeStyle = '#7a8094'
    ctx.strokeRect(12, 64, 110, 80)
    ctx.beginPath()
    ctx.arc(67, 104, 26, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#5a6070'
    ctx.fillRect(140, 64, 100, 8)
    ctx.fillRect(140, 80, 80, 8)
    ctx.fillRect(140, 96, 92, 8)
    ctx.fillRect(140, 112, 64, 8)
    return
  }

  if (domain === 'research') {
    // ── document w/ moving highlight ──
    ctx.fillStyle = '#10131a'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#1c2029'
    ctx.fillRect(0, 0, W, 14)
    for (let i = 0; i < 9; i++) {
      const w = 150 + Math.sin(seed * 7 + i * 3.1) * 60
      ctx.fillStyle = i % 3 === 0 ? '#6b7280' : '#4d5462'
      ctx.fillRect(16, 26 + i * 14, w, 6)
    }
    const hy = 26 + (Math.floor(t * 0.8 + seed) % 9) * 14
    ctx.fillStyle = `hsla(${hue} 85% 62% / 0.35)`
    ctx.fillRect(14, hy - 1, 200, 8)
    return
  }

  if (domain === 'legal') {
    // ── contract page — parchment, two columns, red seal ──
    ctx.fillStyle = '#f3eee2'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#3c372e'
    ctx.fillRect(20, 14, 90, 8)
    ctx.fillStyle = '#a39a86'
    for (let i = 0; i < 11; i++) {
      const wl = 88 + Math.sin(seed * 5 + i * 2.3) * 14
      ctx.fillRect(20, 34 + i * 11, wl, 4)
      const wr = 88 + Math.cos(seed * 4 + i * 1.7) * 14
      ctx.fillRect(140, 34 + i * 11, wr, 4)
    }
    // seal
    ctx.strokeStyle = '#a33b32'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(216, 128, 14, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(216, 128, 9, 0, Math.PI * 2)
    ctx.stroke()
    // signature squiggle
    ctx.strokeStyle = '#4a463c'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(20, 146)
    for (let i = 0; i < 8; i++) ctx.lineTo(26 + i * 8, 146 - Math.sin(i * 2 + seed) * 5)
    ctx.stroke()
    return
  }

  // ── general / fallback — dark IDE: rail, tabs, gutter, minimap, status ──
  ctx.fillStyle = '#0e1118'
  ctx.fillRect(0, 0, W, H)
  // activity rail
  ctx.fillStyle = '#151923'
  ctx.fillRect(0, 0, 12, H)
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i === 0 ? `hsl(${hue} 80% 65%)` : '#3a4152'
    ctx.fillRect(4, 8 + i * 12, 4, 4)
  }
  // file tabs — active one carries the agent hue
  ctx.fillStyle = '#171b26'
  ctx.fillRect(12, 0, W - 12, 14)
  ctx.fillStyle = '#202635'
  ctx.fillRect(14, 2, 36, 12)
  ctx.fillStyle = `hsl(${hue} 80% 65%)`
  ctx.fillRect(14, 13, 36, 1)
  ctx.fillStyle = '#39404f'
  ctx.fillRect(54, 4, 30, 8)
  // line-number gutter
  ctx.fillStyle = '#12161f'
  ctx.fillRect(12, 14, 14, H - 23)
  ctx.fillStyle = '#2b3242'
  for (let i = 0; i < 11; i++) ctx.fillRect(15, 19 + i * 12, 8, 2)
  // code lines — syntax-tinted bars, the active line highlighted
  const active = Math.floor(t * 0.9 + seed) % 11
  for (let i = 0; i < 11; i++) {
    const y = 18 + i * 12
    if (i === active) {
      ctx.fillStyle = '#1b2233'
      ctx.fillRect(26, y - 2, 198, 11)
    }
    const indent = ((i * 7 + Math.floor(seed)) % 5) * 9
    const len = 30 + ((Math.sin(i * 12.3 + seed * 7.1) + 1) / 2) * 120
    const kind = (i + Math.floor(seed)) % 6
    ctx.fillStyle =
      kind === 0
        ? `hsl(${hue} 85% 70%)`
        : kind === 1
          ? '#7aa8f0'
          : kind === 2
            ? '#62c98b'
            : kind === 3
              ? '#4a5163'
              : '#9aa4b8'
    ctx.fillRect(30 + indent, y, len, 5)
    if (kind === 1 || kind === 4) {
      ctx.fillStyle = '#5a6274'
      ctx.fillRect(30 + indent + len + 4, y, 14 + ((i * seed) % 3) * 8, 5)
    }
  }
  // caret at the end of the active line — blinks
  if (Math.floor(t * 2) % 2 === 0) {
    const indent = ((active * 7 + Math.floor(seed)) % 5) * 9
    const len = 30 + ((Math.sin(active * 12.3 + seed * 7.1) + 1) / 2) * 120
    ctx.fillStyle = '#e8ecf4'
    ctx.fillRect(32 + indent + len, 16 + active * 12, 5, 9)
  }
  // minimap — compressed speckle down the right edge + viewport box
  ctx.fillStyle = '#10141d'
  ctx.fillRect(226, 14, 30, H - 23)
  for (let i = 0; i < 26; i++) {
    const len = 4 + ((Math.sin(i * 9.7 + seed * 3) + 1) / 2) * 20
    ctx.fillStyle = i % 5 === 0 ? `hsla(${hue} 70% 60% / 0.7)` : '#39404f'
    ctx.fillRect(228, 18 + i * 5, len, 2)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.strokeRect(226.5, 30 + (Math.floor(t * 0.3) % 40), 29, 26)
  // status bar — cyan accent, matching the desk's monitor hue
  ctx.fillStyle = '#0c3a44'
  ctx.fillRect(0, H - 9, W, 9)
  ctx.fillStyle = '#7dd6e8'
  ctx.fillRect(6, H - 6, 26, 3)
  ctx.fillStyle = '#3f7d8c'
  ctx.fillRect(38, H - 6, 18, 3)
  ctx.fillRect(60, H - 6, 12, 3)
  ctx.fillStyle = '#2a5b66'
  ctx.fillRect(W - 46, H - 6, 40, 3)
}

/* glass pass over every screen — scanlines + corner vignette + a soft
 * diagonal glare, ~60 cheap rects baked into the 2Hz redraw */
function fx(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.26)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W * 0.16, -H * 0.15)
  ctx.rotate(0.5)
  const gl = ctx.createLinearGradient(0, 0, 56, 0)
  gl.addColorStop(0, 'rgba(255,255,255,0)')
  gl.addColorStop(0.5, 'rgba(255,255,255,0.045)')
  gl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gl
  ctx.fillRect(0, 0, 56, H * 1.8)
  ctx.restore()
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  domain: AgentDomain,
  hue: number,
  t: number,
  seed: number
) {
  drawContent(ctx, domain, hue, t, seed)
  fx(ctx)
}

export function MonitorScreen({
  domain,
  hue,
  on,
  seed = 1,
  geometry = G.screen,
  offMaterial = M.screenOff
}: {
  domain: AgentDomain
  hue: number
  on: boolean
  seed?: number
  /** screen plane (default: the shared 0.62 × 0.4 panel) */
  geometry?: THREE.BufferGeometry
  /** material shown while the screen is off */
  offMaterial?: THREE.Material
}) {
  // One canvas + one CanvasTexture per screen, allocated on mount.
  // needsUpdate re-uploads the existing texture — no re-alloc per frame.
  const { tex, ctx } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    drawScreen(ctx, domain, hue, 1.7, seed)
    return { tex, ctx }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const meshRef = useRef<THREE.Mesh>(null)
  const acc = useRef(0)
  // reused scratch objects — no per-frame allocation
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const projScreen = useMemo(() => new THREE.Matrix4(), [])

  useFrame((state, dt) => {
    if (!on) {
      // screen off: zero canvas/texture work
      acc.current = 0
      return
    }
    acc.current += dt
    if (acc.current <= 0.5) return
    acc.current = 0

    // skip the canvas redraw + texture upload when the screen is
    // outside the view frustum (e.g. camera focused on another desk)
    const mesh = meshRef.current
    if (mesh) {
      projScreen.multiplyMatrices(
        state.camera.projectionMatrix,
        state.camera.matrixWorldInverse
      )
      frustum.setFromProjectionMatrix(projScreen)
      if (!frustum.intersectsObject(mesh)) return
    }

    drawScreen(ctx, domain, hue, performance.now() / 1000, seed)
    tex.needsUpdate = true
  })

  if (!on) {
    return <mesh ref={meshRef} geometry={geometry} material={offMaterial} />
  }

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}
