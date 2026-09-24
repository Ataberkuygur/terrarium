// ── cx ───────────────────────────────────────────────────────────────
// Shared classname joiner for the ui primitives — thin alias over clsx
// so every primitive composes conditional classes the same way, and so
// callers get the same signature whether they import from here or lib.
import clsx from 'clsx'

export const cx = clsx
export default cx
