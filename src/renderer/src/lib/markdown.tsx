import React, { useState } from 'react'

/** Result of resolving a [[wikilink]] target against the page index. */
export interface LinkResolution {
  /** page id to navigate to — absent when the target can't be jumped to */
  id?: string
  /** true when the target matches a real page (by id or title) */
  exists: boolean
}

/**
 * Minimal markdown renderer tuned for the wiki:
 * headings, tables, lists, code fences, mermaid placeholder, [[wikilinks]], bold/italic/code.
 * Wiki-links resolve through `resolveLink(title)` → LinkResolution | id | null
 * (the legacy `string | null` form is still accepted). When `onRequestPage` is
 * provided, unresolved links become "click to request" affordances.
 */
export function renderMarkdown(
  md: string,
  opts: {
    onLink: (id: string) => void
    resolveLink: (title: string) => string | null | LinkResolution
    /** fired when a reader clicks a [[link]] that matches no page */
    onRequestPage?: (target: string) => void
  }
) {
  const lines = md.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0

  const inline = (text: string): React.ReactNode[] => {
    // [[id|alias]] or [[id]] → link
    const parts: React.ReactNode[] = []
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
    let last = 0
    let m: RegExpExecArray | null
    let k = 0
    const pushText = (t: string) => {
      if (!t) return
      // bold, italic, code inline
      const segs = t.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
      segs.forEach((s) => {
        if (!s) return
        if (s.startsWith('**') && s.endsWith('**'))
          parts.push(
            <strong key={k++} className="font-semibold text-t1">
              {s.slice(2, -2)}
            </strong>
          )
        else if (s.startsWith('`') && s.endsWith('`'))
          parts.push(
            <code key={k++} className="rounded bg-n3 px-1 py-0.5 font-mono text-[0.85em] text-[#9fb4d8]">
              {s.slice(1, -1)}
            </code>
          )
        else if (s.startsWith('*') && s.endsWith('*') && s.length > 2)
          parts.push(
            <em key={k++} className="italic">
              {s.slice(1, -1)}
            </em>
          )
        else parts.push(s)
      })
    }
    while ((m = re.exec(text))) {
      pushText(text.slice(last, m.index))
      const target = m[1].trim()
      const label = (m[2] ?? m[1]).trim()
      const r = normalizeResolution(opts.resolveLink(target))
      const id = r.id
      parts.push(
        id ? (
          <button
            key={k++}
            onClick={() => opts.onLink(id)}
            className="text-[#f5b45c] underline decoration-[rgba(245,165,36,0.35)] underline-offset-2 hover:decoration-[var(--color-accent)] transition-colors"
          >
            {label}
          </button>
        ) : r.exists ? (
          // a real page but no id to navigate to — render as plain text
          <span key={k++} className="text-t3">
            {label}
          </span>
        ) : (
          <MissingLink key={k++} label={label} target={target} onRequest={opts.onRequestPage} />
        )
      )
      last = m.index + m[0].length
    }
    pushText(text.slice(last))
    return parts
  }

  while (i < lines.length) {
    const line = lines[i]

    // fenced code / mermaid
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      if (lang === 'mermaid') {
        out.push(
          <div
            key={key++}
            className="my-4 rounded-lg border border-[var(--border-subtle)] bg-n2 p-4 font-mono text-[12px] text-t3 whitespace-pre-wrap"
          >
            <div className="micro-label mb-2">diagram</div>
            {buf.join('\n')}
          </div>
        )
      } else {
        out.push(
          <pre
            key={key++}
            className="my-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-sunken p-4 font-mono text-[12.5px] leading-relaxed text-t2"
          >
            {buf.join('\n')}
          </pre>
        )
      }
      continue
    }

    // table
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1])) {
      const rows: string[][] = []
      const header = line
      i += 2
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
        i++
      }
      const heads = header.split('|').slice(1, -1).map((c) => c.trim())
      out.push(
        <div key={key++} className="my-4 overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-n2">
                {heads.map((h, j) => (
                  <th key={j} className="px-3 py-2 text-left font-medium text-t2 border-b border-[var(--border-subtle)]">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, j) => (
                <tr key={j} className="border-b border-[var(--border-subtle)] last:border-0">
                  {r.map((c, k2) => (
                    <td key={k2} className="px-3 py-2 text-t2">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // headings
    const hm = line.match(/^(#{1,4})\s+(.*)/)
    if (hm) {
      const lvl = hm[1].length
      const cls =
        lvl === 1
          ? 'text-[22px] font-semibold tracking-tight text-t1 mt-2 mb-3'
          : lvl === 2
            ? 'text-[16px] font-semibold text-t1 mt-6 mb-2'
            : lvl === 3
              ? 'text-[14px] font-semibold text-t1 mt-5 mb-1.5'
              : 'text-[13px] font-medium text-t2 mt-4 mb-1'
      out.push(
        <div key={key++} className={cls}>
          {inline(hm[2])}
        </div>
      )
      i++
      continue
    }

    // list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      out.push(
        <ul key={key++} className="my-3 space-y-1.5 pl-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2.5 text-[13.5px] leading-relaxed text-t2">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-t4" />
              <span>{inline(it)}</span>
            </li>
          ))}
        </ul>
      )
      continue
    }

    // hr
    if (/^---+$/.test(line.trim())) {
      out.push(<hr key={key++} className="my-6 border-[var(--border-subtle)]" />)
      i++
      continue
    }

    // paragraph
    if (line.trim()) {
      out.push(
        <p key={key++} className="my-3 text-[13.5px] leading-[1.7] text-t2">
          {inline(line)}
        </p>
      )
    }
    i++
  }
  return out
}

/** Accepts both resolver shapes: LinkResolution, or legacy id | null. */
function normalizeResolution(r: string | null | LinkResolution): LinkResolution {
  if (r == null) return { exists: false }
  if (typeof r === 'string') return { id: r, exists: true }
  return r
}

/**
 * A [[link]] that matched no page: dashed underline, click asks the scribe to
 * write it. Shows a brief "requested" state so the click doesn't feel dead.
 */
function MissingLink({
  label,
  target,
  onRequest
}: {
  label: string
  target: string
  onRequest?: (target: string) => void
}) {
  const [requested, setRequested] = useState(false)
  if (!onRequest) {
    return (
      <span
        className="text-t4 underline decoration-dotted underline-offset-2"
        title="Unresolved link"
      >
        {label}
      </span>
    )
  }
  return (
    <button
      onClick={() => {
        if (requested) return
        onRequest(target)
        setRequested(true)
        window.setTimeout(() => setRequested(false), 1500)
      }}
      className="cursor-pointer text-t4 underline decoration-dashed underline-offset-2 transition-colors hover:text-t3"
      title="Page doesn't exist — click to request it"
    >
      {label}
      {requested && (
        <span
          className="ml-1.5 text-[10px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--color-accent)' }}
        >
          requested
        </span>
      )}
    </button>
  )
}
