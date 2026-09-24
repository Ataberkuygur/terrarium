import * as THREE from 'three'

/**
 * Procedural canvas textures — lazy singletons.
 *
 * Each texture paints once on first use, then every consumer shares the same
 * CanvasTexture (one GPU upload per texture for the whole scene). All
 * randomness comes from the LCG — no Math.random, so the office looks
 * identical every launch (AGENTS.md determinism rule).
 */

function lcg(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function toTex(c: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* walnut — painted in the final hue; materials using it keep color #fff so
 * map output IS the wood color. Streaks run along u (the desk's long axis). */
let _wood: THREE.Texture | null = null
export function woodTex() {
  if (_wood) return _wood
  const [c, g] = canvas(256, 256)
  const rnd = lcg(53)
  g.fillStyle = '#8a6a4c'
  g.fillRect(0, 0, 256, 256)
  // long grain streaks — alternating darker heartwood / lighter sapwood
  for (let i = 0; i < 52; i++) {
    const y = rnd() * 256
    const h = 1 + rnd() * 3.5
    const len = 30 + rnd() * 150
    const x = rnd() * 220 - 40
    g.fillStyle =
      rnd() < 0.55 ? `rgba(74,48,28,${0.1 + rnd() * 0.14})` : `rgba(226,196,152,${0.08 + rnd() * 0.1})`
    g.fillRect(x, y, len, h)
  }
  // fine grain hairlines
  g.fillStyle = 'rgba(64,40,22,0.12)'
  for (let i = 0; i < 110; i++) {
    const y = rnd() * 256
    g.fillRect(rnd() * 60, y, 120 + rnd() * 136, 1)
  }
  // sparse knots
  for (let i = 0; i < 3; i++) {
    const x = 20 + rnd() * 216
    const y = 20 + rnd() * 216
    const r = 6 + rnd() * 9
    const gr = g.createRadialGradient(x, y, 1, x, y, r)
    gr.addColorStop(0, 'rgba(58,36,20,0.5)')
    gr.addColorStop(0.6, 'rgba(74,48,28,0.2)')
    gr.addColorStop(1, 'rgba(74,48,28,0)')
    g.fillStyle = gr
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  _wood = toTex(c)
  return _wood
}

/* plaster — tileable near-white speckle. Per-pixel noise has no seams; the
 * low-freq mottling uses wrapped sin products so it tiles too. One canvas,
 * two CanvasTexture wrappers: sRGB for the color map, linear for the
 * bump/roughness data channels (data maps must not be sRGB-decoded). */
let _plasterC: HTMLCanvasElement | null = null
let _plasterMap: THREE.Texture | null = null
let _plasterData: THREE.Texture | null = null
function plasterCanvas() {
  if (_plasterC) return _plasterC
  const [c, g] = canvas(256, 256)
  const img = g.createImageData(256, 256)
  const d = img.data
  const rnd = lcg(91)
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4
      const low =
        Math.sin((x / 256) * Math.PI * 6) * Math.cos((y / 256) * Math.PI * 4) * 4 +
        Math.sin(((x + y) / 256) * Math.PI * 6) * 3
      const v = 236 + low + (rnd() - 0.5) * 13
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v))
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  _plasterC = c
  return c
}
export function plasterTex() {
  if (!_plasterMap) {
    _plasterMap = toTex(plasterCanvas())
    _plasterMap.wrapS = _plasterMap.wrapT = THREE.RepeatWrapping
    _plasterMap.repeat.set(5, 1.5) // ~3.2m x 2.3m per tile on the walls
  }
  return _plasterMap
}
export function plasterDataTex() {
  if (!_plasterData) {
    _plasterData = new THREE.CanvasTexture(plasterCanvas()) // linear — data use
    _plasterData.wrapS = _plasterData.wrapT = THREE.RepeatWrapping
    _plasterData.repeat.set(5, 1.5)
  }
  return _plasterData
}

/* fabric — fine tileable grain used ONLY as a bumpMap (rugs, couch, desk
 * mat): the gray value becomes micro-relief, tint stays on the material.
 * Linear colorSpace — it's a data map, not a color map. */
let _fabric: THREE.Texture | null = null
export function fabricTex() {
  if (_fabric) return _fabric
  const [c, g] = canvas(128, 128)
  const img = g.createImageData(128, 128)
  const d = img.data
  const rnd = lcg(37)
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4
      // woven feel: speckle modulated by faint warp/weft stripes
      const weave = ((x + y) % 2) * 6
      const v = 118 + weave + (rnd() - 0.5) * 44
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v))
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  _fabric = new THREE.CanvasTexture(c)
  _fabric.wrapS = _fabric.wrapT = THREE.RepeatWrapping
  _fabric.repeat.set(6, 6)
  return _fabric
}

