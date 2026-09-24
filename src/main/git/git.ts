// ── git.ts — tiny typed wrapper around the `git` CLI ─────────────────
// All invocations go through spawn() with an explicit cwd (and `-C` for
// belt-and-suspenders). We never mutate process.cwd().

import { spawn } from 'node:child_process'

export interface GitResult {
  /** process exit code; -1 spawn failure, -2 killed by timeout */
  code: number
  stdout: string
  stderr: string
}

export interface GitRunOptions {
  /** ms before SIGKILL (default 30s; 0 disables) */
  timeoutMs?: number
  /** written to stdin, which is then always closed */
  input?: string
  env?: NodeJS.ProcessEnv
}

export class GitError extends Error {
  readonly args: string[]
  readonly result: GitResult
  constructor(args: string[], result: GitResult, message?: string) {
    super(
      message ??
        `git ${args.join(' ')} failed (code ${result.code}): ${result.stderr.trim() || 'no stderr'}`
    )
    this.name = 'GitError'
    this.args = args
    this.result = result
  }
}

/**
 * Run `git <args>` with spawn cwd = `cwd`. Never throws — resolves with the
 * captured result even on spawn failure (code -1) or timeout (code -2).
 */
export function run(args: string[], cwd: string, opts: GitRunOptions = {}): Promise<GitResult> {
  const { timeoutMs = 30_000, input, env } = opts
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('git', args, {
        cwd,
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: `spawn failed: ${String(err)}` })
      return
    }

    const out: Buffer[] = []
    const errBuf: Buffer[] = []
    let settled = false
    let timedOut = false

    const finish = (code: number, extraStderr = ''): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errBuf).toString('utf8') + extraStderr
      })
    }

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            try {
              child.kill('SIGKILL')
            } catch {
              /* already dead */
            }
          }, timeoutMs)
        : undefined
    timer?.unref?.()

    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => errBuf.push(d))
    child.on('error', (err) => finish(-1, `spawn error: ${String(err)}`))
    child.on('close', (code) =>
      finish(code ?? (timedOut ? -2 : -1), timedOut ? `\n[git] killed after ${timeoutMs}ms` : '')
    )

    if (input !== undefined) child.stdin?.write(input)
    child.stdin?.end()
  })
}

/** true if `path` is inside (or is) a git repository — bare repos included. */
export async function isRepo(path: string): Promise<boolean> {
  const r = await run(['-C', path, 'rev-parse', '--git-dir'], path)
  return r.code === 0 && r.stdout.trim().length > 0
}

/**
 * Best-effort default branch for a repo: origin/HEAD → local main/master →
 * current HEAD symref → 'main'.
 */
export async function defaultBranch(repoPath: string): Promise<string> {
  const head = await run(
    ['-C', repoPath, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    repoPath
  )
  if (head.code === 0) {
    const b = head.stdout.trim().replace(/^origin\//, '')
    if (b) return b
  }
  for (const b of ['main', 'master']) {
    const r = await run(['-C', repoPath, 'rev-parse', '--verify', `refs/heads/${b}`], repoPath)
    if (r.code === 0) return b
  }
  const cur = await run(['-C', repoPath, 'symbolic-ref', '--quiet', '--short', 'HEAD'], repoPath)
  if (cur.code === 0 && cur.stdout.trim()) return cur.stdout.trim()
  return 'main'
}

/**
 * `git -C <repoPath> fetch origin [refspec]`. Network op — default timeout 120s.
 * Returns the raw result; callers decide whether failure is fatal.
 */
export function fetch(repoPath: string, refspec?: string, timeoutMs = 120_000): Promise<GitResult> {
  const args = ['-C', repoPath, 'fetch', 'origin']
  if (refspec) args.push(refspec)
  return run(args, repoPath, { timeoutMs })
}

/** sha of HEAD for a repo or worktree path, or null if unborn/detached-fail. */
export async function currentSha(path: string): Promise<string | null> {
  const r = await run(['-C', path, 'rev-parse', 'HEAD'], path)
  return r.code === 0 ? r.stdout.trim() : null
}
