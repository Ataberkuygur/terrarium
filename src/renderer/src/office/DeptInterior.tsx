/* ── DeptInterior — one department floor's interior view ─────────────
 * A thin wrapper around the existing office scenes: renders OfficeScene
 * (loft) or AvengersScene filtered to a single department's agents, with
 * a HUD header overlay carrying the dept's identity (hue chip + name +
 * member count), a Back button and a Manage popover for floor assignment
 * in standalone mode. compact mode shrinks the header to chip + name for
 * the split-tile layout.
 *
 * The scenes are NOT restyled — only wrapped. Scene wiring matches
 * OfficeView exactly: onInteract → onSelectAgent(id), onTargetChange →
 * pass-through, paused → frameloop control.
 */
import { useCallback, useState, type JSX } from 'react'
import { ArrowLeft, ChevronDown, Users } from 'lucide-react'
import type { Agent } from '@shared/types'
import {
  deptForAgent,
  setAgentDepartment,
  useDepartments,
  type Department
} from '../lib/departments'
import { OfficeScene } from './OfficeScene'
import { AvengersScene } from './avengers/AvengersScene'

export interface DeptInteriorProps {
  dept: Department
  /** agents already filtered to this department (drives the scene + count) */
  agents: Agent[]
  theme: 'loft' | 'avengers'
  /** full roster for the Manage popover (optional) */
  allAgents?: Agent[]
  /** department list for the Manage popover selects (optional) */
  departments?: Department[]
  /** split-tile mode: header shrinks to a tiny chip + name, no buttons */
  compact?: boolean
  paused?: boolean
  /** full-screen dept view: adds the Back + Manage controls */
  standalone?: boolean
  onBack?: () => void
  onSelectAgent?: (id: string) => void
  onTargetChange?: (agent: Agent | null) => void
}

// ── manage popover ───────────────────────────────────────────────────

/** Per-agent floor picker — a dept <select> per roster row. */
function ManageMenu({
  agents,
  depts,
  onClose
}: {
  agents: Agent[]
  depts: Department[]
  onClose: () => void
}): JSX.Element {
  return (
    <>
      {/* outside-click backdrop — same pattern as BoardView's AssignMenu */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--border-default)] bg-popover p-1 shadow-lg-dark">
        <div className="mb-1 border-b border-[var(--border-subtle)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-t3">
          Assign agents
        </div>
        <div className="max-h-72 overflow-y-auto">
          {agents.length === 0 && (
            <div className="px-2 py-3 text-[11.5px] text-t3">No agents yet</div>
          )}
          {agents.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-n4"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: `hsl(${a.hue} 60% 55%)` }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-t2" title={a.name}>
                {a.name}
              </span>
              <div className="relative shrink-0">
                <select
                  value={deptForAgent(a, depts).id}
                  onChange={(e) => setAgentDepartment(a.id, e.target.value || null)}
                  aria-label={`Department for ${a.name}`}
                  className="appearance-none rounded-md border border-[var(--border-subtle)] bg-n3 py-1 pl-2 pr-6 text-[11px] text-t2 outline-none transition-colors focus:border-[var(--border-strong)]"
                >
                  <option value="">Auto</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-t4"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── component ────────────────────────────────────────────────────────

export function DeptInterior({
  dept,
  agents,
  theme,
  allAgents,
  departments,
  compact = false,
  paused = false,
  standalone = false,
  onBack,
  onSelectAgent,
  onTargetChange
}: DeptInteriorProps): JSX.Element {
  const [manageOpen, setManageOpen] = useState(false)

  // Always subscribed: its refresh on 'terrarium:departments-updated' re-renders
  // us so deptForAgent() picks up fresh assignment values in the popover.
  const liveDepts = useDepartments()
  const depts = departments && departments.length > 0 ? departments : liveDepts

  // Scene wiring — same call shape as OfficeView (interact → select agent).
  const handleInteract = useCallback(
    (a: Agent) => onSelectAgent?.(a.id),
    [onSelectAgent]
  )
  const handleSelect = useCallback(
    (id: string | null) => {
      if (id != null) onSelectAgent?.(id)
    },
    [onSelectAgent]
  )

  const sceneProps = {
    agents,
    onSelect: handleSelect,
    onTargetChange,
    onInteract: handleInteract,
    paused
  }

  return (
    <div className="relative h-full select-none overflow-hidden bg-neutral-950">
      {/* the department's office floor — scene choice follows the theme */}
      {theme === 'avengers' ? (
        <AvengersScene {...sceneProps} />
      ) : (
        <OfficeScene {...sceneProps} />
      )}

      {/* header overlay — chrome-free by default (pointer-events only on
          the controls) */}
      <div className="pointer-events-none absolute left-3 top-3 z-30 flex items-start gap-1.5">
        {standalone && (
          <button
            onClick={onBack}
            title="Back to city view"
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-popover/90 px-2.5 py-1.5 text-[11.5px] font-medium text-t2 shadow-lg-dark backdrop-blur-md transition-colors hover:border-[var(--border-strong)] hover:text-t1"
          >
            <ArrowLeft size={12} />
            <span>City</span>
          </button>
        )}

        {/* dept identity chip — hue dot + name + member count */}
        <div
          className={`pointer-events-auto flex items-center rounded-lg border border-[var(--border-default)] bg-popover/90 shadow-lg-dark backdrop-blur-md ${
            compact ? 'gap-1.5 px-2 py-1' : 'gap-2 px-2.5 py-1.5'
          }`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: `hsl(${dept.hue} 60% 55%)` }}
          />
          <span
            className={`font-medium text-t1 ${compact ? 'text-[11px]' : 'text-[12px]'}`}
          >
            {dept.name}
          </span>
          {!compact && (
            <span className="tnum text-[11px] text-t3">· {agents.length}</span>
          )}
        </div>

        {standalone && (
          <div className="pointer-events-auto relative">
            <button
              onClick={() => setManageOpen((v) => !v)}
              title="Assign agents to departments"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-popover/90 px-2.5 py-1.5 text-[11.5px] font-medium text-t2 shadow-lg-dark backdrop-blur-md transition-colors hover:border-[var(--border-strong)] hover:text-t1"
            >
              <Users size={12} />
              <span>Manage</span>
              <ChevronDown
                size={11}
                className={`text-t3 transition-transform duration-200 ${
                  manageOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {manageOpen && (
              <ManageMenu
                agents={allAgents ?? []}
                depts={depts}
                onClose={() => setManageOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* empty floor hint — the scene still renders (an empty office reads
          fine), this just explains why */}
      {agents.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-lg border border-[var(--border-default)] bg-popover/85 px-3.5 py-2 text-[12px] text-t3 shadow-lg-dark backdrop-blur-md">
            No agents on this floor yet — assign via Manage
          </div>
        </div>
      )}
    </div>
  )
}
