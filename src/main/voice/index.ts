// ── Voice Subsystem Entrypoint ───────────────────────────────────────
// Integrates local whisper-large-v3-turbo prompt injection into Terrarium.
// Registers IPC channels and auto-provisions the voice engine on launch.

import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { VOICE_IPC } from '@shared/ipc'
import type { TerrariumPaths } from '../engine/paths'
import { VoiceService } from './service'

let globalVoiceService: VoiceService | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null

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

  // Kick off background start / verification asynchronously so window launch is not blocked
  void service.start().catch((err) => {
    console.warn('[voice] Service startup warning:', err)
  })

  // Watchdog — heartbeat goes stale if the engine dies or hangs mid-session;
  // re-run start() (cheap: heartbeat-fresh → early return) to respawn it.
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
  if (globalVoiceService) {
    globalVoiceService.stop()
    globalVoiceService = null
  }
}
