// ── OrchestrationView — tabbed orchestrator/subagent webs ─────────────
// Workspace's orchestration mode. Each tab is one network: the
// ORCHESTRATOR terminal sits in the middle of the canvas, SUBAGENT
// terminals ring it, and a thin line ties each subagent to the hub
// (Tethers.tsx). Cards can be dragged by their header and resized from
// the corner; both are saved per node. Subagents come from the user (+ Subagent) or from
// the orchestrator itself via `tnet` / net.* / the MCP orchestrator tools.
//
// Cards are absolutely positioned from layoutNetwork() and keyed by node
// id, so a growing ring glides cards into place without remounting their
// terminals. Switching tabs unmounts the other web's cards — their ptys
// keep running in the supervisor and replay on return.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import {
  ArrowLeft,
  Cable,
  Check,
  Copy,
  Maximize2,
  Minimize2,
  Plus,
  Sparkles,
  X,
  Zap
} from 'lucide-react'
import clsx from 'clsx'
import { commandSessionId, type PaneAction } from '../lib/panes'
import {
  statusSnapshot,
  MAX_AGENTS,
  nodeSpawnOpts,
  nodeStatus,
  orchestratorPrimer,
  orchHostInfo,
  readScreen,
  subscribeStatus,
  useOrch,
  effectiveCommand,
  writeToNode,
  type NodeStatus,
  type OrchNetwork,
  type OrchNode
} from '../lib/orchestration'
import { Terminal, getPtyBridge } from '../terminal'
import { PaneDispatchContext } from '../workspace/pane-context'
import { CommandMenu } from '../workspace/CommandMenu'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { paneClose, paneSplit, uiTap } from '../lib/sfx'
import { expandedRect, initialView, layoutNetwork, type NetworkLayout, type Rect } from './layout'
import { fitView, persistedViews, usePanZoom } from '../lib/canvas-nav'
import { CanvasControls } from '../components/CanvasControls'
import { Tethers } from './Tethers'
import { CliBrandBadge } from '../components/CliBrand'

const IS_WIN = window.terrarium?.platform === 'win32'

const STATUS_META: Record<NodeStatus, { color: string; label: string }> = {
  starting: { color: 'var(--color-t3)', label: 'starting' },
  busy: { color: 'var(--color-working)', label: 'working' },
  idle: { color: 'var(--color-done)', label: 'idle' },
  exited: { color: 'var(--color-error)', label: 'exited' }
}

const AGENT_CLIS: readonly { label: string; command: string | undefined }[] = [
  { label: 'Claude', command: 'claude' },
  { label: 'Codex', command: 'codex' },
  { label: 'OpenCode', command: 'opencode' },
  { label: 'Devin', command: 'devin' },
  { label: 'Shell', command: IS_WIN ? 'powershell.exe' : '/bin/sh' }
]

const iconBtn =
  'flex h-5 w-5 items-center justify-center rounded text-t4 transition-colors hover:bg-n5 hover:text-t2 disabled:pointer-events-none disabled:opacity-30'

/** A node's status badge — re-renders only when it flips (lib/orchestration). */
function useNodeStatus(sid: string): NodeStatus {
  return useSyncExternalStore(subscribeStatus, () => statusSnapshot(sid))
}

/** True while any node of the network is busy. */
function useNetBusy(net: OrchNetwork): boolean {
  const sids = [net.orchestrator, ...net.agents].map((n) => commandSessionId(n))
  return useSyncExternalStore(subscribeStatus, () => sids.some((sid) => statusSnapshot(sid) === 'busy'))
}

// ── pieces WorkspaceView embeds ───────────────────────────────────────
// Orchestration is a mode of the workspace, not a separate screen: the
// workspace toolbar hosts the network tabs + actions and its content area
// cross-fades between the pane grid and this stage.

