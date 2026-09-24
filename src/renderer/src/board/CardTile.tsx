// ── CardTile — one task on the board ─────────────────────────────────
// Selection is owned by the board (click / Ctrl-click / Shift-click);
// the tile renders it. Left edge = priority stripe, circle = done toggle,
// double-click the title to rename in place. Terminal-bound cards keep
// their nudge (doing) and follow-up (review/done) inputs.

import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { Calendar, Check, GitBranch, MessageSquare, Pencil, Send, Terminal, User, AlignLeft } from 'lucide-react'
import clsx from 'clsx'
import type { TaskCard } from '@shared/types'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { StatusDot } from '../components/StatusDot'
import {
  ME_AGENT_ID,
  noteTerminalRespawn,
  sendTerminalFollowUp,
  workerForAssignee,
  type TerminalWorker
} from '../lib/terminal-crew'
import { dueLabel } from '../components/CardEditorModal'
import { AssignMenu, WORKER_DOT, timeAgo } from './crew'
import { dueBucket } from './model'

export interface CardTileProps {
  card: TaskCard
  workers: TerminalWorker[]
  /** In the multi-selection. */
  selected: boolean
  /** The keyboard cursor sits here. */
  cursor: boolean
  /** Part of an in-flight drag. */
  dragging: boolean
  renaming: boolean
  assignOpen: boolean
  onAssignOpenChange: (open: boolean) => void
  onPointerSelect: (card: TaskCard, e: MouseEvent) => void
  onEdit: (card: TaskCard) => void
  onNewTerminal: (card: TaskCard) => void
  onToggleDone: (card: TaskCard) => void
  onRename: (card: TaskCard, title: string | null) => void
  onStartRename: (card: TaskCard) => void
  onDragStart: (card: TaskCard, e: DragEvent) => void
  onDragEnd: () => void
}

const PRIORITY_STRIPE: Record<0 | 1 | 2, string> = {
  0: 'transparent',
  1: 'var(--color-accent)',
  2: 'var(--color-needs)'
}

