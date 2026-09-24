// ── IPC channel names ────────────────────────────────────────────────
// Single source of truth for engine channels. Main registers
// ipcMain.handle(...) on the request channels and pushes on the
// 'engine:state' / 'engine:event' channels; preload wraps them into
// the window.terrarium.engine bridge.

export const IPC = {
  /** invoke → EngineState */
  engineGetState: 'engine:get-state',
  /** main → renderer push: full EngineState snapshot after every mutation */
  engineState: 'engine:state',
  /** main → renderer push: single OfficeEvent (activity ticker) */
  engineEvent: 'engine:event',

  /** invoke (input: { title, body?, projectId }) → TaskCard */
  cardCreate: 'engine:create-card',
  /** invoke (cardId, agentId) → void */
  cardAssign: 'engine:assign-card',
  /** invoke (cardId, status) → void */
  cardMove: 'engine:move-card',
  /** invoke (cardId, {title?, body?, priority?, dueAt?}) → void */
  cardUpdate: 'engine:update-card',
  /** invoke (cardId) → void — delete the card + cascade its runs */
  cardDelete: 'engine:delete-card',
  /** invoke (agentId, message) → void */
  agentNudge: 'engine:nudge-agent',
  /** invoke (agentId) → void — activity heartbeat, wakes sleeping agents */
  agentTouch: 'engine:touch-agent',
  /** invoke (Agent) → void — insert-or-update crew member */
  agentUpsert: 'engine:upsert-agent',
  /** invoke (agentId) → void — remove crew member */
  agentRemove: 'engine:remove-agent',

  /** invoke (projectId, rootPath) → void — re-point a project folder */
  projectSetRoot: 'engine:project-set-root',

  /** invoke (projectId) → WikiPageMeta[] */
  wikiList: 'engine:list-wiki-pages',
  /** invoke (projectId, pageId) → WikiPage */
  wikiGet: 'engine:get-wiki-page',
  /** invoke (projectId, query) → WikiPageMeta[] */
  wikiSearch: 'engine:search-wiki',
  /** invoke (projectId, pageId, body) → void */
  wikiSave: 'engine:save-wiki-page',

  /** main → renderer push: vault index changed on disk { projectId, pages } */
  wikiChanged: 'wiki:changed'
} as const

/**
 * Pane-bridge channels — main's local HTTP server forwards /cmd payloads to
 * the renderer (which owns the browser-pane webviews) and awaits the result.
 */
export const PANE_IPC = {
  /** main → renderer send: { id, cmd, ...args } — a pane command to execute. */
  cmd: 'terrarium:panes:cmd',
  /** renderer → main send: (id, { ok, result?|error? }) — resolves the HTTP request. */
  result: 'terrarium:panes:result',
  /** invoke → number | null — the pane-bridge port (null outside Electron / bind failed). */
  port: 'terrarium:panes:port'
} as const

/**
 * Voice-to-terminal channels — local speech-to-text service status and controls.
 */
export const VOICE_IPC = {
  /** invoke → VoiceStatus */
  status: 'voice:status',
  /** invoke → boolean — trigger manual setup/install */
  setup: 'voice:setup',
  /** invoke (on: boolean) → VoiceStatus — the same switch as the F8 hotkey */
  setEnabled: 'voice:set-enabled',
  /** main → renderer push: { status: VoiceStatus } */
  changed: 'voice:changed'
} as const

export interface VoiceStatus {
  /** User switch (F8) — off = engine stopped and kept down by the watchdog. */
  enabled: boolean
  ready: boolean
  running: boolean
  model: string
  hotkey: string
  device: string
  error?: string
}

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
