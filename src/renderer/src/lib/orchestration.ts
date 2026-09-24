// ── orchestration — tabbed orchestrator ⇄ subagent networks ───────────
// Orchestration mode swaps the workspace's split grid for a hub-and-spoke
// canvas: one ORCHESTRATOR terminal in the middle, any number of SUBAGENT
// terminals around it, each tethered to the hub. Every tab is exactly one
// network. The orchestrator (an agent CLI) grows its own web through the
// `net.*` commands on the pane bridge (/cmd) — wrapped by the `tnet` CLI
// main installs on the orchestrator's PATH and by the MCP server's
// `orchestrator_*` tools.
//
// State lives here, not in the view: net.* commands must work while the
// user is looking at the office. Node ids carry the `net-` prefix so the
// workspace orphan reaper never mistakes a network session for a stale
// pane. Sessions run in the detached pty supervisor like every terminal —
// closing a tab (or switching away) never kills a pty; removing a node does.

import { create } from 'zustand'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { PaneCmdEnvelope, PaneCmdResult } from '@shared/pane-bridge'
import type { PtySpawnOpts } from '@shared/pty'
import { isResumableCli, resumeSpawnCommand, type NodeResume } from '@shared/cli-resume'
import { cliFromCommandLine } from '@shared/cli-detect'
import { commandSessionId, newPaneId, type PaneLeaf } from './panes'
import { getPty } from './ipc'
import { paneBridgeCmdUrl } from './pane-bridge'
import { randomLatinName } from './latin-names'
import { useApp } from './store'

// ── types ─────────────────────────────────────────────────────────────

export type OrchRole = 'orchestrator' | 'subagent'

export interface OrchNode extends PaneLeaf {
  role: OrchRole
  /** Job the node was spawned for — card subtitle + its first prompt. */
  task?: string
  /** Who opened it: the user (UI) or the orchestrator (API). */
  by: 'user' | 'api'
  createdAt: number
  /** Ring slot (subagents) — fixed at spawn so the ring never reshuffles. */
  slot?: number
  /** Manual nudge from the auto-layout slot (world px) — card dragged. */
  pos?: { dx: number; dy: number }
  /** Manual card size (world px) — card resized from its corner. */
  size?: { w: number; h: number }
  /** CLI session this node was last seen in — respawns resume it (see restoreNodes). */
  resume?: NodeResume
}

export interface OrchNetwork {
  id: string
  name: string
  /**
   * What the network is for — a short category ("Senior loop") shown after
   * the name: "Web 1: Senior loop". Set by the user (double-click the tab)
   * or by the orchestrator itself (`tnet topic …` / net.topic).
   */
  topic?: string
  orchestrator: OrchNode
  agents: OrchNode[]
  /** CLI new subagents run when the caller doesn't pick one. */
  agentCommand?: string
  createdAt: number
}

/** How a network is laid out: free pan/zoom canvas, or a tiled workspace. */
export type OrchLayout = 'canvas' | 'workspace'

/** "Web 1: Senior loop" — the name, plus the topic when one is set. */
export function networkLabel(net: Pick<OrchNetwork, 'name' | 'topic'>): string {
  return net.topic ? `${net.name}: ${net.topic}` : net.name
}

/** Live state of a node's pty, derived from its output stream. */
export type NodeStatus = 'starting' | 'busy' | 'idle' | 'exited'

/** Subagent ceiling per network — keeps the ring legible. */
export const MAX_AGENTS = 24
/** Output within this window reads as "working". */
export const BUSY_WINDOW_MS = 2500
/** Every orchestration node id starts with this — see isOrchestrationSid. */
export const ORCH_ID_PREFIX = 'net-'

const STORAGE_KEY = 'terrarium.orchestration'
const IS_WIN = window.terrarium?.platform === 'win32'
const DEFAULT_SHELL = IS_WIN ? 'powershell.exe' : '/bin/sh'

/** True for pty session ids owned by an orchestration network. */
export function isOrchestrationSid(sid: string): boolean {
  return sid.startsWith(ORCH_ID_PREFIX)
}

// ── host info (tnet on PATH) ──────────────────────────────────────────
// main installs the `tnet` helper under ~/.terrarium/bin and reports the
// exact PATH key/value so network terminals get it prepended. An older
// preload (app not restarted yet) has no orchInfo — terminals then run
// without tnet; the raw /cmd API still works.

export interface OrchHostInfo {
  binDir: string
  pathKey: string
  pathValue: string
  delimiter: string
  guide: string
}

let hostInfo: OrchHostInfo | null = null
const hostReady: Promise<void> = (async () => {
  try {
    const fn = window.terrarium?.orchInfo
    if (fn) hostInfo = (await fn()) ?? null
  } catch {
    hostInfo = null
  }
})()

export function orchHostInfo(): OrchHostInfo | null {
  return hostInfo
}

// ── construction ──────────────────────────────────────────────────────

function projectRoot(): string | undefined {
  return useApp.getState().projects[0]?.rootPath
}

function makeNode(
  role: OrchRole,
  opts: { title?: string; command?: string; cwd?: string; task?: string; by?: 'user' | 'api' }
): OrchNode {
  return {
    type: 'leaf',
    id: newPaneId('net'),
    kind: 'terminal',
    refId: null,
    title: opts.title,
    command: opts.command?.trim() || undefined,
    cwd: opts.cwd?.trim() || undefined,
    role,
    task: opts.task?.trim() || undefined,
    by: opts.by ?? 'user',
    createdAt: Date.now()
  }
}

/** Every node of a network, orchestrator first. */
export function networkNodes(net: OrchNetwork): OrchNode[] {
  return [net.orchestrator, ...net.agents]
}

function splitCommand(command: string): { command: string; args?: string[] } {
  const parts = command.trim().split(/\s+/)
  return { command: parts[0], args: parts.length > 1 ? parts.slice(1) : undefined }
}

/**
 * Spawn options for a node's pty — shared by the pre-spawn here and the
 * card's <Terminal> so both describe the exact same session.
 */
export function nodeSpawnOpts(node: OrchNode, net: OrchNetwork): PtySpawnOpts {
  const sid = commandSessionId(node)
  const env: Record<string, string> = {
    TERRARIUM_SID: sid,
    TERRARIUM_NET: net.id,
    TERRARIUM_NET_NAME: net.name,
    TERRARIUM_ROLE: node.role,
    TERRARIUM_NODE: node.id
  }
  const cmdUrl = paneBridgeCmdUrl()
  if (cmdUrl) {
    env.TERRARIUM_BROWSER_CMD = cmdUrl
    env.TERRARIUM_WS_CMD = cmdUrl
  }
  if (hostInfo) {
    env[hostInfo.pathKey] = `${hostInfo.binDir}${hostInfo.delimiter}${hostInfo.pathValue}`
    env.TERRARIUM_ORCH_GUIDE = hostInfo.guide
  }
  // a node whose CLI died with the machine comes back in its conversation;
  // the sid stays keyed on node.command, so the card and tracking don't move
  const r = node.resume
  const base = node.command?.trim() || DEFAULT_SHELL
  const resumed = r?.active && r.id ? resumeSpawnCommand(base, isShellCommand(node.command), { ...r, id: r.id }) : null
  return {
    sessionId: sid,
    cwd: (resumed && r?.cwd?.trim()) || node.cwd?.trim() || projectRoot() || '.',
    env,
    ...splitCommand(resumed ?? base)
  }
}

/** Start the node's pty now so it runs even before its card mounts. */
async function preSpawn(node: OrchNode, net: OrchNetwork): Promise<void> {
  const pty = getPty()
  if (!pty) return
  await hostReady
  const sid = commandSessionId(node)
  const info = await pty.attach(sid).catch(() => null)
  if (info && info.status !== 'exited' && info.status !== 'dead') return
  await pty.spawn(nodeSpawnOpts(node, net)).catch(() => undefined)
}

// ── persistence ───────────────────────────────────────────────────────