/* keyboard — keycap grid painted for the desk keyboard's top face. Box
 * geometry maps the whole texture per face; only the top is visible. */
let _kbd: THREE.Texture | null = null
export function keyboardTex() {
  if (_kbd) return _kbd
  const [c, g] = canvas(128, 64)
  const rnd = lcg(23)
  g.fillStyle = '#16181d'
  g.fillRect(0, 0, 128, 64)
  const rows = [13, 13, 12, 11] // key counts per row
  for (let r = 0; r < 4; r++) {
    const n = rows[r]
    const kw = (128 - 8) / n
    for (let i = 0; i < n; i++) {
      const l = 15 + rnd() * 10
      g.fillStyle = `hsl(222 9% ${l}%)`
      g.fillRect(4 + i * kw + 1, 4 + r * 12, kw - 2, 9)
    }
  }
  // bottom row — modifier keys + spacebar
  g.fillStyle = 'hsl(222 9% 17%)'
  g.fillRect(4, 52, 16, 9)
  g.fillRect(22, 52, 12, 9)
  g.fillStyle = 'hsl(222 9% 21%)'
  g.fillRect(36, 52, 56, 9) // spacebar
  g.fillStyle = 'hsl(222 9% 17%)'
  g.fillRect(94, 52, 12, 9)
  g.fillRect(108, 52, 16, 9)
  _kbd = toTex(c)
  return _kbd
}

/* light shaft — warm white whose alpha falls off down the beam and at the
 * lateral edges; additive material turns it into a fake volumetric wedge. */
let _shaft: THREE.Texture | null = null
export function shaftTex() {
  if (_shaft) return _shaft
  const [c, g] = canvas(64, 256)
  const v = g.createLinearGradient(0, 0, 0, 256)
  v.addColorStop(0, 'rgba(255,244,222,0.95)')
  v.addColorStop(0.45, 'rgba(255,238,205,0.42)')
  v.addColorStop(1, 'rgba(255,238,205,0)')
  g.fillStyle = v
  g.fillRect(0, 0, 64, 256)
  // soften the side edges
  g.globalCompositeOperation = 'destination-in'
  const h = g.createLinearGradient(0, 0, 64, 0)
  h.addColorStop(0, 'rgba(0,0,0,0)')
  h.addColorStop(0.3, 'rgba(0,0,0,1)')
  h.addColorStop(0.7, 'rgba(0,0,0,1)')
  h.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = h
  g.fillRect(0, 0, 64, 256)
  _shaft = toTex(c)
  return _shaft
}

/* ══ Loft v2 textures ════════════════════════════════════════════════════ */

/* light honey oak — furniture + desk tops. Painted in the final hue (white
 * material tint), grain runs along u. */
