import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import type { Agent, AgentDomain, AgentRole } from '@shared/types'
import { DOMAIN_INFO, DOMAIN_ORDER, HUE_PRESETS, ROLE_INFO, ROLE_ORDER } from './defaults'

export interface AgentEditorProps {
  /** Partial for "new agent", full Agent for editing. */
  agent: Partial<Agent>
  onSave: (a: Partial<Agent>) => void
  onCancel: () => void
}

const inputCls =
  'w-full rounded-md border border-[var(--border-default)] bg-n2 px-3 py-2 text-[13px] text-t1 placeholder:text-t4 outline-none focus:border-[var(--border-strong)] transition-colors'

function deskLabel(deskId: string | undefined): string {
  if (!deskId) return 'Auto-assigned on save'
  const n = Number(deskId.replace(/^desk-/, ''))
  return Number.isFinite(n) ? `Desk ${n + 1}` : deskId
}

export function AgentEditor({ agent, onSave, onCancel }: AgentEditorProps) {
  const [name, setName] = useState(agent.name ?? '')
  const [role, setRole] = useState<AgentRole>(agent.role ?? 'builder')
  const [domain, setDomain] = useState<AgentDomain>(agent.domain ?? 'general')
  const [brief, setBrief] = useState(agent.brief ?? '')
  const [hue, setHue] = useState(agent.hue ?? 210)
  const [touched, setTouched] = useState(false)

  const valid = name.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    // capture phase so this wins over other window-level Escape handlers
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const save = () => {
    if (!valid) {
      setTouched(true)
      return
    }
    onSave({ ...agent, name: name.trim(), role, domain, brief: brief.trim(), hue })
  }

  const initial = (name.trim()[0] ?? '?').toUpperCase()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={agent.id ? 'Edit agent' : 'New agent'}
        className="glass shadow-lg-dark relative w-[440px] max-w-[92vw] rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          .hue-range { -webkit-appearance: none; appearance: none; height: 8px; border-radius: 9999px; outline: none; cursor: pointer;
            background: linear-gradient(90deg, hsl(0 70% 55%), hsl(60 70% 55%), hsl(120 65% 50%), hsl(180 65% 50%), hsl(240 70% 60%), hsl(300 70% 55%), hsl(360 70% 55%)); }
          .hue-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 9999px;
            background: #fff; border: 2px solid rgba(0,0,0,0.45); box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: pointer; }
        `}</style>

        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <h2 className="text-[13.5px] font-medium text-t1">
            {agent.id ? 'Edit agent' : 'New agent'}
          </h2>
          <kbd className="kbd">esc</kbd>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* name */}
          <div>
            <label htmlFor="agent-name" className="micro-label mb-1.5 block">
              Name
            </label>
            <input
              id="agent-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTouched(true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="e.g. Laplace"
              className={inputCls}
            />
            {touched && !valid && (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--color-needs)' }}>
                Give the agent a name.
              </p>
            )}
          </div>

          {/* role — segmented picker */}
          <div>
            <span className="micro-label mb-1.5 block">Role</span>
            <div className="grid grid-cols-2 gap-1.5">
              {ROLE_ORDER.map((r) => {
                const sel = r === role
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={sel}
                    className={clsx(
                      'rounded-lg border px-2.5 py-2 text-left transition-colors',
                      sel
                        ? 'border-[var(--border-strong)] bg-n4'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-n3'
                    )}
                  >
                    <span
                      className={clsx(
                        'block text-[12px] font-medium',
                        sel ? 'text-t1' : 'text-t2'
                      )}
                    >
                      {ROLE_INFO[r].label}
                    </span>
                    <span className="block text-[10.5px] leading-snug text-t4">
                      {ROLE_INFO[r].blurb}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* domain — compact segmented row, blurb of the selected one below */}
          <div>
            <span className="micro-label mb-1.5 block">Domain</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Domain">
              {DOMAIN_ORDER.map((d) => {
                const sel = d === domain
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDomain(d)}
                    aria-pressed={sel}
                    title={DOMAIN_INFO[d].blurb}
                    className={clsx(
                      'rounded-md border px-2.5 py-1.5 text-[11.5px] transition-colors',
                      sel
                        ? 'border-[var(--border-strong)] bg-n4 text-t1'
                        : 'border-[var(--border-subtle)] text-t3 hover:border-[var(--border-default)] hover:bg-n3 hover:text-t2'
                    )}
                  >
                    {DOMAIN_INFO[d].label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-snug text-t4">
              {DOMAIN_INFO[domain].blurb}
            </p>
          </div>

          {/* brief */}
          <div>
            <label htmlFor="agent-brief" className="micro-label mb-1.5 block">
              Brief
            </label>
            <textarea
              id="agent-brief"
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What should this agent own?"
              className={clsx(inputCls, 'resize-none leading-relaxed')}
            />
          </div>

          {/* hue */}
          <div>
            <span className="micro-label mb-1.5 block">Color</span>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="mb-2.5 flex gap-1.5">
                  {HUE_PRESETS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-label={`Hue ${h}`}
                      onClick={() => setHue(h)}
                      className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                      style={{
                        background: `hsl(${h} 45% 42%)`,
                        boxShadow:
                          h === hue ? '0 0 0 2px var(--color-n1), 0 0 0 3.5px var(--color-t1)' : undefined
                      }}
                    >
                      {h === hue && <Check size={11} className="text-white" strokeWidth={3} />}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={hue}
                  aria-label="Custom hue"
                  onChange={(e) => setHue(Number(e.target.value))}
                  className="hue-range w-full"
                />
              </div>
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
                style={{ background: `hsl(${hue} 45% 42%)` }}
              >
                {initial}
              </span>
            </div>
          </div>

          {/* desk assignment — read-only readout */}
          <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-n2 px-3 py-2">
            <span className="micro-label">Desk</span>
            <span className="text-[12px] text-t3">{deskLabel(agent.deskId)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className="rounded-md bg-t1 px-3.5 py-1.5 text-[12.5px] font-medium text-n1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save agent
          </button>
        </div>
      </div>
    </div>
  )
}
