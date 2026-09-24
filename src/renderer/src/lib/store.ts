import { create } from 'zustand'
import type { Agent, EngineState, OfficeEvent, PersistedAppState, WikiPageMeta } from '@shared/types'
import { getEngine } from './ipc'
import { alertSoft, cardMove, doneChime, errorSoft } from './sfx'
import {
  addCategory as persistAddCategory,
  listCategories,
  listHidden,
  removeCategory as persistRemoveCategory,
  setHidden
} from './categories'

function soundForEvent(e: OfficeEvent) {
  switch (e.kind) {
    case 'card.move':
      cardMove()
      break
    case 'run.done':
      doneChime()
      break
    case 'run.waiting':
      alertSoft()
      break
    case 'system':
      if (/fail|error/i.test(e.text)) errorSoft()
      break
  }
}

export type View = 'office' | 'board' | 'wiki' | 'workspace' | 'quiz'

export const APP_STATE_KEY = 'terrarium.app_state'
export const APP_STATE_VERSION = 1

export function loadPersistedState(): Partial<PersistedAppState> {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<PersistedAppState>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function persistAppState(): void {
  try {
    const state = useApp.getState()
    const focusId = localStorage.getItem('terrarium.workspace.focus')
    const payload: PersistedAppState = {
      version: APP_STATE_VERSION,
      view: state.view,
      selectedAgentId: state.selectedAgentId,
      activePageId: state.activePageId,
      reviewRunId: state.reviewRunId,
      workspaceFocusId: focusId,
      savedAt: Date.now()
    }
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload))
    window.dispatchEvent(new CustomEvent('terrarium:save-state'))
  } catch {
    /* storage unavailable / private browsing - non-fatal */
  }
}

const VALID_VIEWS: readonly View[] = ['office', 'board', 'wiki', 'workspace', 'quiz']

interface AppStore extends EngineState {
  ready: boolean
  view: View
  setView: (v: View) => void
  paletteOpen: boolean
  setPaletteOpen: (o: boolean) => void
  selectedAgentId: string | null
  selectAgent: (id: string | null) => void
  /** When set, the workspace view should open a terminal/thread for this agent. */
  focusAgentId: string | null
  /** Which pane kind `focusAgentId` should spawn ('terminal' | 'chat'). */
  focusPaneKind: 'terminal' | 'chat'
  openAgentTerminal: (id: string) => void
  openAgentChat: (id: string) => void
  /** Bumped to tell the board to focus its new-card input. */
  newCardNonce: number
  requestNewCard: () => void
  /** Run id open in the review overlay, if any. */
  reviewRunId: string | null
  openReview: (runId: string | null) => void
  /** When on, leaving the office tab keeps the scene alive in a floating
   * mini player instead of hiding it. */
  officePiP: boolean
  setOfficePiP: (v: boolean) => void
  /** User-created pane categories — registry order drives rail grouping. */
  categories: string[]
  /** Rail group keys currently hidden from the pane grid. */
  hiddenCategories: string[]
  addCategory: (name: string) => void
  removeCategory: (name: string) => void
  toggleCategoryHidden: (name: string) => void
  /** Manage-crew modal. */
  crewOpen: boolean
  setCrewOpen: (o: boolean) => void
  /** App settings modal (quiz AI presets etc.). */
  settingsOpen: boolean
  setSettingsOpen: (o: boolean) => void
  wikiPages: WikiPageMeta[]
  activePageId: string | null
  setActivePage: (id: string | null) => void
  saveState: () => void
  init: () => Promise<void>
}

