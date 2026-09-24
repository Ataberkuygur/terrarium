// ── Auto-update contract — main (electron-updater) ↔ renderer notice ──────

export const UPDATER_IPC = {
  /** main → renderer push: UpdateStatus on every state change */
  STATUS: 'terrarium:updater:status',
  /** renderer → main invoke: current UpdateStatus */
  GET: 'terrarium:updater:get',
  /** renderer → main invoke: check GitHub Releases now */
  CHECK: 'terrarium:updater:check',
  /** renderer → main invoke: install the update (downloads first if needed), then restart */
  INSTALL: 'terrarium:updater:install'
} as const

export type UpdateState =
  | 'disabled' // dev build / unpackaged — updater off
  | 'idle'
  | 'checking'
  | 'available' // newer release found, download starting
  | 'downloading'
  | 'ready' // downloaded — one click restarts into it
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** running version */
  current: string
  /** version on offer (available/downloading/ready) */
  version?: string
  /** download progress 0..100 */
  percent?: number
  /** user clicked Update — restart as soon as the download lands */
  installQueued?: boolean
  error?: string
}
