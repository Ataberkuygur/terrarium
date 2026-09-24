/**
 * index.ts — in-memory metadata cache over a wiki vault.
 *
 * Parses each .md once (gray-matter frontmatter + [[wikilink]] extraction +
 * headings), maintains id↔path maps, resolves links to page ids, and derives
 * the backlink map + unresolved-link set. File events arrive from VaultWatcher
 * and are folded in via a debounced (300ms) reindex; our own writes are marked
 * on the watcher first so they fall inside the 500ms self-write grace.
 *
 * FTS loose coupling: every content change is announced on `wikiBus` as
 *   'doc.changed' { projectId, pageId, path, title, body }
 *   'doc.removed' { projectId, pageId, path }
 * The engine's FTS module subscribes to wikiBus and maintains its own docs
 * table — this module never imports it. `indexDoc`/`removeDoc` are exported
 * helpers so the engine can also push/pull documents through the same bus.
 *
 * Page ids are stable across renames: the id lives in the file's frontmatter,
 * so a moved/renamed file reattaches to its existing record by id.
 */
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import type { FSWatcher } from 'chokidar'
import type { Project, WikiPage, WikiPageMeta } from '../../shared/types'
import {
  extractHeadings,
  extractWikilinks,
  mergeAutogenBodies,
  parsePage,
  serializePage,
  toLF,
  type Heading,
  type PageFrontmatter
} from './frontmatter'
import {
  DEMO_SLUG,
  absPath,
  ensureVault,
  fileExists,
  kebab,
  listMarkdownFiles,
  readPageFile,
  seedDemoVault,
  slugify,
  vaultDirForSlug,
  writePage
} from './vault'
import { VaultWatcher, watchRepoSources, type VaultEvent } from './watcher'

const REINDEX_DEBOUNCE_MS = 300

// ── FTS bus (loose coupling — engine module listens, we never import it) ──

export interface WikiDocPayload {
  projectId: string
  pageId: string
  /** vault-relative .md path */
  path: string
  title: string
  /** markdown body, frontmatter stripped */
  body: string
}

export const wikiBus = new EventEmitter()
wikiBus.setMaxListeners(50)

/** Announce (or re-announce) a document to the FTS index. Engine-side docs table listens on 'doc.changed'. */
export function indexDoc(doc: WikiDocPayload): void {
  wikiBus.emit('doc.changed', doc)
}

/** Drop a document from the FTS index. Engine listens on 'doc.removed'. */
export function removeDoc(projectId: string, pageId: string, path: string): void {
  wikiBus.emit('doc.removed', { projectId, pageId, path })
}

// ── records ─────────────────────────────────────────────────────────

interface PageRecord {
  id: string
  /** vault-relative posix path */
  path: string
  title: string
  type: WikiPageMeta['type']
  stale: boolean
  sourceFiles: string[]
  created: number
  updated: number
  headings: Heading[]
  /** [[targets]] as written */
  rawTargets: string[]
  /** resolved outgoing page ids */
  links: string[]
  body: string
}

export interface WikiChangedEvent {
  projectId: string
  pages: WikiPageMeta[]
}

export interface CreatePageInput {
  title: string
  type?: WikiPageMeta['type']
  body?: string
  /** explicit vault-relative path; defaults to kebab(title).md */
  path?: string
}

export interface GeneratedSpec {
  id: string
  path: string
  title: string
  type: WikiPageMeta['type']
  sourceFiles: string[]
  /** full fresh body; when the page exists, only its AUTOGEN blocks are spliced in */
  body: string
}

export class WikiIndex extends EventEmitter {
  readonly projectId: string
  readonly slug: string
  /** vault root dir */
  readonly dir: string

  private records = new Map<string, PageRecord>()
  private byPath = new Map<string, string>() // rel path → id
  private byTitle = new Map<string, string>()
  private byStem = new Map<string, string>()
  private byPathNoExt = new Map<string, string>()
  private backlinks = new Map<string, Set<string>>()
  private unresolvedMap = new Map<string, Set<string>>() // target → linking page ids

