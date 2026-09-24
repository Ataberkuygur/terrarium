// ── office ───────────────────────────────────────────────────────────
// The office tab is a street-level city: the company HQ tower stands
// across the road, one floor per department. Click a floor to step
// inside that department's interior, or split the screen into a grid
// of 4/6/8/all live department tiles. Agents are the live workspace
// terminal sessions — same pipeline as before.
//
// Modes: 'city' (default) · 'dept' (one interior, standalone) ·
// 'split' (tile grid). The `mini` prop keeps the legacy single-scene
// render untouched so the PiP dock embeds exactly as it did.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '../lib/store'
import { StatusDot } from '../components/StatusDot'
import { Button } from '../components/ui'
import { OfficeScene } from '../office/OfficeScene'
import { AvengersScene } from '../office/avengers/AvengersScene'
import { CityScene } from '../office/city/CityScene'
import { DeptInterior } from '../office/DeptInterior'
import { mountOfficeAmbience } from '../lib/ambience'
import {
  getAllTerminalLeaves,
  terminalLeavesToAgents,
  spawnTerminalAgent
} from '../lib/terminal-agents'
import {
  createDepartment,
  DEPARTMENT_DOMAINS,
  removeDepartment,
  useDepartments,
  useDeptMap
} from '../lib/departments'
import {
  Terminal,
  Plus,
  ChevronDown,
  Eye,
  Sparkles,
  Cpu,
  PictureInPicture2,
  Building,
  LayoutGrid,
  Maximize2,
  X
} from 'lucide-react'
import type { Agent, AgentDomain } from '@shared/types'

interface LaunchOption {
  key: string
  label: string
  desc: string
  hue: number
}

const LAUNCH_PRESETS: LaunchOption[] = [
  { key: 'claude', label: 'Claude Code', desc: 'Anthropic Autonomous Dev Agent', hue: 280 },
  { key: 'codex', label: 'Codex Agent', desc: 'Backend Architecture & Synthesis', hue: 38 },
  { key: 'opencode', label: 'OpenCode', desc: 'Open-Source Terminal Agent', hue: 100 },
  { key: 'clark', label: 'Clark UI', desc: 'Design Systems & Component Styling', hue: 210 },
  { key: 'devin', label: 'Devin Eng', desc: 'End-to-End Autonomous Engineer', hue: 150 },
  { key: 'cursor', label: 'Cursor CLI', desc: 'Smart Refactoring & Navigation', hue: 240 },
  { key: 'cline', label: 'Cline', desc: 'Autonomous Coding Agent · Plan/Act', hue: 25 },
  { key: 'muse', label: 'Muse', desc: 'Meta Multimodal Agent · Video & Audio', hue: 320 },
  { key: 'qoder', label: 'Qoder', desc: 'Alibaba Agentic Coding Agent', hue: 170 },
  { key: 'pwsh', label: 'PowerShell', desc: 'System Shell & Build Scripts', hue: 195 }
]

type OfficeTheme = 'loft' | 'avengers'

// ── view mode ────────────────────────────────────────────────────────

type OfficeMode = 'city' | 'dept' | 'split'
type SplitCount = 4 | 6 | 8 | 'all'

const SPLIT_KEY = 'terrarium.officeSplit'

/** persisted split tile count — corrupt values fall back to 4 */
function loadSplitCount(): SplitCount {
  const v = localStorage.getItem(SPLIT_KEY)
  if (v === 'all') return 'all'
  if (v === '4' || v === '6' || v === '8') return Number(v) as 4 | 6 | 8
  return 4
}

