// ── SessionRail — right-edge session/crew strip for the workspace ─────
// Every leaf gets a row grouped by its bound agent's domain; unbound
// terminals group under their classified work area (other unbound panes
// land under 'panes'). Leaves filed under a user category (leaf.category)
// group first, in registry order. Group headers carry an eye toggle that
// hides the group's panes from the grid (sessions keep running — it's a
// view filter, not a close). Rows support ctrl/shift multi-select and a
// right-click category menu. Collapses to a 28px icon strip.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  Eye,
  EyeOff,
  History,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  Tag
} from 'lucide-react'
import clsx from 'clsx'
import type { AgentDomain } from '@shared/types'
import type { PaneLeaf } from '../lib/panes'
import { isResumableCli, type CliSessionEntry } from '@shared/cli-sessions'
import { effectiveBrandCommand, effectiveCli, useLiveCli } from '../lib/live-cli'
import { cliBrand } from '../components/CliBrand'
import { groupKeyForLeaf } from '../lib/categories'
import { useApp } from '../lib/store'
import { CategoryMenu } from './CategoryMenu'
import { StatusDot } from '../components/StatusDot'
import { PANE_META } from './EmptyPane'
import { paneTitle } from './PaneFrame'
import { usePaneDispatch } from './pane-context'
import {
  resumeLeafSession,
  sessionDetail,
  sessionMatches,
  useCliSessions
} from './cli-session-ui'
import { uiTap } from '../lib/sfx'
import { OrchestrationRail, useOrchestrationCount } from './OrchestrationRail'

export interface SessionRailProps {
  leaves: PaneLeaf[]
  focusedId: string | null
  onFocusLeaf: (id: string) => void
  onSpawnChat: (agentId: string) => void
}

// same domain palette the office crew rail uses — the only non-token hues
const DOMAIN_DOT: Record<AgentDomain, string> = {
  general: '#94a3b8',
  frontend: '#7dd3fc',
  backend: '#fbbf24',
  design: '#c084fc',
  research: '#4ade80',
  marketing: '#f472b6',
  legal: '#facc15'
}

// fixed group order — lead/general first, then build → design → outreach
const DOMAIN_ORDER: AgentDomain[] = [
  'general',
  'frontend',
  'backend',
  'design',
  'research',
  'marketing',
  'legal'
]

// group keys are free-form now — AgentDomain | 'panes' | user category names
function groupDot(key: string): string {
  if (key === 'panes') return 'var(--color-n8)'
  if (key in DOMAIN_DOT) return DOMAIN_DOT[key as AgentDomain]
  return 'var(--color-accent)' // user categories
}

const iconBtn =
  'flex h-5 w-5 items-center justify-center rounded text-t4 transition-colors hover:bg-n4 hover:text-t2'

// drag-resizable width — persisted so a widened rail survives reloads
const RAIL_W_KEY = 'terrarium.rail.w'
const RAIL_MIN = 132
const RAIL_MAX = 320
const RAIL_DEFAULT = 150

function loadRailWidth(): number {
  const v = Number(localStorage.getItem(RAIL_W_KEY))
  return Number.isFinite(v) && v > 0 ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, v)) : RAIL_DEFAULT
}

