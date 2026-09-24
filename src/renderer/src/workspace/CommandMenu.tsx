// ── CommandMenu — bind a shell command to a terminal leaf ────────────────────
// Header popover on terminal panes: pick which CLI the pane spawns — claude,
// codex, a plain shell, or a custom string. The binding lives on
// `leaf.command`, so saved layouts (LayoutMenu) restore the exact CLI lineup.
// Changing it re-keys the pty session (lib/render-leaf `commandSessionId`) —
// the pane spawns a fresh process instead of reattaching to the old shell.
//
// Controlled: PaneFrame owns `open` so the hover-revealed header controls
// stay visible while the menu is up.

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import { type PaneLeaf } from '../lib/panes'
import { cliName, isResumableCli, type CliSessionEntry } from '@shared/cli-sessions'
import { useApp } from '../lib/store'
import { usePaneDispatch } from './pane-context'
import { resumeLeafSession, sessionDetail, useCliSessions, claimLeafCommand, resumeToken } from './cli-session-ui'
import { effectiveCli, useLiveCli } from '../lib/live-cli'

// Same platform sniff as the terminal fallback in lib/render-leaf — the
// shell entries mirror whatever an unbound pane would spawn.
const IS_WIN = window.terrarium?.platform === 'win32'

/** What "Default shell" clears back to — shown as that row's detail text. */
const DEFAULT_SHELL = IS_WIN ? 'powershell.exe' : '/bin/sh'

/** Preset bindings listed above the custom input. */
const PRESET_COMMANDS: readonly { label: string; command: string }[] = [
  { label: 'Claude Code', command: 'claude' },
  { label: 'Codex', command: 'codex' },
  { label: 'OpenCode', command: 'opencode' },
  { label: 'Devin', command: 'devin' },
  { label: 'Cursor Agent', command: 'cursor-agent' },
  { label: 'Cline', command: 'cline' },
  { label: 'Muse', command: 'muse' },
  { label: 'Qoder', command: 'qoder' },
  IS_WIN
    ? { label: 'PowerShell', command: 'powershell.exe' }
    : { label: 'sh', command: '/bin/sh' },
  IS_WIN ? { label: 'cmd', command: 'cmd.exe' } : { label: 'bash', command: 'bash' }
]

