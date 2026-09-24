// ── first-run seed ───────────────────────────────────────────────────
// Fresh installs get the project row and nothing else — the user builds
// their own crew (onboarding / crew modal), their own cards, their own
// docs. The earlier build seeded a nine-agent demo office (Fermat,
// Laplace, …) plus demo cards/runs/wiki; that placeholder data is purged
// from existing databases by the v2 migration in engine.seedIfNeeded.

import { homedir } from 'node:os'
import type { Agent, Project, Run, TaskCard, WikiPage } from '../../shared/types'

export interface SeedData {
  project: Project
  agents: Agent[]
  cards: TaskCard[]
  runs: Run[]
  wiki: WikiPage[]
}

/**
 * Ids the v1 demo seed wrote. The v2 migration deletes exactly these rows
 * — user-created rows (crew-modal agents, real cards) never match.
 */
export const DEMO_IDS = {
  agents: [
    'ag-fermat',
    'ag-laplace',
    'ag-mira',
    'ag-gauss',
    'ag-popper',
    'ag-anscombe',
    'ag-lux',
    'ag-vigil',
    'ag-singer'
  ],
  cards: [
    'card-1',
    'card-2',
    'card-3',
    'card-4',
    'card-5',
    'card-6',
    'card-7',
    'card-8',
    'card-9'
  ],
  runs: ['run-1', 'run-2', 'run-3', 'run-4'],
  docs: ['wp-home', 'wp-arch', 'wp-office', 'wp-orch', 'wp-pty', 'wp-glossary']
} as const

export function buildSeed(): SeedData {
  return {
    project: {
      id: 'proj-terrarium',
      // onboarding re-points this at the user's real project (setProjectRoot)
      name: 'home',
      rootPath: homedir(),
      mainBranch: 'main'
    },
    agents: [],
    cards: [],
    runs: [],
    wiki: []
  }
}
