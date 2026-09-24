// ── review surface — the "review diff → comment → send back" loop ────
// Composition shell: run header, collapsible ChecksPanel, DiffView.
// All data via props; ReviewView owns only the checks-collapse toggle.

import { useState } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import clsx from 'clsx'
import { ChecksPanel, type CheckItem } from './ChecksPanel'
import { DiffView } from './DiffView'

/** the Run-ish shape the review surface needs — kept loose so the
 *  integrator can adapt shared/types Run + extras without ceremony */
export interface ReviewRun {
  id: string
  branch: string | null
  agentName: string
  summary: string
  diffText: string
  checks: CheckItem[]
}

export interface ReviewViewProps {
  run: ReviewRun
  /** receives the markdown batch from buildCommentBatch() */
  onSendToAgent?: (batch: string) => void
  onApprove?: () => void
}

export default function ReviewView({
  run,
  onSendToAgent = () => {},
  onApprove
}: ReviewViewProps) {
  const [checksOpen, setChecksOpen] = useState(true)
  const failing = run.checks.filter((c) => c.status === 'fail').length
  const pending = run.checks.filter((c) => c.status === 'pending').length

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* ── run header ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-n5 text-[10px] font-bold text-t1">
          {run.agentName[0] ?? '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-t1">{run.agentName}</span>
            {run.branch && (
              <span className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-n3 px-1.5 py-0.5 font-mono text-[10.5px] text-t2">
                <GitBranch size={10} className="text-t3" />
                {run.branch}
              </span>
            )}
          </div>
          {run.summary && (
            <p className="mt-0.5 truncate text-[11.5px] text-t3">{run.summary}</p>
          )}
        </div>
        <span className="micro-label shrink-0">Review</span>
      </div>

      {/* ── checks (collapsible) ── */}
      <div className="shrink-0 border-b border-[var(--border-subtle)]">
        <button
          onClick={() => setChecksOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-2 transition-colors hover:bg-n2"
        >
          <ChevronDown
            size={13}
            className={clsx('text-t3 transition-transform duration-150', !checksOpen && '-rotate-90')}
          />
          <span className="micro-label">Checks</span>
          <span className="text-[11px] tnum text-t4">{run.checks.length}</span>
          <span className="ml-auto flex items-center gap-2">
            {failing > 0 && <span className="text-[11px] font-medium text-error">{failing} failing</span>}
            {pending > 0 && (
              <span className="text-[11px] font-medium text-working">{pending} running</span>
            )}
          </span>
        </button>
        {checksOpen && <ChecksPanel checks={run.checks} />}
      </div>

      {/* ── diff review ── */}
      <div className="min-h-0 flex-1">
        <DiffView diffText={run.diffText} onSendToAgent={onSendToAgent} onApprove={onApprove} />
      </div>
    </div>
  )
}