let _oak: THREE.Texture | null = null
export function oakTex() {
  if (_oak) return _oak
  const [c, g] = canvas(512, 256)
  const rnd = lcg(311)
  g.fillStyle = '#d4b186'
  g.fillRect(0, 0, 512, 256)
  // broad tonal bands (flat-sawn cathedral hint)
  for (let i = 0; i < 14; i++) {
    const y = rnd() * 256
    const h = 8 + rnd() * 26
    g.fillStyle =
      rnd() < 0.5
        ? `rgba(160,112,66,${0.06 + rnd() * 0.07})`
        : `rgba(240,214,176,${0.08 + rnd() * 0.08})`
    g.fillRect(0, y, 512, h)
  }
  // grain hairlines
  for (let i = 0; i < 240; i++) {
    const y = rnd() * 256
    const x = rnd() * 512
    const len = 60 + rnd() * 320
    g.fillStyle = `rgba(122,82,44,${0.06 + rnd() * 0.12})`
    g.fillRect(x - len / 2, y, len, rnd() < 0.8 ? 1 : 2)
  }
  // flecks (oak rays)
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(246,226,190,${0.18 + rnd() * 0.2})`
    g.fillRect(rnd() * 512, rnd() * 256, 3 + rnd() * 6, 1)
  }
  _oak = toTex(c)
  _oak.wrapS = _oak.wrapT = THREE.RepeatWrapping
  return _oak
}

/* exposed brick — running bond, per-brick tone jitter, recessed mortar.
 * 1 tile = 8 courses × 2 bricks. Color map (sRGB) + a matching linear
 * height map for bump. */
let _brickC: HTMLCanvasElement | null = null
let _brickH: HTMLCanvasElement | null = null
function brickCanvases() {
  if (_brickC && _brickH) return [_brickC, _brickH] as const
  const S = 512
  const [c, g] = canvas(S, S)
  const [hc, hg] = canvas(S, S)
  const rnd = lcg(733)
  const rows = 8
  const rh = S / rows
  const bw = S / 2
  const m = 5 // mortar px
  g.fillStyle = '#c9b6a0'
  g.fillRect(0, 0, S, S)
  hg.fillStyle = '#3a3a3a'
  hg.fillRect(0, 0, S, S)
  const tones = ['#a4553d', '#9a4e38', '#ad6146', '#8f4a36', '#b36a4d', '#a85a3f', '#94503d', '#b8735a']
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : bw / 2
    for (let k = -1; k < 3; k++) {
      const x = k * bw + off
      const y = r * rh
      g.fillStyle = tones[Math.floor(rnd() * tones.length)]
      g.fillRect(x + m / 2, y + m / 2, bw - m, rh - m)
      // soot / limewash variation
      const gr = g.createLinearGradient(x, y, x + bw, y + rh)
      gr.addColorStop(0, `rgba(60,30,20,${rnd() * 0.18})`)
      gr.addColorStop(1, `rgba(255,220,190,${rnd() * 0.12})`)
      g.fillStyle = gr
      g.fillRect(x + m / 2, y + m / 2, bw - m, rh - m)
      // pitting speckle
      for (let p = 0; p < 40; p++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '50,25,15' : '230,200,170'},${0.1 + rnd() * 0.2})`
        g.fillRect(x + m + rnd() * (bw - 2 * m), y + m + rnd() * (rh - 2 * m), 2, 2)
      }
      const hv = Math.round(200 + rnd() * 30)
      hg.fillStyle = `rgb(${hv},${hv},${hv})`
      hg.fillRect(x + m / 2 + 1, y + m / 2 + 1, bw - m - 2, rh - m - 2)
    }
  }
  _brickC = c
  _brickH = hc
  return [c, hc] as const
}
const _brickTex = new Map<string, THREE.Texture>()
/** brick color (`'map'`) or bump (`'bump'`) — UVs are world meters / tile */
export function brickTex(kind: 'map' | 'bump') {
  const hit = _brickTex.get(kind)
  if (hit) return hit
  const [c, hc] = brickCanvases()
  const t = kind === 'map' ? toTex(c) : new THREE.CanvasTexture(hc)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  _brickTex.set(kind, t)
  return t
}

/* afternoon city seen through the back windows — warm low sky, soft clouds,
 * three depth layers of towers with lit/unlit window grids, a tree line. */
