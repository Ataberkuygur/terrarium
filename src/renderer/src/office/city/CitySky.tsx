// ── CitySky — golden-hour sky for the miniature city ───────────────
// A shader dome: clear blue zenith rolling down into a warm haze band and
// a peach horizon, with a broad amber glow on the western (sun) side so
// the sky itself tells you where the low key light comes from. Soft
// cumulus sprites with sun-warmed undersides drift slowly east, and a
// small flock of birds glides across the upper sky. Everything opts out
// of fog + tone mapping so the gradient reads exactly as authored; the
// fog colour in CityScene is SKY_LOW, so far buildings melt into the
// horizon band seamlessly.

import { useRef, type JSX } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ── palette ─────────────────────────────────────────────────────────
/* SKY_LOW is the horizon colour straight ahead (north) — CityScene uses
 * it for the fog + clear colour so the skyline dissolves into the dome. */
export const SKY_LOW = '#e8cfae'
const SKY_TOP = '#3a70b8'
const SKY_MID = '#7fa6d2'
const SKY_HAZE = '#d8c3a8'
const SUN_GLOW = '#ffb066'

/* direction toward the (off-frame) low western sun — matches the key
 * light in CityScene, nudged north so the glow grazes the view's left */
const SUN_DIR = new THREE.Vector3(-0.86, 0.1, -0.32).normalize()

const DOME_R = 420

// ── dome material ───────────────────────────────────────────────────

/* tone-mapped like the scene (same curve + colour space as fogged
 * geometry), so the fog colour SKY_LOW meets the horizon seamlessly */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    top: { value: new THREE.Color(SKY_TOP) },
    mid: { value: new THREE.Color(SKY_MID) },
    haze: { value: new THREE.Color(SKY_HAZE) },
    low: { value: new THREE.Color(SKY_LOW) },
    glow: { value: new THREE.Color(SUN_GLOW) },
    sunDir: { value: SUN_DIR }
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww; // pin to the far plane
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 top, mid, haze, low, glow, sunDir;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = max(d.y, 0.0);
      vec3 col = mix(low, haze, smoothstep(0.0, 0.07, h));
      col = mix(col, mid, smoothstep(0.05, 0.3, h));
      col = mix(col, top, smoothstep(0.25, 0.85, h));
      // warm sun-side glow: wide soft lobe + tighter hot core near horizon
      float s = max(dot(d, sunDir), 0.0);
      float horizon = 1.0 - smoothstep(0.0, 0.45, h);
      col = mix(col, glow, pow(s, 3.0) * 0.55 * horizon);
      col += glow * pow(s, 24.0) * 0.35;
      // faint cool counter-glow opposite the sun (Belt of Venus hint)
      float anti = max(dot(d, -sunDir), 0.0);
      col = mix(col, vec3(0.86, 0.78, 0.8), pow(anti, 4.0) * 0.18 * horizon);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
})

// ── cloud texture ───────────────────────────────────────────────────

/* soft cumulus: overlapping radial blobs, then a warm peach wash
 * composited onto the lower half (source-atop) — lit from below by the
 * low sun, cool white on top */
let _cloudTex: THREE.Texture | null = null
function cloudTex(): THREE.Texture {
  if (_cloudTex) return _cloudTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  const blobs: [number, number, number][] = [
    [62, 82, 30],
    [96, 64, 38],
    [138, 56, 44],
    [180, 70, 34],
    [118, 86, 34],
    [84, 88, 26],
    [206, 86, 22],
    [152, 90, 30]
  ]
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r)
    gr.addColorStop(0, 'rgba(255,255,255,0.95)')
    gr.addColorStop(0.55, 'rgba(255,255,255,0.7)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 256, 128)
  }
  g.globalCompositeOperation = 'source-atop'
  const v = g.createLinearGradient(0, 30, 0, 118)
  v.addColorStop(0, 'rgba(255,250,244,0)')
  v.addColorStop(0.55, 'rgba(255,214,170,0.55)')
  v.addColorStop(1, 'rgba(236,170,140,0.85)')
  g.fillStyle = v
  g.fillRect(0, 0, 256, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  _cloudTex = t
  return t
}

