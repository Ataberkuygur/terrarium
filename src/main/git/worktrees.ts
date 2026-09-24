// ── worktrees.ts — lifecycle manager for agent worktrees ─────────────
// Managed root: %USERPROFILE%\.terrarium\worktrees\<project-slug>\<task-slug>
// Short paths on purpose: Windows MAX_PATH is 260 chars without longpaths.
// We NEVER create junctions/symlinks and NEVER fs-delete outside the root.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitError, currentSha, fetch as gitFetch, isRepo, run } from './git'
import { defaultHome } from '../engine/paths'
import type { GitResult } from './git'

// ── types ─────────────────────────────────────────────────────────────

export interface CreateWorktreeOptions {
  /** absolute path of the user's checkout (the "main" worktree) */
  projectPath: string
  projectSlug: string
  taskSlug: string
  /** base branch, e.g. 'main' — resolved as origin/<base>, else local, else HEAD */
  base: string
  /** optional human title baked into .terrarium/context.md */
  taskTitle?: string
  /** override body for .terrarium/context.md */
  context?: string
}

export interface CreateWorktreeResult {
  path: string
  branch: string
  baseSha: string
  warnings: string[]
}

export interface WorktreeInfo {
  path: string
  head: string
  /** short branch name; null when detached */
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
  prunableReason: string | null
}

export type WorktreeState = 'active' | 'orphaned' | 'stranded' | 'foreign' | 'dirty'

export interface RegistryEntry {
  path: string
  taskSlug?: string
  branch?: string
}

export interface ReconciledWorktree {
  path: string
  state: WorktreeState
  /** git `worktree list` knows it */
  inGit: boolean
  /** directory exists on disk */
  onDisk: boolean
  /** present in the caller-provided registry */
  inRegistry: boolean
  /** inside %USERPROFILE%\.terrarium\worktrees */
  managed: boolean
  head: string | null
  branch: string | null
  locked: boolean
  /** count of uncommitted paths when state === 'dirty' */
  dirtyFiles: number
}

export interface RemoveResult {
  ok: boolean
  path: string
  stage: 'guard' | 'lock-check' | 'git-remove' | 'fs-remove' | 'prune' | 'done'
  /** populated when removal was refused because the worktree is locked */
  lockedReason?: string
  gitRemoved: boolean
  fsRemoved: boolean
  pruned: boolean
  error?: string
  warnings: string[]
}

export interface LockResult {
  ok: boolean
  error?: string
}

// ── paths & slugs ─────────────────────────────────────────────────────

