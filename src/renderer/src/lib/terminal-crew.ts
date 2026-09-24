// ── terminal-crew — open terminals as the workforce ──────────────────
// The board manages REAL terminal panes, not persona agents: every
// terminal leaf in the workspace pane tree is a "worker" addressed by its
// pty session id. Cards reach a worker through a shadow engine agent
// (`term-<leafId>`) so the real engine's assignCard — which insists on an
// existing agent row — goes through and produces the run rows the review
// overlay reads. Prompts and follow-ups are literal keystrokes written
// into the pane's pty, so they land even while the workspace view is
// unmounted (ptys run in the detached supervisor).

import { useEffect, useMemo, useState } from 'react'
import type { Agent, AgentDomain, TaskCard } from '@shared/types'
import type { PtySessionInfo, PtySessionStatus, PtySpawnOpts } from '@shared/pty'
import { cliName } from '@shared/cli-sessions'
import { commandSessionId, type PaneLeaf } from './panes'
import { getAllTerminalLeaves } from './terminal-agents'
import { paneBridgeCmdUrl } from './pane-bridge'
import { scheduleDomainClassification } from './terminal-classify'
import { getEngine, getPty } from './ipc'
import { useApp } from './store'

export interface TerminalWorker {
  leaf: PaneLeaf
  /** pty session id — how the terminal is addressed for writes/spawns. */
  sid: string
  /** Session name — leaf title, else the CLI basename, else 'Terminal'. */
  name: string
  cli: string | null
  /** Classified work area — 'general' until the classifier has run. */
  domain: AgentDomain
  status: 'idle' | 'working' | 'waiting' | 'exited'
  /** Has work on its plate (working or waiting) — not assignable. */
  busy: boolean
  /** The doing/review card this terminal is assigned to, if any. */
  card?: TaskCard
  /** Raw supervisor status when pty.list is reachable — feeds auto-review. */
  sessionStatus?: PtySessionStatus
}

const POLL_MS = 1500

/** Engine agent id backing a terminal leaf — assignCard needs a real row. */
export function shadowAgentId(leaf: PaneLeaf): string {
  return `term-${leaf.id}`
}

/** Resolve a card assigneeId (term-<leafId> / leaf id / leaf.agentId) to a live worker. */
export function workerForAssignee(
  workers: TerminalWorker[],
  assigneeId: string | null | undefined
): TerminalWorker | undefined {
  if (!assigneeId) return undefined
  return workers.find(
    (w) =>
      assigneeId === shadowAgentId(w.leaf) ||
      assigneeId === w.leaf.id ||
      (!!w.leaf.agentId && assigneeId === w.leaf.agentId)
  )
}

/** The doing/review card bound to a leaf, if any. */
function cardForLeaf(cards: TaskCard[], leaf: PaneLeaf): TaskCard | undefined {
  const shadow = shadowAgentId(leaf)
  return cards.find(
    (c) =>
      (c.status === 'doing' || c.status === 'review') &&
      (c.assigneeId === shadow ||
        c.assigneeId === leaf.id ||
        (!!leaf.agentId && c.assigneeId === leaf.agentId))
  )
}

/** A bound `--resume`/` resume ` command means the pane reopened a live CLI session — it's busy. */
function isResumeBound(command: string | undefined): boolean {
  const c = command?.trim()
  if (!c) return false
  return c.includes('--resume') || c.includes(' resume ') || c.endsWith(' resume')
}

function toWorker(
  leaf: PaneLeaf,
  sessions: PtySessionInfo[] | null,
  cards: TaskCard[]
): TerminalWorker {
  const sid = commandSessionId(leaf)
  const cli = cliName(leaf.command)
  const name = leaf.title || cli || 'Terminal'
  const session = sessions?.find((s) => s.sessionId === sid)
  const card = cardForLeaf(cards, leaf)
  const bound = !!leaf.command?.trim()

  let status: TerminalWorker['status']
  if (leaf.attention) {
    status = 'waiting'
  } else if (card) {
    status = 'working'
  } else if (
    sessions !== null &&
    (session?.status === 'exited' || session?.status === 'dead' || (!session && bound))
  ) {
    // pty.list is live and says the session died — or a command-bound pane
    // was never spawned. No pty bridge → skip this entirely.
    status = 'exited'
  } else if (isResumeBound(leaf.command)) {
    status = 'working'
  } else {
    status = 'idle'
  }

  return {
    leaf,
    sid,
    name,
    cli,
    domain: leaf.domain ?? 'general',
    status,
    busy: status === 'working' || status === 'waiting',
    card,
    sessionStatus: session?.status
  }
}