let _sky: THREE.Texture | null = null
export function skylineTex() {
  if (_sky) return _sky
  const W = 1024
  const H = 512
  const [c, g] = canvas(W, H)
  const rnd = lcg(4242)
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#8fbde6')
  sky.addColorStop(0.45, '#c4dcef')
  sky.addColorStop(0.72, '#f5dfc4')
  sky.addColorStop(1, '#f2caa0')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  // soft clouds
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W
    const y = 40 + rnd() * 150
    const r = 40 + rnd() * 90
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(255,250,244,0.55)')
    gr.addColorStop(1, 'rgba(255,250,244,0)')
    g.fillStyle = gr
    g.fillRect(x - r * 1.8, y - r, r * 3.6, r * 2)
  }
  // tower layers — far (hazy) → near (crisp)
  const layers = [
    { base: 330, hMin: 60, hMax: 190, col: [176, 186, 204], haze: 0.55, n: 26 },
    { base: 380, hMin: 90, hMax: 250, col: [132, 128, 138], haze: 0.28, n: 18 },
    { base: 430, hMin: 110, hMax: 300, col: [104, 86, 80], haze: 0.08, n: 13 }
  ]
  for (const ly of layers) {
    let x = -30
    for (let i = 0; i < ly.n && x < W + 40; i++) {
      const w = W / ly.n + rnd() * 40
      const h = ly.hMin + rnd() * (ly.hMax - ly.hMin)
      const top = ly.base - h
      const tint = 0.85 + rnd() * 0.3
      const [r0, g0, b0] = ly.col.map((v) => Math.round(Math.min(255, v * tint)))
      g.fillStyle = `rgb(${r0},${g0},${b0})`
      g.fillRect(x, top, w - 6, H - top)
      // sunlit left edge
      g.fillStyle = `rgba(255,214,168,${0.18 + ly.haze * 0.1})`
      g.fillRect(x, top, (w - 6) * 0.28, H - top)
      // window grid
      const cols = Math.max(2, Math.floor((w - 16) / 11))
      const rowsN = Math.floor((h - 12) / 13)
      for (let rr = 0; rr < rowsN; rr++) {
        for (let cc = 0; cc < cols; cc++) {
          const lit = rnd() < 0.22
          g.fillStyle = lit
            ? `rgba(255,226,170,${0.55 - ly.haze * 0.4})`
            : `rgba(40,48,62,${0.35 - ly.haze * 0.25})`
          g.fillRect(x + 6 + cc * 11, top + 8 + rr * 13, 6, 7)
        }
      }
      // rooftop kit
      if (rnd() < 0.4) {
        g.fillStyle = `rgb(${Math.round(r0 * 0.8)},${Math.round(g0 * 0.8)},${Math.round(b0 * 0.8)})`
        g.fillRect(x + w * 0.3, top - 10, w * 0.2, 10)
      }
      // haze wash
      g.fillStyle = `rgba(214,222,232,${ly.haze * 0.6})`
      g.fillRect(x, top, w - 6, H - top)
      x += w
    }
  }
  // street-level tree line
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W
    const y = 450 + rnd() * 20
    const r = 16 + rnd() * 22
    g.fillStyle = `rgb(${Math.round(70 + rnd() * 30)},${Math.round(100 + rnd() * 30)},${Math.round(62 + rnd() * 20)})`
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = '#6b6560'
  g.fillRect(0, 486, W, 26)
  _sky = toTex(c)
  return _sky
}

