import type { Agent, AgentDomain, AgentRole, AgentStatus } from '@shared/types'
import {
  collectLeaves,
  createLeaf,
  deserializePanes,
  findLeaf,
  serializePanes,
  updateLeaf,
  type PaneLeaf,
  type PaneNode
} from './panes'
import { randomLatinName } from './latin-names'
import { scheduleDomainClassification } from './terminal-classify'
import { useApp } from './store'
import { isOrchestrationSid, orchestrationLeaves, useOrch } from './orchestration'

const PANES_STORAGE_KEY = 'terrarium.panes'

export interface TerminalSessionInfo {
  leafId: string
  command?: string
  title?: string
  agentId?: string
  cwd?: string
  attention?: boolean
  dirty?: boolean
}

// Map CLI command name to persona traits
interface CliConfig {
  name: string
  domain: AgentDomain
  role: AgentRole
  hue: number
  brief: string
}

const CLI_CONFIGS: Record<string, CliConfig> = {
  claude: {
    name: 'Claude Code',
    domain: 'frontend',
    role: 'builder',
    hue: 280, // Purple
    brief: 'Anthropic Claude Code CLI — autonomous full-stack development agent'
  },
  codex: {
    name: 'Codex Agent',
    domain: 'backend',
    role: 'builder',
    hue: 38, // Amber
    brief: 'Codex Engine — high-throughput backend architecture & code synthesis'
  },
  clark: {
    name: 'Clark',
    domain: 'design',
    role: 'builder',
    hue: 210, // Blue
    brief: 'Clark UI/UX Agent — design systems, motion & component styling'
  },
  devin: {
    name: 'Devin',
    domain: 'general',
    role: 'lead',
    hue: 150, // Emerald
    brief: 'Devin Autonomous Engineer — project orchestration & end-to-end tasks'
  },
  muse: {
    name: 'Muse',
    domain: 'research',
    role: 'researcher',
    hue: 320, // Magenta
    brief: 'Muse Code — Meta multimodal agent (video, audio & image analysis)'
  },
  cursor: {
    name: 'Cursor Agent',
    domain: 'frontend',
    role: 'builder',
    hue: 240, // Indigo
    brief: 'Cursor CLI Agent — smart refactoring & codebase navigation'
  },
  cline: {
    name: 'Cline',
    domain: 'general',
    role: 'builder',
    hue: 25, // Orange
    brief: 'Cline CLI — autonomous coding agent with plan/act workflow'
  },
  aider: {
    name: 'Aider',
    domain: 'backend',
    role: 'builder',
    hue: 10, // Coral
    brief: 'Aider AI Pair Programmer — git-backed code editing'
  },
  opencode: {
    name: 'OpenCode',
    domain: 'general',
    role: 'builder',
    hue: 100, // Lime
    brief: 'OpenCode — open-source terminal coding agent'
  },
  qoder: {
    name: 'Qoder',
    domain: 'general',
    role: 'builder',
    hue: 170, // Teal
    brief: 'Qoder CLI — Alibaba agentic coding agent (quests, memory & subagents)'
  },
  pwsh: {
    name: 'PowerShell',
    domain: 'general',
    role: 'builder',
    hue: 195, // Cyan
    brief: 'System Terminal — native shell & build pipeline'
  },
  bash: {
    name: 'Bash Shell',
    domain: 'general',
    role: 'builder',
    hue: 190,
    brief: 'UNIX Shell — automation & scripts'
  }
}

function detectCli(command?: string, title?: string): CliConfig {
  const text = `${command ?? ''} ${title ?? ''}`.toLowerCase()
  for (const [key, config] of Object.entries(CLI_CONFIGS)) {
    if (text.includes(key)) {
      return config
    }
  }
  return {
    name: title || 'Terminal Shell',
    domain: 'general',
    role: 'builder',
    hue: 185,
    brief: 'Interactive Terminal Session'
  }
}

/**
 * Reads all terminal leaves currently active in the workspace.
 * If no leaves exist, seeds an initial Claude Code terminal.
 */
export function getWorkspaceTerminalLeaves(): PaneLeaf[] {
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    if (raw) {
      const tree = deserializePanes(raw)
      if (tree) {
        const leaves = collectLeaves(tree).filter((l) => l.kind === 'terminal')
        if (leaves.length > 0) {
          // Office/board never mount the workspace view — kick the domain
          // classifier here so terminals still get their work area.
          scheduleDomainClassification(leaves)
          return leaves
        }
      }
    }
  } catch {
    /* ignore parse errors */
  }

  // Fallback: seed initial terminal leaf
  const initial = createLeaf('terminal', {
    command: 'claude',
    title: randomLatinName(new Set())
  })
  try {
    localStorage.setItem(PANES_STORAGE_KEY, serializePanes(initial))
  } catch {
    /* ignore */
  }
  return [initial]
}

/**
 * Workspace grid terminals + every orchestration-network terminal — what the
 * office, the board and the sessions rail list. (getWorkspaceTerminalLeaves
 * stays grid-only: pane-tree mutations must never see network nodes.)
 */
