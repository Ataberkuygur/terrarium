// ── Terminal — xterm.js over the PtyBridge ───────────────────────────
// Attach to an existing session (sessionId) or spawn a new one
// (spawnOpts). Rendering prefers WebGL and falls back to the DOM
// renderer when the context is lost. Sessions outlive the component —
// unmounting detaches, it never kills the pty.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import {
  TERMINAL_RENDER_EVENT,
  TERMINALS_REPAINT_EVENT,
  noteWebglContextLoss,
  pixelSnappedFont,
  registerAtlasClearer,
  releaseWebglSlot,
  requestAtlasRebuild,
  tryAcquireWebglSlot,
  webglPreferred
} from '../lib/terminal-render'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ClipboardPaste, Copy, Eraser, TextSelect } from 'lucide-react'
import clsx from 'clsx'
import type { PtyBridge, PtySpawnOpts } from '../../../shared/pty'
import { registerScrollbackReader } from '../lib/terminal-classify'
import {
  insertClip,
  isClipDrag,
  isFileDrag,
  noteTerminalFocus,
  readClipDrag,
  readFileDrop,
  registerClipTerminal
} from '../lib/clip-target'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'

// Dark theme on the app tokens — bg sunken, fg t1, cursor accent amber,
// ANSI palette tuned for the dark ramp.
const TERMINAL_THEME: ITheme = {
  background: '#08090B',
  foreground: '#F2F3F5',
  cursor: '#F5A524',
  cursorAccent: '#171006',
  selectionBackground: 'rgba(245, 165, 36, 0.28)',
  selectionInactiveBackground: 'rgba(245, 165, 36, 0.16)',
  black: '#16171B',
  red: '#E5484D',
  green: '#46A758',
  yellow: '#FFB224',
  blue: '#47A8FF',
  magenta: '#BF7AF0',
  cyan: '#3BC8DB',
  white: '#A9ABB3',
  brightBlack: '#6E7078',
  brightRed: '#F2555A',
  brightGreen: '#63C174',
  brightYellow: '#FFC53D',
  brightBlue: '#69B4FF',
  brightMagenta: '#D09CFF',
  brightCyan: '#5ADFE9',
  brightWhite: '#F2F3F5'
}

// Right-click menu rows — same chrome as the LayoutMenu popover.
const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-t3 transition-colors hover:bg-n3 hover:text-t1 disabled:pointer-events-none disabled:opacity-35'

// ── font stack ───────────────────────────────────────────────────────
// xterm paints glyphs through a canvas `ctx.font` string — a raw CSS
// font declaration where var() is NEVER resolved. Passing
// 'var(--font-mono)' dropped the whole declaration and every terminal
// silently rendered in the default '10px sans-serif' — the real reason
// font/size changes did nothing. Resolve the token to real families.
function monoFontStack(): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono')
    .trim()
  return v || `'Cascadia Code', 'Cascadia Mono', Consolas, monospace`
}

// ── Ctrl+wheel font zoom, per session ────────────────────────────────
// Stored as an offset from the caller's fontSize, keyed by session id, so
// it survives remounts (view/tab switches unmount the whole workspace) and
// a fontSize prop change (e.g. an orchestration card expanding 11→13)
// keeps the user's bump instead of wiping it.
const FONT_BUMP_KEY = 'terrarium.term-font-bump'
const FONT_MIN = 8
const FONT_MAX = 28

// Smallest grid a fit may produce. A pane measured mid-collapse, inside a
// 0-size/hidden container or mid-animation proposes 2×1 (FitAddon's floor)
// — forwarding that to the pty makes the TUI redraw into two columns and
// the screen is lost for good. Such fits are skipped instead.
const MIN_FIT_COLS = 10
const MIN_FIT_ROWS = 2
/** Host smaller than this (CSS px) is treated as hidden / unmeasurable. */
const MIN_HOST_PX = 16

// ── pty size ownership ───────────────────────────────────────────────
// One session can be on screen in several views at once (workspace pane +
// focus dock, orchestration card, a remount overlapping its predecessor),
// but the pty has ONE size. Each view used to dedupe against what IT last
// sent, so once another view resized the pty the first never re-sent its
// own grid — the TUI kept laying out for the other width and every line
// wrapped mid-word. The last size sent per session lives here instead, and
// the view being used (focused / typed into / the one left standing when
// another unmounts) claims the pty for its own grid.
const ptySizes = new Map<string, { cols: number; rows: number }>()
/** Size claimers per session, most recently mounted last. */
const sizeClaimers = new Map<string, Array<() => void>>()

let fontBumps: Record<string, number> | null = null

function bumps(): Record<string, number> {
  if (!fontBumps) {
    try {
      fontBumps = JSON.parse(localStorage.getItem(FONT_BUMP_KEY) ?? '{}') ?? {}
    } catch {
      fontBumps = {}
    }
  }
  return fontBumps!
}

function readFontBump(sid: string | undefined): number {
  return (sid && bumps()[sid]) || 0
}

