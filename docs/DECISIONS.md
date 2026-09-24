# DECISIONS — Terrarium ADR log

Numbered, append-only. Each entry: context → decision → consequences → what we
rejected. Status: ✅ adopted · 🧭 adopted-partially (landed, seams open) ·
📋 decided-not-yet-built.

---

## D1 — Electron over Tauri ✅

**Context.** The app's core is hosting agent CLI sessions in real terminals.
That means battle-tested PTY + terminal-emulator ecosystems, not just a webview.

**Decision.** Electron 44 (Node 24) + node-pty + xterm.js.

**Why.** node-pty ships N-API prebuilds and bundles ConPTY (1.23-era) on
Windows — real pseudoconsole behavior, not a pipe pretending. xterm.js has a
mature addon ecosystem we already need: `addon-fit`, `addon-search`,
`addon-serialize` (headless scrollback replay), `addon-webgl` (GPU renderer).
Tauri's PTY story is immature: `portable-pty` lacks modern ConPTY flags and
`tauri-plugin-pty` is 0.3, single-maintainer. Electron also gives us
`utilityProcess` (D3) and a packaging path (electron-builder) with no Rust
toolchain in the loop.

**Rejected.** Tauri 2 (PTY ecosystem, immature); plain terminal-multiplexer
UX (not an office); VS Code extension (wrong surface — we want a desk, not an
editor sidebar).

**Cost.** Bundle size (~200MB installed class) and the Chromium tax —
accepted; this is a workstation app, not a menubar toy.

---

## D2 — `node:sqlite` over better-sqlite3 ✅

**Context.** The office record (agents/cards/runs/events/docs) needs a local,
transactional, searchable store.

**Decision.** `node:sqlite` (`DatabaseSync`), WAL, numbered migrations via
`PRAGMA user_version` (`src/main/engine/db.ts`, `schema.ts`).

**Why.** Zero native rebuilds — it's in the Node 24 runtime Electron 44 ships,
so there is no `electron-rebuild` step and no ABI chase across Electron
upgrades. FTS5 is compiled in — `docs_fts` gives wiki search without a second
dependency. Synchronous API fits our model: mutations are short transactions
on the main process; there's no query load that justifies an async driver.

**Rejected.** better-sqlite3 (native module, rebuild per Electron bump — the
exact tax we removed); Prisma/Drizzle (ORM ceremony for ~10 tables);
plain JSON files (no FTS, no transactions, no queryable record — see D5).

**Watch.** `node:sqlite` stabilized in Node 24; if we ever pin Electron to a
Node <22.5 line this decision inverts — it won't, D1 fixed the floor.

---

## D3 — pty-host as a `utilityProcess` (VS Code pattern) ✅

**Context.** Agent sessions are loud, long-lived child processes. A PTY flood
or a node-pty crash must never freeze or kill the UI.

**Decision.** A dedicated `utilityProcess` fork owns every `node-pty`
session. Landed in `src/main/pty/`: `pty-host.ts` (batches output at 16KB /
8ms, 256KB ring buffer per session, replay-on-attach with
`PTY_ATTACH_RESET_SEQ`, `where.exe`+`cmd.exe /d /s /c` Windows shim
resolution), `manager.ts` (id-correlated RPC, 15s timeout, session registry,
host-exit → sessions marked `dead`, lazy re-fork), `protocol.ts` (wire
types), `log.ts`. Renderer contract: `shared/pty.ts` (`PTY_IPC`,
`PtyBridge`); preload fans the single `EVENT` channel into per-session
`onData/onReplay/onExit/onStatus`.

**Why.** Crash isolation (host dies → UI lives; sessions marked dead, next
spawn re-forks) and renderer-reload survival (scrollback lives host-side —
the whole point). This is the architecture VS Code converged on after
running terminals in-process and eating the consequences.

**Rejected.** node-pty in main directly (a native crash takes the app);
node-pty in renderer (worse, plus CSP/sandbox friction); tmux dependency
(not on Windows; ConPTY is the native answer).

