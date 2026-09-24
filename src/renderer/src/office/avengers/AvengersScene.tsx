/* ── Avengers Compound — ops floor scene ───────────────────────────────
 * The crew works around the holo briefing table in two console tiers;
 * idle heroes drift to the Stark bar / lounge; the Hall of Armor, Cap's
 * shield and Mjölnir dress the edges; the Quinjet waits on the pad beyond
 * the glass. Agent motion + memo discipline mirror OfficeScene: static
 * fixtures mount once, each hero re-renders only when its own visual
 * fields change, and every move is a damped glide driven from useFrame. */
import { memo, useRef, useCallback, useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { RpgControls, isClick } from '../RpgControls'
import { Character } from '../Character'
import type { Pose, CharacterCostume } from '../Character'
import type { Agent } from '@shared/types'
import { Room, Dais, Exterior, FloorEmblem, Cutaway } from './Room'
import {
  ConsoleSet,
  ConsoleHolo,
  StandbySet,
  ChairSet,
  HoloTable,
  StarkBar,
  LoungeSet,
  MissionWall,
  holoState,
  type ChairPlacement
} from './props-tech'
import { ArmorHall, ShieldDisplay, MjolnirPedestal, Quinjet, WallEmblem } from './props-iconic'
import { LabAtmosphere } from './atmosphere'
import { costumeForAgent } from './characters'
import { glowTexture } from './shared'
import {
  DESK,
  HUB,
  CAMERA,
  QUINJET,
  SHIELD_STAND,
  MJOLNIR,
  BAR,
  LOUNGE_SLOTS,
  FACILITY_BOUNDS,
  getOfficeDesks,
  deskById,
  deskLocal,
  hash01,
  type FacilityDesk,
  type LoungeSlot
} from './layout'
import { GRADE_Y } from './Room'

/* ══ HUD — name tags + status beacons ════════════════════════════════
 * One stylesheet injected once; tags are tiny DOM overlays via <Html>. */
const HUD_CSS = `
.avx-tag{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 7px;white-space:nowrap;
  background:linear-gradient(180deg,rgba(12,22,34,.9),rgba(6,12,20,.84));
  border:1px solid rgba(120,215,255,.5);border-left:2px solid #6fd4ff;border-radius:3px;
  box-shadow:0 0 10px rgba(80,200,255,.22),0 3px 10px rgba(0,0,0,.45);
  color:#e8f7ff;font:600 12px/1.25 "Segoe UI",system-ui,sans-serif;letter-spacing:.05em;
  pointer-events:none;user-select:none;position:relative}
.avx-tag::after{content:"";position:absolute;left:50%;bottom:-6px;width:1px;height:6px;
  background:rgba(120,215,255,.6)}
.avx-dot{width:7px;height:7px;border-radius:50%;flex:none}
.avx-tag[data-s=waiting]{border-color:rgba(255,176,58,.75);border-left-color:#ffb03a;
  box-shadow:0 0 12px rgba(255,160,40,.35),0 3px 10px rgba(0,0,0,.45)}
.avx-tag[data-s=done]{border-color:rgba(79,224,138,.65);border-left-color:#4fe08a}
.avx-beacon{display:flex;align-items:center;justify-content:center;width:20px;height:20px;
  transform:rotate(45deg);border-radius:3px;pointer-events:none;
  font:800 12px/1 "Segoe UI",system-ui,sans-serif;color:#0b0f14}
.avx-beacon>span{transform:rotate(-45deg)}
.avx-beacon[data-s=waiting]{background:#ffb03a;box-shadow:0 0 14px rgba(255,170,50,.8);
  animation:avx-pulse 1.4s ease-in-out infinite}
.avx-beacon[data-s=done]{background:#4fe08a;box-shadow:0 0 12px rgba(79,224,138,.7)}
@keyframes avx-pulse{0%,100%{transform:rotate(45deg) scale(1)}50%{transform:rotate(45deg) scale(1.18)}}
.avx-zzz{position:relative;width:36px;height:30px;pointer-events:none;user-select:none}
.avx-zzz span{position:absolute;bottom:0;color:#9fb6c8;font:700 12px/1 ui-monospace,monospace;opacity:0;
  animation:avx-zzz 2.8s ease-in-out infinite}
.avx-zzz span:nth-of-type(1){left:0;font-size:10px;animation-delay:0s}
.avx-zzz span:nth-of-type(2){left:9px;font-size:13px;animation-delay:.9s}
.avx-zzz span:nth-of-type(3){left:20px;font-size:16px;animation-delay:1.8s}
@keyframes avx-zzz{0%{opacity:0;transform:translateY(6px)}30%{opacity:.95}100%{opacity:0;transform:translateY(-15px)}}
`
let hudInjected = false
function ensureHudCss() {
  if (hudInjected || typeof document === 'undefined') return
  hudInjected = true
  const el = document.createElement('style')
  el.dataset.avx = 'hud'
  el.textContent = HUD_CSS
  document.head.appendChild(el)
}

const STATUS_COLOR: Record<Agent['status'], string> = {
  working: '#5fd4ff',
  waiting: '#ffb03a',
  done: '#4fe08a',
  idle: '#9aa7b4',
  offline: '#4a525c'
}

function NameTag({ agent, y }: { agent: Agent; y: number }): JSX.Element {
  const c = STATUS_COLOR[agent.status]
  const dot: CSSProperties = { background: c, boxShadow: `0 0 6px ${c}` }
  return (
    <Html position={[0, y, 0]} center distanceFactor={13} zIndexRange={[12, 0]}>
      <div className="avx-tag" data-s={agent.status}>
        <span className="avx-dot" style={dot} />
        {agent.name}
      </div>
    </Html>
  )
}

function StatusBeacon({ agent, y }: { agent: Agent; y: number }): JSX.Element | null {
  if (agent.status !== 'waiting' && agent.status !== 'done') return null
  return (
    <Html position={[0, y, 0]} center distanceFactor={13} zIndexRange={[13, 0]}>
      <div className="avx-beacon" data-s={agent.status}>
        <span>{agent.status === 'waiting' ? '!' : '✓'}</span>
      </div>
    </Html>
  )
}

function Zzz({ y }: { y: number }): JSX.Element {
  return (
    <Html position={[0.2, y, 0]} center distanceFactor={11} zIndexRange={[5, 0]}>
      <div className="avx-zzz">
        <span>z</span>
        <span>z</span>
        <span>z</span>
      </div>
    </Html>
  )
}

/* ══ agent state helpers ═════════════════════════════════════════════ */
/** engine sets agent.sleeping; fall back to idle+quiet>90s locally */
function isAsleep(agent: Agent): boolean {
  if (agent.sleeping !== undefined) return agent.sleeping
  return agent.status === 'idle' && Date.now() - agent.lastActiveAt > 90_000
}

/* The mock engine structuredClone()s the entire state every tick, so
 * reference equality is useless — compare only visual-driving fields. */
function sameAgent(a: Agent, b: Agent): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.deskId === b.deskId &&
    a.role === b.role &&
    a.domain === b.domain &&
    a.hue === b.hue &&
    a.name === b.name &&
    a.taskId === b.taskId &&
    a.sleeping === b.sleeping &&
    a.lastActiveAt === b.lastActiveAt
  )
}
function sameAgents(a: Agent[], b: Agent[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!sameAgent(a[i], b[i])) return false
  return true
}