  private watcher: VaultWatcher | null = null
  private repoWatcher: FSWatcher | null = null
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(projectId: string, opts: { slug?: string; dir?: string } = {}) {
    super()
    this.projectId = projectId
    this.slug = opts.slug ?? slugify(projectId.replace(/^proj-/, ''))
    this.dir = opts.dir ?? vaultDirForSlug(this.slug)
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  /**
   * Create/seed the vault, reconcile-scan every file, then start the watcher.
   * The scan is the reconcile: anything changed while the app was closed is
   * picked up here, and a second reconcile on watcher 'ready' closes the race
   * between scan and watch start.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (this.dir === vaultDirForSlug(this.slug)) {
      await ensureVault(this.slug) // mkdir + demo seed when empty
    } else {
      await fs.mkdir(this.dir, { recursive: true })
      if (this.slug === DEMO_SLUG && (await listMarkdownFiles(this.dir)).length === 0) {
        await seedDemoVault(this.dir)
      }
    }

    for (const rel of await listMarkdownFiles(this.dir)) {
      await this.ingestFile(rel)
    }
    this.rebuild()

    this.watcher = new VaultWatcher(this.dir)
    this.watcher.on('event', (e: VaultEvent) => this.onVaultEvent(e))
    this.watcher.on('error', (err) => {
      // EventEmitter throws on unhandled 'error' — degrade to a warning
      if (this.listenerCount('error') > 0) this.emit('error', err)
      else console.warn('[wiki] watcher error:', err)
    })
    await this.watcher.start()
    await this.reconcile()

    this.initialized = true
    for (const rec of this.records.values()) this.announceDoc(rec)
    this.emitChanged()
  }

  /** Start watching the project repo; changed source files mark dependent pages stale. */
  watchSources(repoPath: string): void {
    this.repoWatcher?.close()
    this.repoWatcher = watchRepoSources(repoPath, (files) => {
      void this.markStaleBySourceFiles(files)
    })
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const rw = this.repoWatcher
    this.repoWatcher = null
    if (rw) await rw.close()
    const w = this.watcher
    this.watcher = null
    if (w) await w.close()
    this.initialized = false
  }

  // ── ingest / reconcile ────────────────────────────────────────────

  private onVaultEvent(e: VaultEvent): void {
    if (e.kind === 'rescan') {
      void this.reconcile()
      return
    }
    this.dirty.add(e.path)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flushDirty(), REINDEX_DEBOUNCE_MS)
    this.flushTimer.unref?.()
  }

  /** Fold queued file events into the index in one pass. */
  private async flushDirty(): Promise<void> {
    this.flushTimer = null
    const paths = [...this.dirty]
    this.dirty.clear()
    const removed: PageRecord[] = []
    const changed: string[] = []
    for (const rel of paths) {
      try {
        if (await fileExists(this.dir, rel)) {
          const id = await this.ingestFile(rel)
          if (id) changed.push(id)
        } else {
          const rec = this.removePath(rel)
          if (rec) removed.push(rec)
        }
      } catch {
        // file vanished mid-read or unparsable — next event or reconcile heals
      }
    }
    this.rebuild()
    for (const rec of removed) removeDoc(this.projectId, rec.id, rec.path)
    for (const id of changed) {
      const rec = this.records.get(id)
      if (rec) this.announceDoc(rec)
    }
    this.emitChanged()
  }

  /** Diff disk state vs the index — fixes anything missed while down or during watcher startup. */
  private async reconcile(): Promise<void> {
    const onDisk = new Set(await listMarkdownFiles(this.dir))
    const removed: PageRecord[] = []
    for (const [rel, id] of [...this.byPath]) {
      if (!onDisk.has(rel)) {
        const rec = this.removePath(rel)
        if (rec) removed.push(rec)
      }
    }
    let changedAny = false
    for (const rel of onDisk) {
      if (!this.byPath.has(rel)) {
        await this.ingestFile(rel)
        changedAny = true
      }
    }
    if (changedAny || removed.length > 0) {
      this.rebuild()
      for (const rec of removed) removeDoc(this.projectId, rec.id, rec.path)
      this.emitChanged()
    }
  }

  private static stemOf(rel: string): string {
    const base = rel.split('/').pop() ?? rel
    return base.replace(/\.md$/i, '')
  }

  private static humanize(stem: string): string {
    return stem
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  }

  private uniqueId(base: string): string {
    let id = base
    let n = 2
    while (this.records.has(id)) id = `${base}-${n++}`
    return id
  }

  private uniquePath(name: string): string {
    if (!this.byPath.has(name)) return name
    const stem = name.replace(/\.md$/i, '')
    let n = 2
    let p = `${stem}-${n}.md`
    while (this.byPath.has(p)) p = `${stem}-${++n}.md`
    return p
  }