/** Network tabs (one tab = one network) + new-network button. */
export function OrchestrationTabs() {
  const networks = useOrch((s) => s.networks)
  const activeId = useOrch((s) => s.activeId)
  const active = networks.find((n) => n.id === activeId) ?? networks[0] ?? null
  return (
    <nav className="flex min-w-0 items-center gap-0.5">
      {networks.map((n) => (
        <NetworkTab key={n.id} net={n} active={n.id === active?.id} />
      ))}
      <button
        type="button"
        onClick={() => {
          uiTap()
          useOrch.getState().createNetwork()
        }}
        title="New network — a fresh orchestrator in its own tab"
        className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-t3 transition-colors hover:bg-n4 hover:text-t1"
      >
        <Plus size={13} />
      </button>
    </nav>
  )
}

/** + Subagent and Connect for the active network. */
export function OrchestrationActions() {
  const networks = useOrch((s) => s.networks)
  const activeId = useOrch((s) => s.activeId)
  const active = networks.find((n) => n.id === activeId) ?? networks[0] ?? null
  if (!active) return null
  return (
    <>
      <SpawnButton net={active} />
      <ConnectButton net={active} />
    </>
  )
}

/** The active network's canvas (fills its parent). */
export function OrchestrationStage() {
  const networks = useOrch((s) => s.networks)
  const activeId = useOrch((s) => s.activeId)
  const active = networks.find((n) => n.id === activeId) ?? networks[0] ?? null

  // CommandMenu (CLI picker) speaks PaneAction — route its leaf patches
  // into the orchestration store instead of a workspace tree
  const dispatch = useCallback((action: PaneAction) => {
    if (action.type === 'update') useOrch.getState().updateNode(action.leafId, action.patch)
  }, [])

  return (
    <PaneDispatchContext.Provider value={dispatch}>
      <div className="relative h-full min-h-0">
        {active ? (
          <NetworkCanvas key={active.id} net={active} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <button
              type="button"
              onClick={() => useOrch.getState().createNetwork()}
              className="flex items-center gap-2 rounded-lg border border-[rgba(245,165,36,0.35)] bg-[var(--color-accent-subtle)] px-4 py-2 text-[13px] text-accent"
            >
              <Plus size={14} /> New network
            </button>
          </div>
        )}
      </div>
    </PaneDispatchContext.Provider>
  )
}

/** Standalone composition (kept for previews/tests). */
export function OrchestrationView() {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="scroll-thin flex h-10 shrink-0 select-none items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-n2 px-2">
        <OrchestrationTabs />
        <span className="flex-1" />
        <OrchestrationActions />
      </header>
      <div className="min-h-0 flex-1">
        <OrchestrationStage />
      </div>
    </div>
  )
}

export default OrchestrationView

// ── tabs ──────────────────────────────────────────────────────────────

function NetworkTab({ net, active }: { net: OrchNetwork; active: boolean }) {
  const [editing, setEditing] = useState(false)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 2500)
    return () => clearTimeout(id)
  }, [armed])
  const busy = useNetBusy(net)

  return (
    <div
      className={clsx(
        'group/tab flex h-7 shrink-0 items-center gap-1.5 rounded-md border pl-2.5 pr-1 text-[12px] transition-colors',
        active
          ? 'border-[var(--border-default)] bg-n4 text-t1'
          : 'border-transparent text-t3 hover:bg-n3 hover:text-t2'
      )}
      onClick={() => useOrch.getState().setActive(net.id)}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
    >
      <span
        className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', busy && 'status-pulse')}
        style={{ background: busy ? 'var(--color-working)' : 'var(--color-n8)' }}
      />
      {editing ? (
        <input
          autoFocus
          defaultValue={net.name}
          onBlur={(e) => {
            useOrch.getState().renameNetwork(net.id, e.currentTarget.value)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-24 rounded bg-n2 px-1 text-[12px] text-t1 outline-none"
        />
      ) : (
        <span className="max-w-[140px] truncate">{net.name}</span>
      )}
      <span className="tnum rounded bg-n2 px-1 text-[10px] leading-4 text-t3" title="subagents">
        {net.agents.length}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!armed) {
            setArmed(true)
            return
          }
          paneClose()
          useOrch.getState().closeNetwork(net.id)
        }}
        title={armed ? 'Click again — ends the orchestrator and every subagent' : 'Close network'}
        className={clsx(
          'flex h-5 items-center justify-center rounded transition-all',
          armed
            ? 'bg-[rgba(229,72,77,0.18)] px-1.5 text-[10.5px] text-[var(--color-error)]'
            : 'w-5 text-t4 opacity-0 hover:bg-n5 hover:text-t2 group-hover/tab:opacity-100'
        )}
      >
        {armed ? 'Close?' : <X size={11} />}
      </button>
    </div>
  )
}

