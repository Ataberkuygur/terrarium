import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, session, shell } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import { IPC } from '../shared/ipc'
import { createEngine } from './engine/engine'
import { createPtyManager, registerPtyIpc } from './pty/manager'
import { detectAgentClis } from './git/detect'
import * as wt from './git/worktrees'
import { initWiki, getWiki, closeAllWikis } from './wiki/index'
import { generateStructuralPages } from './wiki/generate'
import { ensurePaths } from './engine/paths'
import { startPaneBridge } from './pane-bridge'
import { installOrchestrationTools } from './orchestration'
import { initAppZoom } from './app-zoom'
import { listCliSessions } from './cli-sessions'
import { probeCliProcesses } from './proc-cli'
import { cliBindings, resolveCliSession } from './cli-binding'
import { startMobileServer, type MobileInfo } from './mobile'
import { initVoiceService, stopVoiceService } from './voice'
import { registerJevIpc } from './jev'
import { suggestNetworkTopic } from './net-topic'
import { initUpdater } from './updater'
import { migrateDevLocalStorage } from './storage-migration'
import QRCode from 'qrcode'

/**
 * Terrarium main process — window + IPC wiring.
 * Subsystems live in engine/ (SQLite office record), pty/ (utilityProcess host),
 * git/ (worktrees + CLI detection), wiki/ (vault + watcher).
 */

// Perf: native Win occlusion tracking throttles rAF to ~1fps whenever any
// window overlaps ours — feels like random jank in the office view. Chrome
// tolerates it because tabs re-throttle on focus; an always-visible app
// window must not. Must be appended before 'ready'.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
// Perf: hybrid-GPU laptops park Chromium on the Intel iGPU while Chrome
// gets the discrete card (Optimus picks per-process). The office view is
// a realtime WebGL scene — request the high-performance adapter.
app.commandLine.appendSwitch('force_high_performance_gpu')

// ── packaged builds: main-process log + single instance ──
// No terminal is attached to an installed app, so console output and any
// startup failure would vanish; mirror them to ~/.terrarium/logs/main.log.
if (app.isPackaged) {
  const logFile = join(ensurePaths().logs, 'main.log')
  try {
    writeFileSync(logFile, `Terrarium ${app.getVersion()} — ${new Date().toISOString()}
`)
  } catch {
    /* logs dir unwritable — console only */
  }
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      orig(...args)
      try {
        const line = args
          .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
        appendFileSync(logFile, `[${level}] ${line}
`)
      } catch {
        /* ignore */
      }
    }
  }
  // a second launch just focuses the running window
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
  } else {
    app.on('second-instance', () => {
      const w = BrowserWindow.getAllWindows()[0]
      if (!w) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    })
  }
}
process.on('uncaughtException', (err) => console.error('[main] uncaught:', err))
process.on('unhandledRejection', (err) => console.error('[main] unhandled rejection:', err))

/** A project root that is really just the user's home — never crawl it. */
function isHomeRoot(p: string): boolean {
  try {
    return resolve(p).toLowerCase() === resolve(homedir()).toLowerCase()
  } catch {
    return false
  }
}

/**
 * Poll the system clipboard for images (~1.5s). New image → saved as PNG
 * under ~/.terrarium/clipboard/ and a small preview pushed to the renderer on
 * 'clipboard:image'. `has('image/png')` is the cheap gate — the Blob is
 * only read when its size signature actually changed.
 */
