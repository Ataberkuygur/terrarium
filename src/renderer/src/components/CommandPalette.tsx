import { useEffect, useRef, useState } from 'react'
import { Command, useCommandState } from 'cmdk'
import type { WikiPageMeta } from '@shared/types'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { isEnabled, setEnabled } from '../lib/audio'
import {
  BookOpen,
  Clock,
  Columns2,
  Columns3,
  FileText,
  Globe,
  GraduationCap,
  Grid2x2,
  LayoutGrid,
  MessageSquare,
  MonitorPlay,
  PanelLeft,
  PanelsTopLeft,
  Plus,
  Save,
  Search,
  Square,
  SquareTerminal,
  Unlock,
  User,
  Volume2,
  VolumeX,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { uiTap } from '../lib/sfx'
import { PRESETS, type PresetIcon } from '../lib/panes'
import {
  APPLY_PRESET_EVENT,
  SPAWN_PANE_EVENT,
  fireWorkspaceEvent
} from '../lib/workspace-events'

const RECENT_KEY = 'terrarium.palette.recent'
const MAX_RECENT = 5
const MAX_WIKI_HITS = 6

/** consistent padding + micro-label styling for every group heading */
const GROUP_CLS = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5'

/** panes.ts is React-free — PresetIcon → LucideIcon mapping mirrors the workspace toolbar. */
const PRESET_CMD_ICONS: Record<PresetIcon, LucideIcon> = {
  solo: Square,
  split: Columns2,
  grid: Grid2x2,
  code: PanelLeft,
  watch: MonitorPlay
}

type Cmd = {
  key: string
  /** display text — also the item's cmdk value and the label persisted to Recents */
  label: string
  icon: LucideIcon
  keywords?: string[]
  hint?: string
  disabled?: boolean
  /** agent identity hue — the only colour allowed in the chrome */
  hue?: number
  run: () => void
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT)
  } catch {
    return [] // storage unavailable / corrupt — non-fatal
  }
}

