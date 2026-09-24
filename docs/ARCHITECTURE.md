# Terrarium — Architecture

A desktop "AI crew office": agents live in a 3D diorama office, work happens in
isolated git worktrees, a wiki teaches you the project, and an attention inbox
collects only what needs a human.

Stack: **Electron 44** (Node 24) · **React 19** · **TypeScript strict** ·
**Tailwind 4** · **React Three Fiber** · **node:sqlite** · **node-pty + xterm.js**
· **pnpm**.

---

## 1. Process model

Three Electron process layers, one direction of trust.

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (sandboxed-ish Chromium + React 19)                │
│  views: Office · Board · Wiki · Inbox · Workspace           │
│  talks only to window.terrarium (contextBridge)                │
└──────────────▲──────────────────────────────┬───────────────┘
               │ IPC invoke                   │ push channels
               │ (engine:* · wt:* ·           │ engine:state
               │  terrarium:pty:* · agents:detect│ engine:event
               │  · shell:openExternal)       │ terrarium:pty:event
┌──────────────┴──────────────────────────────▼───────────────┐
│ Main (Node 24) — thin orchestrator, src/main/index.ts        │
│  engine/   SQLite office record (node:sqlite + FTS5)         │
│  git/      worktree lifecycle, agent-CLI detection           │
│  wiki/     vault files, frontmatter, chokidar watchers       │
│  pty/      manager → forks the pty-host                      │
│  voice/    local whisper-large-v3-turbo prompt engine (F8)   │
└──────────────▲───────────────────────────────────────────────┘
               │ utilityProcess.fork (VS Code pattern)
