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
      <div className="flex items-center justify-between text-[11.5px] text-t4">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--border-subtle)] bg-n2 px-2 py-0.5 font-medium text-t2">
            {question.categoryLabel}
          </span>
          <span className="text-t4 truncate max-w-[260px]" title={question.sourceTitle}>
            {question.sourceTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-t3">
          <span>{index + 1}</span>
          <span className="text-t4">/</span>
          <span>{total}</span>
        </div>
      </div>

      {/* ── Question Body ── */}
      <div className="rounded-xl border border-[var(--border-default)] bg-n2 p-5 shadow-sm select-text">
        <h2 className="text-[15px] font-semibold leading-relaxed text-t1">
          {question.question}
        </h2>

        {question.codeSnippet && (
          <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-base p-3 overflow-x-auto font-mono text-[12px] text-t2 leading-normal">
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] text-t4 uppercase tracking-wider select-none">
              <Code2 size={11} />
              <span>Kod Referansı</span>
            </div>
            <pre className="m-0">{question.codeSnippet}</pre>
          </div>
        )}
      </div>

      {/* ── Option Cards ── */}
      <div className="grid grid-cols-1 gap-2.5">
        {question.options.map((opt, optIndex) => {
          const letter = OPTION_LETTERS[optIndex]
          const isSelected = selectedAnswer === optIndex
          const isThisCorrect = optIndex === question.correctIndex

          let cardStyle =
            'border-[var(--border-default)] bg-n2 text-t2 hover:border-[var(--border-strong)] hover:bg-n3'
          let letterStyle = 'border-[var(--border-subtle)] bg-n3 text-t3'

          if (isAnswered) {
            if (isThisCorrect) {
              cardStyle =
                'border-[var(--color-done)] bg-[var(--color-done)]/10 text-t1 ring-1 ring-[var(--color-done)]/30'
              letterStyle = 'bg-[var(--color-done)] text-white border-transparent'
            } else if (isSelected) {
              cardStyle =
                'border-[var(--color-needs)] bg-[var(--color-needs)]/10 text-t1 ring-1 ring-[var(--color-needs)]/30'
              letterStyle = 'bg-[var(--color-needs)] text-white border-transparent'
            } else {
              cardStyle = 'border-[var(--border-subtle)] bg-n1 opacity-50 text-t4 pointer-events-none'
            }
          }

          return (
            <button
              key={optIndex}
              type="button"
              disabled={isAnswered}
              onClick={() => handleSelect(optIndex)}
              className={clsx(
                'flex items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150 relative group',
                cardStyle,
                !isAnswered && 'cursor-pointer active:scale-[0.995]'
              )}
            >
              {/* Option Letter Badge */}
              <span
                className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold font-mono transition-colors',
                  letterStyle
                )}
              >
                {letter}
              </span>

              {/* Option Text */}
              <span className="flex-1 text-[13px] leading-snug pt-0.5">{opt}</span>

              {/* Status Icon */}
              {isAnswered && isThisCorrect && (
                <Check size={16} className="text-[var(--color-done)] shrink-0 mt-0.5" />
              )}
              {isAnswered && isSelected && !isThisCorrect && (
                <X size={16} className="text-[var(--color-needs)] shrink-0 mt-0.5" />
              )}

              {/* Keyboard Hint (before answer) */}
              {!isAnswered && (
                <span className="hidden sm:inline text-[10.5px] font-mono text-t4 opacity-0 group-hover:opacity-100 transition-opacity">
                  [{optIndex + 1}]
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
            'flex flex-col gap-3 rounded-xl border p-4 animate-in fade-in slide-in-from-bottom-2 duration-200',
            isCorrect
              ? 'border-[var(--color-done)]/40 bg-[var(--color-done)]/5'
              : 'border-[var(--color-needs)]/40 bg-[var(--color-needs)]/5'
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
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n2 px-2.5 py-1 text-[11.5px] text-t2 hover:bg-n3 hover:text-t1 transition-colors"
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
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 text-[12px] font-medium text-black transition-transform hover:opacity-90 active:scale-95"
            >
              <span>{index + 1 === total ? 'Sonucu Gör' : 'Sonraki Soru'}</span>
              <ArrowRight size={13} strokeWidth={2} />
              <kbd className="ml-1 text-[10px] opacity-75 font-mono">Enter</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
