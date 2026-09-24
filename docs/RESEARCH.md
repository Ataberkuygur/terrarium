# RESEARCH — evidence behind the decisions

Working notes that back `DECISIONS.md`. Each block: what we needed, what we
found, confidence, and where it landed in code. Items marked 🔬 are claims
worth re-verifying when the corresponding milestone lands; 📝 = verified
against code in this repo.

---

## R1 — PTY on Windows: node-pty + ConPTY vs the Tauri path

**Need.** Spawn agent CLIs (`claude`, `codex`, `aider`, `opencode`, …) in real
terminals on Windows-first, with resize, scrollback, colors — full TTY
semantics, not piped stdio.

**Findings.**

- `node-pty` is the de-facto native PTY binding (VS Code's own choice).
  Ships N-API prebuilds; on Windows it bundles a pinned ConPTY build
  (~1.23 era) — modern pseudoconsole flags, VT processing, resize. 🔬 the
  exact bundled ConPTY build still isn't pinned/verified — do it before M3
  sign-off (pty-host is live, so this is now checkable at runtime).
- Tauri alternatives evaluated: `portable-pty` (wezterm's; lacks the modern
  ConPTY flags node-pty exposes — resize/scrollback edge cases) and
  `tauri-plugin-pty` (v0.3.x, single maintainer, thin release history).
  Verdict: ecosystem maturity is the whole ballgame for a terminal-centric
  app → Electron.
- xterm.js addon surface we consume: `@xterm/xterm` (v6), `addon-fit`,
  `addon-search`, `addon-serialize` (headless scrollback → replay on attach),
  `addon-webgl` (GPU render; currently pinned `0.20.0-beta.300` — **version
  skew vs xterm ^6, re-verify at M3** 🔬).

**Landed.** `shared/pty.ts` (`PTY_IPC`, `PtyBridge`, `PtyEvent`,
`PTY_ATTACH_RESET_SEQ`); `main/pty/` host + manager + protocol; preload
fan-out bridge; `terminal/` component + `MockPtyBridge`. 📝

---

## R2 — SQLite without native rebuilds

**Need.** Local transactional store + FTS for the wiki index. Must not add a
native-rebuild step (that's the tax we're avoiding with every Electron bump).

**Findings.**

- `node:sqlite` (`DatabaseSync`) ships in the Node 24 runtime inside
  Electron 44 — synchronous, FTS5 compiled in, no ABI chase. Verified: the
  class is used in `src/main/engine/db.ts` and `docs_fts` virtual table +
  sync triggers exist in `schema.ts` migration 1. 📝
- better-sqlite3 benchmarked faster in microbenchmarks but requires
  prebuilt/ABI-matched binaries per Electron version; our query load (≤200
  event rows, a few dozen entities) is far below the point where the driver
  is the bottleneck.
- `PRAGMA user_version` numbered-migration pattern + WAL + `busy_timeout`
  matches how VS Code / mature Electron apps run embedded SQLite. 📝
- `@types/node` is `^22` while the runtime is Node 24 — `node:sqlite` types
  exist there, but bump to `^24` at M2 closeout. 🔬

---

## R3 — utilityProcess pty-host (the VS Code pattern)

**Need.** Terminal sessions that survive renderer reloads and can't take the
app down when a native module faults.

**Findings.**

- VS Code moved terminal hosting out of the renderer into a dedicated
  process after repeated native-crash and flood-stall incidents; Electron's
  `utilityProcess.fork` gives the same isolation boundary: own Node runtime,
  `MessagePort` IPC, independent lifetime.
- Flow control landed as size/time-bounded batching, not acks: flush at
  16KB or 8ms (`pty-host.ts`); the research assumed ack-based backpressure —
  revisit only if a `cat /dev/urandom`-class stall ever reproduces. 📝
- Scrollback authority lives in the host: 256KB ring per session, replayed
  on `attach` after `PTY_ATTACH_RESET_SEQ` (soft-reset + kitty-keyboard pop +
  cursor restore — the same trick VS Code uses) → reload-safe terminals. 📝
- Main-side `manager.ts`: id-correlated RPC (15s), session registry, host
  exit → sessions marked `dead`, lazy re-fork on next spawn. 📝

---

## R4 — Git worktrees on Windows

**Need.** One task = one isolated checkout, without touching the user's
working tree; Windows-hardened.

**Findings.**

- `git worktree add -b <branch> <path> <start>` is the native primitive;
  `worktree list --porcelain` gives parseable state including `locked`,
  `prunable`, `detached`, `bare`. 📝 `worktrees.ts` `parsePorcelain`.
- Linked worktrees store a `.git` **file** (`gitdir: …`) plus a `commondir`
  pointer back to the shared `.git` — resolve through it, never assume a
  dir. 📝 `resolveCommonGitDir`.
- Locks: `git worktree lock --reason` survives restarts and is honored by
  `remove`/`prune` — we surface the reason, never override. 📝
- Windows hazards found and handled: `MAX_PATH=260` → root under
  `%USERPROFILE%\.terrarium\` not AppData, slugs ≤48 chars; reserved device
  names (`nul`, `con`, `com1`…) prefixed `w-`; AV/Defender transient file
  locks → `fs.rm` with `maxRetries`; half-deleted worktrees → reconcile via
  `--git-dir` context even when the worktree dir is gone. 📝 `worktrees.ts`
- `.worktreeinclude` convention (ours): untracked files to copy into fresh
  worktrees (`.env`, local certs). Repo-escape attempts are warned + skipped. 📝
- `.terrarium/context.md` inside each worktree carries task/branch/base context
  for the agent, kept untracked via shared `info/exclude`. 📝

---

## R5 — Wiki vault: Obsidian compatibility

**Need.** A project wiki that's a real folder of markdown — openable in
Obsidian, writable by agents, regenerable without clobbering humans.

**Findings.**

- Obsidian needs nothing but `.md` files + `[[wikilinks]]`; frontmatter is
  optional YAML. `.obsidian/`, `assets/`, `.trash/` are skipped on scan;
  `index.md` = vault home. 📝 `vault.ts`
- gray-matter is read-tolerant; we serialize ourselves for stable key order
  / ISO dates / LF endings (js-yaml output is reader-side only). 📝
  `frontmatter.ts`
- `<!-- AUTOGEN:name -->` block markers = the merge protocol between
  generated and human content (`mergeAutogenBodies`). 📝
- Freshness: each page's frontmatter lists `source_files`; a repo-side
  chokidar batch watcher marks overlapping pages `stale` — badge in UI. 📝
  (The `WikiIndex`/`generate` modules exist but nothing instantiates them
  yet — the open seam is ARCHITECTURE §9.2.)
- chokidar hygiene: `awaitWriteFinish` 200ms for half-written files, ignore
  `.tmp-*` atomic-write siblings, 500ms self-write grace to avoid indexing
  our own writes. 📝 `watcher.ts`

---

## R6 — Electron shell hardening

- `contextIsolation: true` + `nodeIntegration: false` + contextBridge-only
  API surface. `sandbox: false` because the bundled preload needs CJS module
  loading — the trust boundary is the bridge, not the Chromium sandbox. 📝
- `titleBarStyle: 'hidden'` + `titleBarOverlay` for the custom titlebar;
  Windows-first (macOS overlay semantics differ — revisit at M6). 🔬
- CSP: `default-src 'self'`; `script-src 'unsafe-inline'` is Vite-dev-driven —
  tighten for production builds at M6 (electron-vite hashes). 🔬
- `window.prompt()` is unsupported in Electron renderers — banned; one usage
  exists in `CommandPalette` (seam §9.4). 📝
- Fonts are referenced (Inter/Geist Mono) but not bundled; CSP allows
  `font-src 'self' data:` — today we render system fallbacks. Bundle at M6
  or accept system-ui. 🔬

---

## R7 — Distribution (M6 prep)

- `electron-builder` + NSIS is the target: per-machine or per-user install,
  delta updates later. Code signing (OV cert) and `allowElevation`/`guid`
  stability go here; node-pty native binaries must be `asarUnpack`ed.
  Not yet configured — no `build` block in package.json. 🔬
- `pnpm-workspace.yaml` already whitelists native builds
  (`onlyBuiltDependencies`: electron, esbuild, node-pty). 📝

---

## R8 — Design language references

- North star feel: calm ops-room diorama (night office, warm practicals,
  monitor glow) + Linear-grade chrome discipline.
- Vocabulary: monochrome surfaces (`n1–n12`), one accent (`#F5A524` amber),
  status hues as the only other chroma. Ban-list (no purple gradients, glow
  shadows, `rounded-2xl`, emoji) exists to kill "AI-generated template"
  smell in review. 📝 `styles.css @theme`, `office/palette.ts`
- Determinism rule — "state in, pixels out" — makes the office a trust
  surface instead of decoration. 📝 (`Character.hashId`, `Props` LCG skyline)
