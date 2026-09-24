// ── unified diff parsing — hand-rolled, no deps ─────────────────────
//
// Parses `git diff` / `diff -u` output into a typed model for the
// review surface. Handles multiple files, multiple hunks per file,
// renames, new/deleted files, binary files and `\ No newline` markers.

export type DiffLineType = 'ctx' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  /** line number in the old file (ctx + del lines only) */
  oldNo?: number
  /** line number in the new file (ctx + add lines only) */
  newNo?: number
  /** line content, without the leading +/-/space prefix */
  text: string
  /** true when a `\ No newline at end of file` marker follows this line */
  noEol?: boolean
}

export interface DiffHunk {
  /** raw `@@ -a,b +c,d @@` header text */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** context text after the closing @@ (usually the enclosing symbol) */
  section: string
  lines: DiffLine[]
}

export interface DiffFile {
  /** '' when the file is new (/dev/null on the --- side) */
  oldPath: string
  /** '' when the file is deleted (/dev/null on the +++ side) */
  newPath: string
  hunks: DiffHunk[]
  additions: number
  deletions: number
  isNew: boolean
  isDeleted: boolean
  isRenamed: boolean
  isBinary: boolean
}

export interface ParsedDiff {
  files: DiffFile[]
}

// ── inline review comments ───────────────────────────────────────────

/** 'new' = right-hand side (add + ctx lines), 'old' = left-hand side (del lines) */
export type CommentSide = 'new' | 'old'

export interface InlineComment {
  id: string
  filePath: string
  side: CommentSide
  lineNo: number
  /** the commented source line, quoted back to the agent */
  snippet: string
  body: string
}

// ── parser ───────────────────────────────────────────────────────────

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s?(.*)$/
const GIT_DIFF_RE = /^diff --git a\/(.+) b\/(.+)$/

function emptyFile(): DiffFile {
  return {
    oldPath: '',
    newPath: '',
    hunks: [],
    additions: 0,
    deletions: 0,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    isBinary: false
  }
}

/** parse `--- a/foo.ts\t(ts)` style markers → 'foo.ts', or null for /dev/null */
function parseMarkerPath(raw: string): string | null {
  let p = raw.split('\t')[0].trim()
  if (p === '/dev/null') return null
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  if (/^[ab]\//.test(p)) p = p.slice(2)
  return p
}

export function parseDiff(text: string): ParsedDiff {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldRemain = 0
  let newRemain = 0
  // per-file marker state — a `--- ` line only belongs to the current file
  // while it hasn't seen one yet; binary entries never get markers
  let sawOld = false
  let sawNew = false

  // A hunk is "active" until it has consumed the line counts its header
  // promised — this is what lets us tell a `--- ` file header apart from
  // a deleted line whose text happens to start with `--`.
  const hunkActive = () => hunk !== null && (oldRemain > 0 || newRemain > 0)

  const finishFile = () => {
    if (cur) files.push(cur)
    cur = null
    hunk = null
  }

  for (const line of text.split(/\r?\n/)) {
    // ── new file boundary (git format) ──
    if (line.startsWith('diff --git ')) {
      finishFile()
      cur = emptyFile()
      sawOld = false
      sawNew = false
      const m = GIT_DIFF_RE.exec(line)
      if (m) {
        cur.oldPath = m[1]
        cur.newPath = m[2]
      }
      continue
    }

    // ── `--- ` old-path marker: fills the current file's header, or —
    //    when that file already has its markers/hunks (bare non-git
    //    diffs, or git entries like binary files that carry none) —
    //    starts a new file ──
    if (!hunkActive() && line.startsWith('--- ')) {
      if (cur === null || cur.hunks.length > 0 || sawOld || cur.isBinary) {
        finishFile()
        cur = emptyFile()
        sawOld = false
        sawNew = false
      }
      sawOld = true
      const p = parseMarkerPath(line.slice(4))
      if (p === null) cur.isNew = true
      else cur.oldPath = p
      continue
    }

    if (cur === null) continue // skip preamble (commit messages etc.)

    // ── hunk header ──
    if (!hunkActive() && line.startsWith('@@ ')) {
      const m = HUNK_RE.exec(line)
      if (m) {
        hunk = {
          header: line,
          oldStart: parseInt(m[1], 10),
          oldLines: m[2] === undefined ? 1 : parseInt(m[2], 10),
          newStart: parseInt(m[3], 10),
          newLines: m[4] === undefined ? 1 : parseInt(m[4], 10),
          section: m[5] ?? '',
          lines: []
        }
        cur.hunks.push(hunk)
        oldNo = hunk.oldStart
        newNo = hunk.newStart
        oldRemain = hunk.oldLines
        newRemain = hunk.newLines
      }
      continue
    }

    // ── `\ No newline at end of file` marker ──
    if (line.startsWith('\\')) {
      const last = hunk?.lines[hunk.lines.length - 1]
      if (last) last.noEol = true
      continue
    }

    // ── hunk body ──
    if (hunkActive() && hunk) {
      const tag = line[0]
      const body = line.slice(1)
      if (tag === '+') {
        hunk.lines.push({ type: 'add', newNo: newNo++, text: body })
        newRemain = Math.max(0, newRemain - 1)
        cur.additions++
      } else if (tag === '-') {
        hunk.lines.push({ type: 'del', oldNo: oldNo++, text: body })
        oldRemain = Math.max(0, oldRemain - 1)
        cur.deletions++
      } else {
        // ' ' prefix, or a bare '' line (some tools emit truly empty ctx lines)
        hunk.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: tag === ' ' ? body : line })
        oldRemain = Math.max(0, oldRemain - 1)
        newRemain = Math.max(0, newRemain - 1)
      }
      continue
    }

    // ── file-level headers ──
    if (line.startsWith('+++ ')) {
      sawNew = true
      const p = parseMarkerPath(line.slice(4))
      if (p === null) cur.isDeleted = true
      else cur.newPath = p
    } else if (line.startsWith('new file mode')) {
      cur.isNew = true
    } else if (line.startsWith('deleted file mode')) {
      cur.isDeleted = true
    } else if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice(12).trim()
      cur.isRenamed = true
    } else if (line.startsWith('rename to ')) {
      cur.newPath = line.slice(10).trim()
      cur.isRenamed = true
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      cur.isBinary = true
    }
    // index / old mode / new mode / similarity / copy lines: ignored
  }
  finishFile()

  // post-pass: a path mismatch without explicit rename headers still
  // means the file moved (e.g. hand-edited diffs)
  for (const f of files) {
    if (!f.isRenamed && f.oldPath && f.newPath && f.oldPath !== f.newPath) {
      f.isRenamed = true
    }
  }
  return { files }
}

