// ── Terrarium home layout ───────────────────────────────────────────────
// Everything lives under %USERPROFILE%\.terrarium\ — deliberately NOT
// AppData, so agent worktree paths stay short on Windows.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, renameSync } from 'node:fs'

const LEGACY_HOME = join(homedir(), '.atolye')
const NEW_HOME = join(homedir(), '.terrarium')

/** ~/.terrarium — on first run after the rename the atolye-era dir is
 * moved wholesale. If the move can't complete (e.g. a detached pty-host
 * still holds pty-host.log open) the legacy dir answers for that run and
 * the move retries on the next launch. */
export function defaultHome(): string {
  // test / portable override: a whole separate Terrarium profile
  const override = process.env.TERRARIUM_HOME?.trim()
  if (override) return override
  if (!existsSync(NEW_HOME) && existsSync(LEGACY_HOME)) {
    try {
      renameSync(LEGACY_HOME, NEW_HOME)
    } catch {
      return LEGACY_HOME
    }
  }
  return NEW_HOME
}

export interface TerrariumPaths {
  /** %USERPROFILE%\.terrarium */
  home: string
  /** main SQLite database (app.db) */
  db: string
  /** per-run git worktrees — managed by git/worktrees.ts */
  worktrees: string
  /** engine + session logs */
  logs: string
  /** per-project wiki vaults */
  vaults: string
  /** persistent agent homes: agents/<slug>/ */
  agents: string
  /** voice-to-terminal runtime & model cache: voice/ */
  voice: string
}

/** Resolve the standard layout under `home` (defaults to ~/.terrarium). */
export function resolvePaths(home: string = defaultHome()): TerrariumPaths {
  return {
    home,
    db: join(home, 'app.db'),
    worktrees: join(home, 'worktrees'),
    logs: join(home, 'logs'),
    vaults: join(home, 'vaults'),
    agents: join(home, 'agents'),
    voice: join(home, 'voice')
  }
}

/** Per-agent working directory: ~/.terrarium/agents/<slug>/ */
export function agentDir(paths: TerrariumPaths, slug: string): string {
  return join(paths.agents, slug)
}

/** Per-run worktree path: ~/.terrarium/worktrees/<project>/<slug> */
export function worktreeDir(paths: TerrariumPaths, project: string, slug: string): string {
  return join(paths.worktrees, project, slug)
}

/** Create the whole directory tree (idempotent). Call once at startup. */
export function ensurePaths(home?: string): TerrariumPaths {
  const paths = resolvePaths(home)
  for (const dir of [paths.home, paths.worktrees, paths.logs, paths.vaults, paths.agents, paths.voice]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}
