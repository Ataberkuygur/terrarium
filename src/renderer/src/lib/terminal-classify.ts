// ── terminal-classify — 'çalıştığı alan' per terminal leaf ──────────
// Every terminal leaf carries a `domain` (AgentDomain): the work area
// it's currently in — shown as 'Name — Domain' in the office nametag and
// used as the session rail's group.
//
// Classification pipeline per leaf:
//   1. Bound crew agent? → inherit agent.domain, no AI needed.
//   2. Jev (TypeSafe AI) `choice` over the seven domains — one batched
//      call for all pending leaves, fed with command + cwd + assigned
//      card + a scrollback tail (pty.readTail). Applied when
//      confidence ≥ JEV_MIN_CONFIDENCE.
//   3. Keyword heuristic — always runs, is also the Jev-null fallback.
//
// Writes: when the workspace view is mounted it registers a dispatcher
// (its reducer owns the live tree); otherwise we patch the serialized
// tree in localStorage and fire 'terrarium:panes-updated' so office/board
// pick it up on their next refresh.

import type { AgentDomain, TaskCard } from '@shared/types'
import { isJevChoiceAnswer, type JevQuestionMap } from '@shared/jev'
import { cliName, isResumableCli } from '@shared/cli-sessions'
import {
  collectLeaves,
  commandSessionId,
  deserializePanes,
  serializePanes,
  updateLeaf,
  type PaneLeaf
} from './panes'
import { getPty } from './ipc'
import { useApp } from './store'

const PANES_STORAGE_KEY = 'terrarium.panes'
const UPDATED_EVENT = 'terrarium:panes-updated'

/** Below this Jev certainty the heuristic decides instead. */
const JEV_MIN_CONFIDENCE = 0.45
/** Scrollback tail fed to Jev (raw bytes read, cleaned chars kept). */
const TAIL_READ_CHARS = 6000
const TAIL_KEEP_CHARS = 1200
/** Debounce between triggers and the actual batch call. */
const SCHEDULE_MS = 1200

export const DOMAIN_LABELS: Record<AgentDomain, string> = {
  general: 'General',
  frontend: 'Frontend',
  backend: 'Backend',
  design: 'Design',
  research: 'Research',
  marketing: 'Marketing',
  legal: 'Legal'
}

// ── jev rubric — option key → what belongs there ─────────────────────

const DOMAIN_RUBRIC: Record<AgentDomain, string> = {
  frontend:
    'UI and client-side work: web/app front-end, React/components, styling, renderer code, Electron UI',
  backend:
    'Server-side and systems work: APIs, databases, infra, build tooling, backend or CLI internals',
  marketing:
    'Marketing and content production: ads, video editing for clients, reels/shorts, social content, copywriting, campaigns',
  design:
    'Visual design work: UI/UX design, brand assets, motion graphics, mockups, image generation briefs',
  research:
    'Research and analysis: investigating, reading docs, comparing options, wiki/report writing',
  legal: 'Legal and compliance work: contracts, terms, policies, licensing',
  general:
    'General shell work, exploration, unclear or mixed activity — pick this when nothing fits well'
}

// ── heuristic fallback ────────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<Exclude<AgentDomain, 'general'>, string[]> = {
  marketing: [
    'marketing', 'manvoure', 'reel', 'reels', 'tiktok', 'shorts', 'caption',
    'premiere', 'video', 'edit', 'ad-', 'ads', 'campaign', 'copywriting',
    'client', 'youtube', 'thumbnail', 'higgsfield', 'b-roll', 'broll'
  ],
  frontend: [
    'frontend', 'front-end', 'component', 'react', 'tsx', 'css', 'tailwind',
    'ui', 'landing', 'webpage', 'website', 'vite', 'renderer', 'electron-ui'
  ],
  backend: [
    'backend', 'back-end', 'api', 'server', 'database', 'db', 'sql', 'infra',
    'endpoint', 'worker', 'queue', 'auth', 'middleware', 'sqlite'
  ],
  design: [
    'design', 'figma', 'brand', 'logo', 'mockup', 'ui-kit', 'icon', 'font',
    'palette', 'layout-design'
  ],
  research: [
    'research', 'analysis', 'investigate', 'docs', 'wiki', 'paper', 'survey',
    'compare', 'benchmark', 'report'
  ],
  legal: [
    'legal', 'contract', 'agreement', 'terms', 'privacy', 'compliance',
    'license', 'licensing', 'gdpr', 'nda'
  ]
}

