import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { Terminal, Globe, LayoutGrid, Sparkles, Workflow } from 'lucide-react'
import clsx from 'clsx'
import { TERMINALS_REPAINT_EVENT } from '../lib/terminal-render'
import {
  MAX_LEAVES,
  PANE_KINDS,
  PRESETS,
  collectLeaves,
  commandSessionId,
  createLeaf,
  deserializePanes,
  filterLeaves,
  findLeaf,
  findParentSplit,
  findSplit,
  firstLeaf,
  gridTree,
  panesReducer,
  serializePanes,
  type PaneAction,
  type PaneKind,
  type PaneLeaf,
  type PaneNode,
  type PanePreset,
  type SplitDir
} from '../lib/panes'
import { PaneHost } from '../workspace/PaneHost'
import { EmptyPane, PANE_META } from '../workspace/EmptyPane'
import { PaneDispatchContext } from '../workspace/pane-context'
import { PANE_SPAWN_EVENT, type PaneSpawnDetail } from '../workspace/pane-events'
import {
  APPLY_PRESET_EVENT,
  SPAWN_PANE_EVENT,
  takeWorkspaceEvent
} from '../lib/workspace-events'
import { SessionRail } from '../workspace/SessionRail'
import { ClipboardButton } from '../components/ClipboardPanel'
import { LayoutMenu } from '../workspace/LayoutMenu'
import { paneClose, paneSplit, uiTap } from '../lib/sfx'
import { setPaneHooks, type WorkspaceSpawnOpts } from '../lib/pane-bridge'
import { getPty } from '../lib/ipc'
import { randomLatinName } from '../lib/latin-names'
import {
  scheduleDomainClassification,
  setDomainDispatch
} from '../lib/terminal-classify'
import { useApp } from '../lib/store'
import { groupKeyForLeaf } from '../lib/categories'
import { focusOrchestrationNode, isOrchestrationSid, useOrch } from '../lib/orchestration'
import {
  OrchestrationActions,
  OrchestrationStage,
  OrchestrationTabs
} from '../orchestration/OrchestrationView'
import {
  CanvasZoomContext,
  IDENTITY_VIEW,
  persistedViews,
  usePanZoom,
  type CanvasView
} from '../lib/canvas-nav'
import { CanvasControls } from '../components/CanvasControls'

export { PRESETS } from '../lib/panes'
export type { PaneAction, PaneKind, PaneLeaf, PaneNode, PanePreset, SplitDir } from '../lib/panes'

/** The toolbar's New Browser button — parked until browser panes get their polish pass. */
const SHOW_NEW_BROWSER = false

const STORAGE_KEY = 'terrarium.panes'
const FOCUS_STORAGE_KEY = 'terrarium.workspace.focus'

/** Grid pan/zoom — survives view/tab switches (which unmount this view), reloads and restarts. */
const gridViews = persistedViews('terrarium.workspace.view')

/**
 * Grid pan/zoom bounds: zoomed in, the grid is larger than the viewport
 * and can't be dragged past its edges; zoomed out, it sits centred.
 */
function clampGridView(v: CanvasView, W: number, H: number): CanvasView {
  const axis = (pos: number, view: number, content: number) =>
    content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, pos))
  return { z: v.z, x: axis(v.x, W, W * v.z), y: axis(v.y, H, H * v.z) }
}

export interface WorkspaceViewProps {
  /**
   * Controlled pane tree. Omit (with `dispatch`) to let the view manage its own
   * tree persisted to localStorage under 'terrarium.panes'.
   */
  panes?: PaneNode | null
  /** Receives PaneAction for every mutation — wire to panesReducer/your store. */
  dispatch?: (action: PaneAction) => void
  /** Controlled focus. Omit to track focus internally (pointer-down on a pane). */
  focusedId?: string | null
  onFocus?: (leafId: string | null) => void
  /**
   * Content renderer per leaf — the integrator returns a real terminal,
   * file preview, browser, or note editor here. Defaults to EmptyPane stubs.
   */
  renderLeaf?: (leaf: PaneLeaf) => ReactNode
}

function loadInitial(): PaneNode | null {
  try {
    const restored = deserializePanes(localStorage.getItem(STORAGE_KEY))
    if (restored) return restored
  } catch {
    /* corrupted storage → fall through to default */
  }
  return createLeaf('terminal')
}

function isEditableTarget(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable === true
}

