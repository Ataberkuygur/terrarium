import type { Agent, AgentDomain, AgentRole } from '@shared/types'

/** One-line role descriptions shown under the segmented picker and in menus. */
export const ROLE_INFO: Record<AgentRole, { label: string; blurb: string }> = {
  lead: { label: 'Lead', blurb: 'Splits work, reviews output, keeps the board honest.' },
  builder: { label: 'Builder', blurb: 'Writes code in isolated worktrees.' },
  reviewer: { label: 'Reviewer', blurb: 'Reads diffs before they reach you.' },
  researcher: { label: 'Researcher', blurb: 'Digs through docs and prior art so builders never guess.' },
  designer: { label: 'Designer', blurb: 'Motion, spacing, contrast — keeps the interface honest.' },
  scribe: { label: 'Scribe', blurb: 'Turns merged work into docs that teach.' }
}

export const ROLE_ORDER: AgentRole[] = [
  'lead',
  'builder',
  'reviewer',
  'researcher',
  'designer',
  'scribe'
]

/** Short labels + one-line blurbs for the domain picker (AgentEditor). */
export const DOMAIN_INFO: Record<AgentDomain, { label: string; blurb: string }> = {
  frontend: { label: 'Frontend', blurb: 'Interfaces, styling, motion — what users see and touch.' },
  backend: { label: 'Backend', blurb: 'APIs, data, infra — the machinery under the interface.' },
  marketing: { label: 'Marketing', blurb: 'Growth, copy, campaigns — getting the word out.' },
  design: { label: 'Design', blurb: 'Visual language, spacing, contrast — how it feels.' },
  research: { label: 'Research', blurb: 'Docs, prior art, investigation — answers before code.' },
  legal: { label: 'Legal', blurb: 'Licenses, compliance, contracts — reads the fine print.' },
  general: { label: 'General', blurb: 'No fixed lane — coordinates and fills gaps anywhere.' }
}

export const DOMAIN_ORDER: AgentDomain[] = [
  'frontend',
  'backend',
  'marketing',
  'design',
  'research',
  'legal',
  'general'
]

/** Eight preset accent hues, spread to stay distinguishable on dark. */
export const HUE_PRESETS: number[] = [38, 10, 95, 150, 190, 210, 280, 330]

/**
 * The default six-persona crew — same names/hues as the demo seed in
 * `lib/seed.ts`. Spawned idle; the engine assigns desks on first run.
 */
export const DEFAULT_CREW: Agent[] = [
  {
    id: 'ag-fermat',
    name: 'Fermat',
    domain: 'general',
    role: 'lead',
    brief: 'Crew lead. Splits work, reviews output, keeps the board honest.',
    status: 'idle',
    deskId: 'desk-0',
    taskId: null,
    hue: 38,
    lastActiveAt: Date.now()
  },
  {
    id: 'ag-laplace',
    name: 'Laplace',
    domain: 'backend',
    role: 'builder',
    brief: 'Full-stack builder. Fast on scaffolds, careful on migrations.',
    status: 'idle',
    deskId: 'desk-1',
    taskId: null,
    hue: 210,
    lastActiveAt: Date.now()
  },
  {
    id: 'ag-gauss',
    name: 'Gauss',
    domain: 'backend',
    role: 'reviewer',
    brief: 'Reviews diffs before they reach you. Harsh on edge cases.',
    status: 'idle',
    deskId: 'desk-2',
    taskId: null,
    hue: 150,
    lastActiveAt: Date.now()
  },
  {
    id: 'ag-popper',
    name: 'Popper',
    domain: 'research',
    role: 'researcher',
    brief: 'Digs through docs and prior art so builders never guess.',
    status: 'idle',
    deskId: 'desk-3',
    taskId: null,
    hue: 280,
    lastActiveAt: Date.now()
  },
  {
    id: 'ag-anscombe',
    name: 'Anscombe',
    domain: 'design',
    role: 'designer',
    brief: 'Keeps the interface honest. Motion, spacing, contrast.',
    status: 'idle',
    deskId: 'desk-4',
    taskId: null,
    hue: 10,
    lastActiveAt: Date.now()
  },
  {
    id: 'ag-singer',
    name: 'Singer',
    domain: 'general',
    role: 'scribe',
    brief: 'Writes the wiki. Turns merged work into docs that teach.',
    status: 'idle',
    deskId: 'desk-5',
    taskId: null,
    hue: 190,
    lastActiveAt: Date.now()
  }
]
