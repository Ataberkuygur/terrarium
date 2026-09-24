// ── FocusDock — supervise an agent without leaving the office ────────
// Selecting a character slides this dock up from the bottom of the 3D
// canvas: a real Chat thread or a live shell bound to that agent, in the
// strip to the right of the crew rail. Both tabs reuse the
// workspace's own pane bodies — ChatPane takes a fabricated chat leaf;
// Terminal attaches to a `focus-<agentId>` pty session that outlives the
// dock itself (closing detaches; reopening re-attaches with a scrollback
// replay). Esc clears the selection — xterm keeps Esc for itself so
// vim/readline still work. The top grip drags the dock's height; the left
// edge drags its width (both clamped to the viewport).

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Maximize2, MessageSquare, Moon, TerminalSquare, Trash2, X, Zap, type LucideIcon } from 'lucide-react'
import type { Agent, AgentDomain } from '@shared/types'
import { createLeaf } from '../lib/panes'
import { ChatPane } from './ChatPane'
import { Terminal, getPtyBridge } from '../terminal'
import { getEngine } from '../lib/ipc'
import { paneBridgeCmdUrl } from '../lib/pane-bridge'
import { keyTick, paneClose, paneSplit } from '../lib/sfx'
import { useApp } from '../lib/store'
import { StatusDot } from '../components/StatusDot'
import { Button, Kbd, Tooltip, cx } from '../components/ui'

// mirrors DOMAIN_META in views/OfficeView.tsx — the only chromatic accents
// allowed on overlays besides status hues
const DOMAIN_META: Record<AgentDomain, { label: string; color: string }> = {
  general: { label: 'general', color: '#94a3b8' },
  frontend: { label: 'frontend', color: '#7dd3fc' },
  backend: { label: 'backend', color: '#fbbf24' },
  design: { label: 'design', color: '#c084fc' },
  research: { label: 'research', color: '#4ade80' },
  marketing: { label: 'marketing', color: '#f472b6' },
  legal: { label: 'legal', color: '#facc15' }
}

// mirrors STATUS_TEXT in ChatPane — status dot + word in the header
const STATUS_TEXT: Record<Agent['status'], string> = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  idle: 'idle',
  offline: 'offline'
}

type DockTab = 'chat' | 'terminal'

const TABS: ReadonlyArray<{ id: DockTab; label: string; icon: LucideIcon }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare }
]

const MIN_H = 150
const DEFAULT_H = 232
const MIN_W = 420
const DEFAULT_L = 240

// ── terminal output → typing ticks ───────────────────────────────────
// Same token bucket as lib/render-leaf.tsx (~14 ticks/sec sustained,
// 3-tick bursts) so dock output sounds like pane output — one soundscape.
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
// Terminal I/O is proof of life — mirrors the throttled touchAgent in
// lib/render-leaf.tsx (one engine call per agent per 2s).
const lastTouch = new Map<string, number>()

function agentHeartbeat(agentId: string | undefined): void {
  if (!agentId) return
  const now = Date.now()
  const prev = lastTouch.get(agentId) ?? 0
  if (now - prev < 2000) return
  lastTouch.set(agentId, now)
  void getEngine().touchAgent(agentId).catch(() => {})
}