// ── canvas ────────────────────────────────────────────────────────────

/** Pan/zoom per network — survives tab switches, reloads and restarts. */
// v2: world-fixed layout — v1 views framed the old window-sized layout
const netViews = persistedViews('terrarium.orchestration.views.v2')

interface DragState {
  id: string
  dx: number
  dy: number
}

interface ResizeState {
  id: string
  w: number
  h: number
}

/** Smallest a card can be resized to (world px). */
const CARD_MIN_W = 220
const CARD_MIN_H = 120

function NetworkCanvas({ net }: { net: OrchNetwork }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ W: 0, H: 0 })
  const expandedId = useOrch((s) => s.expandedId)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const measure = () => setSize({ W: el.clientWidth, H: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { W, H } = size
  const slotKey = net.agents.map((a, i) => a.slot ?? i).join(',')
  const layout = useMemo(
    () => layoutNetwork(slotKey ? slotKey.split(',').map(Number) : []),
    [slotKey]
  )

  // world rects = auto-layout slot + the card's manual nudge and size
  // (+ live drag/resize)
  const placed = useMemo((): NetworkLayout => {
    const shape = <T extends Rect>(r: T, n: OrchNode | undefined): T => {
      if (!n) return r
      const o = drag?.id === n.id ? drag : n.pos
      const s = resize?.id === n.id ? resize : n.size
      let out = r
      if (o) out = { ...out, x: out.x + o.dx, y: out.y + o.dy }
      if (s) out = { ...out, w: s.w, h: s.h }
      return out
    }
    return {
      hub: shape(layout.hub, net.orchestrator),
      slots: layout.slots.map((s, i) => shape(s, net.agents[i]))
    }
  }, [layout, net.orchestrator, net.agents, drag, resize])

  const bounds = useMemo(() => {
    const all = [placed.hub, ...placed.slots]
    const x0 = Math.min(...all.map((r) => r.x))
    const y0 = Math.min(...all.map((r) => r.y))
    const x1 = Math.max(...all.map((r) => r.x + r.w))
    const y1 = Math.max(...all.map((r) => r.y + r.h))
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }, [placed])
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds

  const expanded = expandedId ? net.agents.find((a) => a.id === expandedId) : undefined
  const hasManual = [net.orchestrator, ...net.agents].some((n) => n.pos || n.size)

  const pz = usePanZoom(hostRef, {
    min: 0.3,
    max: 2.5,
    initial: netViews.get(net.id),
    isBackground: (el) => !el.closest('[data-canvas-item],[data-canvas-ui]'),
    disabled: !!expanded,
    onFit: () => fit(),
    onCommit: (v) => netViews.set(net.id, v),
    // sideways-only canvas: no vertical travel, the wheel pans left/right
    panAxis: 'x',
    // never lose the web entirely — keep a strip of it on screen; y is
    // pinned so the network stays vertically centred at every zoom
    clamp: (v, W, H) => {
      const b = boundsRef.current
      const keep = 96
      return {
        z: v.z,
        x: Math.min(W - keep - b.x * v.z, Math.max(keep - (b.x + b.w) * v.z, v.x)),
        y: H / 2 - (b.y + b.h / 2) * v.z
      }
    }
  })
  const { view, layoutZoom, zooming, worldRef, setView, zoomBy } = pz
  const z = view.z
  const fit = () => setView(fitView(boundsRef.current, W, H, 1, 12))

  // first open of a network (no saved view): frame it at a readable zoom;
  // after that the saved pan/zoom is restored exactly
  const framed = useRef(!!netViews.get(net.id))
  useEffect(() => {
    if (W <= 0 || H <= 0) return
    if (framed.current) {
      // re-run the clamp on a restored view — it pins y to the centre line
      setView(view, false)
      return
    }
    framed.current = true
    setView(initialView(boundsRef.current, placed.hub, W, H), false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H])

  // header drag → nudge a card off its slot (world units, zoom-aware)
  const beginDrag = useCallback(
    (node: OrchNode, e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('button,input,textarea')) return
      const start = { sx: e.clientX, sy: e.clientY, base: node.pos ?? { dx: 0, dy: 0 } }
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      let moved = false
      let last: DragState | null = null
      const onMove = (ev: PointerEvent) => {
        const ddx = (ev.clientX - start.sx) / z
        const ddy = (ev.clientY - start.sy) / z
        if (!moved && Math.hypot(ddx, ddy) < 3) return
        moved = true
        last = { id: node.id, dx: start.base.dx + ddx, dy: start.base.dy + ddy }
        setDrag(last)
      }
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
        if (moved && last) useOrch.getState().moveNode(node.id, { dx: last.dx, dy: last.dy })
        setDrag(null)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    },
    [z]
  )

  // corner drag → resize a card (world units, zoom-aware); the terminal
  // refits to the new size and the size is saved on the node
  const beginResize = useCallback(
    (node: OrchNode, base: Rect, e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const sx = e.clientX
      const sy = e.clientY
      let last: ResizeState | null = null
      const onMove = (ev: PointerEvent) => {
        last = {
          id: node.id,
          w: Math.round(Math.max(CARD_MIN_W, base.w + (ev.clientX - sx) / z)),
          h: Math.round(Math.max(CARD_MIN_H, base.h + (ev.clientY - sy) / z))
        }
        setResize(last)
      }
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
        if (last) useOrch.getState().resizeNode(node.id, { w: last.w, h: last.h })
        setResize(null)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    },
    [z]
  )

  const sids = useMemo(() => net.agents.map((a) => commandSessionId(a)), [net.agents])
  // whole pixels — terminal canvases at fractional offsets render soft
  const scaled = (r: Rect): Rect => {
    const x = Math.round(r.x * z)
    const y = Math.round(r.y * z)
    return { x, y, w: Math.round((r.x + r.w) * z) - x, h: Math.round((r.y + r.h) * z) - y }
  }
  // the focus view is screen-anchored: undo the world translate
  const exp = expandedRect(W, H)
  const expandedScreen: Rect = {
    x: Math.round(exp.x - Math.round(view.x)),
    y: Math.round(exp.y - Math.round(view.y)),
    w: Math.round(exp.w),
    h: Math.round(exp.h)
  }

  return (
    <div
      ref={hostRef}
      className={clsx('absolute inset-0 overflow-hidden', !expanded && 'cursor-grab')}
    >
      {W > 0 && (
        <>
          <div
            ref={worldRef}
            className="absolute left-0 top-0"
            style={{ width: Math.round(W * z), height: Math.round(H * z) }}
          >
            <Tethers
              W={W}
              H={H}
              z={z}
              layout={placed}
              sids={sids}
              dimmed={!!expanded}
              snap={!!drag || !!resize || zooming}
            />

            <NodeCard
              net={net}
              node={net.orchestrator}
              rect={scaled(placed.hub)}
              index={0}
              zoom={layoutZoom}
              still={
                zooming || drag?.id === net.orchestrator.id || resize?.id === net.orchestrator.id
              }
              onDragStart={beginDrag}
              onResizeStart={(e) => beginResize(net.orchestrator, placed.hub, e)}
            />

            {net.agents.map((a, i) => {
              const slot = placed.slots[i]
              if (!slot) return null
              const isExp = expanded?.id === a.id
              return (
                <NodeCard
                  key={a.id}
                  net={net}
                  node={a}
                  index={i + 1}
                  rect={isExp ? expandedScreen : scaled(slot)}
                  zoom={isExp ? 1 : layoutZoom}
                  expanded={isExp}
                  still={zooming || drag?.id === a.id || resize?.id === a.id}
                  onDragStart={isExp ? undefined : beginDrag}
                  onResizeStart={isExp ? undefined : (e) => beginResize(a, slot, e)}
                />
              )
            })}

            {expanded && (
              <div
                data-canvas-item
                className="absolute z-20 bg-[rgba(4,4,6,0.6)]"
                style={{ left: -view.x, top: -view.y, width: W, height: H }}
                onClick={() => useOrch.getState().setExpanded(null)}
              />
            )}

            {net.agents.length === 0 && (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--border-default)] bg-n2/90 px-3 py-1 text-[11.5px] text-t3"
                style={{
                  left: (placed.hub.x + placed.hub.w / 2) * z,
                  top: (placed.hub.y + placed.hub.h) * z + 8
                }}
              >
                No subagents yet — the orchestrator spawns them with{' '}
                <code className="text-accent">tnet spawn</code>, or use <b className="text-t2">+ Subagent</b>
              </div>
            )}
          </div>

          {!expanded && (
            <CanvasControls
              view={view}
              onZoom={(f) => zoomBy(f)}
              onFit={fit}
              onReset={hasManual ? () => useOrch.getState().resetLayout(net.id) : undefined}
              resetTitle="Snap every card back into the ring"
              minimap={
                // only once you've wandered off the auto view
                Math.abs(z - 1) < 0.01 && Math.abs(view.x) < 2 && Math.abs(view.y) < 2
                  ? undefined
                  : {
                W,
                H,
                items: [
                  { ...placed.hub, hub: true },
                  ...placed.slots.map((s, i) => ({
                    ...s,
                    color: STATUS_HEX[nodeStatus(sids[i] ?? '')]
                  }))
                ],
                onJump: (wx, wy) => setView({ z, x: W / 2 - wx * z, y: H / 2 - wy * z })
              }
              }
            />
          )}
        </>
      )}
    </div>
  )
}