┌──────────────┴───────────────────────────────────────────────┐
│ pty-host (utilityProcess) — owns every node-pty session      │
│  batched output · ring-buffer scrollback · crash isolation   │
└──────────────────────────────────────────────────────────────┘
```

**pty subsystem (`main/pty/`).** `pty-host.ts` runs under
`utilityProcess.fork` (ELECTRON_RUN_AS_NODE) and owns every `node-pty`
session: output is batched (flush at 16KB or 8ms), each session keeps a
256KB ring buffer replayed on `attach` (prefixed by `PTY_ATTACH_RESET_SEQ` —
soft-reset, kitty-keyboard pop, cursor restore). `manager.ts` (main side)
correlates requests by id (15s RPC timeout), keeps a session registry, and
on host exit marks live sessions `dead` — the next spawn re-forks.
`protocol.ts` is the `parentPort` wire format; `shared/pty.ts` is the
renderer-visible contract (`PTY_IPC` channels, `PtyEvent`, `PtyBridge`).
Renderer side: `terminal/Terminal.tsx` + `MockPtyBridge` for browser dev.
Windows shims (`.cmd`/`.bat`) are resolved via `where.exe` in the host.

**voice subsystem (`main/voice/`).** Auto-provisions and lifecycle-manages
a local Python background engine powered by `whisper-large-v3-turbo` with
NVIDIA CUDA acceleration. On app launch, it checks host Python and pip
dependencies, syncs runtime scripts to `%USERPROFILE%\.terrarium\voice\`,
and binds the global `F8` hotkey to stream microphone audio directly in-memory,
transcribe via CUDA float16 (~180ms inference), and paste into whatever terminal
is active without sending an automatic Enter.

**Wiring.** `main/index.ts` statically imports every subsystem at
`app.whenReady()`: `createEngine()` opens + seeds `app.db`, all `ipcMain.handle`
registrations happen up front, `engine.subscribe`/`onEvent` are forwarded to
every window, `createPtyManager()` forks the host lazily on first spawn, and
`before-quit` closes the DB (WAL checkpoint) and disposes the host. Startup is
fail-fast — a broken import crashes the app at boot, deliberately; the
degradation path lives renderer-side (mock engine + `MockPtyBridge` when the
bridge is absent), so the app always runs in a plain browser tab.

### Security posture

- `contextIsolation: true`, `nodeIntegration: false` — renderer gets only what
  the preload exposes on `window.terrarium` (`engine`, `pty`, `platform`,
  `detectClis`, `openExternal`).
- `sandbox: false` — deliberate: the electron-vite preload is bundled CJS and
  needs Node module loading. The boundary is enforced by context isolation,
  not the Chromium sandbox.
- CSP in `index.html`: `default-src 'self'`, scripts self + inline (Vite dev),
  `connect-src` limited to localhost/ws (HMR).
- `setWindowOpenHandler` denies all new windows; external links go through
  `shell.openExternal` on an explicit IPC channel.
- `window.prompt()` is **not implemented** in Electron renderers — never use it.

---

## 2. The Engine boundary — one doorway

`src/shared/types.ts` is the whole contract. The renderer sees an `Engine`:

```ts
getState(): Promise<EngineState>
subscribe(cb): unsub                      // push, not pull
createCard / assignCard / moveCard / nudgeAgent
listWikiPages / getWikiPage / searchWiki
```

Two implementations behind the same interface:

| impl                    | where                        | truth                |
|-------------------------|------------------------------|----------------------|
| `mock-engine.ts`        | renderer fallback (browser)  | in-memory + timers   |
| `main/engine/engine.ts` | main process                 | SQLite `app.db`      |

**Push model.** Every mutation runs in a `BEGIN IMMEDIATE` transaction, appends
`OfficeEvent` rows, then publishes: `EngineBus` emits `'event'` per event and
`'state'` with a fresh full snapshot; main forwards them on `engine:state` /
`engine:event`. The zustand store (`lib/store.ts`) is a flat projection of
`EngineState` + view chrome — components never hold server state.

**IPC channels.** Canonical names live in `src/shared/ipc.ts` (`IPC.*` —
engine + wiki) and `src/shared/pty.ts` (`PTY_IPC.*` — `terrarium:pty:*` +
`PTY_ATTACH_RESET_SEQ`). Both sides consume the constants. Still inline
(to migrate): `wt:*`, `agents:detect`, `shell:openExternal`. Preload wraps
invoke channels into the `Engine`/`PtyBridge` objects and fans the single
`PTY_IPC.EVENT` channel out into per-session `onData/onReplay/onExit/onStatus`
subscriptions.

### Domain model (`src/shared/types.ts`)

| entity        | essence                                                        |
|---------------|----------------------------------------------------------------|
| `Agent`       | named persona: role, brief, `hue`, `deskId`, status            |
| `TaskCard`    | unit of work: backlog→ready→doing→review→done, priority 0/1/2  |
| `Run`         | one execution of a card by one agent; owns worktree + branch   |
| `Project`     | a repo: rootPath + mainBranch                                  |
| `OfficeEvent` | append-only log → ticker + inbox                               |
| `WikiPage`    | meta (type, stale, links) + markdown body + derived backlinks  |

Status vocabularies: `AgentStatus = idle·working·waiting·done·offline`,
`RunStatus = provisioning·active·waiting·review·done·failed`.
`waiting` is sacred — it means "needs a human" and drives the inbox.

### SQLite record (`engine/schema.ts`, migration 1)

`meta` · `projects` · `agents` · `cards` · `runs` · `sessions` · `worktrees`
(registry with `locked` flag) · `events` (append-only) · `routines` (cron →
card templates) · `docs` + `docs_fts` (FTS5 external-content table kept in
sync by triggers). WAL mode, `foreign_keys=ON`, `busy_timeout=5000`,
numbered migrations via `PRAGMA user_version`.

`Engine.snapshot()` = agents + cards + runs + projects + last 200 events —
the entire renderer state is one query bundle.

---

## 3. Files vs DB — the split

**Rule: SQLite holds the queryable record; the filesystem holds artifacts.**

```
%USERPROFILE%\.terrarium\           (engine/paths.ts — deliberately not AppData:
├── app.db                        short paths matter on Windows, MAX_PATH=260)
├── workspaces\<project>\<slug>\  per-run work dirs written into Run.worktreePath
├── worktrees\<project>\<task>\   managed git worktrees (git/worktrees.ts)
├── vaults\<project-slug>\*.md    Obsidian-openable wiki vault (wiki/vault.ts)
├── agents\<slug>\                persistent agent homes (memory, identity)
└── logs\                         engine + session logs (incl. pty-host log)
```

- `workspaces/` vs `worktrees/` are **two different roots** — see §9.1.
- Worktree naming is slugged ≤48 chars, Windows-reserved names prefixed
  (`nul` → `w-nul`).

---

## 4. Worktree lifecycle (`main/git/worktrees.ts`)

`create` → fetch origin → `worktree add -b agent/<task-slug>` from
`origin/<base>` → copy `.worktreeinclude` paths → write gitignored
`.terrarium/context.md`. Unborn repos get an empty initial commit via plumbing
(`mktree`/`commit-tree`/`update-ref`) — the user's index and git config are
never touched.

`reconcile` cross-checks `git worktree list --porcelain` × the filesystem ×
the DB registry → `active | dirty | orphaned | stranded | foreign`.
Foreign worktrees (outside the managed root) are never touched.

`remove` is Windows-hardened: **lock-check first — never overridden** (the
lock reason is returned to the caller) → `worktree remove --force` → re-list
to confirm → `fs.rm` with retries (Defender/AV index locks) →
`worktree prune`. Refuses to delete anything outside the managed root.

`git.ts` itself is a never-throws spawn wrapper: explicit `-C <repo>`,
30s default timeout (120s fetch), `code -1` spawn-fail / `-2` timeout.

`detect.ts` probes agent CLIs (`claude`, `codex`, `aider`, `opencode`,
`gemini`, `cursor-agent`, `copilot`, `grok`, `muse`) via `where.exe`, classifies
`cmd-shim | exe` (`.cmd` shims must run through `cmd.exe`), captures
`--version`; `detectWsl()` sniffs `wsl.exe --status` with UTF-16 decoding.

---

## 5. The Office — deterministic diorama

`renderer/src/office/` is a procedural low-poly R3F scene. **State in, pixels
out**: the same `EngineState` produces the same office; all randomness is
seeded (`hashId` for character looks, a Park–Miller LCG for the city skyline).

- `layout.ts` — six desks in two facing rows, couch corner, meeting pod,
  shelf, window. `OfficeScene.tsx` maps `agent.status` → placement/pose:
  `working` types at desk (lamp on, monitor glowing), `waiting` stands with a
  pulsing amber lamp + red "needs you" beacon, `done` gets a green beacon,
  `idle` lounges on the couch, `offline` leaves an empty chair.
- `MonitorScreen.tsx` paints canvas textures per role (code lines, doc pages,
  designer swatches); `Props.tsx` is the furniture library; `palette.ts` is
  the scene's token file (cool night room, warm practicals, amber rug border).
- Post: `SMAA + Bloom + Vignette` via `@react-three/postprocessing`;
  `ContactShadows` grounds the diorama. Camera = `CameraControls`, refocuses
  on the selected agent's desk.
- Overlay UI (crew rail, agent panel, ticker) is plain DOM over the canvas.
- `lib/audio.ts` + `sfx.ts` + `ambience.ts`: fully procedural Web Audio —
  typing ticks, card thock, done chime, soft alert bell, room tone bed.
  Created only inside a user gesture; master ambience ≤ 0.06 gain.

---

## 6. Wiki — vault on disk, index in DB

- Each project gets `%USERPROFILE%\.terrarium\vaults\<slug>\` — a valid
  **Obsidian vault**: `index.md` home, kebab-case filenames, YAML frontmatter
  (`id`, `title`, `type`, `created`, `updated`, `stale`, `source_files`),
  `[[wikilinks]]` between pages.
- `frontmatter.ts` — gray-matter for *reading* (tolerant of whatever Obsidian
  writes), hand-rolled serializer for *writing* (stable key order, ISO dates,
  LF). `<!-- AUTOGEN:name -->` blocks let generated sections be regenerated
  without clobbering human prose; `extractWikilinks`/`extractHeadings` feed
  the index, skipping fenced code.
- `index.ts` — `WikiIndex`: in-memory metadata cache over a vault. Parses
  each `.md` once, keeps id↔path maps, derives backlinks + unresolved links,
  folds `VaultWatcher` events into a debounced (300ms) reindex. Page ids are
  stable across renames (the id lives in frontmatter). Loose coupling to the
  engine: changes announce on `wikiBus` (`doc.changed`/`doc.removed`) so an
  FTS module can subscribe without a reverse import.
- `generate.ts` — deterministic (no-LLM) structural pages: `modules/<dir>.md`
  per top-level dir, `repo-map.md`, `how-to-run.md`, `glossary.md`, `index.md`
  — AUTOGEN blocks spliced into existing pages via `mergeAutogenBodies`, each
  page recording `source_files` so repo edits flip it stale.
- `watcher.ts` — `VaultWatcher` (chokidar, `awaitWriteFinish` 200ms, ignores
  dotfiles/.obsidian/.tmp siblings, 500ms self-write grace) and
  `watchRepoSources` (repo-side batcher → marks pages stale via their
  `source_files`).
- Renderer side: `lib/markdown.tsx` is a hand-rolled renderer (headings,
  tables, fences, mermaid-as-pre block, `[[links]]`, inline marks);
  `WikiView` shows a **local graph** — active page + neighbors on a circle,
  deliberately not a global hairball. Stale pages get a badge; search should
  hit `engine.searchWiki` (FTS5) — currently filtered client-side (seam §9.6).
- Mirroring: the `docs` table + `docs_fts` are the queryable index; vault
  files are the artifact of record. `ensureVault('terrarium')` materializes the
  demo pages on first run — once `WikiIndex` is instantiated (seam §9.2).

---

## 7. Renderer feature modules

- `lib/panes.ts` — pure immutable **binary-split pane tree** for the Workspace
  view (leaf kinds: terminal/file/browser/note; `MAX_LEAVES=8`, ratio clamp
  [0.15, 0.85], `panesReducer`, versioned localStorage (de)serialization).
  `workspace/` has `PaneHost`, `Divider`, `EmptyPane`; `views/WorkspaceView`
  is lazy-loaded with a graceful catch fallback, persisted under
  `localStorage 'terrarium.panes'`, and takes an injectable `renderLeaf`.
- `terminal/` — `Terminal.tsx` (xterm.js host component), `mock-bridge.ts`
  (`MockPtyBridge` + `getPtyBridge()` — browser-dev stand-in implementing the
  same `PtyBridge` contract), `terminal.css`.
- `lib/diff.ts` — hand-rolled unified-diff parser (multi-file, renames,
  binary, `\ No newline`) → `DiffFile[]`; plus `InlineComment` model and
  `buildCommentBatch()` which turns a comment pass into one markdown message
  for the owning agent. `review/` has `DiffView`, `ReviewView`, `comments.ts`.
- `roster/` — crew management: `AgentCard`, `AgentEditor` (role picker, hue
  presets + slider), `CrewPicker`, `Onboarding` (project path + detected
  CLIs + crew draft), `defaults.ts` (`DEFAULT_CREW` mirrors the demo seed).
- `lib/store.ts` — one zustand store: `EngineState` projection + view chrome
  (`view`, `paletteOpen`, `selectedAgentId`, `focusAgentId`, `wikiPages`,
  `activePageId`); `openAgentTerminal(id)` jumps to the workspace view.
- Keyboard: `Ctrl/Cmd-K` palette, `Esc`, `g`+`o/b/t/w/i` view chords
  (`App.tsx`); first pointer/key gesture unlocks the audio context.

---

## 8. An end-to-end beat: assigning a card

1. Board `AssignMenu` → `getEngine().assignCard(cardId, agentId)`.
2. Preload → `ipcRenderer.invoke('engine:assign-card', …)`.
3. Main handler → `Engine.assignCard`: one tx — free previous assignee,
   `cards.status='doing'`, `agents.status='working'+task_id`, insert a `runs`
   row (`active`, worktree path, `agent/<slug>-<cardId>` branch), append a
   `card.move` event → `COMMIT`.
4. `EngineBus` → `'state'` snapshot → `webContents.send('engine:state')`.
5. Store `set(state)` → board row moves, office character sits down and
   starts typing, ticker shows "Laplace picked up …". One mutation, one push.

---

## 9. Known seams & drift (as of this writing)

The integration backlog — things that exist but don't yet line up:

1. **`workspaces/` vs `worktrees/`** — `engine/paths.ts` records
   `Run.worktreePath` under `~/.terrarium/workspaces/`; `git/worktrees.ts`
   manages `~/.terrarium/worktrees/`. The reconciler will never see
   engine-recorded paths. Pick one root (the decision is `worktrees/`).
2. **Wiki subsystem complete but uninstantiated** — `wiki/` (index.ts
   `WikiIndex`, `generate.ts`, `vault.ts`, `watcher.ts`) has no caller
   outside its own directory: `main/index.ts` never imports it, `wikiBus`
   has no subscribers, and `Engine.listWikiPages` still serves only the
   `docs` table. Wiring `WikiIndex` + `generate` + the FTS bridge is the
   remaining M2 piece.
3. **`--color-warning` undefined** — `WikiView` uses it for stale badges
   (3×); `styles.css` defines `--color-working` etc. but no `warning` →
   invisible stale indicators. Add the token or reuse `--color-working`.
4. **`window.prompt` in `CommandPalette`** (`New task card`) — unsupported
   in Electron, throws; needs a real input.
5. **`externalizeDepsPlugin` missing** — `pty-host.ts` imports `node-pty`
   and is a second main entry in `electron.vite.config.ts`; without
   externals config `pnpm build` will try to bundle a native module.
   Same for `chokidar` once `wiki/` is imported by main.
6. **Dead UI hooks** — `Engine.searchWiki` unused by `WikiView` (client-side
   title filter); Message/Terminal buttons (agent panel), Open diff (inbox),
   Regenerate stale pages (wiki) have no handlers.
7. **Repo hygiene** — stray `srcmain/`, `srcpreload/` empty dirs and a `nul`
   file (redirect artifact) at root; `out/` holds stale build output.
8. **Version skew to watch** — `@xterm/addon-webgl` pinned
   `0.20.0-beta.300` vs `@xterm/xterm ^6`; `@types/node ^22` vs Node 24
   runtime. Fonts (Inter/Geist Mono) referenced but not bundled — CSP allows
   `font-src 'self' data:` only, so today we render system fallbacks.

Resolved during the M2–M4 landings (kept as history): the
`createEngine` return-shape mismatch, `IPC`/`PTY_IPC` constants adopted on
both bridge sides, `engine:event` forwarding, the `'workspace'` view route
(`App.tsx` lazy-loads `WorkspaceView`), and `@shared` resolve aliases on all
three build targets.

---

## 10. Config & scripts

| file                     | role                                                        |
|--------------------------|-------------------------------------------------------------|
| `electron.vite.config.ts`| targets `out/main` (dual entry: `index` + `pty/pty-host`),  |
|                          | `out/preload`, `out/renderer`; `@shared` alias on all three |
| `tsconfig.json`          | strict, bundler resolution, paths `@shared/*` `@renderer/*` |
| `pnpm-workspace.yaml`    | allowBuilds + onlyBuiltDependencies: electron, esbuild,     |
|                          | node-pty (native builds)                                    |
| `package.json` scripts   | `dev` · `build` · `start` (preview) · `typecheck`           |

Dep usage today: `node-pty` (pty-host entry) and `@xterm/*` (terminal pane)
are live on real paths; `chokidar` + `gray-matter` are imported only by the
uninstantiated `wiki/` subsystem (§9.2); `croner` (M5 routines) is staged.