const cloudMats = [0.85, 0.65, 0.45].map(
  (opacity) =>
    new THREE.SpriteMaterial({
      map: cloudTex(),
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
      toneMapped: false
    })
)

/* x, y, z, width, aspect(h/w), speed, material index (0 = densest) */
const CLOUDS: [number, number, number, number, number, number, number][] = [
  [-190, 62, -300, 120, 0.42, 0.9, 1],
  [-80, 86, -340, 150, 0.38, 0.6, 0],
  [30, 58, -280, 90, 0.4, 1.1, 1],
  [140, 78, -320, 130, 0.36, 0.7, 0],
  [240, 64, -290, 110, 0.4, 0.8, 1],
  [-260, 100, -250, 140, 0.3, 0.5, 2],
  [90, 118, -260, 170, 0.22, 0.4, 2],
  [-20, 132, -230, 200, 0.16, 0.35, 2],
  [200, 40, -330, 80, 0.45, 1.0, 2],
  [-140, 40, -340, 70, 0.45, 1.2, 2]
]
const CLOUD_WRAP = 320

// ── birds ───────────────────────────────────────────────────────────

const birdMat = new THREE.MeshBasicMaterial({ color: '#3a3430', fog: false, side: THREE.DoubleSide })
/* flat wing along +z (hinge at the body, span 1), chord along x */
const wingGeo = new THREE.PlaneGeometry(0.26, 1)
wingGeo.rotateX(-Math.PI / 2)
wingGeo.translate(0, 0, 0.5)
const DIHEDRAL = 0.3

/* loose V of gulls: offsets from the flock center */
const FLOCK: [number, number, number][] = [
  [0, 0, 0],
  [-3, -0.8, 1.5],
  [-5.5, -1.4, 3],
  [-2.5, 0.6, -2],
  [-6, 0.2, -3.5],
  [-8.5, -0.5, 5]
]

// ── component ───────────────────────────────────────────────────────

export function CitySky(): JSX.Element {
  const clouds = useRef<THREE.Group | null>(null)
  const flock = useRef<THREE.Group | null>(null)

  useFrame(({ clock }, dt) => {
    const step = Math.min(dt, 0.1)
    const g = clouds.current
    if (g) {
      for (let i = 0; i < g.children.length; i++) {
        const s = g.children[i]
        s.position.x += CLOUDS[i][5] * step
        if (s.position.x > CLOUD_WRAP) s.position.x = -CLOUD_WRAP
      }
    }
    const f = flock.current
    if (f) {
      const t = clock.elapsedTime
      // glide west→east high over the skyline, loop every ~70s
      f.position.x = (((t * 3.2) % 220) + 220) % 220 - 110
      f.position.y = 30 + Math.sin(t * 0.3) * 1.5
      for (let i = 0; i < f.children.length; i++) {
        const b = f.children[i]
        const flap = DIHEDRAL + Math.sin(t * 6 + i * 1.7) * 0.45
        const l = b.children[0]
        const r = b.children[1]
        if (l && r) {
          l.rotation.x = -flap
          r.rotation.x = flap
        }
      }
    }
  })

  return (
    <group>
      <mesh material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[DOME_R, 48, 24]} />
      </mesh>

      <group ref={clouds}>
        {CLOUDS.map(([x, y, z, w, a, , mi], i) => (
          <sprite key={i} position={[x, y, z]} scale={[w, w * a, 1]} material={cloudMats[mi]} renderOrder={-9} />
        ))}
      </group>

      {/* gull flock — two hinged wing planes per bird */}
      <group ref={flock} position={[-60, 30, -70]}>
        {FLOCK.map(([dx, dy, dz], i) => (
          <group key={i} position={[dx, dy, dz]} scale={0.55}>
            <mesh geometry={wingGeo} material={birdMat} rotation={[-DIHEDRAL, 0, 0]} />
            <mesh geometry={wingGeo} material={birdMat} rotation={[DIHEDRAL, Math.PI, 0]} />
          </group>
        ))}
      </group>
    </group>
  )
}
