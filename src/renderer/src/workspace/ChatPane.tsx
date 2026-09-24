// ── ChatPane — a single-agent thread inside a workspace leaf ──────────
// The thread is the agent's OfficeEvent slice: nudgeAgent() writes
// `You → <name>: msg` run.log rows (outgoing, right side); every other
// agent-bound event is an incoming beat (left). Sent messages render
// optimistically and fold away once the engine's own event lands.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Moon, SendHorizontal } from 'lucide-react'
import clsx from 'clsx'
import type { Agent } from '@shared/types'
import type { PaneLeaf } from '../lib/panes'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { StatusDot } from '../components/StatusDot'
import { PANE_META } from './EmptyPane'
import { usePaneDispatch } from './pane-context'

/** '12m'-style relative stamps — same shape as BoardView's timeAgo. */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

interface Msg {
  id: string
  out: boolean
  text: string
  at: number
}

/** nudgeAgent logs `You → <name>: <msg>` — the outgoing-row marker. */
const OUT_RE = /^You → [^:]*: ([\s\S]*)$/

const STATUS_TEXT: Record<Agent['status'], string> = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  idle: 'idle',
  offline: 'offline'
}

export function ChatPane({ leaf }: { leaf: PaneLeaf }) {
  const dispatch = usePaneDispatch()
  const agents = useApp((s) => s.agents)
  const cards = useApp((s) => s.cards)
  const events = useApp((s) => s.events)

  const agent = agents.find((a) => a.id === leaf.agentId) ?? null

  // An unbound chat leaf adopts the first crew member — better than a dead
  // pane. With no crew at all the EmptyPane-style hint below just stays.
  useEffect(() => {
    if (leaf.agentId || agents.length === 0 || !dispatch) return
    dispatch({
      type: 'update',
      leafId: leaf.id,
      patch: { agentId: agents[0].id, title: leaf.title ?? agents[0].name }
    })
  }, [leaf.agentId, leaf.id, leaf.title, agents, dispatch])

  const task = agent
    ? cards.find(
        (c) => c.assigneeId === agent.id && (c.status === 'doing' || c.status === 'review')
      )
    : undefined

  // events arrive newest-first → flip to chronological for the thread view
  const thread = useMemo<Msg[]>(() => {
    if (!agent) return []
    const rows: Msg[] = []
    for (const e of events) {
      if (e.agentId !== agent.id) continue
      const m = e.kind === 'run.log' ? OUT_RE.exec(e.text) : null
      rows.push({ id: e.id, out: !!m, text: m ? m[1] : e.text, at: e.ts })
    }
    return rows.reverse().slice(-80)
  }, [events, agent])

  // Optimistic echoes of what you send. Each pending copy drops once a real
  // outgoing event with the same text lands (multiset — 'ok' sent twice
  // needs two echoes to clear both).
  const [pending, setPending] = useState<Msg[]>([])
  const messages = useMemo(() => {
    if (pending.length === 0) return thread
    const echoed = new Map<string, number>()
    for (const m of thread) {
      if (m.out) echoed.set(m.text, (echoed.get(m.text) ?? 0) + 1)
    }
    const live = pending.filter((p) => {
      const n = echoed.get(p.text) ?? 0
      if (n > 0) {
        echoed.set(p.text, n - 1)
        return false
      }
      return true
    })
    return [...thread, ...live].sort((a, b) => a.at - b.at)
  }, [thread, pending])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // ── composer ──────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const grow = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 88)}px` // ≤4 rows
  }

  const send = () => {
    const msg = draft.trim()
    if (!msg || !agent) return
    setDraft('')
    setPending((p) => [
      ...p,
      { id: `local-${p.length}-${Date.now()}`, out: true, text: msg, at: Date.now() }
    ])
    void getEngine().nudgeAgent(agent.id, msg).catch(() => {})
    void getEngine().touchAgent(agent.id).catch(() => {})
  }

  // collapse the auto-grown textarea after a send clears the draft
  useEffect(() => {
    if (draft === '' && inputRef.current) inputRef.current.style.height = 'auto'
  }, [draft])

  if (!agent) {
    const meta = PANE_META.chat
    const Icon = meta.icon
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 select-none">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-gradient-to-b from-n4 to-n3 text-t3 shadow-[var(--shadow-card)]">
          <Icon size={18} strokeWidth={1.6} />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium tracking-[-0.01em] text-t1">{meta.empty}</p>
          <p className="mx-auto mt-1 max-w-[230px] text-[12px] leading-relaxed text-t3">
            {meta.hint}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* presence line — status dot + current card, under the pane header */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-n2/60 px-3 select-none">
        <StatusDot status={agent.status} size={6} />
        <span className="truncate text-[11px] text-t3">
          {task ? `working on ${task.title}` : STATUS_TEXT[agent.status]}
        </span>
        {agent.sleeping && <Moon size={10} className="shrink-0 text-t4" />}
      </div>

      {/* thread */}
      <div
        ref={scrollRef}
        className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3"
      >
        {messages.length === 0 && (
          <p className="m-auto text-[12px] text-t4 select-none">
            No messages yet — say hello.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={clsx(
              'flex max-w-[85%] flex-col gap-0.5',
              m.out ? 'items-end self-end' : 'items-start self-start'
            )}
          >
            <div
              className={clsx(
                'rounded-xl border px-3 py-1.5 text-[12.5px] leading-[18px] break-words whitespace-pre-wrap',
                m.out
                  ? 'rounded-br-[4px] border-[rgba(245,165,36,0.22)] bg-[var(--color-accent-subtle)] text-t1'
                  : 'rounded-bl-[4px] border-[var(--border-subtle)] bg-n3 text-t2'
              )}
            >
              {m.text}
            </div>
            <span className="tnum px-1 text-[9.5px] text-t4">{timeAgo(m.at)}</span>
          </div>
        ))}
      </div>

      {/* composer — Enter sends, Shift+Enter newline */}
      <div className="flex shrink-0 items-end gap-1.5 border-t border-[var(--border-subtle)] bg-n2 px-2 py-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          spellCheck={false}
          placeholder={`Message ${agent.name}…`}
          onChange={(e) => {
            setDraft(e.target.value)
            grow()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          className="scroll-thin max-h-[88px] min-w-0 flex-1 resize-none rounded-lg border border-[var(--border-default)] bg-n1 px-2.5 py-[5px] text-[12.5px] leading-[18px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.45)]"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          title={`Send to ${agent.name}`}
          className="btn-accent-soft flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-30"
        >
          <SendHorizontal size={13} />
        </button>
      </div>
    </div>
  )
}
