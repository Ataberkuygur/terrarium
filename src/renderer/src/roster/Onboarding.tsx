import { useState } from 'react'
import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Columns3,
  FolderOpen,
  LayoutGrid,
  Plus,
  X
} from 'lucide-react'
import type { AgentDomain, AgentRole } from '@shared/types'
import {
  DEFAULT_CREW,
  DOMAIN_INFO,
  DOMAIN_ORDER,
  HUE_PRESETS,
  ROLE_INFO,
  ROLE_ORDER
} from './defaults'

export interface CrewDraft {
  name: string
  role: AgentRole
  domain: AgentDomain
  brief: string
  hue: number
}

export interface OnboardingConfig {
  projectPath: string
  crew: CrewDraft[]
}

export interface DetectedCli {
  name: string
  found: boolean
  version?: string
}

export interface DetectedProject {
  name: string
  path: string
}

export interface OnboardingProps {
  onFinish: (cfg: OnboardingConfig) => void
  detectedClis: DetectedCli[]
  /** OS folder picker — resolves with the chosen path or null. */
  onBrowse?: () => Promise<string | null> | string | null
  detectedProjects?: DetectedProject[]
  /** prefill for the project path field (e.g. the host's cwd) */
  initialProjectPath?: string
}

const STEPS = ['Welcome', 'Project', 'Crew'] as const

const FEATURES = [
  { icon: LayoutGrid, text: 'Office — watch the crew work at their desks' },
  { icon: Columns3, text: 'Board — assign, review, unblock' },
  { icon: BookOpen, text: 'Wiki — the project explains itself as it grows' }
]

const inputCls =
  'w-full rounded-md border border-[var(--border-default)] bg-n2 px-3 py-2 text-[13px] text-t1 placeholder:text-t4 outline-none focus:border-[var(--border-strong)] transition-colors'

