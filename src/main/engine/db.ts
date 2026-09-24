// ── db: single node:sqlite connection + migration runner ────────────
// Electron 44 bundles Node 24, so DatabaseSync (with FTS5) is built in.
// One connection per process; WAL + busy_timeout keep it crash-safe and
// tolerant of the renderer hammering IPC during a write.

import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema'

const fmt = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Open app.db, apply pragmas, run pending migrations. Throws a readable Error on failure. */
export function openDatabase(path: string): DatabaseSync {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { timeout: 5000 })
  } catch (err) {
    throw new Error(`Terrarium: cannot open database at ${path} — ${fmt(err)}`)
  }

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    migrate(db)
  } catch (err) {
    try {
      db.close()
    } catch {
      /* best effort */
    }
    throw new Error(`Terrarium: database setup failed at ${path} — ${fmt(err)}`)
  }
  return db
}

/** Apply pending migrations in id order; each is transactional + bumps user_version. */
function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get()
  const current = Number(row?.user_version ?? 0)

  for (const m of MIGRATIONS) {
    if (m.id <= current) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.id}`)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw new Error(`migration ${m.id} (${m.name}) failed: ${fmt(err)}`)
    }
  }
}
