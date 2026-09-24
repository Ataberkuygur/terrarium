import { useEffect, useState, useCallback } from 'react'
import { Save, Check } from 'lucide-react'
import { useApp } from '../lib/store'
import { uiTap } from '../lib/sfx'
import clsx from 'clsx'

export function SaveButton() {
  const [saved, setSaved] = useState(false)
  const saveState = useApp((s) => s.saveState)

  const handleSave = useCallback(() => {
    saveState()
    uiTap()
    setSaved(true)
    const t = window.setTimeout(() => setSaved(false), 1800)
    return () => window.clearTimeout(t)
  }, [saveState])

  // Global Ctrl+S shortcut to save state and prevent browser default
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  return (
    <button
      type="button"
      onClick={handleSave}
      title={saved ? 'State saved!' : 'Save current workspace and office state (Ctrl+S)'}
      className={clsx(
        'no-drag flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-all duration-150 select-none',
        saved
          ? 'border border-[var(--color-done)] bg-[color-mix(in_srgb,var(--color-done)_16%,transparent)] text-[var(--color-done)]'
          : 'border border-[var(--border-default)] bg-n2 text-t3 hover:border-[var(--border-strong)] hover:text-t1 active:scale-[0.98]'
      )}
    >
      {saved ? (
        <Check size={13} strokeWidth={2.4} className="shrink-0 animate-in fade-in zoom-in-75 duration-150" />
      ) : (
        <Save size={13} strokeWidth={1.8} className="shrink-0" />
      )}
      <span>{saved ? 'Saved' : 'Save'}</span>
      {!saved && <span className="kbd ml-0.5 text-[10px] text-t4">Ctrl S</span>}
    </button>
  )
}
