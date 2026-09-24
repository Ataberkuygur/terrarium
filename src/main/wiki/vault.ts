/**
 * vault.ts — on-disk wiki vaults.
 *
 * Each project gets a plain folder of .md files at
 *   %USERPROFILE%\.terrarium\vaults\<project-slug>\
 * which is a valid Obsidian vault: index.md is home, filenames are kebab-case,
 * every page carries YAML frontmatter, and links are [[wikilinks]].
 *
 * All writes are atomic (write .tmp sibling + rename) and normalized to LF.
 * On first run for the demo project (slug 'terrarium') the DEMO_WIKI pages from
 * the renderer seed are materialized verbatim as real files.
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultHome } from '../engine/paths'
import { serializePage, toLF, type PageFrontmatter } from './frontmatter'
import type { WikiPageMeta } from '../../shared/types'

// ── paths ───────────────────────────────────────────────────────────

export function vaultsRoot(): string {
  return join(defaultHome(), 'vaults')
}

/** project name → vault folder name: lowercase, kebab, filesystem-safe. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'project'
}

/** page title → kebab-case filename stem. */
export function kebab(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'page'
}

export function vaultDirForSlug(slug: string): string {
  return join(vaultsRoot(), slug)
}

/** vault-relative posix path → absolute path. */
export function absPath(dir: string, rel: string): string {
  return join(dir, ...rel.split('/'))
}

/** absolute path → vault-relative posix path, or null when outside. */
export function relPath(dir: string, abs: string): string | null {
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const d = norm(dir)
  const a = norm(abs)
  if (a === d) return ''
  if (!a.startsWith(d + '/')) return null
  return a.slice(d.length + 1)
}

// ── listing / io ────────────────────────────────────────────────────

const SKIP_LIST_DIRS = new Set(['.obsidian', 'assets', '.trash'])

