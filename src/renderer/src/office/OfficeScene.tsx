/**
 * OfficeScene — the default ("loft") office interior.
 *
 * A warm creative-studio loft shown as a dollhouse diorama: oak floor on a
 * dark plinth, brick back wall with steel windows and afternoon sun, four
 * back-to-back desk pods in the middle, lounge + kitchen on the left, a
 * glass meeting room and standing desks on the right. Camera-facing walls
 * collapse to cut stubs as the view orbits (see LoftRoom).
 *
 * Agents sit at their desks (working/done), stand beside them (waiting),
 * doze in their chair (asleep) or hang out in the commons (idle). Status
 * changes glide the agent to the new spot — nobody teleports.
 */

import { memo, useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { RpgControls, isClick } from './RpgControls'
import type { Agent, AgentStatus } from '@shared/types'
import { Character } from './Character'
import { LoftRoom } from './LoftRoom'
import { DeskBank, DeskScreen } from './Props'
import { LG, LM } from './loftKit'
import {
  getOfficeDesks,
  deskById,
  deskLocal,
  hash01,
  SEAT_Z,
  STAND_Z,
  LOUNGE,
  NOOK,
  ISLAND,
  MEETING_ROOM,
  LOUNGE_SEATS,
  type LoungeSeat
} from './layout'
import { DOMAIN_LABELS } from '../lib/terminal-classify'

/* ── camera framing ────────────────────────────────────────────────────── */

/** orbit target — the heart of the desk pods */
const CAM_TARGET: [number, number, number] = [0.6, 0.3, 0.55]
/** default view: 3/4 from the front-right, ~38° above the floor */
const CAM_AZIMUTH = 0.56
const CAM_POLAR = 0.9
const CAM_DIST = 21
const CAM_POS: [number, number, number] = [
  CAM_TARGET[0] + CAM_DIST * Math.sin(CAM_POLAR) * Math.sin(CAM_AZIMUTH),
  CAM_TARGET[1] + CAM_DIST * Math.cos(CAM_POLAR),
  CAM_TARGET[2] + CAM_DIST * Math.sin(CAM_POLAR) * Math.cos(CAM_AZIMUTH)
]

/** unit vector target → default camera */
const CAM_DIR = new THREE.Vector3(
  CAM_POS[0] - CAM_TARGET[0],
  CAM_POS[1] - CAM_TARGET[1],
  CAM_POS[2] - CAM_TARGET[2]
).normalize()

/* Narrow panes (mini dock, split grid) back the default camera off so the
 * whole loft still fits; 16:9 and wider keep the authored framing. Only
 * the initial framing adapts — once the user drags or zooms, resizes leave
 * their view alone. */
function FitCamera() {
  const camera = useThree((s) => s.camera)
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  const controls = useThree((s) => s.controls) as unknown as {
    addEventListener: (type: string, fn: () => void) => void
    removeEventListener: (type: string, fn: () => void) => void
  } | null
  const touched = useRef(false)
  useEffect(() => {
    if (!controls) return
    const on = () => {
      touched.current = true
    }
    controls.addEventListener('start', on)
    return () => controls.removeEventListener('start', on)
  }, [controls])
  useLayoutEffect(() => {
    if (touched.current || width <= 0 || height <= 0) return
    const f = Math.min(1.5, Math.max(1, Math.pow(16 / 9 / (width / height), 0.6)))
    camera.position.set(CAM_TARGET[0], CAM_TARGET[1], CAM_TARGET[2]).addScaledVector(CAM_DIR, CAM_DIST * f)
  }, [camera, width, height])
  return null
}

/** crew scale — heads/shoulders read clearly above the desk line */
const CHAR_SCALE = 1.1

/* ── name tags + status chips ──────────────────────────────────────────── */

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: '#5ad6a8',
  idle: '#a7abb3',
  waiting: '#f5a524',
  done: '#6cc070',
  offline: '#6b6f78'
}

