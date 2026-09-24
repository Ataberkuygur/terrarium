import { useMemo, useRef, useState } from 'react'
import {
  Plus,
  X,
  FilePlus2,
  FileMinus2,
  FilePenLine,
  FileCode2,
  MessageSquare,
  Check,
  Send,
  CornerDownRight
} from 'lucide-react'
import clsx from 'clsx'
import {
  parseDiff,
  buildCommentBatch,
  displayPath,
  diffStats,
  type CommentSide,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type InlineComment
} from '../lib/diff'
import { commentKey, groupComments, makeComment } from './comments'

export interface DiffViewProps {
  diffText: string
  /** called with the markdown batch built by buildCommentBatch() */
  onSendToAgent: (batch: string) => void
  onApprove?: () => void
}

const LINE_CAP = 2000

// line tints — status token hues at fixed alpha via color-mix
// (done #46a758 @8% ≡ rgba(70,167,88,0.08), error #e5484d @8% ≡ rgba(229,72,77,0.08))
const TINT = {
  add: {
    line: 'color-mix(in srgb, var(--color-done) 8%, transparent)',
    gutter: 'color-mix(in srgb, var(--color-done) 15%, transparent)'
  },
  del: {
    line: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
    gutter: 'color-mix(in srgb, var(--color-error) 15%, transparent)'
  }
} as const

function fileIcon(f: DiffFile) {
  if (f.isNew) return <FilePlus2 size={13} className="shrink-0 text-done" />
  if (f.isDeleted) return <FileMinus2 size={13} className="shrink-0 text-error" />
  if (f.isRenamed) return <FilePenLine size={13} className="shrink-0 text-working" />
  return <FileCode2 size={13} className="shrink-0 text-t3" />
}

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf('/')
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

// ── comment editor (appears under the line being commented on) ───────

function CommentEditor({
  onSubmit,
  onCancel
}: {
  onSubmit: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const submit = () => {
    const t = body.trim()
    if (t) onSubmit(t)
  }
  return (
    <div className="border-l-2 border-accent bg-[color-mix(in_srgb,var(--color-accent)_4%,transparent)] px-4 py-2.5">
      <textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
        placeholder="Leave a comment for the agent…"
        className="w-full resize-none bg-transparent font-sans text-[12.5px] leading-[18px] text-t1 placeholder:text-t4 outline-none"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <span className="mr-auto text-[10.5px] text-t4">
          <kbd className="kbd">esc</kbd> cancel · <kbd className="kbd">↵</kbd> comment
        </span>
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11.5px] text-t3 hover:bg-n4 hover:text-t2 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!body.trim()}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40"
        >
          Comment
        </button>
      </div>
    </div>
  )
}

