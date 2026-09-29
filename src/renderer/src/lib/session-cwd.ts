// ── session-cwd — the folder a CLI session lives in ───────────────────
// `claude --resume <id>` only finds a transcript from the directory the
// session was created in, and devin/codex resume the same way. A terminal
// that continues a session must therefore start in that session's own
// folder — not the project root, not wherever the pane happened to be.
// The bindings main reads off a live process usually know it; when they
// don't (a CLI that never wrote its dir, a node restored from an older
// save) the session store — the same list the History rows come from —
// does, keyed by id.

import { useApp } from './store'

/** Directory the session `id` of `cli` was created in; null when the store doesn't know it. */
export async function findSessionCwd(cli: string, id: string): Promise<string | null> {
  const list = window.terrarium?.cliSessions
  const root = useApp.getState().projects[0]?.rootPath
  if (!list || !root || !id) return null
  try {
    const hit = (await list(cli, root)).find((s) => s.id.toLowerCase() === id.toLowerCase())
    return hit?.cwd?.trim() || null
  } catch {
    return null
  }
}

/**
 * The folder to resume `id` in: the session store's word first (it is the
 * transcript's own directory), else what the running process reported.
 */
export async function settleSessionCwd(
  cli: string,
  id: string | undefined,
  reported: string | undefined
): Promise<string | undefined> {
  if (!id) return reported
  return (await findSessionCwd(cli, id)) ?? reported
}
