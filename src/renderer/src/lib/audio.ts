// ── Terrarium audio engine ──────────────────────────────────────────────
// Singleton lazily-created AudioContext + master gain bus. The context
// is only created/resumed inside a user gesture (autoplay policy):
// gesture handlers should call `ensure()` once; everything else should
// treat `ctx()` / `bus()` as possibly-null.
//
// Prefs persist to localStorage under 'terrarium.audio': { enabled, volume }.

const STORAGE_KEY = 'terrarium.audio'
const DEFAULT_VOLUME = 0.8

interface AudioPrefs {
  enabled: boolean
  /** master bus gain, 0..1 — applied on top of per-sound gains */
  volume: number
}

let ac: AudioContext | null = null
let master: GainNode | null = null
let prefs: AudioPrefs = loadPrefs()

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function loadPrefs(): AudioPrefs {
  const fallback: AudioPrefs = { enabled: true, volume: DEFAULT_VOLUME }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<AudioPrefs> | null
    return {
      enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
      volume:
        typeof parsed?.volume === 'number' && Number.isFinite(parsed.volume)
          ? clamp01(parsed.volume)
          : fallback.volume
    }
  } catch {
    return fallback // storage unavailable / corrupt — non-fatal
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* private mode etc. — non-fatal */
  }
}

/** ramp the master bus to the current prefs target */
function applyMaster(): void {
  if (!ac || !master) return
  const t = ac.currentTime
  master.gain.cancelScheduledValues(t)
  master.gain.setTargetAtTime(prefs.enabled ? prefs.volume : 0, t, 0.03)
}

/**
 * Create (first call) or resume the AudioContext. Call this from a
 * user-gesture handler (pointerdown / keydown / click). Safe to call
 * anytime — returns null where Web Audio is unavailable.
 */
export function ensure(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ac) {
    ac = new AudioContext()
    master = ac.createGain()
    master.gain.value = prefs.enabled ? prefs.volume : 0
    master.connect(ac.destination)
  }
  applyMaster()
  if (prefs.enabled && ac.state === 'suspended') {
    void ac.resume().catch(() => undefined)
  }
  return ac
}

/** the AudioContext, or null until `ensure()` has created it */
export function ctx(): AudioContext | null {
  return ac
}

/** master gain bus — every sound source should ultimately connect here */
export function bus(): GainNode | null {
  return master
}

export function isEnabled(): boolean {
  return prefs.enabled
}

export function setEnabled(on: boolean): void {
  if (prefs.enabled === on) return
  prefs.enabled = on
  savePrefs()
  if (!ac) return
  applyMaster()
  if (on) {
    if (ac.state === 'suspended') void ac.resume().catch(() => undefined)
  } else {
    // let the mute ramp land before suspending to save cycles
    window.setTimeout(() => {
      if (!prefs.enabled && ac?.state === 'running') {
        void ac.suspend().catch(() => undefined)
      }
    }, 250)
  }
}

export function volume(): number {
  return prefs.volume
}

export function setVolume(v: number): void {
  prefs.volume = clamp01(v)
  savePrefs()
  applyMaster()
}

// ── shared source buffers (allocated lazily, reused by all sounds) ──

let _white: AudioBuffer | null = null
let _whiteRate = 0

/** 2s mono white-noise buffer shared by every noise-based sound */
export function whiteNoiseBuffer(context: AudioContext): AudioBuffer {
  if (_white && _whiteRate === context.sampleRate) return _white
  const len = Math.ceil(context.sampleRate * 2)
  const buf = context.createBuffer(1, len, context.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  _white = buf
  _whiteRate = context.sampleRate
  return buf
}

let _brown: AudioBuffer | null = null
let _brownRate = 0

/** 8s mono brown-noise loop (leaky-integrated white noise), seam crossfaded */
export function brownNoiseBuffer(context: AudioContext): AudioBuffer {
  if (_brown && _brownRate === context.sampleRate) return _brown
  const len = Math.ceil(context.sampleRate * 8)
  const buf = context.createBuffer(1, len, context.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last * 3.2
  }
  // blend the head with the tail so the loop seam doesn't click
  const fade = Math.ceil(context.sampleRate * 0.05)
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = d[i] * k + d[len - fade + i] * (1 - k)
  }
  _brown = buf
  _brownRate = context.sampleRate
  return buf
}