interface Persisted {
  /** 2 = world-fixed layout (v1 nudges were relative to the window size). */
  v: 1 | 2
  enabled: boolean
  activeId: string | null
  networks: OrchNetwork[]
  lastOrchestratorCommand?: string
  layout?: OrchLayout
}

function normNode(raw: unknown, role: OrchRole, keepLayout = true): OrchNode | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, unknown>
  if (typeof n.id !== 'string' || !n.id.startsWith(ORCH_ID_PREFIX)) return null
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
  return {
    type: 'leaf',
    id: n.id,
    kind: 'terminal',
    refId: null,
    title: s(n.title),
    command: s(n.command),
    cwd: s(n.cwd),
    role,
    task: s(n.task),
    by: n.by === 'api' ? 'api' : 'user',
    createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
    slot: typeof n.slot === 'number' && n.slot >= 0 ? Math.floor(n.slot) : undefined,
    pos: keepLayout ? normPos(n.pos) : undefined,
    size: keepLayout ? normSize(n.size) : undefined,
    resume: normResume(n.resume)
  }
}

function normResume(v: unknown): NodeResume | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  if (!isResumableCli(typeof r.cli === 'string' ? r.cli : null)) return undefined
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : undefined)
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  return {
    cli: r.cli as NodeResume['cli'],
    id: str(r.id),
    pid: num(r.pid),
    since: num(r.since),
    cwd: str(r.cwd),
    active: r.active === true
  }
}

/** Smallest ring slot no agent holds. */
function freeSlot(agents: OrchNode[]): number {
  const taken = new Set(agents.map((a) => a.slot))
  let k = 0
  while (taken.has(k)) k++
  return k
}

/** Give every agent a unique slot (older saves had none). */
function withSlots(agents: OrchNode[]): OrchNode[] {
  const seen = new Set<number>()
  const out = agents.map((a) => {
    if (a.slot === undefined || seen.has(a.slot)) return { ...a, slot: undefined }
    seen.add(a.slot)
    return a
  })
  for (const a of out) {
    if (a.slot !== undefined) continue
    let k = 0
    while (seen.has(k)) k++
    seen.add(k)
    a.slot = k
  }
  return out
}

function normSize(v: unknown): OrchNode['size'] {
  if (!v || typeof v !== 'object') return undefined
  const { w, h } = v as Record<string, unknown>
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w + h)
    ? { w, h }
    : undefined
}

function normPos(v: unknown): OrchNode['pos'] {
  if (!v || typeof v !== 'object') return undefined
  const { dx, dy } = v as Record<string, unknown>
  return typeof dx === 'number' && typeof dy === 'number' && Number.isFinite(dx + dy)
    ? { dx, dy }
    : undefined
}

function load(): Omit<Persisted, 'v'> {
  const empty = { enabled: false, activeId: null, networks: [], layout: 'canvas' as OrchLayout }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const p = JSON.parse(raw) as Partial<Persisted>
    const keepLayout = p.v === 2
    const networks: OrchNetwork[] = []
    for (const r of Array.isArray(p.networks) ? p.networks : []) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue
      const orchestrator = normNode(r.orchestrator, 'orchestrator', keepLayout)
      if (!orchestrator) continue
      const agents = withSlots(
        (Array.isArray(r.agents) ? r.agents : [])
          .map((a) => normNode(a, 'subagent', keepLayout))
          .filter((a): a is OrchNode => !!a)
          .slice(0, MAX_AGENTS)
      )
      networks.push({
        id: r.id,
        name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Network',
        topic: typeof r.topic === 'string' && r.topic.trim() ? r.topic.trim() : undefined,
        orchestrator,
        agents,
        agentCommand: typeof r.agentCommand === 'string' ? r.agentCommand : undefined,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now()
      })
    }
    const activeId =
      typeof p.activeId === 'string' && networks.some((n) => n.id === p.activeId)
        ? p.activeId
        : (networks[0]?.id ?? null)
    return {
      enabled: p.enabled === true,
      activeId,
      networks,
      lastOrchestratorCommand:
        typeof p.lastOrchestratorCommand === 'string' ? p.lastOrchestratorCommand : undefined,
      layout: p.layout === 'workspace' ? 'workspace' : 'canvas'
    }
  } catch {
    return empty
  }
}

// ── store ─────────────────────────────────────────────────────────────

export interface SpawnAgentOpts {
  title?: string
  command?: string
  cwd?: string
  task?: string
  by?: 'user' | 'api'
}

interface OrchState {
  enabled: boolean
  networks: OrchNetwork[]
  activeId: string | null
  /** Subagent blown up over the canvas (focus view), if any. */
  expandedId: string | null
  /** Remembered CLI for the next network's orchestrator. */
  lastOrchestratorCommand?: string
  /**
   * Startup: nodes whose CLI died with the machine are being resolved to
   * their sessions — cards hold off spawning until then (else they'd race
   * in with a fresh CLI).
   */
  restoring: boolean
  /** Canvas (pan/zoom web) or Workspace (tiles around the orchestrator). */
  layout: OrchLayout

  setEnabled(on: boolean): void
  setLayout(layout: OrchLayout): void
  createNetwork(opts?: { name?: string; command?: string; topic?: string }): OrchNetwork
  closeNetwork(id: string): void
  renameNetwork(id: string, name: string): void
  /** Set (or clear, with '') what the network is for. */
  setNetworkTopic(id: string, topic: string): void
  setActive(id: string): void
  setAgentCommand(netId: string, command: string | undefined): void
  spawnAgent(netId: string, opts?: SpawnAgentOpts): OrchNode | null
  removeAgent(netId: string, nodeId: string): void
  updateNode(nodeId: string, patch: Partial<Omit<PaneLeaf, 'type' | 'id'>>): void
  setExpanded(nodeId: string | null): void
  /** Set (or clear) a card's manual offset from its auto-layout slot. */
  moveNode(nodeId: string, pos: OrchNode['pos']): void
  /** Set (or clear) a card's manual size. */
  resizeNode(nodeId: string, size: OrchNode['size']): void
  /** Drop every manual offset and size — back to the auto ring. */
  resetLayout(netId: string): void
}

function nextNetworkName(networks: OrchNetwork[]): string {
  const taken = new Set(networks.map((n) => n.name))
  for (let i = 1; ; i++) {
    const name = `Web ${i}`
    if (!taken.has(name)) return name
  }
}

function takenTitles(net: OrchNetwork): Set<string> {
  return new Set(networkNodes(net).map((n) => n.title).filter((t): t is string => !!t))
}

function mapNetwork(
  networks: OrchNetwork[],
  id: string,
  fn: (n: OrchNetwork) => OrchNetwork
): OrchNetwork[] {
  return networks.map((n) => (n.id === id ? fn(n) : n))
}

const initial = load()