export function CommandMenu({
  leaf,
  open,
  onOpenChange,
  className
}: {
  leaf: PaneLeaf
  /** Controlled — PaneFrame keeps header controls visible while open. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Trigger button classes (PaneFrame's iconBtn chrome). */
  className?: string
}) {
  const dispatch = usePaneDispatch()
  const [custom, setCustom] = useState(false)
  const [value, setValue] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)

  const current = leaf.command?.trim() ?? ''
  const known = PRESET_COMMANDS.some((p) => p.command === current)
  // 'claude --resume abc' still reports claude — resumable either way. A
  // shell pane running a CLI the user typed reports that CLI (lib/live-cli).
  const live = useLiveCli(leaf)
  const cli = effectiveCli(leaf, live)
  const liveId = live && live.cli === cli ? live.sessionId : null
  const resumable = isResumableCli(cli) && !!projectRoot
  // null → not fetched yet; [] → fetched, nothing found.
  const sessions = useCliSessions(open && resumable ? cli : null)

  // Reset the custom draft every time the menu opens.
  useEffect(() => {
    if (!open) return
    setCustom(false)
    setValue('')
  }, [open])

  // Close on outside pointerdown and Esc — capture phase, like LayoutMenu.
  // INPUT guard: Esc in the custom field cancels the draft, not the menu.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return
      e.stopPropagation()
      onOpenChange(false)
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onOpenChange])

  const bind = (command: string | undefined) => {
    // plain binds clear any session-resume cwd — the pane returns to the
    // project root instead of a foreign session's directory
    const token = resumeToken(command)
    if (command && token && cliName(command)) {
      // resume-shaped bind: take session ownership like the picker does
      claimLeafCommand(dispatch, leaf, command, undefined)
    } else {
      dispatch?.({ type: 'update', leafId: leaf.id, patch: { command, cwd: undefined } })
    }
    onOpenChange(false)
  }

  // Resume a past session: swap leaf.command for the resume form AND set
  // leaf.cwd to the transcript's own directory (claude --resume only
  // resolves there) — both re-key the pty session. Then retire the old
  // process so it doesn't linger holding its transcript lock.
  const resume = (entry: CliSessionEntry) => {
    if (!cli) return
    resumeLeafSession(dispatch, leaf, cli, entry)
    onOpenChange(false)
  }

  const submitCustom = () => {
    const cmd = value.trim()
    if (!cmd) {
      setCustom(false) // empty Enter just backs out of the input
      return
    }
    bind(cmd)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        title="Command…"
        aria-label="Bind command"
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        <ChevronDown
          size={11}
          className={clsx('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          // The pane header is a drag handle — swallow dragstart here so
          // grabbing menu text never starts a pane drag.
          onDragStart={(e) => e.preventDefault()}
          className="pop-surface pop-in absolute right-0 top-full z-50 mt-1.5 w-56 rounded-xl p-1"
        >
          <p className="micro-label px-2 pb-1 pt-1.5 !text-[10px] !tracking-[0.07em] !text-t4">Run command</p>

          <Item
            checked={!current}
            label="Default shell"
            detail={DEFAULT_SHELL}
            onSelect={() => bind(undefined)}
          />

          <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />

          {PRESET_COMMANDS.map((p) => (
            <Item
              key={p.command}
              checked={current === p.command}
              label={p.label}
              detail={p.command}
              onSelect={() => bind(p.command)}
            />
          ))}

          {/* A restored/edited binding that isn't a preset still shows, checked. */}
          {current && !known && (
            <Item checked label={current} detail="custom" onSelect={() => onOpenChange(false)} />
          )}

          {/* past sessions of the bound CLI — when its store is resumable */}
          {resumable && (
            <>
              <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />
              <p className="micro-label px-2 pb-1 pt-1.5 !text-[10px] !tracking-[0.07em] !text-t4">Resume session</p>
              <div className="scroll-thin max-h-44 overflow-y-auto">
                {sessions === null ? (
                  <p className="px-2 py-1.5 text-[12px] text-t4">Loading…</p>
                ) : sessions.length === 0 ? (
                  <p className="px-2 py-1.5 text-[12px] text-t4">No past sessions</p>
                ) : (
                  sessions.map((s) => (
                    <Item
                      key={s.id}
                      // the session running in this pane right now
                      checked={s.id === liveId}
                      label={s.summary ?? `#${s.id.slice(0, 8)}`}
                      detail={s.id === liveId ? 'live' : sessionDetail(s, projectRoot)}
                      onSelect={() => (s.id === liveId ? onOpenChange(false) : resume(s))}
                    />
                  ))
                )}
              </div>
            </>
          )}

          <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />

          {custom ? (
            <input
              autoFocus
              type="text"
              value={value}
              spellCheck={false}
              placeholder="e.g. claude --continue"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCustom()
                } else if (e.key === 'Escape') {
                  // INPUT guard in the window handler leaves Esc to us:
                  // cancel the draft, keep the menu open.
                  e.stopPropagation()
                  setCustom(false)
                  setValue('')
                }
              }}
              className="h-7 w-full rounded-lg border border-[var(--border-default)] bg-n1 px-2 font-mono text-[12px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.45)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                // prefill with the current custom binding for easy edits
                setValue(current && !known ? current : '')
                setCustom(true)
              }}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
            >
              <span className="w-3 shrink-0" />
              Custom…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** One selectable row — check gutter, label, trailing command detail. */
function Item({
  checked,
  label,
  detail,
  onSelect
}: {
  checked: boolean
  label: string
  detail?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={clsx(
        'group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-n4',
        checked && 'bg-[rgba(245,165,36,0.06)]'
      )}
    >
      <span className="flex w-3 shrink-0 items-center justify-center text-accent">
        {checked && <Check size={11} strokeWidth={2} />}
      </span>
      <span
        className={clsx(
          'flex-1 truncate text-[12px]',
          checked ? 'font-medium text-t1' : 'text-t2 group-hover:text-t1'
        )}
      >
        {label}
      </span>
      {detail && (
        <span className="tnum max-w-[96px] truncate font-mono text-[10px] text-t4">{detail}</span>
      )}
    </button>
  )
}
