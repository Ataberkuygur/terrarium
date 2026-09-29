// ── win-env — a login-shaped environment for Windows panes ────────────
// Terrarium is often started by something that never saw the user's PATH:
// an installer's "run after install", an elevated launcher, a scheduled
// task — the process then carries the MACHINE Path only. `claude`
// (~\.local\bin), muse, devin, npm shims… all live in the USER Path, so
// every pane answered "'claude' is not recognized". The pty supervisor
// makes it worse: it outlives the app, so it keeps whatever environment its
// first launcher had — until the next reboot.
//
// The registry is the truth Explorer builds a fresh login from. Read it
// (per spawn, briefly cached) and ADD whatever the process is missing;
// the launcher's own entries keep their priority.

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export type Env = Record<string, string>

const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_KEY = 'HKCU\\Environment'
const CACHE_MS = 20_000

const lc = (s: string) => s.toLowerCase()

/** Case-insensitive key lookup — Windows env names are, JS object keys aren't. */
export function envKey(env: Env, name: string): string | undefined {
  const want = lc(name)
  return Object.keys(env).find((k) => lc(k) === want)
}

/** Set `name` under whatever case the env already spells it (no PATH/Path twins). */
export function setEnv(env: Env, name: string, value: string): void {
  env[envKey(env, name) ?? name] = value
}

function systemRoot(env: Env): string {
  return env[envKey(env, 'SystemRoot') ?? ''] || env[envKey(env, 'windir') ?? ''] || 'C:\\Windows'
}

/** `%NAME%` → value, looked up case-insensitively; unknown names stay literal like cmd does. */
function expand(value: string, lookup: (name: string) => string | undefined): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => lookup(name) ?? whole)
}

/** REG_SZ / REG_EXPAND_SZ values under one registry key, unexpanded. */
function readRegistryKey(key: string, env: Env): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const sys32 = join(systemRoot(env), 'System32')
    const reg = join(sys32, 'reg.exe')
    const comspec = env[envKey(env, 'ComSpec') ?? ''] || join(sys32, 'cmd.exe')
    // chcp 65001 → reg prints UTF-8, so a non-ASCII profile folder survives.
    // (Space before '>' matters: "65001>nul" would read as a handle redirect.)
    const res = spawnSync(
      comspec,
      ['/d', '/s', '/c', `"chcp 65001 >nul & "${reg}" query "${key}""`],
      {
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    )
    const text = res.stdout ?? ''
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s+(\S.*?)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line)
      if (m) out[m[1]] = m[2].trim()
    }
  } catch {
    /* reg unreachable — the process env alone still works as before */
  }
  return out
}

const splitPath = (p: string | undefined): string[] =>
  (p ?? '')
    .split(delimiter)
    .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)

/** Where CLIs install themselves even when nobody told PATH yet. */
function fallbackDirs(env: Env): string[] {
  const home = env[envKey(env, 'USERPROFILE') ?? ''] || homedir()
  const appData = env[envKey(env, 'APPDATA') ?? ''] || join(home, 'AppData', 'Roaming')
  const local = env[envKey(env, 'LOCALAPPDATA') ?? ''] || join(home, 'AppData', 'Local')
  const root = systemRoot(env)
  return [
    join(root, 'System32'),
    root,
    join(root, 'System32', 'Wbem'),
    join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    join(home, '.local', 'bin'), // claude (native installer)
    join(appData, 'npm'), // npm -g shims (codex, cline, opencode…)
    join(local, 'Microsoft', 'WindowsApps'), // pwsh / winget aliases
    join(home, '.bun', 'bin'),
    'C:\\Program Files\\nodejs',
    'C:\\Program Files\\Git\\cmd'
  ].filter((d) => existsSync(d))
}

/**
 * A caller-supplied Path (an orchestration node prepends its tnet dir to the
 * app's Path) merged with the rebuilt one: the caller's entries lead, and
 * whatever it lacks is still there. Replacing outright is how a launcher-
 * stripped Path once stripped every network terminal of `claude`.
 */
export function mergePaths(preferred: string, rebuilt: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...splitPath(preferred), ...splitPath(rebuilt)]) {
    const id = lc(dir.replace(/[\\/]+$/, ''))
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(dir)
    }
  }
  return out.join(delimiter)
}

let cache: { at: number; env: Env } | null = null

