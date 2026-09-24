// ── Terrarium office ambience ───────────────────────────────────────────
// Layered procedural room tone, no assets — the daylight-loft variant:
//   · room bed — looped brown noise through a ~260Hz lowpass, slow drift
//   · airy hiss — white noise → 4kHz highpass, barely-there daytime air
//   · keyboard clatter — sparse keyTick flurries while agents work
//   · distant murmur — rare bandpassed-noise swells (~every 20–40s)
// Master ambience gain stays ≤ 0.06 — felt, not heard. Fades 1.5s in/out.

import { ctx, bus, ensure, whiteNoiseBuffer, brownNoiseBuffer } from './audio'
import { keyTick } from './sfx'

export interface AmbienceOptions {
  /**
   * Polled each clatter tick — return how many agents are working.
   * Clatter only fires while this returns > 0. Defaults to a silent office.
   */
  agentsWorking?: () => number
}

const MASTER_LEVEL = 0.06
const FADE_S = 1.5

let running = false
let intensity = 0.7
let agentsWorking: () => number = () => 0

let ambGain: GainNode | null = null
let loopNodes: AudioScheduledSourceNode[] = []
let clatterTimer: number | null = null
let murmurTimer: number | null = null

const rand = (min: number, max: number): number => min + Math.random() * (max - min)
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function workingCount(): number {
  try {
    return Math.min(6, Math.max(0, Math.floor(agentsWorking())))
  } catch {
    return 0
  }
}

/**
 * Start the ambience bed. Idempotent — calling again just swaps the
 * `agentsWorking` getter. Safe pre-gesture: the graph is built while
 * suspended and fades in when the context resumes.
 */
export function start(opts: AmbienceOptions = {}): void {
  if (running) {
    if (opts.agentsWorking) agentsWorking = opts.agentsWorking
    return
  }
  const ac = ensure()
  const dst = bus()
  if (!ac || !dst) return

  running = true
  agentsWorking = opts.agentsWorking ?? (() => 0)

  const t = ac.currentTime
  ambGain = ac.createGain()
  ambGain.gain.setValueAtTime(0.0001, t)
  ambGain.gain.exponentialRampToValueAtTime(
    Math.max(MASTER_LEVEL * intensity, 0.0001),
    t + FADE_S
  )
  ambGain.connect(dst)

  // room bed — brown noise → lowpass ~260Hz with slow cutoff drift.
  // Brighter than the old 120Hz HVAC hum: a daylight loft, not a server room.
  const hum = ac.createBufferSource()
  hum.buffer = brownNoiseBuffer(ac)
  hum.loop = true
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 260
  lp.Q.value = 0.7
  const drift = ac.createOscillator()
  drift.frequency.value = 0.06 // glacial LFO so the bed breathes
  const driftAmt = ac.createGain()
  driftAmt.gain.value = 26
  drift.connect(driftAmt)
  driftAmt.connect(lp.frequency)
  const humGain = ac.createGain()
  humGain.gain.value = 0.85
  hum.connect(lp)
  lp.connect(humGain)
  humGain.connect(ambGain)
  hum.start()
  drift.start()
  loopNodes = [hum, drift]

  // faint electrical undertone under the noise floor
  const undertone = ac.createOscillator()
  undertone.type = 'sine'
  undertone.frequency.value = 58
  const utGain = ac.createGain()
  utGain.gain.value = 0.12
  undertone.connect(utGain)
  utGain.connect(ambGain)
  undertone.start()
  loopNodes.push(undertone)

  // airy hiss — white noise → 4kHz highpass at a whisper of a gain.
  // The "daylight" in the loft: open air, not machinery.
  const hiss = ac.createBufferSource()
  hiss.buffer = whiteNoiseBuffer(ac)
  hiss.loop = true
  const hissHp = ac.createBiquadFilter()
  hissHp.type = 'highpass'
  hissHp.frequency.value = 4000
  const hissGain = ac.createGain()
  hissGain.gain.value = 0.008
  hiss.connect(hissHp)
  hissHp.connect(hissGain)
  hissGain.connect(ambGain)
  hiss.start()
  loopNodes.push(hiss)

  scheduleClatter()
  scheduleMurmur()
}

