import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import type { Agent } from '@shared/types'
import { StatusDot } from '../components/StatusDot'
import { ROLE_INFO } from './defaults'

export interface AgentCardProps {
  agent: Agent
  onEdit: (a: Agent) => void
  onMessage?: (a: Agent) => void
  onRemove?: (a: Agent) => void
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const STATUS_TEXT: Record<Agent['status'], string> = {
  working: 'Working',
  waiting: 'Waiting',
  done: 'Done',
  idle: 'Idle',
  offline: 'Offline'
}

export function AgentCard({ agent, onEdit, onMessage, onRemove }: AgentCardProps) {
  return (
    <div className="group card-hover relative rounded-xl border border-[var(--border-default)] bg-raised p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_1px_rgba(0,0,0,0.25),0_2px_6px_rgba(0,0,0,0.35)]"
          style={{ background: `linear-gradient(145deg, hsl(${agent.hue} 50% 50%), hsl(${agent.hue} 45% 38%))` }}
        >
          {(agent.name[0] ?? '?').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-t1">{agent.name}</p>
          <p
            className="micro-label mt-0.5"
            style={{ color: `hsl(${agent.hue} 65% 62%)` }}
          >
            {ROLE_INFO[agent.role]?.label ?? agent.role}
          </p>
        </div>
        <div className="tool-group opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {onMessage && (
            <button
              type="button"
              onClick={() => onMessage(agent)}
              aria-label={`Message ${agent.name}`}
              title={`Message ${agent.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n4 hover:text-t1"
            >
              <MessageSquare size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(agent)}
            aria-label={`Edit ${agent.name}`}
            title={`Edit ${agent.name}`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <Pencil size={12} />
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(agent)}
              aria-label={`Remove ${agent.name}`}
              title={`Remove ${agent.name}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-t3 transition-colors hover:bg-[rgba(229,72,77,0.12)] hover:text-[var(--color-needs)]"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 min-h-[32px] text-[12px] leading-relaxed text-t3 line-clamp-2">
        {agent.brief || 'No brief yet.'}
      </p>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-t2">
          <StatusDot status={agent.status} size={6} />
          {STATUS_TEXT[agent.status]}
        </span>
        <span className="tnum text-[11px] text-t4">
          {agent.lastActiveAt ? `active ${timeAgo(agent.lastActiveAt)}` : 'never active'}
        </span>
      </div>
    </div>
  )
}
