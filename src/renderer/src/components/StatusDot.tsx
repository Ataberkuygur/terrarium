import type { AgentStatus } from '@shared/types'
import clsx from 'clsx'

const COLORS: Record<AgentStatus, string | null> = {
  working: 'var(--color-working)',
  waiting: 'var(--color-needs)',
  done: 'var(--color-done)',
  idle: null,
  offline: 'var(--color-n9)'
}

export function StatusDot({ status, size = 7 }: { status: AgentStatus; size?: number }) {
  const color = COLORS[status]
  if (!color) return <span style={{ width: size, height: size }} className="inline-block" />
  const pulse = status === 'working' || status === 'waiting'
  return (
    <span
      className={clsx('inline-block rounded-full', pulse && 'status-pulse')}
      style={{ width: size, height: size, background: color }}
    />
  )
}
