import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { getEngine } from '../lib/ipc'
import { renderMarkdown, type LinkResolution } from '../lib/markdown'
import { FileText, Pencil, RefreshCw, Search } from 'lucide-react'
import type { WikiPage, WikiPageMeta } from '@shared/types'
import clsx from 'clsx'

const TYPE_LABEL: Record<string, string> = {
  overview: 'Overview',
  architecture: 'Architecture',
  module: 'Modules',
  file: 'Files',
  howto: 'How-to',
  glossary: 'Reference',
  report: 'Reports'
}

/** Compact relative time for the status line under the title. */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export function WikiView() {
  const wikiPages = useApp((s) => s.wikiPages)
  const activePageId = useApp((s) => s.activePageId)
  const setActivePage = useApp((s) => s.setActivePage)
  const projects = useApp((s) => s.projects)
  const agents = useApp((s) => s.agents)

  const [page, setPage] = useState<WikiPage | null>(null)
  const [query, setQuery] = useState('')
  /** FTS hits keyed to the query that produced them — a stale hit never renders */
  const [fts, setFts] = useState<{ q: string; hits: WikiPageMeta[] } | null>(null)
  // ── edit mode ──
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  /** regenerate-nudge feedback */
  const [queued, setQueued] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const projectId = projects[0]?.id ?? 'proj-terrarium'

  useEffect(() => {
    if (!activePageId) return
    let live = true
    getEngine()
      .getWikiPage(projectId, activePageId)
      .then((p) => live && setPage(p))
      .catch(() => live && setPage(null))
    return () => {
      live = false
    }
  }, [activePageId, projectId])

  // a page switch drops any edit in flight
  useEffect(() => {
    setEditing(false)
    setConfirmDiscard(false)
    setSaveError(false)
  }, [activePageId])

  const byType = useMemo(() => {
    const map = new Map<string, typeof wikiPages>()
    for (const p of wikiPages) {
      const t = TYPE_LABEL[p.type] ?? 'Pages'
      if (!map.has(t)) map.set(t, [])
      map.get(t)!.push(p)
    }
    return [...map.entries()]
  }, [wikiPages])

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return wikiPages.filter((p) => p.title.toLowerCase().includes(q))
  }, [wikiPages, query])

  // FTS hits the local title filter didn't already surface, kept in engine
  // rank order — only shown while the box still holds the searched query
  const extraHits = useMemo(() => {
    if (!fts || fts.q !== query.trim() || !filtered) return []
    const local = new Set(filtered.map((p) => p.id))
    return fts.hits.filter((h) => !local.has(h.id))
  }, [fts, filtered, query])

  const runSearch = () => {
    const q = query.trim()
    if (!q) return
    getEngine()
      .searchWiki(projectId, q)
      .then((hits) => setFts({ q, hits }))
      .catch(() => setFts({ q, hits: [] }))
  }

  const scribe = agents.find((a) => a.role === 'scribe')
  // page requests fall back to the first agent when no scribe is rostered
  const requestAgentId = scribe?.id ?? agents[0]?.id

  const resolveLink = (title: string): LinkResolution => {
    const t = title.trim()
    const hit = wikiPages.find((p) => p.id === t || p.title.toLowerCase() === t.toLowerCase())
    return hit ? { id: hit.id, exists: true } : { exists: false }
  }

  const requestPage = (target: string) => {
    if (!requestAgentId) return
    void getEngine().nudgeAgent(requestAgentId, `create wiki page "${target}"`)
  }

  const dirty = editing && draft !== (page?.body ?? '')

  const startEdit = () => {
    if (!page) return
    setDraft(page.body)
    setConfirmDiscard(false)
    setSaveError(false)
    setEditing(true)
  }

  const cancelEdit = () => {
    if (dirty) setConfirmDiscard(true)
    else setEditing(false)
  }

  const save = async () => {
    if (!page || saving) return
    if (draft === page.body) {
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError(false)
    try {
      const engine = getEngine()
      await engine.saveWikiPage(projectId, page.id, draft)
      // refetch so links/backlinks reflect the new body immediately
      const fresh = await engine.getWikiPage(projectId, page.id).catch(() => null)
      setPage(fresh ?? { ...page, body: draft })
      setEditing(false)
      setConfirmDiscard(false)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  // Auto-save active wiki edits when the app-wide Save button is triggered
  useEffect(() => {
    const onSaveState = () => {
      if (editing && draft && page && draft !== page.body && !saving) {
        void save()
      }
    }
    window.addEventListener('terrarium:save-state', onSaveState)
    return () => window.removeEventListener('terrarium:save-state', onSaveState)
  }, [editing, draft, page, saving])

  // vault bodies conventionally open with `# Title` — the header already
  // shows it, so drop a leading H1 from the read view (edit shows raw source)
  const displayBody = useMemo(
    () => (page ? page.body.replace(/^\s*#\s[^\n]*(\n|$)/, '') : ''),
    [page]
  )

  return (
    <div className="flex h-full">
      {/* page list */}
      <aside className="w-[240px] shrink-0 border-r border-[var(--border-subtle)] bg-base flex flex-col">
        <div className="p-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 rounded-md bg-n2 border border-[var(--border-default)] px-2.5 py-1.5">
            <Search size={13} className="text-t4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
              placeholder="Search wiki…"
              className="flex-1 bg-transparent text-[12.5px] text-t1 placeholder:text-t4 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filtered ? (
            <>
              <div className="micro-label px-2 py-2">
                {filtered.length} result{filtered.length === 1 ? '' : 's'}
              </div>
              {filtered.map((p) => (
                <PageItem key={p.id} p={p} active={p.id === activePageId} onClick={setActivePage} />
              ))}
              {extraHits.length > 0 && (
                <>
                  <div className="micro-label mt-1 border-t border-[var(--border-subtle)] px-2 pb-1 pt-3">
                    more matches
                  </div>
                  {extraHits.map((p) => (
                    <PageItem
                      key={p.id}
                      p={p}
                      active={p.id === activePageId}
                      onClick={setActivePage}
                    />
                  ))}
                </>
              )}
            </>
          ) : (
            byType.map(([type, pages]) => (
              <div key={type} className="mb-3">
                <div className="micro-label px-2 py-2">{type}</div>
                {pages.map((p) => (
                  <PageItem key={p.id} p={p} active={p.id === activePageId} onClick={setActivePage} />
                ))}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)] p-3">
          <button
            disabled={!scribe || queued}
            title={
              scribe
                ? `Ask ${scribe.name} to refresh stale pages`
                : 'No scribe agent on the roster'
            }
            onClick={() => {
              if (!scribe) return
              void getEngine().nudgeAgent(scribe.id, 'regenerate stale wiki pages')
              setQueued(true)
              window.setTimeout(() => setQueued(false), 2000)
            }}
            className={clsx(
              'flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n2 px-2 py-1.5 text-[11.5px] text-t3 transition-colors',
              !scribe || queued ? 'opacity-50' : 'hover:text-t2'
            )}
          >
            <RefreshCw size={11} /> {queued ? 'Queued' : 'Regenerate stale pages'}
          </button>
        </div>
      </aside>

      {/* page content */}
      <main className="flex-1 overflow-y-auto">
        {page ? (
          <article
            className={clsx('mx-auto max-w-2xl px-8 py-8', editing && 'flex min-h-full flex-col')}
          >
            <header className="mb-5">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-[21px] font-semibold leading-snug tracking-tight text-t1">
                  {page.title}
                </h1>
                {editing ? (
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    <button
                      onClick={() => void save()}
                      disabled={saving}
                      title="Save (ctrl+s)"
                      className="rounded-md border border-[var(--border-default)] bg-n3 px-2.5 py-1 text-[11.5px] text-t1 transition-colors hover:bg-n4 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEdit}
                      title="Cancel (esc)"
                      className="rounded-md px-2 py-1 text-[11.5px] text-t3 transition-colors hover:bg-n3 hover:text-t2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startEdit}
                    title="Edit page"
                    className="shrink-0 rounded-md p-1.5 text-t3 transition-colors hover:bg-n3 hover:text-t1"
                  >
                    <Pencil size={13} />
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-t4">
                <span>updated {timeAgo(page.updatedAt)}</span>
                {page.stale && (
                  <span
                    className="flex items-center gap-1.5"
                    style={{ color: 'var(--color-warning)' }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: 'var(--color-warning)' }}
                    />
                    stale — source changed
                  </span>
                )}
                <span className="micro-label rounded-md border border-[var(--border-subtle)] bg-n3 px-1.5 py-0.5">
                  {TYPE_LABEL[page.type] ?? page.type}
                </span>
              </div>
            </header>

            {editing ? (
              <>
                {confirmDiscard && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-n2 px-3 py-2">
                    <span className="flex-1 text-[12px] text-t2">Unsaved — discard?</span>
                    <button
                      onClick={() => {
                        setEditing(false)
                        setConfirmDiscard(false)
                      }}
                      className="rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-n4"
                      style={{ color: 'var(--color-needs)' }}
                    >
                      Discard
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDiscard(false)
                        taRef.current?.focus()
                      }}
                      className="rounded-md bg-n3 px-2 py-1 text-[11.5px] text-t2 transition-colors hover:bg-n4 hover:text-t1"
                    >
                      Keep editing
                    </button>
                  </div>
                )}
                {saveError && (
                  <div className="mb-2 text-[12px]" style={{ color: 'var(--color-needs)' }}>
                    Couldn't save — engine rejected the write.
                  </div>
                )}
                <textarea
                  ref={taRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    if (confirmDiscard) setConfirmDiscard(false)
                    if (saveError) setSaveError(false)
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault()
                      void save()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                  }}
                  spellCheck={false}
                  autoFocus
                  className="w-full flex-1 resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-relaxed text-t2 outline-none"
                />
              </>
            ) : (
              <>
                {renderMarkdown(displayBody, {
                  onLink: setActivePage,
                  resolveLink,
                  onRequestPage: requestAgentId ? requestPage : undefined
                })}

                {page.backlinks.length > 0 && (
                  <div className="mt-10 rounded-xl border border-[var(--border-subtle)] bg-n2 p-4">
                    <div className="micro-label mb-2">Linked from</div>
                    <div className="flex flex-wrap gap-2">
                      {page.backlinks.map((id) => {
                        const src = wikiPages.find((p) => p.id === id)
                        return (
                          <button
                            key={id}
                            onClick={() => setActivePage(id)}
                            className="rounded-md bg-n3 px-2 py-1 text-[12px] text-t2 transition-colors hover:bg-n4 hover:text-t1"
                          >
                            {src?.title ?? id}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </article>
        ) : (
          <div className="flex h-full items-center justify-center text-t4 text-[13px]">
            <FileText size={16} className="mr-2" /> Pick a page
          </div>
        )}
      </main>

      {/* local graph — right rail */}
      <aside className="w-[220px] shrink-0 border-l border-[var(--border-subtle)] bg-base p-4">
        <div className="micro-label mb-3">Local graph</div>
        <LocalGraph pages={wikiPages} activeId={activePageId} onPick={setActivePage} />
      </aside>
    </div>
  )
}

function PageItem({
  p,
  active,
  onClick
}: {
  p: { id: string; title: string; stale: boolean }
  active: boolean
  onClick: (id: string) => void
}) {
  return (
    <button
      onClick={() => onClick(p.id)}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        active ? 'bg-n4 text-t1' : 'text-t2 hover:bg-n3'
      )}
    >
      <span className="flex-1 truncate">{p.title}</span>
      {p.stale && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-warning)' }} />}
    </button>
  )
}

/** Tiny deterministic local graph: active page + neighbors as nodes on a circle. */
function LocalGraph({
  pages,
  activeId,
  onPick
}: {
  pages: { id: string; title: string; links: string[]; stale: boolean }[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  const active = pages.find((p) => p.id === activeId)
  if (!active) return <p className="text-[12px] text-t4">No page selected.</p>

  const neighborIds = new Set<string>([
    ...active.links,
    ...pages.filter((p) => p.links.includes(active.id)).map((p) => p.id)
  ])
  const neighbors = pages.filter((p) => neighborIds.has(p.id))

  const R = 62
  const cx = 90
  const cy = 90
  const nodes = neighbors.map((p, i) => {
    const a = (i / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2
    return { p, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }
  })

  return (
    <div>
      <svg viewBox="0 0 180 180" className="w-full">
        {nodes.map(({ p, x, y }) => (
          <line
            key={p.id}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(255,255,255,0.09)"
            strokeWidth={1}
          />
        ))}
        {nodes.map(({ p, x, y }) => (
          <circle
            key={p.id}
            cx={x}
            cy={y}
            r={5}
            fill={p.stale ? 'var(--color-warning)' : '#3a3d47'}
            className="cursor-pointer hover:fill-[#6b6e75]"
            onClick={() => onPick(p.id)}
          >
            <title>{p.title}</title>
          </circle>
        ))}
        <circle cx={cx} cy={cy} r={7} fill="var(--color-accent)" />
      </svg>
      <p className="mt-2 text-center text-[11px] text-t3 truncate">{active.title}</p>
      <p className="text-center text-[10.5px] text-t4 mt-0.5">
        {neighbors.length} linked page{neighbors.length === 1 ? '' : 's'}
      </p>
    </div>
  )
}