export const useOrch = create<OrchState>((set, get) => ({
  ...initial,
  layout: initial.layout ?? 'canvas',
  expandedId: null,
  // set before any card can mount — restoreNodes clears it
  restoring: initial.networks.some((net) => networkNodes(net).some((n) => n.resume?.active)),

  setEnabled(on) {
    if (on && get().networks.length === 0) get().createNetwork()
    set({ enabled: on, expandedId: null })
  },

  setLayout(layout) {
    if (layout !== get().layout) set({ layout, expandedId: null })
  },

  createNetwork(opts = {}) {
    const s = get()
    const command = opts.command ?? s.lastOrchestratorCommand
    const net: OrchNetwork = {
      id: newPaneId('web'),
      name: opts.name?.trim() || nextNetworkName(s.networks),
      topic: opts.topic?.trim() || undefined,
      orchestrator: makeNode('orchestrator', { title: 'Orchestrator', command }),
      agents: [],
      createdAt: Date.now()
    }
    set({ networks: [...s.networks, net], activeId: net.id, expandedId: null })
    void preSpawn(net.orchestrator, net)
    return net
  },

  closeNetwork(id) {
    const s = get()
    const net = s.networks.find((n) => n.id === id)
    if (!net) return
    for (const node of networkNodes(net)) killNode(node)
    const rest = s.networks.filter((n) => n.id !== id)
    const idx = s.networks.findIndex((n) => n.id === id)
    const activeId =
      s.activeId === id ? (rest[Math.min(idx, rest.length - 1)]?.id ?? null) : s.activeId
    set({ networks: rest, activeId, expandedId: null })
  },

  renameNetwork(id, name) {
    const v = name.trim()
    if (!v) return
    set({ networks: mapNetwork(get().networks, id, (n) => ({ ...n, name: v })) })
  },

  setNetworkTopic(id, topic) {
    const v = topic.replace(/\s+/g, ' ').trim().slice(0, 48) || undefined
    set({ networks: mapNetwork(get().networks, id, (n) => ({ ...n, topic: v })) })
  },

  setActive(id) {
    if (get().networks.some((n) => n.id === id)) set({ activeId: id, expandedId: null })
  },

  setAgentCommand(netId, command) {
    const c = command?.trim() || undefined
    set({ networks: mapNetwork(get().networks, netId, (n) => ({ ...n, agentCommand: c })) })
  },

  spawnAgent(netId, opts = {}) {
    const net = get().networks.find((n) => n.id === netId)
    if (!net || net.agents.length >= MAX_AGENTS) return null
    const command =
      opts.command?.trim() || net.agentCommand || net.orchestrator.command || undefined
    const node = makeNode('subagent', {
      title: opts.title?.trim() || randomLatinName(takenTitles(net)),
      command,
      cwd: opts.cwd ?? net.orchestrator.cwd,
      task: opts.task,
      by: opts.by
    })
    node.slot = freeSlot(net.agents)
    const next = { ...net, agents: [...net.agents, node] }
    set({ networks: mapNetwork(get().networks, netId, () => next) })
    track(commandSessionId(node))
    void preSpawn(node, next)
    if (node.task) void deliverWhenReady(commandSessionId(node), node.task)
    return node
  },

  removeAgent(netId, nodeId) {
    const net = get().networks.find((n) => n.id === netId)
    const node = net?.agents.find((a) => a.id === nodeId)
    if (!net || !node) return
    killNode(node)
    set({
      networks: mapNetwork(get().networks, netId, (n) => ({
        ...n,
        agents: n.agents.filter((a) => a.id !== nodeId)
      })),
      expandedId: get().expandedId === nodeId ? null : get().expandedId
    })
  },

  updateNode(nodeId, patch) {
    const s = get()
    let lastOrchestratorCommand = s.lastOrchestratorCommand
    const networks = s.networks.map((net) => {
      const hit = networkNodes(net).find((n) => n.id === nodeId)
      if (!hit) return net
      const next: OrchNode = { ...hit, ...patch, type: 'leaf', id: hit.id, kind: 'terminal' }
      // a new binding runs something else — the old conversation isn't its
      if ('command' in patch || 'cwd' in patch) next.resume = undefined
      // a new command/cwd re-keys the session — retire the old process
      if (commandSessionId(next) !== commandSessionId(hit)) killNode(hit)
      if (hit.role === 'orchestrator') {
        if ('command' in patch) lastOrchestratorCommand = next.command
        return { ...net, orchestrator: next }
      }
      return { ...net, agents: net.agents.map((a) => (a.id === nodeId ? next : a)) }
    })
    set({ networks, lastOrchestratorCommand })
  },

  setExpanded(nodeId) {
    set({ expandedId: nodeId })
  },

  moveNode(nodeId, pos) {
    const p = pos && (Math.abs(pos.dx) > 0.5 || Math.abs(pos.dy) > 0.5) ? pos : undefined
    const place = (n: OrchNode) => (n.id === nodeId ? { ...n, pos: p } : n)
    set({
      networks: get().networks.map((net) =>
        networkNodes(net).some((n) => n.id === nodeId)
          ? { ...net, orchestrator: place(net.orchestrator), agents: net.agents.map(place) }
          : net
      )
    })
  },

  resizeNode(nodeId, size) {
    const fit = (n: OrchNode) => (n.id === nodeId ? { ...n, size } : n)
    set({
      networks: get().networks.map((net) =>
        networkNodes(net).some((n) => n.id === nodeId)
          ? { ...net, orchestrator: fit(net.orchestrator), agents: net.agents.map(fit) }
          : net
      )
    })
  },

  resetLayout(netId) {
    const clear = (n: OrchNode) =>
      n.pos || n.size ? { ...n, pos: undefined, size: undefined } : n
    set({
      networks: mapNetwork(get().networks, netId, (net) => ({
        ...net,
        orchestrator: clear(net.orchestrator),
        agents: net.agents.map(clear)
      }))
    })
  }
}))

