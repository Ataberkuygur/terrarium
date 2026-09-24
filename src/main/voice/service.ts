// ── Voice Service Manager ────────────────────────────────────────────
// Spawns and manages the Python-based Whisper voice-to-terminal process.
// Detects existing running instances to avoid mutex collisions.

import { type ChildProcess, spawn, execFile } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { stat, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { VoiceStatus } from '@shared/ipc'
import { checkDependencies, findPython, installDependencies, syncRuntimeFiles } from './installer'

const execFileAsync = promisify(execFile)

export class VoiceService {
  private child: ChildProcess | null = null
  private voiceDir: string
  private bundledDir: string
  private status: VoiceStatus = {
    enabled: true,
    ready: false,
    running: false,
    model: 'large-v3-turbo',
    hotkey: 'F8',
    device: 'cuda'
  }
  private onStatusChange?: (status: VoiceStatus) => void

  constructor(voiceDir: string, bundledDir: string, onStatusChange?: (status: VoiceStatus) => void) {
    this.voiceDir = voiceDir
    this.bundledDir = bundledDir
    this.onStatusChange = onStatusChange
    this.status.enabled = !existsSync(this.disabledMarker())
  }

  /** Present = the user switched the engine off; survives app restarts. */
  private disabledMarker(): string {
    return join(this.voiceDir, 'disabled')
  }

  isEnabled(): boolean {
    return this.status.enabled
  }

  /**
   * The F8 switch. Off stops every instance of our engine (including one a
   * previous app run left detached) and frees the ~4 GB the loaded Whisper
   * model holds; on spawns it again.
   */
  async setEnabled(on: boolean): Promise<void> {
    if (on) {
      await unlink(this.disabledMarker()).catch(() => {})
      this.updateStatus({ enabled: true, error: undefined })
      await this.start()
      return
    }
    await writeFile(this.disabledMarker(), '').catch(() => {})
    this.updateStatus({ enabled: false })
    this.stop()
    await this.killStaleInstances()
    this.updateStatus({ ready: false, running: false })
  }

  getStatus(): VoiceStatus {
    return { ...this.status }
  }

  private updateStatus(patch: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatusChange?.(this.getStatus())
  }

  /** Liveness = a heartbeat file our engine refreshes every 3s. A process-list
   * grep can't be trusted: hung pythonw instances and foreign SuperWhisper
   * installs both match '%main.py%' while owning nothing of ours. */
  async isProcessRunning(): Promise<boolean> {
    try {
      const { mtimeMs } = await stat(join(this.voiceDir, 'heartbeat'))
      return Date.now() - mtimeMs < 15_000
    } catch {
      return false
    }
  }

  /** Kill stale instances of OUR main.py (absolute path in CommandLine) and
   * drop the stale heartbeat so the fresh spawn isn't mistaken for dead. */
  private async killStaleInstances(): Promise<void> {
    await unlink(join(this.voiceDir, 'heartbeat')).catch(() => {})
    // WQL string literals escape backslashes — an unescaped Windows path
    // makes the whole filter invalid and nothing matches
    const target = join(this.voiceDir, 'main.py').replace(/\\/g, '\\\\').replace(/'/g, "''")
    try {
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "CommandLine like '%${target}%'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
        ],
        { windowsHide: true, timeout: 20_000 }
      )
    } catch {
      // best-effort cleanup — spawn proceeds either way
    }
  }

  /** Initialize installer, dependencies, and start engine. */
  async start(): Promise<boolean> {
    if (!this.status.enabled) return false

    // 1. Sync runtime files into ~/.terrarium/voice
    syncRuntimeFiles(this.bundledDir, this.voiceDir)

    // 2. Check if already running system-wide (fresh heartbeat = truly alive)
    const alreadyRunning = await this.isProcessRunning()
    if (alreadyRunning) {
      console.log('[voice-service] Voice engine is already active.')
      this.updateStatus({ ready: true, running: true })
      return true
    }

    // 2b. Stale or hung instance — free the single-instance mutex before spawn
    await this.killStaleInstances()

    // 3. Locate Python
    const py = await findPython()
    if (!py) {
      const err = 'Python is not installed or not found in system PATH.'
      console.warn(`[voice-service] ${err}`)
      this.updateStatus({ ready: false, running: false, error: err })
      return false
    }

    // 4. Verify/install dependencies
    const hasDeps = await checkDependencies(py.executable)
    if (!hasDeps) {
      console.log('[voice-service] Required packages missing, starting auto-install...')
      const installed = await installDependencies(py.executable)
      if (!installed) {
        const err = 'Failed to install speech recognition packages.'
        this.updateStatus({ ready: false, running: false, error: err })
        return false
      }
    }

    // 5. Spawn background engine (unless switched off while deps were checked)
    if (!this.status.enabled) return false
    const mainScript = join(this.voiceDir, 'main.py')
    const pythonw = py.executable.replace(/python\.exe$/i, 'pythonw.exe')

    try {
      this.child = spawn(pythonw, [mainScript], {
        cwd: this.voiceDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })

      this.child.unref()

      this.updateStatus({
        ready: true,
        running: true,
        device: py.hasCuda ? 'cuda (RTX)' : 'cpu',
        error: undefined
      })

      console.log(`[voice-service] Voice engine started successfully (PID ${this.child.pid}).`)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[voice-service] Failed to start engine: ${msg}`)
      this.updateStatus({ ready: false, running: false, error: msg })
      return false
    }
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill()
      } catch {
        // ignore
      }
      this.child = null
    }
    this.updateStatus({ running: false })
  }
}