function CommentBubble({ comment, onRemove }: { comment: InlineComment; onRemove: () => void }) {
  return (
    <div className="group/c flex items-start gap-2 border-l-2 border-accent bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)] px-4 py-1.5">
      <MessageSquare size={11} className="mt-[3px] shrink-0 text-accent" />
      <p className="flex-1 whitespace-pre-wrap font-sans text-[12px] leading-[18px] text-t2">
        {comment.body}
      </p>
      <button
        onClick={onRemove}
        title="Remove comment"
        className="mt-0.5 shrink-0 text-t4 opacity-0 transition-opacity hover:text-t2 group-hover/c:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// ── a single diff line row (+ its comments / editor below) ───────────

interface LineRowProps {
  line: DiffLine
  comments: InlineComment[]
  editing: boolean
  onStartComment: () => void
  onSubmitComment: (body: string) => void
  onCancelComment: () => void
  onRemoveComment: (id: string) => void
}

function LineRow(p: LineRowProps) {
  const { line } = p
  const tint = line.type === 'add' ? TINT.add : line.type === 'del' ? TINT.del : null
  const sign = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''
  const signColor =
    line.type === 'add' ? 'text-done' : line.type === 'del' ? 'text-error' : 'text-t4'
  const count = p.comments.length

  return (
    <>
      <div
        className="group relative flex items-stretch font-mono text-[12px] leading-[20px]"
        style={{
          background: tint?.line,
          // inset marker — a border would shift the row 2px out of alignment
          boxShadow: count > 0 ? 'inset 2px 0 0 var(--color-accent)' : undefined
        }}
      >
        {/* + gutter button */}
        <div className="flex w-6 shrink-0 select-none items-center justify-center">
          <button
            onClick={p.onStartComment}
            title="Comment on this line"
            className="flex h-4 w-4 items-center justify-center rounded bg-accent text-on-accent opacity-0 transition-opacity hover:bg-accent-hover group-hover:opacity-100"
          >
            <Plus size={10} strokeWidth={3} />
          </button>
        </div>
        {/* line numbers */}
        <div
          className="w-11 shrink-0 select-none pr-2 text-right text-[11px] tnum text-t4"
          style={tint ? { background: tint.gutter } : undefined}
        >
          {line.oldNo ?? ''}
        </div>
        <div
          className="w-11 shrink-0 select-none pr-2 text-right text-[11px] tnum text-t4"
          style={tint ? { background: tint.gutter } : undefined}
        >
          {line.newNo ?? ''}
        </div>
        {/* sign */}
        <div className={clsx('w-4 shrink-0 select-none text-center', signColor)}>{sign}</div>
        {/* code */}
        <div className={clsx('flex-1 whitespace-pre pr-3', line.type === 'ctx' ? 'text-t3' : 'text-t1')}>
          {line.text}
          {line.noEol && (
            <span className="ml-1 select-none text-t4" title="No newline at end of file">
              ⏎
            </span>
          )}
        </div>
        {/* comment count chip */}
        {count > 0 && (
          <span className="mr-2 flex h-4 shrink-0 items-center gap-1 self-center rounded bg-accent-subtle px-1.5 text-[10px] font-medium tnum text-accent">
            <MessageSquare size={9} />
            {count}
          </span>
        )}
      </div>
      {p.comments.map((c) => (
        <CommentBubble key={c.id} comment={c} onRemove={() => p.onRemoveComment(c.id)} />
      ))}
      {p.editing && <CommentEditor onSubmit={p.onSubmitComment} onCancel={p.onCancelComment} />}
    </>
  )
}

// ── one file: sticky header + hunks ──────────────────────────────────

interface FileSectionProps {
  file: DiffFile
  fileIdx: number
  expanded: boolean
  onExpand: () => void
  commentMap: Map<string, InlineComment[]>
  editingKey: string | null
  onStartComment: (key: string) => void
  onSubmitComment: (filePath: string, side: CommentSide, lineNo: number, snippet: string, body: string) => void
  onCancelComment: () => void
  onRemoveComment: (id: string) => void
}

function FileSection(p: FileSectionProps) {
  const { file } = p
  const path = displayPath(file)
  const totalLines = file.hunks.reduce((n, h) => n + h.lines.length, 0)
  const capped = !p.expanded && totalLines > LINE_CAP

  // walk hunks until the line budget is spent; hunks past the cap
  // are dropped entirely (no bare headers) and covered by the affordance
  let budget = capped ? LINE_CAP : Number.POSITIVE_INFINITY
  const hunkViews: { hunk: DiffHunk; lines: DiffLine[] }[] = []
  for (const h of file.hunks) {
    if (budget <= 0) break
    const lines = h.lines.slice(0, budget)
    budget -= lines.length
    hunkViews.push({ hunk: h, lines })
  }
  const rendered = hunkViews.reduce((n, v) => n + v.lines.length, 0)
  const hidden = totalLines - rendered

  return (
    <section>
      {/* file header — sticks while its hunks scroll past */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border-default)] bg-raised px-3 py-2">
        {fileIcon(file)}
        <span className="truncate font-mono text-[12px] text-t1">{path}</span>
        {file.isRenamed && file.oldPath && (
          <span className="truncate font-mono text-[11px] text-t4">← {file.oldPath}</span>
        )}
        {file.isNew && (
          <span className="rounded bg-[color-mix(in_srgb,var(--color-done)_12%,transparent)] px-1.5 py-px text-[10px] font-medium text-done">
            NEW
          </span>
        )}
        {file.isDeleted && (
          <span className="rounded bg-[color-mix(in_srgb,var(--color-error)_12%,transparent)] px-1.5 py-px text-[10px] font-medium text-error">
            DELETED
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] tnum">
          {file.additions > 0 && <span className="text-done">+{file.additions}</span>}
          {file.additions > 0 && file.deletions > 0 && ' '}
          {file.deletions > 0 && <span className="text-error">−{file.deletions}</span>}
        </span>
      </div>

      {file.isBinary ? (
        <p className="px-4 py-4 text-[12px] text-t4">Binary file — not shown.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="w-max min-w-full">
            {hunkViews.map(({ hunk: h, lines }, hi) => (
              <div key={hi}>
                {/* hunk header bar */}
                <div className="flex items-center gap-3 border-y border-[var(--border-subtle)] bg-n2 px-3 py-1">
                  <CornerDownRight size={11} className="shrink-0 text-t4" />
                  <span className="font-mono text-[11px] text-t3">{h.header}</span>
                  <span className="ml-auto truncate font-mono text-[10.5px] text-t4">{path}</span>
                </div>
                {lines.map((line, li) => {
                  const side: CommentSide = line.type === 'del' ? 'old' : 'new'
                  const lineNo = (side === 'old' ? line.oldNo : line.newNo) ?? 0
                  const rowKey = `${p.fileIdx}:${hi}:${li}`
                  const ck = commentKey(path, side, lineNo)
                  return (
                    <LineRow
                      key={rowKey}
                      line={line}
                      comments={p.commentMap.get(ck) ?? []}
                      editing={p.editingKey === rowKey}
                      onStartComment={() => p.onStartComment(rowKey)}
                      onSubmitComment={(body) =>
                        p.onSubmitComment(path, side, lineNo, line.text, body)
                      }
                      onCancelComment={p.onCancelComment}
                      onRemoveComment={p.onRemoveComment}
                    />
                  )
                })}
              </div>
            ))}
            {hidden > 0 && (
              <button
                onClick={p.onExpand}
                className="flex w-full items-center justify-center gap-2 border-y border-[var(--border-subtle)] bg-n2 px-3 py-2 text-[11.5px] text-t3 transition-colors hover:text-t1"
              >
                <Plus size={11} /> Show {hidden} more line{hidden === 1 ? '' : 's'} in this file
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ── the view ─────────────────────────────────────────────────────────

export function DiffView({ diffText, onSendToAgent, onApprove }: DiffViewProps) {
  const parsed = useMemo(() => parseDiff(diffText), [diffText])
  const stats = useMemo(() => diffStats(parsed), [parsed])
  const [comments, setComments] = useState<InlineComment[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [selFile, setSelFile] = useState(0)
  const fileRefs = useRef<(HTMLElement | null)[]>([])

  const commentMap = useMemo(() => groupComments(comments), [comments])

  const scrollToFile = (i: number) => {
    setSelFile(i)
    fileRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const submitComment = (
    filePath: string,
    side: CommentSide,
    lineNo: number,
    snippet: string,
    body: string
  ) => {
    setComments((cs) => [...cs, makeComment({ filePath, side, lineNo, snippet, body })])
    setEditingKey(null)
  }

  const send = () => {
    const batch = buildCommentBatch(comments)
    if (!batch) return
    onSendToAgent(batch)
    setComments([])
    setEditingKey(null)
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* ── top bar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-default)] bg-base px-4 py-2.5">
        <span className="text-[12.5px] text-t2">
          <span className="tnum font-medium text-t1">{stats.files}</span> file
          {stats.files === 1 ? '' : 's'} changed
        </span>
        <span className="text-[12px] tnum">
          <span className="text-done">+{stats.additions}</span>{' '}
          <span className="text-error">−{stats.deletions}</span>
        </span>
        {comments.length > 0 && (
          <span className="flex items-center gap-1 rounded bg-accent-subtle px-1.5 py-0.5 text-[11px] font-medium tnum text-accent">
            <MessageSquare size={10} />
            {comments.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onApprove && (
            <button
              onClick={onApprove}
              className="flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--color-done)_45%,transparent)] px-3 py-1.5 text-[12.5px] font-medium text-done transition-colors hover:bg-[color-mix(in_srgb,var(--color-done)_10%,transparent)]"
            >
              <Check size={13} /> Approve &amp; merge
            </button>
          )}
          <button
            onClick={send}
            disabled={comments.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-t1 px-3 py-1.5 text-[12.5px] font-medium text-n1 transition-colors hover:bg-n12 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={12} />
            {comments.length > 0
              ? `Send ${comments.length} comment${comments.length === 1 ? '' : 's'} to agent`
              : 'Send comments to agent'}
          </button>
        </div>
      </div>

      {/* ── rail + body ── */}
      <div className="flex min-h-0 flex-1">
        {/* file list rail */}
        <div className="w-[200px] shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] bg-base py-1">
          <div className="micro-label px-3 pb-1 pt-2">Files</div>
          {parsed.files.map((f, i) => {
            const { dir, name } = splitPath(displayPath(f))
            return (
              <button
                key={i}
                onClick={() => scrollToFile(i)}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                  selFile === i ? 'bg-n3' : 'hover:bg-n2'
                )}
              >
                {fileIcon(f)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] leading-[16px] text-t1">{name}</span>
                  {dir && <span className="block truncate text-[10px] leading-[14px] text-t4">{dir}</span>}
                </span>
                <span className="shrink-0 text-right text-[10px] leading-[14px] tnum">
                  {f.additions > 0 && <span className="block text-done">+{f.additions}</span>}
                  {f.deletions > 0 && <span className="block text-error">−{f.deletions}</span>}
                </span>
              </button>
            )
          })}
        </div>

        {/* diff body */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {parsed.files.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-t4">
              No diff to review.
            </div>
          ) : (
            parsed.files.map((f, i) => (
              <div
                key={i}
                ref={(el) => {
                  fileRefs.current[i] = el
                }}
              >
                <FileSection
                  file={f}
                  fileIdx={i}
                  expanded={expanded.has(i)}
                  onExpand={() => setExpanded((s) => new Set(s).add(i))}
                  commentMap={commentMap}
                  editingKey={editingKey}
                  onStartComment={setEditingKey}
                  onSubmitComment={submitComment}
                  onCancelComment={() => setEditingKey(null)}
                  onRemoveComment={(id) => setComments((cs) => cs.filter((c) => c.id !== id))}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