const STATUS_HEX: Record<NodeStatus, string> = {
  starting: '#4a4c55',
  busy: '#ffb224',
  idle: '#46a758',
  exited: '#e5484d'
}

// ── cards ─────────────────────────────────────────────────────────────

function NodeCard({
  net,
  node,
  rect,
  index,
  zoom,
  expanded = false,
  still = false,
  onDragStart,
  onResizeStart
}: {
  net: OrchNetwork
  node: OrchNode
  /** Position inside the world layer, already zoomed. */
  rect: Rect
  index: number
  /** Layout zoom — the terminal font scales with it, its grid doesn't. */
  zoom: number
  expanded?: boolean
  /** Skip the glide (zooming / being dragged) so it tracks 1:1. */
  still?: boolean
  onDragStart?: (node: OrchNode, e: React.PointerEvent) => void
  /** Corner handle drag — resize the card (absent while expanded). */
  onResizeStart?: (e: React.PointerEvent) => void
}) {
  const [cmdOpen, setCmdOpen] = useState(false)
  const hub = node.role === 'orchestrator'
  const sid = commandSessionId(node)
  // startup resume in flight — mounting now would spawn a fresh CLI
  const restoring = useOrch((s) => s.restoring)
  const status = useNodeStatus(sid)
  const meta = STATUS_META[status]
  const headerH = hub ? 32 : 28
  const compact = !hub && !expanded && rect.h - headerH < 92
  const glide = '320ms var(--ease-out-expo)'

  return (
    <div
      data-canvas-item
      className={clsx(
        'group/card absolute flex cursor-default flex-col overflow-hidden rounded-lg border bg-base',
        expanded
          ? 'z-30 border-[var(--border-strong)] shadow-[0_16px_48px_rgba(0,0,0,0.5)]'
          : clsx(
              'z-10 hover:border-[var(--border-strong)]',
              hub ? 'border-[var(--border-strong)]' : 'border-[var(--border-default)]'
            )
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transition: still
          ? 'border-color 180ms'
          : `left ${glide}, top ${glide}, width ${glide}, height ${glide}, border-color 180ms`
      }}
    >
      <header
        className={clsx(
          'grid shrink-0 select-none items-center gap-2 border-b border-[var(--border-subtle)] bg-n2 pl-2.5 pr-1.5',
          onDragStart && 'cursor-move'
        )}
        // [identity | CLI brand | controls] — equal side columns keep the
        // brand dead-centre and the title can never run under it
        style={{ height: headerH, gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)' }}
        onPointerDown={onDragStart ? (e) => onDragStart(node, e) : undefined}
        onDoubleClick={() => !hub && useOrch.getState().setExpanded(expanded ? null : node.id)}
        title={onDragStart ? 'Drag to move · double-click to focus' : undefined}
      >
        <div className="flex min-w-0 items-center gap-1.5">
        {hub ? (
          <span className="shrink-0 rounded border border-[rgba(245,165,36,0.35)] bg-[var(--color-accent-subtle)] px-1.5 text-[10.5px] font-semibold leading-4 tracking-[0.04em] text-accent uppercase">
            Orchestrator
          </span>
        ) : (
          <span className="tnum shrink-0 rounded bg-n4 px-1 font-mono text-[10px] leading-4 text-t3">
            #{index}
          </span>
        )}
        <span
          className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', status === 'busy' && 'status-pulse')}
          style={{ background: meta.color }}
          title={meta.label}
        />
        <span
          className={clsx('min-w-0 truncate leading-none text-[12px]', hub ? 'text-t1' : 'text-t2')}
          title={node.task ? `${node.title ?? ''} — ${node.task}` : undefined}
        >
          {hub ? net.name : node.title}
          {!hub && node.task && <span className="text-t4"> — {node.task}</span>}
        </span>
        </div>

        {/* which agent CLI runs here — centred on the card */}
        <span className="pointer-events-none flex justify-center">
          <CliBrandBadge command={effectiveCommand(node)} />
        </span>

        <div
          className={clsx(
            'flex min-w-0 items-center justify-end gap-0.5',
            !hub && !cmdOpen && 'opacity-0 transition-opacity group-hover/card:opacity-100'
          )}
        >
          <CommandMenu leaf={node} open={cmdOpen} onOpenChange={setCmdOpen} className={iconBtn} />
          {hub ? (
            <>
              <HubButton
                icon={<Zap size={11} />}
                label="Prime"
                title="Brief the orchestrator CLI on how to spawn and drive subagents"
                onClick={() => writeToNode(sid, orchestratorPrimer(net), { enter: true })}
              />
              <HubButton
                icon={<Plus size={11} />}
                label="Subagent"
                title="Tether a new subagent to this orchestrator"
                disabled={net.agents.length >= MAX_AGENTS}
                onClick={() => {
                  paneSplit()
                  useOrch.getState().spawnAgent(net.id)
                }}
              />
            </>
          ) : (
            <>
              <button
                type="button"
                className={iconBtn}
                title={expanded ? 'Back into the web' : 'Focus this subagent'}
                onClick={() => useOrch.getState().setExpanded(expanded ? null : node.id)}
              >
                {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              </button>
              <button
                type="button"
                className={clsx(iconBtn, 'hover:text-[var(--color-needs)]')}
                title="Cut the tether — ends this subagent"
                onClick={() => {
                  paneClose()
                  useOrch.getState().removeAgent(net.id, node.id)
                }}
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <ErrorBoundary fallbackTitle={`${node.title ?? 'terminal'} error`}>
          {compact ? (
            <CompactPreview sid={sid} onOpen={() => useOrch.getState().setExpanded(node.id)} />
          ) : restoring ? (
            <div className="grid h-full place-items-center text-[11px] text-t4">
              Resuming session…
            </div>
          ) : (
            <Terminal
              bridge={getPtyBridge()}
              sessionId={sid}
              spawnOpts={nodeSpawnOpts(node, net)}
              fontSize={13}
              zoom={zoom}
            />
          )}
        </ErrorBoundary>
      </div>

      {onResizeStart && (
        <div
          className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 cursor-nwse-resize opacity-0 transition-opacity group-hover/card:opacity-100"
          onPointerDown={onResizeStart}
          title="Drag to resize"
        >
          <svg viewBox="0 0 14 14" className="h-full w-full text-t4" aria-hidden>
            <path d="M12 5 L5 12 M12 9 L9 12" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}

function HubButton({
  icon,
  label,
  title,
  disabled,
  onClick
}: {
  icon: ReactNode
  label: string
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        uiTap()
        onClick()
      }}
      className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}

/** Too small for a live xterm — the tail of its rendered screen instead. */
function CompactPreview({ sid, onOpen }: { sid: string; onOpen: () => void }) {
  const [text, setText] = useState('')
  useEffect(() => {
    let alive = true
    const pull = () =>
      void readScreen(sid, 6).then((t) => {
        if (alive) setText(t.split('\n').filter((l) => l.trim()).slice(-4).join('\n'))
      })
    pull()
    const id = setInterval(pull, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sid])
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open this subagent"
      className="block h-full w-full overflow-hidden bg-sunken px-2 py-1 text-left font-mono text-[10.5px] leading-[14px] whitespace-pre text-t3 hover:text-t2"
    >
      {text || '…'}
    </button>
  )
}

// ── header popovers ───────────────────────────────────────────────────

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  return { open, setOpen, ref }
}

const popoverCls =
  'absolute right-0 top-9 z-50 w-[340px] rounded-lg border border-[var(--border-default)] bg-popover p-3 shadow-[0_16px_48px_rgba(0,0,0,0.55)]'

function SpawnButton({ net }: { net: OrchNetwork }) {
  const { open, setOpen, ref } = usePopover()
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [custom, setCustom] = useState('')
  const current = net.agentCommand ?? net.orchestrator.command
  const full = net.agents.length >= MAX_AGENTS

  const spawn = () => {
    const node = useOrch.getState().spawnAgent(net.id, {
      title: name || undefined,
      task: task || undefined,
      command: custom.trim() || undefined
    })
    if (!node) return
    paneSplit()
    setName('')
    setTask('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={full}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-[rgba(245,165,36,0.35)] bg-[var(--color-accent-subtle)] px-2.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-[rgba(245,165,36,0.18)] disabled:opacity-40"
      >
        <Plus size={12} />
        Subagent
      </button>
      {open && (
        <div className={popoverCls}>
          <p className="micro-label mb-2">Tether a subagent</p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional — a Latin one is picked)"
            className="mb-2 h-7 w-full rounded-md border border-[var(--border-default)] bg-n2 px-2 text-[12px] text-t1 outline-none focus:border-[rgba(245,165,36,0.4)]"
          />
          <p className="mb-1 text-[11px] text-t3">CLI — also the default for API spawns</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {AGENT_CLIS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  setCustom('')
                  useOrch.getState().setAgentCommand(net.id, c.command)
                }}
                className={clsx(
                  'flex h-6 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors',
                  !custom && current === c.command
                    ? 'border-[rgba(245,165,36,0.45)] bg-[var(--color-accent-subtle)] text-accent'
                    : 'border-[var(--border-default)] text-t3 hover:text-t1'
                )}
              >
                {!custom && current === c.command && <Check size={10} />}
                {c.label}
              </button>
            ))}
          </div>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="…or a custom command for this one"
            className="mb-2 h-7 w-full rounded-md border border-[var(--border-default)] bg-n2 px-2 font-mono text-[11.5px] text-t1 outline-none focus:border-[rgba(245,165,36,0.4)]"
          />
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) spawn()
            }}
            rows={3}
            placeholder="First task (typed in once the CLI is ready) — optional"
            className="mb-2 w-full resize-none rounded-md border border-[var(--border-default)] bg-n2 px-2 py-1.5 text-[12px] text-t1 outline-none focus:border-[rgba(245,165,36,0.4)]"
          />
          <button
            type="button"
            onClick={spawn}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[12px] font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            <Sparkles size={12} /> Spawn subagent
            <span className="text-[10px] opacity-60">Ctrl+Enter</span>
          </button>
        </div>
      )}
    </div>
  )
}

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="group/line flex items-start gap-1.5 rounded bg-n2 px-2 py-1">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-4 text-t2">{text}</code>
      <button
        type="button"
        title="Copy"
        className="shrink-0 text-t4 hover:text-t1"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          })
        }}
      >
        {done ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  )
}