const TAG_CSS = `
.loft-tag{display:flex;align-items:center;gap:6px;padding:3px 9px 3px 7px;border-radius:999px;
  background:rgba(24,21,19,.82);border:1px solid rgba(255,255,255,.14);
  box-shadow:0 3px 12px rgba(20,12,4,.28);color:#f4efe8;white-space:nowrap;
  font:600 11px/1.25 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.01em;
  pointer-events:none;user-select:none;transform:translateY(-50%)}
.loft-tag .d{width:7px;height:7px;border-radius:50%;flex:none}
.loft-tag .r{color:rgba(244,239,232,.55);font-weight:500;font-size:10px}
.loft-tag.w{border-color:rgba(245,165,36,.75);background:rgba(58,38,10,.88)}
.loft-tag.k .d{animation:loft-pulse 1.6s ease-in-out infinite}
@keyframes loft-pulse{0%,100%{box-shadow:0 0 0 0 currentColor}50%{box-shadow:0 0 0 4px transparent}}
.loft-tag .b{display:flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:-3px;
  border-radius:50%;flex:none;color:#1a1410;font:800 10px/1 ui-sans-serif,system-ui,sans-serif}
.loft-tag.f{border-color:rgba(108,192,112,.6)}
.loft-tag.w .b{animation:loft-pop 1.4s ease-in-out infinite}
@keyframes loft-pop{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
.loft-zzz{position:relative;width:36px;height:30px;pointer-events:none;user-select:none}
.loft-zzz span{position:absolute;bottom:0;color:#8b9099;font:700 12px/1 ui-monospace,monospace;opacity:0;
  animation:loft-zzz 2.8s ease-in-out infinite}
.loft-zzz span:nth-of-type(1){left:0;font-size:10px}
.loft-zzz span:nth-of-type(2){left:9px;font-size:13px;animation-delay:.9s}
.loft-zzz span:nth-of-type(3){left:20px;font-size:16px;animation-delay:1.8s}
@keyframes loft-zzz{0%{opacity:0;transform:translateY(6px)}30%{opacity:.95}100%{opacity:0;transform:translateY(-15px)}}
`
if (typeof document !== 'undefined' && !document.getElementById('loft-tag-css')) {
  const el = document.createElement('style')
  el.id = 'loft-tag-css'
  el.textContent = TAG_CSS
  document.head.appendChild(el)
}

function AgentTag({ agent, y }: { agent: Agent; y: number }) {
  const c = STATUS_COLOR[agent.status]
  const waiting = agent.status === 'waiting'
  const done = agent.status === 'done'
  const cls = waiting ? 'loft-tag w' : done ? 'loft-tag f' : agent.status === 'working' ? 'loft-tag k' : 'loft-tag'
  // deterministic sideways drift — neighbours' tags stop stacking
  const jx = (hash01(agent.id, 22) - 0.5) * 0.18
  return (
    <Html position={[jx, y, 0]} center distanceFactor={10} zIndexRange={[12, 0]}>
      <div className={cls}>
        {waiting || done ? (
          <span className="b" style={{ background: c }}>
            {waiting ? '!' : '✓'}
          </span>
        ) : (
          <span className="d" style={{ background: c, color: c } as CSSProperties} />
        )}
        {agent.name}
        <span className="r">{DOMAIN_LABELS[agent.domain] ?? agent.domain}</span>
      </div>
    </Html>
  )
}

function Zzz() {
  return (
    <Html position={[0.2, 1.3, 0]} center distanceFactor={9} zIndexRange={[5, 0]}>
      <div className="loft-zzz">
        <span>z</span>
        <span>z</span>
        <span>z</span>
      </div>
    </Html>
  )
}

/* ── agent state helpers ───────────────────────────────────────────────── */

/** engine sets agent.sleeping; fall back to idle+quiet>90s locally */
function isAsleep(agent: Agent) {
  if (agent.sleeping !== undefined) return agent.sleeping
  return agent.status === 'idle' && Date.now() - agent.lastActiveAt > 90_000
}

/* The mock engine structuredClone()s the entire state every 4s tick, so every
 * agent object gets a fresh identity — reference equality is useless here.
 * Compare only the fields that actually drive this subtree's visuals. */
function sameAgent(a: Agent, b: Agent) {
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

function sameAgents(a: Agent[], b: Agent[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!sameAgent(a[i], b[i])) return false
  }
  return true
}

type Pose = 'sit' | 'stand' | 'lounge' | 'slump' | 'slumpStand' | 'standWork'

/* invisible click target over a desk's chair (material.visible=false still
 * raycasts) */
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false })

/* ── one agent at their desk / in the commons ──────────────────────────── */

