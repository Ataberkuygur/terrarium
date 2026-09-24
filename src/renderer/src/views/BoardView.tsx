// ── board ────────────────────────────────────────────────────────────
// A horizontal to-do board: cards flow left → right through
// Backlog · Ready · Doing · Review · Done. Keyboard-first: capture with a
// one-line syntax (or paste a list), filter/search, walk with j/k/h/l,
// move with 1-5, multi-select and bulk-act, undo everything with Ctrl+Z.
// The crew strip lists the open workspace terminals — each assignable;
// doing cards auto-park in Review when their terminal's pty dies.
//
// Pure helpers live in ../board/model, the tile in ../board/CardTile,
// the crew strip + dialogs in ../board/crew.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import {
  ArrowRight,
  ArrowUpDown,
  Calendar,
  ChevronRight,
  Filter,
  Flag,
  Keyboard,
  Plus,
  Search,
  Trash2,
  User,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { CardStatus, TaskCard } from '@shared/types'
import { useApp } from '../lib/store'
import { getEngine, getPty } from '../lib/ipc'
import { Button, Kbd } from '../components/ui'
import {
  assignCardToSelf,
  markAutoReviewed,
  ME_AGENT_ID,
  noteTerminalRespawn,
  respawnGraceActive,
  sendTerminalFollowUp,
  useTerminalWorkers,
  wasAutoReviewed,
  workerForAssignee
} from '../lib/terminal-crew'
import { CardEditorModal } from '../components/CardEditorModal'
import { NewTerminalDialog, TerminalsSection } from '../board/crew'
import { CardTile } from '../board/CardTile'
import { ToastStack, useToasts } from '../board/toast'
import {
  COLUMNS,
  EMPTY_FILTERS,
  STATUS_LABEL,
  dueBucket,
  filtersActive,
  loadOrder,
  matchesFilters,
  parseQuickAdd,
  placeInOrder,
  saveOrder,
  sortColumn,
  splitPastedTasks,
  type BoardFilters,
  type ManualOrder,
  type QuickAdd,
  type SortMode
} from '../board/model'

const COLLAPSED_KEY = 'terrarium.board.collapsed'
const SORT_KEY = 'terrarium.board.sort'
/** Done reads as a log — show the recent slice, expand on demand. */
const DONE_PREVIEW = 25

const SORT_LABEL: Record<SortMode, string> = {
  manual: 'Manual',
  priority: 'Priority',
  due: 'Due date',
  updated: 'Recently updated'
}

function loadCollapsed(): CardStatus[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is CardStatus => COLUMNS.some((g) => g.status === s))
  } catch {
    return []
  }
}

