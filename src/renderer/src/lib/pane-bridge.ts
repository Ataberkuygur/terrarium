// ── pane-bridge — renderer registry + command dispatcher ─────────────
// Each BrowserPane registers a handle per leaf (nav/eval/capture/dl plus
// url/title/boundSid getters). Main's loopback /cmd server forwards
// commands here via window.terrarium.onPaneCmd; results return via
// paneCmdResult. Outside Electron the surface doesn't exist — the bridge
// stays off silently.
//
// The wire vocabulary mirrors the Devin Tab Bridge (see shared/pane-bridge
// .ts): panes get a numeric `tabId` alias so cmd.js-style tooling works,
// and commands accept `tabId` (number) or `pane` (leaf id). Commands that
// reshape the workspace (newtab/activate/close) go through pane hooks
// WorkspaceView registers — the only place that owns the tree + focus.
// The spawned-terminal env var (TERRARIUM_BROWSER_CMD) points at this same
// bridge, so agent CLIs can curl it to drive the panes they spawned.

import type {
  PaneCmdEnvelope,
  PaneCmdResult,
  PaneTabInfo,
  WorkspaceSnapshot
} from '@shared/pane-bridge'
import { commandSessionId, type PaneAction, type PaneLeaf } from './panes'
import { classifyNow } from './terminal-classify'

/** What the dispatcher needs from a live browser pane. */
export interface BrowserPaneHandle {
  /** Numeric tab-bridge-style alias, minted at registration. */
  tabId: number
  /** Leaf id — accepted as `pane` on commands. */
  leafId: string
  title(): string
  url(): string
  /** Terminal session id this pane is scoped to (undefined = general). */
  boundSid(): string | undefined
  nav(url: string): void
  reload(): void
  activate(): void
  close(): void
  eval(expr: string): Promise<unknown>
  /** PNG screenshot → base64 (matches CDP Page.captureScreenshot shape). */
  capture(): Promise<string>
  download(url: string): void
}

/** Options for `spawn`/`split` leaf creation. */
export interface WorkspaceSpawnOpts {
  kind?: 'terminal' | 'browser' | 'chat'
  command?: string
  cwd?: string
  title?: string
  dir?: 'row' | 'col'
  agentId?: string
  url?: string
}

/** Workspace-only ops — registered by WorkspaceView (owner of tree+focus). */
export interface PaneHooks {
  /**
   * Spawn a fresh browser pane (tab-bridge `newtab`). `bindSid` scopes the
   * pane to the terminal leaf whose session id matches (an agent passing
   * its TERRARIUM_SID gets a pane it owns). Returns the new leaf id.
   */
  spawnBrowser(url?: string, bindSid?: string): string | null
  /** Bring a leaf into focus (tab-bridge `activate`). */
  focusLeaf(leafId: string): void
  /** Close a leaf (tab-bridge `close`). */
  closeLeaf(leafId: string): void
  /** Live leaf lookup — boundSid resolution for BrowserPane + tabs. */
  leafById(leafId: string): PaneLeaf | null
  /** Leaf owning a pty session id — `sid`-addressed commands. */
  leafBySid(sid: string): PaneLeaf | null
  /** Currently focused leaf — the chip's "bind to this terminal" target. */
  focusedLeafId(): string | null
  /** `ws` — flat snapshot of the tree: leaves + splits + focus. */
  snapshot(): WorkspaceSnapshot
  /**
   * `spawn` (target null → focused/first/root) and `split` (explicit
   * target leaf). Returns the new leaf id, null at the pane limit.
   */
  spawnLeaf(opts: WorkspaceSpawnOpts, targetId?: string | null): string | null
  /** Raw tree dispatch — for leaf rebinds that need claimLeafCommand's eviction. */
  dispatch(action: PaneAction): void
  /** `bind` — patch a terminal leaf's command/cwd; re-keys its pty. */
  bindLeaf(leafId: string, patch: { command?: string; cwd?: string }): boolean
  /** `write` — bytes into a terminal leaf's pty stdin. */
  writePty(leafId: string, data: string): boolean
  /** `ratio` — split id, or a leaf id (resolved to its parent split). */
  setRatioFor(ref: string, ratio: number): boolean
  /** `layout` — preset id/label or a '4'/'6'/'8' quick grid. */
  applyLayout(name: string): boolean
}

