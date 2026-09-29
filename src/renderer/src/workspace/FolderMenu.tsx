// ── FolderMenu — pin a project folder to a terminal leaf ─────────────────────
// Header popover on terminal panes: which folder this terminal works in. The
// pick lives on `leaf.folder` (saved with the layout), so it stays put across
// restarts, reboots and rebinding the command until the user changes it here.
//
// Controlled by PaneFrame like CommandMenu, so the header keeps its controls
// visible while the popover is up.

import { useEffect, useRef, useState } from 'react'
import { Check, Folder, FolderOpen } from 'lucide-react'
import clsx from 'clsx'
import { leafCwd, type PaneLeaf } from '../lib/panes'
import { useApp } from '../lib/store'
import { cleanFolder, folderName, recentFolders, setLeafFolder } from '../lib/pane-folder'
import { getAllTerminalLeaves } from '../lib/terminal-agents'
import { effectiveCli, useLiveCli } from '../lib/live-cli'
import { usePaneDispatch } from './pane-context'

const same = (a: string | undefined, b: string | undefined) =>
  (a ?? '').replace(/[\\/]+$/, '').toLowerCase() === (b ?? '').replace(/[\\/]+$/, '').toLowerCase()

export function FolderMenu({
  leaf,
  open,
  onOpenChange,
  bare = false
}: {
  leaf: PaneLeaf
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Caller already reveals its controls on hover — skip the icon's own hover fade. */
  bare?: boolean
}) {
  const dispatch = usePaneDispatch()
  const rootRef = useRef<HTMLDivElement>(null)
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  const [typing, setTyping] = useState(false)
  const [value, setValue] = useState('')
  const [choices, setChoices] = useState<string[]>([])

  const pinned = leaf.folder?.trim() || undefined
  // where the pty actually starts — differs from the pin only while a resumed
  // session's own folder is in force
  const effective = leafCwd(leaf) || projectRoot
  const live = useLiveCli(leaf)
  const runningCli = effectiveCli(leaf, live)

  // Folders worth offering: this terminal's siblings, recent picks, the project.
  useEffect(() => {
    if (!open) return
    setTyping(false)
    setValue('')
    const seen = new Set<string>()
    const list: string[] = []
    for (const p of [
      ...getAllTerminalLeaves().map((l) => l.folder),
      ...recentFolders(),
      ...useApp.getState().projects.map((pr) => pr.rootPath)
    ]) {
      const t = p?.trim()
      if (!t || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      list.push(t)
    }
    setChoices(list.slice(0, 8))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT') return
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

  const apply = (folder: string | undefined) => {
    onOpenChange(false)
    if (same(folder, pinned)) return
    // moving the pane restarts its process — never do that to a live agent unasked
    if (runningCli && !window.confirm(`${runningCli} oturumu kapanacak ve yeni klasörde yeniden başlayacak. Devam edilsin mi?`)) {
      return
    }
    setLeafFolder(dispatch, leaf, folder)
  }

  const browse = async () => {
    const pick = await window.terrarium?.pickFolder?.(effective)
    if (pick) apply(pick)
  }

  const submitTyped = () => {
    const p = cleanFolder(value)
    if (!p) {
      setTyping(false)
      return
    }
    apply(p)
  }

  const label = pinned ? folderName(pinned) : null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        title={
          pinned
            ? `Klasör: ${pinned}${effective && !same(effective, pinned) ? `\nOturum klasörü: ${effective}` : ''}`
            : 'Klasör ata…'
        }
        aria-label="Terminal klasörü"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'flex h-6 items-center gap-1 rounded-md text-[11px] transition-colors hover:bg-n5',
          // always on screen: the pinned folder's name, else a plain "Klasör" button
          label
            ? 'max-w-[132px] px-1.5 text-accent'
            : bare
              ? 'w-6 justify-center text-t4 hover:text-t1'
              : 'px-1.5 text-t3 hover:text-t1'
        )}
      >
        {label ? <FolderOpen size={11} className="shrink-0" /> : <Folder size={12} className="shrink-0" />}
        {label ? <span className="truncate">{label}</span> : !bare && <span>Klasör</span>}
      </button>

      {open && (
        <div
          role="menu"
          onDragStart={(e) => e.preventDefault()}
          className="pop-surface pop-in absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl p-1"
        >
          <p className="micro-label px-2 pb-1 pt-1.5 !text-[10px] !tracking-[0.07em] !text-t4">
            Çalışma klasörü
          </p>

          <Row
            checked={!pinned}
            label="Proje klasörü"
            detail={projectRoot ? folderName(projectRoot) : undefined}
            title={projectRoot}
            onSelect={() => apply(undefined)}
          />

          {choices.length > 0 && <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />}
          {choices.map((p) => (
            <Row
              key={p}
              checked={same(p, pinned)}
              label={folderName(p)}
              detail={p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0]}
              title={p}
              onSelect={() => apply(p)}
            />
          ))}

          <div className="-mx-1 my-1 h-px bg-[var(--border-subtle)]" />

          <button
            type="button"
            onClick={() => void browse()}
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <span className="w-3 shrink-0" />
            Klasör seç…
          </button>

          {typing ? (
            <input
              autoFocus
              type="text"
              value={value}
              spellCheck={false}
              placeholder="C:\Ataberk\proje"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitTyped()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setTyping(false)
                  setValue('')
                }
              }}
              className="h-7 w-full rounded-lg border border-[var(--border-default)] bg-n1 px-2 font-mono text-[12px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] outline-none transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.45)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setValue(pinned ?? '')
                setTyping(true)
              }}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
            >
              <span className="w-3 shrink-0" />
              Yol yaz…
            </button>
          )}

          <p className="px-2 pb-1.5 pt-1 text-[10.5px] leading-snug text-t4">
            Sabit kalır; sen değiştirmedikçe bu terminal hep burada açılır.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({
  checked,
  label,
  detail,
  title,
  onSelect
}: {
  checked: boolean
  label: string
  detail?: string
  title?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      title={title}
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
      {detail && <span className="max-w-[88px] truncate font-mono text-[10px] text-t4">{detail}</span>}
    </button>
  )
}
