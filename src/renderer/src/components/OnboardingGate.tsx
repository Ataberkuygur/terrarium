// ── OnboardingGate.tsx — first-run onboarding overlay ────────────────
// Shows the roster Onboarding flow once, gated by
// localStorage['terrarium.onboarded']. On finish the config is stashed to
// localStorage['terrarium.onboarding'], the chosen folder becomes the
// project root (engine setProjectRoot), and `terrarium:onboarded` fires.

import { useEffect, useState } from 'react'
import {
  Onboarding,
  type DetectedCli,
  type OnboardingConfig
} from '../roster/Onboarding'

export const ONBOARDED_KEY = 'terrarium.onboarded'
export const ONBOARDING_CONFIG_KEY = 'terrarium.onboarding'
export const ONBOARDED_EVENT = 'terrarium:onboarded'

/**
 * Narrow shape of the preload's `detectClis()` result — the real type is
 * `DetectResult` in main/git/detect.ts, which the renderer must not import.
 */
interface DetectClisResult {
  agents?: Array<{
    name?: unknown
    path?: unknown
    version?: unknown
  }>
}

function toDetectedClis(res: unknown): DetectedCli[] {
  const agents = (res as DetectClisResult | null)?.agents
  if (!Array.isArray(agents)) return []
  return agents.map((a) => ({
    name: typeof a?.name === 'string' ? a.name : 'unknown',
    found: typeof a?.path === 'string' && a.path.length > 0,
    version: typeof a?.version === 'string' ? a.version : undefined
  }))
}

export function OnboardingGate() {
  // decided once at mount — finishing sets `done`, never re-checks storage
  const [needed] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDED_KEY)
    } catch {
      return false // storage unavailable — don't trap the user
    }
  })
  const [done, setDone] = useState(false)
  const [clis, setClis] = useState<DetectedCli[]>([])

  // probe agent CLIs through the preload bridge; absence/failure → empty list
  useEffect(() => {
    if (!needed || done) return
    let alive = true
    window.terrarium
      ?.detectClis?.()
      .then((res) => {
        if (alive) setClis(toDetectedClis(res))
      })
      .catch(() => {
        /* probe failed — leave the list empty */
      })
    return () => {
      alive = false
    }
  }, [needed, done])

  if (!needed || done) return null

  const finish = (cfg: OnboardingConfig) => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
      localStorage.setItem(ONBOARDING_CONFIG_KEY, JSON.stringify(cfg))
    } catch {
      /* storage unavailable — still close */
    }
    const root = cfg.projectPath?.trim()
    const bridge = window.terrarium
    if (root && bridge?.setProjectRoot) {
      bridge.engine
        ?.getState()
        .then((s) => {
          const pid = s.projects[0]?.id
          if (pid) return bridge.setProjectRoot!(pid, root)
        })
        .catch(() => {
          /* keep the home-folder default */
        })
    }
    window.dispatchEvent(new CustomEvent<OnboardingConfig>(ONBOARDED_EVENT, { detail: cfg }))
    setDone(true)
  }

  return (
    <Onboarding
      onFinish={finish}
      detectedClis={clis}
      onBrowse={window.terrarium?.pickFolder}
      detectedProjects={[]}
    />
  )
}

export default OnboardingGate
