// ── downloads panel — recent Downloads next to Pano ─────────────────────
// The newest files in the OS Downloads folder (main/downloads.ts). Click an
// item → its path goes into the terminal last focused (lib/clip-target);
// drag it → a native file drag, so it drops onto any terminal (path goes
// in) or out of the app (Explorer, a browser upload, a chat). Open / show
// in folder / copy path sit on hover.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Check, Copy, Download, ExternalLink, FileIcon, FolderOpen, SquareTerminal, X } from 'lucide-react'
import { insertClip, useClipTarget } from '../lib/clip-target'
import { uiTap } from '../lib/sfx'
import { Empty, IconAction, ago, terminalLabel } from './ClipboardPanel'

interface DownloadItem {
  path: string
  name: string
  size: number
  at: number
}

interface Thumb {
  dataUrl: string
  width: number
  height: number
  /** true = the shell's file-type icon, not a picture of the file */
  icon: boolean
}

// ── host bridge (narrowed like clipHistoryBridge — lib/ipc.ts predates it) ──
interface DownloadsBridge {
  list(): Promise<{ dir: string; files: DownloadItem[] }>
  thumb(path: string): Promise<Thumb | null>
  open(path: string): Promise<boolean>
  reveal(path: string): Promise<boolean>
  startDrag(path: string): void
  onChange(cb: () => void): () => void
}

function downloadsBridge(): DownloadsBridge | undefined {
  return (window.terrarium as { downloads?: DownloadsBridge } | undefined)?.downloads
}

const PANEL_W = 392

function fileSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/** What an attach types: the path, quoted when it has spaces, then a space. */
function pathText(p: string): string {
  return `${/\s/.test(p) ? `"${p}"` : p} `
}

export function DownloadsButton() {
  const bridge = downloadsBridge()
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  // a dot while closed: a download finished since the last look
  useEffect(() => bridge?.onChange(() => setFresh(true)), [bridge])

  if (!bridge) return null
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          uiTap()
          setOpen((v) => !v)
          setFresh(false)
        }}
        title="İndirilenler — son indirilen dosyalar"
        className={clsx(
          'group/dl relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all active:scale-[0.98]',
          open
            ? 'border-[rgba(245,165,36,0.45)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-n3))] text-t1'
            : 'border-[var(--border-default)] bg-n3 text-t2 hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1'
        )}
      >
        <Download
          size={12}
          className="text-[var(--color-accent)] transition-transform duration-300 group-hover/dl:translate-y-px"
        />
        <span>İndirilenler</span>
        {fresh && !open && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_rgba(245,165,36,0.7)]" />
        )}
      </button>
      {open && <DownloadsPanel anchor={btnRef} onClose={() => setOpen(false)} />}
    </>
  )
}