/** how much bigger than a regular build this hero is — only the genuinely
 * oversized (Hulk ≈ 1.38) count; small build drift stays on the stock seat */
function bulkOf(costume: CharacterCostume | undefined): number {
  const s = costume?.scale ?? 1
  return s > 1.15 ? s : 1
}
/** big heroes sit further back on a bigger chair so knees clear the desk */
const seatZ = (bulk: number) => DESK.seatZ + (bulk - 1) * 0.75
const chairScale = (bulk: number) => 1 + (bulk - 1) * 0.85

type Placement = { pos: [number, number, number]; rotY: number; pose: Pose; seated: boolean }

function placeHero(
  agent: Agent,
  desk: FacilityDesk,
  lounge: LoungeSlot | undefined,
  asleep: boolean,
  bulk: number
): Placement {
  const faceHub = desk.rotY + Math.PI
  if (agent.status === 'idle' && !asleep) {
    if (lounge) return { pos: [lounge.x, lounge.y, lounge.z], rotY: lounge.rotY, pose: lounge.pose, seated: false }
    // no free lounge slot — stretch beside the console
    const [x, z] = deskLocal(desk, 0.5, 1.0)
    return { pos: [x, desk.y, z], rotY: faceHub + 0.5, pose: 'stand', seated: false }
  }
  if (asleep) {
    const [x, z] = deskLocal(desk, 0, seatZ(bulk))
    return { pos: [x, desk.y, z], rotY: faceHub, pose: 'slump', seated: true }
  }
  if (agent.status === 'waiting') {
    // up out of the chair, stepped to the side — the "needs you" stance
    const side = hash01(agent.id, 9) > 0.5 ? 1 : -1
    const [x, z] = deskLocal(desk, side * 0.45, 0.98 + (bulk - 1) * 0.5)
    return { pos: [x, desk.y, z], rotY: faceHub - side * 0.35, pose: 'stand', seated: false }
  }
  const [x, z] = deskLocal(desk, 0, seatZ(bulk))
  return { pos: [x, desk.y, z], rotY: faceHub, pose: 'sit', seated: true }
}

