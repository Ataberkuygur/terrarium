// ── clipboard panel — photo / text history next to Tidy ─────────────────
// Everything main's watcher kept (main/clip-history.ts): copied images as
// a thumbnail grid, copied texts as a list. Click an item → it goes into
// the terminal last focused (lib/clip-target); drag it → onto any
// terminal. Copy puts it back on the system clipboard; trash forgets it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  Check,
  ClipboardList,
  Copy,
  FolderOpen,
  ImageIcon,
  SquareTerminal,
  Trash2,
  Type,
  X
} from 'lucide-react'
import {
  clipHistoryBridge,
  insertClip,
  setClipDrag,
  useClipTarget,
  type ClipPayload
} from '../lib/clip-target'
import { commandSessionId } from '../lib/panes'
import { paneLeafBySid } from '../lib/pane-bridge'
import { useOrch } from '../lib/orchestration'
import { uiTap } from '../lib/sfx'

type Tab = 'images' | 'texts'
interface ImageItem {
  path: string
  at: number
}
interface TextItem {
  id: string
  text: string
  at: number
}

const TAB_KEY = 'terrarium.clipPanel.tab'
const PANEL_W = 392

/** Human name for a terminal session — pane title or orchestration card. */
export function terminalLabel(sid: string): string {
  const leaf = paneLeafBySid(sid)
  if (leaf?.title) return leaf.title
  for (const net of useOrch.getState().networks) {
    for (const node of [net.orchestrator, ...net.agents]) {
      if (commandSessionId(node) !== sid) continue
      if (node.title) return node.title
      return node.role === 'orchestrator' ? `${net.name} · orkestratör` : net.name
    }
  }
  return 'Terminal'
}

export function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 45) return 'şimdi'
  if (s < 3600) return `${Math.round(s / 60)} dk`
  if (s < 86_400) return `${Math.round(s / 3600)} sa`
  if (s < 2 * 86_400) return 'dün'
  return new Date(at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'texts' ? 'texts' : 'images'
  } catch {
    return 'images'
  }
}

export function ClipboardButton() {
  const bridge = clipHistoryBridge()
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  // a dot while closed: something new landed since the last look
  useEffect(() => {
    if (!bridge) return
    const t = window.terrarium as { onClipboardImage?: (cb: () => void) => () => void } | undefined
    const mark = () => setFresh(true)
    const offImg = t?.onClipboardImage?.(mark)
    const offTxt = bridge.onText(mark)
    return () => {
      offImg?.()
      offTxt()
    }
  }, [bridge])

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
        title="Pano — kopyalanan fotoğraflar ve metinler"
        className={clsx(
          'group/clip relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all active:scale-[0.98]',
          open
            ? 'border-[rgba(245,165,36,0.45)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-n3))] text-t1'
            : 'border-[var(--border-default)] bg-n3 text-t2 hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1'
        )}
      >
        <ClipboardList
          size={12}
          className="text-[var(--color-accent)] transition-transform duration-300 group-hover/clip:-rotate-6"
        />
        <span>Pano</span>
        {fresh && !open && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_rgba(245,165,36,0.7)]" />
        )}
      </button>
      {open && <ClipboardPanel anchor={btnRef} onClose={() => setOpen(false)} />}
    </>
  )
}

