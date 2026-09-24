// ── Terrarium synthesized SFX ───────────────────────────────────────────
// One-shot UI/agent sounds. Fully procedural Web Audio — no assets.
// Every function is safe to call at any time: it no-ops unless the
// shared AudioContext is running and audio is enabled. All peaks are
// ≤ 0.12 (well under 0.15 master-relative) — subtle, non-annoying.

import { ctx, bus, isEnabled, whiteNoiseBuffer } from './audio'

interface Live {
  ac: AudioContext
  out: GainNode
}

/** gate for every one-shot: null unless the engine is running + unmuted */
function live(): Live | null {
  try {
    const ac = ctx()
    const out = bus()
    if (!ac || !out || !isEnabled() || ac.state !== 'running') return null
    return { ac, out }
  } catch {
    return null
  }
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)

/** jitter a frequency by ±pct (default ±10%) */
const jit = (f: number, pct = 0.1): number => f * (1 + rand(-pct, pct))

/** gain node pre-wired with attack → exponential decay; connect sources to it */
function env(l: Live, t: number, peak: number, attack: number, decay: number): GainNode {
  try {
    const g = l.ac.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0004, t + attack + decay)
    g.connect(l.out)
    return g
  } catch {
    const g = l.ac.createGain()
    try {
      g.connect(l.out)
    } catch {
      /* ignore */
    }
    return g
  }
}

