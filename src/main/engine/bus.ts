// ── engine bus ───────────────────────────────────────────────────────
// Thin EventEmitter wrapper. The engine publishes a full EngineState
// snapshot ('state') after every committed mutation, plus each
// OfficeEvent individually ('event') for the activity ticker.
// src/main/index.ts forwards both over IPC (engine:state / engine:event).

import { EventEmitter } from 'node:events'
import type { EngineState, OfficeEvent } from '../../shared/types'

export class EngineBus {
  private ee = new EventEmitter()

  constructor() {
    this.ee.setMaxListeners(50)
  }

  /** Emit each event (ticker) then the new snapshot (store refresh). */
  publish(state: EngineState, events: OfficeEvent[]): void {
    for (const ev of events) this.ee.emit('event', ev)
    this.ee.emit('state', state)
  }

  onState(cb: (s: EngineState) => void): () => void {
    this.ee.on('state', cb)
    return () => {
      this.ee.off('state', cb)
    }
  }

  onEvent(cb: (e: OfficeEvent) => void): () => void {
    this.ee.on('event', cb)
    return () => {
      this.ee.off('event', cb)
    }
  }
}