/**
 * Live view of every open workspace terminal. Polls the pane tree + the
 * pty supervisor on a timer and re-reads on pane/storage events — the
 * same refresh pattern as OfficeView — so the board tracks terminals
 * even while the workspace view is unmounted.
 */
export function useTerminalWorkers(cards: TaskCard[]): TerminalWorker[] {
  const [leaves, setLeaves] = useState<PaneLeaf[]>(() => getAllTerminalLeaves())
  // null = pty.list never answered (plain-browser mock / dead bridge) —
  // exited detection stays off rather than guessing.
  const [sessions, setSessions] = useState<PtySessionInfo[] | null>(null)

  useEffect(() => {
    let alive = true
    const refresh = () => {
      const next = getAllTerminalLeaves()
      const pty = getPty()
      if (!pty) {
        if (alive) {
          setLeaves(next)
          setSessions(null)
        }
        return
      }
      pty.list().then(
        (list) => {
          if (!alive) return
          setLeaves(next)
          setSessions(list)
        },
        () => {
          if (!alive) return
          setLeaves(next)
          setSessions(null)
        }
      )
    }
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('terrarium:panes-updated', refresh)
    window.addEventListener('terrarium:save-state', refresh)
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      alive = false
      window.removeEventListener('storage', refresh)
      window.removeEventListener('terrarium:panes-updated', refresh)
      window.removeEventListener('terrarium:save-state', refresh)
      clearInterval(timer)
    }
  }, [])

  return useMemo(
    () => leaves.map((leaf) => toWorker(leaf, sessions, cards)),
    [leaves, sessions, cards]
  )
}

// ── respawn grace ────────────────────────────────────────────────────
// A pty we just spawned needs a few seconds before 'exited' is meaningful
// again — auto-review must not flip a just-nudged card straight back.
const respawnGrace = new Map<string, number>()
// Cards already auto-moved to review on a pty exit — once per stint;
// cleared whenever fresh work is sent so a reopened card can trip again.
const autoReviewed = new Set<string>()

/** Mark a card's terminal as freshly (re)spawning for the next `ms`. */
export function noteTerminalRespawn(cardId: string, ms = 6000): void {
  respawnGrace.set(cardId, Date.now() + ms)
  autoReviewed.delete(cardId)
}

/** True while a recently respawned pty may still report 'exited'. */
export function respawnGraceActive(cardId: string): boolean {
  return Date.now() < (respawnGrace.get(cardId) ?? 0)
}

export function wasAutoReviewed(cardId: string): boolean {
  return autoReviewed.has(cardId)
}

export function markAutoReviewed(cardId: string): void {
  autoReviewed.add(cardId)
}

// ── pty plumbing ─────────────────────────────────────────────────────

/** 'claude --resume x' → command 'claude', args ['--resume','x'] (mirrors render-leaf). */
function splitCommand(command: string): { command: string; args?: string[] } {
  const parts = command.trim().split(/\s+/)
  return { command: parts[0], args: parts.length > 1 ? parts.slice(1) : undefined }
}

