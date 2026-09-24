import clsx from 'clsx'
import type { Agent } from '@shared/types'
import { StatusDot } from '../components/StatusDot'

export interface CrewPickerProps {
  agents: Agent[]
  /** currently selected agent id, or null */
  selected: string | null
  onSelect: (id: string) => void
}

/** Horizontal scrollable row of agent chips, for assignment flows. */
export function CrewPicker({ agents, selected, onSelect }: CrewPickerProps) {
  if (agents.length === 0) {
    return <p className="py-1 text-[12px] text-t3">No agents on the roster yet.</p>
  }
  return (
    <div
      role="listbox"
      aria-label="Pick an agent"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1"
    >
      {agents.map((a) => {
        const sel = a.id === selected
        return (
          <button
            key={a.id}
            type="button"
            role="option"
            aria-selected={sel}
            onClick={() => onSelect(a.id)}
            className={clsx(
              'flex h-8 shrink-0 items-center gap-2 rounded-full border pr-3 pl-1.5 transition-colors',
              sel
                ? 'border-[var(--border-strong)] bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                : 'border-[var(--border-subtle)] bg-n2 text-t3 hover:border-[var(--border-default)] hover:bg-n4 hover:text-t1'
            )}
            style={
              sel
                ? { boxShadow: `inset 0 0 0 1px hsl(${a.hue} 60% 50% / 0.45)` }
                : undefined
            }
          >
            <span
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
              style={{ background: `hsl(${a.hue} 45% 42%)` }}
            >
              {(a.name[0] ?? '?').toUpperCase()}
            </span>
            <span className="text-[12px] font-medium">{a.name}</span>
            <StatusDot status={a.status} size={5} />
          </button>
        )
      })}
    </div>
  )
}