/** path to show in the UI — new path wins, falls back to old for deletions */
export function displayPath(f: DiffFile): string {
  return f.newPath || f.oldPath || 'unknown file'
}

export function diffStats(parsed: ParsedDiff): { files: number; additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const f of parsed.files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { files: parsed.files.length, additions, deletions }
}

// ── comment → agent message ──────────────────────────────────────────

/**
 * Build the markdown message sent back to the agent when the reviewer
 * finishes an inline-comment pass. Each comment becomes a file:line
 * reference with the quoted source line and the reviewer's note.
 */
export function buildCommentBatch(comments: InlineComment[]): string {
  if (comments.length === 0) return ''
  const sorted = [...comments].sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.lineNo - b.lineNo
  )
  const parts = sorted.map((c) => {
    const where = c.side === 'old' ? ' *(removed line)*' : ''
    const quote = c.snippet ? `\n> ${c.snippet}` : ''
    return `**${c.filePath}:${c.lineNo}**${where}${quote}\n\n${c.body.trim()}`
  })
  return (
    `Review comments (${comments.length}) — please address each one and resubmit:\n\n` +
    parts.join('\n\n---\n\n')
  )
}

// ── demo fixture ─────────────────────────────────────────────────────
// A realistic 3-file diff for previewing the review surface without git:
// a refactor (2 hunks), a brand-new file, and a deletion.

export const DEMO_DIFF = `diff --git a/src/main/agent-runner.ts b/src/main/agent-runner.ts
index 3f4a8c2..9d1b7e4 100644
--- a/src/main/agent-runner.ts
+++ b/src/main/agent-runner.ts
@@ -34,9 +34,9 @@ export class AgentRunner {
   private worktree: string | null = null
   private proc: ChildProcess | null = null
-  private pollTimer: NodeJS.Timeout | null = null
+  private emitter = new EventEmitter()
 
   async start(card: TaskCard) {
     const wt = await createWorktree(this.project.rootPath, card.id)
     this.worktree = wt.path
-    this.pollTimer = setInterval(() => this.checkStatus(), 2000)
+    this.emitter.on('status', (s: RunStatus) => this.onStatus(s))
   }
@@ -88,5 +88,8 @@ export class AgentRunner {
   private async checkStatus() {
     const out = await git(this.worktree!, 'status', '--porcelain')
-    if (!out) return this.emit('idle')
+    if (!out) {
+      this.emitter.emit('status', 'idle')
+      return
+    }
     this.emit('dirty', out)
   }
diff --git a/src/renderer/src/lib/checks.ts b/src/renderer/src/lib/checks.ts
new file mode 100644
index 0000000..e2c4a91
--- /dev/null
+++ b/src/renderer/src/lib/checks.ts
@@ -0,0 +1,16 @@
+import type { CheckItem } from '../review/ChecksPanel'
+
+export function mergeVerdict(checks: CheckItem[]): 'pass' | 'fail' | 'pending' | 'warn' {
+  if (checks.some((c) => c.status === 'fail')) return 'fail'
+  if (checks.some((c) => c.status === 'pending')) return 'pending'
+  if (checks.some((c) => c.status === 'warn')) return 'warn'
+  return 'pass'
+}
+
+export function formatCheckSummary(checks: CheckItem[]): string {
+  const fail = checks.filter((c) => c.status === 'fail').length
+  const pend = checks.filter((c) => c.status === 'pending').length
+  if (fail) return fail + ' failing'
+  if (pend) return pend + ' running'
+  return 'all green'
+}
\\ No newline at end of file
diff --git a/src/main/fs-watcher.ts b/src/main/fs-watcher.ts
deleted file mode 100644
index 8b3d1aa..0000000
--- a/src/main/fs-watcher.ts
+++ /dev/null
@@ -1,14 +0,0 @@
-import { watch } from 'chokidar'
-import { EventEmitter } from 'events'
-
-// Legacy watcher — superseded by worktree-status events.
-export class FsWatcher extends EventEmitter {
-  private watcher: ReturnType<typeof watch> | null = null
-
-  start(root: string) {
-    this.watcher = watch(root, { ignoreInitial: true })
-    this.watcher.on('change', (p) => this.emit('change', p))
-  }
-
-  async stop() {
-    await this.watcher?.close()
-  }
-}
`