**Note.** Research assumed ack-based backpressure; implementation uses
size/time-bounded batching (16KB/8ms) — simpler, adequate at our scale. Add
acks only if a flood-stall ever reproduces.

---

## D4 — Worktree-per-task, outside the repo, locks honored 🧭

**Decision.** Every run gets `git worktree add -b agent/<task-slug>` under
`%USERPROFILE%\.terrarium\worktrees\<project>\<task>` — deliberately outside the
user's checkout and deliberately under `%USERPROFILE%` (not AppData) to keep
paths short against `MAX_PATH=260`.

**Why.** Isolation without touching the user's working tree, index, or git
config. Outside-the-repo means a `git clean`/`worktree prune` habit or an IDE
on the main checkout can't stumble into our bookkeeping; it also keeps agents
off the user's uncommitted work. `git worktree lock --reason` is honored and
**never overridden** — `remove()` returns the lock reason to the caller
instead of forcing through (`worktrees.ts`). Reconcile classifies drift
(`active|dirty|orphaned|stranded|foreign`) and `foreign` paths are never
touched. Unborn repos are bootstrapped with an empty plumbing commit rather
than mutating user state.

**Rejected.** In-repo `.worktrees/` (pollutes the user's tree, hits ignore
rules); branch-per-task on the main checkout (no isolation); clone-per-task
(huge, slow); containers (Windows-first app — WSL optional, never required).

**Open.** Engine currently writes `Run.worktreePath` under `workspaces/`
while the manager roots at `worktrees/` — unify on `worktrees/`
(ARCHITECTURE §9.1).

---

## D5 — Files vs DB: record in SQLite, artifacts on disk ✅

**Decision.** `app.db` = the queryable office record (who/what/when, events,
index). Files = artifacts: the wiki vault (`.md`), agent homes, logs —
everything a human might open in another tool.

**Why.** Each store does what it's good at: SQL gives us transactions, FTS,
and snapshots; files give us Obsidian-compat, git-diffable, agent-readable
artifacts. Never embed file contents in SQL blobs or re-derive the record by
parsing markdown — the DB indexes the files (`source_files`, links, stale)
without owning them.

**Rejected.** DB-only wiki (locks knowledge inside our app — the vault must
be openable in Obsidian); files-only record (no transactions, no FTS, races).

---

## D6 — The office is a procedural R3F diorama, not pixel art ✅

**Decision.** React Three Fiber low-poly scene, every mesh procedural
(primitives + `RoundedBox`), every texture canvas-painted. Lighting: cool
night ambient + warm pendant practicals + monitor glow; post = SMAA + bloom +
vignette + contact shadows.

**Why.** Zero asset-licensing risk, zero fetch-at-runtime, and a premium look
that pixel art can't hit at this fidelity. Procedural = deterministic (D11)
and infinitely tunable from state — a desk lamp can literally carry run
status. Bloom + DOF-adjacent vignette is where the "premium" lives.

**Rejected.** Pixel-art tile office (asset burden, capped ceiling, licensing);
spline/GLTF scenes (asset pipeline for v1 is dead weight); video loops
(not state-driven).

---

## D7 — Monochrome chrome + hue reserved for state ✅

**Decision.** Cool-neutral ramp (`n1–n12`), signal-amber accent `#F5A524` for
brand/actions only, and a small status-hue vocabulary
(`working/needs/done/monitor/error/info`). Agent identity is a per-agent
`hsl(hue)` — the only "free" color in the system. All colors are tokens
(`styles.css @theme`, `office/palette.ts`); raw hex in components is a review
violation.

**Why.** Hue is information bandwidth — spend it on state, not decoration.
Monochrome chrome is what keeps six glowing desks calm instead of carnival.

**Ban list ("no AI slop").** No purple gradients, no glow shadows, no
`rounded-2xl` blob cards, no decorative emoji, no glass-on-glass. These read
as generated-template slop and are banned in review.

