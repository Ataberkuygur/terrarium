// ── Terrarium persistence engine ────────────────────────────────────────
// The real backend behind the renderer's Engine interface
// (src/shared/types.ts). One SQLite connection via node:sqlite,
// mutations are transactional, every mutation appends OfficeEvent rows
// and publishes a fresh EngineState snapshot on the bus — main/index.ts
// forwards that snapshot to webContents on 'engine:state'.

import type {
  DatabaseSync,
  SQLInputValue,
  SQLOutputValue,
  StatementSync
} from 'node:sqlite'
import type {
  Agent,
  AgentRole,
  AgentStatus,
  CardStatus,
  Engine as EngineApi,
  EngineState,
  EventKind,
  OfficeEvent,
  Project,
  Run,
  RunStatus,
  TaskCard,
  WikiPage,
  WikiPageMeta
} from '../../shared/types'
import { EngineBus } from './bus'
import { openDatabase } from './db'
import { ensurePaths, worktreeDir, type TerrariumPaths } from './paths'
import { buildSeed, DEMO_IDS } from './seed'

// unique-enough ids, same shape as the mock's (`card-lx…-0`)
let seq = 0
const rid = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const fmt = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ── row → domain mapping ─────────────────────────────────────────────

type Row = Record<string, SQLOutputValue>

const sOrNull = (v: SQLOutputValue | undefined): string | null =>
  v == null ? null : String(v)

const jsonLinks = (v: SQLOutputValue | undefined): string[] => {
  try {
    const parsed: unknown = JSON.parse(String(v ?? '[]'))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

const SLEEP_AFTER_MS = 90_000

const toAgent = (r: Row): Agent => {
  const status = String(r.status) as AgentStatus
  const lastActiveAt = Number(r.last_active_at ?? 0)
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role) as AgentRole,
    domain: String(r.domain ?? 'general') as Agent['domain'],
    brief: String(r.brief ?? ''),
    status,
    deskId: String(r.desk_id ?? ''),
    taskId: sOrNull(r.task_id),
    hue: Number(r.hue ?? 0),
    lastActiveAt,
    sleeping: status === 'idle' && Date.now() - lastActiveAt > SLEEP_AFTER_MS
  }
}

const toCard = (r: Row): TaskCard => ({
  id: String(r.id),
  title: String(r.title),
  body: String(r.body ?? ''),
  status: String(r.status) as CardStatus,
  assigneeId: sOrNull(r.assignee_id),
  projectId: String(r.project_id),
  priority: Number(r.priority ?? 0) as TaskCard['priority'],
  dueAt: r.due_at == null ? null : Number(r.due_at),
  createdAt: Number(r.created_at ?? 0),
  updatedAt: Number(r.updated_at ?? 0)
})

const toRun = (r: Row): Run => ({
  id: String(r.id),
  cardId: String(r.card_id),
  agentId: String(r.agent_id),
  status: String(r.status) as RunStatus,
  worktreePath: sOrNull(r.worktree_path),
  branch: sOrNull(r.branch),
  startedAt: Number(r.started_at ?? 0),
  endedAt: r.ended_at == null ? null : Number(r.ended_at),
  summary: String(r.summary ?? '')
})

const toProject = (r: Row): Project => ({
  id: String(r.id),
  name: String(r.name),
  rootPath: String(r.root_path),
  mainBranch: String(r.main_branch)
})

const toEvent = (r: Row): OfficeEvent => ({
  id: String(r.id),
  ts: Number(r.ts ?? 0),
  kind: String(r.kind) as EventKind,
  text: String(r.text),
  agentId: sOrNull(r.agent_id) ?? undefined,
  cardId: sOrNull(r.card_id) ?? undefined
})

const toDocMeta = (r: Row): WikiPageMeta => ({
  id: String(r.id),
  title: String(r.title),
  path: String(r.path),
  type: String(r.type) as WikiPageMeta['type'],
  stale: Number(r.stale ?? 0) !== 0,
  links: jsonLinks(r.links),
  updatedAt: Number(r.updated_at ?? 0)
})

// ── engine ───────────────────────────────────────────────────────────

