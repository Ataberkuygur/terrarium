// ── network topic suggestion ─────────────────────────────────────────
// A network's topic ("Web 1: Senior loop") is normally set by its
// orchestrator (`tnet topic …`), but that is only a request in the primer —
// many orchestrators never do it. For those, read the start of the
// orchestrator's claude transcript (mission messages + its first replies)
// and ask a headless `claude -p` (haiku, no tools/MCP/hooks, not persisted)
// for a 2–4 word label. Jev can't do this — it only answers typed choices.

import { spawn } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Transcript head sampled — the mission is always near the top. */
const HEAD_BYTES = 1024 * 1024
/** Conversation text handed to the model. */
const MAX_CONTEXT_CHARS = 5000
const TIMEOUT_MS = 60_000
/** The Terrarium primer (lib/orchestration orchestratorPrimer) — not the mission. */
const PRIMER_RE = /^\s*You are the ORCHESTRATOR of Terrarium agent network/
/** Cheapest model, no tools/MCP/settings hooks, nothing written to the session store. */
const CLAUDE_CMD =
  'claude -p --model haiku --no-session-persistence --tools "" --strict-mcp-config --setting-sources ""'

async function findTranscript(sessionId: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(sessionId)) return null
  const root = join(homedir(), '.claude', 'projects')
  const dirs = await readdir(root).catch(() => [] as string[])
  for (const d of dirs) {
    const file = join(root, d, `${sessionId}.jsonl`)
    if (await stat(file).then((s) => s.isFile(), () => false)) return file
  }
  return null
}

async function readHead(file: string): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((x: { type?: string }) => x?.type === 'text')
    .map((x: { text?: string }) => x.text ?? '')
    .join(' ')
}

/** User asks + assistant prose from the transcript head, primer and tool noise dropped. */
function conversationText(head: string): string {
  const parts: string[] = []
  let len = 0
  for (const line of head.split('\n')) {
    if (len >= MAX_CONTEXT_CHARS) break
    let j: { type?: string; isMeta?: boolean; message?: { content?: unknown } }
    try {
      j = JSON.parse(line)
    } catch {
      continue // partial line at the head boundary
    }
    if ((j.type !== 'user' && j.type !== 'assistant') || j.isMeta) continue
    let t = textOf(j.message?.content)
      .replace(/<\/?pasted_content[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!t || PRIMER_RE.test(t)) continue
    // command/caveat wrappers and system reminders
    if (j.type === 'user' && t.startsWith('<')) continue
    t = t.slice(0, 1200)
    parts.push(`${j.type === 'user' ? 'USER' : 'ORCHESTRATOR'}: ${t}`)
    len += t.length
  }
  return parts.join('\n').slice(0, MAX_CONTEXT_CHARS)
}

function runClaude(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    const finish = (v: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const env = { ...process.env }
    for (const k of Object.keys(env)) if (k.startsWith('TERRARIUM_')) delete env[k]
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(
        CLAUDE_CMD,
        // shell resolves claude(.exe|.cmd); every arg is a fixed literal,
        // the transcript text only ever travels over stdin
        { cwd: tmpdir(), env, shell: true, windowsHide: true }
      )
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      // the shell is the child — take claude down with it
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
          'error',
          () => undefined
        )
      } else child.kill()
      finish(null)
    }, TIMEOUT_MS)
    child.stdout?.on('data', (d) => (out += d))
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? out : null))
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(prompt)
  })
}

/** "Export speed", not '"Export speed."' or a sentence. */
function cleanTopic(raw: string | null): string | null {
  const line = raw?.split('\n').map((l) => l.trim()).find(Boolean)
  if (!line) return null
  const t = line
    .replace(/^(topic|label)\s*:\s*/i, '')
    .replace(/^["'`*_]+|["'`*_.]+$/g, '')
    .trim()
  if (!t || t.length > 40 || t.split(/\s+/).length > 5) return null
  return t
}

/**
 * 2–4 word topic for the network whose orchestrator is claude session
 * `sessionId`, or null (no transcript, no mission yet, CLI failed).
 */
export async function suggestNetworkTopic(
  sessionId: string,
  agentTitles: string[] = []
): Promise<string | null> {
  const file = await findTranscript(sessionId)
  if (!file) return null
  const convo = conversationText(await readHead(file).catch(() => ''))
  if (convo.length < 40) return null
  const agents = agentTitles
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, 12)
    .map((t) => t.trim().slice(0, 40))
  const prompt = [
    'Below is the start of a conversation between a user and an AI orchestrator that coordinates coding sub-agents.',
    'Name what this network is working on with a 2–4 word topic label, written in the language the USER writes in',
    '(format examples only — never reuse them: "Senior loop", "Ödeme akışı", "Auth refactor").',
    'Reply with ONLY the label — no quotes, no punctuation, no explanation.',
    '',
    agents.length ? `Sub-agents: ${agents.join(', ')}` : '',
    '--- conversation ---',
    convo,
    '--- end ---'
  ].join('\n')
  return cleanTopic(await runClaude(prompt))
}
