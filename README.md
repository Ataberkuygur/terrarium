# Terrarium

**An agent space for AI coding CLIs.** Run Claude Code, Codex and friends side by
side in terminal panes, see at a glance which agent needs you, and watch the crew
work in a 3D office.

- **Workspace**: split-pane terminals and browser panes, layout presets, a session
  rail, and a command palette (`Ctrl+K`). Terminal sessions survive app restarts
  and updates: they live in a detached pty supervisor.
- **Attention first**: agents that are waiting for input, done or failed surface
  on their own, so you jump straight to the pane that needs you.
- **Tasks board**: describe outcomes, assign them to agents, track runs.
- **Wiki**: project knowledge that builds itself from your repo.
- **Office**: a living 3D diorama (city → HQ tower → department floors, loft or
  Avengers theme) where every agent is a character at a desk.
- **Mobile + MCP**: a LAN phone UI and a `terrarium-mcp` server so other agents
  and MCP clients can drive Terrarium.

> Windows-first. The app is Electron + React 19 + TypeScript + React Three Fiber,
> with node-pty/xterm.js for terminals and `node:sqlite` for state.

## Install

1. Download the latest `Terrarium-Setup-x.y.z.exe` from
   [Releases](https://github.com/Ataberkuygur/terrarium/releases/latest).
2. Run it. Windows SmartScreen may warn because the build isn't code-signed:
   click **More info → Run anyway**.
3. Open Terrarium from the Start menu or the desktop shortcut.

### Updates

Terrarium checks GitHub Releases on launch and every 30 minutes. When a new
version exists, a **New update available** card appears in the bottom-left
corner and the download starts in the background. Click **Update** (or
**Restart & update**) and Terrarium restarts into the new version. Your
terminals, layouts and data stay as they were.

## Your data

Everything lives on your machine:

| What | Where |
| --- | --- |
| Office record (tasks, agents, events) | `~/.terrarium/app.db` |
| Wiki vaults, logs, clipboard, voice runtime | `~/.terrarium/` |
| UI state (layouts, departments, settings) | `%APPDATA%\terrarium` |

Updating or reinstalling never touches these folders.

## Develop

Requirements: Node 22+, [pnpm](https://pnpm.io) 11, and
[Bun](https://bun.sh) (only for building the MCP executable).

```bash
pnpm install
pnpm dev            # Electron + Vite HMR (renderer at http://localhost:5173)
pnpm typecheck
pnpm dist:win       # local installer → release/Terrarium-Setup-<version>.exe
```

The renderer also runs in a plain browser at `http://localhost:5173`, where it
uses a mock engine and a mock terminal bridge.

Read [`AGENTS.md`](AGENTS.md) before hacking on Terrarium from *inside*
Terrarium: it explains which edits hot-reload and which restart the app.
Architecture notes live in [`docs/`](docs/).

### Releasing

Every push to `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml).
It builds the Windows installer and publishes a GitHub Release numbered
`<major>.<minor>.<run number>`, and installed copies offer it as an update.
Pushes that change only docs or Markdown don't trigger a release. Bump
major/minor in `package.json` when you want a bigger version jump.

## License

[MIT](LICENSE) © Ataberk Uygur
