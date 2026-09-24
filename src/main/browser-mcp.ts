// ── browser-mcp — Devin's browser MCP servers on/off ──────────────────
// playwright + chrome-devtools cost every Devin session ~260 MB (server +
// watchdog) whether or not the agent ever opens a page. Off = `disabled`
// on both entries of Devin's user mcp_config.json (exactly what
// `devin mcp disable -s user <name>` writes) + the copies running under
// live Devin sessions are stopped, so the memory comes back at once. On =
// flag cleared; new and resumed Devin sessions load them again.
// Driven by the Settings toggle and by agents (`tnet mcp on|off`).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserMcpStatus } from '@shared/browser-mcp'

const execFileAsync = promisify(execFile)

export const BROWSER_MCP_SERVERS = ['playwright', 'chrome-devtools'] as const

/** Command-line signature of each server's entry script. */
const SERVER_RE = 'chrome-devtools-mcp[\\\\/]build[\\\\/]src[\\\\/]bin|@playwright[\\\\/]mcp[\\\\/]cli\\.js'

function configPath(): string {
  // the CLI's "user" scope: %APPDATA%\Devin on Windows, ~/.config/devin elsewhere
  return process.platform === 'win32' && process.env.APPDATA
    ? join(process.env.APPDATA, 'Devin', 'mcp_config.json')
    : join(homedir(), '.config', 'devin', 'mcp_config.json')
}

type McpConfig = { mcpServers?: Record<string, Record<string, unknown>> }

async function readConfig(): Promise<McpConfig | null> {
  const file = configPath()
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as McpConfig
  } catch {
    return null
  }
}

/** Server node processes launched by a Devin session (pid list). */
async function runningServers(): Promise<number[]> {
  if (process.platform !== 'win32') return []
  const ps =
    `$p = Get-CimInstance Win32_Process; $devin = @{}; ` +
    `$p | Where-Object Name -eq 'devin.exe' | ForEach-Object { $devin[$_.ProcessId] = 1 }; ` +
    `$p | Where-Object { $_.Name -eq 'node.exe' -and $devin.ContainsKey($_.ParentProcessId) -and $_.CommandLine -match '${SERVER_RE}' } | ForEach-Object { $_.ProcessId }`
  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      timeout: 20_000
    })
    return stdout
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

export async function browserMcpStatus(): Promise<BrowserMcpStatus> {
  const cfg = await readConfig()
  const entries = BROWSER_MCP_SERVERS.map((n) => cfg?.mcpServers?.[n]).filter(Boolean)
  const running = (await runningServers()).length
  if (!entries.length) return { available: false, enabled: false, running }
  return { available: true, enabled: entries.some((e) => e?.disabled !== true), running }
}

export async function setBrowserMcp(on: boolean): Promise<BrowserMcpStatus> {
  const cfg = await readConfig()
  const servers = cfg?.mcpServers
  if (!cfg || !servers) return browserMcpStatus()
  let changed = false
  for (const name of BROWSER_MCP_SERVERS) {
    const entry = servers[name]
    if (!entry) continue
    if (on && entry.disabled !== undefined) {
      delete entry.disabled
      changed = true
    } else if (!on && entry.disabled !== true) {
      entry.disabled = true
      changed = true
    }
  }
  if (changed) await writeFile(configPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  if (!on) {
    // tree kill: chrome-devtools-mcp's watchdog and any Chrome it opened go too
    for (const pid of await runningServers()) {
      await execFileAsync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }).catch(
        () => undefined
      )
    }
  }
  return browserMcpStatus()
}