export function worktreesRoot(): string {
  return path.join(defaultHome(), 'worktrees')
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** lowercase, filesystem-safe, ≤48 chars — keeps us far under MAX_PATH. */
export function slugify(input: string): string {
  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
  if (!slug) slug = 'task'
  if (RESERVED_NAMES.test(slug)) slug = `w-${slug}`
  return slug
}

export function worktreePathFor(projectSlug: string, taskSlug: string): string {
  return path.join(worktreesRoot(), slugify(projectSlug), slugify(taskSlug))
}

function norm(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

function isUnderRoot(p: string): boolean {
  return norm(p).startsWith(norm(worktreesRoot()) + '/')
}

function assertDeletable(p: string): void {
  if (!isUnderRoot(p)) {
    throw new Error(`refusing to delete outside managed worktrees root: ${p}`)
  }
}

// ── gitdir resolution ─────────────────────────────────────────────────

/**
 * Resolve the *common* git dir for a worktree. Linked worktrees have a `.git`
 * FILE ("gitdir: <repo>/.git/worktrees/<id>") plus a `commondir` pointer back
 * to the shared `.git`. Returns null when the layout is unreadable.
 */
async function resolveCommonGitDir(worktreePath: string): Promise<string | null> {
  const dotgit = path.join(worktreePath, '.git')
  const st = await fs.stat(dotgit).catch(() => null)
  if (!st) return null
  if (st.isDirectory()) return dotgit
  const text = await fs.readFile(dotgit, 'utf8').catch(() => '')
  const m = /^gitdir:\s*(.+)$/m.exec(text)
  if (!m) return null
  const gitdir = path.resolve(worktreePath, m[1].trim())
  const common = await fs.readFile(path.join(gitdir, 'commondir'), 'utf8').catch(() => null)
  if (common && common.trim()) return path.resolve(gitdir, common.trim())
  return path.resolve(gitdir, '..', '..') // <git>/.git/worktrees/<id> → <git>/.git
}

interface RepoCtx {
  /** args prefix: ['--git-dir', dir] or ['-C', repo] */
  args: string[]
  /** a cwd guaranteed to exist for spawn */
  cwd: string
}

/** git context for ops on a worktree — works even if its dir is half-gone. */
async function repoCtxFor(wtPath: string, projectPath?: string): Promise<RepoCtx | null> {
  const common = await resolveCommonGitDir(wtPath).catch(() => null)
  if (common) return { args: ['--git-dir', common], cwd: os.homedir() }
  if (projectPath && (await isRepo(projectPath))) {
    return { args: ['-C', projectPath], cwd: projectPath }
  }
  return null
}

// ── porcelain parsing ─────────────────────────────────────────────────

function parsePorcelain(stdout: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = []
  let cur: WorktreeInfo | null = null
  const push = (): void => {
    if (cur) out.push(cur)
    cur = null
  }
  for (const line of stdout.split(/\r?\n/)) {
    if (line === '') {
      push()
      continue
    }
    if (line.startsWith('worktree ')) {
      push()
      cur = {
        path: line.slice('worktree '.length).trim(),
        head: '',
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null
      }
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim()
    else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '')
    } else if (line === 'bare') cur.bare = true
    else if (line === 'detached') cur.detached = true
    else if (line === 'locked') cur.locked = true
    else if (line.startsWith('locked ')) {
      cur.locked = true
      cur.lockReason = line.slice(7).trim() || null
    } else if (line === 'prunable') cur.prunable = true
    else if (line.startsWith('prunable ')) {
      cur.prunable = true
      cur.prunableReason = line.slice(9).trim() || null
    }
  }
  push()
  return out
}

export async function list(projectPath: string): Promise<WorktreeInfo[]> {
  const r = await run(['-C', projectPath, 'worktree', 'list', '--porcelain'], projectPath)
  if (r.code !== 0) throw new GitError(['-C', projectPath, 'worktree', 'list', '--porcelain'], r)
  return parsePorcelain(r.stdout)
}

// ── create ────────────────────────────────────────────────────────────

async function isUnborn(repoPath: string): Promise<boolean> {
  const r = await run(['-C', repoPath, 'rev-parse', '--verify', 'HEAD'], repoPath)
  return r.code !== 0
}

/**
 * Create an empty initial commit on an unborn HEAD via plumbing — does not
 * touch the user's index, staging area, or git config (identity via -c).
 */
async function createInitialCommit(repoPath: string): Promise<void> {
  const ident = ['-c', 'user.name=Terrarium', '-c', 'user.email=terrarium@localhost']
  const tree = await run(['-C', repoPath, 'mktree'], repoPath, { input: '' })
  if (tree.code !== 0) throw new GitError(['-C', repoPath, 'mktree'], tree)
  const commit = await run(
    ['-C', repoPath, ...ident, 'commit-tree', tree.stdout.trim(), '-m', 'chore: initial commit (terrarium)'],
    repoPath
  )
  if (commit.code !== 0) throw new GitError(['-C', repoPath, 'commit-tree'], commit)
  const upd = await run(
    ['-C', repoPath, ...ident, 'update-ref', 'HEAD', commit.stdout.trim()],
    repoPath
  )
  if (upd.code !== 0) throw new GitError(['-C', repoPath, 'update-ref'], upd)
}

/** Copy paths listed in <repo>/.worktreeinclude into the fresh worktree. */
async function copyWorktreeIncludes(
  projectPath: string,
  wtPath: string,
  warnings: string[]
): Promise<void> {
  const incFile = path.join(projectPath, '.worktreeinclude')
  const raw = await fs.readFile(incFile, 'utf8').catch(() => null)
  if (raw === null) return
  for (const lineRaw of raw.split(/\r?\n/)) {
    const rel = lineRaw.trim()
    if (!rel || rel.startsWith('#')) continue
    const src = path.resolve(projectPath, rel)
    if (!norm(src).startsWith(norm(projectPath) + '/') && norm(src) !== norm(projectPath)) {
      warnings.push(`.worktreeinclude: skipping path escaping repo: ${rel}`)
      continue
    }
    const st = await fs.stat(src).catch(() => null)
    if (!st) {
      warnings.push(`.worktreeinclude: not found, skipped: ${rel}`)
      continue
    }
    const dest = path.join(wtPath, rel)
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.cp(src, dest, { recursive: true })
    } catch (err) {
      warnings.push(`.worktreeinclude: copy failed for ${rel}: ${String(err)}`)
    }
  }
}