function startClipboardWatch(home: string, send: (channel: string, payload: unknown) => void): void {
  const dir = join(home, 'clipboard')
  let lastSig = ''
  let inFlight = false
  const tick = async () => {
    if (inFlight) return
    inFlight = true
    try {
      // Electron 44 clipboard is async/W3C-style: has() gates the read.
      if (!(await clipboard.has('image/png'))) return
      const items = await clipboard.read()
      const item = items.find((i) => i.types.includes('image/png'))
      if (!item) return
      const blob = (await item.getType('image/png')) as Blob
      const buf = Buffer.from(await blob.arrayBuffer())
      if (!buf.length) return
      const sig = `${buf.length}:${buf.readUInt32LE(0)}:${buf.readUInt32LE(buf.length - 4)}`
      if (sig === lastSig) return
      lastSig = sig
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `clip-${Date.now()}.png`)
      writeFileSync(path, buf)
      const img = nativeImage.createFromBuffer(buf)
      const { width, height } = img.getSize()
      const thumb = width > 360 ? img.resize({ width: 360 }) : img
      send('clipboard:image', {
        dataUrl: thumb.toDataURL(),
        path,
        width,
        height,
        at: Date.now()
      })
    } catch {
      /* clipboard locked by another app — try again next tick */
    } finally {
      inFlight = false
    }
  }
  const timer = setInterval(() => void tick(), 1500)
  timer.unref?.()
  app.on('before-quit', () => clearInterval(timer))
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function loadWindowState(home: string): WindowState {
  const defaultState: WindowState = {
    width: 1520,
    height: 940,
    isMaximized: false
  }
  const file = join(home, 'window-state.json')
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WindowState>
    if (!parsed || typeof parsed !== 'object') return defaultState
    const width =
      typeof parsed.width === 'number' && parsed.width >= 600 ? parsed.width : defaultState.width
    const height =
      typeof parsed.height === 'number' && parsed.height >= 400 ? parsed.height : defaultState.height
    const isMaximized = Boolean(parsed.isMaximized)

    let x = typeof parsed.x === 'number' ? parsed.x : undefined
    let y = typeof parsed.y === 'number' ? parsed.y : undefined
    if (x !== undefined && y !== undefined) {
      const displays = screen.getAllDisplays()
      const inBounds = displays.some((d) => {
        const { x: dx, y: dy, width: dw, height: dh } = d.bounds
        return x! >= dx && x! <= dx + dw - 100 && y! >= dy && y! <= dy + dh - 100
      })
      if (!inBounds) {
        x = undefined
        y = undefined
      }
    }
    return { x, y, width, height, isMaximized }
  } catch {
    return defaultState
  }
}

function saveWindowState(home: string, win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const isMaximized = win.isMaximized()
  const bounds = isMaximized ? null : win.getBounds()
  const file = join(home, 'window-state.json')
  try {
    mkdirSync(home, { recursive: true })
    const state: WindowState = {
      isMaximized,
      width: bounds?.width ?? 1520,
      height: bounds?.height ?? 940,
      x: bounds?.x,
      y: bounds?.y
    }
    writeFileSync(file, JSON.stringify(state, null, 2))
  } catch {
    /* non-fatal */
  }
}

function createWindow(): BrowserWindow {
  const paths = ensurePaths()
  const savedState = loadWindowState(paths.home)

  const win = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b0d',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0b0d',
      symbolColor: '#ecedef',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // don't drop rAF to 1fps when occluded/backgrounded — the office
      // canvas + terminals must keep their frame budget under overlap
      backgroundThrottling: false,
      // workspace browser panes are <webview> guests on their own partition
      webviewTag: true
    }
  })

  if (savedState.isMaximized) {
    win.maximize()
  }

  // whole-UI zoom (Ctrl+= / Ctrl+- / Ctrl+0) with the caption overlay in step
  initAppZoom(win, paths.home)

  let debounceTimer: NodeJS.Timeout | null = null
  const scheduleSave = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      saveWindowState(paths.home, win)
    }, 500)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    saveWindowState(paths.home, win)
  })

  // lock webviews down before any can attach: http(s) only, isolated
  // partition, no node — everything else is rejected.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params?.src ?? ''
    if (src && src !== 'about:blank' && !/^https?:\/\//i.test(src)) {
      event.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.backgroundThrottling = false
    params.partition = 'persist:terrarium-browse'
  })

  // the guest partition: no permission requests (camera/mic/notifications).
  // window.open inside a webview lands on the guest webContents — handled
  // globally below via 'web-contents-created'.
  const browse = session.fromPartition('persist:terrarium-browse')
  browse.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  win.on('ready-to-show', () => win.show())

  // ready-to-show depends on the renderer's first frame; a GPU stall or a
  // wedged compositor can leave the app running with zero visible windows.
  // Reveal after a grace period rather than stay hidden forever.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 8000)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** Open the main window unless one exists — boot's last step, and the
 * fallback when a subsystem hangs or throws during startup. */
/** set once the real app window exists — see 'window-all-closed' */
let mainWindowOpened = false

function ensureWindow(): void {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
    mainWindowOpened = true
  }
}

app.whenReady().then(async () => {
  // never leave the user with an invisible, running app
  const fallback = setTimeout(() => {
    console.warn('[main] startup slow — opening the window before init finished')
    ensureWindow()
  }, 12000)
  try {
    await boot()
  } catch (err) {
    console.error('[main] startup failed:', err)
    dialog.showErrorBox(
      'Terrarium',
      `Başlatma sırasında bir hata oluştu. Ayrıntılar: ${join(ensurePaths().logs, 'main.log')}

${String(err)}`
    )
  } finally {
    clearTimeout(fallback)
    ensureWindow()
  }
})