/** Spawn opts identical to what the mounted Terminal would use for this leaf. */
function spawnOptsFor(worker: TerminalWorker): PtySpawnOpts {
  const leaf = worker.leaf
  const bound = leaf.command?.trim()
  const env: Record<string, string> = { TERRARIUM_SID: worker.sid }
  const bridgeCmd = paneBridgeCmdUrl()
  if (bridgeCmd) {
    env.TERRARIUM_BROWSER_CMD = bridgeCmd
    env.TERRARIUM_WS_CMD = bridgeCmd
  }
  return {
    sessionId: worker.sid,
    cwd: leaf.cwd?.trim() || useApp.getState().projects[0]?.rootPath || '.',
    env,
    ...splitCommand(
      bound || (window.terrarium?.platform === 'win32' ? 'powershell.exe' : '/bin/sh')
    )
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Make sure the worker's pty is alive before writing — respawns sessions
 * that exited or were never spawned (e.g. workspace not yet visited).
 */
async function ensureLiveSession(worker: TerminalWorker, delayMs: number): Promise<void> {
  const pty = getPty()
  if (!pty) return
  let live = false
  try {
    const list = await pty.list()
    const s = list.find((x) => x.sessionId === worker.sid)
    live = s?.status === 'running' || s?.status === 'spawning'
  } catch {
    /* can't tell — fall through to the spawn path anyway */
  }
  if (!live) {
    try {
      await pty.spawn(spawnOptsFor(worker))
    } catch {
      /* already running/spawning, or host rejected — write is best-effort */
    }
    await sleep(delayMs)
  }
}

/** Keystrokes into the terminal, spawning the pty first when it's gone. */
async function writeToTerminal(
  worker: TerminalWorker,
  data: string,
  delayMs = 400
): Promise<boolean> {
  const pty = getPty()
  if (!pty) return false
  await ensureLiveSession(worker, delayMs)
  try {
    pty.write(worker.sid, data)
    return true
  } catch {
    return false
  }
}

// ── actions ──────────────────────────────────────────────────────────

export interface AssignOpts {
  /** Settle delay between a respawn and the prompt write (default 400ms). */
  delayMs?: number
}

/** Fresh worker view of a leaf that was just created (pty not yet polled). */
export function workerFromLeaf(leaf: PaneLeaf): TerminalWorker {
  const sid = commandSessionId(leaf)
  const cli = cliName(leaf.command)
  return {
    leaf,
    sid,
    name: leaf.title || cli || 'Terminal',
    cli,
    domain: leaf.domain ?? 'general',
    status: 'idle',
    busy: false
  }
}

/** The "me" agent — the user's own seat on the board. */
export const ME_AGENT_ID = 'me'

/**
 * Assign a card to the user themself — same shadow-agent trick as
 * terminals, so the card flows through the normal doing/review/done
 * pipeline and shows up under a "me" badge.
 */
export async function assignCardToSelf(card: TaskCard): Promise<boolean> {
  const engine = getEngine()
  const agent: Agent = {
    id: ME_AGENT_ID,
    name: 'me',
    role: 'lead',
    domain: 'general',
    brief: 'You — self-assigned task',
    status: 'idle',
    deskId: 'desk-me',
    taskId: null,
    hue: 210,
    lastActiveAt: Date.now()
  }
  try {
    await engine.upsertAgent(agent)
    await engine.assignCard(card.id, ME_AGENT_ID)
    return true
  } catch {
    return false
  }
}

/**
 * Give a card to a terminal: upserts the shadow agent (assignCard
 * requires an existing agent row), assigns — which flips the card to
 * 'doing' and opens a run — then types the task into the pty as a single
 * line. False when the engine assign failed or no pty bridge exists.
 */
export async function assignCardToTerminal(
  card: TaskCard,
  worker: TerminalWorker,
  opts?: AssignOpts
): Promise<boolean> {
  const engine = getEngine()
  const agentId = shadowAgentId(worker.leaf)
  const agent: Agent = {
    id: agentId,
    name: worker.name,
    role: 'builder',
    domain: worker.domain,
    brief: 'Terminal session',
    status: 'idle',
    deskId: `desk-term-${worker.leaf.id}`,
    taskId: null,
    hue: 200,
    lastActiveAt: Date.now()
  }
  try {
    await engine.upsertAgent(agent)
    await engine.assignCard(card.id, agentId)
  } catch {
    return false
  }
  noteTerminalRespawn(card.id)
  // Card context changed — re-derive the worker's work area.
  scheduleDomainClassification()
  const line = card.title + (card.body ? ` — ${card.body.replace(/\s+/g, ' ')}` : '')
  return writeToTerminal(worker, `${line}\r`, opts?.delayMs)
}

/**
 * Type a message into a worker's terminal — review follow-ups, nudges,
 * unblock approvals. Respawns the pty first when it exited.
 */
export async function sendTerminalFollowUp(
  worker: TerminalWorker,
  message: string
): Promise<boolean> {
  const text = message.replace(/\s+/g, ' ').trim()
  if (!text) return false
  return writeToTerminal(worker, `${text}\r`)
}

/** Jump to the workspace and focus this terminal's pane. */
export function focusTerminal(worker: TerminalWorker): void {
  useApp.getState().openAgentTerminal(worker.leaf.id)
}
