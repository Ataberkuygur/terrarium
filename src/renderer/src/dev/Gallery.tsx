/* ── Dev scene gallery — see gallery-main.tsx for the URL contract ─────────── */
import { Suspense, useMemo, type JSX } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Agent, AgentDomain, AgentStatus } from '@shared/types'
import { Character, type Pose } from '../office/Character'
import { AVENGERS, hashString } from '../office/avengers/characters'
import { OfficeScene } from '../office/OfficeScene'
import { AvengersScene } from '../office/avengers/AvengersScene'
import { CityScene } from '../office/city/CityScene'
import { BUILTIN_DEPARTMENTS } from '../lib/departments'

const params = new URLSearchParams(window.location.search)
const num = (k: string, d: number): number => {
  const v = Number(params.get(k))
  return Number.isFinite(v) && v > 0 ? v : d
}

const STATUSES: AgentStatus[] = ['working', 'working', 'idle', 'waiting', 'working', 'done']
const DOMAINS: AgentDomain[] = ['frontend', 'backend', 'marketing', 'design', 'research', 'general']

/** id whose hash lands on hero slot `slot` — keeps the gallery's hero set
 * stable regardless of how costumeForAgent maps ids */
function idForHero(slot: number): string {
  for (let k = 0; k < 100000; k++) {
    const id = `gallery-${slot}-${k}`
    if (hashString(id) % AVENGERS.length === slot) return id
  }
  return `gallery-${slot}`
}

function fakeAgent(i: number, id?: string): Agent {
  return {
    id: id ?? `gallery-agent-${i}`,
    name: `Agent ${i + 1}`,
    role: 'builder',
    domain: DOMAINS[i % DOMAINS.length],
    brief: '',
    status: STATUSES[i % STATUSES.length],
    deskId: `desk-${i}`,
    taskId: null,
    hue: (i * 47 + 200) % 360,
    lastActiveAt: Date.now()
  }
}

/* ── character lineup ───────────────────────────────────────────────────── */
function Lineup(): JSX.Element {
  const pose = (params.get('pose') ?? 'stand') as Pose
  const set = params.get('set') ?? 'heroes'
  const only = params.get('only')
  const cam = params.get('cam') ?? '3q'

  const entries = useMemo(() => {
    const heroes = AVENGERS.map((h, i) => ({ key: h.id, label: h.label, agent: fakeAgent(i, idForHero(i)), costume: h.costume }))
    const civilians = Array.from({ length: 6 }, (_, i) => ({ key: `civ-${i}`, label: `civilian ${i}`, agent: fakeAgent(i + 20), costume: undefined }))
    let list = set === 'civilians' ? civilians : set === 'all' ? [...heroes, ...civilians] : heroes
    if (only) list = list.filter((e) => e.key === only)
    return list
  }, [set, only])

  const spacing = 1.05
  const width = (entries.length - 1) * spacing
  const single = entries.length === 1
  const camPos: [number, number, number] = single
    ? cam === 'back'
      ? [0, 1.3, -2.6]
      : cam === 'side'
        ? [2.6, 1.3, 0]
        : cam === 'close'
          ? [0.3, num('ty', 1.4) + 0.08, num('cz', 1.0)]
          : [1.4, 1.4, 2.4]
    : cam === 'back'
      ? [0, 1.6, -width * 0.62 - 3]
      : [0, 1.7, width * 0.62 + 3.2]
  const target: [number, number, number] = single ? [0, cam === 'close' ? num('ty', 1.4) : 0.95, 0] : [0, 0.95, 0]

  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: camPos, fov: 35 }} gl={{ antialias: true }}>
      <color attach="background" args={['#1a1d24']} />
      <hemisphereLight args={['#dfe8ff', '#3a3228', 0.7]} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-4, 3, -3]} intensity={0.8} color="#9fc3ff" />
      <Suspense fallback={null}>
        <Environment preset="city" />
      </Suspense>
      {entries.map((e, i) => (
        <group key={e.key} position={[i * spacing - width / 2, 0, 0]}>
          <Character agent={e.agent} pose={pose} costume={e.costume} />
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[30, 48]} />
        <meshStandardMaterial color="#2a2e36" roughness={0.9} />
      </mesh>
      <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={20} blur={2.2} far={3} />
      <OrbitControls target={target} makeDefault />
    </Canvas>
  )
}

/* ── full scenes ────────────────────────────────────────────────────────── */
export function Gallery(): JSX.Element {
  const v = params.get('v') ?? 'chars'
  const agents = useMemo(() => {
    const n = num('n', v === 'avengers' ? 9 : 10)
    return Array.from({ length: n }, (_, i) => fakeAgent(i, v === 'avengers' ? idForHero(i % AVENGERS.length) + (i >= AVENGERS.length ? `-${i}` : '') : undefined))
  }, [v])

  let body: JSX.Element
  if (v === 'loft') body = <OfficeScene agents={agents} />
  else if (v === 'avengers') body = <AvengersScene agents={agents} />
  else if (v === 'city') {
    const theme = params.get('theme') === 'avengers' ? 'avengers' : 'loft'
    const counts = Object.fromEntries(BUILTIN_DEPARTMENTS.map((d, i) => [d.id, (i * 3) % 7]))
    body = <CityScene departments={BUILTIN_DEPARTMENTS} counts={counts} onEnterDept={() => {}} theme={theme} />
  } else body = <Lineup />

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {body}
      <div style={{ position: 'fixed', left: 8, bottom: 6, font: '11px monospace', color: '#8b93a3', pointerEvents: 'none' }}>
        gallery · {window.location.search || '?v=chars'} · three r{THREE.REVISION}
      </div>
    </div>
  )
}