function ClipboardPanel({
  anchor,
  onClose
}: {
  anchor: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const bridge = clipHistoryBridge()!
  const [tab, setTab] = useState<Tab>(readTab)
  const [images, setImages] = useState<ImageItem[]>([])
  const [texts, setTexts] = useState<TextItem[]>([])
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
        setImages(r.images)
        setTexts(r.texts)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [bridge])

  useEffect(() => {
    refresh()
    const t = window.terrarium as { onClipboardImage?: (cb: () => void) => () => void } | undefined
    const offImg = t?.onClipboardImage?.(refresh)
    const offTxt = bridge.onText(refresh)
    return () => {
      offImg?.()
      offTxt()
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

  const pickTab = (t: Tab) => {
    setTab(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* per-viewer nicety only */
    }
  }

  const say = (ok: boolean, text: string) => {
    setFlash({ ok, text })
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600)
  }

  const attach = (p: ClipPayload) => {
    if (insertClip(p)) say(true, `Eklendi → ${terminalLabel(target!)}`)
    else say(false, 'Önce bir terminale tıkla')
  }

  const copy = (kind: 'image' | 'text', id: string) => {
    void bridge.copy(kind, id).then((ok) => say(ok, ok ? 'Panoya kopyalandı' : 'Kopyalanamadı'))
  }

  const remove = (kind: 'image' | 'text', id: string) => {
    if (kind === 'image') setImages((xs) => xs.filter((x) => x.path !== id))
    else setTexts((xs) => xs.filter((x) => x.id !== id))
    void bridge.remove(kind, id)
  }

  if (!pos) return null
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Pano"
      className="pop-in fixed z-50 flex max-h-[min(72vh,620px)] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-popover shadow-[var(--shadow-pop),0_32px_80px_-24px_rgba(0,0,0,0.7)] [transform-origin:top_right] select-none"
      style={{ top: pos.top, left: pos.left, width: PANEL_W }}
    >
      {/* header — title + segmented photo/text switch */}
      <div className="pane-head flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pr-1.5 pl-3.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-subtle text-accent ring-1 ring-[rgba(245,165,36,0.22)] ring-inset">
          <ClipboardList size={12.5} strokeWidth={2} />
        </span>
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-t1">Pano</h2>
        <div className="ml-auto flex items-center rounded-lg border border-[var(--border-subtle)] bg-n2 p-0.5">
          <TabButton active={tab === 'images'} onClick={() => pickTab('images')} count={images.length}>
            <ImageIcon size={11.5} />
            Fotoğraflar
          </TabButton>
          <TabButton active={tab === 'texts'} onClick={() => pickTab('texts')} count={texts.length}>
            <Type size={11.5} />
            Metinler
          </TabButton>
        </div>
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
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === 'images' ? (
          images.length === 0 ? (
            <Empty loaded={loaded} icon={<ImageIcon size={16} />} text="Henüz fotoğraf yok — ekran görüntüsü al ya da bir resim kopyala." />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img) => (
                <ImageTile
                  key={img.path}
                  item={img}
                  onAttach={() => attach({ kind: 'image', path: img.path })}
                  onCopy={() => copy('image', img.path)}
                  onReveal={() =>
                    void (window.terrarium as { showItem?: (p: string) => Promise<unknown> } | undefined)?.showItem?.(img.path)
                  }
                  onRemove={() => remove('image', img.path)}
                />
              ))}
            </div>
          )
        ) : texts.length === 0 ? (
          <Empty loaded={loaded} icon={<Type size={16} />} text="Henüz metin yok — kopyaladığın metinler burada birikir." />
        ) : (
          <div className="flex flex-col gap-1">
            {texts.map((t) => (
              <TextRow
                key={t.id}
                item={t}
                onAttach={() => attach({ kind: 'text', text: t.text })}
                onCopy={() => copy('text', t.id)}
                onRemove={() => remove('text', t.id)}
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
            Tıkla → seçili terminale ekle · Sürükle → istediğin terminale bırak
          </span>
        )}
      </div>
    </div>,
    document.body
  )
}

function TabButton({
  active,
  onClick,
  count,
  children
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors',
        active ? 'bg-n4 text-t1 shadow-[var(--shadow-card)]' : 'text-t3 hover:text-t1'
      )}
    >
      {children}
      <span
        className={clsx(
          'tnum rounded-full px-1 text-[9.5px] leading-[14px]',
          active ? 'bg-accent-subtle text-accent' : 'bg-n3 text-t4'
        )}
      >
        {count}
      </span>
    </button>
  )
}

