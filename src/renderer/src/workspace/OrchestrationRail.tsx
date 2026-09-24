// ── OrchestrationRail — network terminals in the Sessions rail ───────
// Every orchestration network listed under the grid's groups: the
// orchestrator, then its subagents, each with its CLI mark and live
// status. Clicking a row flips the workspace to orchestration, activates
// that network's tab and pops the subagent open.

import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { commandSessionId } from '../lib/panes'
import {
  statusVersionSnapshot,
  focusOrchestrationNode,
  nodeStatus,
  effectiveCommand,
  subscribeStatus,
  useOrch,
  type NodeStatus,
  type OrchNode
} from '../lib/orchestration'
import { cliBrand } from '../components/CliBrand'

const STATUS_COLOR: Record<NodeStatus, string> = {
  starting: 'var(--color-t4)',
  busy: 'var(--color-working)',
  idle: 'var(--color-done)',
  exited: 'var(--color-error)'
}

export function OrchestrationRail() {
  const networks = useOrch((s) => s.networks)
  const enabled = useOrch((s) => s.enabled)
  const activeId = useOrch((s) => s.activeId)
  const expandedId = useOrch((s) => s.expandedId)
  useSyncExternalStore(subscribeStatus, statusVersionSnapshot) // live status dots — flips only
  if (networks.length === 0) return null

  const row = (node: OrchNode, label: string, hub: boolean, current: boolean) => {
    const status = nodeStatus(commandSessionId(node))
    const brand = cliBrand(effectiveCommand(node))
    return (
      <button
        key={node.id}
        type="button"
        onClick={() => focusOrchestrationNode(node.id)}
        title={`${label} — ${brand.label}${node.task ? `\n${node.task}` : ''}`}
        className={clsx(
          'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors select-none',
          hub ? 'pl-2' : 'pl-[22px]',
          current ? 'bg-n3 ring-1 ring-[var(--border-strong)]' : 'hover:bg-n2'
        )}
      >
        <span className="flex shrink-0 items-center">{brand.mark(11)}</span>
        <span
          className={clsx(
            'min-w-0 flex-1 truncate text-[11px]',
            current ? 'text-t1' : hub ? 'text-t2' : 'text-t3'
          )}
        >
          {label}
        </span>
        <span
          className={clsx('h-[5px] w-[5px] shrink-0 rounded-full', status === 'busy' && 'status-pulse')}
          style={{ background: STATUS_COLOR[status] }}
        />
      </button>
    )
  }

  return (
    <div className="pb-1">
      <div className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-0.5 select-none">
        <span className="h-1 w-1 rounded-full" style={{ background: 'var(--color-accent)' }} />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.05em] text-t4 uppercase">
          Orchestration
        </span>
      </div>
      {networks.map((net) => {
        const netActive = enabled && net.id === activeId
        return (
          <div key={net.id}>
            {row(net.orchestrator, `${net.name} · Orchestrator`, true, netActive && !expandedId)}
            {net.agents.map((a, i) =>
              row(a, a.title ?? `Subagent ${i + 1}`, false, netActive && expandedId === a.id)
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Terminal count across every network (for the rail header). */
export function useOrchestrationCount(): number {
  return useOrch((s) => s.networks.reduce((n, net) => n + 1 + net.agents.length, 0))
}