/** Append `/.terrarium/` to the shared info/exclude so context.md stays untracked. */
async function excludeTerrariumDir(commonGitDir: string): Promise<void> {
  const infoDir = path.join(commonGitDir, 'info')
  await fs.mkdir(infoDir, { recursive: true })
  const excl = path.join(infoDir, 'exclude')
  const cur = await fs.readFile(excl, 'utf8').catch(() => '')
  if (cur.split(/\r?\n/).some((l) => l.trim() === '/.terrarium/')) return
  await fs.appendFile(excl, `${cur.endsWith('\n') || cur === '' ? '' : '\n'}# terrarium\n/.terrarium/\n`)
}

function defaultContext(o: {
  projectPath: string
  taskSlug: string
  taskTitle?: string
  branch: string
  base: string
  baseSha: string
}): string {
  return [
    '# Terrarium agent context',
    '',
    `- task: \`${o.taskSlug}\`${o.taskTitle ? ` — ${o.taskTitle}` : ''}`,
    `- branch: \`${o.branch}\``,
    `- base: \`${o.base}\` @ \`${o.baseSha.slice(0, 12)}\``,
    `- project checkout: ${o.projectPath}`,
    `- created: ${new Date().toISOString()}`,
    '',
    'This is an Terrarium-managed worktree. Commit work on this branch; do not',
    'switch branches or delete this directory manually.'
  ].join('\n')
}

/**
 * create: fetch origin → worktree add -b agent/<taskSlug> → copy
 * .worktreeinclude files → write gitignored .terrarium/context.md.
 * Bootstraps an initial commit first when the repo has an unborn HEAD.
 */
export async function create(opts: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
  const { projectPath, base } = opts
  const warnings: string[] = []
  if (!(await isRepo(projectPath))) {
    throw new Error(`not a git repository: ${projectPath}`)
  }
  const projectSlug = slugify(opts.projectSlug)
  const taskSlug = slugify(opts.taskSlug)
  const branch = `agent/${taskSlug}`
  const wtPath = worktreePathFor(projectSlug, taskSlug)

  if (await isUnborn(projectPath)) {
    await createInitialCommit(projectPath)
    warnings.push('repo had no commits — created an empty initial commit')
  }

  const f = await gitFetch(projectPath)
  if (f.code !== 0) {
    warnings.push(`fetch origin failed (code ${f.code}): ${f.stderr.trim().slice(0, 300)}`)
  }

  // resolve start point: origin/<base> → local <base> → HEAD (empty-repo case)
  let startPoint: string | null = null
  let baseSha: string | null = null
  for (const c of [`origin/${base}`, `refs/heads/${base}`, 'HEAD']) {
    const r = await run(
      ['-C', projectPath, 'rev-parse', '--verify', `${c}^{commit}`],
      projectPath
    )
    if (r.code === 0) {
      startPoint = c
      baseSha = r.stdout.trim()
      break
    }
  }
  if (!startPoint || !baseSha) {
    throw new Error(`cannot resolve base '${base}' (tried origin/${base}, ${base}, HEAD)`)
  }

  const existing = await fs.stat(wtPath).catch(() => null)
  if (existing) {
    throw new Error(`worktree path already exists: ${wtPath} — call remove() first`)
  }
  await fs.mkdir(path.dirname(wtPath), { recursive: true })

  const add = await run(
    ['-C', projectPath, 'worktree', 'add', '-b', branch, wtPath, startPoint],
    projectPath,
    { timeoutMs: 60_000 }
  )
  if (add.code !== 0) {
    throw new GitError(['-C', projectPath, 'worktree', 'add', '-b', branch, wtPath, startPoint], add)
  }

  try {
    await copyWorktreeIncludes(projectPath, wtPath, warnings)
  } catch (err) {
    warnings.push(`.worktreeinclude copy failed: ${String(err)}`)
  }

  try {
    const ctxDir = path.join(wtPath, '.terrarium')
    await fs.mkdir(ctxDir, { recursive: true })
    await fs.writeFile(
      path.join(ctxDir, 'context.md'),
      opts.context ??
        defaultContext({
          projectPath,
          taskSlug,
          taskTitle: opts.taskTitle,
          branch,
          base,
          baseSha
        }),
      'utf8'
    )
    const common = await resolveCommonGitDir(wtPath)
    if (common) await excludeTerrariumDir(common)
    else warnings.push('could not resolve common git dir — .terrarium not added to info/exclude')
  } catch (err) {
    warnings.push(`context.md/exclude write failed: ${String(err)}`)
  }

  return { path: wtPath, branch, baseSha, warnings }
}

