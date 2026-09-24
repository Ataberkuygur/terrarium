/**
 * generate.ts — structural (deterministic, no LLM) wiki pages from a repo tree.
 *
 * Produces:
 *   modules/<dir>.md   one page per top-level directory: file table + [[links]]
 *                      to sibling modules
 *   repo-map.md        extension census, entry points, package.json facts
 *   how-to-run.md      script table from package.json
 *   glossary.md        stub, only created when absent
 *   index.md           home page, only created when absent
 *
 * Generated content lives inside <!-- AUTOGEN:name --> … <!-- /AUTOGEN -->
 * markers; WikiIndex.upsertGenerated splices blocks into existing pages so
 * human prose survives regeneration. Every generated page records the repo
 * files it depends on in frontmatter source_files — when one of those changes
 * on disk (repo watcher → markStale), the page flips stale.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AUTOGEN_CLOSE, autogenOpen } from './frontmatter'
import { kebab } from './vault'
import type { WikiIndex } from './index'

// ── repo scan ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  'target',
  'bin',
  'obj',
  '__pycache__'
])
const FILE_CAP = 4000
const MAX_ROWS = 200

/** Walk the repo; returns repo-relative posix file paths (≤ 4000), sorted. */
export async function scanRepo(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(sub: string): Promise<void> {
    if (out.length >= FILE_CAP) return
    let entries
    try {
      entries = await fs.readdir(sub ? join(root, ...sub.split('/')) : root, {
        withFileTypes: true
      })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= FILE_CAP) return
      const rel = sub ? `${sub}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
        await walk(rel)
      } else if (e.isFile()) {
        out.push(rel)
      }
    }
  }
  await walk('')
  return out.sort()
}

interface PkgJson {
  name?: string
  version?: string
  description?: string
  main?: string
  module?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

async function readPkg(root: string): Promise<PkgJson | null> {
  try {
    return JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')) as PkgJson
  } catch {
    return null
  }
}

// ── small render helpers ────────────────────────────────────────────

const block = (name: string, inner: string) =>
  `${autogenOpen(name)}\n${inner}\n${AUTOGEN_CLOSE}`

const wlink = (id: string, label: string) => `[[${id}|${label}]]`

function topDirOf(rel: string): string | null {
  const i = rel.indexOf('/')
  return i === -1 ? null : rel.slice(0, i)
}

const ENTRY_STEMS = new Set(['index', 'main', 'app', 'cli', 'server', 'mod'])
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

function extOf(rel: string): string {
  const base = rel.split('/').pop() ?? rel
  const i = base.lastIndexOf('.')
  return i <= 0 ? '(none)' : base.slice(i).toLowerCase()
}

/** Likely entry points: package.json main/module + shallow index/main/app files. */
function detectEntryPoints(files: string[], pkg: PkgJson | null): string[] {
  const out = new Set<string>()
  if (pkg?.main) out.add(pkg.main)
  if (pkg?.module) out.add(pkg.module)
  for (const f of files) {
    const segs = f.split('/')
    if (segs.length > 3) continue // entry points live near the root
    const base = segs[segs.length - 1]
    const dot = base.lastIndexOf('.')
    if (dot <= 0) continue
    const stem = base.slice(0, dot).toLowerCase()
    const ext = base.slice(dot).toLowerCase()
    if (ENTRY_STEMS.has(stem) && CODE_EXTS.has(ext)) out.add(f)
    if (base === 'index.html' && segs.length <= 2) out.add(f)
  }
  return [...out].sort()
}

// ── generation ──────────────────────────────────────────────────────

export interface GenerateResult {
  created: string[]
  updated: string[]
  unchanged: string[]
  filesScanned: number
  truncated: boolean
}

/**
 * (Re)generate the structural page set for `repoPath` into `index`'s vault.
 * Deterministic — same repo state, same output.
 */
export async function generateStructuralPages(
  index: WikiIndex,
  repoPath: string
): Promise<GenerateResult> {
  const files = await scanRepo(repoPath)
  const pkg = await readPkg(repoPath)
  const truncated = files.length >= FILE_CAP

  const result: GenerateResult = {
    created: [],
    updated: [],
    unchanged: [],
    filesScanned: files.length,
    truncated
  }
  const report = (r: 'created' | 'updated' | 'unchanged', id: string) => result[r].push(id)

  // group files by top-level directory
  const dirs = new Map<string, string[]>()
  const rootFiles: string[] = []
  for (const f of files) {
    const d = topDirOf(f)
    if (d === null) rootFiles.push(f)
    else {
      let list = dirs.get(d)
      if (!list) dirs.set(d, (list = []))
      list.push(f)
    }
  }
  const dirNames = [...dirs.keys()].sort()
  const modId = (d: string) => `wp-mod-${kebab(d)}`

  // ── module pages ──
  for (const d of dirNames) {
    const list = dirs.get(d)!
    const siblings = dirNames.filter((x) => x !== d)
    const rows = list.slice(0, MAX_ROWS).map((f) => `| \`${f.slice(d.length + 1)}\` |`)
    if (list.length > MAX_ROWS) rows.push(`| _…and ${list.length - MAX_ROWS} more_ |`)

    const filesBlock = block(
      'files',
      [`| File |`, `|---|---|`, ...rows].join('\n')
    )
    const sibBlock = block(
      'siblings',
      siblings.length
        ? siblings.map((s) => `- ${wlink(modId(s), `${s}/`)} — ${dirs.get(s)!.length} files`).join('\n')
        : '_No other top-level modules._'
    )
    const body = `# ${d}/

_${list.length} file${list.length === 1 ? '' : 's'} under \`${d}/\`._

${filesBlock}

## Sibling modules

${sibBlock}
`
    report(
      await index.upsertGenerated({
        id: modId(d),
        path: `modules/${kebab(d)}.md`,
        title: `${d}/`,
        type: 'module',
        sourceFiles: [`${d}/`], // trailing slash = dir prefix match for staleness
        body
      }),
      modId(d)
    )
  }

  // ── repo map ──
  const extCounts = new Map<string, number>()
  for (const f of files) {
    const e = extOf(f)
    extCounts.set(e, (extCounts.get(e) ?? 0) + 1)
  }
  const extRows = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([e, n]) => `| \`${e}\` | ${n} |`)
  const entries = detectEntryPoints(files, pkg)
  const dirRows = dirNames.map(
    (d) => `| ${wlink(modId(d), `${d}/`)} | ${dirs.get(d)!.length} |`
  )
  const mapInner = [
    `_${files.length} files${truncated ? ` (capped at ${FILE_CAP})` : ''} across ${dirNames.length} top-level director${dirNames.length === 1 ? 'y' : 'ies'}._`,
    '',
    '### Top-level modules',
    '',
    '| Module | Files |',
    '|---|---|',
    ...dirRows,
    ...(rootFiles.length ? [`| _(root files)_ | ${rootFiles.length} |`] : []),
    '',
    '### Languages (by extension)',
    '',
    '| Ext | Files |',
    '|---|---|',
    ...extRows,
    '',
    '### Entry points',
    '',
    ...(entries.length ? entries.map((e) => `- \`${e}\``) : ['_None detected._'])
  ].join('\n')
  const mapSources = ['package.json', ...entries.slice(0, 10)]
  report(
    await index.upsertGenerated({
      id: 'wp-repo-map',
      path: 'repo-map.md',
      title: 'Repository map',
      type: 'architecture',
      sourceFiles: mapSources,
      body: `# Repository map

A structural census of the codebase — regenerated, never hand-edited inside the markers.

${block('map', mapInner)}
`
    }),
    'wp-repo-map'
  )

  // ── how to run ──
  const scripts = Object.entries(pkg?.scripts ?? {})
  const scriptsInner = scripts.length
    ? [
        '| Command | Runs |',
        '|---|---|',
        ...scripts.map(([k, v]) => `| \`pnpm ${k}\` | \`${v.replace(/\|/g, '\\|')}\` |`)
      ].join('\n')
    : '_No package.json scripts found._'
  const runSources = ['package.json']
  report(
    await index.upsertGenerated({
      id: 'wp-how-to-run',
      path: 'how-to-run.md',
      title: 'How to run',
      type: 'howto',
      sourceFiles: runSources,
      body: `# How to run

${block('scripts', scriptsInner)}

${block('setup', ['```bash', 'pnpm install', 'pnpm dev', '```'].join('\n'))}
`
    }),
    'wp-how-to-run'
  )

  // ── glossary stub (create-if-missing only) ──
  if (!index.has('wp-glossary') && !index.has('glossary.md')) {
    report(
      await index.upsertGenerated({
        id: 'wp-glossary',
        path: 'glossary.md',
        title: 'Glossary',
        type: 'glossary',
        sourceFiles: [],
        body: `# Glossary

Terms worth knowing in this codebase. Hand-written — generators only seed the stub.

${block('terms', `**Module** — a top-level directory with its own wiki page.\n\n**Stale** — a page whose source files changed since it was generated.`)}
`
      }),
      'wp-glossary'
    )
  }

  // ── home (create-if-missing only) ──
  if (!index.has('index.md')) {
    const homeLinks = [
      `- ${wlink('wp-repo-map', 'Repository map')} — the structural census`,
      `- ${wlink('wp-how-to-run', 'How to run')} — scripts and setup`,
      `- ${wlink('wp-glossary', 'Glossary')} — the words we use`
    ]
    report(
      await index.upsertGenerated({
        id: 'wp-home',
        path: 'index.md',
        title: `${pkg?.name ?? 'Project'} — Home`,
        type: 'overview',
        sourceFiles: [],
        body: `# ${pkg?.name ?? 'Project'}

${homeLinks.join('\n')}
`
      }),
      'wp-home'
    )
  }

  return result
}

/**
 * Mark every page whose source_files intersect `files` as stale.
 * Thin wrapper over WikiIndex.markStaleBySourceFiles — the repo watcher's
 * debounced batch lands here. Returns affected page ids.
 */
export async function markStale(index: WikiIndex, files: string[]): Promise<string[]> {
  return index.markStaleBySourceFiles(files)
}
