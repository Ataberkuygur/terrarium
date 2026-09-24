/**
 * watcher.ts — chokidar wrappers.
 *
 * VaultWatcher watches a wiki vault dir and emits normalized vault-relative
 * events. It ignores dotfiles, .obsidian/, assets/, and our own .tmp write
 * siblings; uses awaitWriteFinish (200ms) so we never index a half-written
 * page; and provides a 500ms self-write grace so index.ts writes don't echo
 * back as spurious reindex events.
 *
 * watchRepoSources watches the *project repo* (not the vault) and batches
 * changed file paths — the input for generate.ts markStale.
 */
import { EventEmitter } from 'node:events'
import { sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { relPath } from './vault'

export type VaultEventKind = 'add' | 'change' | 'unlink' | 'rescan'

export interface VaultEvent {
  kind: VaultEventKind
  /** vault-relative posix path; '' for rescan */
  path: string
}

const SELF_WRITE_GRACE_MS = 500

/** dirs never watched inside a vault */
const VAULT_SKIP_DIRS = new Set(['.obsidian', 'assets', '.trash'])

function vaultIgnored(root: string) {
  return (abs: string): boolean => {
    const rel = relPath(root, abs)
    if (rel === null || rel === '') return false // never ignore the root itself
    const segs = rel.split('/')
    for (const s of segs) {
      if (s.startsWith('.') || VAULT_SKIP_DIRS.has(s)) return true
    }
    const base = segs[segs.length - 1]
    // atomic-write siblings: page.md.tmp-1234-abcd
    if (base.endsWith('.tmp') || base.includes('.tmp-')) return true
    return false
  }
}

export class VaultWatcher extends EventEmitter {
  readonly dir: string
  private fsw: FSWatcher | null = null
  private selfWrites = new Map<string, number>()

  constructor(dir: string) {
    super()
    this.dir = dir
  }

  /** Start watching; resolves once chokidar's initial scan is done. */
  start(): Promise<void> {
    if (this.fsw) return Promise.resolve()
    return new Promise((resolvePromise, reject) => {
      const fsw = watch(this.dir, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        ignorePermissionErrors: true,
        ignored: vaultIgnored(this.dir)
      })
      this.fsw = fsw

      const onFile = (kind: 'add' | 'change' | 'unlink') => (abs: string) => {
        const rel = relPath(this.dir, abs)
        if (!rel || !rel.toLowerCase().endsWith('.md')) return
        if (kind !== 'unlink' && this.isSelfWrite(rel)) return
        this.emit('event', { kind, path: rel } satisfies VaultEvent)
      }

      fsw.on('add', onFile('add'))
      fsw.on('change', onFile('change'))
      fsw.on('unlink', onFile('unlink'))
      // a removed dir may have held pages we never saw unlink events for
      fsw.on('unlinkDir', () => this.emit('event', { kind: 'rescan', path: '' } satisfies VaultEvent))
      fsw.on('error', (err) => this.emit('error', err))
      fsw.on('ready', () => resolvePromise())
      fsw.once('error', reject)
    })
  }

  /** Record that the index is about to write `rel` itself — grace window starts now. */
  noteSelfWrite(rel: string): void {
    this.selfWrites.set(rel, Date.now())
    // lazy prune so the map can't grow forever
    if (this.selfWrites.size > 512) {
      const cutoff = Date.now() - 10_000
      for (const [k, t] of this.selfWrites) if (t < cutoff) this.selfWrites.delete(k)
    }
  }

  private isSelfWrite(rel: string): boolean {
    const t = this.selfWrites.get(rel)
    return t !== undefined && Date.now() - t < SELF_WRITE_GRACE_MS
  }

  async close(): Promise<void> {
    const fsw = this.fsw
    this.fsw = null
    if (fsw) await fsw.close()
  }
}

// ── repo source watcher ─────────────────────────────────────────────

/** dirs never watched inside a project repo (build output + noise) */
const REPO_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  'target',
  'bin',
  'obj',
  '__pycache__'
])

function repoIgnored(root: string) {
  return (abs: string): boolean => {
    const rel = relPath(root, abs)
    if (rel === null || rel === '') return false
    for (const s of rel.split(sep).join('/').split('/')) {
      if (s.startsWith('.') || REPO_SKIP_DIRS.has(s)) return true
    }
    return false
  }
}

/**
 * Watch a repo for source changes. add/change/unlink paths are accumulated and
 * delivered as one batch after `debounceMs` of quiet — the caller feeds them to
 * WikiIndex.markStaleBySourceFiles.
 */
export function watchRepoSources(
  repoPath: string,
  onBatch: (repoRelPaths: string[]) => void,
  debounceMs = 300
): FSWatcher {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pending.size === 0) return
    const batch = [...pending]
    pending.clear()
    onBatch(batch)
  }
  const poke = (abs: string) => {
    const rel = relPath(repoPath, abs)
    if (!rel) return
    pending.add(rel)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
    timer.unref?.()
  }

  const fsw = watch(repoPath, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ignored: repoIgnored(repoPath)
  })
  fsw.on('add', poke)
  fsw.on('change', poke)
  fsw.on('unlink', poke)
  return fsw
}