---

## D8 — Wiki = vault files on disk, Obsidian-openable 🧭

**Decision.** `~/.terrarium/vaults/<project>/` is a real Obsidian vault: kebab
`.md` files, YAML frontmatter, `[[wikilinks]]`. Generated sections live inside
`<!-- AUTOGEN:name -->` markers so regeneration splices around human prose.
Pages carry `source_files`; a repo watcher marks pages `stale` when their
sources change → freshness badges in the UI. The graph view is **local**
(active page + neighbors) — a deliberate rejection of the global hairball
that impresses once and helps never.

**Why.** The wiki is a teaching artifact — it must outlive the app and be
editable in real tools. AUTOGEN markers let agents regenerate without
destroying human annotation; staleness makes docs honest.

**Rejected.** DB-stored pages rendered only in-app (walled garden);
global graph view (hairball); regenerate-in-place without markers
(clobbers humans).

**Open.** The full subsystem landed (`WikiIndex` metadata cache, `generate.ts`
structural pages, `vault.ts`, `watcher.ts`, `wikiBus` → FTS loose coupling)
but nothing instantiates `WikiIndex` yet — engine wiki reads still hit only
the `docs` table, and `searchWiki` isn't wired into the view
(ARCHITECTURE §9.2/§9.6).

---

## D9 — Engine pushes snapshots; renderer never polls ✅

**Decision.** Single `Engine` interface; every mutation is a transaction that
ends in a full `EngineState` push (`engine:state`) plus per-event pushes
(`engine:event`) for the ticker. The store is a projection; views are pure.

**Why.** One data direction means no cache invalidation problem, no loading
flags scattered in views, and the mock engine is a drop-in (same interface,
in-memory + `structuredClone`). Snapshot cost is trivial at office scale
(≤200 events, dozens of rows).

**Rejected.** Differential patches (complexity for no win at this size);
tRPC/REST-style per-view fetching (N waterfalls, drift); GraphQL (…no).

---

## D10 — `src/shared` is dependency-free, alias-backed ✅

**Decision.** `shared/` carries the cross-process contract: domain types
(`types.ts`), IPC channel constants (`ipc.ts`), the pty bridge protocol
(`pty.ts`). `@shared` is a `resolve.alias` on all three electron-vite targets
(main, preload, renderer) so value imports are legal — but shared must never
import `node:*` or DOM APIs, or it breaks one of the three builds.

**History.** M1 ran an implicit "types-only" rule — the alias didn't exist and
`@shared/*` resolved only because every import was `import type` (erased at
compile). The alias landed when real shared constants were needed; the rule
was upgraded from "types-only" to "dependency-free".

---

## D11 — The office is deterministic: state in, pixels out ✅

**Decision.** `EngineState` → scene is a pure function (modulo wall-clock
animation). No `Math.random()` in appearance code: character looks come from
`hashId(agent.id)`, the skyline from a seeded LCG, monitor content from
desk-seeded drawing.

**Why.** The office is a trust surface — if it looks different each launch it
reads as decoration; if it's stable it reads as *the office*. Determinism also
makes visual bugs reproducible.

**Scope note.** `Math.random` is allowed for non-visual entropy (audio pitch
jitter, id suffixes) — never for layout, color, or placement.

---

## D12 — Mock fallback renderer-side; fail-fast main ✅

**Decision.** The renderer's `getEngine()`/`getPtyBridge()` fall back to
`mock-engine.ts` + `MockPtyBridge` when `window.terrarium` lacks a bridge — the
entire app runs in a plain browser for design iteration. Main, by contrast,
**statically imports** all subsystems at `whenReady` and fails fast: a broken
engine/pty import should crash at boot, not silently half-register.