export function CommandPalette() {
  const paletteOpen = useApp((s) => s.paletteOpen)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const setView = useApp((s) => s.setView)
  const agents = useApp((s) => s.agents)
  const runs = useApp((s) => s.runs)
  const wikiPages = useApp((s) => s.wikiPages)
  const setActivePage = useApp((s) => s.setActivePage)
  const selectAgent = useApp((s) => s.selectAgent)
  const openAgentTerminal = useApp((s) => s.openAgentTerminal)
  const openAgentChat = useApp((s) => s.openAgentChat)

  const [query, setQuery] = useState('')
  const [wikiHits, setWikiHits] = useState<WikiPageMeta[]>([])
  // query string the current hits were resolved for — `q !== resolvedQ` means
  // a search is pending (debouncing or in flight), derived synchronously so
  // the "Searching…" row never flashes a stale "No matching pages"
  const [resolvedQ, setResolvedQ] = useState('')
  const [recents, setRecents] = useState<string[]>(loadRecents)
  const [soundOn, setSoundOn] = useState<boolean>(() => isEnabled())
  // monotonically increasing search id — a resolved response whose id is no
  // longer current is stale and dropped
  const seq = useRef(0)

  const q = query.trim()

  // Ctrl+K toggles, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(!useApp.getState().paletteOpen)
      }
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  // fresh state on every open; bumping seq on either transition also
  // invalidates a search that is still in flight when the palette closes
  useEffect(() => {
    seq.current++
    if (paletteOpen) {
      setQuery('')
      setWikiHits([])
      setResolvedQ('')
      setSoundOn(isEnabled())
    }
  }, [paletteOpen])

  // debounced live wiki search (150 ms); previous hits stay on screen until
  // the new response lands so the list doesn't flicker while typing
  useEffect(() => {
    const id = ++seq.current
    if (!q) {
      setWikiHits([])
      setResolvedQ('')
      return
    }
    const t = window.setTimeout(() => {
      const projectId = useApp.getState().projects[0]?.id ?? 'proj-terrarium'
      getEngine()
        .searchWiki(projectId, q)
        .then((pages) => {
          if (seq.current !== id) return // superseded by a newer query — ignore
          setWikiHits(pages.slice(0, MAX_WIKI_HITS))
          setResolvedQ(q)
        })
        .catch(() => {
          if (seq.current !== id) return
          setWikiHits([])
          setResolvedQ(q)
        })
    }, 150)
    return () => window.clearTimeout(t)
  }, [q])

  if (!paletteOpen) return null

  const pushRecent = (label: string) => {
    setRecents((prev) => {
      const next = [label, ...prev.filter((l) => l !== label)].slice(0, MAX_RECENT)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        /* private mode — non-fatal */
      }
      return next
    })
  }

  const exec = (label: string, fn: () => void) => () => {
    pushRecent(label)
    fn()
    setPaletteOpen(false)
  }

  const waitingAgentIds = [
    ...new Set(runs.filter((r) => r.status === 'waiting').map((r) => r.agentId))
  ]

  const viewCmds: Cmd[] = [
    {
      key: 'v-office',
      label: 'Office — watch the crew',
      icon: LayoutGrid,
      keywords: ['office'],
      run: () => setView('office')
    },
    {
      key: 'v-board',
      label: 'Tasks — to-do board & runs',
      icon: Columns3,
      keywords: ['board', 'tasks', 'todo', 'to-do'],
      run: () => setView('board')
    },
    {
      key: 'v-wiki',
      label: 'Wiki — project knowledge',
      icon: BookOpen,
      keywords: ['wiki'],
      run: () => setView('wiki')
    },
    {
      key: 'v-quiz',
      label: 'Quiz — daily codebase knowledge',
      icon: GraduationCap,
      keywords: ['quiz', 'test', 'learn', 'wiki', 'daily', 'gunluk'],
      run: () => setView('quiz')
    }
  ]

  const actionCmds: Cmd[] = [
    {
      key: 'a-new-card',
      label: 'New task card',
      icon: Plus,
      keywords: ['card', 'task', 'create'],
      run: () => useApp.getState().requestNewCard()
    },
    {
      key: 'a-unblock',
      label: 'Unblock all waiting runs',
      icon: Unlock,
      keywords: ['unblock', 'approve', 'waiting', 'continue'],
      hint: waitingAgentIds.length > 0 ? `${waitingAgentIds.length}` : 'none',
      disabled: waitingAgentIds.length === 0,
      run: () => {
        // re-read at fire time — runs may have changed since this render
        const engine = getEngine()
        const ids = new Set(
          useApp
            .getState()
            .runs.filter((r) => r.status === 'waiting')
            .map((r) => r.agentId)
        )
        for (const id of ids) void engine.nudgeAgent(id, 'approved, continue')
      }
    },
    // "Open agent terminal…" — one item per agent
    ...agents.map<Cmd>((a) => ({
      key: `a-term-${a.id}`,
      label: `Terminal — ${a.name}`,
      icon: SquareTerminal,
      keywords: ['terminal', a.name, a.role],
      hint: a.role,
      run: () => openAgentTerminal(a.id)
    })),
    {
      key: 'a-tidy',
      label: 'Tidy workspace panes',
      icon: PanelsTopLeft,
      keywords: ['tidy', 'workspace', 'panes', 'arrange'],
      run: () => setView('workspace')
    },
    {
      key: 'a-save',
      label: 'Save workspace & app state',
      icon: Save,
      keywords: ['save', 'kaydet', 'state', 'session', 'workspace'],
      hint: 'Ctrl+S',
      run: () => {
        useApp.getState().saveState()
        uiTap()
      }
    },
    {
      key: 'a-sound',
      label: 'Toggle sound',
      icon: soundOn ? Volume2 : VolumeX,
      keywords: ['sound', 'audio', 'mute', 'volume'],
      hint: soundOn ? 'on' : 'off',
      run: () => {
        const next = !isEnabled()
        setEnabled(next)
        setSoundOn(next)
      }
    }
  ]

  // Workspace commands — presets/spawn/brief are CustomEvents because the
  // workspace view unmounts on every view switch; fireWorkspaceEvent also
  // stashes the payload so a view mounting a beat later still picks it up
  // (see lib/workspace-events.ts). Chat goes through openAgentChat, which
  // is store-driven and survives the same mount gap.
  const workspaceCmds: Cmd[] = [
    ...PRESETS.map<Cmd>((p) => ({
      key: `ws-preset-${p.id}`,
      label: `Apply layout: ${p.label}`,
      icon: PRESET_CMD_ICONS[p.icon],
      keywords: ['layout', 'preset', 'workspace', 'panes', p.label.toLowerCase()],
      hint: p.kbd,
      run: () => {
        setView('workspace')
        fireWorkspaceEvent(APPLY_PRESET_EVENT, p.id)
      }
    })),
    {
      key: 'ws-browser',
      label: 'New browser pane',
      icon: Globe,
      keywords: ['browser', 'pane', 'web', 'url', 'workspace'],
      run: () => {
        setView('workspace')
        fireWorkspaceEvent(SPAWN_PANE_EVENT, { kind: 'browser' })
      }
    },
    // "New chat with <agent>" — one item per agent
    ...agents.map<Cmd>((a) => ({
      key: `ws-chat-${a.id}`,
      label: `New chat with ${a.name}`,
      icon: MessageSquare,
      keywords: ['chat', 'agent', 'workspace', a.name, a.role],
      hint: a.role,
      hue: a.hue,
      run: () => openAgentChat(a.id)
    }))
  ]

  const crewCmds: Cmd[] = agents.map((a) => ({
    key: `c-${a.id}`,
    label: a.name,
    icon: User,
    keywords: [a.role],
    hint: a.role,
    hue: a.hue,
    run: () => {
      setView('office')
      selectAgent(a.id)
    }
  }))

  const wikiCmds: Cmd[] = wikiPages.map((p) => ({
    key: `w-${p.id}`,
    label: p.title,
    icon: FileText,
    keywords: [p.type],
    hint: p.type,
    run: () => {
      setView('wiki')
      setActivePage(p.id)
    }
  }))

  // label → action, so persisted "Recent" labels can be re-run; entries that
  // no longer resolve (renamed agent, deleted page) are simply skipped
  const byLabel = new Map<string, () => void>()
  for (const c of [...viewCmds, ...actionCmds, ...workspaceCmds, ...crewCmds, ...wikiCmds]) {
    byLabel.set(c.label, c.run)
  }
  for (const p of wikiHits) {
    if (!byLabel.has(p.title)) {
      byLabel.set(p.title, () => {
        setView('wiki')
        setActivePage(p.id)
      })
    }
  }

  const recentCmds = recents
    .map((label) => ({ label, run: byLabel.get(label) }))
    .filter((r): r is { label: string; run: () => void } => r.run !== undefined)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={() => setPaletteOpen(false)}
    >
      <div className="absolute inset-0 bg-black/55" />
      <Command
        className="relative w-[600px] max-w-[90vw] overflow-hidden rounded-xl border border-[var(--border-default)] bg-popover/95 shadow-lg-dark backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4">
          <Zap size={15} className="text-t3" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Type a command or search…"
            className="h-12 flex-1 bg-transparent text-[14px] text-t1 placeholder:text-t4 outline-none"
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
          <Command.Empty className="py-8 text-center text-[13px] text-t4">
            No results.
          </Command.Empty>

          {!q && recentCmds.length > 0 && (
            <Command.Group heading={<span className="micro-label">Recent</span>} className={GROUP_CLS}>
              {recentCmds.map(({ label, run }) => (
                <Item
                  key={`r-${label}`}
                  value={`recent ${label}`}
                  keywords={[label]}
                  onSelect={exec(label, run)}
                >
                  <Clock size={14} className="text-t3" /> {label}
                </Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading={<span className="micro-label">Go to</span>} className={GROUP_CLS}>
            {viewCmds.map((c) => (
              <CmdItem key={c.key} cmd={c} exec={exec} />
            ))}
          </Command.Group>

          <Command.Group heading={<span className="micro-label">Actions</span>} className={GROUP_CLS}>
            {actionCmds.map((c) => (
              <CmdItem key={c.key} cmd={c} exec={exec} />
            ))}
          </Command.Group>

          <Command.Group
            heading={<span className="micro-label">Workspace</span>}
            className={GROUP_CLS}
          >
            {workspaceCmds.map((c) => (
              <CmdItem key={c.key} cmd={c} exec={exec} />
            ))}
          </Command.Group>

          {q && (
            <Command.Group
              heading={<span className="micro-label">Wiki results</span>}
              className={GROUP_CLS}
            >
              {wikiHits.map((p) => (
                <Item
                  key={`hit-${p.id}`}
                  value={`wikihit ${p.id}`}
                  // the query itself as a keyword keeps async hits visible even
                  // when the match was in the page body, not the title
                  keywords={[q, p.title, p.type]}
                  onSelect={exec(p.title, () => {
                    setView('wiki')
                    setActivePage(p.id)
                  })}
                >
                  <FileText size={14} className="text-t3" />
                  {p.title}
                  <span className="ml-auto text-[11px] text-t4">{p.type}</span>
                </Item>
              ))}
              {q !== resolvedQ && wikiHits.length === 0 && (
                <Item disabled value={`searching ${q}`} keywords={[q]} onSelect={() => undefined}>
                  <Search size={14} className="text-t4" />
                  <span className="text-t4">Searching wiki…</span>
                </Item>
              )}
              {q === resolvedQ && wikiHits.length === 0 && (
                <Item disabled value={`no-hits ${q}`} keywords={[q]} onSelect={() => undefined}>
                  <FileText size={14} className="text-t4" />
                  <span className="text-t4">No matching pages</span>
                </Item>
              )}
            </Command.Group>
          )}

          {crewCmds.length > 0 && (
            <Command.Group heading={<span className="micro-label">Crew</span>} className={GROUP_CLS}>
              {crewCmds.map((c) => (
                <CmdItem key={c.key} cmd={c} exec={exec} />
              ))}
            </Command.Group>
          )}

          {wikiCmds.length > 0 && (
            <Command.Group heading={<span className="micro-label">Wiki</span>} className={GROUP_CLS}>
              {wikiCmds.map((c) => (
                <CmdItem key={c.key} cmd={c} exec={exec} />
              ))}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center gap-4 border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-t4">
          <kbd className="kbd">?</kbd>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">↵</kbd> select
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">esc</kbd> close
          </span>
          {q && <ResultCount />}
        </div>
      </Command>
    </div>
  )
}

/** live filtered-item count for the footer; must render inside <Command> */
function ResultCount() {
  const count = useCommandState((s) => s.filtered.count)
  return (
    <span className="ml-auto tnum">
      {count} result{count === 1 ? '' : 's'}
    </span>
  )
}

function CmdItem({
  cmd,
  exec
}: {
  cmd: Cmd
  exec: (label: string, fn: () => void) => () => void
}) {
  const Icon = cmd.icon
  return (
    <Item
      value={cmd.label}
      keywords={cmd.keywords}
      disabled={cmd.disabled}
      onSelect={exec(cmd.label, cmd.run)}
    >
      <Icon
        size={14}
        className={cmd.hue === undefined ? 'text-t3' : undefined}
        style={cmd.hue === undefined ? undefined : { color: `hsl(${cmd.hue} 60% 60%)` }}
      />
      {cmd.label}
      {cmd.hint !== undefined && (
        <span className="ml-auto text-[11px] text-t4">{cmd.hint}</span>
      )}
    </Item>
  )
}

function Item({
  children,
  onSelect,
  keywords,
  value,
  disabled
}: {
  children: React.ReactNode
  onSelect: () => void
  keywords?: string[]
  value?: string
  disabled?: boolean
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords}
      value={value}
      disabled={disabled}
      className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] text-t2 data-[selected=true]:bg-n4 data-[selected=true]:text-t1 data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50"
    >
      {children}
    </Command.Item>
  )
}