let lastNetworks: OrchNetwork[] | null = null
useOrch.subscribe((s) => {
  // office / board / sessions rail list every terminal — tell them
  if (s.networks !== lastNetworks) {
    lastNetworks = s.networks
    window.dispatchEvent(new CustomEvent('terrarium:panes-updated'))
  }
  try {
    const p: Persisted = {
      v: 2,
      enabled: s.enabled,
      activeId: s.activeId,
      networks: s.networks,
      lastOrchestratorCommand: s.lastOrchestratorCommand,
      layout: s.layout
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
  syncTracking()
})

/**
 * Every orchestration terminal as a plain terminal leaf (orchestrators
 * first, then their subagents) — so the office, board and sessions rail
 * treat network terminals like any other. Titles read "Web 1: Senior loop · Orchestrator".
 */
export function orchestrationLeaves(): OrchNode[] {
  const out: OrchNode[] = []
  for (const net of useOrch.getState().networks) {
    out.push({ ...net.orchestrator, title: `${networkLabel(net)} · Orchestrator` })
    out.push(...net.agents)
  }
  return out
}

/** The network a node lives in (orchestrator or subagent). */
export function networkOfNode(nodeId: string): OrchNetwork | undefined {
  return useOrch.getState().networks.find((n) => networkNodes(n).some((x) => x.id === nodeId))
}

/**
 * Bring a network terminal on screen: workspace switches to orchestration,
 * its tab activates, a subagent pops open in focus view. Returns false for
 * unknown ids (caller falls back to its own handling).
 */
export function focusOrchestrationNode(nodeId: string): boolean {
  const net = networkOfNode(nodeId)
  if (!net) return false
  const isHub = net.orchestrator.id === nodeId
  useOrch.setState({ enabled: true, activeId: net.id, expandedId: isHub ? null : nodeId })
  return true
}

function killNode(node: OrchNode): void {
  const sid = commandSessionId(node)
  untrack(sid)
  void getPty()
    ?.kill(sid)
    .catch(() => {})
}

// ── activity tracking + shadow screens ────────────────────────────────
// Every network session is watched here, mounted card or not: output
// timestamps drive busy/idle (the tethers pulse, `net.wait` resolves),
// and a headless xterm keeps a rendered screen so `net.read` returns what
// a human would see — TUIs (claude, codex) redraw in place, so the raw
// byte tail is spinner soup.
//
// The shadow is lazy: parsing every byte of every agent twice (card +
// shadow) was the renderer's biggest steady cost with many subagents. It
// lives only for shell-bound nodes (CLI detection reads it) and for nodes
// read in the last SHADOW_TTL_MS (net.read/ask, compact previews); the
// rest are re-seeded from the supervisor's ring on the next read.

const SHADOW_TTL_MS = 60_000
const SHADOW_SWEEP_MS = 15_000
const SHADOW_SCROLLBACK = 1500

interface Track {
  sid: string
  lastOutAt: number
  lastInAt: number
  exited: boolean
  exitCode: number | null
  shadow: XTerm | null
  unsubs: (() => void)[]
  /** CLI has printed its first screen and settled — safe to type into. */
  booted: boolean
  /** Serialises writes so a queued first task lands before later sends. */
  queue: Promise<unknown>
  /** Last OSC window title the program set. */
  title: string
  /** Agent CLI detected on screen (claude, codex…) — undefined = shell. */
  cli?: string
  cliTimer?: ReturnType<typeof setTimeout>
  /** Bound to a shell — CLI detection needs the shadow kept live. */
  shellBound: boolean
  /** Last readScreen — keeps a lazy shadow alive for SHADOW_TTL_MS. */
  readAt: number
  /** Output that arrived while the shadow was seeding (null = not seeding). */
  pending: string[] | null
  seeding: Promise<void> | null
}

// ── which CLI is running right now ────────────────────────────────────
// A pane bound to `powershell` may well be running `claude` — the user
// typed it. The bound command can't tell; the screen and the window title
// can. Signatures are matched against the visible screen + title; once a
// CLI is seen it sticks until a bare shell prompt is back at the bottom.

const CLI_SIGNS: [string, RegExp][] = [
  ['claude', /Claude Code|\? for shortcuts|✻ Welcome to Claude|⏵⏵ |claude\.ai\/code|^[✳✶✻✽✢] /m],
  ['codex', /OpenAI Codex|codex-cli|>_ .*Codex/],
  // devin before gemini: Devin's model picker lists gemini-* models
  ['devin', /\bDevin\b/],
  ['cursor', /Cursor Agent|cursor-agent/i],
  // product name only — model ids (gemini-2.5-pro) appear inside other
  // CLIs' model pickers
  ['gemini', /Gemini CLI/],
  ['opencode', /\bopencode\b/i],
  ['aider', /^Aider v\d/m],
  ['copilot', /GitHub Copilot CLI|copilot-cli/i],
  ['qoder', /\bQoder\b/],
  ['amp', /\bAmp\b.*ampcode|ampcode\.com/i]
]

/** A shell waiting for input: `PS C:\x>`, `C:\x>`, `user@host:~$`. */
const SHELL_PROMPT = /^(PS [^>\n]*>|[A-Za-z]:\\[^>\n]*>|\S+@\S+[:\s][^\n]*[$#%]|[$#%])\s*$/

function detectCli(t: Track): void {
  const buf = t.shadow?.buffer.active
  if (!buf) return
  const rows = t.shadow!.rows
  const lines: string[] = []
  for (let y = Math.max(0, buf.baseY); y < buf.baseY + rows && y < buf.length; y++) {
    lines.push(buf.getLine(y)?.translateToString(true) ?? '')
  }
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last--
  const screen = lines.slice(0, last + 1).join('\n')
  const hay = t.title + '\n' + screen
  // a bare shell prompt at the bottom means the CLI has exited, even with
  // its last screen still visible above
  const atShell = last >= 0 && SHELL_PROMPT.test(lines[last].trim())
  // the title is the program naming itself — trust it over screen text
  const sign = (text: string) => CLI_SIGNS.find(([, re]) => re.test(text))?.[0]
  const cli = atShell ? undefined : (sign(t.title) ?? sign(hay) ?? t.cli)
  if (cli !== t.cli) {
    t.cli = cli
    bump()
  }
}

function scheduleDetect(t: Track): void {
  if (t.cliTimer || !t.shadow) return
  t.cliTimer = setTimeout(() => {
    t.cliTimer = undefined
    if (tracks.get(t.sid) === t) detectCli(t)
  }, 600)
}

/** Brand id of the agent CLI running in a session right now, if any. */
export function nodeCli(sid: string): string | undefined {
  return tracks.get(sid)?.cli
}

/**
 * What to brand a node with: the CLI actually on screen, else what it was
 * launched with.
 */
export function effectiveCommand(node: OrchNode): string | undefined {
  // launched straight into an agent CLI (`devin`, `claude …`) → that is the
  // answer; screen sniffing is only for shells the user typed a CLI into
  if (!isShellCommand(node.command)) return node.command
  return nodeCli(commandSessionId(node)) ?? node.command
}

function isShellCommand(command: string | undefined): boolean {
  const first = command?.trim().split(/\s+/)[0]
  if (!first) return true
  const base = first
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/, '')
  return /^(powershell|pwsh|cmd|bash|sh|zsh|fish|nu|wsl)$/.test(base)
}

const tracks = new Map<string, Track>()
const activitySubs = new Set<() => void>()
let activityVersion = 0
let bumpQueued = false

function bump(): void {
  if (bumpQueued) return
  bumpQueued = true
  setTimeout(() => {
    bumpQueued = false
    activityVersion++
    activitySubs.forEach((cb) => cb())
    checkStatuses()
  }, 150)
}

// ── status transitions ────────────────────────────────────────────────
// Cards and tabs only show busy/idle/starting/exited. Re-rendering them on
// every I/O burst (~7×/s per busy agent) plus a 1s tick was pure overhead
// with a big web; they subscribe here and wake only when a status flips.
// busy → idle happens with no I/O at all, hence the 1s decay check.

const statusSubs = new Set<() => void>()
const lastStatus = new Map<string, NodeStatus>()
let statusVersion = 0

function checkStatuses(): void {
  const now = Date.now()
  let changed = false
  for (const sid of tracks.keys()) {
    const st = nodeStatus(sid, now)
    if (lastStatus.get(sid) !== st) {
      lastStatus.set(sid, st)
      changed = true
    }
  }
  for (const sid of [...lastStatus.keys()]) {
    if (!tracks.has(sid)) {
      lastStatus.delete(sid)
      changed = true
    }
  }
  if (changed) {
    statusVersion++
    statusSubs.forEach((cb) => cb())
  }
}
setInterval(checkStatuses, 1000)

/** useSyncExternalStore pair — fires only when some node's status changes. */
export function subscribeStatus(cb: () => void): () => void {
  statusSubs.add(cb)
  return () => statusSubs.delete(cb)
}
/** Bumps whenever any status flips — for lists that show many nodes. */
export function statusVersionSnapshot(): number {
  return statusVersion
}
/** Stable per-sid snapshot for useSyncExternalStore (cached between flips). */
export function statusSnapshot(sid: string): NodeStatus {
  return lastStatus.get(sid) ?? nodeStatus(sid)
}

/** useSyncExternalStore pair — fires (throttled) on any network I/O. */
export function subscribeActivity(cb: () => void): () => void {
  activitySubs.add(cb)
  return () => activitySubs.delete(cb)
}
export function activitySnapshot(): number {
  return activityVersion
}

let XTermCtor: typeof XTerm | null = null
const xtermLoad = import('@xterm/xterm')
  .then((m) => {
    XTermCtor = m.Terminal
  })
  .catch(() => undefined)

function track(sid: string, shellBound?: boolean): Track | null {
  const existing = tracks.get(sid)
  if (existing) {
    if (shellBound !== undefined && shellBound !== existing.shellBound) {
      existing.shellBound = shellBound
      if (shellBound) void ensureShadow(existing)
    }
    return existing
  }
  const pty = getPty()
  if (!pty) return null
  const t: Track = {
    sid,
    lastOutAt: 0,
    lastInAt: 0,
    exited: false,
    exitCode: null,
    shadow: null,
    unsubs: [],
    booted: false,
    queue: Promise.resolve(),
    title: '',
    shellBound: shellBound ?? false,
    readAt: 0,
    pending: null,
    seeding: null
  }
  tracks.set(sid, t)
  t.unsubs.push(
    pty.onData(sid, (d) => {
      t.lastOutAt = Date.now()
      t.exited = false
      // chunks that land while the shadow is seeding are held, not
      // dropped — a fresh CLI's first screen arrives exactly then
      if (t.pending) t.pending.push(d)
      else t.shadow?.write(d)
      scheduleDetect(t)
      bump()
    }),
    pty.onExit(sid, (e) => {
      t.exited = true
      t.exitCode = e.exitCode
      bump()
    }),
    pty.onStatus(sid, (st) => {
      t.exited = st === 'exited' || st === 'dead'
      bump()
    })
  )
  if (t.shellBound) void ensureShadow(t)
  return t
}

/** Seed the shadow screen from the supervisor's ring, then keep it live. */
function ensureShadow(t: Track): Promise<void> {
  if (t.shadow) return Promise.resolve()
  if (t.seeding) return t.seeding
  const pty = getPty()
  if (!pty) return Promise.resolve()
  t.seeding = (async () => {
    await xtermLoad
    if (!XTermCtor || tracks.get(t.sid) !== t) return
    const shadow = new XTermCtor({
      cols: 200,
      rows: 60,
      scrollback: SHADOW_SCROLLBACK,
      allowProposedApi: true
    })
    shadow.onTitleChange((title) => {
      t.title = title
      scheduleDetect(t)
    })
    // everything received so far is inside the ring tail we're about to read
    t.pending = []
    const tail = (await pty.readTail?.(t.sid, 200_000).catch(() => '')) ?? ''
    const held = t.pending
    t.pending = null
    if (tracks.get(t.sid) !== t) {
      shadow.dispose()
      return
    }
    if (tail) shadow.write(tail)
    for (const d of held) shadow.write(d)
    t.shadow = shadow
    // resolves after the seeded ring has parsed
    await new Promise<void>((r) => shadow.write('', r))
    detectCli(t)
  })().finally(() => {
    t.seeding = null
  })
  return t.seeding
}

function dropShadow(t: Track): void {
  clearTimeout(t.cliTimer)
  t.cliTimer = undefined
  t.shadow?.dispose()
  t.shadow = null
}

setInterval(() => {
  const now = Date.now()
  for (const t of tracks.values()) {
    if (t.shadow && !t.shellBound && !t.seeding && now - t.readAt > SHADOW_TTL_MS) dropShadow(t)
  }
}, SHADOW_SWEEP_MS)

function untrack(sid: string): void {
  const t = tracks.get(sid)
  if (!t) return
  tracks.delete(sid)
  t.unsubs.forEach((u) => u())
  clearTimeout(t.cliTimer)
  t.shadow?.dispose()
}

let statusSyncAt = 0

/** Track every live node, drop the rest; refresh exit status from the host. */
function syncTracking(): void {
  const want = new Set<string>()
  for (const net of useOrch.getState().networks) {
    for (const node of networkNodes(net)) want.add(commandSessionId(node))
  }
  const shell = new Map<string, boolean>()
  for (const net of useOrch.getState().networks) {
    for (const node of networkNodes(net)) shell.set(commandSessionId(node), isShellCommand(node.command))
  }
  for (const sid of [...tracks.keys()]) if (!want.has(sid)) untrack(sid)
  for (const sid of want) track(sid, shell.get(sid))
  const now = Date.now()
  if (now - statusSyncAt < 2000) return
  statusSyncAt = now
  void getPty()
    ?.list()
    .then((list) => {
      const byId = new Map(list.map((i) => [i.sessionId, i]))
      for (const t of tracks.values()) {
        const info = byId.get(t.sid)
        const dead = !info || info.status === 'exited' || info.status === 'dead'
        if (info && t.lastOutAt === 0 && !dead) t.lastOutAt = info.startedAt
        if (info && !dead && now - info.startedAt > 20_000) t.booted = true
        if (dead !== t.exited && (info || t.lastOutAt > 0)) {
          t.exited = dead
          bump()
        }
      }
    })
    .catch(() => undefined)
}

// ── session memory: resume after the machine went down ────────────────
// The detached supervisor survives app restarts, not a laptop shutdown.
// While nodes run, main maps each pty to its CLI session (cli-binding.ts)
// and the answer is persisted on the node. On the next launch a node
// whose pty is gone respawns with `--resume <id>` in the session's dir —
// the whole network comes back, hidden/compact cards included.

const BIND_EVERY_MS = 20_000
const RESTORE_TIMEOUT_MS = 10_000

function sameResume(a: NodeResume | undefined, b: NodeResume | undefined): boolean {
  return (
    a?.cli === b?.cli &&
    a?.id === b?.id &&
    a?.pid === b?.pid &&
    a?.since === b?.since &&
    a?.cwd === b?.cwd &&
    a?.active === b?.active
  )
}

/** Patch `resume` on nodes by id — no re-key, no kill (unlike updateNode). */
function setResumes(patch: Map<string, NodeResume | undefined>): void {
  if (!patch.size) return
  const put = (n: OrchNode) => {
    if (!patch.has(n.id)) return n
    const r = patch.get(n.id)
    return sameResume(n.resume, r) ? n : { ...n, resume: r }
  }
  const s = useOrch.getState()
  const networks = s.networks.map((net) => {
    const orchestrator = put(net.orchestrator)
    const agents = net.agents.map(put)
    return orchestrator === net.orchestrator && agents.every((a, i) => a === net.agents[i])
      ? net
      : { ...net, orchestrator, agents }
  })
  if (networks.some((n, i) => n !== s.networks[i])) useOrch.setState({ networks })
}

let bindBusy = false

/** Record which CLI session every running node is in. */
async function refreshBindings(): Promise<void> {
  const api = window.terrarium?.cliBindings
  const pty = getPty()
  if (!api || !pty || bindBusy || useOrch.getState().restoring) return
  bindBusy = true
  try {
    const list = await pty.list()
    const byId = new Map(list.map((i) => [i.sessionId, i]))
    const patch = new Map<string, NodeResume | undefined>()
    const ask: { node: OrchNode; pid: number; since: number }[] = []
    for (const net of useOrch.getState().networks) {
      for (const node of networkNodes(net)) {
        const info = byId.get(commandSessionId(node))
        // unknown to the supervisor (fresh after a reboot) or crashed with
        // it: that's exactly the case to resume — leave the memory alone
        if (!info || info.status === 'dead') continue
        if (info.status === 'exited') {
          // the CLI ended on its own — don't bring it back uninvited
          if (node.resume?.active) patch.set(node.id, { ...node.resume, active: false })
          continue
        }
        if (!info.pid) continue
        const r = node.resume
        // devin can't be read live; a CLI-bound one never changes session
        // under the same pid — nothing new to learn
        if (r?.active && r.cli === 'devin' && r.since === info.startedAt && !isShellCommand(node.command)) continue
        ask.push({ node, pid: info.pid, since: info.startedAt })
      }
    }
    if (ask.length) {
      const got = await api(ask.map((a) => ({ pid: a.pid, since: a.since })))
      for (const { node, pid, since } of ask) {
        const b = got?.[pid]
        const prev = node.resume
        if (!b) {
          // a shell with no CLI in it right now
          if (prev?.active) patch.set(node.id, { ...prev, active: false })
          continue
        }
        const samePid = prev?.cli === b.cli && prev?.pid === b.pid
        patch.set(node.id, {
          cli: b.cli,
          id: b.id ?? (samePid ? prev?.id : undefined),
          pid: b.pid,
          since,
          cwd: b.cwd ?? (samePid ? prev?.cwd : undefined) ?? node.cwd,
          active: true
        })
      }
    }
    setResumes(patch)
  } catch {
    /* supervisor/IPC hiccup — next tick */
  } finally {
    bindBusy = false
  }
}

/**
 * Once per launch: nodes that were live when last seen but whose pty is
 * gone get their session id settled (devin's comes from its now-readable
 * lock), then are respawned resumed.
 */
async function restoreNodes(): Promise<void> {
  const pty = getPty()
  const want = useOrch
    .getState()
    .networks.flatMap((net) => networkNodes(net).map((node) => ({ net, node })))
    .filter(({ node }) => node.resume?.active)
  if (!pty || !want.length) return
  const toSpawn: string[] = []
  try {
    const list = await pty.list()
    const running = new Set(
      list.filter((i) => i.status === 'running' || i.status === 'spawning').map((i) => i.sessionId)
    )
    const resolve = window.terrarium?.resolveCliSession
    const patch = new Map<string, NodeResume | undefined>()
    for (const { node } of want) {
      if (running.has(commandSessionId(node))) continue // supervisor kept it — nothing lost
      const r = node.resume!
      let { id, cwd } = r
      // the pid names the session the process actually ended in (a /clear
      // or /resume inside it moves on from the recorded id)
      if (resolve && r.pid) {
        const hit = await resolve(r.cli, r.pid, r.since ?? 0).catch(() => null)
        if (hit) {
          id = hit.id
          cwd = hit.cwd ?? cwd
        }
      }
      patch.set(node.id, id ? { ...r, id, cwd, pid: undefined } : { ...r, active: false })
      if (id) toSpawn.push(node.id)
    }
    setResumes(patch)
  } catch {
    /* list failed — cards spawn whatever they're bound to */
  } finally {
    useOrch.setState({ restoring: false })
  }
  // bring every restored node up now — not only the cards on screen
  for (const net of useOrch.getState().networks) {
    for (const node of networkNodes(net)) {
      if (toSpawn.includes(node.id)) void preSpawn(node, net)
    }
  }
}

// ── auto topic ────────────────────────────────────────────────────────
// The primer only ASKS the orchestrator to `tnet topic` its network, and
// many never do. A network still unlabelled once its claude orchestrator
// has a mission gets a topic suggested from that transcript (main's
// net-topic: headless haiku). A user/orchestrator topic always wins —
// only an empty one is ever filled.
const TOPIC_EVERY_MS = 2 * 60_000
const TOPIC_RETRY_MS = 10 * 60_000
const TOPIC_MAX_TRIES = 6
const topicTries = new Map<string, { session: string; at: number; tries: number }>()
let topicBusy = false

async function autoTopics(): Promise<void> {
  const suggest = window.terrarium?.suggestNetTopic
  if (!suggest || topicBusy) return
  topicBusy = true
  try {
    for (const net of useOrch.getState().networks) {
      if (net.topic) continue
      const r = net.orchestrator.resume
      const session = r?.cli === 'claude' ? r.id : undefined
      if (!session) continue
      const prev = topicTries.get(net.id)
      const same = prev?.session === session
      if (same && (prev.tries >= TOPIC_MAX_TRIES || Date.now() - prev.at < TOPIC_RETRY_MS)) continue
      topicTries.set(net.id, { session, at: Date.now(), tries: (same ? prev.tries : 0) + 1 })
      const topic = await suggest(session, net.agents.map((a) => a.title ?? '')).catch(() => null)
      const now = useOrch.getState().networks.find((n) => n.id === net.id)
      if (topic && now && !now.topic) useOrch.getState().setNetworkTopic(net.id, topic)
    }
  } finally {
    topicBusy = false
  }
}

void (async () => {
  await hostReady
  await Promise.race([restoreNodes(), new Promise((r) => setTimeout(r, RESTORE_TIMEOUT_MS))])
  useOrch.setState({ restoring: false })
  void refreshBindings()
  setInterval(() => void refreshBindings(), BIND_EVERY_MS)
  // after the first binding pass has found the orchestrators' sessions
  setTimeout(() => void autoTopics(), 15_000)
  setInterval(() => void autoTopics(), TOPIC_EVERY_MS)
})()

export function nodeStatus(sid: string, now = Date.now()): NodeStatus {
  const t = tracks.get(sid)
  if (!t) return 'starting'
  if (t.exited) return 'exited'
  if (t.lastOutAt === 0) return 'starting'
  return now - t.lastOutAt < BUSY_WINDOW_MS ? 'busy' : 'idle'
}

/** Timestamps for the tether animation (0 = never). */
export function nodeIo(sid: string): { outAt: number; inAt: number } {
  const t = tracks.get(sid)
  return { outAt: t?.lastOutAt ?? 0, inAt: t?.lastInAt ?? 0 }
}

const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][0-2AB]?|\x1b[=>MNO\\78]|\x07/g

/** Last `lines` of the node's rendered screen, trailing blanks trimmed. */
export async function readScreen(sid: string, lines = 60): Promise<string> {
  const t = tracks.get(sid) ?? track(sid)
  if (t) {
    t.readAt = Date.now()
    await ensureShadow(t)
  }
  const buf = t?.shadow?.buffer.active
  if (buf) {
    let end = buf.length - 1
    while (end > 0 && !buf.getLine(end)?.translateToString(true).trim()) end--
    const out: string[] = []
    for (let y = Math.max(0, end - lines + 1); y <= end; y++) {
      out.push(buf.getLine(y)?.translateToString(true) ?? '')
    }
    return out.join('\n')
  }
  // shadow still seeding — fall back to the de-escaped raw tail
  const raw = (await getPty()?.readTail?.(sid, 32_000).catch(() => '')) ?? ''
  return raw
    .replace(ANSI_RE, '')
    .replace(/\r(?!\n)/g, '\n')
    .split('\n')
    .slice(-lines)
    .join('\n')
}

/**
 * Type into a node. Multi-line text goes in as a bracketed paste so a TUI
 * doesn't submit each line; Enter is a separate keystroke after a beat —
 * agent CLIs treat a CR glued to a paste as a newline, not a submit.
 */
export function writeToNode(
  sid: string,
  text: string,
  opts: { enter?: boolean; raw?: boolean } = {}
): number {
  const pty = getPty()
  if (!pty) throw new Error('pty bridge unavailable')
  const t = tracks.get(sid) ?? track(sid)
  const now = Date.now()
  if (t) t.lastInAt = now
  const payload =
    !opts.raw && /\r?\n/.test(text)
      ? `\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`
      : text
  if (payload) pty.write(sid, payload)
  if (opts.enter !== false) {
    setTimeout(() => pty.write(sid, '\r'), payload ? 140 + Math.min(700, payload.length / 16) : 0)
  }
  bump()
  return now
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Resolve once the node has gone quiet: output seen after `since` and none
 * for `idleMs`. A node that never reacts within `graceMs` of `since`
 * counts as done too (nothing to wait for). Exit ends the wait.
 */
export async function waitIdle(
  sid: string,
  opts: { idleMs?: number; since?: number; timeoutMs?: number; graceMs?: number } = {}
): Promise<{ done: boolean; status: NodeStatus }> {
  const idleMs = Math.max(500, opts.idleMs ?? 4000)
  const since = opts.since ?? 0
  const deadline = Date.now() + Math.max(1000, opts.timeoutMs ?? 20_000)
  const grace = opts.graceMs ?? 15_000
  const t = tracks.get(sid) ?? track(sid)
  for (;;) {
    const now = Date.now()
    if (!t) return { done: false, status: 'starting' }
    if (t.exited) return { done: true, status: 'exited' }
    const reacted = t.lastOutAt > since
    if (reacted && now - t.lastOutAt >= idleMs) return { done: true, status: 'idle' }
    if (!reacted && since > 0 && now - since >= grace) return { done: true, status: nodeStatus(sid) }
    if (now >= deadline) return { done: false, status: nodeStatus(sid) }
    await sleep(200)
  }
}

/**
 * A freshly spawned CLI needs to paint its first screen and settle before
 * it can take input — typed-ahead text lands in a half-drawn TUI.
 */
async function ensureBooted(t: Track, budgetMs = 45_000): Promise<void> {
  if (t.booted) return
  const start = Date.now()
  while (t.lastOutAt === 0 && !t.exited && Date.now() - start < Math.min(30_000, budgetMs)) {
    await sleep(200)
  }
  const left = budgetMs - (Date.now() - start)
  if (left > 500) await waitIdle(t.sid, { idleMs: 1800, timeoutMs: Math.min(25_000, left) })
  t.booted = true
}

/**
 * Queued write: waits for boot and for any earlier queued write (the
 * spawn task), then types. Resolves with the moment it was actually sent.
 */
export function sendToNode(
  sid: string,
  text: string,
  opts: { enter?: boolean; raw?: boolean; budgetMs?: number } = {}
): Promise<number> {
  const t = tracks.get(sid) ?? track(sid)
  if (!t) return Promise.resolve(writeToNode(sid, text, opts))
  const run = t.queue.then(async () => {
    await ensureBooted(t, opts.budgetMs)
    // the task/earlier send needs a beat to register before the next line
    await sleep(t.lastInAt && Date.now() - t.lastInAt < 800 ? 800 : 0)
    return writeToNode(sid, text, opts)
  })
  t.queue = run.catch(() => undefined)
  return run
}

async function deliverWhenReady(sid: string, text: string): Promise<void> {
  const t = track(sid)
  if (!t || t.exited) return
  await sendToNode(sid, text, { enter: true })
}

// ── primer ────────────────────────────────────────────────────────────

/** One-shot briefing typed into an orchestrator CLI ("Prime" button). */
export function orchestratorPrimer(net: OrchNetwork): string {
  const n = net.agents.length
  if (hostInfo) {
    return (
      `You are the ORCHESTRATOR of Terrarium agent network "${networkLabel(net)}" (${n} subagent${n === 1 ? '' : 's'} attached). ` +
      'You can open and drive subagent terminals with the `tnet` CLI (already on PATH): ' +
      '`tnet spawn --cli claude --name Scout "task"` opens a subagent and hands it a task; ' +
      '`tnet ls` lists subagents with busy/idle status; `tnet ask <agent> "msg"` sends and waits for the reply; ' +
      '`tnet send`, `tnet read <agent>`, `tnet wait all`, `tnet kill <agent>` do the rest. ' +
      'Split parallelizable work across subagents, keep each task self-contained, then collect results with tnet read/ask and integrate them. ' +
      (net.topic
        ? ''
        : 'As soon as you know the mission, label this network with a 2–4 word topic: `tnet topic "Senior loop"` (it shows as "' +
          net.name +
          ': <topic>" in the UI). ') +
      'Run `tnet help` first.'
    )
  }
  return (
    `You are the ORCHESTRATOR of Terrarium agent network "${networkLabel(net)}". ` +
    'Drive subagent terminals by POSTing JSON to the URL in env TERRARIUM_WS_CMD, always including "sid": env TERRARIUM_SID. ' +
    'Commands: {"cmd":"net.spawn","task":"...","command":"claude"} · {"cmd":"net.info"} · ' +
    '{"cmd":"net.ask","agent":1,"data":"...","timeoutMs":110000} · {"cmd":"net.read","agent":1} · {"cmd":"net.kill","agent":1}. ' +
    (net.topic ? '' : 'Label the network with a 2–4 word topic once you know the mission: {"cmd":"net.topic","topic":"..."}. ') +
    'Send {"cmd":"net.help"} first.'
  )
}

// ── net.* command handler (pane bridge) ───────────────────────────────

const NET_HELP = {
  about:
    'Orchestration networks: one orchestrator terminal + subagent terminals per tab. ' +
    'Pass your TERRARIUM_SID as `sid` so commands land in your own network (else the active tab).',
  commands: [
    'net.info {sid|net} — your network, every node with status busy|idle|starting|exited',
    'net.list — all networks (tabs)',
    'net.new {name?, topic?, command?, activate?} — open a new network tab',
    'net.spawn {command?, title?, cwd?, task?, count?} — new subagent(s); task = first prompt',
    'net.send {agent, data, enter?=true, raw?} — type into a subagent (agent = index | name | id | sid | "orchestrator")',
    'net.broadcast {data, enter?} — send to every subagent',
    'net.read {agent, lines?=60} — rendered screen text',
    'net.wait {agent|"all", idleMs?=4000, since?} — block until quiet (bounded by timeoutMs)',
    'net.ask {agent, data, idleMs?, lines?} — send + wait + read in one call (set timeoutMs up to 120000)',
    'net.kill {agent} — close a subagent (its pty dies)',
    'net.focus {agent} — pop a subagent open in the UI',
    'net.close {net} — close a whole network tab (every pty in it ends)',
    'net.rename {agent?, title} — rename a node (no agent → the network)',
    'net.topic {topic} — label what your network is for (2–4 words; shows as "Web 1: <topic>"; "" clears)',
    'net.resume {agent, id, cli?, cwd?} — reopen a node in CLI session <id> (claude|devin; restarts its pty)'
  ]
}

function s(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function resolveNet(msg: PaneCmdEnvelope): OrchNetwork | PaneCmdResult {
  const st = useOrch.getState()
  const nets = st.networks
  if (msg.net !== undefined && msg.net !== null && msg.net !== '') {
    const key = msg.net
    const hit =
      typeof key === 'number'
        ? nets[key - 1]
        : (nets.find((n) => n.id === key) ??
          nets.find((n) => n.name.toLowerCase() === String(key).toLowerCase()) ??
          nets.find((n) => networkLabel(n).toLowerCase() === String(key).toLowerCase()) ??
          nets[Number(key) - 1])
    return hit ?? { ok: false, error: `unknown network ${JSON.stringify(key)}` }
  }
  const sid = s(msg.sid)
  if (sid) {
    const hit = nets.find((n) => networkNodes(n).some((x) => commandSessionId(x) === sid))
    if (hit) return hit
  }
  const active = nets.find((n) => n.id === st.activeId) ?? nets[0]
  return (
    active ?? {
      ok: false,
      error: 'no orchestration network — open Workspace → Orchestrate, or send net.new'
    }
  )
}

function resolveNode(net: OrchNetwork, key: unknown): OrchNode | PaneCmdResult {
  if (key === undefined || key === null || key === '') {
    return { ok: false, error: 'missing agent (index | name | id | sid | "orchestrator")' }
  }
  if (typeof key === 'number') {
    if (key === 0) return net.orchestrator
    return net.agents[key - 1] ?? { ok: false, error: `no subagent #${key}` }
  }
  const k = String(key).trim()
  const lower = k.toLowerCase()
  if (lower === 'orchestrator' || lower === 'o' || lower === 'hub') return net.orchestrator
  if (/^\d+$/.test(k)) return resolveNode(net, Number(k))
  const nodes = networkNodes(net)
  const hit =
    nodes.find((n) => n.id === k) ??
    nodes.find((n) => commandSessionId(n) === k) ??
    nodes.find((n) => n.title?.toLowerCase() === lower) ??
    nodes.find((n) => n.title?.toLowerCase().startsWith(lower))
  return hit ?? { ok: false, error: `no node ${JSON.stringify(k)} in ${net.name}` }
}

function isNet(x: OrchNetwork | PaneCmdResult): x is OrchNetwork {
  return typeof (x as OrchNetwork).orchestrator === 'object'
}
function isNode(x: OrchNode | PaneCmdResult): x is OrchNode {
  return typeof (x as OrchNode).role === 'string'
}

function nodeInfo(net: OrchNetwork, n: OrchNode) {
  const sid = commandSessionId(n)
  const io = nodeIo(sid)
  return {
    i: n.role === 'orchestrator' ? 0 : net.agents.indexOf(n) + 1,
    id: n.id,
    sid,
    role: n.role,
    title: n.title,
    command: n.command ?? DEFAULT_SHELL,
    // CLI-bound nodes skip screen detection — their command names the CLI
    cli: nodeCli(sid) ?? (isShellCommand(n.command) ? null : cliFromCommandLine(n.command)),
    task: n.task,
    status: nodeStatus(sid),
    session: n.resume?.id ?? null,
    quietSec: io.outAt ? Math.round((Date.now() - io.outAt) / 1000) : null,
    by: n.by
  }
}

function netInfo(net: OrchNetwork) {
  return {
    id: net.id,
    name: net.name,
    topic: net.topic ?? null,
    label: networkLabel(net),
    active: useOrch.getState().activeId === net.id,
    agentCommand: net.agentCommand ?? net.orchestrator.command ?? DEFAULT_SHELL,
    orchestrator: nodeInfo(net, net.orchestrator),
    agents: net.agents.map((a) => nodeInfo(net, a))
  }
}

/** Latest network object (the store may have moved since resolve). */
function fresh(net: OrchNetwork): OrchNetwork {
  return useOrch.getState().networks.find((n) => n.id === net.id) ?? net
}

/** Wait budget under the bridge's per-request timeout. */
function budgetMs(msg: PaneCmdEnvelope): number {
  const cap = typeof msg.timeoutMs === 'number' ? Math.min(msg.timeoutMs, 120_000) : 20_000
  return Math.max(1000, cap - 1500)
}

export async function runNetCmd(msg: PaneCmdEnvelope): Promise<PaneCmdResult> {
  const startedAt = Date.now()
  const cmd = msg.cmd === 'net' ? 'net.info' : msg.cmd
  const store = useOrch.getState()

  switch (cmd) {
    case 'net.help':
      return { ok: true, result: NET_HELP }

    case 'net.list':
      return { ok: true, result: store.networks.map(netInfo) }

    case 'net.new': {
      // a new tab, but the user's screen stays put — net.focus pops it up
      const prev = store.activeId
      const net = store.createNetwork({
        name: s(msg.name),
        command: s(msg.command),
        topic: s(msg.topic)
      })
      if (store.enabled && msg.activate !== true && prev) useOrch.getState().setActive(prev)
      return { ok: true, result: netInfo(net) }
    }
  }

  const netOrErr = resolveNet(msg)
  if (!isNet(netOrErr)) return netOrErr
  const net = netOrErr

  switch (cmd) {
    case 'net.info':
      return { ok: true, result: netInfo(net) }

    case 'net.spawn': {
      const count = Math.max(1, Math.min(8, Number(msg.count) || 1))
      const spawned: OrchNode[] = []
      for (let i = 0; i < count; i++) {
        const node = useOrch.getState().spawnAgent(net.id, {
          command: s(msg.command) ?? s(msg.cli),
          title: count === 1 ? (s(msg.title) ?? s(msg.name)) : undefined,
          cwd: s(msg.cwd),
          task: typeof msg.task === 'string' ? msg.task : undefined,
          by: 'api'
        })
        if (!node) break
        spawned.push(node)
      }
      if (!spawned.length) return { ok: false, error: `subagent limit (${MAX_AGENTS}) reached` }
      const cur = fresh(net)
      return { ok: true, result: { network: cur.name, spawned: spawned.map((n) => nodeInfo(cur, n)) } }
    }

    case 'net.send':
    case 'net.ask': {
      const node = resolveNode(net, msg.agent ?? msg.to ?? msg.pane)
      if (!isNode(node)) return node
      const data = typeof msg.data === 'string' ? msg.data : typeof msg.text === 'string' ? msg.text : ''
      if (!data && msg.enter === false) return { ok: false, error: `${cmd} needs { agent, data }` }
      const sid = commandSessionId(node)
      const sentAt = await sendToNode(sid, data, {
        enter: msg.enter !== false,
        raw: msg.raw === true,
        budgetMs: budgetMs(msg) / 2
      })
      if (cmd === 'net.send') {
        return { ok: true, result: { agent: node.title, sid, sentAt } }
      }
      const w = await waitIdle(sid, {
        idleMs: typeof msg.idleMs === 'number' ? msg.idleMs : 4000,
        since: sentAt,
        timeoutMs: Math.max(1000, budgetMs(msg) - (Date.now() - startedAt))
      })
      const lines = typeof msg.lines === 'number' ? msg.lines : 60
      return {
        ok: true,
        result: { agent: node.title, sid, sentAt, done: w.done, status: w.status, text: await readScreen(sid, lines) }
      }
    }

    case 'net.broadcast': {
      const data = typeof msg.data === 'string' ? msg.data : ''
      if (!data) return { ok: false, error: 'net.broadcast needs { data }' }
      const sentAt = Date.now()
      for (const a of net.agents) {
        void sendToNode(commandSessionId(a), data, { enter: msg.enter !== false, raw: msg.raw === true })
      }
      return { ok: true, result: { sent: net.agents.length, sentAt } }
    }

    case 'net.read': {
      const node = resolveNode(net, msg.agent ?? msg.pane)
      if (!isNode(node)) return node
      const sid = commandSessionId(node)
      const lines = typeof msg.lines === 'number' ? msg.lines : 60
      return {
        ok: true,
        result: { agent: node.title, sid, status: nodeStatus(sid), text: await readScreen(sid, lines) }
      }
    }

    case 'net.wait': {
      const key = msg.agent ?? msg.pane ?? 'all'
      const targets =
        key === 'all' || key === '*'
          ? net.agents
          : (() => {
              const n = resolveNode(net, key)
              return isNode(n) ? [n] : n
            })()
      if (!Array.isArray(targets)) return targets
      const opts = {
        idleMs: typeof msg.idleMs === 'number' ? msg.idleMs : 4000,
        since: typeof msg.since === 'number' ? msg.since : 0,
        timeoutMs: budgetMs(msg)
      }
      const results = await Promise.all(
        targets.map(async (n) => ({
          agent: n.title,
          ...(await waitIdle(commandSessionId(n), opts))
        }))
      )
      return { ok: true, result: { done: results.every((r) => r.done), agents: results } }
    }

    case 'net.kill': {
      const node = resolveNode(net, msg.agent ?? msg.pane)
      if (!isNode(node)) return node
      if (node.role === 'orchestrator') return { ok: false, error: 'the orchestrator is not killable — close the tab instead' }
      useOrch.getState().removeAgent(net.id, node.id)
      return { ok: true, result: { killed: node.title } }
    }

    case 'net.close': {
      if (s(msg.sid) && networkNodes(net).some((n) => commandSessionId(n) === s(msg.sid)) && msg.net === undefined) {
        return { ok: false, error: 'refusing to close your own network without an explicit `net`' }
      }
      useOrch.getState().closeNetwork(net.id)
      return { ok: true, result: { closed: net.name } }
    }

    case 'net.focus': {
      const node = resolveNode(net, msg.agent ?? msg.pane)
      if (!isNode(node)) return node
      const st = useOrch.getState()
      st.setActive(net.id)
      useOrch.setState({ enabled: true, expandedId: node.role === 'subagent' ? node.id : null })
      useApp.getState().setView('workspace')
      return { ok: true, result: { focused: node.title } }
    }

    case 'net.rename': {
      const title = s(msg.title) ?? s(msg.name)
      if (!title) return { ok: false, error: 'net.rename needs { title }' }
      if (msg.agent === undefined) {
        useOrch.getState().renameNetwork(net.id, title)
        return { ok: true, result: { network: title } }
      }
      const node = resolveNode(net, msg.agent)
      if (!isNode(node)) return node
      useOrch.getState().updateNode(node.id, { title })
      return { ok: true, result: { renamed: title } }
    }

    case 'net.topic': {
      const raw = typeof msg.topic === 'string' ? msg.topic : typeof msg.title === 'string' ? msg.title : null
      if (raw === null) return { ok: false, error: 'net.topic needs { topic } ("" clears it)' }
      useOrch.getState().setNetworkTopic(net.id, raw)
      const now = fresh(net)
      return { ok: true, result: { network: now.name, topic: now.topic ?? null, label: networkLabel(now) } }
    }

    case 'net.resume': {
      const node = resolveNode(net, msg.agent ?? msg.pane)
      if (!isNode(node)) return node
      const id = s(msg.id) ?? s(msg.session)
      if (!id) return { ok: false, error: 'net.resume needs { agent, id }' }
      const first = node.command?.trim().split(/\s+/)[0]
      const bound = first?.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
      const cli = s(msg.cli) ?? (isResumableCli(bound) ? bound : node.resume?.cli)
      if (!isResumableCli(cli)) return { ok: false, error: 'net.resume: pass cli ("claude" | "devin") for a shell-bound node' }
      const resume: NodeResume = { cli, id, cwd: s(msg.cwd) ?? node.cwd, active: true }
      setResumes(new Map([[node.id, resume]]))
      // whatever runs there now (a fresh CLI after the reboot) makes way
      const sid = commandSessionId(node)
      await getPty()?.kill(sid).catch(() => {})
      await new Promise((r) => setTimeout(r, 250))
      const now = fresh(net)
      const target = networkNodes(now).find((n) => n.id === node.id)
      if (target) await preSpawn(target, now)
      return { ok: true, result: { node: node.title, cli, session: id, cwd: resume.cwd ?? null } }
    }

    default:
      return { ok: false, error: `unknown cmd ${JSON.stringify(msg.cmd)} — try net.help` }
  }
}

// start watching restored networks right away
syncTracking()

// Hot-swapping this module would fork the store (pane-bridge's lazy import
// keeps the old instance while the view gets the new one) — reload instead.
// Terminals re-attach to their supervisor sessions, nothing is lost.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())
