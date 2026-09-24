import { useState, type ReactNode } from 'react'
import { X, SquareSplitHorizontal, SquareSplitVertical } from 'lucide-react'
import clsx from 'clsx'
import type { PaneLeaf, SplitDir } from '../lib/panes'
import { DOMAIN_LABELS } from '../lib/terminal-classify'
import { PANE_META } from './EmptyPane'
import { CommandMenu } from './CommandMenu'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { cliBrand } from '../components/CliBrand'
import { isShellCommand, useLiveCli } from '../lib/live-cli'

export interface PaneFrameProps {
  leaf: PaneLeaf
  /** Focused pane gets a subtle accent edge. */
  focused: boolean
  /** False at MAX_LEAVES — hides/disables split buttons. */
  canSplit: boolean
  onFocus: () => void
  onClose: () => void
  onSplit: (dir: SplitDir) => void
  /** Drop of a dragged pane header landed on this leaf — swap positions. */
  onSwapLeaf?: (draggedId: string) => void
  children?: ReactNode
}

/** HTML5 DnD payload marker — only pane-header drags count as drop targets. */
const PANE_DRAG_MIME = 'application/x-terrarium-pane'

/**
 * Id of the leaf currently being dragged (single window → one drag at a time).
 * Lets a frame ignore its own drag during dragover — dataTransfer data is
 * unreadable until drop.
 */
let draggingLeafId: string | null = null

/** Header title: explicit title → refId basename (nice for files) → kind label. */
export function paneTitle(leaf: PaneLeaf): string {
  if (leaf.title) return leaf.title
  if (leaf.refId) {
    const base = leaf.refId.split(/[\\/]/).pop()
    if (base) return base
  }
  return (PANE_META[leaf.kind] ?? PANE_META.terminal).label
}

/**
 * ' · <bound command>' — plus the CLI detected running inside a shell pane
 * (the user typed `claude --resume …` into powershell), with its brand mark.
 */
function LiveCommand({ leaf }: { leaf: PaneLeaf }) {
  const live = useLiveCli(leaf)
  const detected = isShellCommand(leaf.command) ? live : null
  if (!detected) {
    return leaf.command ? <span className="text-t4"> · {leaf.command}</span> : null
  }
  const b = cliBrand(detected.cli)
  return (
    <span className="text-t4" title={`${b.label} running in ${leaf.command?.trim() || 'the shell'}`}>
      {' · '}
      <span className="inline-flex translate-y-[2px] items-center">{b.mark(11)}</span>{' '}
      <span style={{ color: b.color }}>{b.label}</span>
    </span>
  )
}

const iconBtn =
  'flex h-5 w-5 items-center justify-center rounded text-t4 transition-colors hover:bg-n5 hover:text-t2 disabled:pointer-events-none disabled:opacity-30'

/**
 * Chrome around every leaf: header strip (kind icon + kind dot + title +
 * status dots + hover-revealed split/close controls) over a body that fills
 * the rest. The header is a drag handle — drop onto another leaf to swap.
 */