/**
 * `base` (the process env) plus everything a fresh login would have added:
 * missing Path entries from the registry (machine, then user), missing user
 * variables, and the well-known CLI dirs. Never removes or overrides
 * anything `base` already sets. A copy — `base` itself is untouched.
 */
export function freshWindowsEnv(base: NodeJS.ProcessEnv = process.env): Env {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return { ...cache.env }

  const env: Env = {}
  for (const [k, v] of Object.entries(base)) if (typeof v === 'string') env[k] = v

  const machine = readRegistryKey(MACHINE_KEY, env)
  const user = readRegistryKey(USER_KEY, env)

  // expansion sees the process env first, then user, then machine values
  const lookup = (name: string): string | undefined => {
    const inEnv = envKey(env, name)
    if (inEnv) return env[inEnv]
    const from = (reg: Record<string, string>) => {
      const k = Object.keys(reg).find((r) => lc(r) === lc(name))
      return k ? reg[k] : undefined
    }
    return from(user) ?? from(machine)
  }

  // ── Path: the launcher's entries first, then what the registry adds ──
  const pathOf = (reg: Record<string, string>) => {
    const k = Object.keys(reg).find((r) => lc(r) === 'path')
    return k ? splitPath(expand(reg[k], lookup)) : []
  }
  const merged: string[] = []
  const seen = new Set<string>()
  const add = (dir: string) => {
    const id = lc(dir.replace(/[\\/]+$/, ''))
    if (id && !seen.has(id)) {
      seen.add(id)
      merged.push(dir)
    }
  }
  splitPath(env[envKey(env, 'Path') ?? '']).forEach(add)
  pathOf(machine).forEach(add)
  pathOf(user).forEach(add)
  fallbackDirs(env).forEach(add)
  setEnv(env, 'Path', merged.join(delimiter))

  // ── user/machine variables the process never received ──
  for (const reg of [user, machine]) {
    for (const [name, raw] of Object.entries(reg)) {
      if (lc(name) === 'path' || envKey(env, name)) continue
      env[name] = expand(raw, lookup)
    }
  }

  // ── Windows plumbing every child takes for granted ──
  const root = systemRoot(env)
  if (!envKey(env, 'SystemRoot')) env.SystemRoot = root
  if (!envKey(env, 'windir')) env.windir = root
  if (!envKey(env, 'ComSpec')) env.ComSpec = join(root, 'System32', 'cmd.exe')
  if (!envKey(env, 'PATHEXT')) env.PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'

  cache = { at: now, env }
  return { ...env }
}

/**
 * Repair THIS process's environment in place, so everything it spawns —
 * the pty supervisor, tnet, git/CLI detection — inherits a complete PATH.
 * Call once, before anything spawns.
 */
export function repairProcessEnv(): void {
  if (process.platform !== 'win32') return
  try {
    const fresh = freshWindowsEnv(process.env)
    for (const [k, v] of Object.entries(fresh)) {
      if (process.env[k] !== v) process.env[k] = v
    }
  } catch {
    /* keep the environment we were given */
  }
}

/** Executables `name` resolves to along env's Path, in Path order (PATHEXT-aware, .ps1 last). */
export function resolveOnPath(name: string, env: Env): string[] {
  const exts = (env[envKey(env, 'PATHEXT') ?? ''] || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map(lc)
  const known = [...exts, '.ps1']
  const hasExt = known.some((e) => lc(name).endsWith(e))
  const names = hasExt ? [name] : known.map((e) => name + e)
  const hits: string[] = []
  for (const dir of splitPath(env[envKey(env, 'Path') ?? ''])) {
    for (const n of names) {
      const full = join(dir, n)
      try {
        if (existsSync(full) && statSync(full).isFile() && !hits.includes(full)) hits.push(full)
      } catch {
        /* unreadable entry — skip */
      }
    }
  }
  return hits
}

/** Last-resort absolute paths for the two shells every Windows box has. */
export function knownShell(name: string, env: Env): string | null {
  const base = lc(name.replace(/\.exe$/i, ''))
  const root = systemRoot(env)
  const candidate =
    base === 'powershell'
      ? join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : base === 'cmd'
        ? env[envKey(env, 'ComSpec') ?? ''] || join(root, 'System32', 'cmd.exe')
        : null
  return candidate && existsSync(candidate) ? candidate : null
}
