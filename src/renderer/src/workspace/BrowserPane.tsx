// ── BrowserPane — in-app webview pane for the workspace ─────────────────────
// A `browser` leaf: compact nav chrome (back/fwd/reload, location input,
// open-external, copy) over an Electron <webview> guest. Main owns the sandbox
// policy — guests are locked to http(s) on the persist:terrarium-browse partition,
// permissions denied, window.open routed to the OS browser — so this file is
// just the chrome plus state mirroring: refId = committed URL, title = page
// title, so the serialized pane layout restores the last location.
// Outside Electron (browser-mock dev) webviews don't exist — we degrade to a
// same-origin iframe when the URL is embeddable, else an "open externally"
// hint.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe,
  Link2,
  Loader2,
  RotateCw,
  TerminalSquare,
  X
} from 'lucide-react'
import type { PaneLeaf } from '../lib/panes'
import {
  boundSidFor,
  focusPaneLeaf,
  focusedPaneLeafId,
  paneHooksVersion,
  paneLeafById,
  registerBrowserPane,
  subscribePaneHooks
} from '../lib/pane-bridge'
import { getPtyBridge } from '../terminal'
import { usePaneDispatch } from './pane-context'

// ── <webview> element type ──────────────────────────────────────────────────
// @types/react ships a `webview` intrinsic (src/partition/… props, ref typed
// HTMLWebViewElement). The ref here is Electron.WebviewTag — the ambient
// Electron namespace (the renderer never imports 'electron' itself) — which
// extends HTMLElement, so it satisfies HTMLWebViewElement structurally while
// exposing the guest API (loadURL, goBack, did-* events…).

// ── constants & helpers ─────────────────────────────────────────────────────

/** Guest partition — main force-assigns the same value in will-attach-webview. */
const PARTITION = 'persist:terrarium-browse'

const SEARCH_BASE = 'https://duckduckgo.com/?q='

/** net::ERR_ABORTED — stop(), a superseded navigation, or a cancelled load. */
const ERR_ABORTED = -3

/**
 * Bare input → navigable URL. Existing http(s) passes through; other schemes
 * (file:, mailto:, vscode:…) are flagged external — the webview partition
 * rejects them anyway. No scheme: localhost / IP / host:port dev servers go to
 * http, dotted names to https, everything else to a DuckDuckGo search.
 */
