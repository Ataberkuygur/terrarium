// ── CliBrand — which agent CLI a terminal runs, at a glance ──────────
// Small inline marks (no image assets) keyed off the terminal's bound
// command: `claude --resume x` → Claude, `C:\…\codex.cmd` → Codex, an
// unbound pane → the platform shell. Unknown CLIs get a tinted monogram,
// so every terminal still shows *something* recognisable.

import type { ReactNode } from 'react'
import { SquareTerminal } from 'lucide-react'

export interface CliBrandInfo {
  id: string
  label: string
  color: string
  mark: (size: number) => ReactNode
}

const monogram =
  (text: string, color: string) =>
  (size: number): ReactNode => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="0.5" y="0.5" width="15" height="15" rx="4" fill={color} fillOpacity="0.18" stroke={color} strokeOpacity="0.55" />
      <text
        x="8"
        y="11.3"
        textAnchor="middle"
        fontSize={text.length > 1 ? 7.5 : 9.5}
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
        fill={color}
      >
        {text}
      </text>
    </svg>
  )

/** Radial burst — the Claude mark's silhouette. */
function burst(color: string, rays = 12) {
  return (size: number): ReactNode => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <g stroke={color} strokeWidth="1.9" strokeLinecap="round">
        {Array.from({ length: rays }, (_, i) => {
          const a = (i / rays) * Math.PI * 2
          const r1 = 1.6
          const r2 = i % 2 ? 6.2 : 7.3
          return (
            <line
              key={i}
              x1={8 + Math.cos(a) * r1}
              y1={8 + Math.sin(a) * r1}
              x2={8 + Math.cos(a) * r2}
              y2={8 + Math.sin(a) * r2}
            />
          )
        })}
      </g>
    </svg>
  )
}

/** Six interlocked petals — reads as the OpenAI knot at 14px. */
function knot(color: string) {
  return (size: number): ReactNode => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <g fill="none" stroke={color} strokeWidth="1.3">
        {Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} cx="8" cy="4.9" rx="2.4" ry="3.4" transform={`rotate(${i * 60} 8 8)`} />
        ))}
      </g>
    </svg>
  )
}

/** Four-point sparkle (Gemini). */
function sparkle(color: string) {
  return (size: number): ReactNode => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 0.8 C8.6 5.2 10.8 7.4 15.2 8 C10.8 8.6 8.6 10.8 8 15.2 C7.4 10.8 5.2 8.6 0.8 8 C5.2 7.4 7.4 5.2 8 0.8Z" fill={color} />
    </svg>
  )
}

/** Isometric cube outline (Cursor). */
function cube(color: string) {
  return (size: number): ReactNode => (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <g fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round">
        <path d="M8 1.2 14 4.6 14 11.4 8 14.8 2 11.4 2 4.6Z" />
        <path d="M2 4.6 8 8 14 4.6 M8 8 8 14.8" />
      </g>
    </svg>
  )
}

const shell: CliBrandInfo = {
  id: 'shell',
  label: 'Shell',
  color: '#83858d',
  mark: (size) => <SquareTerminal size={size} strokeWidth={1.75} color="#a9abb3" aria-hidden />
}

const BRANDS: Record<string, CliBrandInfo> = {
  claude: { id: 'claude', label: 'Claude Code', color: '#d97757', mark: burst('#d97757') },
  codex: { id: 'codex', label: 'Codex', color: '#e8e8ea', mark: knot('#e8e8ea') },
  devin: { id: 'devin', label: 'Devin', color: '#3ecf8e', mark: monogram('D', '#3ecf8e') },
  cursor: { id: 'cursor', label: 'Cursor', color: '#d6d6db', mark: cube('#d6d6db') },
  gemini: { id: 'gemini', label: 'Gemini', color: '#6b9bff', mark: sparkle('#6b9bff') },
  opencode: { id: 'opencode', label: 'OpenCode', color: '#c9f25e', mark: monogram('oc', '#c9f25e') },
  cline: { id: 'cline', label: 'Cline', color: '#ff8a3d', mark: monogram('C', '#ff8a3d') },
  aider: { id: 'aider', label: 'Aider', color: '#ff6b6b', mark: monogram('A', '#ff6b6b') },
  qoder: { id: 'qoder', label: 'Qoder', color: '#2dd4bf', mark: monogram('Q', '#2dd4bf') },
  muse: { id: 'muse', label: 'Muse', color: '#e879f9', mark: monogram('M', '#e879f9') },
  amp: { id: 'amp', label: 'Amp', color: '#f5a524', mark: monogram('A', '#f5a524') },
  copilot: { id: 'copilot', label: 'Copilot', color: '#a78bfa', mark: monogram('Co', '#a78bfa') }
}

const ALIASES: Record<string, string> = {
  'claude-code': 'claude',
  'cursor-agent': 'cursor',
  gh: 'copilot'
}

const SHELLS = new Set(['powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'fish', 'nu', 'wsl'])

/** Brand for a bound command ('' / undefined → the shell). */
export function cliBrand(command: string | undefined): CliBrandInfo {
  const first = command?.trim().split(/\s+/)[0] ?? ''
  if (!first) return shell
  const base = first
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs)$/, '')
  const key = ALIASES[base] ?? base
  if (BRANDS[key]) return BRANDS[key]
  if (SHELLS.has(key)) return shell
  // npx/bunx wrappers: `npx @openai/codex` → look at the package
  const pkg = command?.match(/(?:@[\w-]+\/)?([\w-]+)(?:@[\w.-]+)?\s*$/)?.[1]?.toLowerCase()
  if (pkg && BRANDS[ALIASES[pkg] ?? pkg]) return BRANDS[ALIASES[pkg] ?? pkg]
  const letter = key.replace(/[^a-z]/g, '').slice(0, 1).toUpperCase() || '?'
  return { id: key, label: base, color: '#a9abb3', mark: monogram(letter, '#a9abb3') }
}

/** Mark + name, for card headers. */
export function CliBrandBadge({ command, size = 14 }: { command: string | undefined; size?: number }) {
  const b = cliBrand(command)
  return (
    <span className="flex items-center gap-1.5" title={command?.trim() || b.label}>
      <span className="flex shrink-0 items-center">{b.mark(size)}</span>
      <span className="text-[11.5px] font-medium leading-none" style={{ color: b.color }}>
        {b.label}
      </span>
    </span>
  )
}