export function FocusDock({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const reduceMotion = useReducedMotion()
  const [tab, setTab] = useState<DockTab>('chat')
  const [height, setHeight] = useState(DEFAULT_H)
  // left inset — the crew rail sits beneath; dragging the dock's left edge
  // widens/narrows it (right edge stays pinned at 12px)
  const [leftInset, setLeftInset] = useState(DEFAULT_L)
  const openAgentChat = useApp((s) => s.openAgentChat)
  const openAgentTerminal = useApp((s) => s.openAgentTerminal)
  const projectRoot = useApp((s) => s.projects[0]?.rootPath)
  const cards = useApp((s) => s.cards)
  const domain = DOMAIN_META[agent.domain] ?? DOMAIN_META.general

  // the agent's current card — with the inspector gone the dock alone
  // answers "what is it doing" (taskId is null when unassigned)
  const task = agent.taskId ? cards.find((c) => c.id === agent.taskId) : undefined

  // Fabricated leaf — ChatPane threads by leaf.agentId; the per-agent id
  // keeps its (inert outside WorkspaceView) dispatch calls well-formed.
  const chatLeaf = useMemo(
    () =>
      createLeaf('chat', {
        id: `focus-chat-${agent.id}`,
        title: agent.name,
        agentId: agent.id
      }),
    [agent.id, agent.name]
  )
  const sessionId = `focus-${agent.id}`

  // open/close ticks — the same sounds the workspace panes make
  useEffect(() => {
    paneSplit()
    return () => paneClose()
  }, [])

  // Esc closes — bubble phase, and presses aimed at xterm are skipped so
  // the shell keeps Esc for itself. (OfficeScene's own Esc→deselect covers
  // clicks on the canvas; this also fires from the chat composer.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      if (el?.closest('.xterm')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // top grip → resize height; drag up grows, down shrinks (viewport-clamped)
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const prevUserSelect = document.documentElement.style.userSelect
    document.documentElement.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => {
      const maxH = Math.min(640, window.innerHeight * 0.65)
      setHeight(Math.min(maxH, Math.max(MIN_H, startH + (startY - ev.clientY))))
    }
    const onUp = () => {
      document.documentElement.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // left edge → resize width (right edge pinned; never narrower than MIN_W)
  const startWidthDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startL = leftInset
    const prevUserSelect = document.documentElement.style.userSelect
    document.documentElement.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: PointerEvent) => {
      const maxL = Math.max(8, window.innerWidth - MIN_W - 12)
      setLeftInset(Math.min(maxL, Math.max(8, startL + (ev.clientX - startX))))
    }
    const onUp = () => {
      document.documentElement.style.userSelect = prevUserSelect
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const nudge = () => void getEngine().nudgeAgent(agent.id, 'checking in — status?')
  const openInWorkspace = () =>
    tab === 'chat' ? openAgentChat(agent.id) : openAgentTerminal(agent.id)

  // Remove — same crew-draft event the CrewModal announces on (the store
  // listener routes it to engine.removeAgent). Two-click arm so a stray
  // tap can't drop an agent.
  const [armRemove, setArmRemove] = useState(false)
  useEffect(() => {
    if (!armRemove) return
    const t = window.setTimeout(() => setArmRemove(false), 2500)
    return () => window.clearTimeout(t)
  }, [armRemove])
  const remove = () => {
    if (!armRemove) {
      setArmRemove(true)
      return
    }
    window.dispatchEvent(
      new CustomEvent('terrarium:crew-draft', { detail: { intent: 'remove', agent } })
    )
    onClose()
  }

  return (
    <motion.section
      aria-label={`${agent.name} — focus dock`}
      initial={{ y: reduceMotion ? 0 : '112%', opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: reduceMotion ? 0 : '112%', opacity: 0 }}
      transition={
        reduceMotion ? { duration: 0.12 } : { type: 'spring', stiffness: 380, damping: 36 }
      }
      style={{ height, left: leftInset, right: 12 }}
      className="absolute bottom-3 z-20 flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-popover/95 shadow-[var(--shadow-pop)] backdrop-blur-xl backdrop-saturate-150"
    >
      {/* left-edge width grip — drag to resize horizontally */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize dock width"
        title="Drag to resize"
        onPointerDown={startWidthDrag}
        className="group/wd absolute inset-y-0 -left-1 z-10 w-[7px] cursor-col-resize touch-none"
      >
        <span className="absolute inset-y-0 left-[3px] w-px bg-transparent transition-colors group-hover/wd:bg-[var(--border-strong)] group-active/wd:bg-[var(--color-accent)]" />
      </div>

      {/* resize grip — drag up to grow, down to shrink (viewport-clamped) */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize dock"
        title="Drag to resize"
        onPointerDown={startResize}
        className="pane-head group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center select-none"
      >
        <span className="h-[3px] w-9 rounded-full bg-[var(--border-default)] transition-colors group-hover:bg-[var(--border-strong)] group-active:bg-[var(--color-accent)]" />
      </div>

      {/* header — identity + tab switch + actions */}
      <header className="pane-head flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pr-1.5 pl-3 select-none">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            background: `hsl(${agent.hue} 70% 62%)`,
            boxShadow: `0 0 8px hsl(${agent.hue} 70% 62% / 0.45)`
          }}
        />
        <span className="min-w-0 truncate text-[12.5px] font-semibold tracking-[-0.01em] text-t1">{agent.name}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-t3">
          <StatusDot status={agent.status} size={6} />
          {STATUS_TEXT[agent.status]}
        </span>
        {agent.sleeping && <Moon size={10} className="shrink-0 text-t4" aria-label="sleeping" />}
        <span
          className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-n3 px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: domain.color }}
        >
          {domain.label}
        </span>
        {task && <span className="min-w-0 truncate text-[11px] text-t4">· {task.title}</span>}

        {/* tab switch — segmented, mirrors the workspace preset bar */}
        <div className="seg-track ml-1 shrink-0">
          <span
            aria-hidden
            className="seg-thumb"
            style={{
              left: 2,
              width: 80,
              transform: `translateX(${TABS.findIndex((t) => t.id === tab) * 80}px)`
            }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cx(
                'relative z-[1] flex h-[24px] w-[80px] items-center justify-center gap-1.5 rounded-[7px] text-[11.5px] font-medium transition-colors duration-150',
                tab === t.id ? 'text-t1' : 'text-t3 hover:text-t2'
              )}
            >
              <t.icon
                size={12}
                strokeWidth={tab === t.id ? 2 : 1.75}
                className={tab === t.id ? 'text-accent' : undefined}
              />
              {t.label}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        <Tooltip content="Nudge — 'checking in, status?'" side="bottom">
          <button
            type="button"
            onClick={nudge}
            className="btn-accent-soft flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
          >
            <Zap size={11} />
            Nudge
          </button>
        </Tooltip>
        <Tooltip content="Open in workspace" side="bottom">
          <Button variant="secondary" size="sm" onClick={openInWorkspace}>
            <Maximize2 size={12} />
            Workspace
          </Button>
        </Tooltip>
        <Tooltip
          content={armRemove ? `Remove ${agent.name} — click again to confirm` : 'Remove agent'}
          side="bottom"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            aria-label={`Remove ${agent.name}`}
            className={armRemove ? 'text-[var(--color-needs)]' : undefined}
          >
            <Trash2 size={13} />
          </Button>
        </Tooltip>
        <Tooltip
          content={
            <>
              Close <Kbd>Esc</Kbd>
            </>
          }
          side="bottom"
        >
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dock">
            <X size={13} />
          </Button>
        </Tooltip>
      </header>

      {/* body — same content components the workspace panes render; keys
          force a remount per agent so drafts/sessions never leak across */}
      <div className="min-h-0 flex-1 bg-n1">
        {tab === 'chat' ? (
          <ChatPane key={agent.id} leaf={chatLeaf} />
        ) : (
          <Terminal
            key={agent.id}
            bridge={getPtyBridge()}
            sessionId={sessionId}
            fontSize={13.5}
            onData={() => {
              terminalDataTick()
              agentHeartbeat(agent.id)
            }}
            spawnOpts={{
              sessionId,
              cwd: projectRoot ?? '.',
              env: {
                TERRARIUM_SID: sessionId,
                ...(paneBridgeCmdUrl()
                  ? {
                      TERRARIUM_BROWSER_CMD: paneBridgeCmdUrl()!,
                      TERRARIUM_WS_CMD: paneBridgeCmdUrl()!
                    }
                  : {})
              },
              command: window.terrarium?.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
            }}
          />
        )}
      </div>
    </motion.section>
  )
}

export default FocusDock