const AgentAtDesk = memo(
  function AgentAtDesk({
    agent,
    seat,
    onSelect,
    onOpen
  }: {
    agent: Agent
    seat: LoungeSeat | null
    onSelect: (id: string) => void
    onOpen: (id: string) => void
  }) {
    const desk = deskById(agent.deskId)
    const tall = !!desk.tall
    const asleep = agent.status === 'idle' && isAsleep(agent)
    const inCommons = agent.status === 'idle' && !asleep && seat !== null
    const standing = agent.status === 'waiting' || (agent.status === 'done' && tall)

    let charPos: [number, number, number]
    let charRotY: number
    let pose: Pose
    if (inCommons && seat) {
      pose = seat.pose
      charPos = [seat.x, seat.y, seat.z]
      charRotY = seat.rotY
    } else if (asleep) {
      pose = tall ? 'slumpStand' : 'slump'
      const [x, z] = deskLocal(desk, 0, tall ? STAND_Z - 0.1 : SEAT_Z)
      charPos = [x, 0, z]
      charRotY = desk.rotY + Math.PI
    } else if (standing) {
      // waiting: up beside the desk, turned half toward the room
      pose = 'stand'
      const side = hash01(agent.deskId, 9) > 0.3 ? 1 : -1
      const [x, z] = deskLocal(desk, side * 0.84, SEAT_Z - 0.05)
      charPos = [x, 0, z]
      charRotY = desk.rotY + Math.PI + side * 0.5
    } else if (tall) {
      pose = 'standWork'
      const [x, z] = deskLocal(desk, 0, STAND_Z)
      charPos = [x, 0, z]
      charRotY = desk.rotY + Math.PI
    } else {
      pose = 'sit'
      const [x, z] = deskLocal(desk, 0, SEAT_Z)
      charPos = [x, 0, z]
      charRotY = desk.rotY + Math.PI
    }

    /* Status changes glide the agent to the new spot. The callback ref
     * snaps the group to its target on (re)mount, then useFrame owns the
     * transform. Targets are plain ref writes — zero per-frame allocation. */
    const mover = useRef<THREE.Group | null>(null)
    const targetPos = useRef(new THREE.Vector3(charPos[0], charPos[1], charPos[2]))
    const targetRotY = useRef(charRotY)
    const setMover = useCallback((g: THREE.Group | null) => {
      if (g) {
        g.position.copy(targetPos.current)
        g.rotation.y = targetRotY.current
      }
      mover.current = g
    }, [])
    targetPos.current.set(charPos[0], charPos[1], charPos[2])
    targetRotY.current = charRotY

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

    const select = (e: { stopPropagation: () => void; delta: number }) => {
      e.stopPropagation()
      if (isClick(e)) onSelect(agent.id)
    }
    const open = (e: { stopPropagation: () => void; delta: number }) => {
      e.stopPropagation()
      if (isClick(e)) onOpen(agent.id)
    }

    const [hx, hz] = deskLocal(desk, 0, tall ? STAND_Z * 0.5 : SEAT_Z * 0.6)
    const upright = pose === 'stand' || pose === 'standWork' || pose === 'slumpStand'
    const tagY = upright ? 1.98 : pose === 'lounge' ? 1.32 : 1.58

    return (
      <group>
        <DeskScreen spot={desk} agent={agent} on={agent.status !== 'offline' && !asleep} />
        {/* desk + chair click target */}
        <mesh
          geometry={LG.box}
          material={HIT_MAT}
          position={[hx, 0.6, hz]}
          rotation={[0, desk.rotY, 0]}
          scale={[1.3, 1.2, 1.4]}
          onClick={select}
          onDoubleClick={open}
        />
        {agent.status !== 'offline' && (
          <group ref={setMover} onClick={select} onDoubleClick={open}>
            <group scale={CHAR_SCALE}>
              <Character agent={agent} pose={pose} />
            </group>
            {upright && <mesh geometry={LG.blob} material={LM.blob} position={[0, 0.006, 0]} scale={0.8} />}
            <AgentTag agent={agent} y={tagY} />
            {asleep && <Zzz />}
          </group>
        )}
      </group>
    )
  },
  (prev, next) =>
    prev.onSelect === next.onSelect && prev.seat === next.seat && sameAgent(prev.agent, next.agent)
)

/* ── lights ────────────────────────────────────────────────────────────── */

