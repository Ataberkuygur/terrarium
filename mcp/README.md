# terrarium-mcp

Model Context Protocol server for the **Terrarium** desktop app. It exposes a
running Terrarium instance — board, crew, wiki, terminals, browser panes,
activity feed — to any MCP client over a single-token HTTP bridge.

- Zero dependencies · single TypeScript file · ships as one `.exe`
- Protocol: MCP over **stdio** (newline-delimited JSON-RPC 2.0)
- MCP versions: `2024-11-05`, `2025-03-26`, `2025-06-18`
- No `atolye`/`matolye` branding anywhere — the file, package, and protocol
  name are all `terrarium-mcp`.

```
MCP client (Claude Desktop / Devin / Cursor / Windsurf)
        │  stdio JSON-RPC
        ▼
  terrarium-mcp.exe            ← this file, ~115 MB self-contained
        │  HTTP + Bearer token
        ▼
  Terrarium app  →  remote API on http://<host>:8795–8804
                    (src/main/mobile.ts — always token-gated)
```

---

## 1. Build

```bash
bun install -g bun        # once — bun 1.3+ required for --compile
pnpm mcp:build            # → dist/terrarium-mcp.exe   (Windows x64)
```

Equivalent bare command:

```bash
bun build --compile --minify mcp/terrarium-mcp.ts --outfile dist/terrarium-mcp
```

Cross-compile for a friend's Mac/Linux if ever needed:

```bash
bun build --compile --target=bun-darwin-arm64 terrarium-mcp.ts --outfile dist/terrarium-mcp-darwin-arm64
bun build --compile --target=bun-linux-x64    terrarium-mcp.ts --outfile dist/terrarium-mcp-linux-x64
```

`dist/terrarium-mcp.exe` is fully standalone — no Node/Bun install needed on
the recipient's machine.

## 2. Run

The exe needs a **running Terrarium app** to talk to.

| What the MCP needs | Default behaviour |
|---|---|
| API base URL | Auto-scans `http://127.0.0.1:8795..8804` |
| Auth token | Reads `%USERPROFILE%\.terrarium\mobile-token` |

Both machines on the same LAN? Point it at the app's LAN IP:

```
terrarium-mcp.exe --api http://192.168.1.42:8795 --token <token>
```

### CLI flags / modes

| Flag | Effect |
|---|---|
| *(none)* | MCP stdio server — what clients spawn |
| `--api <url>` | Skip scanning; use this base URL |
| `--token <t>` | Bearer token (else env/config/token file) |
| `--update-url <url>` | Manifest URL for `check_update` / `self_update` |
| `--doctor` | Print resolved config + probe the API, then exit |
| `--check-update` | Print `{current, latest, updateAvailable}` |
| `--self-update` | Download latest exe, stage the swap, exit |
| `--version` / `--help` |  |

### Config file

`terrarium-mcp.json` next to the exe **or** `~/.terrarium/mcp.json`
(exe-local wins):

```json
{
  "api": "http://192.168.1.42:8795",
  "token": "…",
  "updateUrl": "https://example.com/terrarium-mcp/latest.json"
}
```

### Environment variables

`TERRARIUM_API` · `TERRARIUM_TOKEN` · `TERRARIUM_MCP_UPDATE_URL`

Resolution order: **flag > env > config file > default**.

## 3. Register with an MCP client

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "terrarium": {
      "command": "C:\\tools\\terrarium-mcp.exe",
      "args": []
    }
  }
}
```

Same-shape config works for **Devin CLI**, **Cursor**, **Windsurf** —
`command` = path to the exe, `args` = optional flags.

Run `--doctor` once by hand to confirm the app is reachable before wiring it
into a client.

## 4. Tool surface

| Tool | What it does |
|---|---|
| `terrarium_status` | Version + connectivity report; API base, app version, token source, which backends are live. **Call first.** |
| `get_office_state` | Full snapshot — agents, cards, runs, projects, events. |
| `list_events` | Recent activity feed (card moves, run logs, status changes). |
| `list_cards` | Board cards, filter by `status` / `assignee`. |
| `get_card` | One card by id. |
| `create_card` | New card — `title` + optional `body`, `priority`, `dueAt`, `status`, `assignee`. |
| `update_card` | Patch `title`/`body`/`priority`/`dueAt` (`null` clears the date). |
| `move_card` | Move to `backlog`/`ready`/`doing`/`review`/`done`. |
| `assign_card` | Assign to an agent → moves to `doing`, opens a run + worktree. |
| `delete_card` | Delete card; runs cascade, assignee freed. |
| `list_agents` | Crew roster — status, task, desk, sleeping. |
| `upsert_agent` | Create/update a crew member. |
| `remove_agent` | Remove agent; their cards become unassigned. |
| `nudge_agent` | Message an agent — feed event + wakes `waiting` agents. |
| `list_wiki_pages` | Page index (`query` → full-text search). |
| `get_wiki_page` | Page incl. markdown body + backlinks. |
| `save_wiki_page` | Overwrite body; `[[wikilinks]]` re-derive the graph. |
| `terminal_list` | Pty sessions — command, cwd, cols/rows, status, exitCode. |
| `terminal_spawn` | Spawn a pty (survives app restarts via the 8794 supervisor). |
| `terminal_write` | Raw input; `enter:true` appends `\r`. |
| `terminal_read` | Tail of the 256 KB scrollback ring; `stripAnsi` default true. |
| `terminal_resize` | Resize cols×rows. |
| `terminal_kill` | Terminate a session. |
| `pane_command` | Browser-pane bridge vocabulary: `ping help tabs newtab nav activate close cdp eval dl ws spawn split focus bind write ratio layout`. |
| `orchestrator_info` | The caller's orchestration network (or `net` / `all:true`): orchestrator + subagents with index, name, CLI, task, status `busy/idle/starting/exited`. |
| `orchestrator_spawn` | Tether new subagent terminal(s) — `command` (CLI), `title`, `task` (first prompt, typed once the CLI booted), `count`. |
| `orchestrator_send` | Type into a subagent (`agent` = index / name / id / `"orchestrator"`); waits for a fresh subagent to boot. |
| `orchestrator_ask` | Send + wait until quiet (`idleSec`) + return the rendered screen — one round-trip. |
| `orchestrator_read` | Rendered screen text of a subagent (TUI redraws resolved, not raw bytes). |
| `orchestrator_wait` | Block until a subagent / `all` has been quiet for `idleSec` (bounded, `done:false` = still working). |
| `orchestrator_kill` | End a subagent (its card leaves the web). |
| `check_update` | Compare against the update manifest. |
| `self_update` | Download + stage the exe swap (see §6). |

### Orchestration networks

Workspace → **Orchestrate** turns the pane grid into tabbed networks: one
orchestrator terminal in the middle, subagent terminals tethered around it.
Every network terminal carries `TERRARIUM_SID`, `TERRARIUM_NET`,
`TERRARIUM_ROLE` and `TERRARIUM_WS_CMD`, so an MCP server started *from* the
orchestrator (e.g. Claude Code's) talks to its own network with no
arguments — the `orchestrator_*` tools hit the loopback bridge directly and
need no token. The same verbs exist as the `tnet` CLI (installed into
`~/.terrarium/bin`, on network terminals' PATH) and as raw `net.*` commands on
`POST $TERRARIUM_WS_CMD` (`{"cmd":"net.help"}` lists them).

### Resources (read-only URIs)

`terrarium://state` · `terrarium://cards` · `terrarium://agents` ·
`terrarium://events` · `terrarium://terminals` · `terrarium://wiki` ·
`terrarium://wiki/<pageId>` · `terrarium://info`

