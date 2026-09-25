// ── Voice Service Installer ──────────────────────────────────────────
// Ensures Python and required ML/audio dependencies (faster-whisper,
// sounddevice, pynput, pyperclip) are present on the host system.
// Automatically syncs bundled runtime files to ~/.terrarium/voice/.

import { exec, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface PythonEnv {
  executable: string
  version: string
  hasCuda: boolean
}

/** Check candidate Python binaries in order of preference. */
export async function findPython(): Promise<PythonEnv | null> {
  const candidates = ['python', 'python3', 'py']

  for (const cmd of candidates) {
    try {
      const { stdout } = await execAsync(
        `${cmd} -c "import sys; print(f'{sys.executable}|{sys.version_info[0]}.{sys.version_info[1]}')"`
      )
      const parts = stdout.trim().split('|')
      if (parts.length >= 2 && parts[0]) {
        const [executable, ver] = parts
        // Check CUDA support in ctranslate2 if available
        let hasCuda = false
        try {
          const cudaCheck = await execAsync(
            `"${executable}" -c "import ctranslate2; print(ctranslate2.get_cuda_device_count())"`
          )
          hasCuda = parseInt(cudaCheck.stdout.trim(), 10) > 0
        } catch {
          // ctranslate2 not yet installed or no CUDA
        }

        return { executable, version: ver ?? '3.x', hasCuda }
      }
    } catch {
      // candidate not available, try next
    }
  }

  return null
}

/** Check if all required Python packages are installed. */
export async function checkDependencies(pythonPath: string): Promise<boolean> {
  try {
    await execAsync(
      `"${pythonPath}" -c "import faster_whisper, sounddevice, pynput, pyperclip, soundfile, numpy"`
    )
    return true
  } catch {
    return false
  }
}

/** Install missing audio and speech recognition packages silently. */
export async function installDependencies(pythonPath: string): Promise<boolean> {
  const packages = [
    'faster-whisper',
    'sounddevice',
    'pynput',
    'pyperclip',
    'soundfile',
    'numpy'
  ]

  console.log(`[voice-installer] Installing speech recognition dependencies via ${pythonPath}...`)

  return new Promise<boolean>((resolve) => {
    const child = spawn(
      pythonPath,
      ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...packages],
      {
        windowsHide: true,
        stdio: 'ignore'
      }
    )

    child.on('error', (err) => {
      console.warn('[voice-installer] Pip installation error:', err)
      resolve(false)
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log('[voice-installer] Dependencies installed successfully.')
        resolve(true)
      } else {
        console.warn(`[voice-installer] Pip exited with non-zero code ${code}`)
        resolve(false)
      }
    })
  })
}

/** Sync bundled runtime scripts into ~/.terrarium/voice/ */
export function syncRuntimeFiles(bundledRuntimeDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true })

  if (!existsSync(bundledRuntimeDir)) {
    console.warn(`[voice-installer] Bundled runtime directory not found: ${bundledRuntimeDir}`)
    return
  }

  // Copy files with overwrite, preserving user config if customized
  const configFile = join(targetDir, 'config.json')
  let existingConfig: string | null = null
  if (existsSync(configFile)) {
    try {
      existingConfig = readFileSync(configFile, 'utf-8')
    } catch {
      existingConfig = null
    }
  }

  cpSync(bundledRuntimeDir, targetDir, { recursive: true, force: true })

  // Restore existing config if it was valid
  if (existingConfig) {
    try {
      writeFileSync(configFile, migrateHotkey(existingConfig), 'utf-8')
    } catch {
      // ignore
    }
  }
}

/**
 * F9 became Terrarium's on/off switch for the engine; the old default
 * push-to-talk key moves to F8 (a config still on F9 would fight it).
 */
function migrateHotkey(raw: string): string {
  try {
    const cfg = JSON.parse(raw) as { hotkey?: unknown }
    if (typeof cfg.hotkey !== 'string' || cfg.hotkey.trim().toLowerCase() !== 'f9') return raw
    return JSON.stringify({ ...cfg, hotkey: 'f8' }, null, 2)
  } catch {
    return raw
  }
}