  /**
   * Read + parse one file into a record. Assigns a stable id: frontmatter id
   * wins; files with none get `wp-<stem>` written back into their frontmatter.
   * A file arriving at a new path with a known id is treated as a rename —
   * the record keeps its id and just moves path. Returns the page id.
   */
  private async ingestFile(rel: string): Promise<string | null> {
    let raw: string
    try {
      raw = await readPageFile(this.dir, rel)
    } catch {
      return null
    }
    const stem = WikiIndex.stemOf(rel)
    const parsed = parsePage(raw, {
      id: `wp-${kebab(stem)}`,
      title: WikiIndex.humanize(stem),
      type: 'file'
    })
    const fm = parsed.fm
    let needWriteBack = parsed.missingId

    const existingId = this.byPath.get(rel)
    let rec: PageRecord
    if (existingId !== undefined) {
      rec = this.records.get(existingId)!
      if (fm.id !== rec.id) {
        if (!this.records.has(fm.id)) {
          // id edited in frontmatter — adopt it, keep the record
          this.records.delete(rec.id)
          rec.id = fm.id
          this.records.set(rec.id, rec)
        } else {
          // collision: keep the record's stable id, fix the file
          fm.id = rec.id
          needWriteBack = true
        }
      }
    } else if (this.records.has(fm.id)) {
      const other = this.records.get(fm.id)!
      if (!(await fileExists(this.dir, other.path))) {
        // rename/move: file kept its id, path changed
        this.byPath.delete(other.path)
        other.path = rel
        this.byPath.set(rel, other.id)
        rec = other
      } else {
        // genuine id collision — give the new file its own id
        fm.id = this.uniqueId(fm.id)
        needWriteBack = true
        rec = this.freshRecord(fm, rel)
      }
    } else {
      rec = this.freshRecord(fm, rel)
    }

    rec.title = fm.title
    rec.type = fm.type
    rec.stale = fm.stale
    rec.sourceFiles = fm.sourceFiles
    rec.created = fm.created
    rec.updated = fm.updated
    rec.body = parsed.body
    rec.headings = extractHeadings(rec.body)
    rec.rawTargets = extractWikilinks(rec.body)

    if (needWriteBack) await this.persist(rec)
    return rec.id
  }

  private freshRecord(fm: PageFrontmatter, rel: string): PageRecord {
    const rec: PageRecord = {
      id: fm.id,
      path: rel,
      title: fm.title,
      type: fm.type,
      stale: fm.stale,
      sourceFiles: fm.sourceFiles,
      created: fm.created,
      updated: fm.updated,
      headings: [],
      rawTargets: [],
      links: [],
      body: ''
    }
    this.records.set(rec.id, rec)
    this.byPath.set(rel, rec.id)
    return rec
  }

  private removePath(rel: string): PageRecord | null {
    const id = this.byPath.get(rel)
    if (id === undefined) return null
    this.byPath.delete(rel)
    const rec = this.records.get(id)!
    this.records.delete(id)
    return rec
  }

  /** Recompute lookup maps, resolved links, backlinks, unresolved set. */
  private rebuild(): void {
    this.byTitle.clear()
    this.byStem.clear()
    this.byPathNoExt.clear()
    for (const rec of this.records.values()) {
      const lt = rec.title.toLowerCase()
      if (!this.byTitle.has(lt)) this.byTitle.set(lt, rec.id)
      const stem = WikiIndex.stemOf(rec.path).toLowerCase()
      if (!this.byStem.has(stem)) this.byStem.set(stem, rec.id)
      const noExt = rec.path.replace(/\.md$/i, '').toLowerCase()
      if (!this.byPathNoExt.has(noExt)) this.byPathNoExt.set(noExt, rec.id)
    }

    this.backlinks.clear()
    this.unresolvedMap.clear()
    for (const rec of this.records.values()) {
      const seen = new Set<string>()
      rec.links = []
      for (const target of rec.rawTargets) {
        const id = this.resolveLinkTitle(target)
        if (id === null) {
          let set = this.unresolvedMap.get(target)
          if (!set) this.unresolvedMap.set(target, (set = new Set()))
          set.add(rec.id)
          continue
        }
        if (id === rec.id || seen.has(id)) continue
        seen.add(id)
        rec.links.push(id)
        let set = this.backlinks.get(id)
        if (!set) this.backlinks.set(id, (set = new Set()))
        set.add(rec.id)
      }
    }
  }

  // ── resolution ────────────────────────────────────────────────────

