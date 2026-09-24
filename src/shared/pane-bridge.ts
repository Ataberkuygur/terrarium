// ── pane-bridge — shared command contract ─────────────────────────────
// The workspace's browser panes are remote-controllable: terminals (agent
// CLIs, scripts, the user via curl) POST commands to main's loopback HTTP
// server, which forwards them to the renderer over PANE_IPC.cmd and waits
// for the renderer's PANE_IPC.result reply.
//
// The wire vocabulary mirrors the Devin Tab Bridge
// (batches/_driver/server.js + ext/bg.js) — same `POST /cmd` shape, same
// {id, ok, result|error} reply, same command names — so scripts and agent
// CLIs written for the Chrome bridge drop in unchanged against in-app
// panes. Terminals learn the endpoint from the TERRARIUM_BROWSER_CMD env var
// injected at spawn; TERRARIUM_SID lets an agent match `tabs` entries by
// boundSid to find the pane scoped to it.
//
// Wire: HTTP POST 127.0.0.1:<port>/cmd {cmd, tabId|pane, ...args}
//     → webContents.send(PANE_IPC.cmd, {id, cmd, ...args})
//     → renderer registry executes (nav → webview.loadURL, cdp
//       Runtime.evaluate → webview.executeJavaScript)
//     → ipcRenderer.send(PANE_IPC.result, id, {ok,result|error})
//     → HTTP 200 {id, ok, result|error}
//
// Differences from the Chrome bridge (by design): panes are addressed by
// `tabId` (numeric alias minted per pane) or `pane` (leaf id string);
// attach/detach are no-ops (guests need no debugger); dlstatus is
// unsupported (Electron downloads go straight to the OS downloads dir).

/** Commands understood by the renderer's pane registry. */
export type PaneCmd =
  | { cmd: 'ping' }
  | { cmd: 'help' }
  | { cmd: 'tabs' }
  | { cmd: 'newtab'; url?: string; active?: boolean; bind?: string }
  | { cmd: 'nav'; tabId?: number | string; pane?: string; url: string }
  | { cmd: 'activate'; tabId?: number | string; pane?: string }
  | { cmd: 'close'; tabId?: number | string; pane?: string }
  | { cmd: 'attach'; tabId?: number | string; pane?: string }
  | { cmd: 'detach'; tabId?: number | string; pane?: string }
  | {
      cmd: 'cdp'
      tabId?: number | string
      pane?: string
      method: string
      params?: Record<string, unknown>
    }
  | { cmd: 'eval'; tabId?: number | string; pane?: string; expr: string }
  | { cmd: 'dl'; tabId?: number | string; pane?: string; url: string }
  // ── workspace control — the whole pane tree is agent-drivable ──
  // `pane` resolves a leaf id; `tabId` a browser alias; `i` a 1-based
  // leaf index from `ws`; `sid` a terminal's pty session id.
  | { cmd: 'ws' }
  | {
      cmd: 'spawn'
      kind?: 'terminal' | 'browser' | 'chat'
      command?: string
      cwd?: string
      title?: string
      dir?: 'row' | 'col'
      pane?: string | number
      agentId?: string
      url?: string
    }
  | {
      cmd: 'split'
      pane: string | number
      dir?: 'row' | 'col'
      kind?: 'terminal' | 'browser' | 'chat'
      command?: string
      cwd?: string
      title?: string
      url?: string
    }
  | { cmd: 'focus'; pane?: string | number; tabId?: number | string; i?: number }
  | { cmd: 'bind'; pane: string | number; command?: string; cwd?: string }
  | { cmd: 'write'; pane?: string | number; sid?: string; data: string; enter?: boolean }
  | { cmd: 'ratio'; split?: string; pane?: string | number; ratio: number }
  | { cmd: 'layout'; name: string }

/** What `ws` reports — the live pane tree, flat. */
export interface WorkspaceSnapshot {
  focusedId: string | null
  count: number
  max: number
  leaves: WorkspaceLeafInfo[]
  splits: { id: string; dir: 'row' | 'col'; ratio: number }[]
}

export interface WorkspaceLeafInfo {
  /** 1-based position in visual order — pass back as `i`. */
  i: number
  /** Leaf id — pass back as `pane`. */
  id: string
  kind: string
  title?: string
  command?: string
  cwd?: string
  /** Inferred work area (Jev/heuristic classification). */
  domain?: string
  /** Terminal session id (terminal leaves only) — pass back as `sid`. */
  sid?: string
  agentId?: string
  /** Browser leaf's terminal-scope leaf id, when bound. */
  bindLeafId?: string
  focused: boolean
}

/** What `tabs` reports per browser pane — a superset of the Chrome shape. */
export interface PaneTabInfo {
  /** Numeric tab id — pass back as `tabId` (cmd.js-compatible). */
  id: number
  /** Leaf id — also accepted as `pane` on any command. */
  pane: string
  title: string
  url: string
  /** True for the pane most recently driven via the bridge. */
  active: boolean
  /** Terminal session id this pane is scoped to, when bound (else absent). */
  boundSid?: string
}

/** Envelope sent main → renderer on PANE_IPC.cmd. */
export interface PaneCmdEnvelope {
  /** Correlates the reply — main fills this in. */
  id: number
  cmd: string
  [arg: string]: unknown
}

/** Renderer → main reply shape; also the HTTP response body ({id, ok, …}). */
export interface PaneCmdResult {
  ok: boolean
  result?: unknown
  error?: string
}

/** CDP methods the registry implements over the webview guest. */
export const PANE_CDP_METHODS = [
  'Runtime.evaluate',
  'Page.navigate',
  'Page.reload',
  'Page.captureScreenshot'
] as const

/** Default listen port — bumped past conflicts up to PORT_MAX. */
export const PANE_BRIDGE_PORT = 8791
export const PANE_BRIDGE_PORT_MAX = PANE_BRIDGE_PORT + 9

/** Renderer-side command ceiling — the Chrome bridge waits 120s. */
export const PANE_CMD_TIMEOUT_MAX_MS = 120_000
