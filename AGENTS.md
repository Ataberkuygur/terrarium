# Terrarium — agent working agreement

You are very likely running **inside** the app you are editing: your terminal is a
pane in Terrarium itself. A careless command can kill your own session. Follow these
rules so you never block yourself.

## Terminal sessions survive app restarts — by design

`src/main/pty/` runs ptys in a **detached supervisor** (not in the Electron
process):

- `pty-host.ts` serves the spawn/attach/write/resize/kill/list protocol over
  newline-delimited JSON on `127.0.0.1:8794` (env `TERRARIUM_PTY_HOST_PORT`).
- It is spawned via `ELECTRON_RUN_AS_NODE` + `detached` — it does NOT die when
  the app exits. On next launch the manager reconnects, `list()` resyncs, and
  each terminal pane re-attaches and replays its scrollback ring (256 KB).
- If the socket is unreachable the manager falls back to `utilityProcess.fork`
  (the old behaviour; sessions then die with the app — only a degraded mode).
- The supervisor self-exits after ~15 min with zero sessions AND zero clients.
  Logs: `~/.terrarium/pty-host.log`.
- **Never kill a process listening on 8794** unless you intend to orphan every
  pane session, including the one you are typing in.

## What kills what

| Action | Effect |
|---|---|
| Edit `src/renderer/**` | Vite HMR/live-reload — app window repaints, panes stay |
| Edit `src/main/**`, `src/shared/**` | Nothing until the app restarts (no watch by default) |
| `pnpm typecheck`, `pnpm build` | Safe while app runs — writes `out/`, doesn't touch the running process |
| App restart / `pnpm dev` re-run | Electron exits; **pty sessions survive** via supervisor; panes re-attach |
| `electron-vite dev -w` | Rebuilds+restarts Electron on every main edit — avoid unless asked |

## Dev modes

- `pnpm dev` — normal: renderer HMR live; main changes apply on next manual
  restart.
- `pnpm dev:stable` — `electron-vite build && electron-vite dev --rendererOnly`:
  zero restart risk; main runs from the last build.

## Verify without breaking

- `pnpm typecheck` / `pnpm build` — always safe.
- `http://localhost:5173` — renderer dev server (Playwright-inspectable).
- `http://127.0.0.1:8791/cmd` — pane bridge (mounted only while WorkspaceView
  is active).
- `http://<lan-ip>:8795` — mobile control (token in `~/.terrarium/mobile-token`).
- Before restarting the app: confirm the supervisor is up
  (`Test-NetConnection 127.0.0.1 -Port 8794`). After restart, panes restore
  automatically.

## Orchestration networks

- State: `src/renderer/src/lib/orchestration.ts` (zustand, persisted to
  `terrarium.orchestration`). One tab = one network = orchestrator + subagents.
  Node ids start with `net-`; the workspace orphan reaper skips them.
- Control: `net.*` commands on the pane bridge (`/cmd`), wrapped by the `tnet`
  CLI (`src/main/tnet.cjs`, installed to `~/.terrarium/bin` at launch) and the
  MCP `orchestrator_*` tools. Quick test from any terminal:
  `curl -s $TERRARIUM_WS_CMD -d '{"cmd":"net.list"}'`.
- `net.new` never steals the user's screen; clean up test networks with
  `{"cmd":"net.close","net":"<name>"}`.
- Networks carry an optional `topic` shown as "Web 1: Senior loop" (tab
  double-click, `net.topic` / `tnet topic` / MCP `orchestrator_topic`).
- Two layouts (`useOrch.layout`, toolbar switch): **Canvas** (pan/zoom web,
  `layout.ts` slots) and **Workspace** (`tileNetwork` — hub centred, agents
  tiled left → right → top → bottom, then top/bottom/left/right per round;
  the hub keeps a fixed centred rect, empty bands stay reserved).
- Canvas pan/zoom (`lib/canvas-nav.ts`) is semantic: layout at `rect * z`,
  terminals get `zoom` (font scales, grid held — no pty resize). App-wide zoom
  is owned by main (`src/main/app-zoom.ts`, Ctrl+= / Ctrl+- / Ctrl+0).
