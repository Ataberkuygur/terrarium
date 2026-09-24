import { useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { ensure, isEnabled, setEnabled } from '../lib/audio'
import { uiTap } from '../lib/sfx'

/**
 * Titlebar-ready mute toggle. The click doubles as the user gesture that
 * creates/resumes the AudioContext via `ensure()`.
 */
export function SoundToggle() {
  const [on, setOn] = useState<boolean>(() => isEnabled())

  const toggle = () => {
    ensure() // gesture — safe point to create/resume the context
    if (isEnabled()) {
      uiTap() // audible click before muting
      setEnabled(false)
      setOn(false)
    } else {
      setEnabled(true)
      setOn(true)
      // resume() is async — tick lands once the context is running
      window.setTimeout(uiTap, 140)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={on ? 'Mute office audio' : 'Unmute office audio'}
      className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-t3 transition-colors duration-100 hover:bg-n4 hover:text-t1"
    >
      {on ? <Volume2 size={14} strokeWidth={1.8} /> : <VolumeX size={14} strokeWidth={1.8} />}
    </button>
  )
}