/* rugs — bordered wool with a quiet pattern. Painted in final color. */
export type RugKind = 'lounge' | 'nook' | 'runner' | 'pod'
const RUG_PAL: Record<RugKind, { field: string; border: string; motif: string; line: string }> = {
  lounge: { field: '#d9c6a8', border: '#b36e4f', motif: '#9a6f55', line: '#efe3cf' },
  nook: { field: '#a9b49c', border: '#6f7d64', motif: '#e7dcc6', line: '#8d9a80' },
  runner: { field: '#8f5f48', border: '#d9b58a', motif: '#e9d6b4', line: '#6d4636' },
  pod: { field: '#c9b89c', border: '#9f8b70', motif: '#bca98b', line: '#d8c8ae' }
}
const _rug = new Map<RugKind, THREE.Texture>()
export function rugTex(kind: RugKind) {
  const hit = _rug.get(kind)
  if (hit) return hit
  const [c, g] = canvas(512, 512)
  const rnd = lcg(kind.length * 97 + 13)
  const pal = RUG_PAL[kind]
  g.fillStyle = pal.border
  g.fillRect(0, 0, 512, 512)
  g.fillStyle = pal.line
  g.fillRect(22, 22, 468, 468)
  g.fillStyle = pal.field
  g.fillRect(30, 30, 452, 452)
  g.strokeStyle = pal.motif
  if (kind === 'lounge') {
    // stacked lozenge medallions + zigzag borders
    g.lineWidth = 6
    for (let i = 0; i < 3; i++) {
      const cy = 130 + i * 126
      g.beginPath()
      g.moveTo(256, cy - 52)
      g.lineTo(346, cy)
      g.lineTo(256, cy + 52)
      g.lineTo(166, cy)
      g.closePath()
      g.stroke()
      g.fillStyle = pal.border
      g.fillRect(250, cy - 6, 12, 12)
    }
    g.lineWidth = 3
    for (let y = 60; y < 460; y += 24) {
      g.beginPath()
      g.moveTo(52, y)
      g.lineTo(64, y + 12)
      g.lineTo(52, y + 24)
      g.stroke()
      g.beginPath()
      g.moveTo(460, y)
      g.lineTo(448, y + 12)
      g.lineTo(460, y + 24)
      g.stroke()
    }
  } else if (kind === 'nook') {
    g.lineWidth = 4
    for (let r = 60; r < 220; r += 34) {
      g.beginPath()
      g.arc(256, 256, r, 0, Math.PI * 2)
      g.stroke()
    }
  } else if (kind === 'runner') {
    g.lineWidth = 5
    for (let y = 60; y < 460; y += 40) {
      g.beginPath()
      g.moveTo(60, y)
      for (let x = 60; x <= 452; x += 28) g.lineTo(x, y + ((x / 28) % 2 ? 14 : 0))
      g.stroke()
    }
  } else {
    g.lineWidth = 2
    for (let y = 60; y < 460; y += 18) {
      g.beginPath()
      g.moveTo(40, y)
      g.lineTo(472, y)
      g.stroke()
    }
  }
  // wool speckle
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'
    g.fillRect(rnd() * 512, rnd() * 512, 2, 2)
  }
  const t = toTex(c)
  _rug.set(kind, t)
  return t
}