export function Empty({ loaded, icon, text }: { loaded: boolean; icon: React.ReactNode; text: string }) {
  if (!loaded) return <div className="py-10 text-center text-[11.5px] text-t4">Yükleniyor…</div>
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border-default)] px-6 py-9 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-n3 text-t3">{icon}</span>
      <p className="text-[11.5px] leading-relaxed text-t4">{text}</p>
    </div>
  )
}

export function IconAction({
  label,
  onClick,
  danger,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-md bg-popover/90 text-t3 shadow-sm backdrop-blur transition-colors',
        danger
          ? 'hover:bg-[rgba(229,72,77,0.16)] hover:text-[var(--color-needs)]'
          : 'hover:bg-n4 hover:text-t1'
      )}
    >
      {children}
    </button>
  )
}

function ImageTile({
  item,
  onAttach,
  onCopy,
  onReveal,
  onRemove
}: {
  item: ImageItem
  onAttach: () => void
  onCopy: () => void
  onReveal: () => void
  onRemove: () => void
}) {
  const [thumb, setThumb] = useState<{ dataUrl: string; width: number; height: number } | null>(null)
  useEffect(() => {
    let live = true
    void clipHistoryBridge()
      ?.thumb(item.path)
      .then((t) => live && setThumb(t))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [item.path])

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => setClipDrag(e, { kind: 'image', path: item.path })}
      onClick={onAttach}
      onKeyDown={(e) => e.key === 'Enter' && onAttach()}
      title={`${item.path}\nTıkla: seçili terminale ekle · Sürükle: terminale bırak`}
      className="group/tile relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-sunken transition-[border-color,transform] hover:border-[rgba(245,165,36,0.45)] active:scale-[0.97]"
    >
      {thumb ? (
        <img src={thumb.dataUrl} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-t4">
          <ImageIcon size={14} />
        </div>
      )}
      <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100">
        <IconAction label="Panoya kopyala" onClick={onCopy}>
          <Copy size={11} />
        </IconAction>
        <IconAction label="Klasörde göster" onClick={onReveal}>
          <FolderOpen size={11} />
        </IconAction>
        <IconAction label="Sil" onClick={onRemove} danger>
          <Trash2 size={11} />
        </IconAction>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[9.5px] font-medium text-white/85">
        <span>{ago(item.at)}</span>
        {thumb && (
          <span className="tnum opacity-0 transition-opacity group-hover/tile:opacity-100">
            {thumb.width}×{thumb.height}
          </span>
        )}
      </div>
    </div>
  )
}

function TextRow({
  item,
  onAttach,
  onCopy,
  onRemove
}: {
  item: TextItem
  onAttach: () => void
  onCopy: () => void
  onRemove: () => void
}) {
  const lines = item.text.split('\n').length
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => setClipDrag(e, { kind: 'text', text: item.text })}
      onClick={onAttach}
      onKeyDown={(e) => e.key === 'Enter' && onAttach()}
      title="Tıkla: seçili terminale yapıştır · Sürükle: terminale bırak"
      className="group/row relative cursor-pointer rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-[var(--border-subtle)] hover:bg-n3"
    >
      <p className="line-clamp-3 font-mono text-[11.5px] leading-[1.45] break-all whitespace-pre-wrap text-t1">
        {item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-t4">
        <span>{ago(item.at)}</span>
        <span>·</span>
        <span className="tnum">{item.text.length.toLocaleString('tr-TR')} karakter</span>
        {lines > 1 && (
          <>
            <span>·</span>
            <span className="tnum">{lines} satır</span>
          </>
        )}
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
        <IconAction label="Panoya kopyala" onClick={onCopy}>
          <Copy size={11} />
        </IconAction>
        <IconAction label="Sil" onClick={onRemove} danger>
          <Trash2 size={11} />
        </IconAction>
      </div>
    </div>
  )
}
