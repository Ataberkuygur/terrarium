// ── Jev (TypeSafe AI "System One") — typed decision primitives ──────
// Jev never generates text. A request carries one `state` plus a map of
// typed `questions`; every question is evaluated in parallel against a
// shared read of that state and returns one typed answer under the same
// id. Schema-invalid output is structurally impossible — the only
// failure mode is a wrong answer, so every consumer keeps a non-Jev
// fallback (the classifier falls back to keyword heuristics).

export const JEV_IPC = {
  /** invoke: (req: JevRequest) → JevResult | null */
  DECIDE: 'terrarium:jev:decide',
  /** invoke: () → JevKeyStatus — never returns the key itself */
  KEY_STATUS: 'terrarium:jev:key-status',
  /** invoke: (key: string) → JevKeyStatus — '' removes the saved key */
  KEY_SET: 'terrarium:jev:key-set',
  /** invoke: () → { ok: boolean; status?: number; error?: string } */
  KEY_TEST: 'terrarium:jev:key-test'
} as const

/** Settings view of the Jev key: where it comes from + a masked tail. */
export interface JevKeyStatus {
  configured: boolean
  /** 'env' = TYPESAFE_API_KEY environment variable (overrides the file) */
  source: 'env' | 'file' | null
  /** e.g. '••••a1b2' */
  masked: string | null
  /** false when JEV_ENABLED=0 switches Jev off */
  enabled: boolean
}

// ── questions (request side) ──

export interface JevNoulQuestion {
  type: 'noul'
  /** The yes/no question to evaluate. */
  instructions: string | object | unknown[]
  criteria?: {
    /** What a yes (value near 1) means. */
    true?: string
    /** What a no (value near 0) means. */
    false?: string
  }
}

export interface JevChoiceQuestion {
  type: 'choice'
  /** What the model should decide. */
  instructions: string | object | unknown[]
  /**
   * Map of option key → rubric description (null when the option needs no
   * detail). TypeSafe caps options at 255 per question.
   */
  criteria: Record<string, string | null>
}

export interface JevScoreQuestion {
  type: 'score'
  /** What the model should rate. */
  instructions: string | object | unknown[]
  /** Ordered level descriptions; at least two required. */
  criteria: string[]
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion
export type JevQuestionMap = Record<string, JevQuestion>

// ── answers (response side) ──

export interface JevNoulAnswer {
  type: 'noul'
  /** Probability the answer is yes, 0–1. */
  noul: number
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  /** Certainty derived from the probability distribution, 0–1. */
  confidence: number
}

export interface JevScoreAnswer {
  type: 'score'
  /** Probability-weighted value across the levels; can land between levels. */
  score: number
  legend: Record<string, string>
  probabilities: Record<string, number>
  confidence: number
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer
export type JevAnswerMap = Record<string, JevAnswer>

export interface JevUsage {
  input_tokens: number
  output_tokens: number
}

// ── IPC payload ──

export interface JevRequest {
  state: string | object | unknown[]
  questions: JevQuestionMap
}

export interface JevResult {
  answers: JevAnswerMap
  usage: JevUsage
}

// ── type guards ──

export function isJevNoulAnswer(answer: JevAnswer | undefined): answer is JevNoulAnswer {
  return answer?.type === 'noul' && typeof (answer as JevNoulAnswer).noul === 'number'
}

export function isJevChoiceAnswer(answer: JevAnswer | undefined): answer is JevChoiceAnswer {
  return answer?.type === 'choice' && typeof (answer as JevChoiceAnswer).choice === 'string'
}

export function isJevScoreAnswer(answer: JevAnswer | undefined): answer is JevScoreAnswer {
  return answer?.type === 'score' && typeof (answer as JevScoreAnswer).score === 'number'
}