// ── reconcile ─────────────────────────────────────────────────────────

async function scanManagedDirs(): Promise<string[]> {
  const root = worktreesRoot()
  const out: string[] = []
  const projects = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const p of projects) {
    if (!p.isDirectory()) continue
    const subs = await fs
      .readdir(path.join(root, p.name), { withFileTypes: true })
      .catch(() => [] as import('node:fs').Dirent[])
    for (const s of subs) {
      if (s.isDirectory()) out.push(path.join(root, p.name, s.name))
    }
  }
  return out
}

async function dirtyCount(wtPath: string): Promise<number> {
  const r = await run(['-C', wtPath, 'status', '--porcelain'], wtPath, { timeoutMs: 15_000 })
  if (r.code !== 0 || !r.stdout.trim()) return 0
  return r.stdout.split(/\r?\n/).filter((l) => l.trim()).length
}

/**
 * Cross-check `git worktree list --porcelain` against the filesystem and a
 * caller-provided registry. States:
 *   active    git + fs agree, inside managed root, clean
 *   dirty     active but `status --porcelain` is non-empty
 *   stranded  a registration (git metadata or registry row) whose dir is gone
 *   orphaned  a directory/record under the managed root git no longer tracks
 *   foreign   git-listed worktree outside the managed root — never touched
 */
export async function reconcile(
  projectPath: string,
  registry: Array<RegistryEntry | string> = []
): Promise<ReconciledWorktree[]> {
  const map = new Map<string, ReconciledWorktree>()
  const get = (p: string): ReconciledWorktree => {
    const key = norm(p)
    let e = map.get(key)
    if (!e) {
      e = {
        path: p,
        state: 'foreign',
        inGit: false,
        onDisk: false,
        inRegistry: false,
        managed: isUnderRoot(p),
        head: null,
        branch: null,
        locked: false,
        dirtyFiles: 0
      }
      map.set(key, e)
    }
    return e
  }

  const porcelain = await list(projectPath).catch(() => [] as WorktreeInfo[])
  for (const w of porcelain) {
    const e = get(w.path)
    e.inGit = true
    e.head = w.head || null
    e.branch = w.branch
    e.locked = w.locked
    e.onDisk = (await fs.stat(w.path).catch(() => null)) !== null
  }

  // repo's own git dir, to attribute orphaned dirs to *this* project only
  const gd = await run(['-C', projectPath, 'rev-parse', '--absolute-git-dir'], projectPath)
  const repoGitDir = gd.code === 0 ? norm(gd.stdout.trim()) : null

  for (const dir of await scanManagedDirs()) {
    const common = await resolveCommonGitDir(dir)
    if (repoGitDir && common && norm(common) !== repoGitDir) continue // other project's
    const e = get(dir)
    e.onDisk = true
    e.managed = true
  }

  for (const entry of registry) {
    const p = typeof entry === 'string' ? entry : entry.path
    if (!p) continue
    const e = get(p)
    e.inRegistry = true
    if (e.managed && !e.onDisk) {
      e.onDisk = (await fs.stat(p).catch(() => null)) !== null
    }
  }

  for (const e of map.values()) {
    if (e.inGit && e.onDisk && !e.managed) {
      e.state = 'foreign'
    } else if (e.inGit && !e.onDisk) {
      e.state = 'stranded'
    } else if (!e.inGit && !e.onDisk) {
      e.state = 'stranded' // dangling registry row
    } else if (!e.inGit && e.onDisk) {
      e.state = 'orphaned'
    } else {
      // inGit && onDisk && managed — the only case we inspect for dirt
      e.dirtyFiles = await dirtyCount(e.path)
      e.state = e.dirtyFiles > 0 ? 'dirty' : 'active'
    }
  }
  return [...map.values()]
}

// ── remove / lock / unlock ────────────────────────────────────────────