export function getAllTerminalLeaves(): PaneLeaf[] {
  let grid: PaneLeaf[] = []
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    const tree = raw ? deserializePanes(raw) : null
    grid = tree ? collectLeaves(tree).filter((l) => l.kind === 'terminal') : []
  } catch {
    grid = []
  }
  const net = orchestrationLeaves()
  // an empty grid still seeds its starter terminal when nothing else exists
  if (grid.length === 0 && net.length === 0) return getWorkspaceTerminalLeaves()
  if (grid.length) scheduleDomainClassification(grid)
  return [...grid, ...net]
}

/**
 * Converts workspace terminal leaves into 3D Office Agent objects.
 */
export function terminalLeavesToAgents(leaves: PaneLeaf[]): Agent[] {
  const crew = useApp.getState().agents
  return leaves.map((leaf, index) => {
    const cli = detectCli(leaf.command, leaf.title)
    const agentId = leaf.agentId || leaf.id

    // Status: working if dirty/active, waiting if attention needed, idle otherwise
    let status: AgentStatus = 'working'
    if (leaf.attention) status = 'waiting'
    else if (!leaf.dirty && leaf.command === undefined) status = 'idle'

    // Work area: a bound crew agent's declared domain wins, then the
    // classifier's leaf.domain, then the CLI's built-in guess.
    const boundDomain = leaf.agentId
      ? crew.find((a) => a.id === leaf.agentId)?.domain
      : undefined

    return {
      id: agentId,
      name: leaf.title || cli.name,
      domain: boundDomain ?? leaf.domain ?? cli.domain,
      role: cli.role,
      brief: cli.brief,
      status,
      deskId: `desk-${index}`,
      taskId: leaf.command || leaf.title || 'Interactive Session',
      hue: cli.hue,
      lastActiveAt: Date.now()
    }
  })
}

/**
 * Spawns a new terminal session agent in the workspace and updates localStorage.
 */
export function spawnTerminalAgent(
  cliKey: string,
  customCommand?: string,
  customName?: string
): string {
  const command = customCommand ?? cliKey

  // Live titles — the new worker's name must not collide with them.
  const taken = new Set<string>()
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    const t = raw ? deserializePanes(raw) : null
    for (const l of t ? collectLeaves(t) : []) {
      if (l.title) taken.add(l.title)
    }
  } catch {
    /* ignore */
  }
  const title = customName?.trim() || randomLatinName(taken)

  const newLeaf = createLeaf('terminal', {
    command,
    title
  })

  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    let tree: PaneNode | null = null
    if (raw) {
      tree = deserializePanes(raw)
    }

    if (!tree) {
      tree = newLeaf
    } else {
      // Split with the last leaf or root
      const leaves = collectLeaves(tree)
      const target = leaves[leaves.length - 1]
      if (target) {
        // Create binary split
        const splitNode: PaneNode = {
          type: 'split',
          id: `split-${Date.now()}`,
          dir: 'row',
          ratio: 0.5,
          a: target,
          b: newLeaf
        }
        // Replace target in tree with splitNode
        const replaceInTree = (node: PaneNode): PaneNode => {
          if (node.id === target.id) return splitNode
          if (node.type === 'split') {
            return {
              ...node,
              a: replaceInTree(node.a),
              b: replaceInTree(node.b)
            }
          }
          return node
        }
        tree = replaceInTree(tree)
      } else {
        tree = newLeaf
      }
    }

    localStorage.setItem(PANES_STORAGE_KEY, serializePanes(tree))
    window.dispatchEvent(new CustomEvent('terrarium:panes-updated'))
    window.dispatchEvent(new StorageEvent('storage', { key: PANES_STORAGE_KEY }))
  } catch (err) {
    console.error('Failed to spawn terminal agent:', err)
  }

  return newLeaf.id
}

/**
 * Renames a terminal leaf — the board lets the user name each terminal,
 * and the title is what crews, panes and the office all display.
 */
export function renameTerminalLeaf(leafId: string, title: string): void {
  if (isOrchestrationSid(leafId)) {
    useOrch.getState().updateNode(leafId, { title: title.trim() || undefined })
    return
  }
  try {
    const raw = localStorage.getItem(PANES_STORAGE_KEY)
    const tree = raw ? deserializePanes(raw) : null
    if (!tree) return
    const next = updateLeaf(tree, leafId, { title: title.trim() || undefined })
    if (!next) return
    localStorage.setItem(PANES_STORAGE_KEY, serializePanes(next))
    window.dispatchEvent(new CustomEvent('terrarium:panes-updated'))
    window.dispatchEvent(new StorageEvent('storage', { key: PANES_STORAGE_KEY }))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** CLIs the board's "new terminal" dialog offers — key → display name. */
export const LAUNCHABLE_CLIS: { key: string; label: string }[] = [
  { key: 'devin', label: 'Devin' },
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'cline', label: 'Cline' },
  { key: 'muse', label: 'Muse' },
  { key: 'qoder', label: 'Qoder' },
  { key: 'pwsh', label: 'PowerShell' }
]