function writeFontBump(sid: string | undefined, bump: number): void {
  if (!sid) return
  const all = bumps()
  if (bump) all[sid] = bump
  else delete all[sid]
  try {
    localStorage.setItem(FONT_BUMP_KEY, JSON.stringify(all))
  } catch {
    /* storage full / unavailable — zoom just won't persist */
  }
}

export interface TerminalProps {
  /** Attach to an existing session. */
  sessionId?: string
  /** Spawn a new session when `sessionId` is unset (or attach fails to find one). */
  spawnOpts?: PtySpawnOpts
  bridge: PtyBridge
  onTitle?: (title: string) => void
  /**
   * Live-output observer — fired with each chunk after it's written to the
   * terminal. Scrollback replays don't reach this (they arrive on onReplay),
   * so it only sees real activity — e.g. for typing-tick sounds.
   */
  onData?: (data: string) => void
  className?: string
  fontSize?: number
  /**
   * Canvas zoom (pan/zoom surfaces). Scales the font WITHOUT refitting:
   * the container grows/shrinks by the same factor, so cols×rows stay put
   * and the pty never sees a resize — TUIs keep their screen intact.
   */
  zoom?: number
}

export function Terminal({
  sessionId,
  spawnOpts,
  bridge,
  onTitle,
  onData,
  className,
  fontSize = 15,
  zoom = 1
}: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [ended, setEnded] = useState(false)
  // Right-click menu — cursor coords relative to the host + whether a
  // selection existed at open time (Copy's disabled state).
  const [menu, setMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sid = sessionId ?? spawnOpts?.sessionId
  // Ctrl+wheel zoom — offset from the fontSize prop, persisted per session
  const [bump, setBump] = useState(() => readFontBump(sid))
  const size = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + bump))
  // Device-pixel ratio — changes with app zoom / moving between monitors
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1)
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])
  // whole device pixels tall — a 15.31-px glyph can't hint to the grid
  const renderSize = pixelSnappedFont(size * zoom, dpr)
  // While a canvas zoom settles the container is resizing BECAUSE of the
  // zoom — refitting then would resize the pty for nothing. Fits pause
  // until this timestamp.
  const gridLockUntil = useRef(0)
  /** Device-pixel re-alignment (set once the xterm is open). */
  const snapRef = useRef<(() => void) | null>(null)
  /** Run a layout change (fit/font) and land back on the tail after it. */
  const relayoutRef = useRef<((fn: () => void) => void) | null>(null)
  /** Fit that refuses degenerate (hidden / 0-size) measurements. */
  const safeFitRef = useRef<(() => void) | null>(null)

  // Latest callback ref — the bridge subscription lives in a [sid, bridge]
  // effect and mustn't resubscribe when the caller's inline fn changes.
  const onDataRef = useRef(onData)
  useEffect(() => {
    onDataRef.current = onData
  })

  // ── copy / paste ─────────────────────────────────────────────────
  // Electron renderers get no default edit menu — without these a pane
  // can't be copied out of at all. `term.paste` routes through onData,
  // so it reaches the pty with bracketed-paste wrapping like real typing.
  const copySelection = () => {
    const sel = termRef.current?.getSelection()
    if (sel) void navigator.clipboard?.writeText(sel).catch(() => {})
  }
  const pasteClipboard = () => {
    void navigator.clipboard
      ?.readText()
      .then((t) => {
        if (t) termRef.current?.paste(t)
      })
      .catch(() => {})
  }

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      canCopy: termRef.current?.hasSelection() ?? false
    })
  }

  const runItem = (fn: () => void) => () => {
    fn()
    setMenu(null)
    termRef.current?.focus()
  }

  // Dismiss the menu: outside pointerdown, Esc, wheel scroll, window
  // blur/resize — the same affordances as LayoutMenu.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    const host = hostRef.current
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    host?.addEventListener('wheel', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      host?.removeEventListener('wheel', close, true)
    }
  }, [menu])

  // The host is overflow:hidden — right-clicks near an edge would clip
  // the menu. Measure once it mounts and nudge it back inside.
  useLayoutEffect(() => {
    const m = menuRef.current
    const host = hostRef.current
    if (!menu || !m || !host) return
    const hb = host.getBoundingClientRect()
    const mb = m.getBoundingClientRect()
    const dx = Math.min(0, hb.right - 4 - mb.right)
    const dy = Math.min(0, hb.bottom - 4 - mb.bottom)
    if (dx || dy) {
      setMenu((cur) => cur && { ...cur, x: Math.max(0, cur.x + dx), y: Math.max(0, cur.y + dy) })
    }
  }, [menu])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !sid) return

    setEnded(false)

    const term = new XTerm({
      theme: TERMINAL_THEME,
      fontFamily: monoFontStack(),
      fontSize: renderSize,
      fontWeight: 500,
      fontWeightBold: 700,
      lineHeight: 1.25,
      letterSpacing: 0.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      smoothScrollDuration: 120,
      fastScrollSensitivity: 6,
      minimumContrastRatio: 4.5,
      drawBoldTextInBrightColors: true
    })
    termRef.current = term

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(el)

    // Fit, but never to a degenerate grid: a hidden (display:none /
    // collapsed / mid-transition) host measures 0 and FitAddon would
    // shrink to 2×1 — reflowing the buffer and resizing the pty so the
    // TUI repaints into two columns (the "whole screen vanished" case).
    // Returns true when the host was measurable.
    const safeFit = (): boolean => {
      if (el.clientWidth < MIN_HOST_PX || el.clientHeight < MIN_HOST_PX) return false
      try {
        const d = fit.proposeDimensions()
        if (
          !d ||
          !Number.isFinite(d.cols) ||
          !Number.isFinite(d.rows) ||
          d.cols < MIN_FIT_COLS ||
          d.rows < MIN_FIT_ROWS
        ) {
          return false
        }
        fit.fit()
        return true
      } catch {
        return false // not measurable yet — ResizeObserver will retry
      }
    }
    safeFitRef.current = () => {
      safeFit()
    }

    // Editing keys — the browser's copy/paste commands never reach xterm's
    // textarea in Electron, so own them here. Copy on ctrl+shift+C, and on
    // ctrl+C only while a selection exists (otherwise it stays SIGINT);
    // paste on ctrl/cmd+shift+V and plain ctrl/cmd+V — VS Code / Windows
    // Terminal conventions. Returning false swallows the key for xterm.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || e.altKey) return true
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'c' && (e.shiftKey || term.hasSelection())) {
        copySelection()
        return false
      }
      if (mod && key === 'v') {
        pasteClipboard()
        return false
      }
      return true
    })

    // Expose the live buffer to the domain classifier — the 5000-line
    // scrollback is the richest evidence source and includes output that
    // predates any event tap.
    const scrollUnreg = registerScrollbackReader(sid, () => {
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = Math.max(0, buf.length - 120); i < buf.length; i++) {
        const l = buf.getLine(i)?.translateToString(true)
        if (l?.trim()) lines.push(l)
      }
      return lines.join('\n')
    })

    // Renderer: WebGL (fast, grayscale AA) or xterm's DOM renderer (real
    // browser text — ClearType-crisp on low-density screens). Chosen by
    // lib/terminal-render and swapped live on density/setting changes;
    // disposing the WebGL addon drops xterm back to DOM by itself.
    //
    // Context loss: Chromium evicts the oldest WebGL context once too many
    // are live — the canvas goes blank at once, and the addon only reports
    // it 3 s later (it waits for a restore). Catch the raw event ourselves,
    // drop to DOM immediately and stay there (`webglBroken`) — re-creating
    // a context on the next window resize would just evict another pane.
    // Only an explicit renderer-setting change retries WebGL.
    //
    // Zombie contexts: disposing the addon only drops its canvas — the GL
    // context lives on until GC and still counts toward Chromium's cap. So
    // every card flip / remount / renderer swap leaked one, and the cap
    // then evicted the OLDEST live context: a terminal on the hidden mode
    // layer, found black on switching back. Release it explicitly.
    let webgl: WebglAddon | null = null
    let webglCtx: WebGL2RenderingContext | null = null
    let webglBroken = false
    let disposed = false
    let atlasHealRaf = 0
    const dropWebgl = () => {
      const w = webgl
      if (!w) return
      const gl = webglCtx
      webgl = null
      webglCtx = null
      releaseWebglSlot()
      try {
        // the addon's own disposable swaps xterm back to the DOM renderer
        w.dispose()
      } catch {
        /* already gone */
      }
      try {
        if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
      } catch {
        /* context already released */
      }
    }
    /** The GL context the addon just created — the canvas that appeared with it. */
    const findWebglCtx = (before: Set<Element>): WebGL2RenderingContext | null => {
      for (const c of term.element?.querySelectorAll('canvas') ?? []) {
        if (before.has(c)) continue
        // a canvas already holding a 2D context returns null here — never creates one
        const gl = (c as HTMLCanvasElement).getContext('webgl2')
        if (gl) return gl
      }
      return null
    }
    const applyRenderer = () => {
      if (disposed) return
      const want = webglPreferred() && !webglBroken
      if (want && !webgl) {
        if (tryAcquireWebglSlot()) {
          try {
            const w = new WebglAddon()
            w.onContextLoss(() => {
              if (webgl !== w) return
              noteWebglContextLoss()
              webglBroken = true
              dropWebgl()
              requestAnimationFrame(() => healRef.current?.(true))
            })
            // Shared-atlas page merge: every terminal on the atlas sees its
            // pages deleted and re-indexed, but a GL texture is re-uploaded
            // only when its page's version differs — a shifted page (or the
            // merged one appended at the end) can land on an index whose
            // stale texture carries the same version number, so other panes
            // sample the wrong page and draw black. The heal's resize path
            // re-binds the atlas (every texture re-uploaded) and rebuilds
            // the model. One per frame, whatever the burst size.
            w.onRemoveTextureAtlasCanvas(() => {
              if (webgl !== w || atlasHealRaf) return
              atlasHealRaf = requestAnimationFrame(() => {
                atlasHealRaf = 0
                healRef.current?.(true)
              })
            })
            const before = new Set<Element>(term.element?.querySelectorAll('canvas') ?? [])
            term.loadAddon(w)
            webgl = w
            webglCtx = findWebglCtx(before)
          } catch {
            releaseWebglSlot()
            webglBroken = true
            webgl = null
          }
        }
      } else if (!want && webgl) {
        dropWebgl()
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          snapRef.current?.()
          healRef.current?.(false)
        })
      )
    }
    const onGlContextLost = () => {
      if (disposed || !webgl) return
      noteWebglContextLoss()
      webglBroken = true
      // out of the canvas's own event dispatch before tearing it down
      setTimeout(() => {
        if (disposed) return
        dropWebgl()
        requestAnimationFrame(() => healRef.current?.(true))
      }, 0)
    }
    // non-bubbling, but capture on an ancestor still sees it
    el.addEventListener('webglcontextlost', onGlContextLost, true)
    const onRenderSetting = () => {
      webglBroken = false // explicit user choice — give WebGL another go
      applyRenderer()
    }
    // Shared-atlas rebuilds (see requestAtlasRebuild) reach every WebGL
    // terminal in one synchronous pass.
    const atlasUnreg = registerAtlasClearer(() => {
      if (!disposed && webgl) term.clearTextureAtlas()
    })
    /** Late-bound: the heal routine needs snap/fit, defined further down. */
    const healRef: { current: ((force: boolean) => void) | null } = { current: null }
    applyRenderer()
    window.addEventListener(TERMINAL_RENDER_EVENT, onRenderSetting)
    window.addEventListener('resize', applyRenderer)

    // ── stay on the tail ────────────────────────────────────────────
    // A pane opens scrolled to the bottom and stays there through
    // replays (view/tab switches), refits and font/zoom changes — xterm
    // otherwise drifts off the tail when rows or cell metrics change.
    // Only a deliberate scroll-up by the user holds a position.
    //
    // Intent, not position, decides: a zoom or resize changes row height
    // and the DOM viewport's scrollHeight, and the browser clamps/re-reads
    // scrollTop a frame or two later — xterm then "scrolls" to wherever
    // that lands (top, middle). So a scroll only counts as the user's when
    // a wheel/key/pointer gesture just happened; every other move away
    // from the tail is layout drift and is pulled straight back.
    let followTail = true
    let userUntil = 0
    let pointerDown = false
    const userGesture = () => {
      userUntil = Date.now() + 500
    }
    const atTail = () => {
      const b = term.buffer.active
      return b.viewportY >= b.baseY
    }
    const toTail = () => {
      if (disposed || !followTail) return
      try {
        if (!atTail()) term.scrollToBottom()
      } catch {
        /* disposed */
      }
    }
    let driftRaf = 0
    const onAnyScroll = () => {
      if (disposed) return
      if (pointerDown || Date.now() < userUntil) {
        followTail = atTail()
        return
      }
      if (followTail && !atTail()) {
        cancelAnimationFrame(driftRaf)
        driftRaf = requestAnimationFrame(toTail)
      }
    }
    const relayout = (fn: () => void) => {
      fn()
      toTail()
      requestAnimationFrame(() => {
        toTail()
        requestAnimationFrame(toTail)
      })
      // the viewport's own resync lands a little later still
      setTimeout(toTail, 120)
      setTimeout(toTail, 320)
    }
    relayoutRef.current = relayout
    const scrollSub = term.onScroll(onAnyScroll)
    // user wheel/scrollbar drags move the DOM viewport without onScroll
    const viewportEl = term.element?.querySelector('.xterm-viewport')
    viewportEl?.addEventListener('scroll', onAnyScroll, { passive: true })
    const onWheelIntent = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) userGesture()
    }
    const onKeyIntent = (e: KeyboardEvent) => {
      if (/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown)$/.test(e.key) && e.shiftKey) userGesture()
    }
    const onPointerDownIntent = () => {
      pointerDown = true
      userGesture()
    }
    const onPointerUpIntent = () => {
      if (!pointerDown) return
      pointerDown = false
      userGesture()
      followTail = atTail()
    }
    el.addEventListener('wheel', onWheelIntent, { capture: true, passive: true })
    el.addEventListener('keydown', onKeyIntent, true)
    el.addEventListener('pointerdown', onPointerDownIntent, true)
    window.addEventListener('pointerup', onPointerUpIntent, true)
    window.addEventListener('pointercancel', onPointerUpIntent, true)
    // typing always returns to the prompt (xterm's scrollOnUserInput)
    const typeSub = term.onData(() => {
      followTail = true
    })

    relayout(() => {
      safeFit()
    })

    // ── wire the bridge ─────────────────────────────────────────────
    // Subscribe BEFORE spawn/attach so early output and the replay are
    // never missed. Replay is a data event flagged replay → delivered on
    // onReplay; reset first so it repaints rather than appends.
    //
    // `replaying` gates terminal→pty input while the replay parses:
    // scrollback can contain OSC color queries (\x1b]10;? / ]11;? — TUIs
    // probe light/dark on startup) which xterm auto-answers via onData.
    // Forwarded to the pty, that answer lands as typed text at the shell
    // prompt — the 'rgb:0809/0b' garbage after a view switch. The program
    // that asked is long past reading a response; dropping it is correct.
    //
    // The host broadcasts a replay to EVERY listener of the session, so any
    // other attach (a second view of it mounting, an orchestration card
    // flipping from preview to live, a pre-spawn probe) would reset this
    // pane — already current — and repaint it from a raw ring whose head
    // may be cut mid-TUI: a black screen. Only take the replay this pane
    // asked for.
    let replaying = false
    let cancelled = false
    let awaitingReplay = 0
    const attachOwn = async () => {
      awaitingReplay++
      try {
        return await bridge.attach(sid)
      } finally {
        // replay precedes the attach reply; hold the gate one more task
        setTimeout(() => {
          awaitingReplay--
        }, 0)
      }
    }
    const unsubs = [
      bridge.onData(sid, (data) => {
        if (cancelled) return
        try {
          term.write(data)
          onDataRef.current?.(data)
        } catch {
          /* ignore writes to disposed or resetting terminal */
        }
      }),
      bridge.onReplay(sid, (data) => {
        if (cancelled || awaitingReplay === 0) return
        try {
          replaying = true
          term.reset()
          term.write(data, () => {
            replaying = false
            // a reattached pane lands on its latest output
            followTail = true
            relayout(() => {})
          })
        } catch {
          replaying = false
        }
      }),
      bridge.onExit(sid, ({ exitCode }) => {
        if (cancelled) return
        setEnded(true)
        try {
          term.write(`\r\n\x1b[2m— process exited (code ${exitCode}) —\x1b[0m\r\n`)
        } catch {
          /* terminal disposed */
        }
      }),
      bridge.onStatus(sid, (status) => {
        if (cancelled) return
        if (status === 'dead') {
          setEnded(true)
          try {
            term.write(`\r\n\x1b[2m— terminal host lost; respawn to continue —\x1b[0m\r\n`)
          } catch {
            /* terminal disposed */
          }
        }
      })
    ]

    const inputSub = term.onData((data) => {
      if (replaying || cancelled) return
      // typing claims the pty for this grid — but not auto-answers to TUI
      // queries from a view nobody is looking at
      if (el.contains(document.activeElement)) claimSize()
      bridge.write(sid, data)
    })
    const titleSub = term.onTitleChange((title) => {
      if (!cancelled) onTitle?.(title)
    })
    // pty resizes trail the grid: a divider drag or window resize refits
    // xterm every frame, but the CLI only gets the final size — one
    // redraw instead of a storm of half-drawn frames
    let ptyResizeTimer: ReturnType<typeof setTimeout> | undefined
    /** Hand the pty this view's grid unless it already has it (see ptySizes). */
    const claimSize = () => {
      clearTimeout(ptyResizeTimer)
      const { cols, rows } = term
      // never hand the pty a degenerate grid (see safeFit)
      if (cancelled || cols < MIN_FIT_COLS || rows < MIN_FIT_ROWS) return
      const cur = ptySizes.get(sid)
      if (cur && cur.cols === cols && cur.rows === rows) return
      ptySizes.set(sid, { cols, rows })
      bridge.resize(sid, cols, rows)
    }
    const claimers = sizeClaimers.get(sid) ?? []
    claimers.push(claimSize)
    sizeClaimers.set(sid, claimers)
    const resizeSub = term.onResize(({ cols, rows }) => {
      requestAnimationFrame(() => requestAnimationFrame(() => snapRef.current?.()))
      if (cancelled || cols < MIN_FIT_COLS || rows < MIN_FIT_ROWS) return
      clearTimeout(ptyResizeTimer)
      ptyResizeTimer = setTimeout(claimSize, 90)
    })

    // Device-pixel snap. At fractional devicePixelRatios (125% Windows
    // scaling, app zoom) panes land on sub-pixel offsets and the compositor
    // resamples the WebGL canvas — soft, smeared text. Nudge the xterm root
    // by the leftover fraction so its canvas starts on a whole device pixel.
    // xterm also rounds each canvas's CSS size to whole CSS px, so at a
    // fractional ratio a 1190-px backing store is shown 1190.36 device px
    // wide — stretched, filtered, blurry. Pin CSS size to backing / dpr.
    // sub-pixel nudge currently applied to the xterm root (see snap)
    let snapDx = 0
    let snapDy = 0
    const snap = () => {
      const root = term.element
      if (cancelled || !root) return
      const dpr = window.devicePixelRatio || 1
      const screen = (root.querySelector('.xterm-screen') as HTMLElement | null) ?? root
      for (const c of screen.querySelectorAll('canvas')) {
        if (!c.width || !c.height) continue
        const w = c.width / dpr + 'px'
        const h = c.height / dpr + 'px'
        if (c.style.width !== w) c.style.width = w
        if (c.style.height !== h) c.style.height = h
      }
      // measure with the current nudge factored out instead of clearing
      // it first — a clear + re-set every tick invalidated style/paint on
      // every terminal even when nothing had moved
      const r = screen.getBoundingClientRect()
      const fx = ((((r.left - snapDx) * dpr) % 1) + 1) % 1
      const fy = ((((r.top - snapDy) * dpr) % 1) + 1) % 1
      const dx = fx > 0.01 && fx < 0.99 ? (1 - fx) / dpr : 0
      const dy = fy > 0.01 && fy < 0.99 ? (1 - fy) / dpr : 0
      if (dx === snapDx && dy === snapDy) return
      snapDx = dx
      snapDy = dy
      root.style.translate = dx || dy ? dx + 'px ' + dy + 'px' : ''
    }
    // position can move without a resize (pan, drag, sibling reflow)
    snapRef.current = snap

    // ── self-heal ───────────────────────────────────────────────────
    // Blank-pane safety net. `force` repaints unconditionally (focus,
    // tab/window becoming visible, size recovering from 0, renderer swap);
    // otherwise only when the render surface is visibly broken: screen
    // element collapsed, a 0-size canvas, or the DOM renderer's row
    // container emptied while the host has room. The repaint goes through
    // the render service's resize path, which also drops the WebGL
    // renderer's cached model — a plain refresh() would skip "unchanged"
    // cells and leave them blank.
    const heal = (force: boolean) => {
      if (cancelled || disposed) return
      const root = term.element
      if (!root || el.clientWidth < MIN_HOST_PX || el.clientHeight < MIN_HOST_PX) return
      let broken = false
      // a context lost without its event reaching us (evicted while the
      // pane sat on a hidden layer) draws nothing — drop to DOM for good
      if (webgl && webglCtx?.isContextLost()) {
        noteWebglContextLoss()
        webglBroken = true
        dropWebgl()
        broken = true
      }
      const screen = root.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen || screen.offsetWidth < 2 || screen.offsetHeight < 2) broken = true
      if (screen && !broken) {
        for (const c of screen.querySelectorAll('canvas')) {
          if (!c.width || !c.height) broken = true
        }
        if (!webgl) {
          const rows = screen.querySelector('.xterm-rows')
          if (rows && rows.childElementCount === 0 && term.rows > 0) broken = true
        }
      }
      if (!force && !broken) return
      if (broken || term.cols < MIN_FIT_COLS || term.rows < MIN_FIT_ROWS) safeFit()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(term as any)._core?._renderService?.handleResize(term.cols, term.rows)
      } catch {
        /* private API moved — the refresh below still helps */
      }
      try {
        term.refresh(0, term.rows - 1)
      } catch {
        /* disposed */
      }
      snap()
    }
    healRef.current = heal

    const onLayoutSettled = () =>
      requestAnimationFrame(() => {
        snap()
        heal(false)
      })
    window.addEventListener('terrarium:layout-settled', onLayoutSettled)
    window.addEventListener('resize', onLayoutSettled)
    const snapTimer = setInterval(() => {
      // hidden window / collapsed host: nothing on screen to keep crisp
      if (document.hidden || !el.offsetParent) return
      snap()
      heal(false)
    }, 2000)
    // focusing a pane always repaints it — the user's "click to fix"
    const onFocusIn = () =>
      requestAnimationFrame(() => {
        claimSize()
        heal(true)
      })
    el.addEventListener('focusin', onFocusIn)
    // GPU work can be dropped while the window is hidden/minimised
    const onVisibility = () => {
      if (document.visibilityState === 'visible') requestAnimationFrame(() => heal(true))
    }
    document.addEventListener('visibilitychange', onVisibility)
    // a hidden workspace layer showing again (see WorkspaceView modeLayer)
    const onRepaint = () => requestAnimationFrame(() => heal(true))
    window.addEventListener(TERMINALS_REPAINT_EVENT, onRepaint)

    // Container resize → refit (debounced to one per frame). onResize
    // then forwards the new grid size to the pty. A host collapsing to 0
    // (display:none tab, collapsed split) skips the fit; when it comes
    // back the pane is refit and force-repainted.
    let raf = 0
    let hostWasHidden = false
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (cancelled) return
        if (el.clientWidth < MIN_HOST_PX || el.clientHeight < MIN_HOST_PX) {
          hostWasHidden = true
          return
        }
        const recovered = hostWasHidden
        hostWasHidden = false
        if (recovered || Date.now() >= gridLockUntil.current) {
          relayout(() => {
            safeFit()
          })
        }
        snap()
        requestAnimationFrame(() => {
          snap()
          if (recovered) heal(true)
        })
      })
    })
    observer.observe(el)

    // Webfont race — the bundled JetBrains Mono arrives after the first
    // fit, changing cell metrics; refit when fonts settle so the canvas
    // ends up exactly container-sized (a stale measure leaves it clipped).
    const onFontsReady = () => {
      if (cancelled) return
      requestAnimationFrame(() => {
        if (cancelled) return
        relayout(() => {
          safeFit()
        })
      })
    }
    void document.fonts?.ready.then(onFontsReady)
    document.fonts?.addEventListener?.('loadingdone', onFontsReady)

    // Attach to an existing session; otherwise spawn. If spawn reports
    // the id already running (StrictMode double-mount, view remount),
    // fall back to attach — the replay repaints state anyway.
    // The pty's real size (another view, the mobile remote or the last app
    // run may have left it elsewhere) — re-lay the TUI out for this grid,
    // which also repaints over a replay recorded at another width.
    const syncSize = (info: Awaited<ReturnType<typeof attachOwn>> | null) => {
      if (!info || info.status !== 'running' || cancelled) return
      ptySizes.set(sid, { cols: info.cols, rows: info.rows })
      claimSize()
    }
    const connect = async () => {
      if (sessionId) {
        const info = await attachOwn().catch(() => null)
        syncSize(info)
        // Exited/dead stubs linger in the supervisor — a bound pane's
        // command is what it RUNS, so respawn rather than replay a corpse
        // (otherwise re-resuming a session shows its dead tail forever).
        if (
          !cancelled &&
          spawnOpts &&
          (!info || info.status === 'exited' || info.status === 'dead')
        ) {
          await doSpawn()
        }
        return
      }
      if (!cancelled) await doSpawn()
    }
    const doSpawn = async () => {
      if (!spawnOpts || cancelled) return
      try {
        const { cols, rows } = term
        ptySizes.set(sid, { cols, rows })
        await bridge.spawn({ ...spawnOpts, cols, rows })
      } catch {
        // spawn refused (already running) — its size is not ours
        ptySizes.delete(sid)
        if (!cancelled) syncSize(await attachOwn().catch(() => null))
      }
    }
    void connect()

    return () => {
      cancelled = true
      clearTimeout(ptyResizeTimer)
      // hand the pty back to a view still showing this session (after any
      // remount in the same commit has registered, so that one wins)
      const rest = (sizeClaimers.get(sid) ?? []).filter((c) => c !== claimSize)
      if (rest.length) sizeClaimers.set(sid, rest)
      else sizeClaimers.delete(sid)
      if (rest.length) setTimeout(() => sizeClaimers.get(sid)?.at(-1)?.(), 0)
      clearInterval(snapTimer)
      window.removeEventListener('terrarium:layout-settled', onLayoutSettled)
      window.removeEventListener('resize', onLayoutSettled)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('webglcontextlost', onGlContextLost, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(TERMINALS_REPAINT_EVENT, onRepaint)
      healRef.current = null
      safeFitRef.current = null
      atlasUnreg()
      observer.disconnect()
      cancelAnimationFrame(raf)
      document.fonts?.removeEventListener?.('loadingdone', onFontsReady)
      viewportEl?.removeEventListener('scroll', onAnyScroll)
      el.removeEventListener('wheel', onWheelIntent, true)
      el.removeEventListener('keydown', onKeyIntent, true)
      el.removeEventListener('pointerdown', onPointerDownIntent, true)
      window.removeEventListener('pointerup', onPointerUpIntent, true)
      window.removeEventListener('pointercancel', onPointerUpIntent, true)
      cancelAnimationFrame(driftRaf)
      cancelAnimationFrame(atlasHealRaf)
      try {
        typeSub.dispose()
      } catch {
        /* already disposed */
      }
      relayoutRef.current = null
      try {
        scrollSub.dispose()
      } catch {
        /* already disposed */
      }
      scrollUnreg()
      try {
        inputSub.dispose()
      } catch {
        /* already disposed */
      }
      try {
        titleSub.dispose()
      } catch {
        /* already disposed */
      }
      try {
        resizeSub.dispose()
      } catch {
        /* already disposed */
      }
      for (const u of unsubs) {
        try {
          u()
        } catch {
          /* listener unbind error */
        }
      }
      disposed = true
      window.removeEventListener(TERMINAL_RENDER_EVENT, onRenderSetting)
      window.removeEventListener('resize', applyRenderer)
      dropWebgl()
      // Defer dispose one macrotask — xterm queues viewport/refresh work on
      // rAF; a synchronous dispose (StrictMode double-mount, fast remount)
      // leaves those callbacks hitting a torn-down render service. Letting
      // the queue flush first keeps the console clean.
      setTimeout(() => {
        try {
          term.dispose()
        } catch {
          /* term disposal error */
        }
      }, 0)
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, bridge])

  // Font-size changes → refit the grid; canvas-zoom changes → rescale
  // the font only and hold the grid (see gridLockUntil)
  const lastSize = useRef(size)
  const lastZoom = useRef(zoom)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settleTimer.current), [])
  // layout effect: the lock must be in place before the ResizeObserver
  // sees the zoom-driven container change
  useLayoutEffect(() => {
    const term = termRef.current
    if (!term) return
    // only a canvas-zoom change holds the grid; a font or density change
    // (app zoom resizes the pane in CSS px too) refits normally
    const zoomOnly = size === lastSize.current && zoom !== lastZoom.current
    lastSize.current = size
    lastZoom.current = zoom
    const apply = () => {
      term.options.fontSize = renderSize
      if (!zoomOnly) safeFitRef.current?.()
    }
    try {
      if (zoomOnly) {
        gridLockUntil.current = Date.now() + 450
        // Once the zoom settles, the held grid must still fit: font px are
        // snapped to device pixels, so rows*cell can outgrow the pane and
        // clip the prompt line. Refit then if it overflows (or leaves a
        // clearly empty band); a ±1 cell of slack keeps the pty untouched.
        clearTimeout(settleTimer.current)
        settleTimer.current = setTimeout(() => {
          const t = termRef.current
          const dims = fitRef.current?.proposeDimensions()
          if (!t || !dims || !dims.cols || !dims.rows) return
          const overflow = dims.rows < t.rows || dims.cols < t.cols
          const slack = dims.rows - t.rows >= 2 || dims.cols - t.cols >= 3
          if (!overflow && !slack) return
          const refit = () => safeFitRef.current?.()
          if (relayoutRef.current) relayoutRef.current(refit)
          else refit()
        }, 480)
      }
      // cell metrics change → keep the tail in view
      if (relayoutRef.current) relayoutRef.current(apply)
      else apply()
      // the WebGL glyph atlas can keep stale-size glyphs after a font
      // change (smeared/overlapping text) — rebuild it once settled. The
      // atlas is SHARED between terminals, so this must be the coordinated
      // all-terminals rebuild: clearing it from one terminal alone blanked
      // every other pane on the same atlas (see requestAtlasRebuild).
      requestAtlasRebuild()
      requestAnimationFrame(() => requestAnimationFrame(() => snapRef.current?.()))
    } catch {
      /* not measurable or term disposed */
    }
  }, [size, zoom, renderSize])

  // Same component re-pointed at another session → that session's zoom.
  const bumpSid = useRef(sid)
  useEffect(() => {
    if (bumpSid.current === sid) return
    bumpSid.current = sid
    setBump(readFontBump(sid))
  }, [sid])

  // ── clip target + drop zone (lib/clip-target) ──
  // Focus marks this pane as where ClipPeek / the clipboard panel attach;
  // a clip dragged onto it is inserted like an attach would.
  const [dropHot, setDropHot] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => {
    const el = hostRef.current
    if (!el || !sid) return
    const off = registerClipTerminal(sid, {
      el,
      paste: (t) => termRef.current?.paste(t),
      focus: () => termRef.current?.focus()
    })
    const onFocus = () => noteTerminalFocus(sid)
    el.addEventListener('focusin', onFocus)
    return () => {
      off()
      el.removeEventListener('focusin', onFocus)
    }
  }, [sid])
  const droppable = (dt: DataTransfer) => isClipDrag(dt) || isFileDrag(dt)
  const onDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!droppable(e.dataTransfer)) return
    e.preventDefault()
    dragDepth.current++
    setDropHot(true)
  }
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!droppable(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!droppable(e.dataTransfer)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setDropHot(false)
  }
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    dragDepth.current = 0
    setDropHot(false)
    // a file (Explorer, Downloads panel) goes in as its path
    const clip = readClipDrag(e.dataTransfer) ?? readFileDrop(e.dataTransfer)
    if (!clip || !sid) return
    e.preventDefault()
    insertClip(clip, sid)
  }

  // Ctrl+wheel zoom — native listener (React's is passive and can't
  // preventDefault); xterm's own scroll stays untouched without the mod.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setBump((b) => {
        const cur = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + b))
        const next = Math.min(FONT_MAX, Math.max(FONT_MIN, cur + (e.deltaY < 0 ? 1 : -1))) - fontSize
        writeFontBump(sid, next)
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fontSize, sid])

  return (
    <div
      ref={hostRef}
      className={clsx('terrarium-terminal', ended && 'terrarium-terminal--ended', className)}
      data-session={sid}
      onContextMenu={onContextMenu}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropHot && (
        <div className="pointer-events-none absolute inset-1 z-50 grid place-items-center rounded-lg border-2 border-dashed border-[var(--color-accent)] bg-[rgba(245,165,36,0.07)]">
          <span className="rounded-full bg-popover/95 px-3 py-1 text-[12px] font-medium text-accent shadow-[var(--shadow-pop)]">
            Terminale bırak
          </span>
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute z-50 w-44 rounded-lg border border-[var(--border-default)] bg-popover p-1 shadow-md-dark"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(e) => {
            // keep the host's handler from repositioning under this click
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!menu.canCopy}
            onClick={runItem(copySelection)}
            className={MENU_ITEM}
          >
            <Copy size={11} strokeWidth={1.75} />
            Copy
            <span className="ml-auto tnum text-[10.5px] text-t4">Ctrl+C</span>
          </button>
          <button type="button" role="menuitem" onClick={runItem(pasteClipboard)} className={MENU_ITEM}>
            <ClipboardPaste size={11} strokeWidth={1.75} />
            Paste
            <span className="ml-auto tnum text-[10.5px] text-t4">Ctrl+V</span>
          </button>
          <div className="my-1 h-px bg-[var(--border-default)]" />
          <button
            type="button"
            role="menuitem"
            onClick={runItem(() => termRef.current?.selectAll())}
            className={MENU_ITEM}
          >
            <TextSelect size={11} strokeWidth={1.75} />
            Select All
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={runItem(() => termRef.current?.clear())}
            className={MENU_ITEM}
          >
            <Eraser size={11} strokeWidth={1.75} />
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