/* abstract prints for the frames — muted mid-century shapes */
const _art = new Map<number, THREE.Texture>()
export function artTex(seed: number) {
  const hit = _art.get(seed)
  if (hit) return hit
  const [c, g] = canvas(256, 320)
  const rnd = lcg(seed * 131 + 7)
  const grounds = ['#efe6d6', '#e9dcc8', '#dfe3dc', '#f1e4d2']
  const inks = ['#b8674a', '#d2a13f', '#8ea184', '#3d4a5c', '#2f2b28', '#c98e6b', '#6f8aa0']
  g.fillStyle = grounds[seed % grounds.length]
  g.fillRect(0, 0, 256, 320)
  const style = seed % 3
  if (style === 0) {
    // sun over hills
    g.fillStyle = inks[1]
    g.beginPath()
    g.arc(150, 120, 54, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = inks[0]
    g.beginPath()
    g.ellipse(90, 290, 180, 110, 0, Math.PI, 0)
    g.fill()
    g.fillStyle = inks[3]
    g.beginPath()
    g.ellipse(220, 310, 150, 90, 0, Math.PI, 0)
    g.fill()
  } else if (style === 1) {
    // stacked arches
    for (let i = 0; i < 4; i++) {
      g.fillStyle = inks[(i + seed) % inks.length]
      g.beginPath()
      g.arc(128, 250, 110 - i * 26, Math.PI, 0)
      g.fill()
    }
    g.fillStyle = inks[4]
    g.fillRect(24, 250, 208, 6)
  } else {
    // blocks + arc line
    for (let i = 0; i < 5; i++) {
      g.fillStyle = inks[Math.floor(rnd() * inks.length)]
      g.fillRect(20 + rnd() * 160, 30 + rnd() * 220, 40 + rnd() * 70, 40 + rnd() * 70)
    }
    g.strokeStyle = inks[4]
    g.lineWidth = 4
    g.beginPath()
    g.arc(128, 160, 70, 0.3, 4.2)
    g.stroke()
  }
  const t = toTex(c)
  _art.set(seed, t)
  return t
}

/* soft round blob — contact/AO decal under chairs, agents and furniture */
let _blob: THREE.Texture | null = null
export function blobTex() {
  if (_blob) return _blob
  const [c, g] = canvas(128, 128)
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(0,0,0,0.55)')
  gr.addColorStop(0.5, 'rgba(0,0,0,0.28)')
  gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  _blob = new THREE.CanvasTexture(c)
  return _blob
}

/* static panel content — secondary monitor (code), standby lock screen,
 * document viewer */
export type PanelKind = 'code' | 'lock' | 'docs'
const _panel = new Map<PanelKind, THREE.Texture>()
export function panelTex(kind: PanelKind) {
  const hit = _panel.get(kind)
  if (hit) return hit
  const [c, g] = canvas(256, 160)
  const rnd = lcg(kind.length * 31 + 5)
  if (kind === 'lock') {
    const gr = g.createLinearGradient(0, 0, 256, 160)
    gr.addColorStop(0, '#1c2a3a')
    gr.addColorStop(1, '#3a2c3e')
    g.fillStyle = gr
    g.fillRect(0, 0, 256, 160)
    g.fillStyle = 'rgba(255,255,255,0.7)'
    g.fillRect(104, 62, 48, 12)
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(114, 80, 28, 4)
  } else if (kind === 'code') {
    g.fillStyle = '#1b1d23'
    g.fillRect(0, 0, 256, 160)
    g.fillStyle = '#23262e'
    g.fillRect(0, 0, 38, 160)
    const cols = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#676e7b']
    for (let i = 0; i < 16; i++) {
      const ind = Math.floor(rnd() * 4) * 10
      let x = 46 + ind
      const n = 1 + Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const w = 10 + rnd() * 40
        g.fillStyle = cols[Math.floor(rnd() * cols.length)]
        g.fillRect(x, 8 + i * 9, w, 4)
        x += w + 5
      }
      g.fillStyle = '#4a4f5a'
      g.fillRect(10, 8 + i * 9, 14, 4)
    }
  } else {
    g.fillStyle = '#f4f2ee'
    g.fillRect(0, 0, 256, 160)
    g.fillStyle = '#e1ddd5'
    g.fillRect(0, 0, 256, 14)
    g.fillStyle = '#2f2b28'
    g.fillRect(40, 26, 120, 8)
    g.fillStyle = '#9d978d'
    for (let i = 0; i < 10; i++) g.fillRect(40, 44 + i * 10, 120 + rnd() * 50, 4)
    g.fillStyle = '#b8674a'
    g.fillRect(40, 150, 40, 4)
  }
  const t = toTex(c)
  _panel.set(kind, t)
  return t
}

/* warm neon script for the brick pier — soft halo + hot core, drawn on a
 * transparent canvas (additive material) */
let _neon: THREE.Texture | null = null
export function neonTex() {
  if (_neon) return _neon
  const [c, g] = canvas(512, 160)
  g.clearRect(0, 0, 512, 160)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'italic 700 86px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive'
  const passes: [number, string][] = [
    [26, 'rgba(255,150,70,0.35)'],
    [12, 'rgba(255,170,90,0.6)'],
    [4, 'rgba(255,214,160,0.95)']
  ]
  for (const [blur, col] of passes) {
    g.shadowColor = col
    g.shadowBlur = blur
    g.strokeStyle = col
    g.lineWidth = blur > 10 ? 6 : 3
    g.strokeText('terrarium', 256, 84)
  }
  g.shadowBlur = 0
  g.fillStyle = '#fff3e0'
  g.fillText('terrarium', 256, 84)
  _neon = toTex(c)
  return _neon
}