/* soft blob shadow under standing/seated heroes — moves with them */
const blobMat = new THREE.MeshBasicMaterial({
  color: '#000000',
  map: glowTexture(),
  transparent: true,
  opacity: 0.4,
  depthWrite: false
})
const blobGeo = new THREE.PlaneGeometry(1, 1)

const HeroAtStation = memo(
  function HeroAtStation({
    agent,
    costume,
    lounge,
    onSelect,
    onOpen
  }: {
    agent: Agent
    costume: CharacterCostume
    lounge: LoungeSlot | undefined
    onSelect: (id: string) => void
    onOpen: (id: string) => void
  }) {
    const desk = deskById(agent.deskId)
    const asleep = agent.status === 'idle' && isAsleep(agent)
    const bulk = bulkOf(costume)
    const place = placeHero(agent, desk, lounge, asleep, bulk)
    const standingPose = place.pose === 'stand' || place.pose === 'standWork'
    const tagY = (standingPose ? 2.02 : place.pose === 'lounge' ? 1.3 : 1.55) * bulk

    /* Status changes teleport no one — the mover glides to the new spot.
     * The callback ref snaps the group on (re)mount, then useFrame owns
     * the transform; targets are plain ref writes (zero per-frame allocs). */
    const mover = useRef<THREE.Group | null>(null)
    const targetPos = useRef(new THREE.Vector3(...place.pos))
    const targetRotY = useRef(place.rotY)
    const setMover = useCallback((g: THREE.Group | null) => {
      if (g) {
        g.position.copy(targetPos.current)
        g.rotation.y = targetRotY.current
      }
      mover.current = g
    }, [])
    targetPos.current.set(...place.pos)
    targetRotY.current = place.rotY

    useFrame((_, dt) => {
      const g = mover.current
      if (!g) return
      let d = targetRotY.current - g.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      if (g.position.distanceToSquared(targetPos.current) < 1e-6 && Math.abs(d) < 1e-3) return
      const k = 1 - Math.exp(-3.4 * Math.min(dt, 0.1))
      g.position.lerp(targetPos.current, k)
      g.rotation.y += d * k
    })

    return (
      <group>
        {/* live holo panes on this hero's console */}
        <group position={[desk.x, desk.y, desk.z]} rotation={[0, desk.rotY, 0]}>
          <ConsoleHolo state={holoState(agent.status, asleep)} seed={desk.id} />
        </group>

        {agent.status !== 'offline' && (
          <group
            ref={setMover}
            onClick={(e) => (e.stopPropagation(), isClick(e) && onSelect(agent.id))}
            onDoubleClick={(e) => (e.stopPropagation(), isClick(e) && onOpen(agent.id))}
          >
            {place.pose !== 'lounge' && (
              <mesh
                position={[0, 0.012, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
                scale={0.95 * bulk}
                geometry={blobGeo}
                material={blobMat}
              />
            )}
            <group scale={1.08}>
              <Character agent={agent} pose={place.pose} costume={costume} />
            </group>
            <StatusBeacon agent={agent} y={tagY + 0.34} />
            <NameTag agent={agent} y={tagY} />
            {asleep && <Zzz y={1.45 * bulk} />}
          </group>
        )}
      </group>
    )
  },
  (prev, next) =>
    prev.onSelect === next.onSelect &&
    prev.lounge === next.lounge &&
    prev.costume === next.costume &&
    sameAgent(prev.agent, next.agent)
)

/* ══ static facility — mounts once ═══════════════════════════════════ */
const StaticFacility = memo(function StaticFacility({
  onDeselect,
  desks
}: {
  onDeselect: () => void
  desks: FacilityDesk[]
}) {
  return (
    <>
      <Exterior />
      <Room onDeselect={onDeselect} />
      <Dais />
      <FloorEmblem />
      <ConsoleSet desks={desks} />

      <group position={[HUB.x, 0, HUB.z]}>
        <HoloTable />
      </group>

      <Cutaway side="back">
        <ArmorHall />
      </Cutaway>
      <group position={[SHIELD_STAND.x, 0, SHIELD_STAND.z]} rotation={[0, SHIELD_STAND.rotY, 0]}>
        <ShieldDisplay />
      </group>
      <group position={[MJOLNIR.x, 0, MJOLNIR.z]}>
        <MjolnirPedestal />
      </group>
      <StarkBar />
      <Cutaway side="right">
        <WallEmblem />
      </Cutaway>
      <MissionWall />
      <LoungeSet />
      <group position={[QUINJET.x, GRADE_Y, QUINJET.z]} rotation={[0, QUINJET.rotY, 0]}>
        <Quinjet />
      </group>

      <LabAtmosphere />
    </>
  )
})

/* ══ camera rig — seeds the orbit target once ════════════════════════
 * RpgControls (MapControls) starts targeting the origin; point it at the
 * crew so the first frame is the composed ¾ shot. */
interface OrbitLike {
  target: THREE.Vector3
  update: () => void
}
function CameraRig(): null {
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  const seeded = useRef(false)
  useEffect(() => {
    if (!controls || seeded.current) return
    seeded.current = true
    controls.target.set(...CAMERA.target)
    controls.update()
  }, [controls])
  return null
}

export interface AvengersSceneProps {
  agents: Agent[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onTargetChange?: (agent: Agent | null) => void
  onInteract?: (agent: Agent) => void
  /** true while the dock is hidden — Canvas gets frameloop='never' so the
   * mounted scene stops burning GPU. */
  paused?: boolean
}

export const AvengersScene = memo(
  function AvengersScene({
    agents,
    selectedId: _selectedId,
    onSelect,
    onTargetChange = () => {},
    onInteract = (a) => onSelect?.(a.id),
    paused = false
  }: AvengersSceneProps) {
    ensureHudCss()
    const activeDesks = useMemo(() => getOfficeDesks(agents.length), [agents.length])
    /* hero identity is unique per crew — resolved once for the whole roster */
    const costumes = useMemo(() => new Map(agents.map((a) => [a.id, costumeForAgent(a, agents)] as const)), [agents])

    /* idle heroes claim lounge slots in a stable order (by id) */
    const loungeFor = useMemo(() => {
      const map = new Map<string, LoungeSlot>()
      const idle = agents
        .filter((a) => a.status === 'idle' && !isAsleep(a))
        .map((a) => a.id)
        .sort()
      idle.forEach((id, i) => {
        if (i < LOUNGE_SLOTS.length) map.set(id, LOUNGE_SLOTS[i])
      })
      return map
    }, [agents])

    /* consoles without a present hero show the standby glyph */
    const manned = useMemo(() => {
      const set = new Set<string>()
      for (const a of agents) if (a.status !== 'offline') set.add(a.deskId)
      return set
    }, [agents])
    const standby = useMemo(() => activeDesks.filter((d) => !manned.has(d.id)), [activeDesks, manned])

    /* chairs: seated heroes get theirs pulled out (and upsized for the big
     * guy); every other chair sits tucked at a slight casual angle */
    const chairKey = agents
      .map((a) => `${a.deskId}:${a.status}:${a.status === 'idle' && isAsleep(a) ? 1 : 0}:${bulkOf(costumes.get(a.id))}`)
      .join('|')
    const chairs = useMemo<ChairPlacement[]>(() => {
      const byDesk = new Map<string, Agent>()
      for (const a of agents) byDesk.set(a.deskId, a)
      return activeDesks.map((d) => {
        const a = byDesk.get(d.id)
        const asleep = !!a && a.status === 'idle' && isAsleep(a)
        const seated = !!a && (a.status === 'working' || a.status === 'done' || asleep)
        const bulk = a ? bulkOf(costumes.get(a.id)) : 1
        // unmanned: tucked under the console, a touch askew
        const z = seated ? seatZ(bulk) : DESK.seatZ - 0.28
        const [x, wz] = deskLocal(d, 0, z)
        const jitter = seated ? 0 : (hash01(d.id, 5) - 0.5) * 0.3
        return { x, y: d.y, z: wz, rotY: d.rotY + jitter, scale: seated ? chairScale(bulk) : 1 }
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDesks, chairKey])

    /* adaptive pixel ratio — PerformanceMonitor steps 1.5 ↔ 1 */
    const [dpr, setDpr] = useState(1.5)
    const deselect = useCallback(() => onTargetChange(null), [onTargetChange])

    return (
      <Canvas
        shadows
        dpr={dpr}
        frameloop={paused ? 'never' : 'always'}
        camera={{ position: CAMERA.position, fov: CAMERA.fov, near: 0.1, far: 220 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05
        }}
        style={{ background: 'linear-gradient(180deg, #86acd4 0%, #c3d6e6 55%, #d8e2ea 100%)' }}
      >
        {/* upstate haze — distant lawn and trees dissolve into the sky */}
        <fog attach="fog" args={['#cad8e4', 30, 78]} />

        {/* sky fill + cool front fill for faces */}
        <hemisphereLight args={['#e3edf8', '#4a4540', 1.0]} />
        <ambientLight intensity={0.12} color="#e6eef8" />
        <directionalLight position={[8, 9, 12]} intensity={0.55} color="#dfe9ff" />

        {/* the sun — late afternoon, behind-left, raking through the glazing
            so the mullions stripe the floor */}
        <directionalLight
          position={[9, 12.5, -13]}
          intensity={2.7}
          color="#ffe9cc"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-16}
          shadow-camera-right={16}
          shadow-camera-top={14}
          shadow-camera-bottom={-12}
          shadow-camera-near={1}
          shadow-camera-far={60}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
        />

        {/* practicals — cyan hub, warm armor hall, warm bar */}
        <pointLight position={[HUB.x, 3.3, HUB.z]} intensity={3} color="#6fd4ff" distance={8} decay={2} />
        <pointLight position={[-4.5, 2.7, -4.3]} intensity={5} color="#ffe2bd" distance={7} decay={2} />
        <pointLight position={[BAR.x - 0.8, 2.3, BAR.z]} intensity={3.2} color="#ffc98a" distance={5.5} decay={2} />

        {/* studio env — a bright window slab behind, soft ceiling, sides */}
        <Environment frames={1} resolution={256} environmentIntensity={0.8}>
          <Lightformer form="rect" intensity={2.4} color="#eaf3ff" position={[0, 2, -12]} scale={[24, 4]} />
          <Lightformer
            form="rect"
            intensity={1.0}
            color="#f4f7fb"
            position={[0, 8, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[16, 10]}
          />
          <Lightformer
            form="rect"
            intensity={0.6}
            color="#bcd8f0"
            position={[-12, 3, 0]}
            rotation={[0, Math.PI / 2, 0]}
            scale={[10, 4]}
          />
          <Lightformer
            form="rect"
            intensity={0.5}
            color="#ffe2c0"
            position={[12, 3, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            scale={[10, 4]}
          />
          <Lightformer form="ring" intensity={2} color="#6fd4ff" position={[0, 6, 4]} scale={3} />
        </Environment>

        <StaticFacility onDeselect={deselect} desks={activeDesks} />
        <ChairSet chairs={chairs} />
        <StandbySet desks={standby} />

        {agents.map((a) => (
          <HeroAtStation
            key={a.id}
            agent={a}
            costume={costumes.get(a.id) ?? costumeForAgent(a, agents)}
            lounge={loungeFor.get(a.id)}
            onSelect={() => onTargetChange(a)}
            onOpen={() => onInteract(a)}
          />
        ))}

        <RpgControls bounds={FACILITY_BOUNDS} maxDistance={24} />
        <CameraRig />

        <PerformanceMonitor
          ms={250}
          iterations={8}
          step={0.5}
          flipflops={3}
          onDecline={() => setDpr(1)}
          onIncline={() => setDpr(1.5)}
        />
      </Canvas>
    )
  },
  (prev, next) =>
    prev.onTargetChange === next.onTargetChange &&
    prev.onInteract === next.onInteract &&
    prev.paused === next.paused &&
    sameAgents(prev.agents, next.agents)
)