async function boot(): Promise<void> {
  // installed build: carry the dev origin's localStorage over once, before
  // any renderer reads it — layouts/departments/quiz survive the switch
  await migrateDevLocalStorage(ensurePaths().home)
  // GitHub Releases auto-update (packaged only) — renderer shows the notice
  initUpdater()

  // GPU feature dump — read ~/.terrarium/gpu-info.json to see whether WebGL
  // landed on real hardware or fell back to SwiftShader
  app.getGPUInfo('complete')
    .then((info) =>
      writeFileSync(join(ensurePaths().home, 'gpu-info.json'), JSON.stringify(info, null, 2))
    )
    .catch(() => {})

  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }

  // ── persistence engine (SQLite office record) ──
  const engine = createEngine()

  ipcMain.handle(IPC.engineGetState, () => engine.getState())
  ipcMain.handle(IPC.cardCreate, (_e, input) => engine.createCard(input))
  ipcMain.handle(IPC.cardAssign, (_e, cardId, agentId) => engine.assignCard(cardId, agentId))
  ipcMain.handle(IPC.cardMove, (_e, cardId, status) => engine.moveCard(cardId, status))
  ipcMain.handle(IPC.cardUpdate, (_e, cardId, patch) => engine.updateCard(cardId, patch))
  ipcMain.handle(IPC.cardDelete, (_e, cardId) => engine.deleteCard(cardId))
  ipcMain.handle(IPC.agentNudge, (_e, agentId, msg) => engine.nudgeAgent(agentId, msg))
  ipcMain.handle(IPC.agentTouch, (_e, agentId) => engine.touchAgent(agentId))
  ipcMain.handle(IPC.agentUpsert, (_e, agent) => engine.upsertAgent(agent))
  ipcMain.handle(IPC.agentRemove, (_e, agentId) => engine.removeAgent(agentId))
  ipcMain.handle(IPC.projectSetRoot, (_e, projectId, rootPath) =>
    engine.setProjectRoot(projectId, rootPath)
  )
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  // ── wiki: real vault index when available, engine docs table otherwise ──
  const project = (await engine.getState()).projects[0]
  let wikiIdx: Awaited<ReturnType<typeof initWiki>> | null = null
  try {
    if (project) {
      // fresh installs point at the home folder until onboarding picks a
      // project — watching/scanning all of home would stall startup
      const repoRoot = isHomeRoot(project.rootPath) ? '' : project.rootPath
      wikiIdx = await initWiki({
        id: project.id,
        name: project.name,
        rootPath: repoRoot
      })
      // Bootstrap structural pages (module map, repo-map, how-to-run) if the vault is bare.
      if (repoRoot) await generateStructuralPages(wikiIdx, repoRoot)
    }
  } catch (err) {
    console.warn('[terrarium] wiki vault unavailable, falling back to engine docs:', err)
    wikiIdx = null
  }

  if (wikiIdx) {
    // a project without a vault index (e.g. switched after boot) falls back
    // to the engine docs table instead of throwing in the handler
    ipcMain.handle(IPC.wikiList, (_e, pid) => getWiki(pid)?.list() ?? engine.listWikiPages(pid))
    ipcMain.handle(IPC.wikiGet, (_e, pid, id) => getWiki(pid)?.get(id) ?? engine.getWikiPage(pid, id))
    ipcMain.handle(IPC.wikiSearch, (_e, pid, q) => getWiki(pid)?.search(q) ?? engine.searchWiki(pid, q))
    ipcMain.handle(IPC.wikiSave, (_e, pid, id, body) =>
      getWiki(pid) ? getWiki(pid)!.save(id, body) : engine.saveWikiPage(pid, id, body)
    )
    wikiIdx.on('changed', (e: unknown) => broadcast(IPC.wikiChanged, e))
  } else {
    ipcMain.handle(IPC.wikiList, (_e, projectId) => engine.listWikiPages(projectId))
    ipcMain.handle(IPC.wikiGet, (_e, projectId, pageId) => engine.getWikiPage(projectId, pageId))
    ipcMain.handle(IPC.wikiSearch, (_e, projectId, q) => engine.searchWiki(projectId, q))
    ipcMain.handle(IPC.wikiSave, (_e, projectId, pageId, body) =>
      engine.saveWikiPage(projectId, pageId, body)
    )
  }

  engine.subscribe((state) => broadcast(IPC.engineState, state))
  engine.onEvent((ev) => broadcast(IPC.engineEvent, ev))

  // ── pty host (utilityProcess) ──
  const ptyManager = createPtyManager()
  registerPtyIpc(ptyManager)

  // ── Jev (TypeSafe AI) decision sidecar — domain classification etc. ──
  registerJevIpc()

  // ── pane bridge — loopback /cmd server so terminals drive browser panes ──
  startPaneBridge()

  // ── orchestration — `tnet` helper on network terminals' PATH ──
  installOrchestrationTools(ensurePaths().home)

  // ── mobile control + remote API — LAN server, QR pairing, and the
  //    HTTP surface the terrarium-mcp executable wraps ──
  let mobileInfo: MobileInfo | null = null
  try {
    mobileInfo = await startMobileServer(engine, {
      version: app.getVersion(),
      pty: ptyManager,
      wiki: (projectId) => {
        const pid = projectId || project?.id || ''
        const idx = pid ? getWiki(pid) : null
        if (idx) return idx
        if (!pid) return null
        // engine-docs fallback — same shape as WikiIndex's read surface
        return {
          list: () => engine.listWikiPages(pid),
          get: (pageId: string) => engine.getWikiPage(pid, pageId),
          search: (q: string) => engine.searchWiki(pid, q),
          save: (pageId: string, body: string) => engine.saveWikiPage(pid, pageId, body)
        }
      }
    })
    if (mobileInfo) console.log(`[mobile] ${mobileInfo.url}`)
    else console.warn('[mobile] no LAN interface / ports busy — disabled')
  } catch (err) {
    console.warn('[mobile] failed to start:', err)
  }
  ipcMain.handle('mobile:info', async () => {
    if (!mobileInfo) return null
    const qr = await QRCode.toDataURL(mobileInfo.url, {
      width: 240,
      margin: 1,
      color: { dark: '#ecedef', light: '#101114' }
    })
    return { ...mobileInfo, qr }
  })

  // ── git worktrees + agent CLI detection ──
  ipcMain.handle('wt:create', (_e, o) => wt.create(o))
  ipcMain.handle('wt:list', (_e, p) => wt.list(p))
  ipcMain.handle('wt:reconcile', (_e, p, reg) => wt.reconcile(p, reg))
  ipcMain.handle('wt:remove', (_e, p, o) => wt.remove(p, o))
  ipcMain.handle('wt:lock', (_e, p, r, o) => wt.lock(p, r, o))
  ipcMain.handle('wt:unlock', (_e, p, o) => wt.unlock(p, o))
  ipcMain.handle('agents:detect', () => detectAgentClis())
  // past CLI sessions for the pane dropdown (~/.claude/projects, ~/.codex/sessions)
  ipcMain.handle('cli:sessions', (_e, cli: string, cwd: string) => listCliSessions(cli, cwd))
  // agent CLI running under each shell pid (process-tree probe; renderer
  // asks only on screen transitions — see renderer lib/live-cli.ts)
  ipcMain.handle('cli:processes', (_e, pids: number[]) => probeCliProcesses(pids))
  // pty pid → CLI session (orchestration nodes resume after a reboot)
  ipcMain.handle('cli:bindings', (_e, entries: { pid: number; since: number }[]) => cliBindings(entries))
  ipcMain.handle('cli:resolve-session', (_e, cli: string, pid: number, since: number) =>
    resolveCliSession(cli, pid, since)
  )
  // topic for a network whose orchestrator never ran `tnet topic`
  ipcMain.handle('net:suggest-topic', (_e, sessionId: string, agentTitles: string[]) =>
    typeof sessionId === 'string'
      ? suggestNetworkTopic(sessionId, Array.isArray(agentTitles) ? agentTitles : [])
      : null
  )

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))

  // ── clipboard image watcher ──
  // Copied a screenshot? It slides in from the right edge (ClipPeek) and is
  // already saved under ~/.terrarium/clipboard/. Poll formats cheaply; only
  // read the (potentially large) image when the signature actually changed.
  const appPaths = ensurePaths()
  startClipboardWatch(appPaths.home, broadcast)

  // ── voice-to-terminal prompt injection (Whisper large-v3-turbo / F8) ──
  initVoiceService(appPaths, broadcast)

  // webview guests: popups → external browser, never a new Electron window
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  ensureWindow()

  app.on('activate', ensureWindow)

  app.on('before-quit', () => {
    stopVoiceService()
    void closeAllWikis()
    engine.close()
    ptyManager.dispose()
  })
}

app.on('window-all-closed', () => {
  // helper windows closing during boot (the storage-migration probe) must
  // not end the app before the main window even exists
  if (!mainWindowOpened) return
  if (process.platform !== 'darwin') app.quit()
})
