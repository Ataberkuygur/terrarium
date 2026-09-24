// ── QuizQuestionCard: Interactive Card with Options & Explanations ────────

import { useEffect, useState } from 'react'
import { Check, X, BookOpen, ArrowRight, Sparkles, HelpCircle, Code2 } from 'lucide-react'
import clsx from 'clsx'
import type { QuizQuestion } from '@shared/quiz'
import { useQuiz } from '../lib/quiz/quiz-store'
import { useApp } from '../lib/store'
import { doneChime, errorSoft, uiTap } from '../lib/sfx'

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const

export function QuizQuestionCard({
  question,
  index,
  total,
  selectedAnswer
}: {
  question: QuizQuestion
  index: number
  total: number
  selectedAnswer?: number
}) {
  const answerQuestion = useQuiz((s) => s.answerQuestion)
  const nextQuestion = useQuiz((s) => s.nextQuestion)
  const setView = useApp((s) => s.setView)
  const setActivePage = useApp((s) => s.setActivePage)

  const isAnswered = selectedAnswer !== undefined
  const isCorrect = isAnswered && selectedAnswer === question.correctIndex

  const handleSelect = (optIndex: number) => {
    if (isAnswered) return
    uiTap()
    if (optIndex === question.correctIndex) {
      doneChime()
    } else {
      errorSoft()
    }
    answerQuestion(optIndex)
  }

  const handleOpenWiki = () => {
    if (question.wikiPageId) {
      setActivePage(question.wikiPageId)
    }
    setView('wiki')
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
      {/* ── Question Header Meta ── */}
      <div className="flex items-center justify-between gap-3 text-[11.5px] text-t4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full border border-[rgba(245,165,36,0.22)] bg-accent-subtle px-2 py-px text-[10.5px] leading-4 font-semibold text-accent">
            {question.categoryLabel}
          </span>
          <span className="max-w-[260px] truncate text-t4" title={question.sourceTitle}>
            {question.sourceTitle}
          </span>
        </div>
        <div className="tnum flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-n2 px-1.5 py-px text-[11px] text-t3">
          <span className="font-medium text-t1">{index + 1}</span>
          <span className="text-t4">/</span>
          <span>{total}</span>
        </div>
      </div>

      {/* ── Question Body ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-raised p-6 shadow-[var(--shadow-card)] select-text">
        <h2 className="text-[16px] leading-[1.55] font-semibold tracking-[-0.01em] text-t1">
          {question.question}
        </h2>

        {question.codeSnippet && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-sunken p-3.5 font-mono text-[12px] leading-normal text-t2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]">
            <div className="mb-2 flex items-center gap-1.5 font-sans text-[10px] font-semibold tracking-[0.07em] text-t4 uppercase select-none">
              <Code2 size={11} />
              <span>Kod Referansı</span>
            </div>
            <pre className="m-0">{question.codeSnippet}</pre>
          </div>
        )}
      </div>

      {/* ── Option Cards ── */}
      <div className="grid grid-cols-1 gap-2">
        {question.options.map((opt, optIndex) => {
          const letter = OPTION_LETTERS[optIndex]
          const isSelected = selectedAnswer === optIndex
          const isThisCorrect = optIndex === question.correctIndex

          let cardStyle =
            'border-[var(--border-default)] bg-n2 text-t2 shadow-[var(--shadow-card)] hover:border-[var(--border-strong)] hover:bg-n3 hover:text-t1'
          let letterStyle =
            'border-[var(--border-default)] bg-n3 text-t3 group-hover:border-[rgba(245,165,36,0.35)] group-hover:text-accent'

          if (isAnswered) {
            if (isThisCorrect) {
              cardStyle =
                'border-[var(--color-done)]/60 bg-[var(--color-done)]/10 text-t1 shadow-[0_0_0_3px_rgba(70,167,88,0.1)]'
              letterStyle = 'bg-[var(--color-done)] text-white border-transparent'
            } else if (isSelected) {
              cardStyle =
                'border-[var(--color-needs)]/60 bg-[var(--color-needs)]/10 text-t1 shadow-[0_0_0_3px_rgba(242,85,90,0.1)]'
              letterStyle = 'bg-[var(--color-needs)] text-white border-transparent'
            } else {
              cardStyle = 'border-[var(--border-subtle)] bg-n1 opacity-45 text-t4 pointer-events-none'
            }
          }

          return (
            <button
              key={optIndex}
              type="button"
              disabled={isAnswered}
              onClick={() => handleSelect(optIndex)}
              className={clsx(
                'group relative flex items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-all duration-150',
                cardStyle,
                !isAnswered && 'cursor-pointer active:scale-[0.995]'
              )}
            >
              {/* Option Letter Badge */}
              <span
                className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors',
                  letterStyle
                )}
              >
                {letter}
              </span>

              {/* Option Text */}
              <span className="flex-1 pt-[3px] text-[13px] leading-snug">{opt}</span>

              {/* Status Icon */}
              {isAnswered && isThisCorrect && (
                <Check size={16} className="text-[var(--color-done)] shrink-0 mt-0.5" />
              )}
              {isAnswered && isSelected && !isThisCorrect && (
                <X size={16} className="text-[var(--color-needs)] shrink-0 mt-0.5" />
              )}

              {/* Keyboard Hint (before answer) */}
              {!isAnswered && (
                <span className="kbd mt-0.5 hidden !text-[10px] opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
                  {optIndex + 1}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Explanation & Feedback Box (Visible After Answering) ── */}
      {isAnswered && (
        <div
          className={clsx(
            'pop-in flex flex-col gap-3 rounded-xl border p-4 shadow-[var(--shadow-card)]',
            isCorrect
              ? 'border-[var(--color-done)]/30 bg-[var(--color-done)]/[0.06]'
              : 'border-[var(--color-needs)]/30 bg-[var(--color-needs)]/[0.06]'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold',
                  isCorrect ? 'bg-[var(--color-done)]' : 'bg-[var(--color-needs)]'
                )}
              >
                {isCorrect ? '✓' : '✗'}
              </span>
              <span className="text-[13px] font-semibold text-t1">
                {isCorrect ? 'Tebrikler! Doğru Cevap' : 'Yanlış Cevap'}
              </span>
            </div>

            {/* Wiki Link Button */}
            <button
              type="button"
              onClick={handleOpenWiki}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-2.5 text-[12px] text-t2 transition-colors hover:bg-n4 hover:text-t1"
              title="Bu konuyu Wiki'de derinlemesine incele"
            >
              <BookOpen size={12} className="text-[var(--color-accent)]" />
              <span>Wiki'de İncele</span>
            </button>
          </div>

          <p className="text-[12.5px] text-t3 leading-relaxed select-text">
            {question.explanation}
          </p>

          {/* Next Button */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                uiTap()
                nextQuestion()
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[12px] font-semibold text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.35),0_4px_14px_-4px_rgba(245,165,36,0.5)] transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97]"
            >
              <span>{index + 1 === total ? 'Sonucu Gör' : 'Sonraki Soru'}</span>
              <ArrowRight size={13} strokeWidth={2} />
              <kbd className="ml-1 rounded bg-black/15 px-1 py-px font-mono text-[10px] opacity-80">Enter</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
