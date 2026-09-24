// ── board model — pure helpers for the Tasks board ───────────────────
// Filtering, sorting, due-date buckets, quick-add syntax and the manual
// (drag) order. No React; the view composes these.
//
// Manual order lives in localStorage (the engine has no position column):
// per status, a list of card ids. Cards missing from the list (new, or
// moved in from elsewhere) float to the top, newest first.

import type { CardStatus, TaskCard } from '@shared/types'

export const COLUMNS: { status: CardStatus; label: string; key: string }[] = [
  { status: 'backlog', label: 'Backlog', key: '1' },
  { status: 'ready', label: 'Ready', key: '2' },
  { status: 'doing', label: 'Doing', key: '3' },
  { status: 'review', label: 'Review', key: '4' },
  { status: 'done', label: 'Done', key: '5' }
]

export const STATUS_LABEL: Record<CardStatus, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.status, c.label])
) as Record<CardStatus, string>

// ── due buckets ──────────────────────────────────────────────────────

const DAY = 86_400_000

export function startOfDay(ms = Date.now()): number {
  return new Date(ms).setHours(0, 0, 0, 0)
}

export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none'

/** overdue = before today (and not done) · today · soon = next 7 days */
export function dueBucket(card: TaskCard, now = Date.now()): DueBucket {
  if (card.dueAt == null) return 'none'
  const today = startOfDay(now)
  const day = startOfDay(card.dueAt)
  if (card.status !== 'done' && card.dueAt < now && day < today) return 'overdue'
  if (day === today) return card.status !== 'done' && card.dueAt < now ? 'overdue' : 'today'
  if (day > today && day <= today + 7 * DAY) return 'soon'
  return day < today ? 'overdue' : 'later'
}

// ── filters ──────────────────────────────────────────────────────────

export type AssigneeFilter = 'all' | 'me' | 'unassigned' | 'terminals'
export type PriorityFilter = 'all' | 'p1' | 'p2'
export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none'
export type SortMode = 'manual' | 'priority' | 'due' | 'updated'

export interface BoardFilters {
  text: string
  assignee: AssigneeFilter
  priority: PriorityFilter
  due: DueFilter
}

export const EMPTY_FILTERS: BoardFilters = { text: '', assignee: 'all', priority: 'all', due: 'all' }

export function filtersActive(f: BoardFilters): boolean {
  return !!f.text.trim() || f.assignee !== 'all' || f.priority !== 'all' || f.due !== 'all'
}

export function matchesFilters(
  card: TaskCard,
  f: BoardFilters,
  assigneeName: (card: TaskCard) => string | undefined
): boolean {
  const q = f.text.trim().toLowerCase()
  if (q) {
    const hay = `${card.title}\n${card.body}\n${assigneeName(card) ?? ''}`.toLowerCase()
    // every word must appear somewhere — "login bug" finds "Bug in login"
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false
  }
  switch (f.assignee) {
    case 'me':
      if (card.assigneeId !== 'me') return false
      break
    case 'unassigned':
      if (card.assigneeId) return false
      break
    case 'terminals':
      if (!card.assigneeId || card.assigneeId === 'me') return false
      break
  }
  if (f.priority === 'p1' && card.priority < 1) return false
  if (f.priority === 'p2' && card.priority < 2) return false
  if (f.due !== 'all') {
    const b = dueBucket(card)
    if (f.due === 'overdue' && b !== 'overdue') return false
    if (f.due === 'today' && b !== 'today' && b !== 'overdue') return false
    if (f.due === 'week' && b !== 'today' && b !== 'soon' && b !== 'overdue') return false
    if (f.due === 'none' && b !== 'none') return false
  }
  return true
}

// ── ordering ─────────────────────────────────────────────────────────

const ORDER_KEY = 'terrarium.board.order'

export type ManualOrder = Partial<Record<CardStatus, string[]>>

export function loadOrder(): ManualOrder {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: ManualOrder = {}
    for (const c of COLUMNS) {
      const v = (parsed as Record<string, unknown>)[c.status]
      if (Array.isArray(v)) out[c.status] = v.filter((x): x is string => typeof x === 'string')
    }
    return out
  } catch {
    return {}
  }
}

export function saveOrder(order: ManualOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    /* storage unavailable — order is a nicety */
  }
}

