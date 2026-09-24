import { useEffect, useState } from 'react'
import { LayoutGrid, ListChecks, BookOpen, SquareTerminal, GraduationCap, Settings } from 'lucide-react'
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
    'flex h-5 w-5 items-center justify-center rounded text-[12px] text-t3 transition-colors hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-30'
  const changed = Math.abs(zoom.factor - 1) > 0.001
  return (
    <div
      className="no-drag flex h-6 items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-n2 px-0.5"
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

export function Titlebar() {
  const zoom = useAppZoom()
  const captionH = useCaptionHeight()
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)

  return (
    <header
      className="drag-region flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-base px-3 select-none"
      style={captionH ? { height: Math.max(captionH, 35) } : undefined}
    >
      {/* brand */}
      <div className="no-drag flex items-center gap-2 pr-3">
        <span
          className="block h-2.5 w-2.5 rounded-[3px]"
          style={{ background: 'var(--color-accent)' }}
        />
        <span className="text-[13px] font-semibold tracking-tight text-t1">terrarium</span>
      </div>

      {/* mode switch — segmented */}
      <nav className="no-drag flex items-center gap-0.5 rounded-md bg-n2 p-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={clsx(
              'relative flex h-6 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors duration-100',
              view === id
                ? 'bg-n4 text-t1'
                : id === 'quiz' && view === 'wiki'
                  ? 'text-t2 hover:text-t1'
                  : 'text-t3 hover:text-t2'
            )}
          >
            <Icon size={13} strokeWidth={1.8} />
            {label}
          </button>
        ))}
        {/* wiki — nested under Quiz, same roof */}
        <span className="mx-0.5 h-3.5 w-px self-center bg-n5" />
        <button
          onClick={() => setView('wiki')}
          title="Wiki (beta)"
          aria-label="Wiki (beta)"
          className={clsx(
            'relative flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-colors duration-100',
            view === 'wiki' ? 'bg-n4 text-t1' : 'text-t3 hover:text-t2'
          )}
        >
          <BookOpen size={11} strokeWidth={1.8} />
          Wiki
          <span className="rounded-full bg-accent-subtle px-1 py-px text-[9px] font-medium leading-none text-accent">
            beta
          </span>
        </button>
      </nav>

      <div className="flex-1" />

      {/* command palette trigger */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="no-drag hidden h-6 items-center gap-2 rounded-md border border-[var(--border-default)] bg-n2 px-2.5 text-[12px] text-t3 transition-colors hover:text-t2 md:flex"
      >
        <span>Search or command…</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <ZoomControl zoom={zoom} />
      <SaveButton />
      <MobileButton />
      <SoundToggle />
      <button
        onClick={() => useApp.getState().setSettingsOpen(true)}
        title="Ayarlar"
        className="no-drag flex h-6 w-6 items-center justify-center rounded-md text-t3 transition-colors hover:bg-n3 hover:text-t1"
      >
        <Settings size={13} strokeWidth={1.8} />
      </button>

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