export class Engine implements EngineApi {
  readonly paths: TerrariumPaths
  private db: DatabaseSync
  private bus = new EngineBus()
  private stmts = new Map<string, StatementSync>()

  constructor(db: DatabaseSync, paths: TerrariumPaths) {
    this.db = db
    this.paths = paths
    this.seedIfNeeded()
  }

  // ── plumbing ───────────────────────────────────────────────────────

  /** Tiny statement cache — the app is small, SQL strings are static. */
  private q(sql: string): StatementSync {
    let st = this.stmts.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.stmts.set(sql, st)
    }
    return st
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.q(sql).all(...params)
  }

  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.q(sql).get(...params)
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  /** Append an OfficeEvent row (call inside tx). Returns the stored event. */
  private log(kind: EventKind, text: string, agentId?: string, cardId?: string): OfficeEvent {
    const ev: OfficeEvent = { id: rid('ev'), ts: Date.now(), kind, text }
    if (agentId !== undefined) ev.agentId = agentId
    if (cardId !== undefined) ev.cardId = cardId
    this.q('INSERT INTO events (id, ts, kind, text, agent_id, card_id) VALUES (?,?,?,?,?,?)').run(
      ev.id,
      ev.ts,
      ev.kind,
      ev.text,
      ev.agentId ?? null,
      ev.cardId ?? null
    )
    return ev
  }

  /** Push committed events + fresh snapshot to all subscribers. */
  private publish(events: OfficeEvent[]): void {
    this.bus.publish(this.snapshot(), events)
  }

  private snapshot(): EngineState {
    return {
      agents: this.all('SELECT * FROM agents ORDER BY rowid').map(toAgent),
      cards: this.all('SELECT * FROM cards ORDER BY created_at DESC, rowid DESC').map(toCard),
      runs: this.all('SELECT * FROM runs ORDER BY started_at DESC, rowid DESC').map(toRun),
      projects: this.all('SELECT * FROM projects ORDER BY rowid').map(toProject),
      events: this.all('SELECT * FROM events ORDER BY ts DESC, rowid DESC LIMIT 200').map(toEvent)
    }
  }

  private mustCard(cardId: string): TaskCard {
    const row = this.get('SELECT * FROM cards WHERE id = ?', cardId)
    if (!row) throw new Error(`Terrarium: no card ${cardId}`)
    return toCard(row)
  }

  private mustAgent(agentId: string): Agent {
    const row = this.get('SELECT * FROM agents WHERE id = ?', agentId)
    if (!row) throw new Error(`Terrarium: no agent ${agentId}`)
    return toAgent(row)
  }

  // ── Engine interface ───────────────────────────────────────────────

  getState(): Promise<EngineState> {
    return Promise.resolve(this.snapshot())
  }

  subscribe(cb: (s: EngineState) => void): () => void {
    return this.bus.onState(cb)
  }

  /** Extra hook for main/index.ts — forwards single events to the ticker. */
  onEvent(cb: (e: OfficeEvent) => void): () => void {
    return this.bus.onEvent(cb)
  }

  createCard(input: {
    title: string
    body?: string
    projectId: string
    dueAt?: number | null
  }): Promise<TaskCard> {
    const now = Date.now()
    const card: TaskCard = {
      id: rid('card'),
      title: input.title,
      body: input.body ?? '',
      status: 'backlog',
      assigneeId: null,
      projectId: input.projectId,
      priority: 0,
      dueAt: typeof input.dueAt === 'number' && Number.isFinite(input.dueAt) ? input.dueAt : null,
      createdAt: now,
      updatedAt: now
    }
    const events = this.tx(() => {
      this.q(
        `INSERT INTO cards (id, title, body, status, assignee_id, project_id, priority, due_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        card.id,
        card.title,
        card.body,
        card.status,
        null,
        card.projectId,
        card.priority,
        card.dueAt,
        card.createdAt,
        card.updatedAt
      )
      return [this.log('card.move', `New card: ${card.title}`, undefined, card.id)]
    })
    this.publish(events)
    return Promise.resolve(card)
  }

  assignCard(cardId: string, agentId: string): Promise<void> {
    const events = this.tx(() => {
      const card = this.mustCard(cardId)
      const agent = this.mustAgent(agentId)
      const now = Date.now()
      const slug = agent.name.toLowerCase()

      // free a previous assignee, if any
      if (card.assigneeId && card.assigneeId !== agentId) {
        this.q(
          `UPDATE agents SET status = 'idle', task_id = NULL, last_active_at = ?
           WHERE id = ? AND task_id = ?`
        ).run(now, card.assigneeId, cardId)
      }

      this.q(
        `UPDATE cards SET assignee_id = ?, status = 'doing', updated_at = ? WHERE id = ?`
      ).run(agentId, now, cardId)
      this.q(
        `UPDATE agents SET status = 'working', task_id = ?, last_active_at = ? WHERE id = ?`
      ).run(cardId, now, agentId)

      const project = this.get('SELECT * FROM projects WHERE id = ?', card.projectId)
      const projectName = project ? String(project.name) : card.projectId
      this.q(
        `INSERT INTO runs (id, card_id, agent_id, status, worktree_path, branch, started_at, ended_at, summary)
         VALUES (?,?,?,?,?,?,?,NULL,?)`
      ).run(
        rid('run'),
        cardId,
        agentId,
        'active',
        worktreeDir(this.paths, projectName, `${slug}-${cardId}`),
        `agent/${slug}-${cardId}`,
        now,
        `Run created — ${agent.name} on "${card.title}"`
      )

      return [this.log('card.move', `${agent.name} picked up "${card.title}"`, agentId, cardId)]
    })
    this.publish(events)
    return Promise.resolve()
  }

  moveCard(cardId: string, status: CardStatus): Promise<void> {
    const events = this.tx(() => {
      const card = this.mustCard(cardId)
      const now = Date.now()
      const out: OfficeEvent[] = []

      this.q('UPDATE cards SET status = ?, updated_at = ? WHERE id = ?').run(status, now, cardId)

      if (status === 'done') {
        // complete the card's open run and release the agent
        const run = this.get(
          `SELECT * FROM runs
           WHERE card_id = ? AND status IN ('provisioning','active','waiting','review')
           ORDER BY started_at DESC LIMIT 1`,
          cardId
        )
        if (run) {
          this.q(`UPDATE runs SET status = 'done', ended_at = ? WHERE id = ?`).run(
            now,
            String(run.id)
          )
        }
        if (card.assigneeId) {
          this.q(
            `UPDATE agents SET status = 'idle', task_id = NULL, last_active_at = ? WHERE id = ?`
          ).run(now, card.assigneeId)
        }
        out.push(this.log('run.done', `Run finished — "${card.title}" done`, card.assigneeId ?? undefined, cardId))
      }

      out.push(this.log('card.move', `Card → ${status}`, undefined, cardId))
      return out
    })
    this.publish(events)
    return Promise.resolve()
  }

  updateCard(
    cardId: string,
    patch: Partial<Pick<TaskCard, 'title' | 'body' | 'priority' | 'dueAt'>>
  ): Promise<void> {
    const events = this.tx(() => {
      const card = this.mustCard(cardId)
      const now = Date.now()
      // presence-aware SET clauses — null is a real value for dueAt (clears
      // the schedule), while a missing key means "leave unchanged"
      const sets: string[] = ['updated_at = ?']
      const params: SQLInputValue[] = [now]
      if (patch.title !== undefined) {
        sets.push('title = ?')
        params.push(patch.title)
      }
      if (patch.body !== undefined) {
        sets.push('body = ?')
        params.push(patch.body)
      }
      if (patch.priority !== undefined) {
        sets.push('priority = ?')
        params.push(patch.priority)
      }
      if ('dueAt' in patch) {
        sets.push('due_at = ?')
        params.push(patch.dueAt ?? null)
      }
      params.push(cardId)
      this.q(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      return [this.log('run.log', `Card updated — "${patch.title ?? card.title}"`, undefined, cardId)]
    })
    this.publish(events)
    return Promise.resolve()
  }

  deleteCard(cardId: string): Promise<void> {
    const events = this.tx(() => {
      const card = this.mustCard(cardId)
      const now = Date.now()
      // free the assignee, then the row — runs/sessions/worktrees follow
      // their FK actions (runs cascade; sessions/worktrees go NULL)
      if (card.assigneeId) {
        this.q(
          `UPDATE agents SET status = 'idle', task_id = NULL, last_active_at = ?
           WHERE id = ? AND task_id = ?`
        ).run(now, card.assigneeId, cardId)
      }
      this.q('DELETE FROM cards WHERE id = ?').run(cardId)
      // no cardId on the event — the card row is already gone and
      // events.card_id would violate its FK (same pattern as removeAgent)
      return [this.log('card.move', `Card deleted — "${card.title}"`)]
    })
    this.publish(events)
    return Promise.resolve()
  }

  /** Re-point a project at a folder (first-run onboarding, settings). */
  setProjectRoot(projectId: string, rootPath: string): Promise<void> {
    const root = rootPath.trim()
    if (!root) return Promise.resolve()
    const name = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
    this.tx(() => {
      this.q('UPDATE projects SET root_path = ?, name = ? WHERE id = ?').run(root, name, projectId)
      return []
    })
    this.publish([])
    return Promise.resolve()
  }

  nudgeAgent(agentId: string, message: string): Promise<void> {
    const events = this.tx(() => {
      const agent = this.mustAgent(agentId)
      const now = Date.now()
      if (agent.status === 'waiting') {
        this.q(
          `UPDATE agents SET status = 'working', last_active_at = ? WHERE id = ?`
        ).run(now, agentId)
        // resume any run that was parked waiting on a human
        this.q(`UPDATE runs SET status = 'active' WHERE agent_id = ? AND status = 'waiting'`).run(
          agentId
        )
      }
      return [this.log('run.log', `You → ${agent.name}: ${message}`, agentId)]
    })
    this.publish(events)
    return Promise.resolve()
  }

  touchAgent(agentId: string): Promise<void> {
    // Terminal-I/O heartbeat: refreshes last_active_at so the agent wakes
    // from (or never enters) the derived `sleeping` state. No event noise —
    // a state push is enough, and the renderer throttles calls.
    this.q(`UPDATE agents SET last_active_at = ? WHERE id = ?`).run(Date.now(), agentId)
    this.publish([])
    return Promise.resolve()
  }

  upsertAgent(agent: Agent): Promise<void> {
    const events = this.tx(() => {
      const existing = this.get(`SELECT id FROM agents WHERE id = ?`, agent.id)
      this.q(
        `INSERT INTO agents (id, name, role, domain, brief, status, desk_id, task_id, hue, last_active_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, role=excluded.role, domain=excluded.domain,
           brief=excluded.brief, desk_id=excluded.desk_id, hue=excluded.hue`
      ).run(
        agent.id,
        agent.name,
        agent.role,
        agent.domain ?? 'general',
        agent.brief,
        agent.status ?? 'idle',
        agent.deskId ?? null,
        agent.taskId ?? null,
        agent.hue,
        agent.lastActiveAt ?? Date.now()
      )
      return [
        this.log('system', existing ? `${agent.name} updated` : `${agent.name} joined the crew`, agent.id)
      ]
    })
    this.publish(events)
    return Promise.resolve()
  }

  removeAgent(agentId: string): Promise<void> {
    const events = this.tx(() => {
      const agent = this.mustAgent(agentId)
      this.q(`UPDATE cards SET assignee_id = NULL WHERE assignee_id = ?`).run(agentId)
      this.q(`DELETE FROM agents WHERE id = ?`).run(agentId)
      return [this.log('system', `${agent.name} left the crew`)]
    })
    this.publish(events)
    return Promise.resolve()
  }

  // ── wiki ───────────────────────────────────────────────────────────

  listWikiPages(projectId: string): Promise<WikiPageMeta[]> {
    return Promise.resolve(
      this.all('SELECT * FROM docs WHERE project_id = ? ORDER BY rowid', projectId).map(toDocMeta)
    )
  }

  getWikiPage(projectId: string, pageId: string): Promise<WikiPage> {
    const row = this.get('SELECT * FROM docs WHERE project_id = ? AND id = ?', projectId, pageId)
    if (!row) throw new Error(`no page ${pageId}`)
    // backlinks are derived: scan outgoing links of every page in the project
    const backlinks = this.all('SELECT id, links FROM docs WHERE project_id = ?', projectId)
      .filter((r) => jsonLinks(r.links).includes(pageId))
      .map((r) => String(r.id))
    return Promise.resolve({ ...toDocMeta(row), body: String(row.body ?? ''), backlinks })
  }

  searchWiki(projectId: string, q: string): Promise<WikiPageMeta[]> {
    // build a safe FTS5 query: each term becomes a quoted phrase, ANDed
    const terms = q
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '')}"`)
    if (terms.length === 0) return Promise.resolve([])

    try {
      return Promise.resolve(
        this.all(
          `SELECT d.*
           FROM docs_fts
           JOIN docs d ON d.rowid = docs_fts.rowid
           WHERE docs_fts MATCH ? AND d.project_id = ?
           ORDER BY docs_fts.rank`,
          terms.join(' '),
          projectId
        ).map(toDocMeta)
      )
    } catch {
      // FTS query rejected (odd input) — degrade to substring match
      const needle = `%${q.toLowerCase()}%`
      return Promise.resolve(
        this.all(
          `SELECT * FROM docs
           WHERE project_id = ? AND (lower(title) LIKE ? OR lower(body) LIKE ?)
           ORDER BY updated_at DESC`,
          projectId,
          needle,
          needle
        ).map(toDocMeta)
      )
    }
  }

  saveWikiPage(projectId: string, pageId: string, body: string): Promise<void> {
    const existing = this.get(
      'SELECT id FROM docs WHERE project_id = ? AND id = ?',
      projectId,
      pageId
    )
    if (!existing) throw new Error(`no page ${pageId}`)
    const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim())
    this.q(
      'UPDATE docs SET body = ?, links = ?, updated_at = ? WHERE project_id = ? AND id = ?'
    ).run(body, JSON.stringify(links), Date.now(), projectId, pageId)
    return Promise.resolve()
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  /** Checkpoint WAL and close. Call on app quit. */
  close(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* best effort */
    }
    this.db.close()
  }

  // ── seed ───────────────────────────────────────────────────────────

  private seedIfNeeded(): void {
    const seeded = this.get('SELECT value FROM meta WHERE key = ?', 'seeded')
    if (seeded?.value === 'v2') return
    try {
      this.tx(() => {
        if (!seeded) {
          // Fresh install — the project row and nothing else. The user
          // builds their own crew/cards/docs; no demo office.
          const seed = buildSeed()
          this.q(
            'INSERT INTO projects (id, name, root_path, main_branch) VALUES (?,?,?,?)'
          ).run(
            seed.project.id,
            seed.project.name,
            seed.project.rootPath,
            seed.project.mainBranch
          )
        } else {
          this.purgeDemoRows()
        }
        this.q('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('seeded', 'v2')
        this.log('system', 'Terrarium engine online')
      })
    } catch (err) {
      throw new Error(`Terrarium: seed migration failed — ${fmt(err)}`)
    }
  }

  /**
   * v1 → v2: the old first-run demo (nine agents, nine cards, four runs,
   * six docs) was placeholder content — delete exactly those rows.
   * FK cascades cover runs/sessions/worktrees; docs_ad keeps FTS honest;
   * events lose their agent/card links on delete, so they go first.
   */
  private purgeDemoRows(): void {
    const qm = (ids: readonly string[]) => ids.map(() => '?').join(',')
    this.q(
      `DELETE FROM events WHERE agent_id IN (${qm(DEMO_IDS.agents)})
        OR card_id IN (${qm(DEMO_IDS.cards)})`
    ).run(...DEMO_IDS.agents, ...DEMO_IDS.cards)
    for (const [table, ids] of [
      ['runs', DEMO_IDS.runs],
      ['agents', DEMO_IDS.agents],
      ['cards', DEMO_IDS.cards],
      ['docs', DEMO_IDS.docs]
    ] as const) {
      if (ids.length) this.q(`DELETE FROM ${table} WHERE id IN (${qm(ids)})`).run(...ids)
    }
  }
}

/** Ensure ~/.terrarium exists, open app.db, seed on first run. */
export function createEngine(home?: string): Engine {
  const paths = ensurePaths(home)
  const db = openDatabase(paths.db)
  return new Engine(db, paths)
}
