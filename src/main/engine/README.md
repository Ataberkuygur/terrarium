# engine/ — Terrarium persistence engine

The real backend behind the renderer's `Engine` interface (`src/shared/types.ts`).
Zero native deps: `node:sqlite` (Electron 44 → Node 24, FTS5 included) + `node:fs` + `node:events`.

## Files

| file       | role |
|------------|------|
| `paths.ts` | `~/.terrarium/` layout — `app.db`, `workspaces/`, `logs/`, `vaults/`, `agents/<slug>/`. `ensurePaths()` creates the tree at startup. |
| `schema.ts`| Numbered SQL migrations (`MIGRATIONS[]`), applied by `PRAGMA user_version`. |
| `db.ts`    | `openDatabase()` — single `DatabaseSync` connection; WAL, `foreign_keys=ON`, `busy_timeout=5000`; readable errors. |
| `bus.ts`   | `EngineBus` — EventEmitter: `'event'` per `OfficeEvent`, `'state'` full snapshot. Main forwards both over IPC. |
| `seed.ts`  | First-run demo crew/cards/runs/wiki (ported from renderer `seed.ts`). |
| `engine.ts`| `class Engine implements Engine` + `createEngine()`. Mutations are transactional; each appends event rows and publishes a snapshot. |

## Data flow

`ipcMain.handle` → `Engine` method → `BEGIN IMMEDIATE` → UPDATE/INSERT + `INSERT events` → `COMMIT` → `bus.publish(state, events)` → `webContents.send('engine:state' | 'engine:event')`.

## Schema (migration 1)

```
meta(key*, value)

projects(id*, name, root_path, main_branch)
agents(id*, name, role, brief, status, desk_id, task_id→cards, hue, last_active_at)
cards(id*, title, body, status, assignee_id→agents, project_id→projects,
      priority 0|1|2, created_at, updated_at)
runs(id*, card_id→cards, agent_id→agents, status, worktree_path, branch,
     started_at, ended_at, summary)
sessions(id*, run_id→runs, agent_id→agents, kind, label, started_at, ended_at)
worktrees(id*, project_id→projects, run_id→runs, path, branch, locked,
          created_at, removed_at)
events(id*, ts, kind, text, agent_id→agents, card_id→cards)      -- append-only
routines(id*, project_id→projects, name, cron, card_template, enabled, last_run_at)

docs(project_id*, id*, title, path, type, stale, body, links[json], updated_at)
docs_fts = FTS5(title, body) external-content on docs.rowid,
           porter unicode61, kept in sync by docs_ai/docs_ad/docs_au triggers
```

ids TEXT · timestamps INTEGER ms epoch · statuses CHECK-constrained ·
booleans INTEGER 0/1 · `docs.links` is a JSON array (backlinks derived at read).

## Behavior notes

- `assignCard` → card `doing` + agent `working` + new `runs` row (`active`,
  worktree under `workspaces/<project>/<agent>-<card>`) + `card.move` event.
- `moveCard → done` → open run completed, assignee released to `idle`,
  `run.done` + `card.move` events.
- `nudgeAgent` on a `waiting` agent → `working`, its waiting runs → `active`,
  `run.log` event with the message.
- `searchWiki` → `docs_fts MATCH` (terms quoted, ANDed); falls back to LIKE.
- First run seeds the demo office and sets `meta.seeded`.
