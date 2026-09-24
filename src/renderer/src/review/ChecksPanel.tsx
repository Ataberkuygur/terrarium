// ── merge-readiness checks panel ─────────────────────────────────────
// Pure list + aggregated verdict banner; checks arrive via props.
// Statuses: pass / fail / pending / warn — fail dominates the verdict,
// then pending, then warn, else green.

import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

export type CheckStatus = 'pass' | 'fail' | 'pending' | 'warn'

export interface CheckItem {
  label: string
  status: CheckStatus
  detail?: string
  /** optional right-aligned row action — e.g. "View logs", "Re-run" */
  action?: ReactNode
}

export interface ChecksPanelProps {
  checks: CheckItem[]
}

const STATUS_META: Record<CheckStatus, { icon: ReactNode; tint: string }> = {
  pass: { icon: <CheckCircle2 size={15} />, tint: 'var(--color-done)' },
  fail: { icon: <XCircle size={15} />, tint: 'var(--color-error)' },
  pending: { icon: <Loader2 size={15} className="animate-spin" />, tint: 'var(--color-working)' },
  warn: { icon: <AlertTriangle size={15} />, tint: 'var(--color-working)' }
}

interface Verdict {
  icon: ReactNode
  text: string
  border: string
  bg: string
  color: string
}

function aggregate(checks: CheckItem[]): Verdict {
  const fails = checks.filter((c) => c.status === 'fail').length
  const pending = checks.filter((c) => c.status === 'pending').length
  const warns = checks.filter((c) => c.status === 'warn').length

  // verdict tints = status token hues at fixed alpha (border ~35%, bg ~7%)
  const tint = (token: string) => ({
    border: `color-mix(in srgb, var(${token}) 35%, transparent)`,
    bg: `color-mix(in srgb, var(${token}) 7%, transparent)`,
    color: `var(${token})`
  })

  if (fails > 0)
    return {
      icon: <XCircle size={14} />,
      text: `${fails} check${fails === 1 ? '' : 's'} failing — merge blocked`,
      ...tint('--color-error')
    }
  if (pending > 0)
    return {
      icon: <Loader2 size={14} className="animate-spin" />,
      text: `${pending} check${pending === 1 ? '' : 's'} still running…`,
      ...tint('--color-working')
    }
  if (warns > 0)
    return {
      icon: <AlertTriangle size={14} />,
      text: `Passed with ${warns} warning${warns === 1 ? '' : 's'}`,
      ...tint('--color-working')
    }
  return {
    icon: <CheckCircle2 size={14} />,
    text: 'All checks passed — ready to merge',
    ...tint('--color-done')
  }
}

export function ChecksPanel({ checks }: ChecksPanelProps) {
  const verdict = aggregate(checks)

  return (
    <div className="bg-base">
      <div className="divide-y divide-[var(--border-subtle)]">
        {checks.map((c, i) => {
          const meta = STATUS_META[c.status]
          return (
            <div key={i} className="flex h-9 items-center gap-2.5 px-5">
              <span className="flex shrink-0 items-center" style={{ color: meta.tint }}>
                {meta.icon}
              </span>
              <span
                className={clsx(
                  'shrink-0 text-[12.5px]',
                  c.status === 'fail' ? 'font-medium text-t1' : 'text-t2'
                )}
              >
                {c.label}
              </span>
              {c.detail && (
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-t3" title={c.detail}>
                  {c.detail}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center">{c.action}</span>
            </div>
          )
        })}
        {checks.length === 0 && (
          <p className="px-5 py-3 text-[12px] text-t3">No checks reported for this run.</p>
        )}
      </div>

      {/* aggregated verdict */}
      <div className="px-4 pt-1 pb-3">
        <div
          className="flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          style={{ borderColor: verdict.border, background: verdict.bg, color: verdict.color }}
        >
          {verdict.icon}
          {verdict.text}
        </div>
      </div>
    </div>
  )
}
