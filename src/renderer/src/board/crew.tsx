// ── board crew — terminals strip, new-terminal dialog, assign menu ───
// The crew strip lists the open workspace TERMINALS — each renamable,
// each assignable; the "new terminal" dialog launches a named agent on a
// chosen CLI. AssignMenu hands a card to "me" or to an idle terminal.

import { useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { StatusDot } from '../components/StatusDot'
import { Button } from '../components/ui'
import {
  assignCardToSelf,
  assignCardToTerminal,
  focusTerminal,
  workerFromLeaf,
  type TerminalWorker
} from '../lib/terminal-crew'
import {
  getWorkspaceTerminalLeaves,
  LAUNCHABLE_CLIS,
  renameTerminalLeaf,
  spawnTerminalAgent
} from '../lib/terminal-agents'
import { DOMAIN_LABELS } from '../lib/terminal-classify'
import { randomLatinName } from '../lib/latin-names'
import { ArrowRight, Check, ChevronRight, Dices, Pencil, Plus, Terminal, User, X } from 'lucide-react'
import type { AgentStatus, TaskCard } from '@shared/types'
import clsx from 'clsx'

const TERMINALS_COLLAPSED_KEY = 'terrarium.board.terminalsCollapsed'

/** terminals strip collapse — separate key, default expanded */
function loadTerminalsCollapsed(): boolean {
  try {
    return localStorage.getItem(TERMINALS_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// worker status → StatusDot's AgentStatus vocabulary / label text / tone
export const WORKER_DOT: Record<TerminalWorker['status'], AgentStatus> = {
  working: 'working',
  waiting: 'waiting',
  idle: 'idle',
  exited: 'offline'
}
const WORKER_LABEL: Record<TerminalWorker['status'], string> = {
  working: 'working',
  waiting: 'waiting',
  idle: 'idle',
  exited: 'exited'
}
const WORKER_TONE: Record<TerminalWorker['status'], string> = {
  working: 'text-[var(--color-working)]',
  waiting: 'text-[var(--color-needs)]',
  idle: 'text-t4',
  exited: 'text-t4'
}

// ── new terminal dialog ──────────────────────────────────────────────

/** Prefill — a Latin name not already worn by a live terminal. */
const freshLatinName = () =>
  randomLatinName(
    new Set(
      getWorkspaceTerminalLeaves()
        .map((l) => l.title)
        .filter((t): t is string => !!t)
    )
  )

export function NewTerminalDialog({
  card,
  onClose
}: {
  /** when set, the card is assigned to the freshly spawned terminal */
  card?: TaskCard
  onClose: () => void
}) {
  const [name, setName] = useState(freshLatinName)
  const [cli, setCli] = useState('devin')
  const [pending, setPending] = useState(false)

  const create = async () => {
    if (pending) return
    setPending(true)
    try {
      const leafId = spawnTerminalAgent(cli, undefined, name.trim() || undefined)
      if (card) {
        const leaf = getWorkspaceTerminalLeaves().find((l) => l.id === leafId)
        if (leaf) await assignCardToTerminal(card, workerFromLeaf(leaf))
      }
      onClose()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45" onClick={onClose}>
      <div
        className="w-[340px] rounded-xl border border-[var(--border-default)] bg-popover p-4 shadow-lg-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 text-[13px] font-semibold text-t1">New terminal</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-t4 transition-colors hover:bg-n4 hover:text-t2"
          >
            <X size={13} />
          </button>
        </div>

        <div className="micro-label mb-1.5">Name</div>
        <div className="mb-3 flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="Terminal name…"
            className="flex-1 rounded-md border border-[var(--border-default)] bg-n2 px-2.5 py-1.5 text-[12.5px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--border-strong)]"
          />
          <button
            onClick={() => setName(freshLatinName())}
            title="Random name"
            className="rounded-md border border-[var(--border-default)] p-1.5 text-t3 transition-colors hover:border-[var(--border-strong)] hover:text-t1"
          >
            <Dices size={13} />
          </button>
        </div>

        <div className="micro-label mb-1.5">CLI</div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {LAUNCHABLE_CLIS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCli(c.key)}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                cli === c.key
                  ? 'border-accent bg-accent-subtle text-accent'
                  : 'border-[var(--border-default)] text-t3 hover:border-[var(--border-strong)] hover:text-t2'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="accent" disabled={pending} onClick={() => void create()}>
            {card ? 'Create & assign' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── crew strip ───────────────────────────────────────────────────────

function TerminalChip({ worker }: { worker: TerminalWorker }) {
  const projects = useApp((s) => s.projects)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(worker.name)
  const activeCard = worker.card
  const assignable = worker.status === 'idle' || worker.status === 'exited'

  const submit = async () => {
    const title = draft.trim()
    if (!title || pending) return
    setPending(true)
    try {
      const card = await getEngine().createCard({
        title,
        projectId: projects[0]?.id ?? 'proj-terrarium'
      })
      await assignCardToTerminal(card, worker)
      setDraft('')
    } finally {
      setPending(false)
    }
  }

  const commitRename = () => {
    setEditing(false)
    renameTerminalLeaf(worker.leaf.id, nameDraft)
  }

  return (
    <div className="group flex min-w-[240px] max-w-[360px] shrink-0 items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-base px-2.5 py-2">
      <StatusDot status={WORKER_DOT[worker.status]} size={7} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {editing ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setNameDraft(worker.name)
                  setEditing(false)
                }
              }}
              className="w-24 rounded border border-[var(--border-strong)] bg-n2 px-1 py-px text-[12px] text-t1 outline-none"
            />
          ) : (
            <>
              <button
                onClick={() => focusTerminal(worker)}
                title="Focus this terminal in Workspace"
                className="truncate text-[12px] font-medium text-t1 hover:text-accent"
              >
                {worker.name}
              </button>
              <button
                onClick={() => {
                  setNameDraft(worker.name)
                  setEditing(true)
                }}
                title="Rename terminal"
                className="shrink-0 rounded p-0.5 text-t4 opacity-0 transition-opacity hover:text-t2 group-hover:opacity-100"
              >
                <Pencil size={9} />
              </button>
            </>
          )}
          {worker.cli && worker.cli !== worker.name.toLowerCase() && (
            <span className="shrink-0 text-[10px] text-t4">· {worker.cli}</span>
          )}
          <span className="shrink-0 text-[10px] text-t4">— {DOMAIN_LABELS[worker.domain]}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={clsx('shrink-0 text-[10px]', WORKER_TONE[worker.status])}>
            {WORKER_LABEL[worker.status]}
          </span>
          {activeCard && (
            <span className="truncate text-[10px] text-t3">— {activeCard.title}</span>
          )}
          {worker.status === 'exited' && !activeCard && (
            <span className="truncate text-[10px] text-t4">— assign to respawn</span>
          )}
        </div>
      </div>

      {activeCard?.status === 'doing' && (
        <button
          onClick={() => void getEngine().moveCard(activeCard.id, 'done')}
          title="Mark its task done"
          className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-t3 transition-colors hover:border-[var(--border-strong)] hover:text-t1"
        >
          <Check size={9} /> done
        </button>
      )}

      {assignable && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void submit()
            }}
            placeholder="assign task…"
            className="w-24 rounded-md border border-[var(--border-default)] bg-n2 px-1.5 py-1 text-[10.5px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--border-strong)]"
          />
          <button
            onClick={() => void submit()}
            disabled={pending || !draft.trim()}
            title="Create a card and assign it to this terminal"
            className="rounded-md border border-[var(--border-default)] p-1 text-t3 transition-colors hover:border-[var(--border-strong)] hover:text-t1 disabled:opacity-40"
          >
            <ArrowRight size={10} />
          </button>
        </div>
      )}
    </div>
  )
}

export function TerminalsSection({
  workers,
  onNewTerminal
}: {
  workers: TerminalWorker[]
  onNewTerminal: () => void
}) {
  const [collapsed, setCollapsed] = useState(loadTerminalsCollapsed)
  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(TERMINALS_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable — non-fatal */
      }
      return next
    })

  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand crew' : 'Collapse crew'}
          className="flex items-center gap-1.5 rounded-md py-1 text-left transition-colors hover:text-t2"
        >
          <ChevronRight
            size={11}
            className={clsx(
              'shrink-0 text-t4 transition-transform duration-150',
              !collapsed && 'rotate-90'
            )}
          />
          <h2 className="micro-label">Crew</h2>
          <span className="text-[11px] tnum text-t4">{workers.length}</span>
        </button>
        <button
          onClick={onNewTerminal}
          title="Launch a new terminal — pick a name and a CLI"
          className="ml-auto flex items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[10.5px] text-t3 transition-colors hover:text-t2"
        >
          <Plus size={10} /> New terminal
        </button>
      </div>

      {!collapsed &&
        (workers.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-3">
            <p className="flex-1 text-[12px] text-t4">
              No open terminals — launch one or open Workspace.
            </p>
            <Button size="sm" variant="outline" onClick={onNewTerminal}>
              New terminal
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => useApp.getState().setView('workspace')}
            >
              Workspace
            </Button>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {workers.map((w) => (
              <TerminalChip key={w.leaf.id} worker={w} />
            ))}
            <button
              onClick={onNewTerminal}
              title="Launch a new terminal"
              className="flex w-[120px] shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-subtle)] text-[11px] text-t4 transition-colors hover:border-[var(--border-strong)] hover:text-t2"
            >
              <Plus size={11} /> New
            </button>
          </div>
        ))}
    </section>
  )
}