async function listViaCtx(ctx: RepoCtx): Promise<WorktreeInfo[]> {
  const r = await run([...ctx.args, 'worktree', 'list', '--porcelain'], ctx.cwd)
  return r.code === 0 ? parsePorcelain(r.stdout) : []
}

/**
 * Windows-hardened removal: lock check (never overridden — the lock reason is
 * returned to the caller) → `git worktree remove --force` → re-list →
 * fs.rm remnant with retries (Defender/AV transient locks) → `worktree prune`.
 * Refuses to fs-delete anything outside the managed worktrees root.
 */
export async function remove(wtPath: string, opts: { projectPath?: string } = {}): Promise<RemoveResult> {
  const resolved = path.resolve(wtPath)
  const result: RemoveResult = {
    ok: false,
    path: resolved,
    stage: 'guard',
    gitRemoved: false,
    fsRemoved: false,
    pruned: false,
    warnings: []
  }

  try {
    assertDeletable(resolved)
  } catch (err) {
    result.error = String(err)
    return result
  }

  const ctx = await repoCtxFor(resolved, opts.projectPath)
  if (!ctx) {
    result.error = 'cannot locate owning repository — pass opts.projectPath'
    return result
  }

  // 1) lock check — never overridden
  result.stage = 'lock-check'
  const entries = await listViaCtx(ctx)
  const mine = entries.find((w) => norm(w.path) === norm(resolved))
  if (mine?.locked) {
    result.lockedReason = mine.lockReason ?? 'locked (no reason recorded)'
    result.error = `worktree is locked: ${result.lockedReason}`
    return result
  }

  // 2) git worktree remove --force
  result.stage = 'git-remove'
  const rm = await run([...ctx.args, 'worktree', 'remove', '--force', resolved], ctx.cwd, {
    timeoutMs: 60_000
  })
  if (rm.code !== 0) {
    result.warnings.push(`worktree remove failed (code ${rm.code}): ${rm.stderr.trim().slice(0, 300)}`)
  }

  // 3) re-list to confirm git forgot it
  const after = await listViaCtx(ctx)
  result.gitRemoved = !after.some((w) => norm(w.path) === norm(resolved))

  // 4) fs.rm remnant — retries ride out Defender/AV index locks
  result.stage = 'fs-remove'
  const stillThere = await fs.stat(resolved).catch(() => null)
  if (stillThere) {
    try {
      assertDeletable(resolved)
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    } catch (err) {
      result.error = `fs.rm failed: ${String(err)}`
    }
  }
  result.fsRemoved = (await fs.stat(resolved).catch(() => null)) === null

  // 5) prune stale administrative entries
  result.stage = 'prune'
  const prune = await run([...ctx.args, 'worktree', 'prune'], ctx.cwd)
  result.pruned = prune.code === 0
  if (prune.code !== 0) result.warnings.push(`worktree prune failed: ${prune.stderr.trim().slice(0, 200)}`)

  result.stage = 'done'
  result.ok = result.gitRemoved && result.fsRemoved
  if (!result.ok && !result.error) {
    result.error = !result.gitRemoved
      ? 'git still lists the worktree after remove'
      : 'directory still present after fs.rm'
  }
  return result
}

/** `git worktree lock --reason <reason> <path>` — reason survives restarts. */
export async function lock(
  wtPath: string,
  reason: string,
  opts: { projectPath?: string } = {}
): Promise<LockResult> {
  const ctx = await repoCtxFor(path.resolve(wtPath), opts.projectPath)
  if (!ctx) return { ok: false, error: 'cannot locate owning repository' }
  const r: GitResult = await run(
    [...ctx.args, 'worktree', 'lock', '--reason', reason, path.resolve(wtPath)],
    ctx.cwd
  )
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() }
}

export async function unlock(
  wtPath: string,
  opts: { projectPath?: string } = {}
): Promise<LockResult> {
  const ctx = await repoCtxFor(path.resolve(wtPath), opts.projectPath)
  if (!ctx) return { ok: false, error: 'cannot locate owning repository' }
  const r = await run([...ctx.args, 'worktree', 'unlock', path.resolve(wtPath)], ctx.cwd)
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() }
}

/** convenience: sha of a worktree's HEAD */
export async function worktreeSha(wtPath: string): Promise<string | null> {
  return currentSha(wtPath)
}