function ConnectButton({ net }: { net: OrchNetwork }) {
  const { open, setOpen, ref } = usePopover()
  const host = orchHostInfo()
  const sid = commandSessionId(net.orchestrator)
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="How the orchestrator drives this network (tnet · MCP · HTTP)"
        className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n3 px-2.5 text-[11.5px] text-t2 transition-colors hover:bg-n4 hover:text-t1"
      >
        <Cable size={12} />
        Connect
      </button>
      {open && (
        <div className={clsx(popoverCls, 'w-[420px]')}>
          <p className="micro-label mb-1.5">Orchestrator toolkit</p>
          <p className="mb-2 text-[11.5px] leading-4 text-t3">
            The orchestrator terminal already carries <code className="text-t2">TERRARIUM_SID</code>,{' '}
            <code className="text-t2">TERRARIUM_NET</code> and{' '}
            <code className="text-t2">TERRARIUM_WS_CMD</code> — every call below lands in{' '}
            <b className="text-t2">{net.name}</b>.
          </p>

          <p className="mb-1 text-[11px] font-medium text-t2">tnet CLI {host ? '(on PATH)' : ''}</p>
          {host ? (
            <div className="mb-2 space-y-1">
              <CopyLine text={'tnet spawn --cli claude --name Scout "map the auth flow"'} />
              <CopyLine text={'tnet ask Scout "summarise what you found"'} />
              <CopyLine text="tnet ls  ·  tnet read 1  ·  tnet wait all  ·  tnet kill 1" />
            </div>
          ) : (
            <p className="mb-2 rounded bg-n2 px-2 py-1 text-[11px] text-t3">
              Restart the app once to install <code>tnet</code> on network terminals' PATH — the HTTP
              and MCP routes below already work.
            </p>
          )}

          <p className="mb-1 text-[11px] font-medium text-t2">MCP (terrarium-mcp)</p>
          <p className="mb-2 text-[11px] leading-4 text-t3">
            <code className="text-t2">orchestrator_info · _spawn · _send · _ask · _read · _wait · _kill</code>{' '}
            — started from the orchestrator they auto-target this network.
          </p>

          <p className="mb-1 text-[11px] font-medium text-t2">Raw HTTP</p>
          <div className="mb-3">
            <CopyLine
              text={
                IS_WIN
                  ? `irm $env:TERRARIUM_WS_CMD -Method Post -Body (@{cmd='net.info';sid=$env:TERRARIUM_SID}|ConvertTo-Json)`
                  : `curl -s $TERRARIUM_WS_CMD -d '{"cmd":"net.info","sid":"'$TERRARIUM_SID'"}'`
              }
            />
          </div>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                writeToNode(sid, orchestratorPrimer(net), { enter: true })
                setOpen(false)
              }}
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent text-[12px] font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]"
            >
              <Zap size={12} /> Prime orchestrator
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(orchestratorPrimer(net))}
              className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-[12px] text-t2 hover:text-t1"
            >
              <Copy size={12} /> Primer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