function loadSort(): SortMode {
  try {
    const v = localStorage.getItem(SORT_KEY)
    return v === 'priority' || v === 'due' || v === 'updated' ? v : 'manual'
  } catch {
    return 'manual'
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

interface DropTarget {
  status: CardStatus
  /** Insertion index among the column's visible cards. */
  index: number
}

export function BoardView() {
  const cards = useApp((s) => s.cards)
  const runs = useApp((s) => s.runs)
  const agents = useApp((s) => s.agents)
  const projects = useApp((s) => s.projects)
  const newCardNonce = useApp((s) => s.newCardNonce)
  const workers = useTerminalWorkers(cards)
  const projectId = projects[0]?.id ?? 'proj-terrarium'

  const inputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [draft, setDraft] = useState('')
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [sort, setSortState] = useState<SortMode>(loadSort)
  const [order, setOrderState] = useState<ManualOrder>(loadOrder)
  const [collapsed, setCollapsed] = useState<CardStatus[]>(loadCollapsed)
  const [showAllDone, setShowAllDone] = useState(false)

  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [assignOpenId, setAssignOpenId] = useState<string | null>(null)
  const [columnAdd, setColumnAdd] = useState<CardStatus | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const [dragIds, setDragIds] = useState<string[]>([])
  const [drop, setDrop] = useState<DropTarget | null>(null)

  const [newTerminalCard, setNewTerminalCard] = useState<TaskCard | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const { toasts, push, dismiss, undoLast } = useToasts()

  const setSort = (s: SortMode) => {
    setSortState(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      /* non-fatal */
    }
  }
  const setOrder = (o: ManualOrder) => {
    setOrderState(o)
    saveOrder(o)
  }

  useEffect(() => {
    if (newCardNonce) inputRef.current?.focus()
  }, [newCardNonce])

  const waiting = runs.filter((r) => r.status === 'waiting')

  // ── derived columns ──

  const assigneeName = useCallback(
    (c: TaskCard) => {
      if (!c.assigneeId) return undefined
      if (c.assigneeId === ME_AGENT_ID) return 'me'
      return workerForAssignee(workers, c.assigneeId)?.name ?? agents.find((a) => a.id === c.assigneeId)?.name
    },
    [workers, agents]
  )

  const columns = useMemo(
    () =>
      COLUMNS.map((col) => {
        const all = cards.filter((c) => c.status === col.status)
        const sorted = sortColumn(all, col.status, sort, order)
        const visible = sorted.filter((c) => matchesFilters(c, filters, assigneeName))
        return { ...col, all: sorted, visible }
      }),
    [cards, sort, order, filters, assigneeName]
  )

  /** What's on screen per column (collapsed → nothing, done → capped). */
  const shown = useMemo(
    () =>
      columns.map((col) => {
        if (collapsed.includes(col.status)) return { ...col, cards: [] as TaskCard[], hidden: 0 }
        const cap = col.status === 'done' && !showAllDone && !filtersActive(filters)
        const list = cap ? col.visible.slice(0, DONE_PREVIEW) : col.visible
        return { ...col, cards: list, hidden: col.visible.length - list.length }
      }),
    [columns, collapsed, showAllDone, filters]
  )

  const flat = useMemo(() => shown.flatMap((c) => c.cards), [shown])
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  // Cards we just created may not be in engine state yet — don't let the
  // cleanup below drop the cursor that points at them.
  const freshIds = useRef(new Map<string, number>())

  // drop selection/cursor entries whose cards vanished (deleted, filtered out)
  useEffect(() => {
    const onScreen = new Set(flat.map((c) => c.id))
    const fresh = cursor ? freshIds.current.get(cursor) : undefined
    const pending = fresh !== undefined && Date.now() - fresh < 3000 && !cardById.has(cursor!)
    if (cursor && !onScreen.has(cursor) && !pending) setCursor(null)
    if ([...selected].some((id) => !onScreen.has(id))) {
      setSelected((s) => new Set([...s].filter((id) => onScreen.has(id))))
    }
  }, [flat, cursor, selected, cardById])

  // keep the cursor card on screen
  useEffect(() => {
    if (!cursor) return
    listRef.current
      ?.querySelector(`[data-card-id="${CSS.escape(cursor)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cursor])

  // auto-review: a doing card whose terminal's pty just died is done —
  // park it in review (once per stint, only with live pty data, and never
  // during the grace window after we respawned the pty ourselves).
  useEffect(() => {
    if (!getPty()) return
    for (const w of workers) {
      const card = w.card
      if (!card || card.status !== 'doing') continue
      if (w.sessionStatus !== 'exited' && w.sessionStatus !== 'dead') continue
      if (wasAutoReviewed(card.id) || respawnGraceActive(card.id)) continue
      markAutoReviewed(card.id)
      void getEngine().moveCard(card.id, 'review')
    }
  }, [workers])

  // ── actions (all undoable where the engine allows) ──

  const fail = useCallback(
    (what: string, e: unknown) =>
      push({ tone: 'error', text: `${what} failed — ${e instanceof Error ? e.message : String(e)}` }),
    [push]
  )

  /** Selection when non-empty, else the cursor card. */
  const targets = useCallback((): TaskCard[] => {
    const ids = selected.size ? [...selected] : cursor ? [cursor] : []
    return ids.map((id) => cardById.get(id)).filter((c): c is TaskCard => !!c)
  }, [selected, cursor, cardById])

  const moveCards = useCallback(
    async (list: TaskCard[], status: CardStatus, opts: { quiet?: boolean } = {}) => {
      const moving = list.filter((c) => c.status !== status)
      if (!moving.length) return
      const prev = moving.map((c) => [c.id, c.status] as const)
      try {
        for (const c of moving) await getEngine().moveCard(c.id, status)
        if (collapsed.includes(status)) setCollapsed((cs) => cs.filter((s) => s !== status))
        if (!opts.quiet || moving.length > 1) {
          push({
            text:
              moving.length === 1
                ? `“${moving[0].title}” → ${STATUS_LABEL[status]}`
                : `Moved ${plural(moving.length, 'task')} → ${STATUS_LABEL[status]}`,
            undo: async () => {
              for (const [id, st] of prev) await getEngine().moveCard(id, st).catch(() => {})
            }
          })
        }
      } catch (e) {
        fail('Move', e)
      }
    },
    [collapsed, push, fail]
  )

  const toggleDone = useCallback(
    (list: TaskCard[]) => {
      if (!list.length) return
      const allDone = list.every((c) => c.status === 'done')
      if (allDone) {
        // reopen: assigned work resumes, unassigned returns to Ready
        void (async () => {
          const prev = list.map((c) => [c.id, c.status] as const)
          try {
            for (const c of list) await getEngine().moveCard(c.id, c.assigneeId ? 'doing' : 'ready')
            push({
              text: `Reopened ${plural(list.length, 'task')}`,
              undo: async () => {
                for (const [id, st] of prev) await getEngine().moveCard(id, st).catch(() => {})
              }
            })
          } catch (e) {
            fail('Reopen', e)
          }
        })()
      } else void moveCards(list, 'done')
    },
    [moveCards, push, fail]
  )

  const deleteCards = useCallback(
    async (list: TaskCard[]) => {
      if (!list.length) return
      const snapshot = list.map((c) => ({ ...c }))
      try {
        for (const c of list) await getEngine().deleteCard(c.id)
      } catch (e) {
        fail('Delete', e)
        return
      }
      setSelected(new Set())
      push({
        text:
          list.length === 1 ? `Deleted “${list[0].title}”` : `Deleted ${plural(list.length, 'task')}`,
        undo: async () => {
          // the engine has no restore — recreate with the same content
          for (const c of snapshot) {
            try {
              const n = await getEngine().createCard({
                title: c.title,
                body: c.body,
                projectId: c.projectId,
                dueAt: c.dueAt
              })
              if (c.priority) await getEngine().updateCard(n.id, { priority: c.priority })
              if (c.status !== 'backlog') await getEngine().moveCard(n.id, c.status)
            } catch (e) {
              fail('Restore', e)
            }
          }
        }
      })
    },
    [push, fail]
  )

  const setPriority = useCallback(
    async (list: TaskCard[], priority?: 0 | 1 | 2) => {
      if (!list.length) return
      // no explicit value → cycle from the first card: none → P1 → P2 → none
      const next = priority ?? (((list[0].priority + 1) % 3) as 0 | 1 | 2)
      const prev = list.map((c) => [c.id, c.priority] as const)
      try {
        for (const c of list) await getEngine().updateCard(c.id, { priority: next })
        push({
          text: `${plural(list.length, 'task')} → ${next ? `P${next}` : 'no priority'}`,
          undo: async () => {
            for (const [id, pr] of prev) await getEngine().updateCard(id, { priority: pr }).catch(() => {})
          }
        })
      } catch (e) {
        fail('Priority', e)
      }
    },
    [push, fail]
  )

  const assignToMe = useCallback(
    async (list: TaskCard[]) => {
      const open = list.filter((c) => c.assigneeId !== ME_AGENT_ID && c.status !== 'done')
      if (!open.length) return
      let ok = 0
      for (const c of open) if (await assignCardToSelf(c)) ok++
      if (ok) push({ text: `Assigned ${plural(ok, 'task')} to you` })
      if (ok < open.length) push({ tone: 'error', text: `${open.length - ok} could not be assigned` })
    },
    [push]
  )

  const renameCard = useCallback(
    async (card: TaskCard, title: string | null) => {
      setRenamingId(null)
      const t = title?.trim()
      if (!t || t === card.title) return
      try {
        await getEngine().updateCard(card.id, { title: t })
        push({
          text: 'Renamed',
          undo: () => getEngine().updateCard(card.id, { title: card.title }).catch(() => {})
        })
      } catch (e) {
        fail('Rename', e)
      }
    },
    [push, fail]
  )

  /** Create one parsed task; returns the new card. */
  const createParsed = useCallback(
    async (q: QuickAdd, fallbackStatus?: CardStatus): Promise<TaskCard | null> => {
      if (!q.title) return null
      const card = await getEngine().createCard({ title: q.title, projectId, dueAt: q.dueAt ?? null })
      if (q.priority) await getEngine().updateCard(card.id, { priority: q.priority })
      const status = q.status ?? fallbackStatus
      if (q.assignMe) await assignCardToSelf(card)
      else if (status && status !== 'backlog') await getEngine().moveCard(card.id, status)
      return card
    },
    [projectId]
  )

  const addTasks = useCallback(
    async (lines: string[], status?: CardStatus) => {
      const created: TaskCard[] = []
      try {
        // newest floats to the top of a column — create a pasted list
        // bottom-up so it reads in its original order
        for (const line of [...lines].reverse()) {
          const c = await createParsed(parseQuickAdd(line), status)
          if (c) created.unshift(c)
        }
      } catch (e) {
        fail('Create', e)
      }
      if (!created.length) return
      if (collapsed.includes(status ?? created[0].status)) {
        setCollapsed((cs) => cs.filter((s) => s !== (status ?? 'backlog')))
      }
      for (const c of created) freshIds.current.set(c.id, Date.now())
      setCursor(created[0].id)
      setSelected(new Set())
      if (created.length > 1) {
        push({
          text: `Added ${plural(created.length, 'task')}`,
          undo: async () => {
            for (const c of created) await getEngine().deleteCard(c.id).catch(() => {})
          }
        })
      }
    },
    [createParsed, collapsed, push, fail]
  )

  const submitDraft = async () => {
    const line = draft.trim()
    if (!line) return
    setDraft('')
    await addTasks([line])
  }

  /** A multi-line paste into any capture input → one task per line. */
  const onPasteMany = (status?: CardStatus) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    const lines = splitPastedTasks(text)
    if (lines.length < 2) return
    e.preventDefault()
    void addTasks(lines, status)
  }

  const openNewTerminal = (card?: TaskCard) => {
    setNewTerminalCard(card)
    setDialogOpen(true)
  }

  // ── selection ──

  // read through a ref — rapid clicks can land before a re-render
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const onPointerSelect = useCallback(
    (card: TaskCard, e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,input,textarea,a')) return
      const cursor = cursorRef.current
      if (e.shiftKey && cursor) {
        const a = flat.findIndex((c) => c.id === cursor)
        const b = flat.findIndex((c) => c.id === card.id)
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          setSelected(new Set(flat.slice(lo, hi + 1).map((c) => c.id)))
          return
        }
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((s) => {
          const n = new Set(s.size ? s : cursor ? [cursor] : [])
          if (n.has(card.id)) n.delete(card.id)
          else n.add(card.id)
          return n
        })
        cursorRef.current = card.id
        setCursor(card.id)
        return
      }
      setSelected(new Set())
      cursorRef.current = card.id
      setCursor(card.id)
    },
    [flat]
  )

  // ── drag & drop (between columns + manual reorder) ──

  const onCardDragStart = (card: TaskCard, e: DragEvent) => {
    const ids = selected.has(card.id) && selected.size > 1 ? flat.filter((c) => selected.has(c.id)).map((c) => c.id) : [card.id]
    e.dataTransfer.setData('text/plain', JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
    setDragIds(ids)
    setCursor(card.id)
  }
  const endDrag = () => {
    setDragIds([])
    setDrop(null)
  }

  /** Insertion index from the pointer's Y among the column's card tiles. */
  const indexAt = (colEl: HTMLElement, clientY: number): number => {
    const tiles = [...colEl.querySelectorAll<HTMLElement>('[data-card-id]')]
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return tiles.length
  }

  const dropProps = (status: CardStatus) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!dragIds.length) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const list = e.currentTarget.querySelector<HTMLElement>('[data-col-list]')
      const index = list ? indexAt(list, e.clientY) : 0
      if (drop?.status !== status || drop.index !== index) setDrop({ status, index })
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault()
      let ids: string[] = []
      try {
        const raw = e.dataTransfer.getData('text/plain')
        const parsed: unknown = raw.startsWith('[') ? JSON.parse(raw) : [raw]
        ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
      } catch {
        ids = dragIds
      }
      const target = drop?.status === status ? drop : { status, index: 0 }
      endDrag()
      const moving = ids.map((id) => cardById.get(id)).filter((c): c is TaskCard => !!c)
      if (!moving.length) return

      // place in the manual order relative to the visible neighbours
      const col = shown.find((c) => c.status === status)!
      const visibleIds = col.cards.map((c) => c.id).filter((id) => !ids.includes(id))
      const fullIds = col.all.map((c) => c.id).filter((id) => !ids.includes(id))
      const vIndex = Math.min(target.index, visibleIds.length)
      const anchor = visibleIds[vIndex]
      const at = anchor ? fullIds.indexOf(anchor) : visibleIds.length ? fullIds.indexOf(visibleIds[visibleIds.length - 1]) + 1 : 0
      const sameColumn = moving.every((c) => c.status === status)
      if (sameColumn && sort !== 'manual') {
        setSort('manual')
        push({ text: 'Switched to manual order' })
      }
      setOrder(placeInOrder(order, status, fullIds, ids, at))
      if (!sameColumn) void moveCards(moving, status, { quiet: true })
    }
  })

  // ── keyboard ──

  const layout = useMemo(() => shown.filter((c) => c.cards.length), [shown])

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      if (!flat.length) return
      if (!cursor) {
        setCursor(flat[0].id)
        return
      }
      const ci = layout.findIndex((c) => c.cards.some((x) => x.id === cursor))
      if (ci < 0) {
        setCursor(flat[0].id)
        return
      }
      const row = layout[ci].cards.findIndex((x) => x.id === cursor)
      if (dx) {
        const nc = layout[Math.max(0, Math.min(layout.length - 1, ci + dx))]
        setCursor(nc.cards[Math.min(row, nc.cards.length - 1)].id)
      } else {
        const list = layout[ci].cards
        setCursor(list[Math.max(0, Math.min(list.length - 1, row + dy))].id)
      }
    },
    [flat, cursor, layout]
  )

  /** Shift+J/K — nudge the cursor card within its column (manual order). */
  const reorderCursor = useCallback(
    (dy: number) => {
      const card = cursor ? cardById.get(cursor) : undefined
      if (!card) return
      const col = columns.find((c) => c.status === card.status)!
      const ids = col.all.map((c) => c.id)
      const i = ids.indexOf(card.id)
      const j = Math.max(0, Math.min(ids.length - 1, i + dy))
      if (i === j) return
      if (sort !== 'manual') setSort('manual')
      const rest = ids.filter((id) => id !== card.id)
      setOrder(placeInOrder(order, card.status, rest, [card.id], j))
    },
    [cursor, cardById, columns, sort, order]
  )

  const hot = useRef({ moveCursor, reorderCursor, targets, moveCards, toggleDone, deleteCards, setPriority, assignToMe, undoLast, flat })
  hot.current = { moveCursor, reorderCursor, targets, moveCards, toggleDone, deleteCards, setPriority, assignToMe, undoLast, flat }

  const overlayOpen = dialogOpen || !!editingId || helpOpen

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable
      const st = useApp.getState()
      if (st.paletteOpen || st.reviewRunId || st.settingsOpen) return
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault()
          setHelpOpen(false)
        }
        return
      }
      if (overlayOpen || typing) return
      const h = hot.current
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (h.undoLast()) e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(h.flat.map((c) => c.id)))
        return
      }
      if (mod || e.altKey) return

      const list = h.targets()
      const key = e.key
      const handled = () => e.preventDefault()

      if (key === 'J' || key === 'K') {
        handled()
        h.reorderCursor(key === 'J' ? 1 : -1)
        return
      }
      switch (key) {
        case 'j':
        case 'ArrowDown':
          handled()
          h.moveCursor(0, 1)
          return
        case 'k':
        case 'ArrowUp':
          handled()
          h.moveCursor(0, -1)
          return
        case 'h':
        case 'ArrowLeft':
          handled()
          h.moveCursor(-1, 0)
          return
        case 'l':
        case 'ArrowRight':
          handled()
          h.moveCursor(1, 0)
          return
        case 'n':
        case 'c':
          handled()
          inputRef.current?.focus()
          return
        case '/':
          handled()
          searchRef.current?.focus()
          return
        case '?':
          handled()
          setHelpOpen(true)
          return
        case 'Escape':
          setSelected(new Set())
          setCursor(null)
          setAssignOpenId(null)
          return
      }
      if (!list.length) return
      const col = COLUMNS.find((c) => c.key === key)
      if (col) {
        handled()
        void h.moveCards(list, col.status)
        return
      }
      switch (key) {
        case 'Enter':
        case 'e':
          handled()
          setEditingId(list[0].id)
          return
        case 'r':
        case 'F2':
          handled()
          setRenamingId(list[0].id)
          return
        case 'x':
        case ' ':
          handled()
          h.toggleDone(list)
          return
        case 'p':
          handled()
          void h.setPriority(list)
          return
        case 'm':
          handled()
          void h.assignToMe(list)
          return
        case 'a':
          if (!list[0].assigneeId && list[0].status !== 'done') {
            handled()
            setAssignOpenId(list[0].id)
          }
          return
        case 'Delete':
        case 'Backspace':
          handled()
          void h.deleteCards(list)
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen, helpOpen])

  const toggleCollapsed = (status: CardStatus) => {
    setCollapsed((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        /* non-fatal */
      }
      return next
    })
  }

  const preview = draft.trim() ? parseQuickAdd(draft) : null
  const selCount = selected.size
  const selCards = targets()
  const editingCard = editingId ? cardById.get(editingId) : undefined
  const anyFilter = filtersActive(filters)
  const counts = useMemo(() => {
    const open = cards.filter((c) => c.status !== 'done')
    return {
      open: open.length,
      overdue: open.filter((c) => dueBucket(c) === 'overdue').length,
      today: open.filter((c) => dueBucket(c) === 'today').length
    }
  }, [cards])

  return (
    <div className="relative flex h-full flex-col" onDragEnd={endDrag}>
      <div className="shrink-0 px-5 pt-4">
        {waiting.length > 0 && (
          <div className="mb-3 rounded-xl border border-[rgba(242,85,90,0.3)] bg-[rgba(229,72,77,0.07)] p-3">
            <div className="micro-label mb-1.5" style={{ color: 'var(--color-needs)' }}>
              Waiting on you · {waiting.length}
            </div>
            {waiting.map((r) => {
              const w = workerForAssignee(workers, r.agentId)
              const agent = w ? undefined : agents.find((a) => a.id === r.agentId)
              const name = w?.name ?? agent?.name
              const card = cards.find((c) => c.id === r.cardId)
              return (
                <div key={r.id} className="flex items-center gap-3 py-1">
                  <span className="status-pulse h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--color-needs)' }} />
                  <p className="flex-1 truncate text-[12.5px] text-t2">
                    <span className="font-medium text-t1">{name}</span> — {r.summary || card?.title}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => useApp.getState().openReview(r.id)}>
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (w || agent) void getEngine().nudgeAgent(r.agentId, 'approved, continue').catch(() => {})
                      if (w) {
                        if (card) noteTerminalRespawn(card.id)
                        void sendTerminalFollowUp(w, 'approved, continue')
                      }
                    }}
                  >
                    Unblock <ArrowRight size={11} />
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {/* capture */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-n2 px-3.5 py-2 transition-colors focus-within:border-[var(--border-strong)]">
          <Plus size={14} className="shrink-0 text-t3" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPasteMany()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitDraft()
              if (e.key === 'Escape') {
                setDraft('')
                e.currentTarget.blur()
              }
            }}
            placeholder="New task…   !2 urgent · @me · ^tomorrow · #ready — paste a list for many"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-t1 outline-none placeholder:text-t4"
          />
          {preview && (preview.priority || preview.assignMe || preview.dueAt || preview.status) && (
            <span className="flex shrink-0 items-center gap-1">
              {preview.priority ? (
                <span className={clsx('rounded px-1 text-[10px]', preview.priority === 2 ? 'bg-[rgba(229,72,77,0.14)] text-[var(--color-needs)]' : 'bg-accent-subtle text-accent')}>
                  P{preview.priority}
                </span>
              ) : null}
              {preview.assignMe && <span className="rounded bg-n4 px-1 text-[10px] text-t2">@me</span>}
              {preview.dueAt && (
                <span className="flex items-center gap-0.5 rounded bg-n4 px-1 text-[10px] text-t2">
                  <Calendar size={9} />
                  {new Date(preview.dueAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              )}
              {preview.status && <span className="rounded bg-n4 px-1 text-[10px] text-t2">{STATUS_LABEL[preview.status]}</span>}
            </span>
          )}
          <Kbd>↵</Kbd>
        </div>

        {/* filter bar */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <div className="flex h-7 w-56 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-n1 px-2 focus-within:border-[var(--border-strong)]">
            <Search size={11} className="shrink-0 text-t4" />
            <input
              ref={searchRef}
              value={filters.text}
              onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilters((f) => ({ ...f, text: '' }))
                  e.currentTarget.blur()
                }
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder="Search tasks"
              className="min-w-0 flex-1 bg-transparent text-[11.5px] text-t1 outline-none placeholder:text-t4"
            />
            <Kbd>/</Kbd>
          </div>
          <Chips
            icon={<User size={10} />}
            value={filters.assignee}
            options={[
              ['all', 'Anyone'],
              ['me', 'Me'],
              ['terminals', 'Agents'],
              ['unassigned', 'Unassigned']
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, assignee: v }))}
          />
          <Chips
            icon={<Flag size={10} />}
            value={filters.priority}
            options={[
              ['all', 'Any'],
              ['p1', 'P1+'],
              ['p2', 'P2']
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, priority: v }))}
          />
          <Chips
            icon={<Calendar size={10} />}
            value={filters.due}
            options={[
              ['all', 'Any'],
              ['overdue', `Overdue${counts.overdue ? ` ${counts.overdue}` : ''}`],
              ['today', 'Today'],
              ['week', 'Week'],
              ['none', 'No date']
            ]}
            onChange={(v) => setFilters((f) => ({ ...f, due: v }))}
          />
          {anyFilter && (
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-t3 transition-colors hover:bg-n3 hover:text-t1"
            >
              <X size={10} /> Clear
            </button>
          )}
          <span className="flex-1" />
          <span className="text-[11px] text-t4">
            {counts.open} open
            {counts.today > 0 && <span className="text-accent"> · {counts.today} today</span>}
            {counts.overdue > 0 && <span className="text-[var(--color-needs)]"> · {counts.overdue} overdue</span>}
          </span>
          <label className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-n1 px-1.5 text-[11px] text-t3">
            <ArrowUpDown size={10} className="shrink-0" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="bg-transparent text-[11px] text-t2 outline-none [color-scheme:dark]"
              title="Sort within columns — dragging switches to Manual"
            >
              {(Object.keys(SORT_LABEL) as SortMode[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-t4 transition-colors hover:bg-n3 hover:text-t1"
          >
            <Keyboard size={13} />
          </button>
        </div>

        <div className="mt-3">
          <TerminalsSection workers={workers} onNewTerminal={() => openNewTerminal()} />
        </div>
      </div>

      {/* horizontal kanban */}
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5"
        onClick={(e) => {
          // clicking empty board space clears the selection
          if (e.target === e.currentTarget) {
            setSelected(new Set())
            setCursor(null)
          }
        }}
      >
        {shown.map((g) => {
          const isCollapsed = collapsed.includes(g.status)
          const isTarget = drop?.status === g.status
          const filtered = anyFilter && g.visible.length !== g.all.length
          const adding = columnAdd === g.status
          return (
            <section
              key={g.status}
              {...dropProps(g.status)}
              className={clsx(
                'flex shrink-0 flex-col rounded-xl border transition-colors',
                isCollapsed ? 'w-[168px]' : 'w-[284px]',
                isTarget ? 'border-[rgba(245,165,36,0.5)] bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-n1))]' : 'border-[var(--border-subtle)] bg-n1'
              )}
            >
              <header className="group/col flex items-center gap-1.5 px-3 py-2">
                <button
                  onClick={() => toggleCollapsed(g.status)}
                  aria-expanded={!isCollapsed}
                  title={isCollapsed ? 'Expand column' : 'Collapse column'}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <ChevronRight
                    size={11}
                    className={clsx('shrink-0 text-t4 transition-transform duration-150', !isCollapsed && 'rotate-90')}
                  />
                  <h2 className="micro-label">{g.label}</h2>
                  <span className="tnum text-[11px] text-t4">
                    {filtered ? `${g.visible.length}/${g.all.length}` : g.all.length}
                  </span>
                </button>
                <span className="hidden text-[10px] text-t4 opacity-0 transition-opacity group-hover/col:inline group-hover/col:opacity-100">
                  {g.key}
                </span>
                {!isCollapsed && (
                  <button
                    onClick={() => setColumnAdd(adding ? null : g.status)}
                    title={`Add to ${g.label}`}
                    className="rounded p-0.5 text-t4 transition-colors hover:bg-n4 hover:text-t1"
                  >
                    <Plus size={12} />
                  </button>
                )}
              </header>

              {!isCollapsed && (
                <div data-col-list className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
                  {adding && (
                    <ColumnAdd
                      label={g.label}
                      onPaste={onPasteMany(g.status)}
                      onSubmit={(t) => void addTasks([t], g.status)}
                      onClose={() => setColumnAdd(null)}
                    />
                  )}
                  {g.cards.map((card, i) => (
                    <div key={card.id}>
                      {isTarget && drop.index === i && <DropLine />}
                      <CardTile
                        card={card}
                        workers={workers}
                        selected={selected.has(card.id)}
                        cursor={cursor === card.id}
                        dragging={dragIds.includes(card.id)}
                        renaming={renamingId === card.id}
                        assignOpen={assignOpenId === card.id}
                        onAssignOpenChange={(o) => setAssignOpenId(o ? card.id : null)}
                        onPointerSelect={onPointerSelect}
                        onEdit={(c) => setEditingId(c.id)}
                        onNewTerminal={openNewTerminal}
                        onToggleDone={(c) => toggleDone(selected.has(c.id) && selected.size > 1 ? selCards : [c])}
                        onRename={(c, t) => void renameCard(c, t)}
                        onStartRename={(c) => setRenamingId(c.id)}
                        onDragStart={onCardDragStart}
                        onDragEnd={endDrag}
                      />
                    </div>
                  ))}
                  {isTarget && drop.index >= g.cards.length && g.cards.length > 0 && <DropLine />}
                  {g.cards.length === 0 && !adding && (
                    <button
                      onClick={() => setColumnAdd(g.status)}
                      className={clsx(
                        'rounded-lg border border-dashed px-2 py-5 text-center text-[10.5px] transition-colors',
                        isTarget
                          ? 'border-[rgba(245,165,36,0.5)] text-accent'
                          : 'border-[var(--border-subtle)] text-t4 hover:border-[var(--border-default)] hover:text-t3'
                      )}
                    >
                      {isTarget ? 'Drop here' : filtered ? 'No matches' : g.status === 'backlog' ? 'Capture above, or click to add' : 'Empty — drop or add'}
                    </button>
                  )}
                  {g.hidden > 0 && (
                    <button
                      onClick={() => setShowAllDone(true)}
                      className="rounded-md py-1.5 text-[11px] text-t4 transition-colors hover:bg-n3 hover:text-t2"
                    >
                      Show {g.hidden} older
                    </button>
                  )}
                  {g.status === 'done' && showAllDone && g.visible.length > DONE_PREVIEW && !anyFilter && (
                    <button
                      onClick={() => setShowAllDone(false)}
                      className="rounded-md py-1.5 text-[11px] text-t4 transition-colors hover:bg-n3 hover:text-t2"
                    >
                      Show fewer
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {/* bulk actions */}
      {selCount > 1 && (
        <div className="absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-popover px-2 py-1.5 shadow-lg-dark">
          <span className="px-1.5 text-[12px] font-medium text-t1">{selCount} selected</span>
          <span className="mx-1 h-4 w-px bg-n6" />
          {COLUMNS.map((c) => (
            <button
              key={c.status}
              onClick={() => void moveCards(selCards, c.status)}
              title={`Move to ${c.label} (${c.key})`}
              className="rounded-md px-1.5 py-1 text-[11px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
            >
              {c.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-n6" />
          <button onClick={() => void assignToMe(selCards)} title="Assign to me (m)" className="rounded-md p-1.5 text-t3 hover:bg-n4 hover:text-t1">
            <User size={12} />
          </button>
          <button onClick={() => void setPriority(selCards)} title="Cycle priority (p)" className="rounded-md p-1.5 text-t3 hover:bg-n4 hover:text-t1">
            <Flag size={12} />
          </button>
          <button
            onClick={() => void deleteCards(selCards)}
            title="Delete (Del) — undoable"
            className="rounded-md p-1.5 text-t3 hover:bg-[rgba(229,72,77,0.12)] hover:text-[var(--color-needs)]"
          >
            <Trash2 size={12} />
          </button>
          <button onClick={() => setSelected(new Set())} title="Clear selection (Esc)" className="rounded-md p-1.5 text-t4 hover:bg-n4 hover:text-t1">
            <X size={12} />
          </button>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {dialogOpen && <NewTerminalDialog card={newTerminalCard} onClose={() => setDialogOpen(false)} />}
      {editingCard && (
        <CardEditorModal
          card={editingCard}
          onClose={() => setEditingId(null)}
          onDelete={(c) => {
            setEditingId(null)
            void deleteCards([c])
          }}
        />
      )}
    </div>
  )
}

// ── bits ─────────────────────────────────────────────────────────────

function DropLine() {
  return <div className="mx-1 my-0.5 h-[2px] rounded-full bg-accent shadow-[0_0_6px_rgba(245,165,36,0.6)]" />
}

function Chips<T extends string>({
  icon,
  value,
  options,
  onChange
}: {
  icon: ReactNode
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex h-7 items-center gap-0.5 rounded-md border border-[var(--border-subtle)] bg-n1 px-1">
      <span className="px-0.5 text-t4">{icon}</span>
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={clsx(
            'rounded px-1.5 py-0.5 text-[11px] transition-colors',
            value === v ? 'bg-n4 text-t1' : 'text-t4 hover:text-t2'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function ColumnAdd({
  label,
  onSubmit,
  onPaste,
  onClose
}: {
  label: string
  onSubmit: (title: string) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void
  onClose: () => void
}) {
  const [v, setV] = useState('')
  return (
    <div className="rounded-lg border border-[var(--border-strong)] bg-base px-2.5 py-1.5">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onPaste={onPaste}
        onBlur={() => !v.trim() && onClose()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && v.trim()) {
            onSubmit(v.trim())
            setV('') // stay open — rapid-fire entry
          }
          if (e.key === 'Escape') onClose()
        }}
        placeholder={`Add to ${label}… ↵`}
        className="w-full bg-transparent text-[12px] text-t1 outline-none placeholder:text-t4"
      />
    </div>
  )
}

const SHORTCUTS: [string, string][] = [
  ['n  /  c', 'New task (capture bar)'],
  ['/', 'Search'],
  ['j k  ↑ ↓', 'Move down / up'],
  ['h l  ← →', 'Move between columns'],
  ['Shift + J / K', 'Reorder within column'],
  ['Enter  /  e', 'Open editor'],
  ['r  /  F2', 'Rename in place'],
  ['1 – 5', 'Move to Backlog · Ready · Doing · Review · Done'],
  ['x  /  Space', 'Toggle done'],
  ['p', 'Cycle priority'],
  ['m', 'Assign to me'],
  ['a', 'Assign menu (unassigned card)'],
  ['Del', 'Delete'],
  ['Ctrl + Z', 'Undo last action'],
  ['Ctrl + A', 'Select all visible'],
  ['Ctrl/Shift + click', 'Multi-select / range'],
  ['Esc', 'Clear selection']
]

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45" onClick={onClose}>
      <div
        className="w-[440px] rounded-xl border border-[var(--border-default)] bg-popover p-4 shadow-lg-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-t1">
            <Keyboard size={13} className="text-t3" /> Board shortcuts
          </h3>
          <button onClick={onClose} className="rounded-md p-1 text-t4 hover:bg-n4 hover:text-t2">
            <X size={13} />
          </button>
        </div>
        <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <span className="font-mono text-[11px] text-t2">{k}</span>
              <span className="text-[11.5px] text-t3">{d}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="micro-label mb-1.5">Capture syntax</div>
          <p className="text-[11.5px] leading-relaxed text-t3">
            <code className="text-t2">!1</code> / <code className="text-t2">!2</code> priority ·{' '}
            <code className="text-t2">@me</code> assign ·{' '}
            <code className="text-t2">^today ^tomorrow ^fri ^+3 ^2026-10-01</code> due ·{' '}
            <code className="text-t2">#ready</code> column. Paste a list → one task per line.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[10.5px] text-t4">
          <Filter size={10} /> Filters narrow every column; counts show visible/total.
        </div>
      </div>
    </div>
  )
}
