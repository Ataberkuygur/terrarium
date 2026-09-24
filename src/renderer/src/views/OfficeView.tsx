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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45" onClick={onClose}>
      <div
        className="w-[340px] rounded-xl border border-[var(--border-default)] bg-popover p-4 shadow-lg-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-[13px] font-semibold text-t1">New department</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-t4 transition-colors hover:bg-n4 hover:text-t2"
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
          className="mb-3 w-full rounded-md border border-[var(--border-default)] bg-n2 px-2.5 py-1.5 text-[12.5px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--border-strong)]"
        />

        <div className="micro-label mb-1.5">Collects domains</div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DEPARTMENT_DOMAINS.map((d) => {
            const on = domains.includes(d)
            return (
              <button
                key={d}
                onClick={() => toggleDomain(d)}
                className={`rounded-md border px-2 py-1 text-[11px] capitalize transition-colors cursor-pointer ${
                  on
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-[var(--border-default)] text-t3 hover:border-[var(--border-strong)] hover:text-t2'
                }`}
              >
                {d}
              </button>
            )
          })}
        </div>

        <div className="micro-label mb-1.5">Floor color</div>
        <div className="mb-4 flex items-center gap-1.5">
          <button
            onClick={() => setHue(null)}
            title="Auto — picks the next free hue"
            className={`flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-default)] bg-n3 text-t3 transition-transform cursor-pointer ${
              hue === null ? 'scale-110 ring-2 ring-white/80' : 'hover:scale-110'
            }`}
          >
            <Sparkles size={10} />
          </button>
          {DEPT_HUE_PRESETS.map((h) => (
            <button
              key={h}
              onClick={() => setHue(h)}
              title={`Hue ${h}`}
              className={`h-5 w-5 rounded-full transition-transform cursor-pointer ${
                hue === h ? 'scale-110 ring-2 ring-white/80' : 'hover:scale-110'
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
                  className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-n2 px-2 py-1"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: `hsl(${d.hue} 60% 55%)` }}
                  />
                  <span className="flex-1 truncate text-[12px] text-t2">{d.name}</span>
                  <button
                    onClick={() => removeDepartment(d.id)}
                    title={`Delete ${d.name}`}
                    className="rounded p-0.5 text-t4 transition-colors hover:bg-n3 hover:text-error cursor-pointer"
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
    <div className="relative h-full select-none overflow-hidden bg-neutral-950">
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
              className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)]"
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
                className="absolute top-2 right-2 z-20 rounded-md border border-white/15 bg-neutral-900/80 p-1.5 text-neutral-300 backdrop-blur-md transition-colors hover:bg-neutral-800 hover:text-white cursor-pointer"
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
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/85 px-3 py-1.5 backdrop-blur-xl shadow-lg">
          <div className="flex items-center gap-2 text-[12px] font-medium text-white/90">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-semibold tracking-wide">
              {terminalAgents.length} {terminalAgents.length === 1 ? 'Terminal Agent' : 'Terminal Agents'}
            </span>
          </div>

          <span className="h-3 w-px bg-white/15 mx-0.5" />

          {/* View-mode segmented control — hidden in the mini player, which
              always renders the single legacy scene */}
          {!mini && (
            <>
              <div
                className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5"
                title="Office view"
              >
                <button
                  onClick={() => setView('city')}
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                    view === 'city'
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Building size={11} />
                  City
                </button>
                {([4, 6, 8] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setSplitCount(n)
                      setView('split')
                    }}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      view === 'split' && splitCount === n
                        ? 'bg-white/15 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200'
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
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
                    view === 'split' && splitCount === 'all'
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <LayoutGrid size={11} />
                  All
                </button>
              </div>

              {view === 'city' && (
                <button
                  onClick={() => setDeptDialogOpen(true)}
                  title="Add a department floor to the tower"
                  className="flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-[11.5px] font-medium text-neutral-200 hover:text-white transition-all cursor-pointer"
                >
                  <Plus size={12} className="text-emerald-400" />
                  <span>Dept</span>
                </button>
              )}

              <span className="h-3 w-px bg-white/15 mx-0.5" />
            </>
          )}

          {/* Quick Launch Agent Dropdown Trigger */}
          <div className="relative">
            <button
              onClick={() => setLauncherOpen((v) => !v)}
              title="Spawn a new terminal agent session"
              className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-2 py-1 text-[11.5px] font-medium text-neutral-200 hover:text-white transition-all cursor-pointer"
            >
              <Plus size={13} className="text-amber-400" />
              <span>Launch Agent</span>
              <ChevronDown
                size={12}
                className={`transition-transform duration-200 text-neutral-400 ${
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
                  className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/12 bg-neutral-900/95 p-1.5 backdrop-blur-2xl shadow-2xl"
                >
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-white/10 mb-1 flex items-center justify-between">
                    <span>Available Agent CLIs</span>
                    <Cpu size={11} className="text-neutral-500" />
                  </div>
                  {LAUNCH_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      onClick={() => handleLaunch(preset.key)}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10 group cursor-pointer"
                    >
                      <div
                        className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0 shadow-inner"
                        style={{
                          background: `hsl(${preset.hue} 60% 45%)`
                        }}
                      >
                        {preset.label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-neutral-200 group-hover:text-white truncate">
                          {preset.label}
                        </div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          {preset.desc}
                        </div>
                      </div>
                      <Plus
                        size={12}
                        className="opacity-0 group-hover:opacity-100 text-amber-400 transition-opacity shrink-0"
                      />
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <span className="h-3 w-px bg-white/15 mx-0.5" />

          {/* Office Theme Switcher */}
          <div
            className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5"
            title="Office theme"
          >
            {(['loft', 'avengers'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                  theme === t
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <span className="h-3 w-px bg-white/15 mx-0.5" />

          {/* Mini player toggle — when on, leaving this tab keeps the office
              alive in a floating window instead of pausing it */}
          <button
            onClick={() => setOfficePiP(!officePiP)}
            title="Mini player when away"
            className={`rounded-lg p-1.5 transition-colors cursor-pointer ${
              officePiP
                ? 'bg-amber-400/20 text-amber-300'
                : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/10'
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
            className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 flex items-center gap-4 rounded-2xl border border-white/15 bg-neutral-900/92 px-5 py-3 backdrop-blur-2xl shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl font-bold text-white shadow-inner text-[14px]"
                style={{
                  background: `linear-gradient(135deg, hsl(${targetedAgent.hue} 65% 50%), hsl(${targetedAgent.hue} 75% 35%))`
                }}
              >
                {targetedAgent.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <StatusDot status={targetedAgent.status} />
                  <span className="font-semibold text-white text-[14.5px] tracking-tight">
                    {targetedAgent.name}
                  </span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-300 uppercase tracking-wider">
                    {targetedAgent.domain}
                  </span>
                </div>
                <p className="text-[12px] text-neutral-400 max-w-[300px] truncate mt-0.5 font-mono">
                  {targetedAgent.taskId || targetedAgent.brief}
                </p>
              </div>
            </div>

            {/* Direct Open Terminal Button */}
            <button
              onClick={() => goToTerminal(targetedAgent.id)}
              className="group relative flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2.5 font-medium text-white shadow-lg shadow-amber-500/30 transition-all hover:from-amber-400 hover:to-amber-500 hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
            >
              <Terminal size={15} />
              <span className="text-[13px] font-semibold tracking-wide">Open Terminal</span>
              <span className="ml-0.5 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-amber-200">
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
          className="pointer-events-none absolute bottom-3 left-4 z-20 rounded-lg border border-white/5 bg-neutral-950/60 px-3 py-1.5 text-[11px] font-mono text-t4 backdrop-blur-md"
        >
          click a floor to enter · drag to look around
        </motion.div>
      )}
      {!mini && view === 'dept' && (
        <div className="pointer-events-none absolute bottom-3 left-4 z-20 flex items-center gap-2 text-[11px] font-mono text-neutral-400/80 bg-neutral-950/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5">
          <Eye size={12} className="text-amber-400/80" />
          <span>Drag Pan · Right-Drag Orbit · Scroll Zoom · WASD Move · Click Agent Select · Double-Click Terminal</span>
        </div>
      )}

      {deptDialogOpen && <AddDepartmentDialog onClose={() => setDeptDialogOpen(false)} />}
    </div>
  )
}
