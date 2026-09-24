// ── OrchestrationRail — network terminals in the Sessions rail ───────
// Every orchestration network listed under the grid's groups, headed by
// its label ("Web 1: Senior loop"): the orchestrator, then its subagents,
// each with its CLI mark, live status and — like grid terminals — the
// CLI's past sessions (collapsed by default; networks get crowded).
// Clicking a row flips the workspace to orchestration, activates that
// network's tab and pops the subagent open.

import { useCallback, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { commandSessionId, type PaneAction } from '../lib/panes'
import {
  statusVersionSnapshot,
  focusOrchestrationNode,
  networkHoverTitle,
  subscribeSessionNames,
  nodeStatus,
  effectiveCommand,
  subscribeStatus,
  useOrch,
  type NodeStatus,
  type OrchNetwork,
  type OrchNode
} from '../lib/orchestration'
import { cliBrand } from '../components/CliBrand'
import { useApp } from '../lib/store'
import { PaneDispatchContext } from './pane-context'
import { LeafSessions } from './SessionRail'

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
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  useSyncExternalStore(subscribeStatus, statusVersionSnapshot) // live status dots — flips only
  // session resumes from the rail patch the network node, not a grid leaf
  const dispatch = useCallback((action: PaneAction) => {
    if (action.type === 'update') useOrch.getState().updateNode(action.leafId, action.patch)
  }, [])
  if (networks.length === 0) return null

  const row = (node: OrchNode, label: string, hub: boolean, current: boolean, task?: string) => {
    const status = nodeStatus(commandSessionId(node))
    const brand = cliBrand(effectiveCommand(node))
    return (
      <div key={node.id}>
        <button
          type="button"
          onClick={() => focusOrchestrationNode(node.id)}
          title={`${label} — ${brand.label}${task ? `\n${task}` : ''}`}
          className={clsx(
            'relative mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md py-[5px] pr-2 text-left transition-colors select-none',
            hub ? 'pl-2' : 'pl-[20px]',
            current ? 'bg-n3' : 'hover:bg-n2'
          )}
        >
          {current && (
            <span className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-[var(--color-accent)]" />
          )}
          <span className="flex shrink-0 items-center">{brand.mark(11)}</span>
          <span
            className={clsx(
              'min-w-0 flex-1 truncate text-[11.5px]',
              current ? 'font-medium text-t1' : hub ? 'text-t2' : 'text-t3'
            )}
          >
            {label}
          </span>
          <span
            className={clsx('h-[5px] w-[5px] shrink-0 rounded-full', status === 'busy' && 'status-pulse')}
            style={{ background: STATUS_COLOR[status] }}
          />
        </button>
        <LeafSessions
          leaf={node}
          projectRoot={projectRoot}
          defaultOpen={false}
          indent={hub ? 20 : 32}
        />
      </div>
    )
  }

  return (
    <PaneDispatchContext.Provider value={dispatch}>
      <div className="pb-1">
        <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-0.5 select-none">
          <span className="h-1 w-1 rounded-full" style={{ background: 'var(--color-accent)' }} />
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium tracking-[0.06em] text-t4 uppercase">
            Orchestration
          </span>
        </div>
        {networks.map((net) => (
          <NetworkBlock
            key={net.id}
            net={net}
            active={enabled && net.id === activeId}
            expandedId={expandedId}
            row={row}
          />
        ))}
      </div>
    </PaneDispatchContext.Provider>
  )
}

function NetworkBlock({
  net,
  active,
  expandedId,
  row
}: {
  net: OrchNetwork
  active: boolean
  expandedId: string | null
  row: (node: OrchNode, label: string, hub: boolean, current: boolean, task?: string) => React.ReactNode
}) {
  const hoverTitle = useSyncExternalStore(subscribeSessionNames, () => networkHoverTitle(net))
  return (
    <div className="mb-1">
      {/* network label — "Web 1: Senior loop"; hover adds the session */}
      <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 select-none" title={hoverTitle}>
        <span className="min-w-0 truncate text-[11px]">
          <span className="font-semibold text-t2">
            {net.name}
            {net.topic && <span className="text-t4">:</span>}
          </span>
          {net.topic && <span className="font-medium text-t3"> {net.topic}</span>}
        </span>
        <span className="tnum ml-auto shrink-0 text-[9.5px] text-t4/70">{net.agents.length + 1}</span>
      </div>
      {row(net.orchestrator, 'Orchestrator', true, active && !expandedId)}
      {net.agents.map((a, i) =>
        row(a, a.title ?? `Subagent ${i + 1}`, false, active && expandedId === a.id, a.task)
      )}
    </div>
  )
}

/** Terminal count across every network (for the rail header). */
export function useOrchestrationCount(): number {
  return useOrch((s) => s.networks.reduce((n, net) => n + 1 + net.agents.length, 0))
}
