// ── CardEditorModal — edit / schedule / delete a board card ───────────────
// Opened from the pencil on a CardTile (or the `e` key on the board's
// selection). Edits go through engine.updateCard; status changes go through
// engine.moveCard so the run/agent bookkeeping still happens.

import { useState } from 'react'
import { Calendar, Pencil, Trash2, X } from 'lucide-react'
import type { CardStatus, TaskCard } from '@shared/types'
import { getEngine } from '../lib/ipc'
import { Button } from './ui'
import clsx from 'clsx'

const STATUS_OPTIONS: { id: CardStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'ready', label: 'Ready' },
  { id: 'doing', label: 'Doing' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' }
]

const PRIORITY_OPTIONS: { id: 0 | 1 | 2; label: string }[] = [
  { id: 0, label: 'None' },
  { id: 1, label: 'P1 · normal' },
  { id: 2, label: 'P2 · urgent' }
]

/** ms epoch → value for <input type="datetime-local"> (local wall time). */
export function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local string → ms epoch ('' → null). */
export function fromLocalInput(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Board chip text for a card's dueAt — "today", "tomorrow", "in 3d", "2d ago", or the date. */
export function dueLabel(ms: number): string {
  const day = 86_400_000
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const diffDays = Math.round((new Date(ms).setHours(0, 0, 0, 0) - startOfToday) / day)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays === -1) return 'yesterday'
  if (diffDays < 0) return `${-diffDays}d ago`
  if (diffDays <= 30) return `in ${diffDays}d`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Quick due presets — end of the working day. */
function presetDue(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(18, 0, 0, 0)
  return toLocalInput(d.getTime())
}

function nextMonday(): number {
  const dow = new Date().getDay()
  return ((8 - dow) % 7) || 7
}

export function CardEditorModal({
  card,
  onClose,
  onDelete
}: {
  card: TaskCard
  onClose: () => void
  /** When given, delete is delegated (the board makes it undoable) — no confirm step. */
  onDelete?: (card: TaskCard) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [priority, setPriority] = useState<0 | 1 | 2>(card.priority)
  const [status, setStatus] = useState<CardStatus>(card.status)
  const [due, setDue] = useState(toLocalInput(card.dueAt))
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    if (pending) return
    setPending(true)
    try {
      await getEngine().updateCard(card.id, {
        title: title.trim() || card.title,
        body,
        priority,
        dueAt: fromLocalInput(due)
      })
      if (status !== card.status) await getEngine().moveCard(card.id, status)
      onClose()
    } finally {
      setPending(false)
    }
  }

  const remove = async () => {
    if (pending) return
    if (onDelete) {
      onDelete(card)
      return
    }
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setPending(true)
    try {
      await getEngine().deleteCard(card.id)
      onClose()
    } finally {
      setPending(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-[var(--border-default)] bg-n1 px-2.5 py-1.5 text-[12.5px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors placeholder:text-t4 hover:border-[var(--border-strong)] focus:border-[rgba(245,165,36,0.45)]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className="pop-surface pop-in w-[460px] max-w-[92vw] overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
      >
        <div className="pane-head flex h-12 items-center justify-between border-b border-[var(--border-subtle)] pr-3 pl-5">
          <h3 className="m-0 flex items-center gap-2 text-[13.5px] font-semibold tracking-[-0.01em] text-t1">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-n4 text-t3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <Pencil size={11} />
            </span>
            Edit task
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div>
            <div className="micro-label mb-1.5">Title</div>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
              placeholder="Task title…"
              className={inputCls}
            />
          </div>

          <div>
            <div className="micro-label mb-1.5">Details</div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Notes, links, context…"
              rows={4}
              className={clsx(inputCls, 'resize-y leading-snug')}
            />
          </div>

          <div>
            <div className="micro-label mb-1.5">Priority</div>
            <div className="seg-track gap-0.5">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  className={clsx(
                    'h-[26px] flex-1 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors',
                    priority === p.id
                      ? p.id === 2
                        ? 'bg-[rgba(229,72,77,0.14)] text-[var(--color-needs)] shadow-[inset_0_0_0_1px_rgba(229,72,77,0.4)]'
                        : p.id === 1
                          ? 'bg-accent-subtle text-accent shadow-[inset_0_0_0_1px_rgba(245,165,36,0.4)]'
                          : 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                      : 'text-t3 hover:text-t1'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="micro-label mb-1.5">Column</div>
            <div className="seg-track gap-0.5">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setStatus(o.id)}
                  className={clsx(
                    'h-[26px] flex-1 rounded-[7px] px-1.5 text-[11.5px] font-medium transition-colors',
                    status === o.id
                      ? 'bg-gradient-to-b from-n5 to-n4 text-t1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_2px_rgba(0,0,0,0.4)]'
                      : 'text-t3 hover:text-t1'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="micro-label mb-1.5 flex items-center gap-1.5">
              <Calendar size={10} /> Due / scheduled
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={clsx(inputCls, 'flex-1 [color-scheme:dark]')}
              />
              {!due &&
                ([
                  ['Today', 0],
                  ['Tomorrow', 1],
                  ['Next week', nextMonday()]
                ] as const).map(([label, d]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDue(presetDue(d))}
                    className="flex h-[30px] shrink-0 items-center rounded-lg border border-[var(--border-default)] px-2.5 text-[11.5px] text-t3 transition-colors hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1"
                  >
                    {label}
                  </button>
                ))}
              {due && (
                <button
                  onClick={() => setDue('')}
                  title="Clear the date"
                  className="flex h-[30px] shrink-0 items-center rounded-lg border border-[var(--border-default)] px-2.5 text-[11.5px] text-t3 transition-colors hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1"
                >
                  clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-n1/40 px-5 py-3">
          <Button
            size="sm"
            variant={confirmDelete ? 'danger' : 'ghost'}
            onClick={() => void remove()}
            disabled={pending}
          >
            <Trash2 size={11} />
            {confirmDelete ? 'Really delete?' : 'Delete'}
          </Button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="accent" disabled={pending} onClick={() => void save()}>
              Save <span className="ml-0.5 font-mono text-[10px] opacity-60">Ctrl↵</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