export function Onboarding({
  onFinish,
  detectedClis,
  onBrowse,
  detectedProjects,
  initialProjectPath
}: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [projectPath, setProjectPath] = useState(initialProjectPath ?? '')
  const [crew, setCrew] = useState<CrewDraft[]>(
    DEFAULT_CREW.slice(0, 3).map((a) => ({
      name: a.name,
      role: a.role,
      domain: a.domain,
      brief: a.brief,
      hue: a.hue
    }))
  )

  const browse = async () => {
    const p = await onBrowse?.()
    if (p) setProjectPath(p)
  }

  const updateCrew = (i: number, patch: Partial<CrewDraft>) =>
    setCrew((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const addCrew = () => {
    const used = new Set(crew.map((c) => c.name))
    const persona = DEFAULT_CREW.find((p) => !used.has(p.name))
    const draft: CrewDraft = persona
      ? {
          name: persona.name,
          role: persona.role,
          domain: persona.domain,
          brief: persona.brief,
          hue: persona.hue
        }
      : {
          name: '',
          role: 'builder',
          domain: 'general',
          brief: '',
          hue: HUE_PRESETS[crew.length % HUE_PRESETS.length]
        }
    setCrew([...crew, draft])
  }

  const finish = () =>
    onFinish({
      projectPath: projectPath.trim(),
      crew: crew.filter((c) => c.name.trim().length > 0)
    })

  const last = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas">
      {/* faint amber glow behind the card */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(720px 320px at 50% 12%, rgba(245,165,36,0.06), transparent 70%)'
        }}
      />

      <div className="glass shadow-lg-dark relative flex w-[560px] max-w-[92vw] flex-col rounded-2xl">
        <div className="min-h-[340px] px-7 py-6">
          {step === 0 && (
            <section aria-label="Welcome">
              <div className="shadow-md-dark flex h-11 w-11 items-end justify-end rounded-xl bg-accent p-1.5">
                <div
                  className="h-3.5 w-3.5 rounded-[4px]"
                  style={{ background: 'var(--color-on-accent)' }}
                />
              </div>
              <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-t1">
                Welcome to Terrarium
              </h1>
              <p className="mt-1 text-[13.5px] text-t3">
                An office where your AI crew works.
              </p>
              <ul className="mt-6 space-y-2.5">
                {FEATURES.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5 text-[13px] text-t2">
                    <Icon size={14} className="shrink-0 text-t3" />
                    {text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === 1 && (
            <section aria-label="Project">
              <h1 className="text-[20px] font-semibold tracking-tight text-t1">
                Point at a project
              </h1>
              <p className="mt-1 text-[13px] text-t3">
                Terrarium watches a git repo — agents branch, build, and document inside it.
              </p>

              <div className="mt-5 flex gap-2">
                <input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="C:\path\to\project"
                  aria-label="Project folder path"
                  className={clsx(inputCls, 'font-mono text-[12.5px]')}
                />
                <button
                  type="button"
                  onClick={browse}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-n4 px-3 py-2 text-[12.5px] text-t1 transition-colors hover:bg-n5"
                >
                  <FolderOpen size={13} /> Browse
                </button>
              </div>

              <div className="mt-5">
                <span className="micro-label mb-1.5 block">Detected workspaces</span>
                {detectedProjects && detectedProjects.length > 0 ? (
                  <div className="space-y-1">
                    {detectedProjects.map((p) => {
                      const sel = p.path === projectPath
                      return (
                        <button
                          key={p.path}
                          type="button"
                          onClick={() => setProjectPath(p.path)}
                          className={clsx(
                            'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                            sel
                              ? 'border-[var(--border-strong)] bg-n4'
                              : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-n3'
                          )}
                        >
                          <FolderOpen size={13} className="shrink-0 text-t3" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-t1">{p.name}</span>
                            <span className="block truncate font-mono text-[10.5px] text-t4">
                              {p.path}
                            </span>
                          </span>
                          {sel && <Check size={13} className="shrink-0 text-t2" />}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--border-default)] px-3 py-3 text-[12px] text-t4">
                    No workspaces detected yet — enter a path above.
                  </div>
                )}
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-label="Crew">
              <h1 className="text-[20px] font-semibold tracking-tight text-t1">Your crew</h1>
              <p className="mt-1 text-[13px] text-t3">
                Name the agents you'll work with. You can edit them later.
              </p>

              <div className="mt-5 space-y-1.5">
                {crew.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: `hsl(${c.hue} 45% 42%)` }}
                    >
                      {(c.name.trim()[0] ?? '?').toUpperCase()}
                    </span>
                    <input
                      value={c.name}
                      onChange={(e) => updateCrew(i, { name: e.target.value })}
                      placeholder="Agent name"
                      aria-label={`Agent ${i + 1} name`}
                      className={clsx(inputCls, 'py-1.5 text-[12.5px]')}
                    />
                    <div className="relative shrink-0">
                      <select
                        value={c.role}
                        onChange={(e) => updateCrew(i, { role: e.target.value as AgentRole })}
                        aria-label={`Agent ${i + 1} role`}
                        title="Role"
                        className="appearance-none rounded-md border border-[var(--border-subtle)] bg-n3 py-1.5 pl-2.5 pr-7 text-[11.5px] text-t2 outline-none transition-colors focus:border-[var(--border-strong)]"
                      >
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_INFO[r].label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={11}
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-t4"
                      />
                    </div>
                    <div className="relative shrink-0">
                      <select
                        value={c.domain}
                        onChange={(e) => updateCrew(i, { domain: e.target.value as AgentDomain })}
                        aria-label={`Agent ${i + 1} domain`}
                        title="Domain"
                        className="appearance-none rounded-md border border-[var(--border-subtle)] bg-n3 py-1.5 pl-2.5 pr-7 text-[11.5px] text-t2 outline-none transition-colors focus:border-[var(--border-strong)]"
                      >
                        {DOMAIN_ORDER.map((d) => (
                          <option key={d} value={d}>
                            {DOMAIN_INFO[d].label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={11}
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-t4"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setCrew(crew.filter((_, j) => j !== i))}
                      disabled={crew.length <= 1}
                      aria-label={`Remove ${c.name || `agent ${i + 1}`}`}
                      className="shrink-0 rounded-md p-1.5 text-t4 transition-colors hover:bg-n4 hover:text-t2 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {crew.length < DEFAULT_CREW.length && (
                  <button
                    type="button"
                    onClick={addCrew}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-t3 transition-colors hover:bg-n3 hover:text-t2"
                  >
                    <Plus size={12} /> Add agent
                  </button>
                )}
              </div>

              <div className="mt-5">
                <span className="micro-label mb-1.5 block">Agent CLIs</span>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-n2 px-3 py-1.5">
                  {detectedClis.map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] py-1.5 last:border-0"
                    >
                      {c.found ? (
                        <Check size={12} style={{ color: 'var(--color-done)' }} />
                      ) : (
                        <X size={12} className="text-n8" />
                      )}
                      <span className="font-mono text-[12px] text-t1">{c.name}</span>
                      <span className="ml-auto text-[11px] text-t4">
                        {c.found ? `found${c.version ? ` ${c.version}` : ''}` : 'not found'}
                      </span>
                    </div>
                  ))}
                  {detectedClis.length === 0 && (
                    <p className="py-1.5 text-[12px] text-t4">No CLIs probed yet.</p>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-7 py-4">
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:invisible"
          >
            <ArrowLeft size={13} /> Back
          </button>

          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, i) => (
              <span
                key={label}
                title={label}
                className={clsx(
                  'h-1.5 rounded-full transition-all',
                  i === step ? 'w-4 bg-t2' : 'w-1.5 bg-n6'
                )}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="flex items-center gap-1.5 rounded-md bg-t1 px-3.5 py-1.5 text-[12.5px] font-medium text-n1 transition-colors hover:bg-white"
          >
            {last ? 'Open the office' : 'Continue'} <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
