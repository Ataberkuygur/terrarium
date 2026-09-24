/**
 * frontmatter.ts — YAML frontmatter + body analysis for wiki pages.
 *
 * Parsing goes through gray-matter (tolerant of whatever Obsidian/users write).
 * Serialization is hand-rolled: our frontmatter shape is small and flat, and
 * writing it ourselves gives a stable key order, ISO timestamps, and LF endings
 * on every write — gray-matter's js-yaml output is left for reading only.
 *
 * Canonical file shape:
 *   ---
 *   id: wp-home
 *   title: Terrarium — Project Home
 *   type: overview
 *   created: 2025-01-01T00:00:00.000Z
 *   updated: 2025-01-01T00:00:00.000Z
 *   stale: false
 *   source_files:
 *     - src/main/index.ts
 *   ---
 *
 *   # body ...
 */
import matter from 'gray-matter'
import type { WikiPageMeta } from '../../shared/types'

export interface PageFrontmatter {
  id: string
  title: string
  type: WikiPageMeta['type']
  /** epoch ms */
  created: number
  /** epoch ms */
  updated: number
  stale: boolean
  /** repo-relative paths this page was generated from; a trailing `/` means "everything under this dir" */
  sourceFiles: string[]
}

export const PAGE_TYPES: ReadonlySet<string> = new Set([
  'overview',
  'architecture',
  'module',
  'file',
  'howto',
  'glossary',
  'report'
])

// ── parsing ─────────────────────────────────────────────────────────

function toEpoch(v: unknown, fallback: number): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return fallback
}

function toType(v: unknown, fallback: WikiPageMeta['type']): WikiPageMeta['type'] {
  return typeof v === 'string' && PAGE_TYPES.has(v) ? (v as WikiPageMeta['type']) : fallback
}

function toStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

export interface ParsedPage {
  fm: PageFrontmatter
  /** markdown body, frontmatter stripped, LF endings */
  body: string
  /** true when the file had no usable frontmatter id — caller should write one back */
  missingId: boolean
}

/**
 * Parse a .md file into frontmatter + body. Missing/invalid fields fall back to
 * `defaults` so a hand-written Obsidian note with zero frontmatter still yields
 * a usable record. Never throws on bad YAML — treats it as no frontmatter.
 */
export function parsePage(
  raw: string,
  defaults: { id: string; title: string; type: WikiPageMeta['type'] }
): ParsedPage {
  const now = Date.now()
  let data: Record<string, unknown> = {}
  let body = raw
  try {
    const parsed = matter(raw)
    data = (parsed.data ?? {}) as Record<string, unknown>
    body = parsed.content
  } catch {
    // malformed YAML — treat the whole file as body
    data = {}
    body = raw
  }

  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : defaults.id
  const title =
    typeof data.title === 'string' && data.title.trim() ? data.title.trim() : defaults.title

  return {
    fm: {
      id,
      title,
      type: toType(data.type, defaults.type),
      created: toEpoch(data.created, now),
      updated: toEpoch(data.updated, now),
      stale: data.stale === true,
      sourceFiles: toStringList(data.source_files)
    },
    body: toLF(body).replace(/^\n+/, ''),
    missingId: !(typeof data.id === 'string' && data.id.trim())
  }
}

// ── serialization ───────────────────────────────────────────────────

/** YAML-safe scalar: plain when possible, JSON double-quoted otherwise. */
function yamlScalar(v: string): string {
  // conservative safe set — anything else gets a quoted scalar (valid YAML 1.2)
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/()\-\[\]']*$/.test(v) && !/[:#]$/.test(v)) return v
  return JSON.stringify(v)
}