**Why.** M1 needed the office+mock to ship before any main code; the browser
fallback keeps `pnpm dev` (renderer-only) usable for UI work forever. The
fail-fast side came later: an intermediate version lazy-`tryImport`ed
subsystems so missing modules degraded silently — that masked a real
contract mismatch (an invoke-side crash surfacing as a hung loading screen).
Explicit crash > silent absence for infrastructure this central.

**Watch.** Bridge presence ≠ handler health: `getEngine()` tests
`window.terrarium.engine` existence, not a working `getState`. A half-wired
main still hangs the renderer on the loading dot rather than falling back.

---

## D13 — Procedural audio, felt-not-heard ✅

**Decision.** All sound is synthesized Web Audio (`lib/audio.ts` singleton
context gated on user gesture + localStorage prefs; `sfx.ts` one-shots;
`ambience.ts` room bed ≤0.06 gain). No audio assets.

**Why.** Same licensing/determinism argument as the visuals (D6/D11); a few
enveloped oscillators read as "alive office" without a single sample file.
Respects `document.visibilityState` — the office doesn't bell from a hidden
window.

---

## D14 — Hand-rolled markdown + diff, no heavy deps ✅

**Decision.** `lib/markdown.tsx` renders the wiki's subset (headings, tables,
fences, `[[links]]`, mermaid-as-pre); `lib/diff.ts` parses unified diffs into
a typed model + inline-comment batching.

**Why.** Our markdown surface is deliberately small and link-shaped
(`[[id|alias]]`); a full unified-diff parser is ~200 lines and we control
edge cases (renames, binary, no-EOL) — both avoid pulling react-markdown +
a diff library for two narrow jobs.

**Rejected.** react-markdown + remark ecosystem (weight vs. surface);
`diff2html` (styling mismatch, another rendering system to tame).

---

*Append new decisions at the end. Never edit history — supersede with a new
ADR that references the old one.*

## D15 — Daylight loft: category zones over uniform desks ✅

**Decision.** The office is a single daytime loft partitioned by
`AgentDomain` (general·frontend·backend·design·research·marketing·legal) —
each zone owns desk spots, rug tint, accent, and prop sets
(`office/layout.ts` ZONES). Lighting is sun + hemisphere, not night
practicals; ACES tone mapping + bounded bloom.

**Why.** Category-at-a-glance is the differentiator vs. Cursor/Codex-style
lists: you read crew health from space, not a table. Zones keep prop cost
bounded (shared geometry per prop type) while making 9 desks scannable.

**Watch.** New domains require a zone entry or agents land in `general`.

---

## D16 — Sleep is derived, never stored ✅

**Decision.** `Agent.sleeping` is computed at read time
(`status==='idle' && now-lastActiveAt > 90s`), not persisted. Terminal I/O
calls `touchAgent` (throttled 1/2s/agent) to bump `last_active_at`.

**Why.** A stored flag drifts (crash mid-doze → forever-asleep zombie).
Derivation keeps wake semantics atomic with any activity write.

---

## D17 — Workspace layouts: presets + named saves, leaf-bound commands ✅

**Decision.** `panes.ts` PRESETS give one-click layouts (Solo/Split/Grid/
Code+Terminal/Watch); `LayoutMenu` persists named trees to localStorage.
A leaf's `command` field binds a CLI — sessionId incorporates the command
so changing it starts a fresh PTY rather than silently reattaching.

**Why.** Saved layouts without bound commands restore geometry but not
intent; binding the command makes a layout a *workspace*, not a shape.

---

## D18 — Webview panes, clipboard peek, chat leaves ✅

**Decision.** `browser` leaf kind uses `<webview>` (Electron) with a
same-origin iframe fallback in mock mode; `chat` leaves thread
engine events + optimistic messages per agent. Main polls the clipboard
for images → `clipboard:image` push → `ClipPeek` edge card → save to
`~/.terrarium/clipboard/` or attach to a card via `updateCard`.

**Why.** Research-while-supervising stays in-app; screenshots stop being
lost clipboard state. Webview isolates guest content from the app shell.
