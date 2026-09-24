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
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-default)] bg-raised px-6 pt-8 pb-6 text-center shadow-[var(--shadow-card)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(245,165,36,0.14),transparent)]" />

        <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(245,165,36,0.28)] bg-accent-subtle text-accent shadow-[inset_0_1px_0_rgba(255,220,160,0.1),0_8px_24px_-8px_rgba(245,165,36,0.4)]">
          <Trophy size={26} strokeWidth={1.75} />
        </div>

        <span className={clsx('relative text-[11px] font-semibold tracking-[0.08em] uppercase', gradeColor)}>
          {grade}
        </span>

        <h1 className="tnum relative mt-2 text-[40px] leading-none font-semibold tracking-[-0.03em] text-t1">
          {score} <span className="text-[22px] font-medium text-t4">/ {total}</span>
        </h1>

        <p className="relative mt-2 text-[12px] text-t3">
          Başarı Oranı: <span className="tnum font-semibold text-t1">%{percent}</span>
        </p>

        {/* Streak banner */}
        <div className="relative mt-5 flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-n2 px-3.5 py-1 text-[12px] font-medium text-t2">
          <Flame size={13} className="fill-accent/80 text-accent" />
          <span>
            {stats.streak} Günlük Quiz Serisi!
          </span>
        </div>
      </div>

      {/* ── Action Buttons ── */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => {
            uiTap()
            jumpToQuestion(0)
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-3.5 text-[12px] font-medium text-t2 shadow-[var(--shadow-card)] transition-colors hover:bg-n4 hover:text-t1"
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
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-4 text-[12px] font-semibold text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.35),0_4px_14px_-4px_rgba(245,165,36,0.5)] transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97]"
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
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-3.5 text-[12px] font-medium text-t2 shadow-[var(--shadow-card)] transition-colors hover:bg-n4 hover:text-t1"
        >
          <BookOpen size={13} className="text-[var(--color-accent)]" />
          <span>Wiki'ye Git</span>
        </button>
      </div>

      {/* ── Category Breakdown ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-raised p-4 shadow-[var(--shadow-card)]">
        <h3 className="micro-label mb-3">Konu Dağılımı ve Başarı</h3>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(categoryStats).map(([catKey, data]) => {
            const catPct = Math.round((data.correct / data.total) * 100)
            return (
              <div
                key={catKey}
                className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-n2 px-3 py-2 text-[12px]"
              >
                <span className="max-w-[170px] truncate font-medium text-t2" title={data.label}>
                  {data.label}
                </span>
                <div className="tnum flex items-center gap-2 text-[11px]">
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
      <div className="rounded-xl border border-[var(--border-default)] bg-raised p-4 shadow-[var(--shadow-card)]">
        <h3 className="micro-label mb-3">Soru Listesi (Tıklayarak İnceleyin)</h3>

        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
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
                  'tnum flex h-8 items-center justify-between rounded-lg border px-2.5 text-[11.5px] transition-colors',
                  isCorrect
                    ? 'border-[var(--color-done)]/25 bg-[var(--color-done)]/[0.08] text-[var(--color-done)] hover:bg-[var(--color-done)]/15'
                    : 'border-[var(--color-needs)]/25 bg-[var(--color-needs)]/[0.08] text-[var(--color-needs)] hover:bg-[var(--color-needs)]/15'
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
