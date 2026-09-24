// ── Jev (TypeSafe AI) main-process client ───────────────────────────
// POST https://api.typesafe.ai/v1/systemone — one `state` + a map of
// typed `questions`, answered in parallel. NOT OpenAI-shaped.
//
// Design rules (mirrors the lumiere integration):
// - Main-only. TYPESAFE_API_KEY must never reach the renderer bundle —
//   the renderer asks over IPC ('terrarium:jev:decide') and gets back the
//   typed answers, never the key.
// - Resolves to null on ANY failure (missing key, kill switch, network,
//   timeout, malformed body) — Jev is a decision accelerator layered
//   over existing fallbacks, never a hard dependency.
//
// Key resolution order:
//   1. process.env.TYPESAFE_API_KEY
//   2. ~/.terrarium/.env  (KEY=VALUE lines — a desktop app has no .env.local)

import { ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultHome } from './engine/paths'
import {
  JEV_IPC,
  type JevAnswerMap,
  type JevKeyStatus,
  type JevQuestionMap,
  type JevRequest
} from '../shared/jev'

const JEV_MODEL_ID = 'jev-latest'
const JEV_DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
/** ~3s: domain classification rides on UI freshness; the heuristic fallback is instant. */
const DEFAULT_JEV_TIMEOUT_MS = 3000

let cachedEnv: Record<string, string> | null = null

/** Decode .env bytes — PowerShell's '>' / 'Out-File' write UTF-16LE. */
function decodeEnv(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

/** ~/.terrarium/.env → { KEY: value } — read once; edits need an app restart. */
function fileEnv(): Record<string, string> {
  if (cachedEnv) return cachedEnv
  cachedEnv = {}
  try {
    const path = join(defaultHome(), '.env')
    if (!existsSync(path)) return cachedEnv
    for (const line of decodeEnv(readFileSync(path)).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !line.trimStart().startsWith('#')) {
        cachedEnv[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {
    /* unreadable — env vars still apply */
  }
  return cachedEnv
}

function env(key: string): string | undefined {
  return process.env[key]?.trim() || fileEnv()[key]?.trim() || undefined
}

function resolveJevApiKey(): string | undefined {
  return env('TYPESAFE_API_KEY')
}

function resolveJevEndpoint(): string {
  return env('TYPESAFE_ENDPOINT') ?? JEV_DEFAULT_ENDPOINT
}

function resolveJevTimeoutMs(): number {
  const parsed = Number(env('JEV_TIMEOUT_MS'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JEV_TIMEOUT_MS
}

/** Jev is on whenever a key exists, unless JEV_ENABLED=0 kills it. */
export function isJevEnabled(): boolean {
  const flag = env('JEV_ENABLED')
  if (flag === '0' || flag === 'false') return false
  return resolveJevApiKey() !== undefined
}

function sanitizeQuestions(questions: JevQuestionMap): JevQuestionMap | null {
  const entries = Object.entries(questions)
  if (entries.length === 0) return null
  for (const [id, q] of entries) {
    if (!id || !q || typeof q !== 'object') return null
    if (q.type === 'choice') {
      const options = Object.keys(q.criteria ?? {})
      if (options.length === 0 || options.length > 255) return null
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2) return null
    } else if (q.type !== 'noul') {
      return null
    }
  }
  return questions
}

/**
 * Ask Jev a batch of typed questions against one state. Returns the
 * answer map, or null when Jev is disabled/unconfigured/failed —
 * callers MUST handle null by falling back to their pre-Jev behavior.
 */
export async function decideJev(
  state: JevRequest['state'],
  questions: JevQuestionMap
): Promise<{ answers: JevAnswerMap } | null> {
  if (!isJevEnabled()) return null
  const sanitized = sanitizeQuestions(questions)
  if (!sanitized) return null
  const apiKey = resolveJevApiKey()
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), resolveJevTimeoutMs())
  try {
    const response = await fetch(resolveJevEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ state, model: JEV_MODEL_ID, questions: sanitized }),
      signal: controller.signal
    })
    if (!response.ok) return null
    const body = (await response.json()) as { answers?: JevAnswerMap }
    if (!body || typeof body !== 'object' || !body.answers || typeof body.answers !== 'object') {
      return null
    }
    return { answers: body.answers }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── settings: key management (the key itself never leaves main) ──

function keyStatus(): JevKeyStatus {
  const fromEnv = process.env.TYPESAFE_API_KEY?.trim()
  const key = resolveJevApiKey()
  return {
    configured: !!key,
    source: fromEnv ? 'env' : key ? 'file' : null,
    masked: key ? `••••${key.slice(-4)}` : null,
    enabled: isJevEnabled() || !key
  }
}

/** Write/replace (or remove, when empty) TYPESAFE_API_KEY in ~/.terrarium/.env,
 * keeping every other line; takes effect immediately. */
function saveKey(raw: string): JevKeyStatus {
  const key = String(raw ?? '').trim().replace(/[\r\n"']/g, '')
  const path = join(defaultHome(), '.env')
  let lines: string[] = []
  try {
    if (existsSync(path)) lines = decodeEnv(readFileSync(path)).split(/\r?\n/)
  } catch {
    lines = []
  }
  lines = lines.filter((l) => !/^\s*TYPESAFE_API_KEY\s*=/.test(l))
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (key) lines.push(`TYPESAFE_API_KEY=${key}`)
  writeFileSync(path, lines.length ? lines.join('\n') + '\n' : '', 'utf8')
  cachedEnv = null
  return keyStatus()
}

/** One tiny request to prove the key + endpoint work. */
async function testKey(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = resolveJevApiKey()
  if (!apiKey) return { ok: false, error: 'no key' }
  try {
    const res = await fetch(resolveJevEndpoint(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: 'Terrarium settings connection test.',
        model: JEV_MODEL_ID,
        questions: { ping: { type: 'noul', instructions: 'Is this a connection test?' } }
      }),
      signal: AbortSignal.timeout(8000)
    })
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Wire the IPC channel the renderer's classifier calls. */
export function registerJevIpc(): void {
  ipcMain.handle(JEV_IPC.KEY_STATUS, () => keyStatus())
  ipcMain.handle(JEV_IPC.KEY_SET, (_e, key: string) => saveKey(key))
  ipcMain.handle(JEV_IPC.KEY_TEST, () => testKey())
  ipcMain.handle(JEV_IPC.DECIDE, async (_e, req: JevRequest) => {
    try {
      if (!req || typeof req !== 'object' || !req.questions) return null
      return await decideJev(req.state, req.questions)
    } catch {
      return null
    }
  })
}