/** tile grid geometry — fixed counts pin exact rows, 'all' auto-flows */
const SPLIT_GRID: Record<SplitCount, CSSProperties> = {
  4: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' },
  6: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' },
  8: { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' },
  all: { gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gridAutoRows: 'minmax(280px, 1fr)' }
}

// ── add department dialog ────────────────────────────────────────────

/** preset accent hues for custom floors — `null` hue = auto-assigned */
const DEPT_HUE_PRESETS = [330, 210, 155, 95, 45, 15, 275, 190]

function AddDepartmentDialog({ onClose }: { onClose: () => void }) {
  const depts = useDepartments()
  const [name, setName] = useState('')
  const [domains, setDomains] = useState<AgentDomain[]>([])
  const [hue, setHue] = useState<number | null>(null)

  // Esc closes — window-level so it works wherever focus sits
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const customs = depts.filter((d) => !d.builtin)

  const toggleDomain = (d: AgentDomain) =>
    setDomains((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const create = () => {
    createDepartment(name, hue ?? undefined, domains)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[6px]"
      onClick={onClose}
    >
      <div
        className="pop-in w-[348px] rounded-2xl border border-[var(--border-default)] bg-popover p-5 shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="m-0 text-[13.5px] font-semibold tracking-[-0.01em] text-t1">New department</h3>
          <button
            onClick={onClose}
            className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <X size={13} />
          </button>
        </div>

        <div className="micro-label mb-1.5">Name</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="e.g. Research, Design Ops…"
          className="mb-4 h-8 w-full rounded-lg border border-[var(--border-default)] bg-n1/70 px-2.5 text-[12.5px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.5)]"
        />

        <div className="micro-label mb-1.5">Collects domains</div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {DEPARTMENT_DOMAINS.map((d) => {
            const on = domains.includes(d)
            return (
              <button
                key={d}
                onClick={() => toggleDomain(d)}
                className={`h-6 cursor-pointer rounded-full border px-2.5 text-[11px] font-medium capitalize transition-colors ${
                  on
                    ? 'border-[rgba(245,165,36,0.4)] bg-accent-subtle text-accent'
                    : 'border-[var(--border-default)] text-t3 hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1'
                }`}
              >
                {d}
              </button>
            )
          })}
        </div>

        <div className="micro-label mb-1.5">Floor color</div>
        <div className="mb-5 flex items-center gap-2">
          <button
            onClick={() => setHue(null)}
            title="Auto — picks the next free hue"
            className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-[var(--border-default)] bg-n3 text-t3 transition-transform ${
              hue === null ? 'scale-110 ring-2 ring-white/70 ring-offset-2 ring-offset-popover' : 'hover:scale-110'
            }`}
          >
            <Sparkles size={10} />
          </button>
          {DEPT_HUE_PRESETS.map((h) => (
            <button
              key={h}
              onClick={() => setHue(h)}
              title={`Hue ${h}`}
              className={`h-5 w-5 cursor-pointer rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-transform ${
                hue === h ? 'scale-110 ring-2 ring-white/70 ring-offset-2 ring-offset-popover' : 'hover:scale-110'
              }`}
              style={{ background: `hsl(${h} 60% 55%)` }}
            />
          ))}
        </div>

        {/* custom floors are deletable — builtins are permanent */}
        {customs.length > 0 && (
          <>
            <div className="micro-label mb-1.5">Your departments</div>
            <div className="mb-4 flex flex-col gap-1">
              {customs.map((d) => (
                <div
                  key={d.id}
                  className="flex h-8 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-n2 pr-1 pl-2.5"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: `hsl(${d.hue} 60% 55%)` }}
                  />
                  <span className="flex-1 truncate text-[12px] text-t2">{d.name}</span>
                  <button
                    onClick={() => removeDepartment(d.id)}
                    title={`Delete ${d.name}`}
                    className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-t4 transition-colors hover:bg-n4 hover:text-error"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" onClick={create}>
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── office view ──────────────────────────────────────────────────────

export function OfficeView({ mini = false, paused = false }: { mini?: boolean; paused?: boolean }) {
  const openAgentTerminal = useApp((s) => s.openAgentTerminal)
  const officePiP = useApp((s) => s.officePiP)
  const setOfficePiP = useApp((s) => s.setOfficePiP)

  // Dynamic agents strictly mapped 1:1 to live workspace terminal sessions
  const [terminalAgents, setTerminalAgents] = useState<Agent[]>(() => {
    return terminalLeavesToAgents(getAllTerminalLeaves())
  })

  const [targetedAgent, setTargetedAgent] = useState<Agent | null>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [deptDialogOpen, setDeptDialogOpen] = useState(false)

  // Office theme — persisted locally, switch anytime
  const [theme, setTheme] = useState<OfficeTheme>(() =>
    localStorage.getItem('terrarium.officeTheme') === 'avengers' ? 'avengers' : 'loft'
  )

  // View state machine — city street is the default landing mode
  const [view, setView] = useState<OfficeMode>('city')
  const [deptId, setDeptId] = useState<string | null>(null)
  const [splitCount, setSplitCount] = useState<SplitCount>(loadSplitCount)

  // Departments: agents bucketed per floor (explicit → domain → general)
  const { depts, byDept } = useDeptMap(terminalAgents)
  const dept = deptId ? depts.find((d) => d.id === deptId) : undefined

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const id of Object.keys(byDept)) c[id] = byDept[id].length
    return c
  }, [byDept])

  const tileCount = splitCount === 'all' ? depts.length : Math.min(splitCount, depts.length)
  const splitDepts = depts.slice(0, tileCount)

  useEffect(() => {
    localStorage.setItem('terrarium.officeTheme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(SPLIT_KEY, String(splitCount))
  }, [splitCount])

  // The floor was deleted while standing inside it → back to the street
  useEffect(() => {
    if (view === 'dept' && (!deptId || !depts.some((d) => d.id === deptId))) {
      setView('city')
      setDeptId(null)
    }
  }, [view, deptId, depts])

  // scene swaps drop any stale agent target chip
  useEffect(() => {
    setTargetedAgent(null)
  }, [view, deptId])

  // Keep office agents in sync with workspace leaves
  useEffect(() => {
    const refresh = () => {
      const leaves = getAllTerminalLeaves()
      setTerminalAgents(terminalLeavesToAgents(leaves))
    }

    window.addEventListener('storage', refresh)
    window.addEventListener('terrarium:panes-updated', refresh)
    window.addEventListener('terrarium:save-state', refresh)
    const timer = setInterval(refresh, 1200)

    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('terrarium:panes-updated', refresh)
      window.removeEventListener('terrarium:save-state', refresh)
      clearInterval(timer)
    }
  }, [])

  // Office audio ambience tracks active working terminal sessions
  // paused (hidden dock) mutes the ambience too - matches the old unmount semantics
  useEffect(
    () =>
      paused
        ? undefined
        : mountOfficeAmbience(
            () => terminalAgents.filter((a) => a.status === 'working').length
          ),
    [terminalAgents, paused]
  )

  // Direct navigation to that agent's running terminal pane in the workspace
  const goToTerminal = useCallback(
    (agentId: string) => {
      openAgentTerminal(agentId)
    },
    [openAgentTerminal]
  )

  const enterDept = useCallback((id: string) => {
    setDeptId(id)
    setView('dept')
  }, [])

  const handleLaunch = useCallback((cliKey: string) => {
    spawnTerminalAgent(cliKey)
    setLauncherOpen(false)
    const leaves = getAllTerminalLeaves()
    setTerminalAgents(terminalLeavesToAgents(leaves))
  }, [])

  return (
    <div className="relative h-full select-none overflow-hidden bg-canvas">
      {/* scene layer — mini keeps the legacy single-scene render */}
      {mini ? (
        theme === 'avengers' ? (
          <AvengersScene
            agents={terminalAgents}
            onTargetChange={setTargetedAgent}
            onInteract={(agent: Agent) => goToTerminal(agent.id)}
            paused={paused}
          />
        ) : (
          <OfficeScene
            agents={terminalAgents}
            onTargetChange={setTargetedAgent}
            onInteract={(agent) => goToTerminal(agent.id)}
            paused={paused}
          />
        )
      ) : view === 'dept' && dept ? (
        <DeptInterior
          standalone
          dept={dept}
          agents={byDept[dept.id] ?? []}
          theme={theme}
          allAgents={terminalAgents}
          departments={depts}
          onBack={() => setView('city')}
          onSelectAgent={goToTerminal}
          onTargetChange={setTargetedAgent}
          paused={paused}
        />
      ) : view === 'split' ? (
        <div className="grid h-full w-full gap-2 overflow-auto p-2" style={SPLIT_GRID[splitCount]}>
          {splitDepts.map((d) => (
            <div
              key={d.id}
              className="relative overflow-hidden rounded-[10px] border border-[var(--border-default)] shadow-[var(--shadow-card)]"
            >
              <DeptInterior
                compact
                dept={d}
                agents={byDept[d.id] ?? []}
                theme={theme}
                onSelectAgent={goToTerminal}
                onTargetChange={setTargetedAgent}
                paused={paused}
              />
              {/* open this floor full-view */}
              <button
                onClick={() => enterDept(d.id)}
                title={`Open ${d.name}`}
                className="absolute top-2 right-2 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-default)] bg-n2/85 text-t2 shadow-[var(--shadow-card)] backdrop-blur-md transition-colors hover:bg-n4 hover:text-t1"
              >
                <Maximize2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <CityScene
          departments={depts}
          counts={counts}
          onEnterDept={enterDept}
          paused={paused}
          theme={theme}
        />
      )}

      {/* vignette — CSS gradient instead of a postprocessing pass: same look,
          zero GPU cost */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            'radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(10,12,16,0.34) 100%)'
        }}
      />

      {/* Minimal Top-Right Terminal Control HUD — sits clear of the
          department header overlay that lives top-left */}
      <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[rgba(16,17,20,0.84)] bg-[image:var(--grad-chrome)] pr-1.5 pl-3 shadow-[var(--shadow-pop)] backdrop-blur-xl">
          <div className="flex items-center gap-2 text-[12px] font-medium text-t1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="status-pulse absolute inline-flex h-full w-full rounded-full bg-done opacity-60 blur-[2px]" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-done shadow-[0_0_6px_rgba(70,167,88,0.7)]" />
            </span>
            <span className="tnum font-medium tracking-[-0.005em]">
              {terminalAgents.length} {terminalAgents.length === 1 ? 'Terminal Agent' : 'Terminal Agents'}
            </span>
          </div>

          <span className="mx-0.5 h-4 w-px bg-[var(--border-default)]" />

          {/* View-mode segmented control — hidden in the mini player, which
              always renders the single legacy scene */}
          {!mini && (
            <>
              <div className="seg-track gap-0.5" title="Office view">
                <button
                  onClick={() => setView('city')}
                  className={`flex h-6 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors ${
                    view === 'city'
                      ? 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                      : 'text-t3 hover:text-t2'
                  }`}
                >
                  <Building size={11} className={view === 'city' ? 'text-accent' : undefined} />
                  City
                </button>
                {([4, 6, 8] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setSplitCount(n)
                      setView('split')
                    }}
                    className={`tnum flex h-6 min-w-[24px] cursor-pointer items-center justify-center rounded-[7px] px-2 text-[11.5px] font-medium transition-colors ${
                      view === 'split' && splitCount === n
                        ? 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                        : 'text-t3 hover:text-t2'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setSplitCount('all')
                    setView('split')
                  }}
                  title="All departments"
                  className={`flex h-6 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors ${
                    view === 'split' && splitCount === 'all'
                      ? 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                      : 'text-t3 hover:text-t2'
                  }`}
                >
                  <LayoutGrid size={11} className={view === 'split' && splitCount === 'all' ? 'text-accent' : undefined} />
                  All
                </button>
              </div>

              {view === 'city' && (
                <button
                  onClick={() => setDeptDialogOpen(true)}
                  title="Add a department floor to the tower"
                  className="flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-t3 transition-colors hover:bg-n4 hover:text-t1"
                >
                  <Plus size={12} strokeWidth={2} />
                  <span>Dept</span>
                </button>
              )}

              <span className="mx-0.5 h-4 w-px bg-[var(--border-default)]" />
            </>
          )}

          {/* Quick Launch Agent Dropdown Trigger */}
          <div className="relative">
            <button
              onClick={() => setLauncherOpen((v) => !v)}
              title="Spawn a new terminal agent session"
              className="btn-accent-soft flex h-7 cursor-pointer items-center gap-1.5 rounded-lg pr-2 pl-2.5 text-[12px] font-medium"
            >
              <Plus size={13} strokeWidth={2} />
              <span>Launch Agent</span>
              <ChevronDown
                size={12}
                className={`opacity-70 transition-transform duration-200 ${
                  launcherOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Launch Menu — right-anchored: the HUD lives at the screen's
                right edge, so the menu unfolds leftward into view */}
            <AnimatePresence>
              {launcherOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.14 }}
                  className="pop-surface absolute top-full right-0 mt-2 w-64 origin-top-right rounded-xl p-1"
                >
                  <div className="mb-1 flex items-center justify-between border-b border-[var(--border-subtle)] px-2 pt-1.5 pb-2 text-[10px] font-semibold tracking-[0.07em] text-t4 uppercase">
                    <span>Available Agent CLIs</span>
                    <Cpu size={11} className="text-t4" />
                  </div>
                  {LAUNCH_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => handleLaunch(preset.key)}
                      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-n4"
                    >
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.4)]"
                        style={{
                          background: `hsl(${preset.hue} 60% 45%)`
                        }}
                      >
                        {preset.label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-t2 group-hover:text-t1">
                          {preset.label}
                        </div>
                        <div className="truncate text-[10.5px] text-t4">
                          {preset.desc}
                        </div>
                      </div>
                      <Plus
                        size={12}
                        className="shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <span className="mx-0.5 h-4 w-px bg-[var(--border-default)]" />

          {/* Office Theme Switcher */}
          <div className="seg-track gap-0.5" title="Office theme">
            {(['loft', 'avengers'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex h-6 cursor-pointer items-center rounded-[7px] px-2 text-[11.5px] font-medium capitalize transition-colors ${
                  theme === t
                    ? 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                    : 'text-t3 hover:text-t2'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <span className="mx-0.5 h-4 w-px bg-[var(--border-default)]" />

          {/* Mini player toggle — when on, leaving this tab keeps the office
              alive in a floating window instead of pausing it */}
          <button
            onClick={() => setOfficePiP(!officePiP)}
            title="Mini player when away"
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors ${
              officePiP
                ? 'bg-accent-subtle text-accent shadow-[inset_0_0_0_1px_rgba(245,165,36,0.3)]'
                : 'text-t3 hover:bg-n4 hover:text-t1'
            }`}
          >
            <PictureInPicture2 size={13} />
          </button>
        </div>
      </div>

      {/* Selected Agent Floating Prompt — click an agent, open its terminal.
          Hidden in the mini player: it overflows small sizes. */}
      {!mini && (
      <AnimatePresence>
        {targetedAgent && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-5 rounded-2xl border border-[var(--border-default)] bg-[rgba(22,23,27,0.9)] bg-[image:var(--grad-chrome)] py-3 pr-3 pl-3.5 shadow-[var(--shadow-pop)] backdrop-blur-2xl"
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.4)]"
                style={{
                  background: `linear-gradient(135deg, hsl(${targetedAgent.hue} 65% 50%), hsl(${targetedAgent.hue} 75% 35%))`
                }}
              >
                {targetedAgent.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <StatusDot status={targetedAgent.status} />
                  <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-t1">
                    {targetedAgent.name}
                  </span>
                  <span className="rounded-full border border-[var(--border-subtle)] bg-n3 px-1.5 py-px text-[9.5px] leading-[14px] font-semibold tracking-[0.06em] text-t3 uppercase">
                    {targetedAgent.domain}
                  </span>
                </div>
                <p className="mt-0.5 max-w-[300px] truncate font-mono text-[11.5px] text-t3">
                  {targetedAgent.taskId || targetedAgent.brief}
                </p>
              </div>
            </div>

            {/* Direct Open Terminal Button */}
            <button
              onClick={() => goToTerminal(targetedAgent.id)}
              className="group relative flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-accent pr-2 pl-3.5 text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.35),0_6px_18px_-6px_rgba(245,165,36,0.55)] transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98]"
            >
              <Terminal size={14} strokeWidth={2} />
              <span className="text-[12.5px] font-semibold">Open Terminal</span>
              <span className="ml-0.5 rounded-md bg-black/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                2×
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      )}

      {/* bottom-left hints — per mode, hidden in the mini player */}
      {!mini && view === 'city' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-lg border border-[var(--border-subtle)] bg-[rgba(10,11,13,0.66)] px-2.5 py-1.5 text-[11px] text-t3 backdrop-blur-md"
        >
          click a floor to enter · drag to look around
        </motion.div>
      )}
      {!mini && view === 'dept' && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[rgba(10,11,13,0.66)] px-2.5 py-1.5 text-[11px] text-t3 backdrop-blur-md">
          <Eye size={12} className="text-accent/80" />
          <span>Drag Pan · Right-Drag Orbit · Scroll Zoom · WASD Move · Click Agent Select · Double-Click Terminal</span>
        </div>
      )}

      {deptDialogOpen && <AddDepartmentDialog onClose={() => setDeptDialogOpen(false)} />}
    </div>
  )
}