// ── cards ────────────────────────────────────────────────────────────

export function AssignMenu({
  card,
  workers,
  onNewTerminal,
  open: openProp,
  onOpenChange
}: {
  card: TaskCard
  workers: TerminalWorker[]
  onNewTerminal: (card: TaskCard) => void
  /** Controlled open state (the board's `a` shortcut); uncontrolled when omitted. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (v: boolean) => {
    setOpenState(v)
    onOpenChange?.(v)
  }
  const [pending, setPending] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // The menu is viewport-fixed: the card sits in a scrolling column that
  // would clip an absolutely positioned popover. Flip up near the bottom.
  const r = open ? btnRef.current?.getBoundingClientRect() : undefined
  const menuH = 44 + workers.length * 30 + 40
  const pos = r
    ? {
        left: Math.min(r.left, window.innerWidth - 216),
        ...(r.bottom + menuH > window.innerHeight
          ? { bottom: window.innerHeight - r.top + 4 }
          : { top: r.bottom + 4 })
      }
    : undefined
  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className="flex items-center gap-1 rounded-md border border-dashed border-[var(--border-strong)] px-1.5 py-0.5 text-[10.5px] text-t3 hover:text-t2 transition-colors"
      >
        <Plus size={10} /> Assign
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
          />
          <div
            className="fixed z-50 w-52 rounded-lg border border-[var(--border-default)] bg-popover p-1 shadow-lg-dark"
            style={pos}
            onClick={(e) => e.stopPropagation()}
          >
            {/* self-assign — the "me" seat */}
            <button
              disabled={pending}
              onClick={async () => {
                setPending(true)
                try {
                  await assignCardToSelf(card)
                } finally {
                  setPending(false)
                  setOpen(false)
                }
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-t2 hover:bg-n4 hover:text-t1 disabled:opacity-50"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-n5 text-t3">
                <User size={9} />
              </span>
              <span className="truncate">me</span>
            </button>

            {workers.length > 0 && <div className="mx-1 my-1 border-t border-[var(--border-subtle)]" />}
            {workers.map((w) => {
              const tag = w.status === 'exited' ? 'exited' : w.busy ? 'busy' : null
              return (
                <button
                  key={w.leaf.id}
                  disabled={tag !== null || pending}
                  onClick={async () => {
                    setPending(true)
                    try {
                      await assignCardToTerminal(card, w)
                    } finally {
                      setPending(false)
                      setOpen(false)
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-t2 hover:bg-n4 hover:text-t1 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-t2"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-n5 text-t3">
                    <Terminal size={9} />
                  </span>
                  <span className="truncate">
                    {w.name}
                    <span className="text-t4"> — {DOMAIN_LABELS[w.domain]}</span>
                  </span>
                  <span className="ml-auto shrink-0">
                    {tag ? (
                      <span className="text-[9.5px] text-t4">{tag}</span>
                    ) : (
                      <StatusDot status="idle" size={5} />
                    )}
                  </span>
                </button>
              )
            })}

            <div className="mx-1 my-1 border-t border-[var(--border-subtle)]" />
            <button
              onClick={() => {
                setOpen(false)
                onNewTerminal(card)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-t2 hover:bg-n4 hover:text-t1"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-t3">
                <Plus size={9} />
              </span>
              <span className="truncate">New terminal…</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