export function SessionRail({ leaves, focusedId, onFocusLeaf, onSpawnChat }: SessionRailProps) {
  const orchCount = useOrchestrationCount()
  const dispatch = usePaneDispatch()
  const agents = useApp((s) => s.agents)
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  const categories = useApp((s) => s.categories)
  const hiddenCategories = useApp((s) => s.hiddenCategories)
  const toggleCategoryHidden = useApp((s) => s.toggleCategoryHidden)
  const [collapsed, setCollapsed] = useState(false)
  const [railW, setRailW] = useState(loadRailWidth)
  const railWRef = useRef(railW)

  // multi-select: anchor is the last plain/ctrl-clicked row; shift+click
  // extends the range over the rail's flattened visual order
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  // fixed-position category menu (context menu and per-row tag button)
  const [menu, setMenu] = useState<{ x: number; y: number; targets: PaneLeaf[] } | null>(null)

  // left-edge drag — the rail is right-anchored so dragging left widens
  const startRailDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = railWRef.current
    const prevSelect = document.documentElement.style.userSelect
    document.documentElement.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, startW + (startX - ev.clientX)))
      railWRef.current = w
      setRailW(w)
    }
    const onUp = () => {
      document.documentElement.style.userSelect = prevSelect
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem(RAIL_W_KEY, String(Math.round(railWRef.current)))
      } catch {
        /* storage unavailable — width just won't persist */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const boundIds = useMemo(() => {
    const s = new Set<string>()
    for (const l of leaves) if (l.agentId) s.add(l.agentId)
    return s
  }, [leaves])

  // leaf → group key (groupKeyForLeaf — shared with the workspace's hidden
  // filter): leaf.category wins, then the bound agent's domain ('general'
  // when the agent is gone or its domain is stale); unbound terminals group
  // under their classified work area so the rail reads 'marketing: Korpus';
  // anything else lands under 'panes'
  const groups = useMemo(() => {
    const m = new Map<string, PaneLeaf[]>()
    for (const leaf of leaves) {
      const domain = leaf.agentId ? agentById.get(leaf.agentId)?.domain : undefined
      const key = groupKeyForLeaf(leaf, domain)
      const list = m.get(key)
      if (list) list.push(leaf)
      else m.set(key, [leaf])
    }
    const ordered: [string, PaneLeaf[]][] = []
    // user categories first, in registry order
    for (const c of categories) {
      const list = m.get(c)
      if (list) {
        ordered.push([c, list])
        m.delete(c)
      }
    }
    for (const d of DOMAIN_ORDER) {
      const list = m.get(d)
      if (list) {
        ordered.push([d, list])
        m.delete(d)
      }
    }
    const panes = m.get('panes')
    if (panes) {
      ordered.push(['panes', panes])
      m.delete('panes')
    }
    for (const [k, l] of m) ordered.push([k, l]) // unregistered categories last
    return ordered
  }, [leaves, agentById, categories])

  const hiddenSet = useMemo(() => new Set(hiddenCategories), [hiddenCategories])
  // flattened visual order — the shift+click range domain
  const flatLeaves = useMemo(() => groups.flatMap(([, list]) => list), [groups])

  // drop stale ids when leaves close
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const live = new Set(leaves.map((l) => l.id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [leaves])

  // Esc clears the selection — skipped while a menu is open (its own
  // capture-phase Esc owns the keypress)
  useEffect(() => {
    if (menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected((prev) => (prev.size ? new Set() : prev))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const onRowClick = (e: ReactMouseEvent, leaf: PaneLeaf) => {
    if (e.shiftKey) {
      const ids = flatLeaves.map((l) => l.id)
      const a = anchorId ? ids.indexOf(anchorId) : -1
      const b = ids.indexOf(leaf.id)
      if (b === -1) return
      const [lo, hi] = a === -1 ? [b, b] : [Math.min(a, b), Math.max(a, b)]
      setSelected(new Set(ids.slice(lo, hi + 1)))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(leaf.id)) next.delete(leaf.id)
      else next.add(leaf.id)
      setSelected(next)
      setAnchorId(leaf.id)
      return
    }
    // plain click: focus as before, selection collapses to the anchor
    setSelected(new Set())
    setAnchorId(leaf.id)
    onFocusLeaf(leaf.id)
  }

  const onRowContextMenu = (e: ReactMouseEvent, leaf: PaneLeaf) => {
    e.preventDefault()
    // a right-clicked member of the selection targets them all; otherwise
    // it targets (and becomes) the selection
    let targets: PaneLeaf[]
    if (selected.has(leaf.id)) {
      targets = flatLeaves.filter((l) => selected.has(l.id))
    } else {
      targets = [leaf]
      setSelected(new Set([leaf.id]))
      setAnchorId(leaf.id)
    }
    setMenu({ x: e.clientX, y: e.clientY, targets })
  }

  if (collapsed) {
    return (
      <div className="flex w-7 shrink-0 flex-col items-center gap-0.5 border-l border-[var(--border-subtle)] bg-n1 py-1">
        <button
          type="button"
          title="Expand sessions"
          aria-label="Expand sessions"
          onClick={() => setCollapsed(false)}
          className={iconBtn}
        >
          <PanelRightOpen size={12} />
        </button>
        <button
          type="button"
          title="Tidy layout — evenly resize all panes (Ctrl+Shift+T)"
          aria-label="Tidy layout"
          disabled={leaves.length <= 1}
          onClick={() => {
            uiTap()
            dispatch?.({ type: 'tidy' })
          }}
          className={clsx(
            iconBtn,
            'hover:text-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30'
          )}
        >
          <Sparkles size={11} strokeWidth={1.75} />
        </button>
        <span className="my-1 h-px w-4 bg-[var(--border-subtle)]" />
        {leaves.map((leaf) => {
          const focused = leaf.id === focusedId
          const dim = hiddenSet.has(
            groupKeyForLeaf(leaf, leaf.agentId ? agentById.get(leaf.agentId)?.domain : undefined)
          )
          return (
            <button
              key={leaf.id}
              type="button"
              title={paneTitle(leaf)}
              onClick={() => onFocusLeaf(leaf.id)}
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                focused ? 'bg-n3 text-t1' : 'text-t4 hover:bg-n2 hover:text-t2',
                dim && 'opacity-40'
              )}
            >
              <LeafMark leaf={leaf} size={11} />
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className="relative flex shrink-0 flex-col border-l border-[var(--border-subtle)] bg-n1"
      style={{ width: railW }}
    >
      {/* left-edge resize grip — fat invisible target over the border */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sessions rail"
        title="Drag to resize"
        onPointerDown={startRailDrag}
        className="group/rail absolute inset-y-0 -left-1 z-10 w-[7px] cursor-col-resize touch-none"
      >
        <span className="absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors group-hover/rail:bg-[var(--border-strong)] group-active/rail:bg-[var(--color-accent)]" />
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] pr-1 pl-2.5 select-none">
        <span className="micro-label">Sessions · {leaves.length + orchCount}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Tidy layout — evenly resize all panes (Ctrl+Shift+T)"
            aria-label="Tidy layout"
            disabled={leaves.length <= 1}
            onClick={() => {
              uiTap()
              dispatch?.({ type: 'tidy' })
            }}
            className={clsx(
              iconBtn,
              'hover:text-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30'
            )}
          >
            <Sparkles size={11} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Collapse sessions"
            aria-label="Collapse sessions"
            onClick={() => setCollapsed(true)}
            className={iconBtn}
          >
            <PanelRightClose size={12} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 py-1">
        {groups.map(([key, list]) => {
          const groupHidden = hiddenSet.has(key)
          return (
          <div key={key} className="pb-1">
            <div
              className={clsx(
                'flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5 select-none',
                groupHidden && 'opacity-50'
              )}
            >
              <span className="h-1 w-1 rounded-full" style={{ background: groupDot(key) }} />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.05em] text-t4 uppercase">
                {key}
              </span>
              <button
                type="button"
                title={groupHidden ? `Show '${key}' panes` : `Hide '${key}' panes`}
                aria-label={groupHidden ? `Show ${key}` : `Hide ${key}`}
                aria-pressed={groupHidden}
                onClick={() => toggleCategoryHidden(key)}
                className={clsx(iconBtn, 'h-4 w-4 shrink-0')}
              >
                {groupHidden ? (
                  <EyeOff size={11} strokeWidth={1.75} />
                ) : (
                  <Eye size={11} strokeWidth={1.75} />
                )}
              </button>
            </div>
            {list.map((leaf) => {
              const agent = leaf.agentId ? agentById.get(leaf.agentId) : undefined
              const focused = leaf.id === focusedId
              const isSel = selected.has(leaf.id)
              return (
                // hidden groups stay listed — dimmed — so they can be
                // selected/unhidden without leaving the rail
                <div key={leaf.id} className={clsx(groupHidden && 'opacity-40')}>
                  <div className="group relative">
                    <button
                      type="button"
                      onClick={(e) => onRowClick(e, leaf)}
                      onContextMenu={(e) => onRowContextMenu(e, leaf)}
                      title={paneTitle(leaf)}
                      className={clsx(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors select-none',
                        isSel
                          ? 'bg-n3 ring-1 ring-[var(--color-accent)]'
                          : focused
                            ? 'bg-n3 ring-1 ring-[var(--border-strong)]'
                            : 'hover:bg-n2'
                      )}
                    >
                      <LeafMark
                        leaf={leaf}
                        size={11}
                        className={clsx('shrink-0', focused ? 'text-accent' : 'text-t3')}
                      />
                      <span
                        className={clsx(
                          'min-w-0 flex-1 truncate text-[11px]',
                          focused ? 'text-t1' : 'text-t2'
                        )}
                      >
                        {paneTitle(leaf)}
                      </span>
                      {agent && (
                        // the hover tag button overlays this corner — hide
                        // the dot so they don't collide
                        <span className="group-hover:invisible">
                          <StatusDot status={agent.status} size={5} />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      title="Assign category"
                      aria-label={`Assign category to ${paneTitle(leaf)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenu({ x: r.right - 8, y: r.bottom + 4, targets: [leaf] })
                      }}
                      className="absolute top-1/2 right-1 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-t4 opacity-0 transition-all group-hover:opacity-100 hover:bg-n4 hover:text-t2"
                    >
                      <Tag size={10} strokeWidth={1.75} />
                    </button>
                  </div>
                  {leaf.kind === 'terminal' && (
                    <LeafSessions leaf={leaf} projectRoot={projectRoot} />
                  )}
                </div>
              )
            })}
          </div>
          )
        })}
        <OrchestrationRail />
        {leaves.length === 0 && orchCount === 0 && (
          <p className="px-2.5 pt-2 text-[10.5px] text-t4">No panes open.</p>
        )}
      </div>
      </div>
      {menu && (
        <CategoryMenu
          x={menu.x}
          y={menu.y}
          targets={menu.targets}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// Row icon: a terminal shows the brand of the CLI it's running — bound or
// detected live (a powershell pane where the user typed `codex` reads as
// Codex) — plain shells and other pane kinds keep their kind icon.
function LeafMark({
  leaf,
  size,
  className
}: {
  leaf: PaneLeaf
  size: number
  className?: string
}) {
  const live = useLiveCli(leaf)
  const Icon = (PANE_META[leaf.kind] ?? PANE_META.terminal).icon
  if (leaf.kind === 'terminal') {
    const b = cliBrand(effectiveBrandCommand(leaf, live))
    if (b.id !== 'shell') {
      return (
        <span className="flex shrink-0 items-center" title={b.label}>
          {b.mark(size)}
        </span>
      )
    }
  }
  return <Icon size={size} strokeWidth={1.75} className={className} />
}

// Past-session sub-rows under a resumable-CLI terminal — the whole fetched
// list in a capped, scrollable strip with a tiny live filter matching the
// row's visible text (summary / id / cwd). Clicking resumes the session
// into that pane, in the transcript's own directory.
function LeafSessions({
  leaf,
  projectRoot
}: {
  leaf: PaneLeaf
  projectRoot: string | undefined
}) {
  const dispatch = usePaneDispatch()
  // bound CLI, or the one detected running in a shell pane (typed
  // `claude --resume`, `codex`, … — lib/live-cli)
  const live = useLiveCli(leaf)
  const cli = effectiveCli(leaf, live)
  const fetched = useCliSessions(cli && isResumableCli(cli) ? cli : null)
  const liveId = live && live.cli === cli ? live.sessionId : null
  // the session running in this pane leads the list, even when the store
  // listing hasn't picked it up yet (fresh transcript / past the scan cap)
  const sessions = useMemo((): CliSessionEntry[] | null => {
    if (!fetched) return liveId ? [{ id: liveId, at: Date.now(), summary: null, cwd: live?.cwd ?? null }] : null
    if (!liveId) return fetched
    const own = fetched.find((s) => s.id === liveId) ?? {
      id: liveId,
      at: Date.now(),
      summary: null,
      cwd: live?.cwd ?? null
    }
    return [own, ...fetched.filter((s) => s.id !== liveId)]
  }, [fetched, liveId, live?.cwd])
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => sessions?.filter((s) => sessionMatches(s, query)) ?? [],
    [sessions, query]
  )
  if (!sessions || sessions.length === 0) return null
  return (
    <div className="pb-0.5">
      <div className="relative py-0.5 pr-2 pl-[26px]">
        <Search
          size={9}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-[31px] -translate-y-1/2 text-t4/70"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            if (query) setQuery('')
            else e.currentTarget.blur()
          }}
          placeholder="filter sessions"
          aria-label="Filter past sessions"
          spellCheck={false}
          className="h-5 w-full rounded border border-[var(--border-subtle)] bg-n2/60 pr-1.5 pl-[18px] text-[10.5px] text-t2 outline-none transition-colors placeholder:text-t4/60 focus:border-[var(--border-strong)]"
        />
      </div>
      <div className="scroll-thin max-h-[200px] overflow-y-auto">
        {filtered.map((s) => {
          const running = s.id === liveId
          return (
            <button
              key={s.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // already running here — nothing to resume
                if (running) return
                if (cli) resumeLeafSession(dispatch, leaf, cli, s)
              }}
              title={running ? 'Running in this pane' : s.cwd ? `Resume in ${s.cwd}` : 'Resume session'}
              className={clsx(
                'flex w-full items-center gap-1.5 rounded-md py-0.5 pr-2 pl-[26px] text-left transition-colors',
                running ? 'cursor-default bg-n2/60' : 'hover:bg-n2'
              )}
            >
              {running ? (
                <span
                  className="mx-[2px] h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ background: 'var(--color-accent)' }}
                />
              ) : (
                <History size={9} strokeWidth={1.75} className="shrink-0 text-t4" />
              )}
              <span
                className={clsx(
                  'min-w-0 flex-1 truncate text-[10.5px]',
                  running ? 'text-t2' : 'text-t4'
                )}
              >
                {s.summary ?? `#${s.id.slice(0, 8)}`}
              </span>
              <span className="tnum max-w-[56px] shrink-0 truncate text-[9.5px] text-t4/70">
                {running ? 'live' : sessionDetail(s, projectRoot)}
              </span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="py-0.5 pr-2 pl-[26px] text-[10px] text-t4/60">No matches.</p>
        )}
      </div>
    </div>
  )
}