function DownloadsPanel({
  anchor,
  onClose
}: {
  anchor: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const bridge = downloadsBridge()!
  const [files, setFiles] = useState<DownloadItem[]>([])
  const [dir, setDir] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<number | null>(null)
  const target = useClipTarget()

  const refresh = useCallback(() => {
    void bridge
      .list()
      .then((r) => {
        setFiles(r.files)
        setDir(r.dir)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [bridge])

  useEffect(() => {
    refresh()
    const off = bridge.onChange(refresh)
    return () => {
      off()
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [bridge, refresh])

  // anchor under the button, right edges aligned, kept on screen
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.min(Math.max(8, r.right - PANEL_W), window.innerWidth - PANEL_W - 8)
      setPos({ top: r.bottom + 6, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  // outside click / Escape closes — drags out of the panel don't count
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node
      if (panelRef.current?.contains(n) || anchor.current?.contains(n)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  const say = (ok: boolean, text: string) => {
    setFlash({ ok, text })
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600)
  }

  const attach = (f: DownloadItem) => {
    if (insertClip({ kind: 'text', text: pathText(f.path) })) say(true, `Eklendi → ${terminalLabel(target!)}`)
    else say(false, 'Önce bir terminale tıkla')
  }

  const copyPath = (f: DownloadItem) => {
    void navigator.clipboard
      ?.writeText(f.path)
      .then(() => say(true, 'Yol panoya kopyalandı'))
      .catch(() => say(false, 'Kopyalanamadı'))
  }

  const openFile = (f: DownloadItem) => {
    void bridge.open(f.path).then((ok) => !ok && say(false, 'Açılamadı'))
  }

  if (!pos) return null
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="İndirilenler"
      className="pop-in fixed z-50 flex max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-popover shadow-[var(--shadow-pop),0_32px_80px_-24px_rgba(0,0,0,0.7)] [transform-origin:top_right] select-none"
      style={{ top: pos.top, left: pos.left, width: PANEL_W }}
    >
      {/* header */}
      <div className="pane-head flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pr-1.5 pl-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-subtle text-accent ring-1 ring-[rgba(245,165,36,0.22)] ring-inset">
          <Download size={12.5} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-t1">İndirilenler</h2>
        <span className="tnum rounded-full bg-n3 px-1.5 text-[10px] leading-4 font-medium text-t3">
          {files.length}
        </span>
        <button
          type="button"
          onClick={() => void bridge.reveal('')}
          title={dir || 'İndirilenler klasörü'}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-t3 transition-colors hover:bg-n4 hover:text-t1"
        >
          <FolderOpen size={12} />
          Klasörü aç
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Kapat"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>

      {/* where a click lands */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-n2/50 px-3.5 text-[11px]">
        <span className="micro-label">Hedef</span>
        {target ? (
          <span className="flex min-w-0 items-center gap-1.5 text-t2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-done)] shadow-[0_0_6px_var(--color-done)]" />
            <SquareTerminal size={11.5} className="shrink-0 text-t3" />
            <span className="truncate font-medium text-t1">{terminalLabel(target)}</span>
          </span>
        ) : (
          <span className="text-t4">yok — bir terminale tıkla ya da sürükle-bırak</span>
        )}
      </div>

      {/* body */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {files.length === 0 ? (
          <div className="p-1">
            <Empty loaded={loaded} icon={<Download size={16} />} text="İndirilenler klasörü boş." />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {files.map((f) => (
              <FileRow
                key={f.path}
                item={f}
                onAttach={() => attach(f)}
                onDrag={() => bridge.startDrag(f.path)}
                onOpen={() => openFile(f)}
                onReveal={() => void bridge.reveal(f.path)}
                onCopy={() => copyPath(f)}
              />
            ))}
          </div>
        )}
      </div>

      {/* footer — hint, or the result of the last action */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-t border-[var(--border-subtle)] px-3.5 text-[11px]">
        {flash ? (
          <span
            className={clsx(
              'flex min-w-0 items-center gap-1.5 truncate',
              flash.ok ? 'text-[var(--color-done)]' : 'text-[var(--color-needs)]'
            )}
          >
            {flash.ok ? <Check size={12} /> : <X size={12} />}
            <span className="truncate">{flash.text}</span>
          </span>
        ) : (
          <span className="truncate text-t4">
            Tıkla → yolu terminale ekle · Sürükle → terminale ya da başka uygulamaya bırak
          </span>
        )}
      </div>
    </div>,
    document.body
  )
}

function FileRow({
  item,
  onAttach,
  onDrag,
  onOpen,
  onReveal,
  onCopy
}: {
  item: DownloadItem
  onAttach: () => void
  onDrag: () => void
  onOpen: () => void
  onReveal: () => void
  onCopy: () => void
}) {
  const [thumb, setThumb] = useState<Thumb | null>(null)
  useEffect(() => {
    let live = true
    void downloadsBridge()
      ?.thumb(item.path)
      .then((t) => live && setThumb(t))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [item.path, item.at])

  const dot = item.name.lastIndexOf('.')
  const ext = dot > 0 ? item.name.slice(dot + 1).toUpperCase() : ''
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        // a native OS drag instead of an HTML one — the only kind that
        // carries a real file to Explorer, browsers and other apps
        e.preventDefault()
        onDrag()
      }}
      onClick={onAttach}
      onDoubleClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onAttach()}
      title={`${item.path}\nTıkla: yolu seçili terminale ekle · Çift tıkla: aç · Sürükle: istediğin yere bırak`}
      className="group/row relative flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--border-subtle)] hover:bg-n3"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-sunken">
        {thumb ? (
          <img
            src={thumb.dataUrl}
            alt=""
            draggable={false}
            className={thumb.icon ? 'h-6 w-6 object-contain' : 'h-full w-full object-cover'}
          />
        ) : (
          <FileIcon size={14} className="text-t4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-t1">{item.name}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-t4">
          <span>{ago(item.at)}</span>
          <span>·</span>
          <span className="tnum">{fileSize(item.size)}</span>
          {ext && (
            <>
              <span>·</span>
              <span>{ext}</span>
            </>
          )}
        </span>
      </span>
      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
        <IconAction label="Aç" onClick={onOpen}>
          <ExternalLink size={11} />
        </IconAction>
        <IconAction label="Klasörde göster" onClick={onReveal}>
          <FolderOpen size={11} />
        </IconAction>
        <IconAction label="Yolu kopyala" onClick={onCopy}>
          <Copy size={11} />
        </IconAction>
      </div>
    </div>
  )
}
