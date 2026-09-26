import { commandSessionId, type PaneLeaf } from './panes'
import { EmptyPane } from '../workspace/EmptyPane'
import { ChatPane } from '../workspace/ChatPane'
import { BrowserPane } from '../workspace/BrowserPane'
import { Terminal, getPtyBridge } from '../terminal'
import { keyTick } from './sfx'
import { getEngine } from './ipc'
import { paneBridgeCmdUrl } from './pane-bridge'
import { useApp } from './store'
import { useCanvasZoom } from './canvas-nav'
import { noteTerminalOutput, noteTerminalTitle } from './live-cli'
import { noteResumeBounce } from './resume-redirect'
import { leafSpawnCommand, useLeafResume } from './workspace-resume'
import type { ComponentProps } from 'react'

// ── terminal output → typing ticks ───────────────────────────────────
// Live pty output sounds like distant typing. A module-level token bucket
// (~14 ticks/sec sustained, 3-tick bursts) coalesces big writes into a
// patter rather than a buzz — one soundscape shared across all panes.
// (keyTick itself no-ops while audio is locked/muted, and swallows
// bursts tighter than 18ms as a second line of defense.)
const TICKS_PER_SEC = 14
const TICK_BURST = 3
let tickTokens = TICK_BURST
let tickFilledAt = 0

function terminalDataTick(): void {
  const now = performance.now()
  if (tickFilledAt === 0) tickFilledAt = now
  tickTokens = Math.min(TICK_BURST, tickTokens + ((now - tickFilledAt) / 1000) * TICKS_PER_SEC)
  tickFilledAt = now
  if (tickTokens < 1) return
  tickTokens -= 1
  keyTick(0.4 + Math.random() * 0.3)
}

// ── agent heartbeat ──────────────────────────────────────────────────
// Terminal I/O on an agent-bound pane is proof of life: bump the agent's
// last_active_at so it never enters (or instantly leaves) `sleeping`.
// Throttled to one engine call per agent per 2s — output bursts are huge.
const lastTouch = new Map<string, number>()

function agentHeartbeat(agentId: string | undefined): void {
  if (!agentId) return
  const now = Date.now()
  const prev = lastTouch.get(agentId) ?? 0
  if (now - prev < 2000) return
  lastTouch.set(agentId, now)
  void getEngine().touchAgent(agentId).catch(() => {})
}

// ── session id ← command binding ─────────────────────────────────────
// commandSessionId lives in ./panes (shared with BrowserPane's boundSid
// lookup). Re-exported here for existing callers.
export { commandSessionId }

/**
 * `PtySpawnOpts.command` is a single executable (where.exe-resolved on
 * Windows) — split a bound string so 'claude --continue' spawns `claude`
 * with args ['--continue'] rather than one unresolvable program name.
 */
function splitCommand(command: string): { command: string; args?: string[] } {
  const parts = command.trim().split(/\s+/)
  return { command: parts[0], args: parts.length > 1 ? parts.slice(1) : undefined }
}

/** Workspace terminal that scales with the canvas zoom (grid held — no pty resize). */
function ZoomTerminal(props: ComponentProps<typeof Terminal>) {
  const z = useCanvasZoom()
  return <Terminal {...props} zoom={z} />
}

/**
 * Grid terminal pane. A pane whose pty died with the machine (reboot, app
 * update) respawns its CLI in the session it was in (lib/workspace-resume);
 * while launch is still resolving those sessions it holds off spawning, or
 * it would race in with a fresh CLI.
 */
function WorkspaceTerminal({ leaf, projectRoot }: { leaf: PaneLeaf; projectRoot?: string }) {
  const { active, restoring } = useLeafResume(leaf)
  const sid = commandSessionId(leaf)
  if (active && restoring) {
    return (
      <div className="grid h-full place-items-center text-[11px] text-t4">Oturum devam ettiriliyor…</div>
    )
  }
  // trimmed like commandSessionId — a blank binding falls back to the
  // platform default rather than spawning an empty program name.
  const run = leafSpawnCommand(
    leaf,
    window.terrarium?.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  )
  // Env for agent CLIs: TERRARIUM_BROWSER_CMD is the tab-bridge-style
  // /cmd endpoint driving the workspace's browser panes; TERRARIUM_SID
  // lets the agent match `tabs` entries by boundSid to find the pane
  // scoped to this terminal.
  const env: Record<string, string> = { TERRARIUM_SID: sid }
  const bridgeCmd = paneBridgeCmdUrl()
  // same loopback /cmd endpoint under both names — BROWSER_CMD is the
  // tab-bridge-compatible alias, WS_CMD advertises workspace control
  if (bridgeCmd) {
    env.TERRARIUM_BROWSER_CMD = bridgeCmd
    env.TERRARIUM_WS_CMD = bridgeCmd
  }
  return (
    <ZoomTerminal
      bridge={getPtyBridge()}
      sessionId={sid}
      onData={(data) => {
        terminalDataTick()
        agentHeartbeat(leaf.agentId)
        // which CLI is on screen now (typed `claude --resume` etc.)
        noteTerminalOutput(leaf, sid)
        // claude bounced a resume to its session's own dir — follow it
        noteResumeBounce(leaf, sid, data, projectRoot)
      }}
      onTitle={(title) => noteTerminalTitle(sid, title)}
      spawnOpts={{
        sessionId: sid,
        cwd: run.cwd?.trim() || leaf.cwd?.trim() || projectRoot || '.',
        env,
        ...splitCommand(run.command)
      }}
    />
  )
}

/**
 * WorkspaceView leaf renderer — binds pane kinds to real content.
 * Terminal leaves get a live pty-backed xterm; the rest keep stub bodies
 * until file/browser/note content ships.
 */
export function useRenderLeaf() {
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  return (leaf: PaneLeaf) => {
    if (leaf.kind === 'terminal') {
      return <WorkspaceTerminal leaf={leaf} projectRoot={projectRoot} />
    }
    if (leaf.kind === 'browser') {
      return <BrowserPane leaf={leaf} />
    }
    if (leaf.kind === 'chat') {
      return <ChatPane leaf={leaf} />
    }
    return <EmptyPane leaf={leaf} />
  }
}
