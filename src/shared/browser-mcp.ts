// ── browser-mcp — shared shape of the Devin browser-MCP switch ──────────

export interface BrowserMcpStatus {
  /** Devin's user mcp_config.json has at least one of the servers. */
  available: boolean
  /** At least one of them is not `disabled`. */
  enabled: boolean
  /** Server processes currently running under Devin sessions. */
  running: number
}

export const BROWSER_MCP_IPC = {
  /** invoke → BrowserMcpStatus */
  status: 'browser-mcp:status',
  /** invoke (on: boolean) → BrowserMcpStatus */
  set: 'browser-mcp:set'
} as const