export function PaneFrame({
  leaf,
  focused,
  canSplit,
  onFocus,
  onClose,
  onSplit,
  onSwapLeaf,
  children
}: PaneFrameProps) {
  const meta = PANE_META[leaf.kind] ?? PANE_META.terminal
  const Icon = meta.icon
  const [dropOver, setDropOver] = useState(false)
  const [dragging, setDragging] = useState(false)
  // CommandMenu open state lives here so the hover-revealed controls stay
  // visible while its popover is up (the popover is inside that container).
  const [cmdOpen, setCmdOpen] = useState(false)

  return (
    <div
      className={clsx(
        'group/frame flex h-full w-full flex-col overflow-hidden rounded-lg border bg-base transition-colors duration-150',
        dragging && 'opacity-60',
        dropOver
          ? 'border-[var(--color-info)]'
          : focused
            ? 'border-[rgba(245,165,36,0.4)] shadow-[0_0_0_1px_rgba(245,165,36,0.12)]'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
      )}
      onPointerDown={onFocus}
      onDragOver={(e) => {
        if (!onSwapLeaf || !e.dataTransfer.types.includes(PANE_DRAG_MIME)) return
        if (draggingLeafId === leaf.id) return // no self-drop highlight
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropOver(true)
      }}
      onDragLeave={(e) => {
        // dragleave bubbles from children — only clear when truly leaving
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false)
      }}
      onDrop={(e) => {
        setDropOver(false)
        const from = e.dataTransfer.getData(PANE_DRAG_MIME)
        if (from && from !== leaf.id) {
          e.preventDefault()
          onSwapLeaf?.(from)
        }
      }}
    >
      <header
        draggable={!!onSwapLeaf}
        onDragStart={(e) => {
          // buttons inside the header must not start a pane drag
          if ((e.target as HTMLElement).closest('button')) {
            e.preventDefault()
            return
          }
          e.dataTransfer.setData(PANE_DRAG_MIME, leaf.id)
          e.dataTransfer.effectAllowed = 'move'
          draggingLeafId = leaf.id
          setDragging(true)
        }}
        onDragEnd={() => {
          draggingLeafId = null
          setDragging(false)
          setDropOver(false)
        }}
        className="flex h-7 shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] bg-n2 pl-2.5 pr-1.5 select-none"
      >
        <Icon
          size={12}
          strokeWidth={1.75}
          className={clsx('shrink-0', focused ? 'text-accent' : 'text-t3')}
        />
        {/* pane-kind color dot */}
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: meta.dot }}
          title={meta.label}
        />
        <span
          className={clsx(
            'truncate text-[12px] leading-none',
            focused ? 'text-t1' : 'text-t2'
          )}
        >
          {paneTitle(leaf)}
          {/* named worker: 'Korpus — marketing' + the bound CLI rides along */}
          {leaf.kind === 'terminal' && leaf.domain && (
            <span className="text-t4"> — {DOMAIN_LABELS[leaf.domain]}</span>
          )}
          {leaf.kind === 'terminal' && <LiveCommand leaf={leaf} />}
        </span>

        {/* attention → amber pulse · dirty → white */}
        {leaf.attention && (
          <span
            className="status-pulse h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--color-working)' }}
            title="Needs attention"
          />
        )}
        {leaf.dirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: 'var(--color-t1)' }}
            title="Unsaved changes"
          />
        )}

        <span className="flex-1" />

        {/* hover controls — forced visible while the command menu is open
            so its popover isn't faded out with the buttons */}
        <div
          className={clsx(
            'flex shrink-0 items-center gap-0.5 transition-opacity duration-100',
            cmdOpen ? 'opacity-100' : 'opacity-0 group-hover/frame:opacity-100'
          )}
        >
          {leaf.kind === 'terminal' && (
            <CommandMenu
              leaf={leaf}
              open={cmdOpen}
              onOpenChange={setCmdOpen}
              className={iconBtn}
            />
          )}
          <button
            type="button"
            className={iconBtn}
            title="Split right (Ctrl+\)"
            aria-label="Split right"
            disabled={!canSplit}
            onClick={(e) => {
              e.stopPropagation()
              onSplit('row')
            }}
          >
            <SquareSplitHorizontal size={12} />
          </button>
          <button
            type="button"
            className={iconBtn}
            title="Split down"
            aria-label="Split down"
            disabled={!canSplit}
            onClick={(e) => {
              e.stopPropagation()
              onSplit('col')
            }}
          >
            <SquareSplitVertical size={12} />
          </button>
          <button
            type="button"
            className={clsx(iconBtn, 'hover:text-[var(--color-needs)]')}
            title="Close pane (Ctrl+W)"
            aria-label="Close pane"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <ErrorBoundary fallbackTitle={`${paneTitle(leaf)} error`}>
          {children}
        </ErrorBoundary>
      </div>
    </div>
  )
}
