import { app, BrowserWindow, net, protocol } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * One-time carry-over of renderer localStorage from the dev origin.
 *
 * `pnpm dev` serves the renderer from http://localhost:5173, the installed
 * app from file:// — two origins, two localStorage areas, although both
 * live in the same userData folder (%APPDATA%\terrarium). Everything the
 * renderer persists (pane layouts, departments, categories, quiz stats,
 * onboarding, orchestration…) sits in the dev origin for anyone who ran
 * Terrarium from source. On the first packaged launch we read that origin
 * through a hidden window (the http scheme is intercepted, so no dev server
 * is needed) and copy every key into the file:// origin, then leave a
 * marker so it never runs again.
 *
 * Main-process data (~/.terrarium: app.db, vaults, logs, pty sessions) is
 * origin-independent and needs no migration.
 */

const DEV_ORIGIN = 'http://localhost:5173'

/** Does the on-disk localStorage hold any dev-origin keys? LevelDB keeps
 * the origin prefix as plain bytes in its .log/.ldb files. Guards against
 * reading an empty area while a running dev build holds the DB lock. */
function devOriginOnDisk(): boolean {
  try {
    const dir = join(app.getPath('userData'), 'Local Storage', 'leveldb')
    const needle = Buffer.from(`_${DEV_ORIGIN}`)
    return readdirSync(dir)
      .filter((f) => f.endsWith('.log') || f.endsWith('.ldb'))
      .some((f) => readFileSync(join(dir, f)).includes(needle))
  } catch {
    return false
  }
}

export async function migrateDevLocalStorage(home: string): Promise<void> {
  if (!app.isPackaged) return
  const marker = join(home, 'storage-migrated.json')
  if (existsSync(marker)) return

  let win: BrowserWindow | null = null
  let intercepting = false
  try {
    protocol.handle('http', (req) => {
      if (new URL(req.url).origin === DEV_ORIGIN) {
        return new Response('<!doctype html><title>migrate</title>', { headers: { 'content-type': 'text/html' } })
      }
      return net.fetch(req, { bypassCustomProtocolHandlers: true })
    })
    intercepting = true

    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
    await win.loadURL(`${DEV_ORIGIN}/__terrarium-migrate`)
    const raw = (await win.webContents.executeJavaScript(
      'JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))'
    )) as string
    protocol.unhandle('http')
    intercepting = false

    const entries = JSON.parse(raw) as Record<string, string>
    const count = Object.keys(entries).length
    if (count === 0) {
      if (devOriginOnDisk()) {
        // dev data exists but read back empty — locked by a running dev build; retry next launch
        console.warn('[migrate] dev-origin storage present but unreadable (dev build running?) — will retry')
        return
      }
      // no dev history — nothing to carry (fresh installs, shared builds)
      writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), keys: 0 }))
      return
    }

    // any file:// page works — localStorage is per origin, not per path
    const tmpDir = join(home, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const page = join(tmpDir, 'migrate.html')
    writeFileSync(page, '<!doctype html><title>migrate</title>')
    await win.loadFile(page)
    const written = (await win.webContents.executeJavaScript(
      `(() => { const d = JSON.parse(${JSON.stringify(raw)}); for (const k of Object.keys(d)) localStorage.setItem(k, d[k]); return Object.keys(d).length })()`
    )) as number
    writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), keys: written, from: DEV_ORIGIN }))
    console.log(`[migrate] carried ${written} localStorage keys from ${DEV_ORIGIN}`)
  } catch (err) {
    // leave no marker — retried next launch (e.g. storage locked by a running dev build)
    console.warn('[migrate] localStorage carry-over skipped:', err)
  } finally {
    if (intercepting) {
      try {
        protocol.unhandle('http')
      } catch {
        /* already gone */
      }
    }
    if (win && !win.isDestroyed()) win.destroy()
  }
}
