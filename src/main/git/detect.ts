// ── detect.ts — find agent CLIs on PATH + WSL presence ───────────────
// Windows-first: where.exe for resolution, cmd.exe to run .cmd/.bat shims,
// UTF-16-aware decoding for wsl.exe output.

import { spawn } from 'node:child_process'
import path from 'node:path'

export interface AgentCliInfo {
  name: string
  /** resolved executable path; null when not found on PATH */
  path: string | null
  /** parsed `--version` output; null when absent/failed/timed out */
  version: string | null
  /** null when not found */
  kind: 'cmd-shim' | 'exe' | null
}

export interface WslInfo {
  present: boolean
  /** trimmed `wsl.exe --status` output when available */
  status: string | null
}

export interface DetectResult {
  platform: NodeJS.Platform
  agents: AgentCliInfo[]
  wsl: WslInfo
}

export const AGENT_CLI_NAMES = [
  'claude',
  'codex',
  'devin',
  'aider',
  'opencode',
  'gemini',
  'cursor-agent',
  'copilot',
  'grok',
  'muse',
  'qoder'
] as const

export type AgentCliName = (typeof AGENT_CLI_NAMES)[number]

interface CmdResult {
  code: number
  stdout: string
  stderr: string
}

/** wsl.exe (and some installers) emit UTF-16LE — sniff NULs/BOM. */
function decode(buf: Buffer): string {
  if (buf.length >= 2 && (buf[0] === 0xff && buf[1] === 0xfe)) {
    return buf.subarray(2).toString('utf16le')
  }
  const head = buf.subarray(0, Math.min(buf.length, 512))
  if (head.includes(0)) return buf.toString('utf16le')
  return buf.toString('utf8')
}

/** spawn wrapper — never throws; code -1 spawn fail, -2 timeout. */
function runCmd(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; shell?: boolean } = {}
): Promise<CmdResult> {
  const { timeoutMs = 10_000, shell = false } = opts
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        windowsHide: true,
        shell,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) })
      return
    }
    const out: Buffer[] = []
    const errBuf: Buffer[] = []
    let settled = false
    let timedOut = false
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code,
        stdout: decode(Buffer.concat(out)),
        stderr: decode(Buffer.concat(errBuf))
      })
    }
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            try {
              child.kill('SIGKILL')
            } catch {
              /* already dead */
            }
          }, timeoutMs)
        : undefined
    timer?.unref?.()
    child.stdout?.on('data', (d: Buffer) => out.push(d))
    child.stderr?.on('data', (d: Buffer) => errBuf.push(d))
    child.on('error', (err) => {
      errBuf.push(Buffer.from(String(err)))
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? (timedOut ? -2 : -1)))
  })
}

/** `where.exe <name>` on Windows, `which` elsewhere → resolved candidates. */
async function locateOnPath(name: string): Promise<string[]> {
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
  const r = await runCmd(cmd, [name], { timeoutMs: 5_000 })
  if (r.code !== 0) return []
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function classify(p: string): 'cmd-shim' | 'exe' {
  return /\.(cmd|bat)$/i.test(p) ? 'cmd-shim' : 'exe'
}

const VERSION_RE = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]*)?/

/**
 * Capture `--version` (5s timeout, absence tolerated). .cmd/.bat shims must
 * be run through cmd.exe — spawn() cannot exec batch files directly.
 */
async function captureVersion(binPath: string, kind: 'cmd-shim' | 'exe'): Promise<string | null> {
  const useShell = kind === 'cmd-shim' && process.platform === 'win32'
  const r = useShell
    ? await runCmd(`"${binPath}" --version`, [], { timeoutMs: 5_000, shell: true })
    : await runCmd(binPath, ['--version'], { timeoutMs: 5_000 })
  if (r.code !== 0) return null
  const text = `${r.stdout}\n${r.stderr}`.trim() // some CLIs print to stderr
  const m = VERSION_RE.exec(text)
  return m ? m[0] : text.split(/\r?\n/)[0]?.slice(0, 80) || null
}

/** Detect a single agent CLI. Missing CLIs return {path:null,...}. */
export async function detectAgentCli(name: AgentCliName): Promise<AgentCliInfo> {
  const hits = await locateOnPath(name)
  if (hits.length === 0) return { name, path: null, version: null, kind: null }
  // first hit is what PATH resolution would actually execute; prefer a
  // directly-spawnable candidate (.exe/.cmd/.bat) when the first is exotic
  const spawnable = hits.find((h) => /\.(exe|cmd|bat)$/i.test(h))
  const pick = spawnable ?? hits[0]
  const kind = classify(pick)
  const version = await captureVersion(pick, kind)
  return { name, path: pick, version, kind }
}

/** WSL presence via `wsl.exe --status` (nonzero exit = not installed/no distro). */
export async function detectWsl(): Promise<WslInfo> {
  if (process.platform !== 'win32') return { present: false, status: null }
  const r = await runCmd('wsl.exe', ['--status'], { timeoutMs: 8_000 })
  const status = r.stdout.trim() || null
  return { present: r.code === 0, status }
}

/** Probe all known agent CLIs in parallel + WSL. Never throws per-probe. */
export async function detectAgentClis(): Promise<DetectResult> {
  const [agents, wsl] = await Promise.all([
    Promise.all(AGENT_CLI_NAMES.map((n) => detectAgentCli(n).catch(() => ({
      name: n,
      path: null,
      version: null,
      kind: null
    }) as AgentCliInfo))),
    detectWsl().catch(() => ({ present: false, status: null }) as WslInfo)
  ])
  return { platform: process.platform, agents, wsl }
}

/** helper for callers that only want CLIs that are actually installed */
export function installedOnly(agents: AgentCliInfo[]): AgentCliInfo[] {
  return agents.filter((a) => a.path !== null)
}

export function cliDisplayName(a: AgentCliInfo): string {
  return `${a.name}${a.version ? ` v${a.version}` : ''}${a.path ? ` (${path.basename(a.path)})` : ''}`
}
