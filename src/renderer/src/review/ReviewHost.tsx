// ── review overlay host ──────────────────────────────────────────────
// Mounts ReviewView as a centered modal whenever the store's reviewRunId
// is set. Esc / backdrop click close without side effects; Send-to-agent
// and Approve run their engine call, then close.

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Agent, Run } from '@shared/types'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { DEMO_DIFF } from '../lib/diff'
import ReviewView, { type ReviewRun } from './ReviewView'
import type { CheckItem } from './ChecksPanel'

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'run'
  )
}

/** plausible merge-readiness checks derived from run status — placeholder
 *  until real check results arrive over IPC */
function checksFor(run: Run): CheckItem[] {
  switch (run.status) {
    case 'failed':
      return [
        { label: 'Typecheck', status: 'fail', detail: 'tsc --noEmit exited 1' },
        { label: 'Lint', status: 'pass' },
        { label: 'Worktree clean', status: 'warn', detail: 'uncommitted changes remain' }
      ]
    case 'waiting':
      return [
        { label: 'Typecheck', status: 'pending', detail: 'blocked on your call' },
        { label: 'Worktree clean', status: 'warn', detail: 'no branch pushed yet' }
      ]
    default:
      // review / done / active — a plausible green-ish board
      return [
        { label: 'Typecheck', status: 'pass', detail: 'tsc --noEmit' },
        { label: 'Lint', status: 'pass' },
        { label: 'Worktree clean', status: 'warn', detail: 'uncommitted changes remain' }
      ]
  }
}

function toReviewRun(run: Run, agents: Agent[]): ReviewRun {
  const agentName = agents.find((a) => a.id === run.agentId)?.name ?? 'Agent'
  return {
    id: run.id,
    branch: run.branch ?? `agent/${slug(agentName)}`,
    agentName,
    summary: run.summary,
    // TODO real diff — replace DEMO_DIFF with the run's worktree diff via engine IPC
    diffText: DEMO_DIFF,
    checks: checksFor(run)
  }
}

export function ReviewHost() {
  const reviewRunId = useApp((s) => s.reviewRunId)
  const openReview = useApp((s) => s.openReview)
  const runs = useApp((s) => s.runs)
  const agents = useApp((s) => s.agents)

  const run = runs.find((r) => r.id === reviewRunId) ?? null

  // Esc closes — but not while typing in DiffView's inline comment editor
  // (its own Esc cancels the comment instead)
  useEffect(() => {
    if (!run) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') openReview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, openReview])

  // a stale id (run purged between state pushes) shouldn't pin the host
  useEffect(() => {
    if (reviewRunId && !run) openReview(null)
  }, [reviewRunId, run, openReview])

  return (
    <AnimatePresence>
      {run && (
        <div key="review-host" className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => openReview(null)}
          />
          {/* glass panel */}
          <motion.div
            className="pop-surface relative h-[85vh] w-[min(1100px,90vw)] overflow-hidden rounded-2xl"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <ReviewView
              run={toReviewRun(run, agents)}
              onSendToAgent={(md) => {
                void getEngine().nudgeAgent(run.agentId, md)
                openReview(null)
              }}
              onApprove={() => {
                void getEngine().moveCard(run.cardId, 'done')
                openReview(null)
              }}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default ReviewHost
