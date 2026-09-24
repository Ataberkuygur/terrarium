import type {
  Engine,
  EngineState,
  OfficeEvent,
  TaskCard,
  CardStatus,
  WikiPage,
  WikiPageMeta,
  AgentStatus
} from '@shared/types'
import { DEMO_AGENTS, DEMO_CARDS, DEMO_PROJECT, DEMO_RUNS, DEMO_WIKI } from './seed'

let seq = 0
const eid = () => `ev-${Date.now().toString(36)}-${seq++}`

const FLAVOR: { kind: OfficeEvent['kind']; text: (a: string) => string }[] = [
  { kind: 'run.log', text: (a) => `${a} edited src/renderer/src/App.tsx` },
  { kind: 'run.log', text: (a) => `${a} ran pnpm typecheck — clean` },
  { kind: 'run.log', text: (a) => `${a} read docs/architecture.md` },
  { kind: 'run.log', text: (a) => `${a} committed on agent/${a.toLowerCase()}-wip` },
  { kind: 'run.log', text: (a) => `${a} opened a diff for review` },
  { kind: 'run.log', text: (a) => `${a} queried the wiki index` },
  { kind: 'system', text: () => 'Worktree reconciler: 2 active, 0 stale' },
  { kind: 'system', text: () => 'FTS index: 6 docs refreshed' }
]