## 5. Remote API reference (inside the app)

`src/main/mobile.ts` binds `0.0.0.0:8795–8804` (first free port) and requires
the token on every `/api/*` route — via `Authorization: Bearer` or `?k=`.

| Method + path | Purpose |
|---|---|
| `GET /api/info` | app name/version + live backends |
| `GET /api/state` | full EngineState |
| `GET /api/events?limit=` | event feed |
| `GET /api/cards?status=&assignee=` | card list |
| `GET /api/cards/:id` · `POST /api/cards` · `PATCH /api/cards/:id` · `DELETE /api/cards/:id` | card CRUD |
| `POST /api/cards/:id/move` `{status}` | column move |
| `POST /api/cards/:id/assign` `{agentId}` | assign + open run |
| `GET /api/agents` · `POST /api/agents` · `DELETE /api/agents/:id` | crew |
| `POST /api/agents/:id/nudge` `{message}` | nudge |
| `GET /api/wiki?projectId=&q=` · `GET|PUT /api/wiki/:pageId` | wiki |
| `GET|POST /api/terminals` · `…/:sid/read|write|resize|kill` | pty bridge |
| `POST /api/pane` | pane-bridge proxy (loopback → 8791+) |
| `GET /` (no auth) | mobile web UI |

## 6. Updating remotely

The update flow is a **version manifest + self-swap**:

### Publish a release

1. Bump `VERSION` in `mcp/terrarium-mcp.ts` and `mcp/package.json`.
2. `pnpm mcp:build` → `dist/terrarium-mcp.exe`.
3. Upload the exe somewhere HTTPS-reachable (GitHub Release asset, S3, your
   server) and publish a manifest next to it:

```json
{
  "version": "1.1.0",
  "notes": "new pane tools + faster discovery",
  "files": {
    "windows-x64": {
      "url": "https://github.com/<you>/terrarium/releases/download/mcp-1.1.0/terrarium-mcp.exe",
      "sha256": "<sha256 of the exe>"
    }
  }
}
```

`sha256` is verified before swap when present.

### Friend-side: point the MCP at the manifest once

- `terrarium-mcp.json` next to the exe → `"updateUrl": "https://…/latest.json"`, **or**
- env `TERRARIUM_MCP_UPDATE_URL`, **or**
- flag `--update-url`.

### Then updating is one call

- From any MCP client: run `check_update`, then `self_update`.
- Or by hand: `terrarium-mcp.exe --self-update`.

`self_update` downloads to `terrarium-mcp.exe.new.exe` (sha256-checked),
writes a tiny `update-*.bat` that waits for the running process to exit,
moves the new exe into place, and self-deletes. The MCP client just needs to
restart the server — the next spawn runs the new version.

**No manifest configured?** `check_update`/`self_update` say so and the only
path is sending a new exe by hand — configure `updateUrl` once and you never
have to re-send binaries.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `no Terrarium remote API found on 127.0.0.1:8795-8804` | App not running, or `--api` needed (remote machine). |
| `forbidden — bad or missing token` | Token mismatch — copy `~/.terrarium/mobile-token` from the app machine or pass `--token`. |
| Tools list empty in client | Client spawned the exe but app is down — check stderr, run `--doctor`. |
| `pane_command` → `bridge not listening` | The app must have the **Workspace** view open (bridge mounts while it's active). |
| `terminal_*` → `pty host unavailable` | The detached pty supervisor isn't up — it starts with the app; check port 8794. |

All logs go to **stderr** — stdout is reserved for protocol frames.
