// ── Quiz Zustand Store & Persistence ───────────────────────────────────────

import { create } from 'zustand'
import type {
  DailyQuizSession,
  QuizPreset,
  QuizQuestion,
  QuizSettings,
  QuizStats
} from '@shared/quiz'
import { createQuizProvider } from './llm-provider'
import { getDailyQuestions } from './builtin-bank'
import { useApp } from '../store'

const SETTINGS_KEY = 'terrarium.quiz.settings'
const STATS_KEY = 'terrarium.quiz.stats'
const SESSION_PREFIX = 'terrarium.quiz.session.'
const PRESETS_KEY = 'terrarium.quiz.presets'
const ACTIVE_PRESET_KEY = 'terrarium.quiz.activePreset'

export function getTodayDateString(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getYesterdayDateString(): string {
  const now = new Date()
  now.setDate(now.getDate() - 1)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function loadSettings(): QuizSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { provider: 'builtin', dailyQuestionCount: 20 }
    return { provider: 'builtin', dailyQuestionCount: 20, ...JSON.parse(raw) }
  } catch {
    return { provider: 'builtin', dailyQuestionCount: 20 }
  }
}

function loadStats(): QuizStats {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) {
      return {
        streak: 0,
        totalQuizzesTaken: 0,
        totalCorrectAnswers: 0,
        totalQuestionsAnswered: 0,
        history: {}
      }
    }
    return JSON.parse(raw)
  } catch {
    return {
      streak: 0,
      totalQuizzesTaken: 0,
      totalCorrectAnswers: 0,
      totalQuestionsAnswered: 0,
      history: {}
    }
  }
}

function loadSavedSession(dateStr: string): DailyQuizSession | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + dateStr)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveSession(session: DailyQuizSession): void {
  try {
    localStorage.setItem(SESSION_PREFIX + session.date, JSON.stringify(session))
  } catch {
    /* ignore */
  }
}

function saveStats(stats: QuizStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  } catch {
    /* ignore */
  }
}

function saveSettings(settings: QuizSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

// ── named AI presets ("sets") ────────────────────────────────────────────
// Each preset is a full provider config. Activating one copies its fields
// into the live QuizSettings — the quiz's "Yeni Set" button then generates
// with that provider. Both are plain localStorage, same as the settings.

function loadPresets(): QuizPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is QuizPreset =>
        !!p && typeof p === 'object' && typeof (p as QuizPreset).id === 'string'
    )
  } catch {
    return []
  }
}

function savePresets(presets: QuizPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    /* ignore */
  }
}

function loadActivePresetId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PRESET_KEY)
  } catch {
    return null
  }
}

function saveActivePresetId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_PRESET_KEY, id)
    else localStorage.removeItem(ACTIVE_PRESET_KEY)
  } catch {
    /* ignore */
  }
}

let presetSeq = 0
const presetId = () => `set-${Date.now().toString(36)}-${(presetSeq++).toString(36)}`

interface QuizState {
  session: DailyQuizSession | null
  currentIndex: number
  loading: boolean
  error: string | null
  settings: QuizSettings
  stats: QuizStats
  settingsOpen: boolean
  /** Saved AI configurations ("sets") — see QuizPreset. */
  presets: QuizPreset[]
  /** The preset currently driving `settings`; null = ad-hoc/edited config. */
  activePresetId: string | null

  // Actions
  initTodaySession: () => Promise<void>
  regenerateTodaySession: () => Promise<void>
  answerQuestion: (optionIndex: number) => void
  nextQuestion: () => void
  prevQuestion: () => void
  jumpToQuestion: (index: number) => void
  setSettingsOpen: (open: boolean) => void
  updateSettings: (patch: Partial<QuizSettings>) => void
  /** Insert or update a preset, then make it the active one. */
  savePreset: (preset: Omit<QuizPreset, 'id'> & { id?: string }) => QuizPreset
  /** Point the quiz at a saved preset — copies its fields into settings. */
  activatePreset: (id: string) => void
  deletePreset: (id: string) => void
}