function Lights() {
  // per-canvas target — split view mounts several scenes, and an Object3D
  // can only live in one of them
  const sunTarget = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(0, 0, -0.5)
    return o
  }, [])
  return (
    <>
      {/* soft sky + warm floor bounce */}
      <hemisphereLight args={['#f6efe4', '#9b7d5e', 1.15]} />
      <ambientLight intensity={0.22} color="#fff4e6" />
      {/* cool fill from the camera side — keeps faces readable in shade */}
      <directionalLight position={[8, 10, 12]} intensity={0.55} color="#e4ecf6" />

      {/* afternoon sun through the back windows — the only shadow caster */}
      <primitive object={sunTarget} />
      <directionalLight
        position={[-4.5, 7.2, -12]}
        target={sunTarget}
        intensity={3.6}
        color="#ffdcb0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
      />

      {/* warm practicals */}
      <pointLight position={[LOUNGE.lamp.x + 0.2, 1.7, LOUNGE.lamp.z - 0.3]} intensity={2.4} color="#ffcf94" distance={5} decay={2} />
      <pointLight position={[ISLAND.x, 2.0, ISLAND.z]} intensity={2.6} color="#ffd6a3" distance={4.5} decay={2} />
      <pointLight position={[MEETING_ROOM.table.x, 2.1, MEETING_ROOM.table.z]} intensity={2.2} color="#fff0da" distance={4.5} decay={2} />
      <pointLight position={[NOOK.x, 1.3, NOOK.z + 0.1]} intensity={1.6} color="#ffcf94" distance={3.5} decay={2} />

      <Environment frames={1} resolution={128} environmentIntensity={0.45}>
        <Lightformer form="rect" intensity={2.2} color="#fff0dc" position={[0, 2.2, -9]} scale={[16, 3]} />
        <Lightformer form="rect" intensity={0.9} color="#ffe6c8" position={[0, 7, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 8]} />
        <Lightformer form="rect" intensity={0.5} color="#dfe8f4" position={[9, 3, 6]} rotation={[0, -Math.PI / 3, 0]} scale={[8, 4]} />
      </Environment>
    </>
  )
}

/* ── scene ─────────────────────────────────────────────────────────────── */

export interface OfficeSceneProps {
  agents: Agent[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onTargetChange?: (agent: Agent | null) => void
  onInteract?: (agent: Agent) => void
  /** true while the dock is hidden — Canvas gets frameloop='never' so the
   * mounted scene stops burning GPU. */
  paused?: boolean
}

export const OfficeScene = memo(
  function OfficeScene({
    agents,
    selectedId: _selectedId,
    onSelect,
    onTargetChange = () => {},
    onInteract = (a) => onSelect?.(a.id),
    paused = false
  }: OfficeSceneProps) {
    const desks = useMemo(() => getOfficeDesks(agents.length), [agents.length])
    const occupiedKey = agents
      .filter((a) => a.status !== 'offline')
      .map((a) => deskById(a.deskId).id)
      .sort()
      .join(',')
    const occupied = useMemo(() => new Set(occupiedKey ? occupiedKey.split(',') : []), [occupiedKey])

    /* idle (awake) agents take commons seats in arrival order — sofa first,
     * then armchairs, the kitchen island, the nook */
    const seats = useMemo(() => {
      const map = new Map<string, LoungeSeat>()
      let i = 0
      for (const a of agents) {
        if (a.status !== 'idle' || isAsleep(a)) continue
        const s = LOUNGE_SEATS[i++]
        if (s) map.set(a.id, s)
      }
      return map
    }, [agents])

    const [dpr, setDpr] = useState(1.5)
    const deselect = useCallback(() => onTargetChange(null), [onTargetChange])

    return (
      <Canvas
        shadows
        dpr={dpr}
        frameloop={paused ? 'never' : 'always'}
        camera={{ position: CAM_POS, fov: 30, near: 0.5, far: 80 }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0
        }}
        style={{ background: 'radial-gradient(ellipse at 50% 38%, #f3ebe0 0%, #e2d5c4 60%, #cdbda8 100%)' }}
      >
        <Lights />
        <LoftRoom onDeselect={deselect} />
        <DeskBank desks={desks} occupied={occupied} />

        {agents.map((a) => (
          <AgentAtDesk
            key={a.id}
            agent={a}
            seat={seats.get(a.id) ?? null}
            onSelect={() => onTargetChange(a)}
            onOpen={() => onInteract(a)}
          />
        ))}

        {/* diorama camera — drag pan, right-drag orbit, wheel zoom */}
        <RpgControls
          target={CAM_TARGET}
          minDistance={4}
          maxDistance={CAM_DIST * 1.55}
          minPolarAngle={0.35}
          maxPolarAngle={1.18}
        />

        <FitCamera />

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