export function WorkspaceView(props: WorkspaceViewProps = {}) {
  const { renderLeaf } = props
  const controlled = props.panes !== undefined

  // Uncontrolled fallback: own reducer seeded from localStorage.
  const [innerTree, innerDispatch] = useReducer(panesReducer, null, loadInitial)
  const tree = controlled ? (props.panes ?? null) : innerTree
  const dispatch = props.dispatch ?? innerDispatch

  // Focus: controlled via props, otherwise internal state with localStorage persistence.
  const [innerFocus, setInnerFocus] = useState<string | null>(() => {
    try {
      return localStorage.getItem(FOCUS_STORAGE_KEY)
    } catch {
      return null
    }
  })
  const rawFocus = props.focusedId !== undefined ? props.focusedId : innerFocus
  const setFocused = useCallback(
    (id: string | null) => {
      setInnerFocus(id)
      props.onFocus?.(id)
      try {
        if (id) localStorage.setItem(FOCUS_STORAGE_KEY, id)
        else localStorage.removeItem(FOCUS_STORAGE_KEY)
      } catch {
        /* storage full / unavailable */
      }
    },
    [props.onFocus]
  )
  const leaves = collectLeaves(tree)
  const focus = rawFocus && leaves.some((l) => l.id === rawFocus) ? rawFocus : null
  const count = leaves.length
  const canSplit = count > 0 && count < MAX_LEAVES

  // ── mode: pane grid ⇄ orchestration, both live inside this view ──
  // The two surfaces are stacked layers that cross-fade; the orchestration
  // layer mounts on first use and then stays mounted (hidden, still sized)
  // so switching never re-attaches terminals or resizes a pty.
  const orchestrate = useOrch((s) => s.enabled)
  const [orchMounted, setOrchMounted] = useState(orchestrate)
  useEffect(() => {
    if (orchestrate) setOrchMounted(true)
  }, [orchestrate])
  const setMode = useCallback((next: boolean) => {
    if (next === useOrch.getState().enabled) return
    uiTap()
    useOrch.getState().setEnabled(next)
  }, [])
  // The incoming layer's terminals sat hidden — keeping their size, so no
  // ResizeObserver fires to wake them. Repaint every pane once the layer
  // shows and again once the cross-fade settles.
  const firstMode = useRef(true)
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false
      return
    }
    const repaint = () => window.dispatchEvent(new Event(TERMINALS_REPAINT_EVENT))
    repaint()
    const t = setTimeout(repaint, 320)
    return () => clearTimeout(t)
  }, [orchestrate])

  // ── canvas navigation — semantic zoom (panes + fonts scale) and pan ──
  const gridHostRef = useRef<HTMLDivElement>(null)
  const [gridSize, setGridSize] = useState({ W: 0, H: 0 })
  useEffect(() => {
    const el = gridHostRef.current
    if (!el) return
    const measure = () => setGridSize({ W: el.clientWidth, H: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const gridPz = usePanZoom(gridHostRef, {
    min: 0.5,
    max: 2.5,
    initial: gridViews.get('grid'),
    isBackground: (el) => el === gridHostRef.current || el === gridPz.worldRef.current,
    clamp: clampGridView,
    onFit: () => gridPz.setView(IDENTITY_VIEW),
    onCommit: (v) => gridViews.set('grid', v)
  })
  const gz = gridPz.view.z
  const gridZoomed = gz !== 1

  // ── hidden-category filter ──
  // View-only: the REAL tree keeps hidden leaves so their ptys stay alive
  // (the orphan reapers and the rail both key off `tree`) — only what
  // PaneHost renders is filtered. Group keys match SessionRail exactly via
  // groupKeyForLeaf.
  const agents = useApp((s) => s.agents)
  const hiddenCategories = useApp((s) => s.hiddenCategories)
  const agentDomainById = useMemo(
    () => new Map(agents.map((a) => [a.id, a.domain])),
    [agents]
  )
  const hiddenSet = useMemo(() => new Set(hiddenCategories), [hiddenCategories])
  const displayTree = useMemo(
    () =>
      filterLeaves(
        tree,
        (l) =>
          !hiddenSet.has(
            groupKeyForLeaf(l, l.agentId ? agentDomainById.get(l.agentId) : undefined)
          )
      ),
    [tree, hiddenSet, agentDomainById]
  )
  // a focused leaf that just got hidden drops its ring rather than
  // pointing PaneHost at a pane that isn't rendered
  const displayFocus = focus && findLeaf(displayTree, focus) ? focus : null

  // Persist the uncontrolled tree whenever it changes.
  useEffect(() => {
    if (controlled) return
    try {
      localStorage.setItem(STORAGE_KEY, serializePanes(innerTree))
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [controlled, innerTree])

  // Kill orphaned pty sessions: a terminal leaf that vanishes from the
  // tree (close ×, layout replace, …) would otherwise keep running in the
  // detached supervisor forever — devin/claude CLIs then hold their
  // session lock and refuse to reopen ("session is locked"). Closing a
  // pane is a deliberate end; re-attach on remount is unaffected.
  const prevTermSids = useRef<Set<string>>(new Set())
  useEffect(() => {
    const cur = new Set(
      collectLeaves(tree)
        .filter((l) => l.kind === 'terminal')
        .map((l) => commandSessionId(l))
    )
    for (const sid of prevTermSids.current) {
      if (!cur.has(sid)) void getPty()?.kill(sid).catch(() => {})
    }
    prevTermSids.current = cur
  }, [tree])

  // Explicit save-state event listener (from Save button or unload)
  useEffect(() => {
    const onSave = () => {
      try {
        if (!controlled && innerTree) {
          localStorage.setItem(STORAGE_KEY, serializePanes(innerTree))
        }
        if (innerFocus) {
          localStorage.setItem(FOCUS_STORAGE_KEY, innerFocus)
        }
      } catch {
        /* non-fatal */
      }
    }
    window.addEventListener('terrarium:save-state', onSave)
    return () => window.removeEventListener('terrarium:save-state', onSave)
  }, [controlled, innerTree, innerFocus])

  // "Open terminal" from the office/board → focus existing or spawn an agent-bound terminal
  // leaf (agent I/O wakes/sleeps the character in the office).
  const focusAgentId = useApp((s) => s.focusAgentId)
  const spawnRef = useRef<
    (kind: PaneKind, dir?: SplitDir, targetId?: string, agentId?: string, title?: string) => void
  >(undefined)
  useEffect(() => {
    if (!focusAgentId) return
    if (isOrchestrationSid(focusAgentId)) {
      focusOrchestrationNode(focusAgentId)
      useApp.setState({ focusAgentId: null })
      return
    }
    // a grid terminal was asked for — show the grid
    if (useOrch.getState().enabled) useOrch.getState().setEnabled(false)
    const currentLeaves = collectLeaves(tree)
    const existing = currentLeaves.find(
      (l) => (l.agentId && l.agentId === focusAgentId) || l.id === focusAgentId
    )
    if (existing) {
      setFocused(existing.id)
    } else {
      const agent = useApp.getState().agents.find((a) => a.id === focusAgentId)
      const kind = useApp.getState().focusPaneKind
      spawnRef.current?.(kind, 'row', undefined, focusAgentId, agent ? `${agent.name}` : undefined)
    }
    useApp.setState({ focusAgentId: null })
  }, [focusAgentId, tree, setFocused])

  // Pane bodies ask for real content via `terrarium:pane-spawn` (EmptyPane
  // quick actions). Browser leaves get a refId here; terminal leaves spawn
  // their own pty on mount and chat leaves bind via agentId — nothing to do.
  const treeRef = useRef(tree)
  treeRef.current = tree

  // One-shot orphan reaper (mount): supervisor sessions with no leaf in
  // the tree are leftovers from panes closed before kill-on-close — they
  // hold CLI session locks (devin refuses to reopen). Reap them once.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pty = getPty()
      if (!pty?.list) return
      const live = await pty.list().catch(() => null)
      if (!live || cancelled) return
      const expected = new Set(
        collectLeaves(treeRef.current)
          .filter((l) => l.kind === 'terminal')
          .map((l) => commandSessionId(l))
      )
      for (const s of live) {
        // orchestration networks own their sessions — never reap those
        if (isOrchestrationSid(s.sessionId)) continue
        if (s.status === 'running' && !expected.has(s.sessionId)) {
          void pty.kill(s.sessionId).catch(() => {})
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onPaneSpawn = (e: Event) => {
      const d = (e as CustomEvent<PaneSpawnDetail>).detail
      if (!d) return
      if (d.kind === 'browser') {
        const leaf = findLeaf(treeRef.current, d.leafId)
        if (!leaf || leaf.refId) return
        // the EmptyPane URL input lands in leaf.title before the event fires
        const t = leaf.title?.trim() ?? ''
        const refId =
          t === '' || /^browser \d+$/i.test(t)
            ? 'https://duckduckgo.com'
            : /^https?:\/\//.test(t)
              ? t
              : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) || t.startsWith('localhost')
                ? `https://${t}`
                : `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
        dispatch({ type: 'update', leafId: d.leafId, patch: { refId } })
      }
    }
    window.addEventListener(PANE_SPAWN_EVENT, onPaneSpawn)
    return () => window.removeEventListener(PANE_SPAWN_EVENT, onPaneSpawn)
  }, [dispatch])

  /** Terminal leaves get worker names (Latin pool); other kinds keep 'Browser N'. */
  const nextTitle = useCallback(
    (kind: PaneKind) => {
      if (kind === 'terminal') {
        const taken = new Set(leaves.map((l) => l.title).filter((t): t is string => !!t))
        return randomLatinName(taken)
      }
      const n = leaves.filter((l) => l.kind === kind).length + 1
      return `${(PANE_META[kind] ?? PANE_META.terminal).label} ${n}`
    },
    [leaves]
  )

  /** Split the focused leaf with a fresh pane of `kind`; falls back to root/new. */
  const spawn = useCallback(
    (kind: PaneKind, dir: SplitDir = 'row', targetId?: string, agentId?: string, title?: string) => {
      // Browser panes spawned while a terminal is focused scope to it —
      // the agent's shell can then drive the pane via TERRARIUM_BROWSER_CMD.
      // Anything else focused (or nothing) → general browser.
      const focusedLeaf = focus ? findLeaf(tree, focus) : null
      const bindLeafId =
        kind === 'browser' && focusedLeaf?.kind === 'terminal' ? focusedLeaf.id : undefined
      const leaf = createLeaf(kind, {
        title: title ?? nextTitle(kind),
        agentId,
        bindLeafId
      })
      const target = targetId ?? focus ?? firstLeaf(tree)?.id ?? null
      if (tree && target) {
        dispatch({ type: 'split', leafId: target, dir, leaf })
      } else {
        dispatch({ type: 'set', tree: leaf })
      }
      setFocused(leaf.id)
      paneSplit()
    },
    [tree, focus, dispatch, setFocused, nextTitle]
  )
  spawnRef.current = spawn

  /** SessionRail 'Crew' click → split out a chat leaf bound to that agent. */
  const spawnAgentChat = useCallback(
    (agentId: string) => {
      const agent = useApp.getState().agents.find((a) => a.id === agentId)
      spawn('chat', 'row', undefined, agentId, agent ? `${agent.name}` : undefined)
    },
    [spawn]
  )

  const closeLeafById = useCallback(
    (leafId: string) => {
      dispatch({ type: 'close', leafId })
      paneClose()
    },
    [dispatch]
  )

  // ── pane-bridge hooks ──
  // The loopback /cmd bridge reaches the tree only through these: tabs
  // resolve leaf↔sid here, newtab/activate/close reshape the workspace.
  // Refs keep the once-registered hooks pointed at live tree + focus.
  const focusRef = useRef(focus)
  focusRef.current = focus
  useEffect(() => {
    return setPaneHooks({
      leafById: (leafId) => findLeaf(treeRef.current, leafId),
      leafBySid: (sid) =>
        collectLeaves(treeRef.current).find(
          (l) => l.kind === 'terminal' && commandSessionId(l) === sid
        ) ?? null,
      focusedLeafId: () => focusRef.current,
      focusLeaf: (leafId) => setFocused(leafId),
      closeLeaf: (leafId) => closeLeafById(leafId),
      dispatch: (action) => dispatch(action),

      // ── workspace control — ws/spawn/split/bind/write/ratio/layout ──
      snapshot: () => {
        const t = treeRef.current
        const live = collectLeaves(t)
        const splits: { id: string; dir: 'row' | 'col'; ratio: number }[] = []
        const walk = (n: PaneNode | null) => {
          if (!n || n.type === 'leaf') return
          splits.push({ id: n.id, dir: n.dir, ratio: n.ratio })
          walk(n.a)
          walk(n.b)
        }
        walk(t)
        return {
          focusedId: focusRef.current,
          count: live.length,
          max: MAX_LEAVES,
          leaves: live.map((l, i) => ({
            i: i + 1,
            id: l.id,
            kind: l.kind,
            title: l.title,
            command: l.command,
            cwd: l.cwd,
            domain: l.domain,
            category: l.category,
            sid: l.kind === 'terminal' ? commandSessionId(l) : undefined,
            agentId: l.agentId,
            bindLeafId: l.bindLeafId,
            focused: l.id === focusRef.current
          })),
          splits
        }
      },

      spawnLeaf: (opts: WorkspaceSpawnOpts, targetId) => {
        const t = treeRef.current
        const live = collectLeaves(t)
        if (live.length >= MAX_LEAVES) return null
        const kind = opts.kind ?? 'terminal'
        // browser leaves scope to the terminal they split from (or the
        // focused one) — same rule as the toolbar's New Browser.
        const bindTarget = targetId ?? focusRef.current
        const bindLeafId =
          kind === 'browser' && bindTarget
            ? findLeaf(t, bindTarget)?.kind === 'terminal'
              ? bindTarget
              : undefined
            : undefined
        const leaf = createLeaf(kind, {
          title: opts.title ?? nextTitle(kind),
          agentId: opts.agentId,
          command: opts.command,
          cwd: opts.cwd,
          refId: opts.url ?? null,
          bindLeafId
        })
        const target = targetId ?? focusRef.current ?? firstLeaf(t)?.id ?? null
        if (t && target) {
          dispatch({ type: 'split', leafId: target, dir: opts.dir ?? 'row', leaf })
        } else {
          dispatch({ type: 'set', tree: leaf })
        }
        setFocused(leaf.id)
        paneSplit()
        return leaf.id
      },

      bindLeaf: (leafId, patch) => {
        const leaf = findLeaf(treeRef.current, leafId)
        if (!leaf || leaf.kind !== 'terminal') return false
        const oldSid = commandSessionId(leaf)
        dispatch({
          type: 'update',
          leafId,
          patch: {
            ...(patch.command !== undefined ? { command: patch.command } : {}),
            ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {})
          }
        })
        // re-keyed pane spawns a fresh pty — retire the old process so it
        // doesn't linger holding a transcript lock
        void getPty()
          ?.kill(oldSid)
          .catch(() => {})
        return true
      },

      writePty: (leafId, data) => {
        const leaf = findLeaf(treeRef.current, leafId)
        if (!leaf || leaf.kind !== 'terminal') return false
        const pty = getPty()
        if (!pty) return false
        pty.write(commandSessionId(leaf), data)
        return true
      },

      setRatioFor: (ref, ratio) => {
        const t = treeRef.current
        if (!t) return false
        // a split id hits directly; a leaf id resolves to its parent split
        const split = findSplit(t, ref) ?? findParentSplit(t, ref)
        if (!split) return false
        dispatch({ type: 'ratio', splitId: split.id, ratio })
        return true
      },

      applyLayout: (name) => {
        const key = name.trim().toLowerCase()
        const grid = key.match(/^(?:grid:?)?(\d+)$/)
        let next: PaneNode | null = null
        if (grid) {
          const n = Number(grid[1])
          if (n < 1 || n > MAX_LEAVES) return false
          next = gridTree(n)
        } else {
          const preset = PRESETS.find(
            (p) => p.id === key || p.label.toLowerCase() === key
          )
          if (!preset) return false
          next = preset.build()
        }
        dispatch({ type: 'set', tree: next })
        setFocused(firstLeaf(next)?.id ?? null)
        return true
      },

      spawnBrowser: (url, bindSid) => {
        const t = treeRef.current
        const live = collectLeaves(t)
        if (live.length >= MAX_LEAVES) return null
        // explicit sid (agent passed its TERRARIUM_SID) wins; otherwise the
        // focused terminal — same scoping rule as the toolbar spawn.
        let bindLeafId: string | undefined
        if (bindSid) {
          bindLeafId = live.find(
            (l) => l.kind === 'terminal' && commandSessionId(l) === bindSid
          )?.id
        } else {
          const fl = focusRef.current ? findLeaf(t, focusRef.current) : null
          if (fl?.kind === 'terminal') bindLeafId = fl.id
        }
        const leaf = createLeaf('browser', {
          title: nextTitle('browser'),
          refId: url ?? null,
          bindLeafId
        })
        const target = focusRef.current ?? firstLeaf(t)?.id ?? null
        if (t && target) dispatch({ type: 'split', leafId: target, dir: 'row', leaf })
        else dispatch({ type: 'set', tree: leaf })
        setFocused(leaf.id)
        paneSplit()
        return leaf.id
      }
    })
  }, [dispatch, setFocused, closeLeafById, nextTitle])

  /** 4/6/8 quick grids — replaces the tree like a preset does. */
  const applyGrid = useCallback(
    (n: number) => {
      const next = gridTree(n)
      dispatch({ type: 'set', tree: next })
      setFocused(firstLeaf(next)?.id ?? null)
    },
    [dispatch, setFocused]
  )

  const splitFocused = useCallback(
    (dir: SplitDir, kind: PaneKind = 'terminal') => {
      if (!tree) {
        spawn(kind, dir)
        return
      }
      spawn(kind, dir, focus ?? firstLeaf(tree)?.id ?? undefined)
    },
    [tree, focus, spawn]
  )

  const closeFocused = useCallback(() => {
    const id = focus ?? firstLeaf(tree)?.id
    if (id) closeLeafById(id)
  }, [focus, tree, closeLeafById])

  /** Layout preset (Ctrl+1…5 / command palette) — rebuilds the whole tree. */
  const applyPreset = useCallback(
    (index: number) => {
      const preset = PRESETS[index]
      if (!preset) return
      const next = preset.build()
      dispatch({ type: 'set', tree: next })
      setFocused(firstLeaf(next)?.id ?? null)
    },
    [dispatch, setFocused]
  )

  // Keyboard: Ctrl+\ split right · Ctrl+W close · Ctrl+Shift+T tidy ·
  // Ctrl+1…5 apply the layout presets.
  // Single window listener; a ref keeps handlers current without re-subscribing.
  const hot = useRef({ splitFocused, closeFocused, applyPreset, dispatch })
  hot.current = { splitFocused, closeFocused, applyPreset, dispatch }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return
      if (useOrch.getState().enabled) return // grid shortcuts act on the hidden grid
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (e.key === '\\') {
        e.preventDefault()
        hot.current.splitFocused('row')
      } else if (key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        hot.current.closeFocused()
      } else if (key === 't' && e.shiftKey) {
        e.preventDefault()
        hot.current.dispatch({ type: 'tidy' })
      } else if (key >= '1' && key <= '5' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        hot.current.applyPreset(Number(key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Command-palette bridge: 'terrarium:apply-preset' (detail: preset id) and
  // 'terrarium:spawn-pane' (detail: { kind }) let the palette drive the layout
  // from any view. Distinct from PANE_SPAWN_EVENT — that one binds content
  // to an existing leaf; these create/replace leaves. Both events are
  // stash-backed (lib/workspace-events): the palette fires them right after
  // setView('workspace'), so the drain below replays whatever landed while
  // this view was still unmounted (or its lazy chunk was still loading).
  useEffect(() => {
    const applyPresetKey = (key: unknown) => {
      if (typeof key !== 'string') return
      const i = PRESETS.findIndex((p) => p.id === key)
      if (i === -1) return // unknown preset id — ignore
      hot.current.applyPreset(i)
    }
    const spawnKind = (kind: unknown) => {
      if (typeof kind !== 'string' || !(PANE_KINDS as readonly string[]).includes(kind)) return
      spawnRef.current?.(kind as PaneKind)
    }
    const onApplyPreset = (e: Event) => {
      takeWorkspaceEvent(APPLY_PRESET_EVENT) // consume the stash — first consumer wins
      applyPresetKey((e as CustomEvent<unknown>).detail)
    }
    const onSpawnPane = (e: Event) => {
      takeWorkspaceEvent(SPAWN_PANE_EVENT)
      const d = (e as CustomEvent<unknown>).detail
      spawnKind(d && typeof d === 'object' ? (d as { kind?: unknown }).kind : undefined)
    }
    window.addEventListener(APPLY_PRESET_EVENT, onApplyPreset)
    window.addEventListener(SPAWN_PANE_EVENT, onSpawnPane)
    // replay commands fired while unmounted (consume-once — no double-apply)
    applyPresetKey(takeWorkspaceEvent(APPLY_PRESET_EVENT))
    spawnKind(takeWorkspaceEvent<{ kind?: unknown }>(SPAWN_PANE_EVENT)?.kind)
    return () => {
      window.removeEventListener(APPLY_PRESET_EVENT, onApplyPreset)
      window.removeEventListener(SPAWN_PANE_EVENT, onSpawnPane)
    }
  }, [])

  // Domain classifier: while this view is mounted its reducer owns the
  // live tree, so leaf.domain patches must come through dispatch (the
  // storage path covers the unmounted case).
  useEffect(() => {
    return setDomainDispatch((updates) => {
      for (const [leafId, domain] of updates) {
        dispatch({ type: 'update', leafId, patch: { domain } })
      }
    })
  }, [dispatch])

  // (Re)evaluate work areas on every lineup change — the scheduler
  // debounces and only classifies leaves whose context actually moved.
  useEffect(() => {
    scheduleDomainClassification(leaves)
  }, [leaves])

  const render = renderLeaf ?? ((leaf: PaneLeaf) => <EmptyPane leaf={leaf} />)

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* ── toolbar ── */}
      <header className="chrome-bar scroll-thin flex h-11 shrink-0 select-none items-center gap-1.5 overflow-x-auto px-2.5">
        <ModeSwitch orchestrate={orchestrate} onChange={setMode} />
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--border-default)]" />

        {orchestrate ? (
          <div key="orch-tools" className="ws-tools-in flex min-w-0 flex-1 items-center gap-1">
            <OrchestrationTabs />
            <span className="flex-1" />
            <OrchestrationActions />
            <ClipboardButton />
          </div>
        ) : (
        <div key="grid-tools" className="ws-tools-in flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          onClick={() => spawn('terminal')}
          disabled={count >= MAX_LEAVES}
          title="New terminal — Ctrl+\"
          className="btn-accent-soft flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium disabled:pointer-events-none disabled:opacity-40"
        >
          <Terminal size={12.5} strokeWidth={2} />
          New Terminal
        </button>
        {/* New Browser — hidden for now (SHOW_NEW_BROWSER); browser panes
            still open from the palette, the pane bridge and `newtab`. */}
        {SHOW_NEW_BROWSER && (
          <ToolButton
            icon={<Globe size={12} />}
            label="New Browser"
            disabled={count >= MAX_LEAVES}
            onClick={() => spawn('browser')}
          />
        )}

        <LayoutMenu
          tree={tree}
          onApply={(t) => {
            dispatch({ type: 'set', tree: t })
            setFocused(firstLeaf(t)?.id ?? null)
          }}
        />

        {/* quick grids — 4 = 2×2, 6 = 3×2, 8 = 4×2 (replaces the tree) */}
        <span className="tool-group" title="Quick grids — replace the layout">
          <LayoutGrid size={11.5} strokeWidth={1.75} className="mx-1.5 shrink-0 text-t4" />
          {([4, 6, 8] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => applyGrid(n)}
              title={`Grid ${n} — ${n / 2}×2 terminals (replaces layout)`}
              className="tool-btn tnum !w-6 !px-0 !text-[11px]"
            >
              {n}
            </button>
          ))}
        </span>

        {/* canvas zoom — Ctrl+wheel over the grid, middle-drag to pan */}
        <span className="tool-group">
          <button
            type="button"
            onClick={() => gridPz.zoomBy(1 / 1.2)}
            title="Zoom out (Ctrl+wheel)"
            className="tool-btn !w-6 !px-0 !text-[13px]"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => gridPz.setView(IDENTITY_VIEW)}
            title="Reset zoom — Ctrl+wheel zooms, middle-drag pans"
            className={clsx('tool-btn tnum min-w-[44px] !px-1 !text-[11px]', gridZoomed && '!text-accent')}
          >
            {Math.round(gz * 100)}%
          </button>
          <button
            type="button"
            onClick={() => gridPz.zoomBy(1.2)}
            title="Zoom in (Ctrl+wheel)"
            className="tool-btn !w-6 !px-0 !text-[13px]"
          >
            +
          </button>
        </span>

        <span className="flex-1" />

        {/* clipboard history — photos / texts into the focused terminal */}
        <ClipboardButton />

        {/* tidy button on the edge */}
        <button
          type="button"
          onClick={() => {
            uiTap()
            dispatch({ type: 'tidy' })
          }}
          disabled={!tree || count <= 1}
          title="Tidy layout — evenly resize all panes (Ctrl+Shift+T)"
          className={clsx(
            'group/tidy flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n3 px-2.5 text-[12px] font-medium text-t2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all',
            'hover:border-[var(--border-strong)] hover:bg-n4 hover:text-t1 active:scale-[0.98]',
            'disabled:pointer-events-none disabled:opacity-35'
          )}
        >
          <Sparkles size={12} className="text-[var(--color-accent)] transition-transform duration-300 group-hover/tidy:rotate-12" />
          <span>Tidy</span>
          <span className="kbd ml-0.5 !px-1 !py-[2px] !text-[9.5px]">Ctrl⇧T</span>
        </button>
        </div>
        )}
      </header>

      {/* ── pane grid + session rail (rail dispatches too — one provider) ── */}
      <PaneDispatchContext.Provider value={dispatch}>
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0" style={modeLayer(!orchestrate)} aria-hidden={orchestrate}>
          <div ref={gridHostRef} className="relative h-full w-full overflow-hidden">
            <div
              ref={gridPz.worldRef}
              className="absolute left-0 top-0 p-1.5"
              style={{ width: Math.round(gridSize.W * gz), height: Math.round(gridSize.H * gz) }}
            >
            <CanvasZoomContext.Provider value={gridPz.layoutZoom}>
            {tree ? (
              displayTree ? (
                <PaneHost
                  node={displayTree}
                  focusedId={displayFocus}
                  canSplit={canSplit}
                  onFocus={setFocused}
                  onClose={closeLeafById}
                  onSplit={(leafId, dir) =>
                    spawn(kindOfLeaf(tree, leafId) ?? 'terminal', dir, leafId)
                  }
                  onRatio={(splitId, ratio) => dispatch({ type: 'ratio', splitId, ratio })}
                  onSwapLeaf={(aId, bId) => dispatch({ type: 'swap', aId, bId })}
                  renderLeaf={render}
                />
              ) : (
                // every leaf is in a hidden group — panes still run, the
                // rail's eye toggles bring them back
                <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] select-none">
                  <p className="text-[11.5px] text-t4">
                    All panes hidden — toggle a category in Sessions
                  </p>
                </div>
              )
            ) : (
              <EmptyWorkspace onSpawn={spawn} />
            )}
            </CanvasZoomContext.Provider>
            </div>
            {gridZoomed && (
              <CanvasControls
                view={gridPz.view}
                onZoom={(f) => gridPz.zoomBy(f)}
                onFit={() => gridPz.setView(IDENTITY_VIEW)}
              />
            )}
          </div>
          </div>
          {orchMounted && (
            <div className="absolute inset-0" style={modeLayer(orchestrate)} aria-hidden={!orchestrate}>
              <OrchestrationStage />
            </div>
          )}
          </div>
          <SessionRail
            leaves={leaves}
            focusedId={orchestrate ? null : focus}
            onFocusLeaf={(id) => {
              setMode(false)
              setFocused(id)
            }}
            onSpawnChat={spawnAgentChat}
          />
        </div>
      </PaneDispatchContext.Provider>
    </div>
  )
}

/**
 * One content layer of the workspace (grid or orchestration). The visible
 * one rests with NO transform (a lingering scale would composite terminals
 * soft); the hidden one fades + recedes, then goes visibility:hidden — it
 * keeps its size, so its terminals never refit or resize their pty.
 */
function modeLayer(on: boolean): React.CSSProperties {
  return on
    ? {
        opacity: 1,
        transform: 'none',
        visibility: 'visible',
        pointerEvents: 'auto',
        zIndex: 1,
        transition:
          'opacity 220ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1), visibility 0s'
      }
    : {
        opacity: 0,
        transform: 'scale(0.985)',
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        transition: 'opacity 160ms ease-in, transform 200ms ease-in, visibility 0s linear 200ms'
      }
}

/** Grid ⇄ Orchestrate — the workspace's mode switch, far left of the toolbar. */
function ModeSwitch({
  orchestrate,
  onChange
}: {
  orchestrate: boolean
  onChange: (orchestrate: boolean) => void
}) {
  const seg = (on: boolean) =>
    clsx(
      'relative z-[1] flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-medium transition-colors duration-150',
      on ? 'text-t1' : 'text-t3 hover:text-t2'
    )
  return (
    <div className="seg-track shrink-0">
      {/* sliding thumb */}
      <span
        aria-hidden
        className="seg-thumb"
        style={{ left: 2, width: 'calc(50% - 2px)', transform: orchestrate ? 'translateX(100%)' : 'none' }}
      />
      <button
        type="button"
        className={clsx(seg(!orchestrate), 'flex-1 justify-center')}
        style={{ width: 108 }}
        onClick={() => onChange(false)}
        title="Pane grid"
        aria-pressed={!orchestrate}
      >
        <LayoutGrid size={12} className={clsx('shrink-0', !orchestrate && 'text-accent')} />
        Grid
      </button>
      <button
        type="button"
        className={clsx(seg(orchestrate), 'flex-1 justify-center')}
        style={{ width: 108 }}
        onClick={() => onChange(true)}
        title="Orchestration — an orchestrator with subagent terminals around it"
        aria-pressed={orchestrate}
      >
        <Workflow size={13} strokeWidth={2} className={clsx('shrink-0', orchestrate && 'text-accent')} />
        Orchestrate
      </button>
    </div>
  )
}

/** Kind of the leaf being split, so "split" produces a sibling of the same kind. */
function kindOfLeaf(tree: PaneNode, leafId: string): PaneKind | null {
  const leaf = collectLeaves(tree).find((l) => l.id === leafId)
  return leaf?.kind ?? null
}

function ToolButton({
  icon,
  label,
  kbd,
  disabled,
  onClick
}: {
  icon: ReactNode
  label: string
  kbd?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={kbd ? `${label} — ${kbd}` : label}
      className={clsx(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-t3 transition-colors',
        'hover:bg-n4 hover:text-t1 disabled:pointer-events-none disabled:opacity-35'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

export default WorkspaceView

/** Full-view placeholder when every pane has been closed. */
function EmptyWorkspace({ onSpawn }: { onSpawn: (kind: PaneKind) => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-[var(--border-default)] select-none">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-n3 p-3 text-t4">
        <LayoutGrid size={18} strokeWidth={1.5} />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-medium text-t2">Empty workspace</p>
        <p className="mt-1 text-[11.5px] text-t4">Open a pane to get started.</p>
      </div>
      <div className="flex items-center gap-1.5">
        <ToolButton icon={<Terminal size={12} />} label="New Terminal" onClick={() => onSpawn('terminal')} />
        {SHOW_NEW_BROWSER && (
          <ToolButton icon={<Globe size={12} />} label="New Browser" onClick={() => onSpawn('browser')} />
        )}
      </div>
    </div>
  )
}
