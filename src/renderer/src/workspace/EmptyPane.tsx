import { useState, type ReactNode } from 'react'
import {
  TerminalSquare,
  FileCode,
  Globe,
  StickyNote,
  MessageSquare,
  Play,
  FolderOpen,
  type LucideIcon
} from 'lucide-react'
import { PANE_KIND_LABELS, type PaneKind, type PaneLeaf } from '../lib/panes'
import { usePaneDispatch } from './pane-context'
import { emitPaneSpawn } from './pane-events'

/**
 * Per-kind metadata shared by EmptyPane (stub body) and PaneFrame (header
 * icon + fallback title + kind dot). Kept here so all workspace chrome stays
 * in one place.
 *
 * Quick-action fields:
 *   action      — button label; clicking emits `terrarium:pane-spawn` for the
 *                 host to bind real content (and clears `attention`).
 *   actionInput — placeholder for an inline input instead of a button;
 *                 Enter sets leaf.title to the value, then emits the event.
 */
export const PANE_META: Record<
  PaneKind,
  {
    icon: LucideIcon
    label: string
    /** Kind color (design token) for the PaneFrame header dot. */
    dot: string
    empty: string
    hint: string
    kbd?: string
    action?: string
    actionInput?: string
  }
> = {
  terminal: {
    icon: TerminalSquare,
    label: PANE_KIND_LABELS.terminal,
    dot: 'var(--color-monitor)',
    empty: 'Connect a terminal',
    hint: 'Bind a CLI from the pane header — saved layouts restore it.',
    kbd: 'Ctrl+\\',
    action: 'Launch shell'
  },
  file: {
    icon: FileCode,
    label: PANE_KIND_LABELS.file,
    dot: 'var(--color-accent)',
    empty: 'Open a file',
    hint: 'Pick a file from the project to preview it in this pane.',
    action: 'Choose file'
  },
  browser: {
    icon: Globe,
    label: PANE_KIND_LABELS.browser,
    dot: 'var(--color-info)',
    empty: 'Open a browser',
    hint: 'Navigate to a URL — docs, previews, dashboards.',
    actionInput: 'Enter URL'
  },
  note: {
    icon: StickyNote,
    label: PANE_KIND_LABELS.note,
    dot: 'var(--color-done)',
    empty: 'Start a note',
    hint: 'Scratchpad for specs, todos, and observations.'
  },
  chat: {
    icon: MessageSquare,
    label: PANE_KIND_LABELS.chat,
    dot: 'var(--color-info)',
    empty: 'Agent thread',
    hint: 'Message a crew member — they reply in the activity feed.'
  }
}

/** Small icon per event-style action, next to the label. */
const ACTION_ICON: Partial<Record<PaneKind, LucideIcon>> = {
  terminal: Play,
  file: FolderOpen
}

const actionBtn =
  'btn-accent-soft flex h-7 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium'

/**
 * Placeholder body for leaf kinds that have no content component bound yet.
 * The real content agent replaces this via WorkspaceView's `renderLeaf` prop.
 * Quick actions emit `terrarium:pane-spawn` — the host binds content there.
 */
export function EmptyPane({ leaf, children }: { leaf: PaneLeaf; children?: ReactNode }) {
  const dispatch = usePaneDispatch()
  const [url, setUrl] = useState('')
  const meta = PANE_META[leaf.kind] ?? PANE_META.terminal
  const Icon = meta.icon
  const ActionIcon = ACTION_ICON[leaf.kind]

  /** Ask the host to bind real content to this leaf. */
  const requestSpawn = () => emitPaneSpawn({ leafId: leaf.id, kind: leaf.kind })

  const onAction = () => {
    // engaging a terminal pane acknowledges its attention flag
    if (leaf.kind === 'terminal') {
      dispatch?.({ type: 'update', leafId: leaf.id, patch: { attention: false } })
    }
    requestSpawn()
  }

  const submitUrl = () => {
    const value = url.trim()
    if (!value) return
    dispatch?.({ type: 'update', leafId: leaf.id, patch: { title: value } })
    setUrl('')
    requestSpawn()
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3.5 p-6 select-none">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-default)] bg-gradient-to-b from-n4 to-n3 text-t3 shadow-[var(--shadow-card)]">
        <Icon size={18} strokeWidth={1.6} />
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-2 ring-n2"
          style={{ background: meta.dot }}
        />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-medium tracking-[-0.01em] text-t1">{meta.empty}</p>
        <p className="mx-auto mt-1 max-w-[230px] text-[12px] leading-relaxed text-t3">
          {meta.hint}
        </p>
      </div>

      {meta.action && (
        <button type="button" className={actionBtn} onClick={onAction}>
          {ActionIcon && <ActionIcon size={11} strokeWidth={1.75} />}
          {meta.action}
        </button>
      )}
      {meta.actionInput && (
        <input
          type="text"
          value={url}
          spellCheck={false}
          placeholder={meta.actionInput}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitUrl()
            } else if (e.key === 'Escape') {
              setUrl('')
            }
          }}
          className="h-7 w-[220px] rounded-lg border border-[var(--border-default)] bg-n1 px-2.5 font-mono text-[11.5px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors select-text placeholder:text-t4 focus:border-[rgba(245,165,36,0.45)]"
        />
      )}

      {meta.kbd && (
        <p className="flex items-center gap-1.5 text-[11px] text-t4">
          split <kbd className="kbd">{meta.kbd}</kbd>
        </p>
      )}
      {children}
    </div>
  )
}