/** Serialize frontmatter + body into the canonical file text (LF endings, trailing newline). */
export function serializePage(fm: PageFrontmatter, body: string): string {
  const lines: string[] = [
    '---',
    `id: ${yamlScalar(fm.id)}`,
    `title: ${yamlScalar(fm.title)}`,
    `type: ${fm.type}`,
    `created: ${new Date(fm.created).toISOString()}`,
    `updated: ${new Date(fm.updated).toISOString()}`,
    `stale: ${fm.stale ? 'true' : 'false'}`
  ]
  if (fm.sourceFiles.length === 0) {
    lines.push('source_files: []')
  } else {
    lines.push('source_files:')
    for (const f of fm.sourceFiles) lines.push(`  - ${yamlScalar(f)}`)
  }
  lines.push('---', '')
  const text = lines.join('\n') + toLF(body).replace(/^\n+/, '')
  return text.endsWith('\n') ? text : text + '\n'
}

// ── body analysis ───────────────────────────────────────────────────

export function toLF(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

/**
 * Remove fenced code blocks (``` or ~~~) so [[links]] and headings inside code
 * samples are not indexed — matching the renderer, which never linkifies
 * fenced content.
 */
export function stripFencedCode(body: string): string {
  const lines = body.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (m) {
      const marker = m[1][0] // '`' or '~'
      if (fence === null) {
        fence = marker
      } else if (marker === fence) {
        fence = null
      }
      continue
    }
    if (fence === null) out.push(line)
  }
  return out.join('\n')
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g

/** Outgoing [[wikilink]] targets as written (ids, titles or paths), deduped, fences skipped. */
export function extractWikilinks(body: string): string[] {
  const text = stripFencedCode(body)
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(text))) {
    const t = m[1].trim()
    if (t && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

export interface Heading {
  depth: number
  text: string
}

/** Markdown headings outside fenced code. Inline marks are left as-is. */
export function extractHeadings(body: string): Heading[] {
  const text = stripFencedCode(body)
  const out: Heading[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) out.push({ depth: m[1].length, text: m[2].replace(/\s+#+\s*$/, '').trim() })
  }
  return out
}

// ── AUTOGEN blocks ──────────────────────────────────────────────────
// Generated sections are wrapped in markers so regeneration can replace them
// without clobbering prose a human wrote around them:
//   <!-- AUTOGEN:files --> ...generated... <!-- /AUTOGEN -->

export const AUTOGEN_CLOSE = '<!-- /AUTOGEN -->'
export const autogenOpen = (name: string): string => `<!-- AUTOGEN:${name} -->`

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace the `<!-- AUTOGEN:name -->` block inside `body` with `inner`.
 * If the marker is absent, the block is appended at the end.
 */
export function upsertAutogenBlock(body: string, name: string, inner: string): string {
  const block = `${autogenOpen(name)}\n${inner}\n${AUTOGEN_CLOSE}`
  const re = new RegExp(`${escapeRe(autogenOpen(name))}[\\s\\S]*?${escapeRe(AUTOGEN_CLOSE)}`)
  if (re.test(body)) return body.replace(re, block)
  const base = body.trimEnd()
  return (base ? base + '\n\n' : '') + block + '\n'
}

const AUTOGEN_RE = /<!-- AUTOGEN:([A-Za-z0-9_-]+) -->[\s\S]*?<!-- \/AUTOGEN -->/g

/**
 * Splice every AUTOGEN block found in `fresh` into `existing`, preserving any
 * human-written content in `existing` that lives outside markers. If `existing`
 * contains none of the markers, blocks are appended.
 */
export function mergeAutogenBodies(existing: string, fresh: string): string {
  const blocks: { name: string; inner: string }[] = []
  let m: RegExpExecArray | null
  AUTOGEN_RE.lastIndex = 0
  while ((m = AUTOGEN_RE.exec(fresh))) {
    const name = m[1]
    const inner = m[0]
      .slice(autogenOpen(name).length, m[0].length - AUTOGEN_CLOSE.length)
      .replace(/^\n+|\n+$/g, '')
    blocks.push({ name, inner })
  }
  let out = existing
  for (const b of blocks) out = upsertAutogenBlock(out, b.name, b.inner)
  return out
}
