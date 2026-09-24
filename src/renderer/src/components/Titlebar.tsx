import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LayoutGrid, ListChecks, BookOpen, SquareTerminal, GraduationCap, Settings, Search } from 'lucide-react'
import { useApp, type View } from '../lib/store'
import { SoundToggle } from './SoundToggle'
import { MobileButton } from './MobileButton'
import { SaveButton } from './SaveButton'
import clsx from 'clsx'
import { useAppZoom, type AppZoom } from '../lib/app-zoom'

const TABS: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'office', label: 'Office', icon: LayoutGrid },
  { id: 'board', label: 'Tasks', icon: ListChecks },
  { id: 'workspace', label: 'Workspace', icon: SquareTerminal },
  { id: 'quiz', label: 'Quiz', icon: GraduationCap }
]

/** − 100% + — Ctrl+= / Ctrl+- / Ctrl+0 do the same from anywhere. */
function ZoomControl({ zoom }: { zoom: AppZoom }) {
  const btn =
    'flex h-5 w-5 items-center justify-center rounded-[5px] text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-30'
  const changed = Math.abs(zoom.factor - 1) > 0.001
  return (
    <div
      className="no-drag tool-group h-7 !gap-0 !p-[3px]"
      title={
        zoom.available
          ? 'App zoom — Ctrl+= / Ctrl+- / Ctrl+0'
          : 'App zoom arrives after one app restart (Ctrl+0 resets meanwhile)'
      }
    >
      <button type="button" className={btn} disabled={!zoom.available} onClick={() => zoom.step(-1)}>
        −
      </button>
      <button
        type="button"
        disabled={!zoom.available}
        onClick={zoom.reset}
        className={clsx(
          'tnum h-5 min-w-[38px] rounded px-1 text-[10.5px] transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none',
          !zoom.available ? 'text-t4' : changed ? 'text-accent' : 'text-t3'
        )}
      >
        {Math.round(zoom.factor * 100)}%
      </button>
      <button type="button" className={btn} disabled={!zoom.available} onClick={() => zoom.step(1)}>
        +
      </button>
    </div>
  )
}

/**
 * Height of the Windows caption-button overlay in CSS px (Window Controls
 * Overlay API). The titlebar must be at least this tall or the min/max/
 * close buttons hang over whatever toolbar sits underneath — the root font
 * is 14px, so h-10 is only 35px against the 40px overlay.
 */
function useCaptionHeight(): number {
  const [h, setH] = useState(0)
  useEffect(() => {
    const wco = (navigator as unknown as {
      windowControlsOverlay?: EventTarget & { visible: boolean; getTitlebarAreaRect(): DOMRect }
    }).windowControlsOverlay
    if (!wco) return
    const read = () => setH(wco.visible ? Math.ceil(wco.getTitlebarAreaRect().height) : 0)
    read()
    wco.addEventListener('geometrychange', read)
    window.addEventListener('resize', read)
    return () => {
      wco.removeEventListener('geometrychange', read)
      window.removeEventListener('resize', read)
    }
  }, [])
  return h
}

/** Slides a thumb under the active tab — measured, so labels can be any width. */
function useThumb(active: string) {
  const navRef = useRef<HTMLElement>(null)
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const el = nav.querySelector<HTMLElement>(`[data-tab="${active}"]`)
      setThumb(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [active])
  return { navRef, thumb }
}

export function Titlebar() {
  const zoom = useAppZoom()
  const captionH = useCaptionHeight()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const { navRef, thumb } = useThumb(view)

  return (
    <header
      className="chrome-bar drag-region flex h-10 shrink-0 items-center gap-2 px-3 select-none"
      style={captionH ? { height: Math.max(captionH, 35) } : undefined}
    >
      {/* brand */}
      <div className="no-drag flex items-center gap-2 pr-2">
        <span className="brand-glyph relative block h-[15px] w-[15px] rounded-[4.5px]">
          <span className="absolute inset-[4px] rounded-[2px] bg-[rgba(23,16,6,0.55)]" />
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-t1">terrarium</span>
      </div>

      {/* mode switch — segmented, sliding thumb */}
      <nav ref={navRef} className="seg-track no-drag gap-0.5">
        {thumb && (
          <span aria-hidden className="seg-thumb" style={{ left: 0, width: thumb.w, transform: `translateX(${thumb.x}px)` }} />
        )}
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-tab={id}
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
            className={clsx(
              'relative z-[1] flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium transition-colors duration-150',
              view === id ? 'text-t1' : 'text-t3 hover:text-t2'
            )}
          >
            <Icon size={13} strokeWidth={view === id ? 2 : 1.8} className={view === id ? 'text-accent' : undefined} />
            {label}
          </button>
        ))}
        {/* wiki — nested under Quiz, same roof */}
        <span className="relative z-[1] mx-0.5 h-3.5 w-px self-center bg-n6" />
        <button
          data-tab="wiki"
          onClick={() => setView('wiki')}
          title="Wiki (beta)"
          aria-label="Wiki (beta)"
          aria-current={view === 'wiki' ? 'page' : undefined}
          className={clsx(
            'relative z-[1] flex h-[26px] items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] font-medium transition-colors duration-150',
            view === 'wiki' ? 'text-t1' : 'text-t3 hover:text-t2'
          )}
        >
          <BookOpen size={12} strokeWidth={1.8} className={view === 'wiki' ? 'text-accent' : undefined} />
          Wiki
          <span className="rounded-full bg-accent-subtle px-1.5 py-px text-[9px] font-semibold leading-[12px] tracking-wide text-accent uppercase">
            beta
          </span>
        </button>
      </nav>

      <div className="flex-1" />

      {/* command palette trigger */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="no-drag group hidden h-7 w-[240px] items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-n1/70 pr-1 pl-2.5 text-[12px] text-t4 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors hover:border-[var(--border-default)] hover:text-t3 lg:flex"
      >
        <Search size={12} strokeWidth={2} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left whitespace-nowrap">Search or run a command…</span>
        <span className="kbd !text-[10px]">Ctrl K</span>
      </button>
      <span className="mx-0.5 h-4 w-px bg-[var(--border-default)]" />
      <ZoomControl zoom={zoom} />
      <div className="no-drag flex items-center gap-0.5">
        <SaveButton />
        <MobileButton />
        <SoundToggle />
        <button
          onClick={() => useApp.getState().setSettingsOpen(true)}
          title="Ayarlar"
          className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n4 hover:text-t1"
        >
          <Settings size={14} strokeWidth={1.8} />
        </button>
      </div>

      {/* Windows caption buttons (min/max/close) live on top of the window's
          right edge — keep this lane clear so app buttons never sit under
          them. env(titlebar-area-*) gives the exact overlay width when the
          runtime exposes it; 138px (3 × 46px captions) is the floor so the
          spacer never collapses where the env vars don't resolve. */}
      <div
        aria-hidden
        className="shrink-0"
        style={{
          // captions are 138 DEVICE px; under app zoom z that's 138/z CSS px
          width: `max(${Math.ceil(138 / zoom.factor) + 4}px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))`
        }}
      />
    </header>
  )
}
