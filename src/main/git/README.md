# src/main/git — worktree lifecycle + agent-CLI detection

Main-process-only module (Node APIs, no Electron imports — safe to unit test).

## Files
- `git.ts` — `run(args, cwd) → {code, stdout, stderr}` spawn wrapper (never throws;
  code -1 spawn fail, -2 timeout). Helpers: `isRepo`, `defaultBranch`, `fetch`,
  `currentSha`, `GitError`. Always `git -C <repo>` — process.cwd() untouched.
- `worktrees.ts` — managed worktrees under `%USERPROFILE%\.terrarium\worktrees\
  <project-slug>\<task-slug>`. `create()` fetches origin, `worktree add -b
  agent/<slug>` (bootstrap empty repos via commit-tree plumbing), copies
  `.worktreeinclude` paths, writes gitignored `.terrarium/context.md`. `list()`
  parses `--porcelain`; `reconcile()` classifies active|dirty|orphaned|
  stranded|foreign vs fs + registry; `remove()` = lock-check → `worktree remove
  --force` → re-list → `fs.rm` retries → `prune`; `lock`/`unlock`.
- `detect.ts` — `detectAgentClis()` probes [claude, codex, aider, opencode,
  gemini, cursor-agent, copilot, grok, muse, qoder] via `where.exe`, tags `cmd-shim`|`exe`,
  captures `--version` (5s, tolerant). `detectWsl()` via `wsl.exe --status`.

## Wiring (in src/main/index.ts)
```ts
import { ipcMain } from 'electron'
import * as wt from './git/worktrees'
import { detectAgentClis } from './git/detect'
ipcMain.handle('wt:create', (_e, o) => wt.create(o))
ipcMain.handle('wt:list', (_e, p) => wt.list(p))
ipcMain.handle('wt:reconcile', (_e, p, reg) => wt.reconcile(p, reg))
ipcMain.handle('wt:remove', (_e, p, o) => wt.remove(p, o))
ipcMain.handle('wt:lock', (_e, p, r, o) => wt.lock(p, r, o))
ipcMain.handle('wt:unlock', (_e, p, o) => wt.unlock(p, o))
ipcMain.handle('agents:detect', () => detectAgentClis())
```

## Windows gotchas
- MAX_PATH 260: keep slugs ≤48 chars; long repos need `git config --system
  core.longpaths true` AND the app manifest `longPathAware` flag.
- Never create junctions/symlinks in worktrees — git status/Defender misbehave.
- Defender/AV holds transient file locks: `fs.rm` uses maxRetries 5/500ms.
- `.cmd`/`.bat` shims cannot be spawned directly — always via `cmd.exe /c`.
- `wsl.exe` prints UTF-16LE — sniff the BOM/NULs before decoding.
- Reserved names (CON, NUL, AUX, COM1-9, LPT1-9) are prefixed by `slugify`.