/** Recursively list .md files under dir as posix-style relative paths, sorted. */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(sub: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(sub ? absPath(dir, sub) : dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = sub ? `${sub}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || SKIP_LIST_DIRS.has(e.name)) continue
        await walk(rel)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(rel)
      }
    }
  }
  await walk('')
  return out.sort()
}

export async function readPageFile(dir: string, rel: string): Promise<string> {
  return fs.readFile(absPath(dir, rel), 'utf8')
}

export async function fileExists(dir: string, rel: string): Promise<boolean> {
  try {
    await fs.stat(absPath(dir, rel))
    return true
  } catch {
    return false
  }
}

/**
 * Atomic write: serialize to a unique .tmp sibling then rename over the target.
 * Content is normalized to LF and guaranteed a trailing newline.
 */
export async function writePageFileAtomic(
  dir: string,
  rel: string,
  content: string
): Promise<void> {
  const abs = absPath(dir, rel)
  await fs.mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const text = toLF(content)
  await fs.writeFile(tmp, text.endsWith('\n') ? text : text + '\n', 'utf8')
  await fs.rename(tmp, abs)
}

export async function writePage(
  dir: string,
  rel: string,
  fm: PageFrontmatter,
  body: string
): Promise<void> {
  await writePageFileAtomic(dir, rel, serializePage(fm, body))
}

export async function deletePageFile(dir: string, rel: string): Promise<void> {
  await fs.rm(absPath(dir, rel), { force: true })
}

export async function renamePageFile(dir: string, fromRel: string, toRel: string): Promise<void> {
  const to = absPath(dir, toRel)
  await fs.mkdir(dirname(to), { recursive: true })
  await fs.rename(absPath(dir, fromRel), to)
}

// ── ensure + demo seed ──────────────────────────────────────────────

export const HOME_PAGE_PATH = 'index.md'
export const DEMO_SLUG = 'terrarium'

interface SeedPage {
  id: string
  title: string
  path: string
  type: WikiPageMeta['type']
  stale: boolean
  /** ms before "now" used for created/updated so the seeded vault looks lived-in */
  updatedAgo: number
  body: string
}

/**
 * Verbatim copy of DEMO_WIKI bodies from src/renderer/src/lib/seed.ts —
 * the renderer seed is type-only territory and must not be imported into main,
 * so the strings are duplicated here. Keep in sync when the seed changes.
 */
const DEMO_PAGES: SeedPage[] = [
  {
    id: 'wp-home',
    title: 'Terrarium — Project Home',
    path: 'index.md',
    type: 'overview',
    stale: false,
    updatedAgo: 3_600_000,
    body: `# Terrarium

A desktop office for your AI crew. Agents work in isolated git worktrees, you supervise from a calm board — and the app teaches you the project as it grows.

## Where to go next

- [[wp-arch|Architecture overview]] — how the pieces fit
- [[wp-office|The Office]] — the 3D crew view and what it means
- [[wp-orch|Orchestration]] — tasks, runs, worktrees, review
- [[wp-glossary|Glossary]] — the words we use

## Stack at a glance

| Layer | Choice |
|---|---|
| Shell | Electron 44 (Node 24) |
| UI | React 19, Tailwind 4 |
| 3D office | React Three Fiber |
| DB | node:sqlite (FTS5) |
| Terminals | node-pty + xterm.js |
`
  },
  {
    id: 'wp-arch',
    title: 'Architecture overview',
    path: 'architecture.md',
    type: 'architecture',
    stale: false,
    updatedAgo: 7_200_000,
    body: `# Architecture

Three Electron processes, one direction of trust.

\`\`\`mermaid
graph LR
  R[Renderer<br/>React UI] -->|IPC| M[Main<br/>DB · windows · files]
  M -->|fork| P[pty-host<br/>node-pty sessions]
\`\`\`

- **Renderer** — sandboxed React. No Node, no fs. Talks to a typed \`window.terrarium\` bridge.
- **Main** — owns SQLite, the wiki watcher, git operations, window state.
- **pty-host** — a \`utilityProcess\` that owns every agent terminal. If it dies, the UI lives; if the UI reloads, sessions live.

See [[wp-pty|The PTY host]] for the flow-control protocol.
`
  },
  {
    id: 'wp-office',
    title: 'The Office',
    path: 'office.md',
    type: 'module',
    stale: true,
    updatedAgo: 20_000_000,
    body: `# The Office

A daylight loft. Every desk is an agent; desks cluster into **category zones** — frontend, backend, design, research, marketing, legal, general — each with its own props and accent.

| Agent state | What you see |
|---|---|
| working | typing at their desk, lamp on, monitor live |
| waiting | standing, amber beacon — needs you |
| done | beacon settles, card lands on the board |
| idle | reading at the couch, lamp dim |
| sleeping | idle >90s — slumped at the desk, "z z z", monitor off |

Click an agent: the camera glides to their desk and a **focus dock** slides up — chat or a live terminal without leaving the office. Any terminal output wakes a sleeper.

The scene is deterministic: state in, pixels out. No network, no assets fetched at runtime.
`
  },
  {
    id: 'wp-orch',
    title: 'Orchestration',
    path: 'orchestration.md',
    type: 'module',
    stale: false,
    updatedAgo: 10_000_000,
    body: `# Orchestration

Simple on purpose. One task = one card = one worktree = one run.

## The loop

1. **Assign** — drag a card to an agent, or let the lead split it.
2. **Isolate** — the run gets a fresh worktree on \`agent/<slug>\`.
3. **Watch** — the office shows who works; the inbox shows who waits.
4. **Review** — the diff opens in place; comments return to the agent.
5. **Merge** — checks green → merge → worktree recycled.

States: \`working · waiting · done\`. Everything else is detail.
`
  },
  {
    id: 'wp-pty',
    title: 'The PTY host',
    path: 'pty-host.md',
    type: 'module',
    stale: false,
    updatedAgo: 15_000_000,
    body: `# The PTY host

A dedicated \`utilityProcess\` owns every terminal session (the VS Code pattern).

- Output is batched (~16KB) and acknowledged — a loud agent can't freeze the office.
- Scrollback lives in a headless xterm server-side; the renderer replays on attach.
- Sessions survive a renderer reload. That's the whole point.
`
  },
  {
    id: 'wp-glossary',
    title: 'Glossary',
    path: 'glossary.md',
    type: 'glossary',
    stale: false,
    updatedAgo: 30_000_000,
    body: `# Glossary

**Card** — a unit of work on the board.

**Run** — one execution of a card by one agent in one worktree.

**Crew** — the named agents on your roster.

**Wiki** — the living documentation inside each project.
`
  }
]

/** Materialize the DEMO_WIKI seed pages into `dir`. Caller decides when (empty vault + demo slug). */
export async function seedDemoVault(dir: string): Promise<void> {
  const now = Date.now()
  for (const p of DEMO_PAGES) {
    const fm: PageFrontmatter = {
      id: p.id,
      title: p.title,
      type: p.type,
      created: now - p.updatedAgo,
      updated: now - p.updatedAgo,
      stale: p.stale,
      sourceFiles: []
    }
    await writePage(dir, p.path, fm, p.body)
  }
}

/**
 * Create the vault dir if needed. When it contains no .md files at all and the
 * slug is the demo project's, materialize the seed pages. Returns the dir and
 * whether seeding happened.
 */
export async function ensureVault(slug: string): Promise<{ dir: string; seeded: boolean }> {
  const dir = vaultDirForSlug(slug)
  await fs.mkdir(dir, { recursive: true })
  const existing = await listMarkdownFiles(dir)
  if (existing.length > 0 || slug !== DEMO_SLUG) return { dir, seeded: false }
  await seedDemoVault(dir)
  return { dir, seeded: true }
}
