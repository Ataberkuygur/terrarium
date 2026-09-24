import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { collectLeaves, type PaneNode, type PaneSplit, type SplitDir, type PaneLeaf } from '../lib/panes'
import { PaneFrame, paneTitle } from './PaneFrame'
import { Divider } from './Divider'
import { ErrorBoundary } from '../components/ErrorBoundary'

export interface PaneHostProps {
  node: PaneNode
  focusedId: string | null
  canSplit: boolean
  onFocus: (leafId: string) => void
  onClose: (leafId: string) => void
  onSplit: (leafId: string, dir: SplitDir) => void
  onRatio: (splitId: string, ratio: number) => void
  /** Header-drag drop on a leaf → swap the two leaves' positions. */
  onSwapLeaf?: (aId: string, bId: string) => void
  /** Pluggable content renderer — the terminal/file agent hooks in here. */
  renderLeaf: (leaf: PaneLeaf) => ReactNode
}

// ── stable leaf content ──────────────────────────────────────────────
// A split, close or swap rebuilds the frame nesting (leaf → split(a, b)),
// and React remounts everything under a node whose parent changed. For a
// terminal that meant a fresh xterm re-attaching and replaying scrollback
// recorded at the OLD width into the new one — wrapped, overlapping TUI
// frames. So each leaf's content renders ONCE, portalled into a persistent
// container, and that container is moved into whichever frame currently
// shows the leaf. A move is just a resize to the content.
const SlotContext = createContext<((leafId: string) => HTMLDivElement) | null>(null)

/** Top of the pane tree — owns the per-leaf content containers. */
export function PaneHost(props: PaneHostProps) {
  const containers = useRef(new Map<string, HTMLDivElement>())
  const containerFor = useCallback((leafId: string) => {
    let c = containers.current.get(leafId)
    if (!c) {
      c = document.createElement('div')
      c.style.cssText = 'position:absolute;inset:0'
      containers.current.set(leafId, c)
    }
    return c
  }, [])
  const leaves = collectLeaves(props.node)
  const liveIds = leaves.map((l) => l.id).join('\n')
  // drop containers of leaves that left the tree (their portals are gone)
  useEffect(() => {
    const live = new Set(liveIds.split('\n'))
    for (const id of containers.current.keys()) {
      if (!live.has(id)) containers.current.delete(id)
    }
  }, [liveIds])
  return (
    <SlotContext.Provider value={containerFor}>
      <PaneNodeView {...props} />
      {leaves.map((leaf) =>
        createPortal(
          <ErrorBoundary fallbackTitle={`${paneTitle(leaf)} error`}>
            {props.renderLeaf(leaf)}
          </ErrorBoundary>,
          containerFor(leaf.id),
          leaf.id
        )
      )}
    </SlotContext.Provider>
  )
}

/** Where a leaf's persistent content container is mounted inside its frame. */
function LeafSlot({ leafId }: { leafId: string }) {
  const containerFor = useContext(SlotContext)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host || !containerFor) return
    const c = containerFor(leafId)
    host.appendChild(c)
    return () => {
      if (c.parentNode === host) host.removeChild(c)
    }
  }, [containerFor, leafId])
  return <div ref={ref} className="absolute inset-0" />
}

/** Recursive renderer for the PaneNode tree. Splits are flex rows/cols with a Divider between. */
function PaneNodeView(props: PaneHostProps) {
  const { node } = props
  if (!node) return null
  if (node.type === 'leaf') {
    return (
      <PaneFrame
        leaf={node}
        focused={node.id === props.focusedId}
        canSplit={props.canSplit}
        onFocus={() => props.onFocus(node.id)}
        onClose={() => props.onClose(node.id)}
        onSplit={(dir) => props.onSplit(node.id, dir)}
        onSwapLeaf={(fromId) => props.onSwapLeaf?.(fromId, node.id)}
      >
        <LeafSlot leafId={node.id} />
      </PaneFrame>
    )
  }
  if (!node.a && !node.b) return null
  if (!node.a) return <PaneNodeView {...props} node={node.b} />
  if (!node.b) return <PaneNodeView {...props} node={node.a} />
  return <SplitNode node={node} host={props} />
}

function SplitNode({ node, host }: { node: PaneSplit; host: PaneHostProps }) {
  const aRef = useRef<HTMLDivElement>(null)
  const bRef = useRef<HTMLDivElement>(null)

  const ratio = Number.isFinite(node.ratio) ? Math.min(0.85, Math.max(0.15, node.ratio)) : 0.5

  // Live drag: mutate flexGrow on the DOM directly — zero React re-renders.
  // The committed dispatch on pointerup re-syncs style props with state.
  const preview = useCallback((r: number) => {
    const validRatio = Number.isFinite(r) ? Math.min(0.85, Math.max(0.15, r)) : 0.5
    if (aRef.current) aRef.current.style.flexGrow = String(validRatio)
    if (bRef.current) bRef.current.style.flexGrow = String(1 - validRatio)
  }, [])

  return (
    <div
      className={clsx(
        'flex h-full w-full min-w-0',
        node.dir === 'row' ? 'flex-row' : 'flex-col'
      )}
      style={{ minHeight: 0 }}
    >
      <div
        ref={aRef}
        className="min-h-0 min-w-0"
        style={{ flexGrow: ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneNodeView key={node.a?.id ?? 'a'} {...host} node={node.a} />
      </div>
      <Divider
        dir={node.dir}
        onPreview={preview}
        onCommit={(r) => host.onRatio(node.id, r)}
      />
      <div
        ref={bRef}
        className="min-h-0 min-w-0"
        style={{ flexGrow: 1 - ratio, flexShrink: 1, flexBasis: 0 }}
      >
        <PaneNodeView key={node.b?.id ?? 'b'} {...host} node={node.b} />
      </div>
    </div>
  )
}
