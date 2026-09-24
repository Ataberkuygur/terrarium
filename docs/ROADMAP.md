# ROADMAP — Terrarium milestones

Six phases. Each lists scope + exit criteria. Drift items reference
`ARCHITECTURE.md` §9 seam numbers.

---

## M1 — Shell, office, board, wiki (mock) ✅ done

Electron shell with custom titlebar + CSP, the R3F diorama office, kanban-ish
board, wiki view, inbox, command palette — all driven by the in-renderer mock
engine behind the `Engine` interface.

- [x] `src/main` window + `src/preload` bridge skeleton
- [x] `office/` procedural scene: desks, characters, status→visual mapping
- [x] `views/` Office · Board · Wiki · Inbox; zustand store; g+letter chords
- [x] `lib/mock-engine.ts` + `seed.ts` demo office; `markdown.tsx` renderer
- [x] Design tokens (`styles.css @theme`) + office palette

**Exit:** `pnpm dev` shows a living office in mock mode; `pnpm typecheck` clean.

---

## M2 — Real engine: SQLite + IPC 🚧 nearly done

`main/engine/` — `node:sqlite` record, migrations, EngineBus, seed; preload
bridge wrapping invoke/push channels; main registers handlers and forwards
`engine:state` / `engine:event` to all windows.

- [x] `engine/schema.ts` migration 1 (meta→docs+docs_fts, FTS5 triggers)
- [x] `engine/db.ts` WAL + migration runner · `bus.ts` · `seed.ts` port ·
      `paths.ts` `~/.terrarium` layout
- [x] `engine/engine.ts` `Engine implements Engine` (tx mutations → publish)
- [x] `preload` engine bridge on `IPC` constants; `main/index.ts` handler
      registration + `subscribe`/`onEvent` broadcast; `before-quit` close
- [x] `shared/ipc.ts` channel constants — adopted on both sides
- [x] `wiki/` subsystem built: `WikiIndex` cache, `generate.ts` structural
      pages, `vault.ts`, `watcher.ts`, `frontmatter.ts`
- [x] **Seam §9.2 — wiki subsystem instantiated**: `initWiki` +
      `generateStructuralPages` in `main/index.ts`; vault failure falls back
      to engine `docs` table; `wiki:changed` broadcasts to the renderer
- [x] **Seam §9.3** — `--color-warning` defined in `styles.css`
- [ ] **Seam §9.4** — replace `window.prompt` in CommandPalette
- [x] **Seam §9.6** — `searchWiki` wired into WikiView (local filter + FTS)
- [ ] Bump `@types/node` → ^24

**Exit:** app runs on `app.db` end-to-end in Electron; mock still works in a
browser; restart preserves state; vault ↔ index ↔ FTS loop live.

---

## M3 — pty-host + workspace panes 🚧 nearly done

VS Code-pattern terminal hosting + the workspace view.

- [x] `shared/pty.ts` — `PTY_IPC` channels, `PtyBridge`, `PtyEvent`,
      `PTY_ATTACH_RESET_SEQ`
- [x] `main/pty/` — `pty-host.ts` (utilityProcess, 16KB/8ms batching, 256KB
      scrollback ring, replay-on-attach, Windows shim resolution) +
      `manager.ts` (id-correlated RPC, crash → dead sessions, re-fork) +
      `protocol.ts` + `log.ts`
- [x] `preload` pty bridge — single EVENT channel fanned to per-session subs
- [x] `lib/panes.ts` binary-split tree + `workspace/` PaneHost·Divider·
      EmptyPane + `views/WorkspaceView.tsx` (lazy-loaded, localStorage
      persistence) + `terminal/` Terminal·MockPtyBridge
- [x] **Seam §9.5** — `externalizeDepsPlugin` added; `pnpm build` green
- [ ] Re-pin `@xterm/addon-webgl` off `0.20.0-beta.300` (seam §9.8)
- [ ] Bind sessions to runs: spawn agent CLI on assign, record session id
      (schema `sessions` table is ready); `openAgentTerminal` → attach flow