/** Fade out over 1.5s, then tear the graph down. Idempotent. */
export function stop(): void {
  if (!running) return
  running = false
  if (clatterTimer !== null) {
    window.clearTimeout(clatterTimer)
    clatterTimer = null
  }
  if (murmurTimer !== null) {
    window.clearTimeout(murmurTimer)
    murmurTimer = null
  }

  const ac = ctx()
  const g = ambGain
  const nodes = loopNodes
  loopNodes = []
  ambGain = null
  if (!ac || !g) {
    teardown(nodes, g)
    return
  }
  const t = ac.currentTime
  g.gain.cancelScheduledValues(t)
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + FADE_S)
  window.setTimeout(() => teardown(nodes, g), FADE_S * 1000 + 80)
}

export function isRunning(): boolean {
  return running
}

/** 0..1 — scales the ambience master (≤ 0.06) and clatter density */
export function setIntensity(v: number): void {
  intensity = clamp01(v)
  const ac = ctx()
  if (running && ac && ambGain) {
    ambGain.gain.cancelScheduledValues(ac.currentTime)
    ambGain.gain.setTargetAtTime(
      Math.max(MASTER_LEVEL * intensity, 0.0001),
      ac.currentTime,
      0.5
    )
  }
}

/**
 * View-mount helper for the office: starts the ambience with `getWorking`
 * as the agentsWorking source and returns a cleanup that fades it out.
 * Designed for `useEffect(() => mountOfficeAmbience(getWorking), [])` —
 * safe pre-gesture, idempotent across StrictMode remounts (a second call
 * just swaps the getter while the bed keeps playing).
 */
export function mountOfficeAmbience(getWorking: () => number): () => void {
  let disposed = false
  // Pre-gesture the AudioContext doesn't exist yet — building the graph now
  // would just produce autoplay warnings. Wait for the first gesture, call
  // ensure() inside it (allowed), then start the bed.
  const unlock = () => {
    if (disposed || running) return
    if (ensure()) start({ agentsWorking: getWorking })
  }
  if (ctx()?.state === 'running') {
    start({ agentsWorking: getWorking })
  } else {
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }
  return () => {
    disposed = true
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    stop()
  }
}

function teardown(nodes: AudioScheduledSourceNode[], gain: GainNode | null): void {
  for (const n of nodes) {
    try {
      n.stop()
    } catch {
      /* already stopped */
    }
    n.disconnect()
  }
  gain?.disconnect()
}

// ── keyboard clatter: sparse flurries while agents work ─────────────

function scheduleClatter(): void {
  if (!running) return
  clatterTimer = window.setTimeout(
    () => {
      clatterTimer = null
      const working = workingCount()
      if (running && working > 0 && ctx()?.state === 'running') {
        // a short typing flurry: 2..(4+working) ticks, 40–130ms apart
        const flurry = 2 + Math.floor(rand(0, 3 + working))
        let at = 0
        for (let i = 0; i < flurry; i++) {
          at += rand(40, 130)
          window.setTimeout(() => {
            if (running) keyTick(rand(0.5, 0.9))
          }, at)
        }
      }
      scheduleClatter()
    },
    rand(1600, 4500) / (0.4 + intensity)
  )
}

// ── distant murmur: rare bandpassed-noise swells ────────────────────

function scheduleMurmur(): void {
  if (!running) return
  murmurTimer = window.setTimeout(
    () => {
      murmurTimer = null
      if (running) murmur()
      scheduleMurmur()
    },
    rand(20000, 40000)
  )
}

/** a soft swell of bandpassed noise — distant voices, not speech */
function murmur(): void {
  const ac = ctx()
  const g = ambGain
  if (!ac || !g || ac.state !== 'running') return
  const t = ac.currentTime
  const dur = rand(2.6, 4.4)

  const src = ac.createBufferSource()
  src.buffer = whiteNoiseBuffer(ac)
  src.loop = true

  // two overlapping "voices" through different bandpasses
  for (const f of [rand(190, 300), rand(360, 560)]) {
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = f
    bp.Q.value = 1.6

    const vg = ac.createGain()
    const peak = rand(0.12, 0.26) * intensity
    vg.gain.setValueAtTime(0.0001, t)
    // uneven syllabic bumps, then release
    let tt = t + rand(0.3, 0.8)
    while (tt < t + dur) {
      vg.gain.linearRampToValueAtTime(peak * rand(0.45, 1), tt + rand(0.3, 0.6))
      tt += rand(0.6, 1.1)
      vg.gain.linearRampToValueAtTime(peak * rand(0.1, 0.35), tt)
    }
    vg.gain.linearRampToValueAtTime(0.0001, t + dur + 1.0)

    src.connect(bp)
    bp.connect(vg)
    vg.connect(g)
  }

  src.start(t, rand(0, 1.5))
  src.stop(t + dur + 1.2)
  src.onended = () => src.disconnect()
}
