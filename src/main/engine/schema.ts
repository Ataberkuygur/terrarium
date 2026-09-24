// ── schema: numbered migrations ─────────────────────────────────────
// Each migration runs once, in id order, inside a transaction tracked
// by PRAGMA user_version. Append-only: never edit an applied migration,
// add the next number instead.

export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
-- key/value store (seeded flag, schema notes, app prefs)
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL,
  main_branch TEXT NOT NULL DEFAULT 'main'
);

CREATE TABLE agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('lead','builder','reviewer','researcher','designer','scribe')),
  brief          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'idle'
                 CHECK (status IN ('idle','working','waiting','done','offline')),
  desk_id        TEXT NOT NULL DEFAULT '',
  task_id        TEXT REFERENCES cards(id) ON DELETE SET NULL,
  hue            INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'backlog'
              CHECK (status IN ('backlog','ready','doing','review','done')),
  assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  priority    INTEGER NOT NULL DEFAULT 0,          -- 0 none, 1 normal, 2 urgent
  created_at  INTEGER NOT NULL,                    -- ms epoch
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_cards_project  ON cards(project_id);
CREATE INDEX idx_cards_assignee ON cards(assignee_id);
CREATE INDEX idx_cards_status   ON cards(status);

CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL REFERENCES cards(id)  ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'provisioning'
                CHECK (status IN ('provisioning','active','waiting','review','done','failed')),
  worktree_path TEXT,
  branch        TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  summary       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_runs_card  ON runs(card_id);
CREATE INDEX idx_runs_agent ON runs(agent_id);

-- terminal/pty sessions attached to a run (owned by the pty-host process)
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  run_id     TEXT REFERENCES runs(id)   ON DELETE SET NULL,
  agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'pty',
  label      TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX idx_sessions_run ON sessions(run_id);

-- git worktree registry (one per run; reconciler honors the locked flag)
CREATE TABLE worktrees (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id     TEXT REFERENCES runs(id) ON DELETE SET NULL,
  path       TEXT NOT NULL,
  branch     TEXT,
  locked     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX idx_worktrees_project ON worktrees(project_id);

-- append-only office event log → activity ticker / inbox
CREATE TABLE events (
  id       TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  kind     TEXT NOT NULL
           CHECK (kind IN ('agent.status','card.move','run.log','run.done','run.waiting','system')),
  text     TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  card_id  TEXT REFERENCES cards(id)  ON DELETE SET NULL
);
CREATE INDEX idx_events_ts ON events(ts DESC);

-- scheduled card generators (cron expression → card template JSON)
CREATE TABLE routines (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  cron          TEXT NOT NULL,
  card_template TEXT NOT NULL DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_at   INTEGER
);

-- wiki pages. links/body feed docs_fts via triggers below.
-- Rowid table (no WITHOUT ROWID) so FTS5 external content can key on rowid.
CREATE TABLE docs (
  id         TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  path       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'module'
             CHECK (type IN ('overview','architecture','module','file','howto','glossary','report')),
  stale      INTEGER NOT NULL DEFAULT 0,
  body       TEXT NOT NULL DEFAULT '',
  links      TEXT NOT NULL DEFAULT '[]',           -- JSON array of page ids
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX idx_docs_project ON docs(project_id);

-- full-text search over wiki pages (external content → no duplication)
CREATE VIRTUAL TABLE docs_fts USING fts5(
  title,
  body,
  content      = 'docs',
  content_rowid= 'rowid',
  tokenize     = 'porter unicode61'
);

CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO docs_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
`
  },
  {
    id: 2,
    name: 'agent-domain',
    sql: `
ALTER TABLE agents ADD COLUMN domain TEXT NOT NULL DEFAULT 'general';
`
  },
  {
    id: 3,
    name: 'card-due-at',
    sql: `
-- optional due/scheduled time (ms epoch) on task cards
ALTER TABLE cards ADD COLUMN due_at INTEGER;
`
  }
]
