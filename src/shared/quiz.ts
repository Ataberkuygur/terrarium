// ── Quiz Types & Domain Models ─────────────────────────────────────────────

export type QuizCategory =
  | 'architecture'
  | 'process_model'
  | 'engine_sqlite'
  | 'pty_terminal'
  | 'workspace_panes'
  | 'office_3d'
  | 'voice_cuda'
  | 'git_worktrees'
  | 'wiki_docs'

export interface QuizQuestion {
  id: string
  category: QuizCategory
  categoryLabel: string
  sourceTitle: string
  question: string
  codeSnippet?: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanation: string
  wikiPageId?: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
}

export interface DailyQuizSession {
  date: string // YYYY-MM-DD
  questions: QuizQuestion[]
  answers: Record<number, number> // questionIndex -> chosen option index
  completed: boolean
  score: number
  startedAt: number
  completedAt?: number
}

export type LLMProviderType =
  | 'builtin'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'custom'

export interface QuizSettings {
  provider: LLMProviderType
  apiKey?: string
  apiEndpoint?: string
  model?: string
  dailyQuestionCount: number
}

/**
 * A named, saved AI configuration — a "set". Activating a preset copies its
 * fields into QuizSettings; the quiz's "Yeni Set" (regenerate) then uses it.
 */
export interface QuizPreset {
  id: string
  name: string
  provider: LLMProviderType
  apiKey?: string
  apiEndpoint?: string
  model?: string
}

export interface QuizDayRecord {
  date: string
  score: number
  total: number
  completedAt: number
}

export interface QuizStats {
  streak: number
  lastCompletedDate?: string
  totalQuizzesTaken: number
  totalCorrectAnswers: number
  totalQuestionsAnswered: number
  history: Record<string, QuizDayRecord>
}
