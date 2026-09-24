import { useCallback, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import type { PaneLeaf, PaneNode, PaneSplit, SplitDir } from '../lib/panes'
import { PaneFrame } from './PaneFrame'
import { Divider } from './Divider'

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

/** Recursive renderer for the PaneNode tree. Splits are flex rows/cols with a Divider between. */
export function PaneHost(props: PaneHostProps) {
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
        {props.renderLeaf(node)}
      </PaneFrame>
    )
  }
  if (!node.a && !node.b) return null
  if (!node.a) return <PaneHost {...props} node={node.b} />
  if (!node.b) return <PaneHost {...props} node={node.a} />
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
        <PaneHost key={node.a?.id ?? 'a'} {...host} node={node.a} />
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
        <PaneHost key={node.b?.id ?? 'b'} {...host} node={node.b} />
      </div>
    </div>
  )
}