/** Simulated live office — stands in for the Electron main engine. */
export function createMockEngine(): Engine {
  const state: EngineState = {
    agents: structuredClone(DEMO_AGENTS),
    cards: structuredClone(DEMO_CARDS),
    runs: structuredClone(DEMO_RUNS),
    projects: [structuredClone(DEMO_PROJECT)],
    events: [
      {
        id: eid(),
        ts: Date.now() - 5000,
        kind: 'system',
        text: 'Terrarium engine online — mock mode'
      }
    ]
  }
  const wiki = new Map<string, WikiPage>(DEMO_WIKI.map((p) => [p.id, structuredClone(p)]))
  const subs = new Set<(s: EngineState) => void>()

  const push = (partial: Partial<EngineState>, evs: Omit<OfficeEvent, 'id' | 'ts'>[] = []) => {
    Object.assign(state, partial)
    if (evs.length) {
      const fresh = evs.map((ev) => ({ id: eid(), ts: Date.now(), ...ev }))
      state.events = [...fresh, ...state.events].slice(0, 200)
    }
    // Shallow snapshot: unchanged slices keep identity so memoized
    // subscribers (OfficeScene, board columns) can bail out cheaply.
    subs.forEach((cb) => cb({ ...state }))
  }

  const SLEEP_AFTER = 90_000

  // ambient simulation
  const tick = () => {
    // no crew → nothing to simulate (empty roster is a real state now)
    if (state.agents.length === 0) return
    const flavor = FLAVOR[Math.floor(Math.random() * FLAVOR.length)]
    const agent = state.agents[Math.floor(Math.random() * state.agents.length)]
    const evs: Omit<OfficeEvent, 'id' | 'ts'>[] = [
      { kind: flavor.kind, text: flavor.text(agent.name), agentId: agent.id }
    ]

    // activity wakes the acting agent; quiet idlers drift to sleep
    const nowMs = Date.now()
    state.agents = state.agents.map((a) => {
      const awake = a.id === agent.id
      const sleeping = a.status === 'idle' && !awake && nowMs - a.lastActiveAt > SLEEP_AFTER
      if (awake && (a.sleeping || nowMs - a.lastActiveAt > 4000)) {
        return { ...a, lastActiveAt: nowMs, sleeping: false }
      }
      if (sleeping !== !!a.sleeping) return { ...a, sleeping }
      return a
    })

    // occasionally flip an idle/working agent or finish a waiting run
    if (Math.random() < 0.25) {
      const target = state.agents[Math.floor(Math.random() * state.agents.length)]
      const next: AgentStatus =
        target.status === 'working' ? 'idle' : target.status === 'idle' ? 'working' : target.status
      if (next !== target.status) {
        state.agents = state.agents.map((a) =>
          a.id === target.id ? { ...a, status: next, lastActiveAt: Date.now() } : a
        )
        evs.push({
          kind: 'agent.status',
          text: `${target.name} → ${next}`,
          agentId: target.id
        })
      }
    }
    push(state, evs)
  }
  const timer = setInterval(tick, 4000)

  return {
    async getState() {
      return structuredClone(state)
    },
    subscribe(cb) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
        if (subs.size === 0) clearInterval(timer)
      }
    },
    async createCard(input) {
      const card: TaskCard = {
        id: `card-${Date.now().toString(36)}`,
        title: input.title,
        body: input.body ?? '',
        status: 'backlog',
        assigneeId: null,
        projectId: input.projectId,
        priority: 0,
        dueAt: input.dueAt ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      push({ cards: [card, ...state.cards] }, [{ kind: 'card.move', text: `New card: ${card.title}` }])
      return structuredClone(card)
    },
    async assignCard(cardId, agentId) {
      const agent = state.agents.find((a) => a.id === agentId)
      state.cards = state.cards.map((c) =>
        c.id === cardId ? { ...c, assigneeId: agentId, status: 'doing' as CardStatus } : c
      )
      state.agents = state.agents.map((a) =>
        a.id === agentId ? { ...a, status: 'working' as AgentStatus, taskId: cardId } : a
      )
      push(state, [
        {
          kind: 'card.move',
          text: `${agent?.name ?? 'Agent'} picked up a card`,
          agentId,
          cardId
        }
      ])
    },
    async moveCard(cardId, status) {
      state.cards = state.cards.map((c) =>
        c.id === cardId ? { ...c, status, updatedAt: Date.now() } : c
      )
      push(state, [{ kind: 'card.move', text: `Card → ${status}`, cardId }])
    },
    async updateCard(cardId, patch) {
      state.cards = state.cards.map((c) =>
        c.id === cardId ? { ...c, ...patch, updatedAt: Date.now() } : c
      )
      push(state, [])
    },
    async deleteCard(cardId) {
      const card = state.cards.find((c) => c.id === cardId)
      state.cards = state.cards.filter((c) => c.id !== cardId)
      state.runs = state.runs.filter((r) => r.cardId !== cardId)
      state.agents = state.agents.map((a) =>
        a.taskId === cardId ? { ...a, taskId: null, status: 'idle' as AgentStatus } : a
      )
      push(state, [{ kind: 'card.move', text: `Card deleted — "${card?.title ?? cardId}"`, cardId }])
    },
    async nudgeAgent(agentId, message) {
      const agent = state.agents.find((a) => a.id === agentId)
      if (agent?.status === 'waiting') {
        state.agents = state.agents.map((a) =>
          a.id === agentId ? { ...a, status: 'working' } : a
        )
      }
      push(state, [
        {
          kind: 'run.log',
          text: `You → ${agent?.name}: ${message}`,
          agentId
        }
      ])
    },
    async touchAgent(agentId) {
      const nowMs = Date.now()
      state.agents = state.agents.map((a) =>
        a.id === agentId ? { ...a, lastActiveAt: nowMs, sleeping: false } : a
      )
      push(state, [])
    },
    async upsertAgent(agent) {
      const exists = state.agents.some((a) => a.id === agent.id)
      state.agents = exists
        ? state.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a))
        : [...state.agents, agent]
      push(state, [
        { kind: 'system', text: `${agent.name} ${exists ? 'updated' : 'joined the crew'}`, agentId: agent.id }
      ])
    },
    async removeAgent(agentId) {
      const agent = state.agents.find((a) => a.id === agentId)
      state.agents = state.agents.filter((a) => a.id !== agentId)
      state.cards = state.cards.map((c) =>
        c.assigneeId === agentId ? { ...c, assigneeId: null } : c
      )
      push(state, [{ kind: 'system', text: `${agent?.name ?? 'Agent'} left the crew` }])
    },
    async listWikiPages() {
      const metas: WikiPageMeta[] = [...wiki.values()].map(({ body: _b, backlinks: _l, ...m }) => m)
      return metas
    },
    async getWikiPage(_p, pageId) {
      const page = wiki.get(pageId)
      if (!page) throw new Error(`no page ${pageId}`)
      return structuredClone(page)
    },
    async saveWikiPage(_p, pageId, body) {
      const page = wiki.get(pageId)
      if (!page) throw new Error(`no page ${pageId}`)
      const links = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim())
      wiki.set(pageId, { ...page, body, links, updatedAt: Date.now() })
    },
    async searchWiki(_p, q) {
      const needle = q.toLowerCase()
      return [...wiki.values()]
        .filter((p) => p.title.toLowerCase().includes(needle) || p.body.toLowerCase().includes(needle))
        .map(({ body: _b, backlinks: _l, ...m }) => m)
    }
  }
}