export const useQuiz = create<QuizState>((set, get) => ({
  session: null,
  currentIndex: 0,
  loading: false,
  error: null,
  settings: loadSettings(),
  stats: loadStats(),
  settingsOpen: false,
  presets: loadPresets(),
  activePresetId: loadActivePresetId(),

  initTodaySession: async () => {
    const today = getTodayDateString()
    const saved = loadSavedSession(today)
    if (saved && saved.questions.length >= 20) {
      // resume session
      set({ session: saved, loading: false, error: null })
      return
    }

    await get().regenerateTodaySession()
  },

  regenerateTodaySession: async () => {
    const today = getTodayDateString()
    const settings = get().settings
    const wikiPages = useApp.getState().wikiPages
    const provider = createQuizProvider(settings)

    set({ loading: true, error: null })

    try {
      let questions: QuizQuestion[]
      if (settings.provider === 'builtin') {
        questions = getDailyQuestions(today, wikiPages, settings.dailyQuestionCount || 20)
      } else {
        questions = await provider.generateQuestions({
          dateStr: today,
          wikiPages,
          count: settings.dailyQuestionCount || 20
        })
      }

      const session: DailyQuizSession = {
        date: today,
        questions,
        answers: {},
        completed: false,
        score: 0,
        startedAt: Date.now()
      }

      saveSession(session)
      set({ session, currentIndex: 0, loading: false, error: null })
    } catch (err) {
      console.warn('[Quiz] Failed to generate with provider, falling back to builtin:', err)
      const fallbackQuestions = getDailyQuestions(today, wikiPages, 20)
      const session: DailyQuizSession = {
        date: today,
        questions: fallbackQuestions,
        answers: {},
        completed: false,
        score: 0,
        startedAt: Date.now()
      }
      saveSession(session)
      set({
        session,
        currentIndex: 0,
        loading: false,
        error: err instanceof Error ? err.message : 'Model bağlantısı kurulamadı, dahili soru seti yüklendi.'
      })
    }
  },

  answerQuestion: (optionIndex: number) => {
    const { session, currentIndex, stats } = get()
    if (!session || session.answers[currentIndex] !== undefined) return

    const question = session.questions[currentIndex]
    if (!question) return

    const isCorrect = optionIndex === question.correctIndex
    const nextAnswers = { ...session.answers, [currentIndex]: optionIndex }
    const answeredCount = Object.keys(nextAnswers).length
    const totalQuestions = session.questions.length
    const isCompleted = answeredCount === totalQuestions

    let nextScore = session.score
    if (isCorrect) nextScore++

    const updatedSession: DailyQuizSession = {
      ...session,
      answers: nextAnswers,
      score: nextScore,
      completed: isCompleted,
      completedAt: isCompleted ? Date.now() : session.completedAt
    }

    saveSession(updatedSession)

    // If finished, update stats & streak
    let updatedStats = stats
    if (isCompleted) {
      const today = session.date
      const yesterday = getYesterdayDateString()
      const isConsecutive = stats.lastCompletedDate === yesterday
      const alreadyToday = stats.lastCompletedDate === today

      const nextStreak = alreadyToday
        ? stats.streak
        : isConsecutive
          ? stats.streak + 1
          : 1

      updatedStats = {
        streak: nextStreak,
        lastCompletedDate: today,
        totalQuizzesTaken: stats.totalQuizzesTaken + 1,
        totalCorrectAnswers: stats.totalCorrectAnswers + nextScore,
        totalQuestionsAnswered: stats.totalQuestionsAnswered + totalQuestions,
        history: {
          ...stats.history,
          [today]: {
            date: today,
            score: nextScore,
            total: totalQuestions,
            completedAt: Date.now()
          }
        }
      }
      saveStats(updatedStats)
    }

    set({ session: updatedSession, stats: updatedStats })
  },

  nextQuestion: () => {
    const { session, currentIndex } = get()
    if (!session) return
    if (currentIndex < session.questions.length - 1) {
      set({ currentIndex: currentIndex + 1 })
    }
  },

  prevQuestion: () => {
    const { currentIndex } = get()
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 })
    }
  },

  jumpToQuestion: (index: number) => {
    const { session } = get()
    if (!session || index < 0 || index >= session.questions.length) return
    set({ currentIndex: index })
  },

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),

  updateSettings: (patch: Partial<QuizSettings>) => {
    const prev = get().settings
    const next = { ...prev, ...patch }
    saveSettings(next)
    // touching provider fields by hand detaches the active preset — the
    // config no longer matches the named set it came from
    const providerFieldsChanged =
      patch.provider !== undefined ||
      patch.apiKey !== undefined ||
      patch.apiEndpoint !== undefined ||
      patch.model !== undefined
    set({ settings: next, ...(providerFieldsChanged ? { activePresetId: null } : {}) })
    if (providerFieldsChanged) saveActivePresetId(null)
  },

  savePreset: (input) => {
    const preset: QuizPreset = { ...input, id: input.id ?? presetId() }
    const presets = get().presets.some((p) => p.id === preset.id)
      ? get().presets.map((p) => (p.id === preset.id ? preset : p))
      : [...get().presets, preset]
    savePresets(presets)
    set({ presets })
    get().activatePreset(preset.id)
    return preset
  },

  activatePreset: (id) => {
    const preset = get().presets.find((p) => p.id === id)
    if (!preset) return
    const next: QuizSettings = {
      ...get().settings,
      provider: preset.provider,
      apiKey: preset.apiKey,
      apiEndpoint: preset.apiEndpoint,
      model: preset.model
    }
    saveSettings(next)
    saveActivePresetId(id)
    set({ settings: next, activePresetId: id })
  },

  deletePreset: (id) => {
    const presets = get().presets.filter((p) => p.id !== id)
    savePresets(presets)
    if (get().activePresetId === id) {
      saveActivePresetId(null)
      set({ presets, activePresetId: null })
    } else {
      set({ presets })
    }
  }
}))

export const useQuizStore = useQuiz