const panes = new Map<number, BrowserPaneHandle>()
const byLeaf = new Map<string, BrowserPaneHandle>()
let nextTabId = 1
let hooks: PaneHooks | null = null
// Versioned so React can re-read hook-backed values (boundSid, leaf
// lookups) once WorkspaceView registers — child panes mount before it.
let hooksVersion = 0
const hooksSubs = new Set<() => void>()
/** Pane most recently driven by a bridge command — reported as `active`. */
let lastActiveId = -1

/** Called by BrowserPane on mount; the returned cleanup unregisters. */
export function registerBrowserPane(h: Omit<BrowserPaneHandle, 'tabId'>): () => void {
  const handle: BrowserPaneHandle = { ...h, tabId: nextTabId++ }
  panes.set(handle.tabId, handle)
  byLeaf.set(handle.leafId, handle)
  return () => {
    if (panes.get(handle.tabId) === handle) panes.delete(handle.tabId)
    if (byLeaf.get(handle.leafId) === handle) byLeaf.delete(handle.leafId)
  }
}

/** WorkspaceView wires tree ops on mount (cleared on unmount). */
export function setPaneHooks(h: PaneHooks | null): () => void {
  hooks = h
  hooksVersion++
  hooksSubs.forEach((cb) => cb())
  return () => {
    if (hooks === h) hooks = null
    hooksVersion++
    hooksSubs.forEach((cb) => cb())
  }
}

/** useSyncExternalStore pair — bumps whenever workspace hooks change. */
export function subscribePaneHooks(cb: () => void): () => void {
  hooksSubs.add(cb)
  return () => hooksSubs.delete(cb)
}
export function paneHooksVersion(): number {
  return hooksVersion
}

// Resolved once from the preload — terminal spawnOpts read it for the
// TERRARIUM_BROWSER_CMD env var (sync accessor: the async invoke caches it).
let cmdUrl: string | null = null
export function paneBridgeCmdUrl(): string | null {
  return cmdUrl
}

/** Live leaf lookup via workspace hooks — null off-workspace. */
export function paneLeafById(leafId: string): PaneLeaf | null {
  return hooks?.leafById(leafId) ?? null
}

/** Workspace leaf owning a pty session id (null outside the workspace). */
export function paneLeafBySid(sid: string): PaneLeaf | null {
  return hooks?.leafBySid(sid) ?? null
}

/**
 * Session id of the terminal a browser pane is scoped to. The binding
 * stores a leaf id; the sid folds in that leaf's command binding so it
 * matches TERRARIUM_SID inside the spawned pty. Dangling binds (closed
 * terminal, non-terminal target) resolve to undefined — the pane reads
 * as general, never points at a dead session.
 */
export function boundSidFor(bindLeafId: string | undefined): string | undefined {
  if (!bindLeafId) return undefined
  const target = hooks?.leafById(bindLeafId)
  return target?.kind === 'terminal' ? commandSessionId(target) : undefined
}

/** Focus a leaf through the workspace hooks (tab-bridge `activate`). */
export function focusPaneLeaf(leafId: string): void {
  hooks?.focusLeaf(leafId)
}

/** WorkspaceView's tree dispatch, or null off-workspace. */
export function paneDispatch(): ((action: PaneAction) => void) | null {
  return hooks ? (action) => hooks?.dispatch(action) : null
}

/** Currently focused leaf id via the workspace hooks. */
export function focusedPaneLeafId(): string | null {
  return hooks?.focusedLeafId() ?? null
}

// ── dispatch ──────────────────────────────────────────────────────────

/** `tabId` (number/string) or `pane` (leaf id) → handle, or an error. */
function resolvePane(msg: PaneCmdEnvelope): BrowserPaneHandle | PaneCmdResult {
  const key = msg.pane ?? msg.tabId ?? msg.id
  if (key === undefined || key === null) {
    return { ok: false, error: 'missing tabId/pane' }
  }
  const pane =
    typeof key === 'number'
      ? panes.get(key)
      : byLeaf.get(String(key)) ?? panes.get(Number(key) || -1)
  return pane ?? { ok: false, error: `unknown pane ${JSON.stringify(key)}` }
}