function resolveTarget(raw: string): { url: string; external: boolean } | null {
  const v = raw.trim()
  if (!v) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    return { url: v, external: !/^https?:\/\//i.test(v) }
  }
  if (/\s/.test(v)) return { url: `${SEARCH_BASE}${encodeURIComponent(v)}`, external: false }
  if (
    /^localhost(:\d+)?([/?#]|$)/i.test(v) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(v) ||
    /^[\w-]+:\d+([/?#]|$)/.test(v)
  ) {
    return { url: `http://${v}`, external: false }
  }
  if (v.includes('.')) return { url: `https://${v}`, external: false }
  return { url: `${SEARCH_BASE}${encodeURIComponent(v)}`, external: false }
}

/** Guest navigation — loadURL once attached, src attribute before attach. */
function loadGuest(wv: Electron.WebviewTag, url: string): void {
  try {
    void wv.loadURL(url).catch(() => {
      /* surfaced via did-fail-load */
    })
  } catch {
    // not attached yet — assigning src triggers attach + load
    try {
      if (wv.getAttribute('partition') !== PARTITION) wv.setAttribute('partition', PARTITION)
      wv.setAttribute('src', url)
    } catch {
      /* guest detached or unmounted */
    }
  }
}

/** OS browser via the preload bridge; plain window.open in browser-mock dev. */
function openExternally(url: string): void {
  if (window.terrarium?.openExternal) void window.terrarium.openExternal(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}

const navBtn =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-t4 transition-colors hover:bg-n5 hover:text-t2 disabled:pointer-events-none disabled:opacity-30'

const actionBtn =
  'flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n3 px-2.5 text-[11.5px] text-t2 transition-colors hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1'

// ── component ────────────────────────────────────────────────────────────────

export function BrowserPane({ leaf }: { leaf: PaneLeaf }) {
  const dispatch = usePaneDispatch()
  // webviewTag needs Electron's renderer — window.terrarium only exists when the
  // preload injected it. Absent → plain-browser dev fallback.
  const desktop = typeof window.terrarium?.platform === 'string'

  const [draft, setDraft] = useState(leaf.refId ?? '')
  const [current, setCurrent] = useState(() => resolveTarget(leaf.refId ?? '')?.url ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [copied, setCopied] = useState(false)
  const [epoch, setEpoch] = useState(0) // reload nudge for the iframe fallback

  const wvRef = useRef<Electron.WebviewTag | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Latest leaf — webview handlers are bound once but must see fresh props. */
  const leafRef = useRef(leaf)
  leafRef.current = leaf
  /** Last URL sent to / seen from the guest — guards echo reloads. */
  const lastNavRef = useRef(current)

  // ── guest event wiring — bound once per element; cleanup on unmount ──
  useEffect(() => {
    if (!desktop) return
    const wv = wvRef.current
    if (!wv) return

    const syncHistory = () => {
      try {
        setCanBack(wv.canGoBack())
        setCanFwd(wv.canGoForward())
      } catch {
        // guest not attached yet
      }
    }
    const commitUrl = (url: string) => {
      lastNavRef.current = url
      setCurrent(url)
      setError(null)
      // don't clobber text the user is typing into the location input
      if (document.activeElement !== inputRef.current) setDraft(url)
      dispatch?.({ type: 'update', leafId: leafRef.current.id, patch: { refId: url } })
    }
    const onNavigate = (e: Electron.DidNavigateEvent) => {
      commitUrl(e.url)
      syncHistory()
    }
    const onInPage = (e: Electron.DidNavigateInPageEvent) => {
      if (!e.isMainFrame) return
      commitUrl(e.url)
      syncHistory()
    }
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => {
      const title = e.title.trim()
      if (title && title !== leafRef.current.title) {
        dispatch?.({ type: 'update', leafId: leafRef.current.id, patch: { title } })
      }
    }
    const onStartLoading = () => {
      setLoading(true)
      setError(null)
    }
    const onStopLoading = () => {
      setLoading(false)
      syncHistory()
    }
    const onFail = (e: Electron.DidFailLoadEvent) => {
      // subframe failures are noise; ABORTED = stop() or a newer navigation
      if (!e.isMainFrame || e.errorCode === ERR_ABORTED) return
      setLoading(false)
      setError(`${e.errorDescription} (${e.errorCode})`)
    }
    const onGone = (e: Event) => {
      setLoading(false)
      const detail = e as unknown as { reason?: string }
      const reason = detail?.reason ?? 'crashed'
      if (reason !== 'clean-exit') {
        setError(`Browser process stopped: ${reason}`)
      }
    }

    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-start-loading', onStartLoading)
    wv.addEventListener('did-stop-loading', onStopLoading)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('render-process-gone', onGone)

    // a remounted guest (leaf swap → new key) starts blank — restore location
    if (lastNavRef.current && !wv.getAttribute('src')) {
      loadGuest(wv, lastNavRef.current)
    }
    return () => {
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-start-loading', onStartLoading)
      wv.removeEventListener('did-stop-loading', onStopLoading)
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('render-process-gone', onGone)
    }
    // leaf.id: the webview is keyed by it — a leaf swap remounts the element,
    // so listeners must rebind to the new guest.
  }, [desktop, dispatch, leaf.id])

  // ── leaf.refId → guest ──
  // Mount (initial src) and external leaf updates land here. RefId changes the
  // pane itself dispatched short-circuit through lastNavRef — otherwise every
  // did-navigate would re-load the page it just reported.
  useEffect(() => {
    const target = resolveTarget(leaf.refId ?? '')
    if (!target || target.external || target.url === lastNavRef.current) return
    lastNavRef.current = target.url
    setCurrent(target.url)
    if (document.activeElement !== inputRef.current) setDraft(target.url)
    const wv = wvRef.current
    if (desktop && wv) loadGuest(wv, target.url)
  }, [desktop, leaf.refId])

  // ── actions ──

  const navigate = (raw: string) => {
    const target = resolveTarget(raw)
    if (!target) return
    if (target.external) {
      openExternally(target.url)
      return
    }
    lastNavRef.current = target.url
    setCurrent(target.url)
    setDraft(target.url)
    setError(null)
    dispatch?.({ type: 'update', leafId: leaf.id, patch: { refId: target.url } })
    const wv = wvRef.current
    if (desktop && wv) loadGuest(wv, target.url)
    if (!desktop) setEpoch((n) => n + 1) // same-URL iframe won't reload on its own
  }

  const goBack = () => {
    try {
      wvRef.current?.goBack()
    } catch {
      /* guest not attached */
    }
  }
  const goForward = () => {
    try {
      wvRef.current?.goForward()
    } catch {
      /* guest not attached */
    }
  }
  const reloadOrStop = () => {
    const wv = wvRef.current
    if (!desktop || !wv) {
      setEpoch((n) => n + 1)
      return
    }
    try {
      if (loading) wv.stop()
      else wv.reload()
    } catch {
      /* guest not attached */
    }
  }
  const copyUrl = () => {
    if (!current) return
    void navigator.clipboard
      .writeText(current)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        /* clipboard unavailable (insecure context) */
      })
  }

  // ── pane-bridge registration ──
  // The loopback /cmd server drives this guest through the registry
  // (nav/eval/capture/dl). Callbacks go through refs so the once-bound
  // handle always sees the latest closures + leaf.
  const apiRef = useRef({ navigate, reloadOrStop })
  apiRef.current = { navigate, reloadOrStop }
  useEffect(() => {
    if (!desktop) return
    const leafId = leaf.id
    const unregister = registerBrowserPane({
      leafId,
      title: () => leafRef.current.title ?? '',
      url: () => lastNavRef.current,
      boundSid: () => boundSidFor(leafRef.current.bindLeafId),
      nav: (url) => apiRef.current.navigate(url),
      reload: () => apiRef.current.reloadOrStop(),
      activate: () => focusPaneLeaf(leafId),
      close: () => dispatch?.({ type: 'close', leafId }),
      eval: (expr) => {
        const wv = wvRef.current
        if (!wv) return Promise.reject(new Error('guest not attached'))
        try {
          return wv.executeJavaScript(expr, true)
        } catch (e) {
          return Promise.reject(e instanceof Error ? e : new Error(String(e)))
        }
      },
      capture: async () => {
        const wv = wvRef.current
        if (!wv) throw new Error('guest not attached')
        const png = (await wv.capturePage()).toPNG() as Uint8Array
        // sandboxed renderer: toPNG arrives as a Uint8Array — chunk-btoa it
        let bin = ''
        for (let i = 0; i < png.length; i += 0x8000) {
          bin += String.fromCharCode(...png.subarray(i, i + 0x8000))
        }
        return btoa(bin)
      },
      download: (url) => {
        try {
          wvRef.current?.downloadURL(url)
        } catch {
          /* guest not attached */
        }
      }
    })
    return unregister
  }, [desktop, leaf.id, dispatch])

  // ── scope binding ──
  // leaf.bindLeafId → the terminal leaf this pane belongs to. Looked up
  // live: a closed/re-kinded target reads as unbound (general), never a
  // dangling pointer. The prompt bar types into the bound terminal's pty;
  // the bridge reports the same scope as `boundSid` on `tabs`.
  // (hooks version re-read: WorkspaceView registers leafById after this
  // pane's first mount — child effects precede the parent's.)
  useSyncExternalStore(subscribePaneHooks, paneHooksVersion)
  const boundLeaf = leaf.bindLeafId ? paneLeafById(leaf.bindLeafId) : null
  const bound = boundLeaf?.kind === 'terminal' ? boundLeaf : null
  const unbind = () =>
    dispatch?.({ type: 'update', leafId: leaf.id, patch: { bindLeafId: undefined } })
  const bindToFocused = () => {
    const targetId = focusedPaneLeafId()
    if (!targetId || targetId === leaf.id) return
    if (paneLeafById(targetId)?.kind !== 'terminal') return
    dispatch?.({ type: 'update', leafId: leaf.id, patch: { bindLeafId: targetId } })
  }

  // ── bottom prompt bar ──
  // Bound → the text lands as a line in the terminal's pty (a prompt to
  // the agent CLI running there, which drives this pane back over
  // TERRARIUM_BROWSER_CMD). Unbound → same as the location input.
  const [prompt, setPrompt] = useState('')
  const submitPrompt = () => {
    const v = prompt.trim()
    if (!v) return
    const sid = boundSidFor(leaf.bindLeafId)
    if (sid) getPtyBridge().write(sid, `${v}\r`)
    else navigate(v)
    setPrompt('')
  }

  // iframe fallback: only same-origin URLs are guaranteed embeddable.
  let embeddable = false
  if (!desktop && current) {
    try {
      embeddable = new URL(current, window.location.href).origin === window.location.origin
    } catch {
      embeddable = false
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-base">
      {/* ── nav bar ── */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] bg-n2 px-1.5 select-none">
        <button
          type="button"
          className={navBtn}
          onClick={goBack}
          disabled={!canBack}
          title="Back"
          aria-label="Back"
        >
          <ChevronLeft size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={navBtn}
          onClick={goForward}
          disabled={!canFwd}
          title="Forward"
          aria-label="Forward"
        >
          <ChevronRight size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={navBtn}
          onClick={reloadOrStop}
          disabled={!current && !loading}
          title={loading ? 'Stop' : 'Reload'}
          aria-label={loading ? 'Stop loading' : 'Reload'}
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RotateCw size={12} strokeWidth={1.75} />
          )}
        </button>

        {/* scope chip — which terminal this pane belongs to */}
        {bound ? (
          <span
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--border-default)] bg-n3 px-1.5 text-[10.5px] text-t3"
            title={`Scoped to ${bound.title ?? 'terminal'} — its shell drives this pane via TERRARIUM_BROWSER_CMD`}
          >
            <TerminalSquare size={11} strokeWidth={1.75} className="shrink-0 text-[var(--color-accent)]" />
            <span className="max-w-[90px] truncate">{bound.title ?? 'terminal'}</span>
            <button
              type="button"
              onClick={unbind}
              title="Unbind — make this a general browser"
              aria-label="Unbind from terminal"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-t4 transition-colors hover:bg-n5 hover:text-t2"
            >
              <X size={10} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={bindToFocused}
            title="General browser — click to bind to the focused terminal"
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 text-[10.5px] text-t4 transition-colors hover:bg-n4 hover:text-t2"
          >
            <Globe size={11} strokeWidth={1.75} />
            general
            <Link2 size={10} strokeWidth={1.75} />
          </button>
        )}

        <input
          ref={inputRef}
          type="text"
          value={draft}
          spellCheck={false}
          placeholder="Search or enter URL"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              navigate(draft)
              inputRef.current?.blur()
            } else if (e.key === 'Escape') {
              setDraft(current)
              inputRef.current?.blur()
            }
          }}
          className="h-6 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-n3 px-2 font-mono text-[11.5px] text-t1 outline-none select-text placeholder:text-t4 focus:border-[var(--border-strong)]"
        />

        <button
          type="button"
          className={navBtn}
          onClick={() => current && openExternally(current)}
          disabled={!current}
          title="Open in external browser"
          aria-label="Open in external browser"
        >
          <ArrowUpRight size={12} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={navBtn}
          onClick={copyUrl}
          disabled={!current}
          title="Copy URL"
          aria-label="Copy URL"
        >
          {copied ? (
            <Check size={12} strokeWidth={1.75} className="text-[var(--color-done)]" />
          ) : (
            <Copy size={12} strokeWidth={1.75} />
          )}
        </button>
      </div>

      {/* ── load-failure strip ── */}
      {error && (
        <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] bg-n3 px-2 text-[11px] text-[var(--color-error)]">
          <AlertTriangle size={11} strokeWidth={1.75} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-t4 transition-colors hover:bg-n5 hover:text-t2"
            onClick={() => setError(null)}
            title="Dismiss"
            aria-label="Dismiss error"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* ── body ── */}
      <div className="relative min-h-0 flex-1 bg-n1">
        {desktop ? (
          <>
            {/* key=leaf.id: a leaf swap hands this component a new leaf —
                remount the guest instead of inheriting another pane's history */}
            <webview
              key={leaf.id}
              ref={wvRef}
              src={current || 'about:blank'}
              partition={PARTITION}
              className="absolute inset-0 flex"
            />
            {!current && <EmptyBody />}
          </>
        ) : embeddable ? (
          <iframe
            key={`${current}:${epoch}`}
            src={current}
            title={leaf.title ?? 'Browser pane'}
            className="h-full w-full border-0 bg-n1"
          />
        ) : current ? (
          <FallbackBody url={current} />
        ) : (
          <EmptyBody />
        )}
      </div>

      {/* ── prompt bar — bound: types into the terminal's pty; general:
              same as the location input ── */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-t border-[var(--border-subtle)] bg-n2 px-2 select-none">
        {bound ? (
          <TerminalSquare size={11} strokeWidth={1.75} className="shrink-0 text-[var(--color-accent)]" />
        ) : (
          <Globe size={11} strokeWidth={1.75} className="shrink-0 text-t4" />
        )}
        <input
          type="text"
          value={prompt}
          spellCheck={false}
          placeholder={
            bound
              ? `Prompt ${bound.title ?? 'terminal'} — types into its shell`
              : 'Search or enter URL'
          }
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitPrompt()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setPrompt('')
              e.currentTarget.blur()
            }
          }}
          className="h-6 min-w-0 flex-1 bg-transparent text-[11.5px] text-t1 outline-none select-text placeholder:text-t4"
        />
      </div>
    </div>
  )
}

// ── body states ─────────────────────────────────────────────────────────────

/** No URL committed yet — the nav-bar input is the way in. */
function EmptyBody() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 select-none">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-n3 p-3 text-t4">
        <Globe size={18} strokeWidth={1.5} />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-medium text-t2">Open a browser</p>
        <p className="mx-auto mt-1 max-w-[220px] text-[11.5px] leading-relaxed text-t4">
          Navigate to a URL — docs, previews, dashboards.
        </p>
      </div>
    </div>
  )
}

/** Browser-mock dev: cross-origin pages can't be framed — punt to the OS. */
function FallbackBody({ url }: { url: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 select-none">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-n3 p-3 text-t4">
        <Globe size={18} strokeWidth={1.5} />
      </div>
      <p className="max-w-[240px] text-center text-[11.5px] leading-relaxed text-t4">
        Browsing needs the desktop app — open externally ↗
      </p>
      <button type="button" className={actionBtn} onClick={() => openExternally(url)}>
        <ArrowUpRight size={11} strokeWidth={1.75} />
        Open externally
      </button>
    </div>
  )
}