/** Column's cards in display order for the given sort mode. */
export function sortColumn(
  cards: TaskCard[],
  status: CardStatus,
  mode: SortMode,
  order: ManualOrder
): TaskCard[] {
  const list = [...cards]
  const byUpdated = (a: TaskCard, b: TaskCard) => b.updatedAt - a.updatedAt
  switch (mode) {
    case 'priority':
      return list.sort((a, b) => b.priority - a.priority || byUpdated(a, b))
    case 'due':
      return list.sort(
        (a, b) =>
          (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) ||
          b.priority - a.priority ||
          byUpdated(a, b)
      )
    case 'updated':
      return list.sort(byUpdated)
    case 'manual': {
      const ids = order[status] ?? []
      const pos = new Map(ids.map((id, i) => [id, i]))
      // unplaced cards first (newest on top), then the saved order
      return list.sort((a, b) => {
        const pa = pos.get(a.id)
        const pb = pos.get(b.id)
        if (pa === undefined && pb === undefined) {
          // done column reads as a log — most recently finished first
          return status === 'done' ? byUpdated(a, b) : b.createdAt - a.createdAt
        }
        if (pa === undefined) return -1
        if (pb === undefined) return 1
        return pa - pb
      })
    }
  }
}

/** New manual order for `status` with `ids` placed at `index` (0 = top). */
export function placeInOrder(
  order: ManualOrder,
  status: CardStatus,
  current: string[],
  ids: string[],
  index: number
): ManualOrder {
  const moving = new Set(ids)
  const rest = current.filter((id) => !moving.has(id))
  const at = Math.max(0, Math.min(index, rest.length))
  const next: ManualOrder = { ...order }
  // drop the moved ids from every other column's list
  for (const c of COLUMNS) {
    if (c.status !== status && next[c.status]) {
      next[c.status] = next[c.status]!.filter((id) => !moving.has(id))
    }
  }
  next[status] = [...rest.slice(0, at), ...ids, ...rest.slice(at)]
  return next
}

// ── quick-add syntax ─────────────────────────────────────────────────
// "Fix login redirect !2 @me ^tomorrow" → title + priority/assign/due.
//   !1 / !2 (or ! / !!)  priority      @me                  assign to me
//   ^today ^tomorrow ^mon…^sun ^+3 ^2026-10-01            due date
//   #backlog #ready #doing #review #done                   target column

export interface QuickAdd {
  title: string
  priority?: 0 | 1 | 2
  assignMe?: boolean
  dueAt?: number
  status?: CardStatus
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** Due times default to end of the working day. */
const DUE_HOUR = 18

function atDueHour(dayStart: number): number {
  const d = new Date(dayStart)
  d.setHours(DUE_HOUR, 0, 0, 0)
  return d.getTime()
}

export function parseDue(token: string, now = Date.now()): number | undefined {
  const t = token.toLowerCase()
  const today = startOfDay(now)
  if (t === 'today' || t === 'tod') return atDueHour(today)
  if (t === 'tomorrow' || t === 'tom' || t === 'tmr') return atDueHour(today + DAY)
  const plus = t.match(/^\+(\d{1,3})d?$/)
  if (plus) return atDueHour(today + Number(plus[1]) * DAY)
  const wd = WEEKDAYS.findIndex((d) => t.startsWith(d))
  if (wd >= 0 && t.length >= 3) {
    const cur = new Date(today).getDay()
    const delta = (wd - cur + 7) % 7 || 7
    return atDueHour(today + delta * DAY)
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    if (Number.isFinite(d.getTime())) return atDueHour(d.getTime())
  }
  return undefined
}

export function parseQuickAdd(raw: string): QuickAdd {
  const out: QuickAdd = { title: '' }
  const words: string[] = []
  for (const w of raw.trim().split(/\s+/)) {
    if (w === '!2' || w === '!!') out.priority = 2
    else if (w === '!1' || w === '!') out.priority = 1
    else if (w === '!0') out.priority = 0
    else if (w.toLowerCase() === '@me') out.assignMe = true
    else if (w.startsWith('^') && parseDue(w.slice(1)) !== undefined) out.dueAt = parseDue(w.slice(1))
    else if (w.startsWith('#') && COLUMNS.some((c) => c.status === w.slice(1).toLowerCase())) {
      out.status = w.slice(1).toLowerCase() as CardStatus
    } else words.push(w)
  }
  out.title = words.join(' ')
  return out
}

/** A multi-line paste → one task per non-empty line (bullets stripped). */
export function splitPastedTasks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim())
    .filter(Boolean)
}