function isPane(x: BrowserPaneHandle | PaneCmdResult): x is BrowserPaneHandle {
  return typeof (x as BrowserPaneHandle).nav === 'function'
}

// ── workspace leaf resolution ─────────────────────────────────────────
// Workspace commands address leaves loosely: `pane` = leaf id, `tabId` =
// browser alias, `i` = 1-based index in `ws` order, `sid` = the pty
// session id a terminal reports via TERRARIUM_SID.
function isLeaf(x: PaneLeaf | PaneCmdResult): x is PaneLeaf {
  return typeof (x as PaneLeaf).kind === 'string'
}

function resolveLeafRef(msg: PaneCmdEnvelope): PaneLeaf | PaneCmdResult {
  if (!hooks) return { ok: false, error: 'workspace not mounted' }
  const key = msg.pane ?? msg.i ?? msg.tabId ?? msg.sid
  if (key === undefined || key === null) {
    return { ok: false, error: 'missing pane/i/tabId/sid' }
  }
  if (typeof msg.sid === 'string' && msg.sid) {
    const l = hooks.leafBySid(msg.sid)
    return l ?? { ok: false, error: `no leaf with sid ${msg.sid}` }
  }
  if (typeof key === 'number') {
    const byTab = panes.get(key)
    if (byTab) {
      const l = hooks.leafById(byTab.leafId)
      if (l) return l
    }
    const snap = hooks.snapshot()
    const entry = snap.leaves[key - 1]
    const l = entry ? hooks.leafById(entry.id) : null
    return l ?? { ok: false, error: `no pane at index ${key}` }
  }
  const s = String(key)
  const direct = hooks.leafById(s)
  if (direct) return direct
  const tab = byLeaf.get(s) ?? panes.get(Number(s) || -1)
  if (tab) {
    const l = hooks.leafById(tab.leafId)
    if (l) return l
  }
  const bySid = hooks.leafBySid(s)
  return bySid ?? { ok: false, error: `unknown pane ${JSON.stringify(key)}` }
}

/** Trimmed string arg, undefined when absent/blank. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function spawnOptsFrom(msg: PaneCmdEnvelope): WorkspaceSpawnOpts {
  const kind = msg.kind === 'browser' || msg.kind === 'chat' ? msg.kind : 'terminal'
  return {
    kind,
    command: str(msg.command),
    cwd: str(msg.cwd),
    title: str(msg.title),
    dir: msg.dir === 'col' ? 'col' : 'row',
    agentId: str(msg.agentId),
    url: str(msg.url)
  }
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Guests only load http(s). An explicit other scheme (file:, javascript:,
 * mailto:…) is rejected rather than routed to openExternally — a loopback
 * API call must never pop an OS window. Bare hosts/search strings pass:
 * BrowserPane's resolveTarget upgrades them itself.
 */
function schemeGuard(url: string): PaneCmdResult | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'guests only load http(s) URLs' }
  }
  return null
}