const initialSaved = loadPersistedState()
const initialView: View =
  initialSaved.view && VALID_VIEWS.includes(initialSaved.view as View)
    ? (initialSaved.view as View)
    : 'office'

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  view: initialView,
  paletteOpen: false,
  selectedAgentId: initialSaved.selectedAgentId ?? null,
  focusAgentId: null,
  focusPaneKind: 'terminal' as const,
  newCardNonce: 0,
  reviewRunId: initialSaved.reviewRunId ?? null,
  crewOpen: false,
  settingsOpen: false,
  wikiPages: [],
  activePageId: initialSaved.activePageId ?? 'wp-home',
  agents: [],
  cards: [],
  runs: [],
  projects: [],
  events: [],

  setView: (view) => {
    set({ view })
    persistAppState()
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  selectAgent: (selectedAgentId) => {
    set({ selectedAgentId })
    persistAppState()
  },
  openAgentTerminal: (id) => {
    set({ focusAgentId: id, focusPaneKind: 'terminal', selectedAgentId: id, view: 'workspace' })
    persistAppState()
  },
  openAgentChat: (id) => {
    set({ focusAgentId: id, focusPaneKind: 'chat', selectedAgentId: id, view: 'workspace' })
    persistAppState()
  },
  requestNewCard: () => {
    set({ view: 'board', newCardNonce: Date.now() })
    persistAppState()
  },
  openReview: (reviewRunId) => {
    set({ reviewRunId })
    persistAppState()
  },
  officePiP: localStorage.getItem('terrarium.office.pip') !== 'false', // default on
  setOfficePiP: (officePiP) => {
    set({ officePiP })
    try {
      localStorage.setItem('terrarium.office.pip', String(officePiP))
    } catch {
      /* storage unavailable - non-fatal */
    }
  },
  // categories persist through lib/categories.ts (own keys, not app_state)
  categories: listCategories(),
  hiddenCategories: listHidden(),
  addCategory: (name) => set({ categories: persistAddCategory(name) }),
  removeCategory: (name) => {
    // module removal also drops it from the hidden set + session memory
    set({ categories: persistRemoveCategory(name), hiddenCategories: listHidden() })
  },
  toggleCategoryHidden: (name) => {
    set({ hiddenCategories: setHidden(name, !get().hiddenCategories.includes(name)) })
  },
  setCrewOpen: (crewOpen) => set({ crewOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setActivePage: (activePageId) => {
    set({ activePageId })
    persistAppState()
  },
  saveState: () => {
    persistAppState()
  },

  async init() {
    const engine = getEngine()
    const state = await engine.getState()
    const currentSelected = get().selectedAgentId
    const validSelected =
      currentSelected && state.agents.some((a) => a.id === currentSelected) ? currentSelected : null
    set({ ...state, selectedAgentId: validSelected, ready: true })
    window.addEventListener('beforeunload', persistAppState)
    let lastEventId = state.events[0]?.id
    engine.subscribe((s) => {
      // play a sound for each new event since the last snapshot
      if (lastEventId) {
        const idx = s.events.findIndex((e) => e.id === lastEventId)
        const fresh = idx === -1 ? s.events : s.events.slice(0, idx)
        fresh.forEach(soundForEvent)
      }
      lastEventId = s.events[0]?.id
      set(s)
    })
    const pages = await engine.listWikiPages('proj-terrarium')
    set({ wikiPages: pages })
    // vault changes on disk → refresh the page list
    window.terrarium?.onWikiChanged?.(async (e) => {
      const fresh = await engine.listWikiPages(e.projectId)
      set({ wikiPages: fresh })
    })
    // crew modal drafts → real persistence (upsert carries a full Agent)
    window.addEventListener('terrarium:crew-draft', (e) => {
      const d = (e as CustomEvent).detail as
        | { intent: 'upsert' | 'remove'; agent: EngineState['agents'][number] }
        | undefined
      if (!d?.agent) return
      if (d.intent === 'upsert') void engine.upsertAgent(d.agent)
      else void engine.removeAgent(d.agent.id)
    })
    // onboarding finish → replace/seed the crew from the wizard's drafts
    window.addEventListener('terrarium:onboarded', (e) => {
      const cfg = (e as CustomEvent).detail as
        | { crew?: Array<{ name: string; role: Agent['role']; domain?: Agent['domain']; brief?: string; hue?: number }> }
        | undefined
      cfg?.crew?.forEach((c, i) => {
        void engine.upsertAgent({
          id: `ag-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: c.name,
          role: c.role,
          domain: c.domain ?? 'general',
          brief: c.brief ?? '',
          status: 'idle',
          deskId: `desk-${i}`,
          taskId: null,
          hue: c.hue ?? (i * 47) % 360,
          lastActiveAt: Date.now()
        })
      })
    })
  }
}))
