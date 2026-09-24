// ── CrewModal.tsx — manage-crew overlay ──────────────────────────────
// Lists the engine roster plus a local overlay of drafts. There is no
// createAgent/updateAgent IPC yet, so mutations stay in component state
// and are announced on `terrarium:crew-draft` — the integrator/engine picks
// the event up and persists later. The toast says so honestly.

import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Agent } from '@shared/types'
import { useApp } from '../lib/store'
import { AgentCard } from '../roster/AgentCard'
import { AgentEditor } from '../roster/AgentEditor'
import { DEFAULT_CREW, HUE_PRESETS } from '../roster/defaults'

export interface CrewModalProps {
  open: boolean
  onClose: () => void
}

/** window event carrying crew edits until a real engine IPC lands. */
export const CREW_DRAFT_EVENT = 'terrarium:crew-draft'

export interface CrewDraftEventDetail {
  /** 'upsert' covers create + edit; 'remove' carries the dropped agent. */
  intent: 'upsert' | 'remove'
  agent: Agent
}

const TOAST_TEXT = 'Saved locally — engine persistence pending'
const TOAST_MS = 1500

let seq = 0
/** ids follow the repo's rid() shape: <prefix>-<base36-ts>-<seq> */
const rid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export function CrewModal({ open, onClose }: CrewModalProps) {
  const agents = useApp((s) => s.agents)
  // local overlay: upserts shadow store agents by id, removals tombstone them
  const [customAgents, setCustomAgents] = useState<Agent[]>([])
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<Partial<Agent> | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef(0)

  // esc closes — bubble phase on purpose: AgentEditor's capture-phase esc
  // handler stops propagation while the editor is open, so it wins and the
  // modal stays up underneath.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const merged: Agent[] = (() => {
    const m = new Map<string, Agent>()
    for (const a of agents) if (!removedIds.has(a.id)) m.set(a.id, a)
    for (const a of customAgents) if (!removedIds.has(a.id)) m.set(a.id, a)
    return [...m.values()]
  })()

  if (!open) return null

  const showToast = () => {
    setToast(TOAST_TEXT)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }

  const announce = (detail: CrewDraftEventDetail) =>
    window.dispatchEvent(new CustomEvent<CrewDraftEventDetail>(CREW_DRAFT_EVENT, { detail }))

  const startAdd = () => {
    const used = new Set(merged.map((a) => a.name))
    const persona = DEFAULT_CREW.find((p) => !used.has(p.name))
    setEditing(
      persona
        ? {
            name: persona.name,
            role: persona.role,
            domain: persona.domain,
            brief: persona.brief,
            hue: persona.hue
          }
        : { domain: 'general', hue: HUE_PRESETS[merged.length % HUE_PRESETS.length] }
    )
  }

  const save = (a: Partial<Agent>) => {
    const full: Agent = {
      id: a.id ?? rid('ag'),
      name: a.name ?? '',
      role: a.role ?? 'builder',
      domain: a.domain ?? 'general',
      brief: a.brief ?? '',
      status: a.status ?? 'idle',
      deskId: a.deskId ?? `desk-${merged.length}`,
      taskId: a.taskId ?? null,
      hue: a.hue ?? 210,
      lastActiveAt: a.lastActiveAt ?? Date.now()
    }
    setCustomAgents((prev) => {
      const i = prev.findIndex((x) => x.id === full.id)
      return i === -1 ? [...prev, full] : prev.map((x) => (x.id === full.id ? full : x))
    })
    setRemovedIds((prev) => {
      if (!prev.has(full.id)) return prev
      const next = new Set(prev)
      next.delete(full.id)
      return next
    })
    announce({ intent: 'upsert', agent: full })
    showToast()
    setEditing(null)
  }

  const remove = (a: Agent) => {
    setCustomAgents((prev) => prev.filter((x) => x.id !== a.id))
    setRemovedIds((prev) => new Set(prev).add(a.id))
    announce({ intent: 'remove', agent: a })
    showToast()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Manage crew"
          className="pop-surface pop-in relative flex max-h-[82vh] w-[680px] max-w-[92vw] flex-col overflow-hidden rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pane-head flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] pr-3 pl-5">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em] text-t1">
              Crew
              <span className="tnum rounded-full bg-n4 px-1.5 text-[10.5px] leading-4 font-medium text-t3">
                {merged.length}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startAdd}
                className="btn-accent-soft flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
              >
                <Plus size={12} strokeWidth={2.2} /> Add agent
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close crew"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {merged.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-n1/40 px-3 py-10 text-center text-[12px] text-t3">
                No agents on the roster yet — add one above.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {merged.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    onEdit={(agent) => setEditing(agent)}
                    onRemove={remove}
                  />
                ))}
              </div>
            )}
          </div>

          {toast && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <span className="pop-surface pop-in rounded-lg px-3 py-1.5 text-[11.5px] text-t2">
                {toast}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* sibling, not child — editor backdrop clicks/Escape must not reach
          the modal's own close handlers */}
      {editing && (
        <AgentEditor agent={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </>
  )
}

export default CrewModal