async function run(msg: PaneCmdEnvelope): Promise<PaneCmdResult> {
  switch (msg.cmd) {
    case 'ping':
      return { ok: true, result: { pong: true, ts: Date.now(), panes: panes.size } }

    case 'tabs': {
      const tabs: PaneTabInfo[] = [...panes.values()].map((p) => ({
        id: p.tabId,
        pane: p.leafId,
        title: p.title(),
        url: p.url(),
        active: p.tabId === lastActiveId,
        boundSid: p.boundSid()
      }))
      return { ok: true, result: tabs }
    }

    case 'newtab': {
      if (!hooks) return { ok: false, error: 'workspace not mounted' }
      const url = typeof msg.url === 'string' && msg.url ? msg.url : undefined
      const bindSid = typeof msg.bind === 'string' && msg.bind ? msg.bind : undefined
      const leafId = hooks.spawnBrowser(url, bindSid)
      if (!leafId) return { ok: false, error: 'spawn failed (pane limit?)' }
      const handle = byLeaf.get(leafId)
      return { ok: true, result: { id: handle?.tabId, pane: leafId, url } }
    }

    case 'nav': {
      const pane = resolvePane(msg)
      if (!isPane(pane)) return pane
      if (typeof msg.url !== 'string' || !msg.url) {
        return { ok: false, error: 'nav needs { tabId|pane, url }' }
      }
      const bad = schemeGuard(msg.url)
      if (bad) return bad
      lastActiveId = pane.tabId
      pane.nav(msg.url)
      return { ok: true, result: { nav: msg.url } }
    }

    case 'activate': {
      const pane = resolvePane(msg)
      if (isPane(pane)) {
        lastActiveId = pane.tabId
        pane.activate()
        return { ok: true, result: { ok: true } }
      }
      // not a browser pane — fall through to leaf-level focus
      const leaf = resolveLeafRef(msg)
      if (!isLeaf(leaf)) return pane // surface the pane error first
      hooks?.focusLeaf(leaf.id)
      return { ok: true, result: { focused: leaf.id } }
    }

    case 'close': {
      const pane = resolvePane(msg)
      if (isPane(pane)) {
        pane.close()
        return { ok: true, result: { closed: true } }
      }
      // any leaf is closable, not just browser panes
      const leaf = resolveLeafRef(msg)
      if (!isLeaf(leaf)) return pane
      hooks?.closeLeaf(leaf.id)
      return { ok: true, result: { closed: leaf.id } }
    }

    // Guests need no debugger — present for script compatibility.
    case 'attach':
      return { ok: true, result: { attached: true } }
    case 'detach':
      return { ok: true, result: { detached: true } }

    case 'eval': {
      const pane = resolvePane(msg)
      if (!isPane(pane)) return pane
      const expr = typeof msg.expr === 'string' ? msg.expr : undefined
      if (!expr) return { ok: false, error: 'eval needs { tabId|pane, expr }' }
      lastActiveId = pane.tabId
      try {
        return { ok: true, result: await pane.eval(expr) }
      } catch (e) {
        return { ok: false, error: err(e) }
      }
    }

    case 'cdp': {
      const pane = resolvePane(msg)
      if (!isPane(pane)) return pane
      const params = (msg.params ?? {}) as Record<string, unknown>
      lastActiveId = pane.tabId
      try {
        switch (msg.method) {
          case 'Runtime.evaluate': {
            const expr = typeof params.expression === 'string' ? params.expression : ''
            if (!expr) return { ok: false, error: 'Runtime.evaluate needs params.expression' }
            const value = await pane.eval(expr)
            // CDP RemoteObject shape — {result:{type,value}} like the real bridge
            return {
              ok: true,
              result: {
                result:
                  value === undefined
                    ? { type: 'undefined' }
                    : { type: value === null ? 'object' : typeof value, value }
              }
            }
          }
          case 'Page.navigate': {
            const url = typeof params.url === 'string' ? params.url : ''
            if (!url) return { ok: false, error: 'Page.navigate needs params.url' }
            const bad = schemeGuard(url)
            if (bad) return bad
            pane.nav(url)
            return { ok: true, result: { frameId: pane.leafId } }
          }
          case 'Page.reload':
            pane.reload()
            return { ok: true, result: {} }
          case 'Page.captureScreenshot':
            return { ok: true, result: { data: await pane.capture() } }
          default:
            return { ok: false, error: `unsupported cdp method ${JSON.stringify(msg.method)}` }
        }
      } catch (e) {
        return { ok: false, error: err(e) }
      }
    }

    case 'dl': {
      const pane = resolvePane(msg)
      if (!isPane(pane)) return pane
      if (typeof msg.url !== 'string' || !/^https?:\/\//i.test(msg.url)) {
        return { ok: false, error: 'dl needs { tabId|pane, url } — http(s) only' }
      }
      pane.download(msg.url)
      return { ok: true, result: { ok: true } }
    }

    // ── workspace control — leaves/splits/focus, not just browsers ─────

    case 'help':
      return {
        ok: true,
        result: {
          workspace: !!hooks,
          commands: [
            'ping', 'help', 'tabs', 'newtab {url?,bind?}', 'nav {pane,url}',
            'activate {pane}', 'close {pane}', 'cdp {pane,method,params}',
            'eval {pane,expr}', 'dl {pane,url}',
            'ws', 'spawn {kind?,command?,cwd?,title?,dir?,pane?,url?,agentId?}',
            'split {pane,dir?,kind?,command?,url?}', 'focus {pane}',
            'bind {pane,command,cwd?}', 'write {pane|sid,data,enter?}',
            'ratio {split|pane,ratio}', 'layout {name|4|6|8}',
            'classify — force domain re-classification (Jev + heuristic)',
            'net.* — orchestration networks (net.help for the list)',
            'ui.metrics — dpr, caption overlay + terminal canvas alignment (diagnostics)'
          ],
          address: 'pane = leaf id | i = index from ws | sid = terminal session | tabId = browser alias'
        }
      }

    case 'ws': {
      if (!hooks) return { ok: false, error: 'workspace not mounted' }
      return { ok: true, result: hooks.snapshot() }
    }

    case 'spawn':
    case 'split': {
      if (!hooks) return { ok: false, error: 'workspace not mounted' }
      // split requires an explicit target; spawn falls back to focused/first
      let targetId: string | null = null
      if (msg.cmd === 'split' || msg.pane !== undefined) {
        const target = resolveLeafRef(msg)
        if (!isLeaf(target)) return target
        targetId = target.id
      }
      const leafId = hooks.spawnLeaf(spawnOptsFrom(msg), targetId)
      if (!leafId) return { ok: false, error: 'spawn failed (pane limit?)' }
      const leaf = hooks.leafById(leafId)
      return {
        ok: true,
        result: {
          pane: leafId,
          kind: leaf?.kind,
          sid: leaf?.kind === 'terminal' ? commandSessionId(leaf) : undefined
        }
      }
    }

    case 'focus': {
      const leaf = resolveLeafRef(msg)
      if (!isLeaf(leaf)) return leaf
      hooks?.focusLeaf(leaf.id)
      return { ok: true, result: { focused: leaf.id } }
    }

    case 'bind': {
      const leaf = resolveLeafRef(msg)
      if (!isLeaf(leaf)) return leaf
      if (leaf.kind !== 'terminal') {
        return { ok: false, error: 'bind targets terminal leaves' }
      }
      const command = str(msg.command)
      const cwd = str(msg.cwd)
      if (!command && !cwd) {
        return { ok: false, error: 'bind needs { pane, command?, cwd? }' }
      }
      const okSet = hooks?.bindLeaf(leaf.id, { command, cwd })
      return okSet
        ? { ok: true, result: { pane: leaf.id, command, cwd } }
        : { ok: false, error: 'bind failed' }
    }

    case 'write': {
      const leaf = resolveLeafRef(msg)
      if (!isLeaf(leaf)) return leaf
      if (leaf.kind !== 'terminal') {
        return { ok: false, error: 'write targets terminal leaves' }
      }
      const data = typeof msg.data === 'string' ? msg.data : undefined
      if (!data) return { ok: false, error: 'write needs { pane|sid, data }' }
      const payload = msg.enter === false ? data : data.endsWith('\r') || data.endsWith('\n') ? data : `${data}\r`
      const okWrite = hooks?.writePty(leaf.id, payload)
      return okWrite
        ? { ok: true, result: { pane: leaf.id, bytes: payload.length } }
        : { ok: false, error: 'pty write failed (no live session?)' }
    }

    case 'ratio': {
      if (!hooks) return { ok: false, error: 'workspace not mounted' }
      const ratio = typeof msg.ratio === 'number' ? msg.ratio : Number(msg.ratio)
      if (!Number.isFinite(ratio)) {
        return { ok: false, error: 'ratio needs { split|pane, ratio } — 0..1' }
      }
      let ref = str(msg.split)
      if (!ref) {
        const leaf = resolveLeafRef(msg)
        if (!isLeaf(leaf)) return leaf
        ref = leaf.id
      }
      const okRatio = hooks.setRatioFor(ref, ratio)
      return okRatio
        ? { ok: true, result: { ratio } }
        : { ok: false, error: `no split for ${JSON.stringify(ref)}` }
    }

    case 'layout': {
      if (!hooks) return { ok: false, error: 'workspace not mounted' }
      const name = str(msg.name)
      if (!name) return { ok: false, error: 'layout needs { name }' }
      const okLayout = hooks.applyLayout(name)
      return okLayout
        ? { ok: true, result: { layout: name } }
        : { ok: false, error: `unknown layout ${JSON.stringify(name)}` }
    }

    case 'ui.metrics': {
      // window/overlay geometry for diagnosing chrome + DPR issues
      const wco = (navigator as unknown as {
        windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect }
      }).windowControlsOverlay
      const r = wco?.getTitlebarAreaRect()
      const canvases = [...document.querySelectorAll('.terrarium-terminal canvas')].slice(0, 3).map((c) => {
        const el = c as HTMLCanvasElement
        const b = el.getBoundingClientRect()
        return { w: el.width, h: el.height, cssW: b.width, cssH: b.height, x: b.x, y: b.y }
      })
      const layers = [...document.querySelectorAll('[style*="translate"]')].slice(0, 4).map((e) => (e as HTMLElement).style.transform)
      return {
        ok: true,
        result: {
          dpr: window.devicePixelRatio,
          inner: [window.innerWidth, window.innerHeight],
          outer: [window.outerWidth, window.outerHeight],
          wco: r ? { visible: wco?.visible, x: r.x, y: r.y, w: r.width, h: r.height } : null,
          titlebarH: document.querySelector('header.drag-region')?.getBoundingClientRect().height,
          canvases,
          layers,
          terminals: [...document.querySelectorAll('.terrarium-terminal .xterm-screen')].map((el) => {
            const b = el.getBoundingClientRect()
            const row = el.querySelector('.xterm-rows > div') as HTMLElement | null
            // blank-pane forensics: which session, is it on screen, and is
            // its GL canvas alive (getContext returns the existing context)
            const host = el.closest('[data-session]') as HTMLElement | null
            const gl = [...el.querySelectorAll('canvas')]
              .map((c) => (c as HTMLCanvasElement).getContext('webgl2'))
              .find(Boolean)
            const canvas = gl?.canvas as HTMLCanvasElement | undefined
            return {
              sid: host?.dataset.session ?? null,
              renderer: el.querySelector('canvas') ? 'webgl' : 'dom',
              x: b.x * window.devicePixelRatio,
              fontPx: row ? parseFloat(getComputedStyle(row).fontSize) * window.devicePixelRatio : null,
              visible: !!host?.offsetParent && b.width > 0 && b.height > 0,
              size: [Math.round(b.width), Math.round(b.height)],
              glLost: gl ? gl.isContextLost() : null,
              glCanvas: canvas ? [canvas.width, canvas.height] : null,
              domRows: row ? el.querySelectorAll('.xterm-rows > div').length : null
            }
          })
        }
      }
    }

    case 'classify': {
      const report = await classifyNow()
      return { ok: true, result: report ?? { note: 'no classification ran' } }
    }

    default:
      // orchestration networks — lazy so the store (and its shadow
      // xterms) only load once something actually talks to a network
      if (msg.cmd === 'net' || msg.cmd.startsWith('net.')) {
        const { runNetCmd } = await import('./orchestration')
        return runNetCmd(msg)
      }
      return { ok: false, error: `unknown cmd ${JSON.stringify(msg.cmd)}` }
  }
}

// ── init ──────────────────────────────────────────────────────────────

let listening = false

/** Install the dispatcher + resolve the port once. Call from App mount. */
export function initPaneBridge(): void {
  if (listening) return
  const api = window.terrarium
  if (!api?.onPaneCmd || !api.paneCmdResult) return
  listening = true
  api.onPaneCmd((msg) => {
    try {
      void run(msg)
        .then(
          (r) => {
            try {
              api.paneCmdResult?.(msg.id, r)
            } catch {
              /* ignore */
            }
          },
          (e: unknown) => {
            try {
              api.paneCmdResult?.(msg.id, { ok: false, error: err(e) })
            } catch {
              /* ignore */
            }
          }
        )
        .catch((e: unknown) => {
          try {
            api.paneCmdResult?.(msg.id, { ok: false, error: err(e) })
          } catch {
            /* ignore */
          }
        })
    } catch {
      /* ignore */
    }
  })
  void api
    .paneBridgePort?.()
    .then((p) => {
      if (p) cmdUrl = `http://127.0.0.1:${p}/cmd`
    })
    .catch(() => null)
}