  /**
   * Resolve a [[wikilink]] target to a page id. Accepts (in order):
   * exact id, exact title (case-insensitive), vault path with/without .md,
   * filename stem, and kebab(title). Mirrors the renderer's resolveLink plus
   * Obsidian-style path/stem links.
   */
  resolveLinkTitle(target: string): string | null {
    const t = target.trim()
    if (!t) return null
    const lower = t.toLowerCase()
    if (this.records.has(t)) return t
    const byTitle = this.byTitle.get(lower)
    if (byTitle) return byTitle
    const noExt = lower.replace(/\.md$/i, '')
    const byPath = this.byPathNoExt.get(noExt)
    if (byPath) return byPath
    const byStem = this.byStem.get(noExt.split('/').pop()!)
    if (byStem) return byStem
    const byKebab = this.byStem.get(kebab(t))
    if (byKebab) return byKebab
    return null
  }

  /** [[targets]] that resolve to no page, each with the ids linking it. */
  unresolvedLinks(): { target: string; from: string[] }[] {
    return [...this.unresolvedMap.entries()].map(([target, from]) => ({
      target,
      from: [...from].sort()
    }))
  }

  // ── public api ────────────────────────────────────────────────────

  private meta(rec: PageRecord): WikiPageMeta {
    return {
      id: rec.id,
      title: rec.title,
      path: rec.path,
      type: rec.type,
      stale: rec.stale,
      links: [...rec.links],
      updatedAt: rec.updated
    }
  }

  /** index.md first, then alphabetical by title. */
  list(): WikiPageMeta[] {
    return [...this.records.values()]
      .sort((a, b) => {
        if (a.path === 'index.md') return -1
        if (b.path === 'index.md') return 1
        return a.title.localeCompare(b.title)
      })
      .map((r) => this.meta(r))
  }

  get(pageId: string): WikiPage {
    const rec = this.records.get(pageId)
    if (!rec) throw new Error(`no page ${pageId}`)
    return {
      ...this.meta(rec),
      body: rec.body,
      backlinks: [...(this.backlinks.get(rec.id) ?? [])].sort()
    }
  }

  has(idOrPath: string): boolean {
    return this.records.has(idOrPath) || this.byPath.has(idOrPath)
  }