export function CardTile(p: CardTileProps) {
  const { card, workers } = p
  const agents = useApp((s) => s.agents)
  const runs = useApp((s) => s.runs)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [nudge, setNudge] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [review, setReview] = useState('')
  const [titleDraft, setTitleDraft] = useState(card.title)
  const renameRef = useRef<HTMLInputElement>(null)

  const worker = workerForAssignee(workers, card.assigneeId)
  const isMe = card.assigneeId === ME_AGENT_ID
  const agent = worker || isMe ? undefined : agents.find((a) => a.id === card.assigneeId)
  const run = runs.find((r) => r.cardId === card.id)
  const terminalBound = worker !== undefined || card.assigneeId?.startsWith('term-') === true
  const done = card.status === 'done'
  const due = dueBucket(card)

  useEffect(() => {
    if (!p.renaming) return
    setTitleDraft(card.title)
    requestAnimationFrame(() => {
      renameRef.current?.focus()
      renameRef.current?.select()
    })
  }, [p.renaming, card.title])

  // review/done card → follow-up reopens the task + lands in the pty
  const sendReview = async () => {
    const msg = review.trim()
    if (!msg || !worker) return
    setReview('')
    setReviewOpen(false)
    noteTerminalRespawn(card.id)
    await getEngine().moveCard(card.id, 'doing')
    await sendTerminalFollowUp(worker, msg)
  }

  // nudge a doing card → keystrokes only, no status change
  const sendNudge = async () => {
    const msg = nudge.trim()
    if (!msg || !worker) return
    setNudge('')
    setNudgeOpen(false)
    noteTerminalRespawn(card.id)
    await sendTerminalFollowUp(worker, msg)
  }

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

  return (
    <div
      data-card-id={card.id}
      draggable={!p.renaming}
      onDragStart={(e) => p.onDragStart(card, e)}
      onDragEnd={p.onDragEnd}
      onMouseDown={(e) => {
        // shift-click range selection must not also select text
        if (e.shiftKey) e.preventDefault()
      }}
      onClick={(e) => p.onPointerSelect(card, e)}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button,input')) return
        p.onEdit(card)
      }}
      className={clsx(
        'group relative cursor-default overflow-hidden rounded-[10px] border py-2.5 pr-2.5 pl-3 shadow-[var(--shadow-card)] transition-[border-color,background-color,opacity,transform] duration-150',
        p.dragging && 'opacity-40',
        p.selected
          ? 'border-[rgba(245,165,36,0.45)] bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-raised))]'
          : 'card-hover border-[var(--border-default)] bg-raised hover:bg-[color-mix(in_srgb,white_1.5%,var(--color-raised))]',
        p.cursor && 'ring-focus'
      )}
    >
      {/* priority stripe */}
      <span
        aria-hidden
        className="absolute top-2 bottom-2 left-0 w-[2.5px] rounded-r-full"
        style={{ background: PRIORITY_STRIPE[card.priority] }}
      />

      <div className="flex items-start gap-2">
        <button
          onClick={(e) => {
            stop(e)
            p.onToggleDone(card)
          }}
          title={done ? 'Reopen' : 'Mark done (x)'}
          className={clsx(
            'mt-[1.5px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
            done
              ? 'border-[var(--color-done)] bg-[var(--color-done)] text-[var(--color-canvas)] shadow-[0_0_8px_rgba(70,167,88,0.35)]'
              : 'border-n8 text-transparent hover:border-[var(--color-done)] hover:bg-[rgba(70,167,88,0.1)] hover:text-[var(--color-done)]'
          )}
        >
          <Check size={9} strokeWidth={3} />
        </button>

        {p.renaming ? (
          <input
            ref={renameRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onClick={stop}
            onBlur={() => p.onRename(card, titleDraft)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') p.onRename(card, titleDraft)
              if (e.key === 'Escape') p.onRename(card, null)
            }}
            className="min-w-0 flex-1 rounded-md border border-[rgba(245,165,36,0.45)] bg-n2 px-1.5 text-[12.5px] leading-snug text-t1 outline-none"
          />
        ) : (
          <p
            onDoubleClick={(e) => {
              stop(e)
              p.onStartRename(card)
            }}
            title="Double-click to rename"
            className={clsx(
              'min-w-0 flex-1 text-[12.5px] leading-[18px] font-medium tracking-[-0.005em] break-words',
              done ? 'font-normal text-t3 line-through decoration-[var(--border-strong)]' : 'text-t1'
            )}
          >
            {card.title}
          </p>
        )}

        {run?.status === 'review' && (
          <button
            onClick={(e) => {
              stop(e)
              useApp.getState().openReview(run.id)
            }}
            title="Open the diff for review"
            className="shrink-0 rounded-full bg-accent-subtle px-1.5 py-px text-[9.5px] leading-relaxed font-semibold tracking-wide text-accent uppercase ring-1 ring-[rgba(245,165,36,0.25)] ring-inset transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)]"
          >
            diff
          </button>
        )}
      </div>

      {run?.summary && <p className="mt-1 truncate pl-[23px] text-[11px] text-t3">{run.summary}</p>}

      {/* meta row */}
      <div className="mt-2 flex min-h-5 items-center gap-1.5 pl-[23px]">
        {terminalBound ? (
          <span
            className="flex min-w-0 shrink items-center gap-1 text-[10.5px] text-t3"
            title={worker?.name ?? card.assigneeId ?? 'terminal'}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-n5 text-t2 ring-1 ring-[var(--border-subtle)] ring-inset">
              <Terminal size={9} />
            </span>
            {worker && <StatusDot status={WORKER_DOT[worker.status]} size={5} />}
            <span className="max-w-[96px] truncate">{worker?.name ?? 'terminal'}</span>
          </span>
        ) : isMe ? (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-t3" title="You">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-subtle text-accent ring-1 ring-[rgba(245,165,36,0.25)] ring-inset">
              <User size={9} />
            </span>
            me
          </span>
        ) : agent ? (
          <span className="flex min-w-0 shrink items-center gap-1 text-[10.5px] text-t3">
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
              style={{ background: `hsl(${agent.hue} 45% 42%)` }}
            >
              {agent.name[0]}
            </span>
            <StatusDot status={agent.status} size={5} />
            <span className="max-w-[96px] truncate">{agent.name}</span>
          </span>
        ) : !done ? (
          <span onClick={stop}>
            <AssignMenu
              card={card}
              workers={workers}
              onNewTerminal={p.onNewTerminal}
              open={p.assignOpen}
              onOpenChange={p.onAssignOpenChange}
            />
          </span>
        ) : null}

        {card.dueAt != null && (
          <span
            className={clsx(
              'flex h-[18px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium',
              due === 'overdue'
                ? 'bg-[rgba(229,72,77,0.12)] text-[var(--color-needs)]'
                : due === 'today'
                  ? 'bg-accent-subtle text-accent'
                  : 'bg-n4 text-t3'
            )}
            title={new Date(card.dueAt).toLocaleString()}
          >
            <Calendar size={9} />
            {dueLabel(card.dueAt)}
          </span>
        )}
        {card.body.trim() && (
          <span className="shrink-0 text-t4" title={card.body.slice(0, 280)}>
            <AlignLeft size={10} />
          </span>
        )}
        {run?.branch && (
          <span className="flex min-w-0 items-center gap-0.5 font-mono text-[10px] text-t4" title={run.branch}>
            <GitBranch size={9} className="shrink-0" />
            <span className="max-w-[80px] truncate">{run.branch}</span>
          </span>
        )}

        <span className="flex-1" />

        {card.status === 'review' && (
          <button
            onClick={(e) => {
              stop(e)
              void getEngine().moveCard(card.id, 'done')
            }}
            title="Approve — mark complete"
            className="flex h-5 shrink-0 items-center gap-1 rounded-md border border-[rgba(70,167,88,0.35)] bg-[rgba(70,167,88,0.07)] px-1.5 text-[10px] font-medium text-[var(--color-done)] transition-colors hover:border-[rgba(70,167,88,0.55)] hover:bg-[rgba(70,167,88,0.14)]"
          >
            <Check size={9} /> approve
          </button>
        )}

        {(card.status === 'doing' || card.status === 'review' || card.status === 'done') && worker && (
          <button
            onClick={(e) => {
              stop(e)
              if (card.status === 'doing') setNudgeOpen((v) => !v)
              else setReviewOpen((v) => !v)
            }}
            title={card.status === 'doing' ? 'Message this terminal' : 'Send a follow-up — reopens the task'}
            className={clsx(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-t4 transition-colors hover:bg-n4 hover:text-t1',
              (nudgeOpen || reviewOpen) && 'bg-n4 text-t2'
            )}
          >
            <MessageSquare size={11} />
          </button>
        )}

        <button
          onClick={(e) => {
            stop(e)
            p.onEdit(card)
          }}
          title="Edit (e)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-t4 opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 hover:bg-n4 hover:text-t1"
        >
          <Pencil size={10} />
        </button>
        <span className="tnum shrink-0 text-[10px] text-t4" title={`Updated ${new Date(card.updatedAt).toLocaleString()}`}>
          {timeAgo(card.updatedAt)}
        </span>
      </div>

      {card.status === 'doing' && worker && nudgeOpen && (
        <FollowUp
          value={nudge}
          onChange={setNudge}
          onSend={() => void sendNudge()}
          onCancel={() => setNudgeOpen(false)}
          placeholder="Message the terminal…"
        />
      )}
      {(card.status === 'review' || card.status === 'done') && worker && reviewOpen && (
        <FollowUp
          value={review}
          onChange={setReview}
          onSend={() => void sendReview()}
          onCancel={() => setReviewOpen(false)}
          placeholder="Follow-up — reopens the task…"
        />
      )}
    </div>
  )
}

function FollowUp({
  value,
  onChange,
  onSend,
  onCancel,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onCancel: () => void
  placeholder: string
}) {
  return (
    <div className="mt-2 flex items-center gap-1.5 pl-[23px]" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') onSend()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 rounded-lg border border-[var(--border-default)] bg-n1/70 px-2.5 text-[11.5px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none placeholder:text-t4 focus:border-[rgba(245,165,36,0.4)]"
      />
      <button
        onClick={onSend}
        disabled={!value.trim()}
        title="Send"
        className="btn-accent-soft flex h-7 w-7 shrink-0 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-40"
      >
        <Send size={11} />
      </button>
    </div>
  )
}
