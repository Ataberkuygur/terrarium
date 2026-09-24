// ── Terrarium domain model ──────────────────────────────────────────────

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting' // needs human input / approval
  | 'done'
  | 'offline'

export type AgentRole =
  | 'lead'
  | 'builder'
  | 'reviewer'
  | 'researcher'
  | 'designer'
  | 'scribe'

export type AgentDomain =
  | 'frontend'
  | 'backend'
  | 'marketing'
  | 'design'
  | 'research'
  | 'legal'
  | 'general'

export interface Agent {
  id: string
  name: string
  role: AgentRole
  /** subject-matter zone the agent belongs to — drives office zone + crew grouping */
  domain: AgentDomain
  brief: string
  status: AgentStatus
  deskId: string
  /** current task card id, if any */
  taskId: string | null
  /** accent hue assigned to this agent (degrees) */
  hue: number
  lastActiveAt: number
  /** derived: idle + quiet for a while → doze pose in the office */
  sleeping?: boolean
}

export type CardStatus = 'backlog' | 'ready' | 'doing' | 'review' | 'done'

export interface TaskCard {
  id: string
  title: string
  body: string
  status: CardStatus
  assigneeId: string | null
  projectId: string
  priority: 0 | 1 | 2 // none, normal, urgent
  /** Optional due/scheduled time (ms epoch). null = unscheduled. */
  dueAt: number | null
  createdAt: number
  updatedAt: number
}

export type RunStatus =
  | 'provisioning'
  | 'active'
  | 'waiting' // needs human
  | 'review'
  | 'done'
  | 'failed'

export interface Run {
  id: string
  cardId: string
  agentId: string
  status: RunStatus
  worktreePath: string | null
  branch: string | null
  startedAt: number
  endedAt: number | null
  summary: string
}

export interface Project {
  id: string
  name: string
  rootPath: string
  mainBranch: string
}

export type EventKind =
  | 'agent.status'
  | 'card.move'
  | 'run.log'
  | 'run.done'
  | 'run.waiting'
  | 'system'

export interface OfficeEvent {
  id: string
  ts: number
  kind: EventKind
  text: string
  agentId?: string
  cardId?: string
}

export interface WikiPageMeta {
  id: string
  title: string
  path: string
  type: 'overview' | 'architecture' | 'module' | 'file' | 'howto' | 'glossary' | 'report'
  stale: boolean
  links: string[] // outgoing page ids
  updatedAt: number
}

export interface WikiPage extends WikiPageMeta {
  body: string // markdown
  backlinks: string[] // page ids linking here
}

// ── engine interface (implemented by electron main + browser mock) ──

export interface EngineState {
  agents: Agent[]
  cards: TaskCard[]
  runs: Run[]
  projects: Project[]
  events: OfficeEvent[]
}

export interface Engine {
  getState(): Promise<EngineState>
  subscribe(cb: (s: EngineState) => void): () => void
  createCard(input: {
    title: string
    body?: string
    projectId: string
    dueAt?: number | null
  }): Promise<TaskCard>
  assignCard(cardId: string, agentId: string): Promise<void>
  moveCard(cardId: string, status: CardStatus): Promise<void>
  /**
   * Patch a card's mutable fields (body/title/priority/dueAt).
   * `dueAt` is presence-aware: pass `null` to clear the schedule.
   */
  updateCard(
    cardId: string,
    patch: Partial<Pick<TaskCard, 'title' | 'body' | 'priority' | 'dueAt'>>
  ): Promise<void>
  /** Delete a card entirely; its runs cascade and the assignee is freed. */
  deleteCard(cardId: string): Promise<void>
  nudgeAgent(agentId: string, message: string): Promise<void>
  /** Bumps last_active_at / wakes a sleeping agent (terminal I/O heartbeat). */
  touchAgent(agentId: string): Promise<void>
  /** Insert-or-update a crew member (crew management). */
  upsertAgent(agent: Agent): Promise<void>
  /** Remove a crew member; their cards return to unassigned. */
  removeAgent(agentId: string): Promise<void>
  listWikiPages(projectId: string): Promise<WikiPageMeta[]>
  getWikiPage(projectId: string, pageId: string): Promise<WikiPage>
  searchWiki(projectId: string, q: string): Promise<WikiPageMeta[]>
  saveWikiPage(projectId: string, pageId: string, body: string): Promise<void>
}

export type AppView = 'office' | 'board' | 'wiki' | 'workspace' | 'quiz'

export interface PersistedAppState {
  version: number
  view: AppView
  selectedAgentId: string | null
  activePageId: string | null
  reviewRunId: string | null
  workspaceFocusId?: string | null
  savedAt: number
}