- [x] Dead buttons: Message/Terminal in agent panel → `openAgentChat` /
      `openAgentTerminal` (chat + browser pane kinds, agent-bound)
- [x] Layout presets + named saved layouts (`workspace/LayoutMenu`,
      `panes.ts` PRESETS; leaf `command` binds a CLI to a pane)
- [x] Clipboard image watcher → `ClipPeek` edge slide-in (attach → `updateCard`)
- [x] Sleeping agents: idle >90s → doze; terminal I/O → `touchAgent` wakes
- [x] Camera containment: bounded OrbitControls + focus glide
- [ ] Verify flood behavior: size-bounded batching shipped instead of acks
      (D3 note) — watch for stalls under `yes`-class output

**Exit:** spawn `claude` in a pane, reload the window, terminal still alive;
kill pty-host, office survives; `pnpm build` green.

---

## M4 — Worktrees + diff review loop 🚧 in flight

- [x] `git/git.ts` spawn wrapper · `detect.ts` CLI/WSL probe ·
      `worktrees.ts` create/reconcile/remove/lock lifecycle
- [x] `wt:*` + `agents:detect` IPC handlers registered in main
- [x] `lib/diff.ts` parser + `review/` DiffView·ReviewView·comments
- [x] **Seam §9.1** — single `worktrees/` root under `~/.terrarium/`
- [ ] `wt:*` preload bridge + surface the reconciler in UI
- [ ] Assign→provision: run creation calls `worktrees.create`, records real
      path/branch in `runs`
- [ ] Inbox "Open diff" → `ReviewView` (seam §9.6); inline comments →
      `buildCommentBatch` → `nudgeAgent`; approve → merge + recycle worktree
- [ ] Reconciler tick → `worktrees` table registry + `system` events

**Exit:** a card assignment produces a real worktree; its diff is reviewable
in-app; comments reach the agent; merge recycles the worktree.

---

## M5 — Routines + plugin gateway 📋

- [ ] `routines` table is live (schema done) — `croner` scheduler in main:
      cron → card template → `createCard`
- [ ] Agent runner: spawn detected CLIs (`git/detect.ts` results) into pty
      sessions bound to runs; turn run.waiting ↔ inbox round-trip into real
      blocking prompts
- [ ] Plugin gateway: narrow host API for agent tools (read wiki, post event,
      request review) — designed so a plugin can't reach raw fs/shell
- [ ] Agent homes (`~/.terrarium/agents/<slug>/`) — memory files written by runs

**Exit:** a cron routine lands a card, an agent CLI picks it up, works in its
worktree, asks for review, merges clean.

---

## M6 — Polish + distribution 📋

- [ ] electron-builder + NSIS (per-user install, stable `guid`,
      `asarUnpack` for node-pty); code signing decision (OV cert vs unsigned
      beta); tighten CSP `script-src` for prod (drop `unsafe-inline`)
- [ ] Bundle fonts (Inter + Geist Mono) or commit to system stack
- [ ] macOS/Linux pass: `titleBarOverlay` semantics, `where.exe`→`which`,
      ConPTY→forkpty paths
- [ ] Perf: office scene remount cost on view switch, event cap trim,
      snapshot debounce under flood
- [ ] Repo hygiene (seam §9.7): delete `srcmain/`, `srcpreload/`, `nul`;
      stop tracking `out/`
- [ ] Onboarding flow wiring (`roster/Onboarding.tsx` → first-run path)

**Exit:** signed NSIS installer; cold start → seeded office in <3s;
`pnpm typecheck` + `pnpm build` + smoke run green on a clean machine.

---

## Invariant checklist for every milestone

- `pnpm typecheck` clean; `pnpm dev` runs in Electron **and** browser-mock.
- Engine interface unchanged or versioned — renderer never reaches around it.
- Office still deterministic; no new raw hex outside token files; no new deps
  without a DECISIONS.md entry.
- Locks honored, nothing deleted outside the managed root.