interface LeafContext {
  command: string
  cwd: string
  cwdBase: string
  cardTitle: string
  cardBody: string
  /** The resumed CLI session's title/first prompt — what the user actually asked for. */
  sessionTitle: string
  tail: string
}

function heuristicDomain(ctx: LeafContext): AgentDomain {
  // session title is the user's own task wording — strongest signal;
  // tail is noisy, weight it last
  const haystacks: { text: string; weight: number }[] = [
    { text: ctx.sessionTitle.toLowerCase(), weight: 3 },
    { text: `${ctx.cwdBase} ${ctx.cardTitle} ${ctx.cardBody}`.toLowerCase(), weight: 2 },
    { text: `${ctx.command} ${ctx.cwd}`.toLowerCase(), weight: 1 },
    { text: ctx.tail.toLowerCase(), weight: 1 }
  ]
  let best: AgentDomain = 'general'
  let bestScore = 0
  for (const domain of Object.keys(DOMAIN_KEYWORDS) as Exclude<AgentDomain, 'general'>[]) {
    let score = 0
    for (const kw of DOMAIN_KEYWORDS[domain]) {
      for (const { text, weight } of haystacks) {
        if (kw.length > 2 && text.includes(kw)) score += weight
        else if (text.split(/[^a-z0-9_-]+/).includes(kw)) score += weight
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = domain
    }
  }
  return best
}

// ── context gathering ────────────────────────────────────────────────

/** The doing/review card bound to this leaf (same logic as terminal-crew). */
function cardForLeaf(cards: TaskCard[], leaf: PaneLeaf): TaskCard | undefined {
  const shadow = `term-${leaf.id}`
  return cards.find(
    (c) =>
      (c.status === 'doing' || c.status === 'review') &&
      (c.assigneeId === shadow ||
        c.assigneeId === leaf.id ||
        (!!leaf.agentId && c.assigneeId === leaf.agentId))
  )
}

/** Strip ANSI/OSC escape sequences + collapse whitespace for the prompt. */
function cleanTail(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ')
    .replace(/\x1b[PX^_][^\x1b]*(?:\x1b\\)/g, ' ')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/\x1b[@-_]/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .slice(-40)
    .join('\n')
    .slice(-TAIL_KEEP_CHARS)
}

/**
 * Context signature — when it changes the leaf's domain is stale and
 * gets re-classified. The card folds in so a new assignment re-tags the
 * terminal's area.
 */
function signatureFor(leaf: PaneLeaf, card: TaskCard | undefined): string {
  return `${leaf.command ?? ''}|${leaf.cwd ?? ''}|${card?.id ?? ''}`
}

/** Everything except the scrollback — cheap, no IPC. */
function baseContext(leaf: PaneLeaf, cards: TaskCard[]): { ctx: LeafContext; sig: string } {
  const card = cardForLeaf(cards, leaf)
  const cwd = leaf.cwd?.trim() || useApp.getState().projects[0]?.rootPath || ''
  const cwdBase = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return {
    ctx: {
      command: leaf.command?.trim() || cliName(leaf.command) || 'shell',
      cwd,
      cwdBase,
      cardTitle: card?.title ?? '',
      cardBody: card?.body?.slice(0, 300) ?? '',
      sessionTitle: '',
      tail: ''
    },
    sig: signatureFor(leaf, card)
  }
}

// ── scrollback sources ───────────────────────────────────────────────
// Three tiers, richest first:
//   1. The live xterm buffer — full scrollback incl. output that predates
//      this module. Terminal components register a reader per sid.
//   2. The host's 'read' request — needs a supervisor new enough to know
//      it; a long-lived one keeps old code until respawn.
//   3. The data/replay event tap — output arriving while the app runs.
const scrollbackReaders = new Map<string, () => string>()

/** Terminal panes register their xterm buffer reader here (by sid). */
export function registerScrollbackReader(sid: string, read: () => string): () => void {
  scrollbackReaders.set(sid, read)
  for (const cb of readerSubs) {
    try {
      cb(sid)
    } catch {
      /* subscriber error must not break the terminal mount */
    }
  }
  return () => {
    if (scrollbackReaders.get(sid) === read) scrollbackReaders.delete(sid)
  }
}

const readerSubs = new Set<(sid: string) => void>()

/** Fires when a terminal pane mounts its buffer reader (lib/live-cli's first look). */
export function onScrollbackReaderRegistered(cb: (sid: string) => void): () => void {
  readerSubs.add(cb)
  return () => readerSubs.delete(cb)
}

/** The mounted pane's visible buffer tail (non-empty lines), null when unmounted. */
export function readLiveScreen(sid: string): string | null {
  try {
    return scrollbackReaders.get(sid)?.() ?? null
  } catch {
    return null
  }
}

const tailBufs = new Map<string, string>()
const tailHooked = new Set<string>()
/** The 'read' request stopped answering — stop asking (old supervisor). */
let readTailDead = false

function tapTail(sid: string): void {
  if (tailHooked.has(sid)) return
  const pty = getPty()
  if (!pty?.onData) return
  tailHooked.add(sid)
  const push = (d: string) => {
    const next = (tailBufs.get(sid) ?? '') + d
    tailBufs.set(sid, next.length > TAIL_READ_CHARS ? next.slice(-TAIL_READ_CHARS) : next)
  }
  try {
    pty.onData(sid, push)
    pty.onReplay?.(sid, push)
  } catch {
    tailHooked.delete(sid)
  }
}

/** Pty ring tail for pending leaves only — live xterm buffer when the
 *  pane is mounted, the host's 'read' when the supervisor knows it, else
 *  whatever the event tap has collected. */
async function fillTail(ctx: LeafContext, leaf: PaneLeaf): Promise<void> {
  const sid = commandSessionId(leaf)
  try {
    const live = scrollbackReaders.get(sid)?.()
    if (live?.trim()) {
      ctx.tail = cleanTail(live)
      return
    }
  } catch {
    /* reader threw — fall through to pty sources */
  }
  tapTail(sid)
  if (!readTailDead) {
    try {
      const raw = await getPty()?.readTail?.(sid, TAIL_READ_CHARS)
      if (raw) {
        ctx.tail = cleanTail(raw)
        return
      }
    } catch {
      readTailDead = true // supervisor predates 'read' — don't keep asking
    }
  }
  ctx.tail = cleanTail(tailBufs.get(sid) ?? '')
}

/**
 * The resumed CLI session's own title/first prompt — the user's actual
 * ask ('Edit reels for PureTallow'), far richer than 'devin --resume x'.
 * Matches by resume token; a bare `devin`/`claude` falls back to the
 * newest session for this cwd. One IPC per pending leaf.
 */
async function fillSession(ctx: LeafContext, leaf: PaneLeaf): Promise<void> {
  const cli = cliName(leaf.command)
  if (!cli || !isResumableCli(cli)) return
  const listSessions = window.terrarium?.cliSessions
  if (!listSessions) return
  try {
    const list = await listSessions(cli, ctx.cwd)
    if (!list?.length) return
    const m =
      /--(?:resume|session)[=\s]+["']?([^\s"']+)/.exec(leaf.command ?? '') ??
      /\bresume\s+["']?([^\s"']+)/.exec(leaf.command ?? '')
    const token = m?.[1]
    const byToken = token
      ? list.find((e) => e.id === token || e.id.endsWith(token) || e.id.includes(token))
      : undefined
    // opencode's db stores 'C:/x' — normalize separators before comparing
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const entry =
      byToken ??
      list.find((e) => e.cwd && ctx.cwd && norm(e.cwd) === norm(ctx.cwd))
    if (entry?.summary) ctx.sessionTitle = entry.summary
  } catch {
    /* session store unreadable — title stays empty */
  }
}

// ── jev decision ─────────────────────────────────────────────────────

/** Last-run diagnostics — surfaced by the `classify` bridge command. */
export interface ClassifyReport {
  at: number
  jevApi: boolean
  jevError: string | null
  jevAnswers: number
  leaves: {
    id: string
    title?: string
    domain?: string
    via: string
    tailChars: number
    sessionTitle?: string
  }[]
}
let lastReport: ClassifyReport | null = null
let jevError: string | null = null

async function jevDomains(
  pending: { leaf: PaneLeaf; ctx: LeafContext }[]
): Promise<Map<string, AgentDomain> | null> {
  const decide = window.terrarium?.jevDecide
  if (!decide || pending.length === 0) {
    jevError = decide ? null : 'window.terrarium.jevDecide missing (old preload)'
    return null
  }

  const project = useApp.getState().projects[0]
  const state = {
    task: 'Classify the current work area of each terminal session in the Terrarium workspace.',
    project: project ? `${project.name} (${project.rootPath})` : 'unknown',
    note: 'Use the command, working directory, assigned task and recent terminal output as evidence. Prefer "general" only when nothing fits.'
  }

  const questions: JevQuestionMap = {}
  for (const { leaf, ctx } of pending) {
    const evidence = [
      `command: ${ctx.command || 'none'}`,
      `cwd: ${ctx.cwd || 'unknown'}`,
      ctx.cardTitle ? `assigned task: ${ctx.cardTitle}${ctx.cardBody ? ` — ${ctx.cardBody}` : ''}` : null,
      ctx.sessionTitle ? `cli session topic: ${ctx.sessionTitle}` : null,
      ctx.tail ? `recent output:\n${ctx.tail}` : null
    ]
      .filter(Boolean)
      .join('\n')
    questions[leaf.id] = {
      type: 'choice',
      instructions: `Terminal "${leaf.title ?? leaf.id}" — which single work area best describes what it is doing?\n${evidence}`,
      criteria: { ...DOMAIN_RUBRIC }
    }
  }

  try {
    const res = await decide({ state, questions })
    if (!res?.answers) {
      jevError = 'jevDecide returned no answers (key missing? main fallback failed?)'
      return null
    }
    jevError = null
    const out = new Map<string, AgentDomain>()
    for (const { leaf } of pending) {
      const a = res.answers[leaf.id]
      if (
        isJevChoiceAnswer(a) &&
        a.confidence >= JEV_MIN_CONFIDENCE &&
        a.choice in DOMAIN_LABELS
      ) {
        out.set(leaf.id, a.choice as AgentDomain)
      }
    }
    return out
  } catch (e) {
    jevError = e instanceof Error ? e.message : String(e)
    return null
  }
}

// ── apply paths ───────────────────────────────────────────────────────

type DomainDispatch = (updates: Map<string, AgentDomain>) => void
let domainDispatch: DomainDispatch | null = null

/**
 * WorkspaceView registers this while mounted — its reducer owns the live
 * tree, so domain patches must flow through dispatch, not localStorage.
 */
export function setDomainDispatch(fn: DomainDispatch | null): () => void {
  domainDispatch = fn
  return () => {
    if (domainDispatch === fn) domainDispatch = null
  }
}

/** Unmounted path — patch the serialized tree, notify every listener. */
function applyDomainsToStorage(updates: Map<string, AgentDomain>): void {
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    let tree = raw ? deserializePanes(raw) : null
    if (!tree) return
    for (const [leafId, domain] of updates) {
      tree = updateLeaf(tree, leafId, { domain })
    }
    localStorage.setItem(PANES_STORAGE_KEY, serializePanes(tree))
    window.dispatchEvent(new CustomEvent(UPDATED_EVENT))
    window.dispatchEvent(new StorageEvent('storage', { key: PANES_STORAGE_KEY }))
  } catch {
    /* storage unavailable — domains just won't persist this round */
  }
}

// ── scheduler ─────────────────────────────────────────────────────────

/** Provenance of a leaf's last classification — `strong` = Jev (or a
 *  bound agent) answered. Heuristic-only results stay `weak` and retry
 *  every RETRY_WEAK_MS, so a Jev/key that appears later upgrades stale
 *  'general' tags. Never downgraded: a strong answer is never re-rolled
 *  by the heuristic — only a changed context signature re-asks Jev. */
interface SigEntry {
  sig: string
  strong: boolean
  triedAt: number
}
const lastSig = new Map<string, SigEntry>()
const RETRY_WEAK_MS = 3 * 60_000
const inflight = new Set<string>()
let scheduled: ReturnType<typeof setTimeout> | null = null
let pendingLeaves: PaneLeaf[] = []

/** Throttle state — the office polls leaves every ~1.2s; a pure debounce
 *  would starve forever, so the wait is capped against the last run. */
let lastRunAt = 0

/**
 * Ask the classifier to (re)evaluate terminal leaves. Safe to call on
 * every tree change/poll — a leaf is only re-classified when its
 * command/cwd/assigned-card signature moved.
 */
export function scheduleDomainClassification(leaves?: PaneLeaf[]): void {
  if (leaves) {
    const seen = new Set(pendingLeaves.map((l) => l.id))
    for (const l of leaves) {
      if (!seen.has(l.id)) pendingLeaves.push(l)
      else pendingLeaves = pendingLeaves.map((p) => (p.id === l.id ? l : p))
    }
  }
  if (scheduled) clearTimeout(scheduled)
  const wait = Math.max(60, SCHEDULE_MS - (Date.now() - lastRunAt))
  scheduled = setTimeout(() => {
    lastRunAt = Date.now()
    void runClassification()
  }, wait)
}

/**
 * Force a full classification pass right now — bypasses the signature
 * cache and throttle so every unbound terminal is re-evaluated (Jev
 * first, heuristic fallback). Returns the diagnostic report. Exposed for
 * the `classify` pane-bridge command.
 */
export async function classifyNow(): Promise<ClassifyReport | null> {
  await runClassification(true)
  return lastReport
}

async function runClassification(force = false): Promise<void> {
  const source =
    pendingLeaves.length > 0
      ? pendingLeaves
      : (() => {
          try {
            const tree = deserializePanes(localStorage.getItem(PANES_STORAGE_KEY))
            return tree ? collectLeaves(tree) : []
          } catch {
            return []
          }
        })()
  pendingLeaves = []

  const cards = useApp.getState().cards ?? []
  const agents = useApp.getState().agents ?? []
  const agentDomain = new Map(agents.map((a) => [a.id, a.domain]))

  // What needs (re)classifying: unbound terminal leaves with no domain or
  // a moved context signature. Bound leaves inherit the agent's domain.
  const directUpdates = new Map<string, AgentDomain>()
  const pending: { leaf: PaneLeaf; ctx: LeafContext; sig: string }[] = []

  for (const leaf of source) {
    if (leaf.kind !== 'terminal') continue
    if (leaf.agentId) {
      const d = agentDomain.get(leaf.agentId)
      if (d && leaf.domain !== d) directUpdates.set(leaf.id, d)
      if (d) lastSig.set(leaf.id, { sig: `agent:${d}`, strong: true, triedAt: Date.now() })
      continue
    }
    const { ctx, sig } = baseContext(leaf, cards)
    const prev = lastSig.get(leaf.id)
    const changed = !prev || prev.sig !== sig
    const staleWeak = !!prev && !prev.strong && Date.now() - prev.triedAt > RETRY_WEAK_MS
    if (!force && leaf.domain && !changed && !staleWeak) continue
    if (inflight.has(leaf.id)) continue
    pending.push({ leaf, ctx, sig })
  }

  // Scrollback tails + resumed-session titles — only for pending leaves.
  await Promise.all(
    pending.map(async (p) => {
      await Promise.all([fillTail(p.ctx, p.leaf), fillSession(p.ctx, p.leaf)])
    })
  )

  if (pending.length === 0 && directUpdates.size === 0) {
    lastReport = { at: Date.now(), jevApi: !!window.terrarium?.jevDecide, jevError, jevAnswers: 0, leaves: [] }
    return
  }
  for (const p of pending) inflight.add(p.leaf.id)

  try {
    const jev = await jevDomains(pending)
    const updates = new Map<string, AgentDomain>(directUpdates)
    const report: ClassifyReport = {
      at: Date.now(),
      jevApi: !!window.terrarium?.jevDecide,
      jevError,
      jevAnswers: jev?.size ?? 0,
      leaves: []
    }
    for (const p of pending) {
      const jevDomain = jev?.get(p.leaf.id)
      const domain = jevDomain ?? heuristicDomain(p.ctx)
      updates.set(p.leaf.id, domain)
      // strong only when Jev actually answered this leaf — heuristic-only
      // results stay eligible for a later upgrade pass
      lastSig.set(p.leaf.id, { sig: p.sig, strong: !!jevDomain, triedAt: Date.now() })
      report.leaves.push({
        id: p.leaf.id,
        title: p.leaf.title,
        domain,
        via: jevDomain ? 'jev' : 'heuristic',
        tailChars: p.ctx.tail.length,
        sessionTitle: p.ctx.sessionTitle || undefined
      })
    }
    for (const [id, d] of directUpdates) {
      report.leaves.push({ id, domain: d, via: 'agent', tailChars: 0 })
    }
    lastReport = report

    if (domainDispatch) domainDispatch(updates)
    else applyDomainsToStorage(updates)
  } finally {
    for (const p of pending) inflight.delete(p.leaf.id)
  }
}
