// ── QuizView: Daily Codebase & Wiki Quiz View ─────────────────────────────

import { useEffect, useState } from 'react'
import {
  GraduationCap,
  Flame,
  Settings,
  RotateCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle
} from 'lucide-react'
import clsx from 'clsx'
import { useQuiz, getTodayDateString } from '../lib/quiz/quiz-store'
import { QuizQuestionCard } from '../quiz/QuizQuestionCard'
import { QuizSummary } from '../quiz/QuizSummary'
import { QuizSettingsModal } from '../quiz/QuizSettingsModal'
import { uiTap } from '../lib/sfx'

function formatTurkishDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return dateStr
  }
}

export function QuizView() {
  const session = useQuiz((s) => s.session)
  const currentIndex = useQuiz((s) => s.currentIndex)
  const loading = useQuiz((s) => s.loading)
  const error = useQuiz((s) => s.error)
  const stats = useQuiz((s) => s.stats)
  const initTodaySession = useQuiz((s) => s.initTodaySession)
  const regenerateTodaySession = useQuiz((s) => s.regenerateTodaySession)
  const answerQuestion = useQuiz((s) => s.answerQuestion)
  const nextQuestion = useQuiz((s) => s.nextQuestion)
  const prevQuestion = useQuiz((s) => s.prevQuestion)
  const setSettingsOpen = useQuiz((s) => s.setSettingsOpen)

  const [reviewSummary, setReviewSummary] = useState(false)

  // Initialize today's session on mount
  useEffect(() => {
    void initTodaySession()
  }, [initTodaySession])

  const total = session?.questions.length ?? 20
  const answeredCount = session ? Object.keys(session.answers).length : 0
  const progressPercent = total > 0 ? (answeredCount / total) * 100 : 0
  const currentQuestion = session?.questions[currentIndex]
  const currentAnswer = session?.answers[currentIndex]

  // Keyboard navigation: 1-4 for options, Enter/Space for next, Arrows for navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key >= '1' && e.key <= '4') {
        const optIdx = parseInt(e.key, 10) - 1
        if (currentAnswer === undefined) {
          answerQuestion(optIdx)
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (currentAnswer !== undefined) {
          e.preventDefault()
          nextQuestion()
        }
      } else if (e.key === 'ArrowLeft') {
        prevQuestion()
      } else if (e.key === 'ArrowRight') {
        nextQuestion()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answerQuestion, currentAnswer, nextQuestion, prevQuestion])

  return (
    <div className="flex h-full flex-col bg-canvas select-none overflow-hidden">
      {/* ── Top Bar ── */}
      <header className="chrome-bar flex h-11 shrink-0 items-center justify-between gap-4 px-3">
        {/* Title & Date */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(245,165,36,0.22)] bg-accent-subtle text-accent shadow-[inset_0_1px_0_rgba(255,220,160,0.08)]">
            <GraduationCap size={14} strokeWidth={1.8} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12.5px] leading-[16px] font-semibold tracking-[-0.01em] text-t1">
              Günlük Kod Tabanı Quiz'i
            </span>
            <span className="tnum truncate text-[10.5px] leading-[14px] text-t4">
              {formatTurkishDate(getTodayDateString())} · {total} Soru
            </span>
          </div>
        </div>

        {/* Center Progress Strip */}
        <div className="hidden w-64 flex-col items-center gap-1.5 md:flex">
          <div className="tnum flex w-full items-center justify-between text-[10.5px] leading-none text-t3">
            <span>
              İlerleme <span className="font-medium text-t2">{answeredCount}</span>
              <span className="text-t4"> / {total}</span>
            </span>
            <span className="font-medium text-t2">%{Math.round(progressPercent)}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-n1 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#d9850b] to-accent shadow-[0_0_8px_rgba(245,165,36,0.45)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Right Tools: Streak & Settings */}
        <div className="flex items-center gap-1.5">
          {/* Streak Badge */}
          <div
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-n1/60 px-2.5 text-[12px] font-medium text-t2"
            title={`${stats.streak} gün üst üste quiz tamamlandı`}
          >
            <Flame size={13} className="fill-accent/80 text-accent" />
            <span className="tnum">{stats.streak} Gün</span>
          </div>

          {/* Regenerate Button */}
          <button
            type="button"
            onClick={() => {
              uiTap()
              void regenerateTodaySession()
            }}
            disabled={loading}
            title="Soruları yeniden üret"
            className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:opacity-50"
          >
            <RotateCcw size={12} className={clsx(loading && 'animate-spin')} />
            <span className="hidden sm:inline">Yeni Set</span>
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={() => {
              uiTap()
              setSettingsOpen(true)
            }}
            title="Model ve API Ayarları"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <Settings size={14} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* ── Error Banner (if any) ── */}
      {error && (
        <div className="flex items-center gap-2 border-b border-[rgba(242,85,90,0.18)] bg-[var(--color-needs)]/8 px-4 py-2 text-[12px] text-[var(--color-needs)]">
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* ── Main Stage ── */}
      <main className="dot-canvas scroll-thin flex min-h-0 flex-1 flex-col items-center justify-start overflow-y-auto p-4 sm:p-8">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-t3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-raised shadow-[var(--shadow-card)]">
              <Loader2 size={18} className="animate-spin text-accent" />
            </span>
            <p className="text-[12px]">Günün soruları hazırlanıyor…</p>
          </div>
        ) : session?.completed && (reviewSummary || answeredCount === total && currentIndex === total - 1 && currentAnswer !== undefined) ? (
          <QuizSummary session={session} />
        ) : currentQuestion ? (
          <div className="w-full flex flex-col items-center gap-4">
            <QuizQuestionCard
              question={currentQuestion}
              index={currentIndex}
              total={total}
              selectedAnswer={currentAnswer}
            />

            {/* Bottom Question Pager Controls */}
            <div className="flex w-full max-w-2xl items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-n2/80 p-1 shadow-[var(--shadow-card)] backdrop-blur-sm">
              <button
                type="button"
                onClick={() => {
                  uiTap()
                  prevQuestion()
                }}
                disabled={currentIndex === 0}
                className="flex h-7 items-center gap-1 rounded-lg pr-2.5 pl-1.5 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft size={13} />
                <span>Önceki</span>
              </button>

              {/* Quick Dots / Pager */}
              <div className="flex max-w-[340px] items-center gap-1 overflow-x-auto px-2 py-1.5">
                {session?.questions.map((q, idx) => {
                  const ans = session.answers[idx]
                  const isCurrent = idx === currentIndex
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => useQuiz.getState().jumpToQuestion(idx)}
                      className={clsx(
                        'h-1.5 shrink-0 rounded-full transition-all duration-200',
                        isCurrent ? 'w-5 bg-accent shadow-[0_0_6px_rgba(245,165,36,0.5)]' : 'w-1.5',
                        ans !== undefined
                          ? ans === q.correctIndex
                            ? 'bg-[var(--color-done)]'
                            : 'bg-[var(--color-needs)]'
                          : !isCurrent && 'bg-n6 hover:bg-n8'
                      )}
                      title={`Soru ${idx + 1}`}
                    />
                  )
                })}
              </div>

              <div className="flex items-center gap-1">
                {session?.completed && (
                  <button
                    type="button"
                    onClick={() => {
                      uiTap()
                      setReviewSummary(true)
                    }}
                    className="btn-accent-soft flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium"
                  >
                    <span>Özet</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    uiTap()
                    nextQuestion()
                  }}
                  disabled={currentIndex >= total - 1}
                  className="flex h-7 items-center gap-1 rounded-lg pr-1.5 pl-2.5 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-30"
                >
                  <span>Sonraki</span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {/* ── Settings Modal ── */}
      <QuizSettingsModal />
    </div>
  )
}

export default QuizView
