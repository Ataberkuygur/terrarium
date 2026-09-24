// ── inline review comment model ──────────────────────────────────────
// The canonical types live in lib/diff.ts (buildCommentBatch needs them);
// this module adds the view-layer helpers for keying and grouping them.

import type { CommentSide, InlineComment } from '../lib/diff'

export type { CommentSide, InlineComment }

/** stable map key for "comments attached to this rendered line" */
export function commentKey(filePath: string, side: CommentSide, lineNo: number): string {
  return `${filePath}|${side}|${lineNo}`
}

let seq = 0

/** comment ids follow the repo's rid() shape: <prefix>-<base36-ts>-<seq> */
export function makeComment(input: {
  filePath: string
  side: CommentSide
  lineNo: number
  snippet: string
  body: string
}): InlineComment {
  return { id: `cmt-${Date.now().toString(36)}-${(seq++).toString(36)}`, ...input }
}

/** group comments by their line key, preserving insertion order */
export function groupComments(comments: InlineComment[]): Map<string, InlineComment[]> {
  const m = new Map<string, InlineComment[]>()
  for (const c of comments) {
    const k = commentKey(c.filePath, c.side, c.lineNo)
    const list = m.get(k)
    if (list) list.push(c)
    else m.set(k, [c])
  }
  return m
}