  /** Naive substring search over title + body — the FTS module supersedes this. */
  search(q: string): WikiPageMeta[] {
    const needle = q.toLowerCase()
    return [...this.records.values()]
      .filter(
        (r) => r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle)
      )
      .map((r) => this.meta(r))
  }

  /** Save new body for a page (frontmatter preserved, `updated` bumped). */
  async save(pageId: string, body: string): Promise<WikiPage> {
    const rec = this.records.get(pageId)
    if (!rec) throw new Error(`no page ${pageId}`)
    rec.body = toLF(body)
    rec.updated = Date.now()
    rec.headings = extractHeadings(rec.body)
    rec.rawTargets = extractWikilinks(rec.body)
    await this.persist(rec)
    this.rebuild()
    this.announceDoc(rec)
    this.emitChanged()
    return this.get(pageId)
  }

  async create(input: CreatePageInput): Promise<WikiPage> {
    const id = this.uniqueId(`wp-${kebab(input.title)}`)
    const path = this.uniquePath(input.path ?? `${kebab(input.title)}.md`)
    const now = Date.now()
    const rec = this.freshRecord(
      {
        id,
        title: input.title,
        type: input.type ?? 'file',
        created: now,
        updated: now,
        stale: false,
        sourceFiles: []
      },
      path
    )
    rec.body = toLF(input.body ?? `# ${input.title}\n`)
    rec.headings = extractHeadings(rec.body)
    rec.rawTargets = extractWikilinks(rec.body)
    await this.persist(rec)
    this.rebuild()
    this.announceDoc(rec)
    this.emitChanged()
    return this.get(id)
  }

  /**
   * Write or refresh a generated page. When the page already exists (by id or
   * path), only AUTOGEN-marked blocks from `spec.body` are spliced into the
   * existing body — human prose survives regeneration. Returns what happened.
   */
  async upsertGenerated(spec: GeneratedSpec): Promise<'created' | 'updated' | 'unchanged'> {
    const existing =
      this.records.get(spec.id) ?? this.records.get(this.byPath.get(spec.path) ?? '')
    const now = Date.now()

    if (!existing) {
      const path = this.uniquePath(spec.path)
      const rec = this.freshRecord(
        {
          id: spec.id,
          title: spec.title,
          type: spec.type,
          created: now,
          updated: now,
          stale: false,
          sourceFiles: spec.sourceFiles
        },
        path
      )
      rec.body = toLF(spec.body)
      rec.headings = extractHeadings(rec.body)
      rec.rawTargets = extractWikilinks(rec.body)
      await this.persist(rec)
      this.rebuild()
      this.announceDoc(rec)
      this.emitChanged()
      return 'created'
    }

    const mergedBody = mergeAutogenBodies(existing.body, toLF(spec.body))
    const nextFm: PageFrontmatter = {
      id: existing.id,
      title: spec.title,
      type: spec.type,
      created: existing.created,
      updated: existing.updated,
      stale: false, // regenerated content is fresh by definition
      sourceFiles: spec.sourceFiles
    }
    // byte-identical output → skip the write entirely (no mtime churn, no events)
    const unchanged =
      serializePage(nextFm, mergedBody) === serializePage(this.fmOf(existing), existing.body)
    if (unchanged) return 'unchanged'

    existing.title = spec.title
    existing.type = spec.type
    existing.sourceFiles = spec.sourceFiles
    existing.stale = false
    existing.updated = now
    existing.body = mergedBody
    existing.headings = extractHeadings(mergedBody)
    existing.rawTargets = extractWikilinks(mergedBody)
    await this.persist(existing)
    this.rebuild()
    this.announceDoc(existing)
    this.emitChanged()
    return 'updated'
  }

  /**
   * Flip `stale` on every page whose source_files intersect `changedRepoFiles`.
   * A source_files entry ending in '/' matches by directory prefix.
   * Returns the affected page ids. Called by the repo watcher and by
   * generate.ts's markStale().
   */
  async markStaleBySourceFiles(changedRepoFiles: string[]): Promise<string[]> {
    if (changedRepoFiles.length === 0) return []
    const hit: PageRecord[] = []
    for (const rec of this.records.values()) {
      if (rec.stale) continue
      const match = rec.sourceFiles.some((sf) =>
        changedRepoFiles.some((c) => (sf.endsWith('/') ? c.startsWith(sf) : c === sf))
      )
      if (match) hit.push(rec)
    }
    for (const rec of hit) {
      rec.stale = true
      await this.persist(rec)
    }
    if (hit.length > 0) this.emitChanged()
    return hit.map((r) => r.id)
  }

  async setStale(pageId: string, stale: boolean): Promise<void> {
    const rec = this.records.get(pageId)
    if (!rec) throw new Error(`no page ${pageId}`)
    if (rec.stale === stale) return
    rec.stale = stale
    await this.persist(rec)
    this.emitChanged()
  }

  // ── internals ─────────────────────────────────────────────────────

  private fmOf(rec: PageRecord): PageFrontmatter {
    return {
      id: rec.id,
      title: rec.title,
      type: rec.type,
      created: rec.created,
      updated: rec.updated,
      stale: rec.stale,
      sourceFiles: rec.sourceFiles
    }
  }

  /** Serialize + atomic write, flagged on the watcher so the echo is ignored. */
  private async persist(rec: PageRecord): Promise<void> {
    this.watcher?.noteSelfWrite(rec.path)
    await writePage(this.dir, rec.path, this.fmOf(rec), rec.body)
  }

  private announceDoc(rec: PageRecord): void {
    indexDoc({
      projectId: this.projectId,
      pageId: rec.id,
      path: rec.path,
      title: rec.title,
      body: rec.body
    })
  }

  private emitChanged(): void {
    const evt: WikiChangedEvent = { projectId: this.projectId, pages: this.list() }
    this.emit('changed', evt)
  }
}

// ── registry ────────────────────────────────────────────────────────

const indexes = new Map<string, WikiIndex>()

/**
 * Get or create the wiki for a project: vault under
 * ~/.terrarium/vaults/<slugified-name>, seeded for the demo project, watched for
 * vault edits and repo source changes.
 */
export async function initWiki(
  project: Pick<Project, 'id' | 'name' | 'rootPath'>
): Promise<WikiIndex> {
  const existing = indexes.get(project.id)
  if (existing) return existing
  const idx = new WikiIndex(project.id, { slug: slugify(project.name) })
  indexes.set(project.id, idx)
  try {
    await idx.init()
  } catch (err) {
    indexes.delete(project.id)
    throw err
  }
  if (project.rootPath) idx.watchSources(project.rootPath)
  return idx
}

export function getWiki(projectId: string): WikiIndex | undefined {
  return indexes.get(projectId)
}

export async function closeWiki(projectId: string): Promise<void> {
  const idx = indexes.get(projectId)
  if (!idx) return
  indexes.delete(projectId)
  await idx.close()
}

export async function closeAllWikis(): Promise<void> {
  const all = [...indexes.values()]
  indexes.clear()
  await Promise.all(all.map((i) => i.close()))
}
