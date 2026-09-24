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
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-n2 px-4">
        {/* Title & Date */}
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-base text-[var(--color-accent)]">
            <GraduationCap size={15} strokeWidth={1.8} />
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-t1 leading-tight">
              Günlük Kod Tabanı Quiz'i
            </span>
            <span className="text-[10.5px] text-t4">
              {formatTurkishDate(getTodayDateString())} · {total} Soru
            </span>
          </div>
        </div>

        {/* Center Progress Strip */}
        <div className="hidden md:flex flex-col items-center gap-1 w-64">
          <div className="flex items-center justify-between w-full text-[11px] font-mono text-t3">
            <span>İlerleme: {answeredCount} / {total}</span>
            <span>%{Math.round(progressPercent)}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-n3 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Right Tools: Streak & Settings */}
        <div className="flex items-center gap-2">
          {/* Streak Badge */}
          <div
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-base px-2.5 text-[11.5px] font-medium text-t2"
            title={`${stats.streak} gün üst üste quiz tamamlandı`}
          >
            <Flame size={13} className="text-amber-500 fill-amber-500" />
            <span className="font-mono">{stats.streak} Gün</span>
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
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-base px-2.5 text-[11.5px] text-t3 hover:text-t1 hover:bg-n3 disabled:opacity-50 transition-colors"
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
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-default)] bg-base text-t3 hover:text-t1 hover:bg-n3 transition-colors"
          >
            <Settings size={13} />
          </button>
        </div>
      </header>

      {/* ── Error Banner (if any) ── */}
      {error && (
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--color-needs)]/10 px-4 py-1.5 text-[11.5px] text-[var(--color-needs)]">
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* ── Main Stage ── */}
      <main className="flex-1 min-h-0 overflow-y-auto scroll-thin p-4 sm:p-6 flex flex-col justify-start items-center">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 h-64 text-t3">
            <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
            <p className="text-[13px]">Günün soruları hazırlanıyor...</p>
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
            <div className="flex items-center justify-between w-full max-w-2xl pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => {
                  uiTap()
                  prevQuestion()
                }}
                disabled={currentIndex === 0}
                className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] text-t3 hover:bg-n2 hover:text-t1 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft size={13} />
                <span>Önceki</span>
              </button>

              {/* Quick Dots / Pager */}
              <div className="flex items-center gap-1 overflow-x-auto max-w-[340px] px-2 py-1">
                {session?.questions.map((q, idx) => {
                  const ans = session.answers[idx]
                  const isCurrent = idx === currentIndex
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => useQuiz.getState().jumpToQuestion(idx)}
                      className={clsx(
                        'h-2 rounded-full transition-all',
                        isCurrent ? 'w-5 bg-[var(--color-accent)]' : 'w-2',
                        ans !== undefined
                          ? ans === q.correctIndex
                            ? 'bg-[var(--color-done)]'
                            : 'bg-[var(--color-needs)]'
                          : !isCurrent && 'bg-n4 hover:bg-n5'
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
                    className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-accent)] hover:bg-n2 transition-colors"
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
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] text-t3 hover:bg-n2 hover:text-t1 disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
