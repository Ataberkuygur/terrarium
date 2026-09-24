import type { Agent, TaskCard, Project, Run, WikiPage } from '@shared/types'

export const DEMO_PROJECT: Project = {
  id: 'proj-terrarium',
  name: 'terrarium',
  rootPath: '',
  mainBranch: 'main'
}

// Demo arrays are intentionally empty — the app ships no placeholder
// crew/cards/runs/docs. The user builds their own (mirrors the v2 seed
// migration in src/main/engine). Exports stay for the mock engine API.
export const DEMO_AGENTS: Agent[] = []

export const DEMO_CARDS: TaskCard[] = []

export const DEMO_RUNS: Run[] = []

export const DEMO_WIKI: WikiPage[] = []
