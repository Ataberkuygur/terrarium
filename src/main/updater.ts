import { app, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { UPDATER_IPC, type UpdateStatus } from '../shared/updater'

/**
 * Auto-update from GitHub Releases (electron-updater, NSIS).
 *
 * Packaged builds check on launch and every 30 min. A newer release is
 * downloaded in the background (differential, via the .blockmap); the
 * renderer shows an "Update available" notice and one click restarts into
 * the new version. Terminal sessions survive the restart — they live in the
 * detached pty supervisor, not in this process. Dev runs report 'disabled'.
 */

const { autoUpdater } = electronUpdater
const CHECK_EVERY_MS = 30 * 60 * 1000

let status: UpdateStatus = { state: 'disabled', current: app.getVersion() }

function publish(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, current: app.getVersion() }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(UPDATER_IPC.STATUS, status)
  }
}

function installNow(): void {
  // isSilent=true: no NSIS wizard; isForceRunAfter=true: relaunch Terrarium
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

async function check(): Promise<void> {
  if (!app.isPackaged) return
  if (status.state === 'downloading' || status.state === 'ready') return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    publish({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

export function initUpdater(): void {
  ipcMain.handle(UPDATER_IPC.GET, () => status)
  ipcMain.handle(UPDATER_IPC.CHECK, async () => {
    await check()
    return status
  })
  ipcMain.handle(UPDATER_IPC.INSTALL, () => {
    if (status.state === 'ready') installNow()
    else if (status.state === 'available' || status.state === 'downloading') publish({ installQueued: true })
    return status
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => console.log('[updater]', m),
    warn: (m: unknown) => console.warn('[updater]', m),
    error: (m: unknown) => console.error('[updater]', m),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'available' && status.state !== 'downloading') publish({ state: 'checking', error: undefined })
  })
  autoUpdater.on('update-not-available', () => publish({ state: 'idle', version: undefined, percent: undefined }))
  autoUpdater.on('update-available', (info) => publish({ state: 'available', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => publish({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    publish({ state: 'ready', version: info.version, percent: 100 })
    if (status.installQueued) installNow()
  })
  autoUpdater.on('error', (err) => {
    // offline / GitHub hiccup — stay quiet, retry on the next tick
    publish({ state: 'error', error: err?.message ?? String(err) })
  })

  publish({ state: 'idle' })
  setTimeout(() => void check(), 8000)
  setInterval(() => void check(), CHECK_EVERY_MS)
}