function stopAt(src: AudioScheduledSourceNode, t: number): void {
  try {
    src.stop(t)
    src.onended = () => {
      try {
        src.disconnect()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** single enveloped oscillator note */
function note(
  l: Live,
  t: number,
  freq: number,
  type: OscillatorType,
  peak: number,
  attack: number,
  decay: number
): void {
  try {
    const o = l.ac.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.connect(env(l, t, peak, attack, decay))
    o.start(t)
    stopAt(o, t + attack + decay + 0.08)
  } catch {
    /* ignore */
  }
}

// ── one-shots ────────────────────────────────────────────────────────

let lastTickAt = 0

/**
 * Shared filtered-noise tap — bandpassed white noise with a fast
 * envelope. `bpFreq` sets the bandpass center (the "material" of the
 * tick); `decay` is a [min,max] range rolled per call.
 */
function noiseTap(
  l: Live,
  t: number,
  bpFreq: number,
  peak: number,
  decay: [min: number, max: number]
): void {
  try {
    const src = l.ac.createBufferSource()
    src.buffer = whiteNoiseBuffer(l.ac)
    src.playbackRate.value = jit(1)

    const bp = l.ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = jit(bpFreq)
    bp.Q.value = rand(5, 9)

    const hp = l.ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 800

    src.connect(bp)
    bp.connect(hp)
    hp.connect(env(l, t, peak, 0.0015, rand(decay[0], decay[1])))
    src.start(t, rand(0, 1.8))
    stopAt(src, t + 0.08)
  } catch {
    /* ignore */
  }
}

function play(fn: (l: Live) => void): void {
  try {
    const l = live()
    if (!l) return
    fn(l)
  } catch {
    /* non-fatal audio failure */
  }
}

/**
 * Soft filtered-noise tap — agent typing tick. Pitch jittered ±10%.
 * `velocity` (0..1) scales the peak; ambience uses it for distant clatter.
 */
export function keyTick(velocity = 1): void {
  play((l) => {
    const t = l.ac.currentTime
    if (t - lastTickAt < 0.018) return // swallow pathological bursts
    lastTickAt = t
    noiseTap(l, t, 2100, 0.035 * Math.min(1, Math.max(0, velocity)), [0.02, 0.045])
  })
}

/** gentle "placed" thock — low sine pitch-drop + noise contact, ~90ms */
export function cardMove(): void {
  play((l) => {
    const t = l.ac.currentTime

    const o = l.ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(jit(155, 0.06), t)
    o.frequency.exponentialRampToValueAtTime(82, t + 0.08)
    o.connect(env(l, t, 0.11, 0.003, 0.09))
    o.start(t)
    stopAt(o, t + 0.15)

    const n = l.ac.createBufferSource()
    n.buffer = whiteNoiseBuffer(l.ac)
    const lp = l.ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = rand(480, 720)
    n.connect(lp)
    lp.connect(env(l, t, 0.05, 0.001, 0.028))
    n.start(t, rand(0, 1.8))
    stopAt(n, t + 0.05)
  })
}

/** rising two-note blip (E5 → B5) — card assigned to an agent */
export function assigned(): void {
  play((l) => {
    const t = l.ac.currentTime
    note(l, t, 659.25, 'triangle', 0.055, 0.005, 0.07)
    note(l, t + 0.07, 987.77, 'triangle', 0.05, 0.005, 0.11)
  })
}

/** warm two-tone resolve (C5 → G5, soft attack, ~500ms tail) + tiny sparkle */
export function doneChime(): void {
  play((l) => {
    const t = l.ac.currentTime
    note(l, t, 523.25, 'sine', 0.1, 0.03, 0.5) // C5
    note(l, t + 0.16, 783.99, 'sine', 0.085, 0.03, 0.55) // G5 resolve
    note(l, t + 0.3, 2093, 'sine', 0.02, 0.01, 0.18) // C7 sparkle
  })
}

/**
 * Single muted bell — "needs you". Respects quiet: stays silent while the
 * window is hidden unless `{ focused: true }` overrides.
 */
export function alertSoft(opts?: { focused?: boolean }): void {
  const focused = opts?.focused === true
  if (!focused && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return
  }
  play((l) => {
    const t = l.ac.currentTime
    note(l, t, 830.61, 'sine', 0.065, 0.008, 0.65) // muted fundamental
    note(l, t, 830.61 * 2.76, 'sine', 0.014, 0.004, 0.3) // bell partial
  })
}

/** filtered noise sweep (~380ms) — camera dolly / scene transition */
export function whoosh(): void {
  play((l) => {
    const t = l.ac.currentTime
    const dur = 0.38

    const n = l.ac.createBufferSource()
    n.buffer = whiteNoiseBuffer(l.ac)
    n.loop = true

    const bp = l.ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.2
    bp.frequency.setValueAtTime(320, t)
    bp.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.6)
    bp.frequency.exponentialRampToValueAtTime(900, t + dur)

    const g = l.ac.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.075, t + dur * 0.35)
    g.gain.linearRampToValueAtTime(0, t + dur)
    g.connect(l.out)

    n.connect(bp)
    bp.connect(g)
    n.start(t, rand(0, 1.5))
    stopAt(n, t + dur + 0.05)
  })
}

/** 60ms click — toggles, switches, small buttons */
export function uiTap(): void {
  play((l) => {
    const t = l.ac.currentTime

    const n = l.ac.createBufferSource()
    n.buffer = whiteNoiseBuffer(l.ac)
    const hp = l.ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2600
    n.connect(hp)
    hp.connect(env(l, t, 0.045, 0.001, 0.04))
    n.start(t, rand(0, 1.8))
    stopAt(n, t + 0.05)

    note(l, t, 1150, 'sine', 0.025, 0.001, 0.035)
  })
}

/** low dissonant blip (minor 2nd rub, quiet) — soft error/failure signal */
export function errorSoft(): void {
  play((l) => {
    const t = l.ac.currentTime
    note(l, t, 110, 'sine', 0.03, 0.015, 0.4) // A2 anchor
    note(l, t, 220, 'sine', 0.05, 0.01, 0.34) // A3
    note(l, t, 233.08, 'sine', 0.045, 0.01, 0.34) // Bb3 — the rub
  })
}

// ── pane/session micro-sounds ────────────────────────────────────────

/** short plucked blip (~150ms) — a terminal session spawned */
export function spawnPop(): void {
  play((l) => {
    const t = l.ac.currentTime

    // pluck body: triangle with a fast downward slip
    const o = l.ac.createOscillator()
    o.type = 'triangle'
    o.frequency.setValueAtTime(jit(540, 0.08), t)
    o.frequency.exponentialRampToValueAtTime(380, t + 0.09)
    o.connect(env(l, t, 0.07, 0.002, 0.11))
    o.start(t)
    stopAt(o, t + 0.16)

    // fingernail transient on the attack
    noiseTap(l, t, 2600, 0.028, [0.012, 0.025])
  })
}

/** brighter tick — a pane split open */
export function paneSplit(): void {
  play((l) => {
    noiseTap(l, l.ac.currentTime, 3300, 0.04, [0.03, 0.055])
  })
}

/** duller, lower tick — a pane closed */
export function paneClose(): void {
  play((l) => {
    noiseTap(l, l.ac.currentTime, 1250, 0.045, [0.02, 0.04])
  })
}
