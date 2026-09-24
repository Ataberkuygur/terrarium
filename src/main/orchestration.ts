// ── orchestration host side — the `tnet` helper ──────────────────────
// Orchestration networks live in the renderer (lib/orchestration.ts) and
// are driven over the pane bridge's net.* commands. This installs a small
// CLI wrapper for those commands under ~/.terrarium/bin — refreshed every
// launch — and tells the renderer the exact PATH key/value so network
// terminals get the bin dir prepended. The wrapper runs the app's own
// binary as Node (ELECTRON_RUN_AS_NODE), so the user needs no Node install.

import { app, ipcMain } from 'electron'
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import tnetSource from './tnet.cjs?raw'

export const ORCH_IPC = { info: 'terrarium:orch:info' } as const

export interface OrchHostInfo {
  binDir: string
  pathKey: string
  pathValue: string
  delimiter: string
  guide: string
}

const GUIDE = `# Terrarium orchestration

You are running inside a Terrarium **orchestration network**: one orchestrator
terminal with subagent terminals tethered around it. Drive them with \`tnet\`
(on PATH in every network terminal):

    tnet spawn --cli claude --name Scout "map the auth flow and list risky spots"
    tnet ls                      # subagents + busy/idle status
    tnet ask Scout "summarise"   # send, wait until quiet, print its screen
    tnet wait all                # block until every subagent is quiet
    tnet read 2 --lines 120      # rendered screen of subagent #2
    tnet kill 2                  # end a subagent

Workflow: give each subagent a self-contained task, \`tnet wait all\`, read each
result, integrate. Subagents share the repo — assign disjoint files/areas.

HTTP equivalent: POST JSON to $TERRARIUM_WS_CMD with {"cmd":"net.<verb>",
"sid":$TERRARIUM_SID, ...}; {"cmd":"net.help"} lists every verb.
MCP: terrarium-mcp exposes orchestrator_info/spawn/send/ask/read/wait/kill.
`

let info: OrchHostInfo | null = null

/**
 * Packaged builds ship terrarium-mcp.exe as an extraResource; copy it to
 * ~/.terrarium/bin so MCP clients get a path that survives app updates
 * (`claude mcp add -s user terrarium -- %USERPROFILE%\.terrarium\bin\terrarium-mcp.exe`).
 */
function installMcpServer(binDir: string): void {
  if (!app.isPackaged) return
  const name = process.platform === 'win32' ? 'terrarium-mcp.exe' : 'terrarium-mcp'
  const src = join(process.resourcesPath, name)
  const dst = join(binDir, name)
  try {
    if (!existsSync(src)) return
    const a = statSync(src)
    if (existsSync(dst)) {
      const b = statSync(dst)
      if (a.size === b.size && b.mtimeMs >= a.mtimeMs) return
    }
    copyFileSync(src, dst)
  } catch (e) {
    // running clients hold the exe open on Windows — next launch retries
    console.warn('[orchestration] terrarium-mcp copy skipped:', e)
  }
}

/** Write the tnet wrappers + guide; safe to call once at app ready. */
export function installOrchestrationTools(home: string): OrchHostInfo | null {
  try {
    const binDir = join(home, 'bin')
    mkdirSync(binDir, { recursive: true })
    const script = join(binDir, 'tnet.cjs')
    writeFileSync(script, tnetSource)
    const exe = process.execPath
    // Windows: PowerShell/cmd resolve `tnet` → tnet.cmd via PATHEXT
    writeFileSync(
      join(binDir, 'tnet.cmd'),
      `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "%~dp0tnet.cjs" %*\r\n`
    )
    // POSIX shells (and Git Bash on Windows)
    const sh = join(binDir, 'tnet')
    writeFileSync(
      sh,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe.replace(/\\/g, '/')}" "$(dirname "$0")/tnet.cjs" "$@"\n`
    )
    try {
      chmodSync(sh, 0o755)
    } catch {
      /* no chmod on this fs */
    }
    installMcpServer(binDir)
    const guide = join(home, 'ORCHESTRATOR.md')
    writeFileSync(guide, GUIDE)
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    info = { binDir, pathKey, pathValue: process.env[pathKey] ?? '', delimiter, guide }
  } catch (e) {
    console.warn('[orchestration] tnet install failed:', e)
    info = null
  }
  ipcMain.handle(ORCH_IPC.info, () => info)
  return info
}
