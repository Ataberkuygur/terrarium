import type { Engine } from '@shared/types'
import { createMockEngine } from './mock-engine'
import type { PtyBridge } from '@shared/pty'
import type { PaneCmdEnvelope, PaneCmdResult } from '@shared/pane-bridge'
import type { CliSessionEntry } from '@shared/cli-sessions'
import type { CliBinding } from '@shared/cli-resume'
import type { JevKeyStatus, JevRequest, JevResult } from '@shared/jev'
import type { UpdateStatus } from '@shared/updater'

declare global {
  interface Window {
    terrarium?: {
      engine?: Engine
      pty?: PtyBridge
      platform?: string
      detectClis?: () => Promise<unknown>
      pickFolder?: () => Promise<string | null>
      jevKey?: {
        status: () => Promise<JevKeyStatus>
        set: (key: string) => Promise<JevKeyStatus>
        test: () => Promise<{ ok: boolean; status?: number; error?: string; restart?: boolean }>
      }
      setProjectRoot?: (projectId: string, rootPath: string) => Promise<void>
      openExternal?: (url: string) => Promise<void>
      onWikiChanged?: (cb: (e: { projectId: string }) => void) => () => void
      paneBridgePort?: () => Promise<number | null>
      onPaneCmd?: (cb: (msg: PaneCmdEnvelope) => void) => () => void
      paneCmdResult?: (id: number, result: PaneCmdResult) => void
      appZoom?: {
        get: () => Promise<number>
        set: (factor: number) => Promise<number>
        onChange: (cb: (factor: number) => void) => () => void
      }
      orchInfo?: () => Promise<{
        binDir: string
        pathKey: string
        pathValue: string
        delimiter: string
        guide: string
      } | null>
      cliSessions?: (cli: string, cwd: string) => Promise<CliSessionEntry[]>
      suggestNetTopic?: (sessionId: string, agentTitles: string[]) => Promise<string | null>
      /** Agent CLI under each shell pid (absent until main/preload restart). */
      cliProcesses?: (pids: number[]) => Promise<Record<number, string | null>>
      /** pty root pid → resumable CLI session (absent until main/preload restart). */
      cliBindings?: (entries: { pid: number; since: number }[]) => Promise<Record<number, CliBinding | null>>
      resolveCliSession?: (
        cli: string,
        pid: number,
        since: number
      ) => Promise<{ id: string; cwd: string | null } | null>
      /** GitHub Releases auto-update (packaged builds; 'disabled' in dev) */
      updater?: {
        get: () => Promise<UpdateStatus>
        check: () => Promise<UpdateStatus>
        install: () => Promise<UpdateStatus>
        onStatus: (cb: (s: UpdateStatus) => void) => () => void
      }
      /** Jev (TypeSafe AI) typed decisions — null when unconfigured/failed. */
      jevDecide?: (req: JevRequest) => Promise<JevResult | null>
      mobileInfo?: () => Promise<{
        url: string
        host: string
        port: number
        ip: string
        qr: string
      } | null>
    }
  }
}

let engine: Engine | null = null

/** The renderer's single doorway to the host. Falls back to the mock engine in a plain browser. */
export function getEngine(): Engine {
  if (!engine) {
    engine = window.terrarium?.engine ?? createMockEngine()
  }
  return engine
}

export function getPty(): PtyBridge | null {
  return window.terrarium?.pty ?? null
}

export const isBrowserMock = !window.terrarium?.engine
