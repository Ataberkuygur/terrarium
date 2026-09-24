// ── QuizSummary: End of Quiz Score, Streak & Category Breakdown ─────────────

import { Trophy, Flame, RotateCcw, BookOpen, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react'
import type { DailyQuizSession } from '@shared/quiz'
import { useQuiz } from '../lib/quiz/quiz-store'
import { useApp } from '../lib/store'
import { uiTap } from '../lib/sfx'
import clsx from 'clsx'

export function QuizSummary({ session }: { session: DailyQuizSession }) {
  const jumpToQuestion = useQuiz((s) => s.jumpToQuestion)
  const regenerateTodaySession = useQuiz((s) => s.regenerateTodaySession)
  const stats = useQuiz((s) => s.stats)
  const setView = useApp((s) => s.setView)

  const total = session.questions.length
  const score = session.score
  const percent = total > 0 ? Math.round((score / total) * 100) : 0

  let grade = 'Harika Başlangıç'
  let gradeColor = 'text-[var(--color-info)]'
  if (percent >= 90) {
    grade = 'Kod Tabanı Ustası 🏆'
    gradeColor = 'text-[var(--color-done)]'
  } else if (percent >= 70) {
    grade = 'Çok İyi Kavrayış ⭐'
    gradeColor = 'text-[var(--color-accent)]'
  } else if (percent >= 50) {
    grade = 'Gelişmekte Olan Seviye 🚀'
    gradeColor = 'text-[var(--color-info)]'
  } else {
    grade = 'Tekrar Zamanı 📚'
    gradeColor = 'text-[var(--color-needs)]'
  }

  // Category breakdown
  const categoryStats: Record<string, { correct: number; total: number; label: string }> = {}
  session.questions.forEach((q, idx) => {
    if (!categoryStats[q.category]) {
      categoryStats[q.category] = { correct: 0, total: 0, label: q.categoryLabel }
    }
    categoryStats[q.category].total++
    if (session.answers[idx] === q.correctIndex) {
      categoryStats[q.category].correct++
    }
  })

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto py-2">
      {/* ── Score & Trophy Hero ── */}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-default)] bg-n2 p-6 text-center shadow-sm relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-done)] to-[var(--color-info)]" />

        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-base text-[var(--color-accent)] shadow-inner mb-3">
          <Trophy size={28} strokeWidth={1.75} />
        </div>

        <span className={clsx('text-[13px] font-bold uppercase tracking-wider', gradeColor)}>
          {grade}
        </span>

        <h1 className="mt-1 text-3xl font-extrabold text-t1 font-mono">
          {score} <span className="text-t4 text-xl">/ {total}</span>
        </h1>

        <p className="mt-1 text-[12.5px] text-t3">
          Başarı Oranı: <span className="font-semibold text-t1">%{percent}</span>
        </p>

        {/* Streak banner */}
        <div className="mt-4 flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-base px-3.5 py-1 text-[12px] font-medium text-t2 shadow-xs">
          <Flame size={14} className="text-amber-500 fill-amber-500" />
          <span>
            {stats.streak} Günlük Quiz Serisi!
          </span>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            uiTap()
            jumpToQuestion(0)
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-3.5 text-[12px] font-medium text-t2 hover:bg-n3 hover:text-t1 transition-colors"
        >
          <ArrowLeft size={13} />
          <span>Cevapları İncele</span>
        </button>

        <button
          type="button"
          onClick={() => {
            uiTap()
            void regenerateTodaySession()
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 text-[12px] font-medium text-black hover:opacity-90 transition-transform active:scale-95"
        >
          <RotateCcw size={13} />
          <span>Yeni Set Çöz</span>
        </button>

        <button
          type="button"
          onClick={() => {
            uiTap()
            setView('wiki')
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-3.5 text-[12px] font-medium text-t2 hover:bg-n3 hover:text-t1 transition-colors"
        >
          <BookOpen size={13} className="text-[var(--color-accent)]" />
          <span>Wiki'ye Git</span>
        </button>
      </div>

      {/* ── Category Breakdown ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-n2 p-4">
        <h3 className="text-[12px] font-semibold text-t2 uppercase tracking-wider mb-3">
          Konu Dağılımı ve Başarı
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {Object.entries(categoryStats).map(([catKey, data]) => {
            const catPct = Math.round((data.correct / data.total) * 100)
            return (
              <div
                key={catKey}
                className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-base px-3 py-2 text-[12px]"
              >
                <span className="text-t2 font-medium truncate max-w-[170px]" title={data.label}>
                  {data.label}
                </span>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-t3">
                    {data.correct}/{data.total}
                  </span>
                  <span
                    className={clsx(
                      'font-semibold',
                      catPct >= 75
                        ? 'text-[var(--color-done)]'
                        : catPct >= 50
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-needs)]'
                    )}
                  >
                    %{catPct}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Question List Quick Review ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-n2 p-4">
        <h3 className="text-[12px] font-semibold text-t2 uppercase tracking-wider mb-3">
          Soru Listesi (Tıklayarak İnceleyin)
        </h3>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {session.questions.map((q, idx) => {
            const userAns = session.answers[idx]
            const isCorrect = userAns === q.correctIndex

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  uiTap()
                  jumpToQuestion(idx)
                }}
                className={clsx(
                  'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11.5px] font-mono transition-colors',
                  isCorrect
                    ? 'border-[var(--color-done)]/40 bg-[var(--color-done)]/10 text-[var(--color-done)] hover:bg-[var(--color-done)]/20'
                    : 'border-[var(--color-needs)]/40 bg-[var(--color-needs)]/10 text-[var(--color-needs)] hover:bg-[var(--color-needs)]/20'
                )}
              >
                <span className="font-semibold">#{idx + 1}</span>
                {isCorrect ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
