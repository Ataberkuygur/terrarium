// ── Voice Subsystem Entrypoint ───────────────────────────────────────
// Integrates local whisper-large-v3-turbo prompt injection into Terrarium.
// Registers IPC channels and auto-provisions the voice engine on launch.
// F9 switches the engine off and on — off frees the loaded model's RAM/VRAM.
// F8 is the engine's own push-to-talk key (runtime/hotkey_listener.py never
// listens to F9). Fn is resolved in the keyboard firmware, so Fn+F9 and F9
// are the same key to Windows.

import { app, globalShortcut, ipcMain, Notification } from 'electron'
import { join } from 'node:path'
import { VOICE_IPC } from '@shared/ipc'
import type { TerrariumPaths } from '../engine/paths'
import { VoiceService } from './service'

const TOGGLE_ACCELERATOR = 'F9'

let globalVoiceService: VoiceService | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null
let toggling: Promise<void> = Promise.resolve()

function toggleVoice(service: VoiceService): void {
  // serialised: a double press waits for the first switch to settle
  toggling = toggling.then(async () => {
    const on = !service.isEnabled()
    await service.setEnabled(on)
    if (Notification.isSupported()) {
      new Notification({
        title: on ? 'Ses modülü açıldı' : 'Ses modülü kapatıldı',
        body: on ? 'Whisper yükleniyor — birkaç saniye sürer.' : 'Model bellekten atıldı. Tekrar açmak için F9.',
        silent: true
      }).show()
    }
  })
  toggling = toggling.catch((err) => console.warn('[voice] toggle failed:', err))
}

export function initVoiceService(
  paths: TerrariumPaths,
  broadcast: (channel: string, payload: unknown) => void
): VoiceService {
  // packaged builds ship the .py runtime as an extraResource (see package.json build)
  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'voice-runtime')
    : join(__dirname, '../../src/main/voice/runtime')

  const service = new VoiceService(paths.voice, bundledDir, (status) => {
    broadcast(VOICE_IPC.changed, status)
  })

  globalVoiceService = service

  // Register IPC handlers
  ipcMain.handle(VOICE_IPC.status, () => service.getStatus())
  ipcMain.handle(VOICE_IPC.setup, () => service.start())
  ipcMain.handle(VOICE_IPC.setEnabled, async (_e, on: boolean) => {
    if (on !== service.isEnabled()) toggleVoice(service)
    await toggling
    return service.getStatus()
  })

  // Kick off background start / verification asynchronously so window launch is not blocked
  void (async () => {
    const bind = () => globalShortcut.register(TOGGLE_ACCELERATOR, () => toggleVoice(service))
    if (!bind()) {
      // an engine from an older build (it outlives app updates) still holds
      // F9 as a push-to-talk key — replace it with the current runtime
      await service.kill()
      if (!bind()) console.warn(`[voice] ${TOGGLE_ACCELERATOR} is taken by another app — toggle unavailable`)
    }
    await service.start()
  })().catch((err) => {
    console.warn('[voice] Service startup warning:', err)
  })

  // Watchdog — heartbeat goes stale if the engine dies or hangs mid-session;
  // re-run start() (cheap: heartbeat-fresh → early return; switched off →
  // no-op) to respawn it.
  watchdogTimer = setInterval(() => {
    void service
      .isProcessRunning()
      .then((alive) => (alive ? undefined : service.start()))
      .catch(() => {})
  }, 60_000)
  watchdogTimer.unref?.()

  return service
}

export function stopVoiceService(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  globalShortcut.unregister(TOGGLE_ACCELERATOR)
  if (globalVoiceService) {
    globalVoiceService.stop()
    globalVoiceService = null
  }
}
