// ── Mobile control + remote API — LAN/loopback HTTP for phone & tools ─
// A second HTTP server alongside the pane bridge, but bound to the LAN
// interface instead of loopback. Everything is gated on a persistent
// per-install token (stored in ~/.terrarium/mobile-token) — the desktop
// shows a QR of http://<lan-ip>:<port>/?k=<token>; API clients send it as
// `?k=` or `Authorization: Bearer`.
//
// Surface: engine state, card CRUD/move/assign, agent upsert/remove/nudge,
// wiki read/save, pty terminal control, and a pane-bridge passthrough —
// the same vocabulary the standalone terrarium-mcp executable wraps.

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { networkInterfaces } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import type { Engine } from './engine/engine'
import type { PtyManager } from './pty/manager'
import type { CardStatus, OfficeEvent, TaskCard, WikiPage, WikiPageMeta } from '../shared/types'
import { ensurePaths } from './engine/paths'
import { paneBridgePort } from './pane-bridge'

const PORT_MIN = 8795
const PORT_MAX = 8804
const MAX_EVENTS = 80
const MAX_BODY = 512 * 1024

export interface MobileInfo {
  /** Full URL incl. token — what the QR encodes. */
  url: string
  /** Base URL without the token, for display. */
  host: string
  port: number
  /** LAN address used in `url`. */
  ip: string
}

// ── token ────────────────────────────────────────────────────────────
// Persisted so a bookmarked/scanned URL survives app restarts.
function loadOrCreateToken(): string {
  const file = join(ensurePaths().home, 'mobile-token')
  try {
    if (existsSync(file)) {
      const t = readFileSync(file, 'utf8').trim()
      if (t.length >= 16) return t
    }
  } catch {
    /* fall through to minting */
  }
  const t = randomBytes(18).toString('base64url')
  try {
    writeFileSync(file, t, { mode: 0o600 })
  } catch {
    /* still usable in-memory; just won't persist */
  }
  return t
}

/** First non-internal IPv4 — prefers private ranges over CGNAT/others. */
function lanIp(): string | null {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) found.push(i.address)
    }
  }
  return (
    found.find((a) => /^192\.168\./.test(a)) ??
    found.find((a) => /^10\./.test(a)) ??
    found.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    found[0] ??
    null
  )
}

function authed(req: IncomingMessage, token: string): boolean {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.searchParams.get('k') === token) return true
  const auth = req.headers.authorization
  return auth === `Bearer ${token}`
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': buf.length })
  res.end(buf)
}

// ── mobile page ──────────────────────────────────────────────────────
// One self-contained document: inline CSS + vanilla JS polling /api/state.
// TOKEN is baked in at serve time — the URL the phone opened already
// carried it, so nothing extra to type.
function page(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0b0d">
<title>terrarium</title>
<style>
:root{color-scheme:dark}
*{margin:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{background:#0a0b0d;color:#ecedef;font:14px/1.45 -apple-system,'Segoe UI',Inter,system-ui,sans-serif;
  padding:calc(10px + env(safe-area-inset-top)) 12px calc(24px + env(safe-area-inset-bottom));}
main{max-width:520px;margin:0 auto}
header{display:flex;align-items:center;gap:8px;padding:6px 2px 14px}
.brand{display:flex;align-items:center;gap:7px;font-weight:600;font-size:15px}
.brand i{width:10px;height:10px;border-radius:3px;background:#f5a524}
#conn{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;color:#6b6e75}
#conn i{width:7px;height:7px;border-radius:50%;background:#46a758}
#conn.off i{background:#f2555a}
section{margin-bottom:18px}
h2{font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6b6e75;
  padding:0 2px 8px}
.card{background:#101114;border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden}
.row{display:flex;align-items:center;gap:10px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.05)}
.row:last-child{border-bottom:0}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.dot.pulse{animation:p 1.6s infinite}
@keyframes p{50%{opacity:.25}}
.ag-name{font-weight:550;font-size:13.5px}
.ag-task{font-size:11.5px;color:#83858d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ag-meta{margin-left:auto;font-size:10.5px;color:#4a4c52;flex:none}
.ev{display:flex;gap:9px;padding:8px 12px;font-size:12px;color:#a9abb3;border-bottom:1px solid rgba(255,255,255,.045)}
.ev:last-child{border-bottom:0}
.ev time{color:#4a4c52;font-size:10.5px;flex:none;padding-top:1px;font-variant-numeric:tabular-nums}
.ev span{overflow:hidden}
.cols{display:flex;gap:8px}
.col{flex:1;background:#101114;border:1px solid rgba(255,255,255,.07);border-radius:10px;
  padding:9px 10px;text-align:center}
.col b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
.col span{font-size:10px;color:#6b6e75;text-transform:uppercase;letter-spacing:.06em}
#sheet{position:fixed;inset:0;background:rgba(4,5,6,.6);display:none;align-items:flex-end}
#sheet.open{display:flex}
.panel{background:#16171b;border:1px solid rgba(255,255,255,.1);border-bottom:0;border-radius:16px 16px 0 0;
  width:100%;max-width:520px;margin:0 auto;padding:16px 16px calc(18px + env(safe-area-inset-bottom))}
.panel h3{font-size:14px;margin-bottom:10px}
.nudge{display:flex;gap:8px}
.nudge input{flex:1;background:#0a0b0d;border:1px solid rgba(255,255,255,.12);border-radius:9px;
  padding:10px 12px;color:#ecedef;font-size:14px;outline:none}
.nudge input:focus{border-color:#f5a524}
.nudge button{background:#f5a524;color:#171006;border:0;border-radius:9px;padding:0 16px;
  font-weight:600;font-size:13px}
.panel .hint{font-size:11px;color:#6b6e75;margin-top:10px;text-align:center}
#toast{position:fixed;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);
  background:#232429;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:8px 14px;
  font-size:12px;display:none;z-index:9}
.empty{padding:14px;font-size:12.5px;color:#6b6e75;text-align:center}
</style>
</head>
<body>
<main>
<header>
  <div class="brand"><i></i>terrarium</div>
  <div id="conn"><i></i><span>live</span></div>
</header>

<section>
  <h2>Crew</h2>
  <div class="card" id="agents"><div class="empty">No agents</div></div>
</section>

<section>
  <h2>Board</h2>
  <div class="cols" id="cols"></div>
</section>

<section>
  <h2>Activity</h2>
  <div class="card" id="events"><div class="empty">Nothing yet</div></div>
</section>
</main>

<div id="sheet"><div class="panel">
  <h3 id="sheet-title">Nudge</h3>
  <form class="nudge" id="nudge-form">
    <input id="nudge-text" placeholder="Message…" autocomplete="off" enterkeyhint="send">
    <button type="submit">Send</button>
  </form>
  <div class="hint">tap outside to close</div>
</div></div>
<div id="toast"></div>

<script>
const TOKEN=${JSON.stringify(token)};
const $=(s)=>document.querySelector(s);
const STATUS={working:'#ffb224',waiting:'#f2555a',idle:'#6e7078',done:'#46a758',offline:'#3a3c44'};
let agents=[],cards=[],target=null;

function ago(ms){const s=Math.max(0,(Date.now()-ms)/1000);
  if(s<60)return'now';if(s<3600)return Math.floor(s/60)+'m';
  if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d'}

function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

function render(){
  const box=$('#agents');
  if(!agents.length){box.innerHTML='<div class="empty">No agents</div>'}
  else{
    const taskOf={};for(const c of cards)taskOf[c.id]=c.title;
    box.innerHTML=agents.map(a=>{
      const col=STATUS[a.status]||'#6e7078';
      const task=a.taskId&&taskOf[a.taskId]?taskOf[a.taskId]:(a.sleeping?'sleeping':a.status);
      return '<div class="row" data-id="'+a.id+'">'+
        '<i class="dot'+(a.status==='working'||a.status==='waiting'?' pulse':'')+'" style="background:'+col+'"></i>'+
        '<div><div class="ag-name">'+esc(a.name)+'</div>'+
        '<div class="ag-task">'+esc(task)+'</div></div>'+
        '<div class="ag-meta">'+ago(a.lastActiveAt||0)+'</div></div>'}).join('');
    for(const r of box.querySelectorAll('.row'))r.onclick=()=>openSheet(r.dataset.id);
  }
  const order=['doing','review','ready','backlog','done'];
  const n={};for(const c of cards)n[c.status]=(n[c.status]||0)+1;
  $('#cols').innerHTML=order.map(s=>'<div class="col"><b>'+(n[s]||0)+'</b><span>'+s+'</span></div>').join('');
  const ev=$('#events');
  ev.innerHTML=window._ev.length
    ?window._ev.map(e=>'<div class="ev"><time>'+ago(e.ts)+'</time><span>'+esc(e.text)+'</span></div>').join('')
    :'<div class="empty">Nothing yet</div>';
}

function openSheet(id){target=id;const a=agents.find(x=>x.id===id);
  $('#sheet-title').textContent='Nudge '+(a?a.name:'agent');
  $('#nudge-text').value='';$('#sheet').classList.add('open');
  setTimeout(()=>$('#nudge-text').focus(),60)}
$('#sheet').onclick=e=>{if(e.target.id==='sheet')$('#sheet').classList.remove('open')};

function toast(t){const el=$('#toast');el.textContent=t;el.style.display='block';
  setTimeout(()=>el.style.display='none',2200)}

$('#nudge-form').onsubmit=async e=>{e.preventDefault();
  const msg=$('#nudge-text').value.trim();if(!msg||!target)return;
  $('#sheet').classList.remove('open');
  try{
    const r=await fetch('/api/nudge?k='+TOKEN,{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({agentId:target,message:msg})});
    toast(r.ok?'sent':'failed ('+r.status+')');
  }catch{toast('failed — no connection')}
};

window._ev=[];
async function poll(){
  try{
    const r=await fetch('/api/state?k='+TOKEN);
    if(!r.ok){$('#conn').className='off';$('#conn').lastChild.textContent=r.status===403?'bad token':'error';return}
    const s=await r.json();
    agents=s.agents;cards=s.cards;window._ev=s.events;
    $('#conn').className='';$('#conn').lastChild.textContent='live';
    render();
  }catch{$('#conn').className='off';$('#conn').lastChild.textContent='offline'}
}
poll();setInterval(poll,3000);
</script>
</body>
</html>`
}

// ── server ───────────────────────────────────────────────────────────

/** Wiki surface the API exposes — vault index when present, engine docs otherwise. */
export interface WikiApi {
  list(): Promise<WikiPageMeta[]> | WikiPageMeta[]
  get(id: string): Promise<WikiPage> | WikiPage
  search(q: string): Promise<WikiPageMeta[]> | WikiPageMeta[]
  save(id: string, body: string): Promise<unknown> | unknown
}

export interface RemoteApiDeps {
  /** App version string for /api/info. */
  version?: string
  /** pty manager — when present, /api/terminals/* is live. */
  pty?: PtyManager
  /** Resolve the wiki backend for a project (vault or engine docs). */
  wiki?: (projectId: string) => WikiApi | null
}

const CARD_STATUSES: readonly CardStatus[] = ['backlog', 'ready', 'doing', 'review', 'done']

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Error with an HTTP status — thrown from route handlers, mapped in the server. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function startMobileServer(
  engine: Engine,
  deps: RemoteApiDeps = {}
): Promise<MobileInfo | null> {
  const token = loadOrCreateToken()
  const events: OfficeEvent[] = []
  engine.onEvent((e) => {
    events.unshift(e)
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  })
  const startedAt = Date.now()

  const defaultProjectId = async (): Promise<string> => {
    const s = await engine.getState()
    const pid = s.projects[0]?.id
    if (!pid) throw new ApiError(404, 'no project')
    return pid
  }

  const requireBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const parsed: unknown = JSON.parse((await readBody(req)) || '{}')
    if (!isRecord(parsed)) throw new ApiError(400, 'body must be a JSON object')
    return parsed
  }

  const wikiFor = async (projectId?: string): Promise<WikiApi> => {
    const w = deps.wiki?.(projectId ?? (await defaultProjectId()))
    if (!w) throw new ApiError(404, `no wiki for project ${projectId ?? '(default)'}`)
    return w
  }

  const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const m = (re: RegExp) => path.match(re)

    // ── meta ──
    if (method === 'GET' && path === '/api/info') {
      return json(res, 200, {
        ok: true,
        app: 'terrarium',
        version: deps.version ?? '0.0.0',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        terminals: !!deps.pty,
        wiki: !!deps.wiki,
        panePort: paneBridgePort()
      })
    }

    // ── engine state ──
    if (method === 'GET' && path === '/api/state') {
      const s = await engine.getState()
      return json(res, 200, s)
    }
    if (method === 'GET' && path === '/api/events') {
      const limit = Math.min(200, Math.max(1, num(url.searchParams.get('limit')) ?? 80))
      return json(res, 200, { events: events.slice(0, limit) })
    }

    // ── cards ──
    if (method === 'GET' && path === '/api/cards') {
      const s = await engine.getState()
      const status = url.searchParams.get('status')
      const assignee = url.searchParams.get('assignee')
      let cards = s.cards
      if (status) cards = cards.filter((c) => c.status === status)
      if (assignee) cards = cards.filter((c) => c.assigneeId === assignee)
      return json(res, 200, { cards })
    }
    if (method === 'POST' && path === '/api/cards') {
      const body = await requireBody(req)
      const title = str(body.title)?.trim()
      if (!title) throw new ApiError(400, 'title required')
      const card = await engine.createCard({
        title,
        body: str(body.body),
        projectId: str(body.projectId) ?? (await defaultProjectId()),
        dueAt: num(body.dueAt) ?? null
      })
      return json(res, 201, { card })
    }
    let match = m(/^\/api\/cards\/([^/]+)$/)
    if (match) {
      const cardId = decodeURIComponent(match[1])
      if (method === 'GET') {
        const s = await engine.getState()
        const card = s.cards.find((c) => c.id === cardId)
        if (!card) throw new ApiError(404, `no card ${cardId}`)
        return json(res, 200, { card })
      }
      if (method === 'PATCH') {
        const body = await requireBody(req)
        const patch: Partial<Pick<TaskCard, 'title' | 'body' | 'priority' | 'dueAt'>> = {}
        if ('title' in body) patch.title = str(body.title)
        if ('body' in body) patch.body = str(body.body)
        if ('priority' in body) {
          const p = num(body.priority)
          if (p !== 0 && p !== 1 && p !== 2) throw new ApiError(400, 'priority must be 0|1|2')
          patch.priority = p
        }
        if ('dueAt' in body) {
          const d = body.dueAt
          patch.dueAt = d === null ? null : num(d)
          if (patch.dueAt === undefined) throw new ApiError(400, 'dueAt must be ms epoch or null')
        }
        await engine.updateCard(cardId, patch)
        return json(res, 200, { ok: true })
      }
      if (method === 'DELETE') {
        await engine.deleteCard(cardId)
        return json(res, 200, { ok: true })
      }
      throw new ApiError(405, 'method not allowed')
    }
    match = m(/^\/api\/cards\/([^/]+)\/move$/)
    if (match && method === 'POST') {
      const body = await requireBody(req)
      const status = str(body.status) as CardStatus | undefined
      if (!status || !CARD_STATUSES.includes(status)) {
        throw new ApiError(400, `status must be one of ${CARD_STATUSES.join('|')}`)
      }
      await engine.moveCard(decodeURIComponent(match[1]), status)
      return json(res, 200, { ok: true })
    }
    match = m(/^\/api\/cards\/([^/]+)\/assign$/)
    if (match && method === 'POST') {
      const body = await requireBody(req)
      const agentId = str(body.agentId)
      if (!agentId) throw new ApiError(400, 'agentId required')
      await engine.assignCard(decodeURIComponent(match[1]), agentId)
      return json(res, 200, { ok: true })
    }

    // ── agents ──
    if (method === 'GET' && path === '/api/agents') {
      const s = await engine.getState()
      return json(res, 200, { agents: s.agents })
    }
    if (method === 'POST' && path === '/api/agents') {
      const body = await requireBody(req)
      const agent = body.agent && isRecord(body.agent) ? body.agent : body
      if (!str(agent.id) || !str(agent.name)) throw new ApiError(400, 'agent.id + agent.name required')
      await engine.upsertAgent(agent as never)
      return json(res, 200, { ok: true })
    }
    match = m(/^\/api\/agents\/([^/]+)$/)
    if (match && method === 'DELETE') {
      await engine.removeAgent(decodeURIComponent(match[1]))
      return json(res, 200, { ok: true })
    }
    match = m(/^\/api\/agents\/([^/]+)\/nudge$/)
    if (match && method === 'POST') {
      const body = await requireBody(req)
      const message = str(body.message)?.trim().slice(0, 500)
      if (!message) throw new ApiError(400, 'message required')
      await engine.nudgeAgent(decodeURIComponent(match[1]), message)
      return json(res, 200, { ok: true })
    }
    // legacy nudge route (mobile page)
    if (method === 'POST' && path === '/api/nudge') {
      const body = await requireBody(req)
      const message = str(body.message)?.trim().slice(0, 500)
      if (!str(body.agentId) || !message) throw new ApiError(400, 'agentId + message required')
      await engine.nudgeAgent(str(body.agentId)!, message)
      return json(res, 200, { ok: true })
    }

    // ── wiki ──
    if (method === 'GET' && path === '/api/wiki') {
      const w = await wikiFor(str(url.searchParams.get('projectId')) ?? undefined)
      const q = url.searchParams.get('q')
      const pages = q ? await w.search(q) : await w.list()
      return json(res, 200, { pages })
    }
    match = m(/^\/api\/wiki\/([^/]+)$/)
    if (match) {
      const pageId = decodeURIComponent(match[1])
      if (method === 'GET') {
        const w = await wikiFor(str(url.searchParams.get('projectId')) ?? undefined)
        return json(res, 200, { page: await w.get(pageId) })
      }
      if (method === 'PUT') {
        const body = await requireBody(req)
        const w = await wikiFor(str(body.projectId))
        if (!str(body.body)) throw new ApiError(400, 'body required')
        await w.save(pageId, str(body.body)!)
        return json(res, 200, { ok: true })
      }
      throw new ApiError(405, 'method not allowed')
    }

    // ── pty terminals ──
    if (path.startsWith('/api/terminals')) {
      if (!deps.pty) throw new ApiError(503, 'pty manager unavailable')
      const pty = deps.pty
      if (method === 'GET' && path === '/api/terminals') {
        return json(res, 200, { sessions: await pty.list() })
      }
      if (method === 'POST' && path === '/api/terminals') {
        const body = await requireBody(req)
        const command = str(body.command)?.trim()
        const cwd = str(body.cwd)?.trim()
        if (!command || !cwd) throw new ApiError(400, 'command + cwd required')
        const args = Array.isArray(body.args) ? body.args.filter((a): a is string => typeof a === 'string') : []
        const env =
          isRecord(body.env) && body.env
            ? Object.fromEntries(
                Object.entries(body.env).filter((e): e is [string, string] => typeof e[1] === 'string')
              )
            : {}
        const info = await pty.spawn({
          sessionId: str(body.sessionId) ?? `api-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
          cwd,
          command,
          args,
          env,
          cols: num(body.cols),
          rows: num(body.rows)
        })
        return json(res, 201, { session: info })
      }
      match = m(/^\/api\/terminals\/([^/]+)\/read$/)
      if (match && method === 'GET') {
        const maxChars = num(url.searchParams.get('maxChars')) ?? 32 * 1024
        const data = await pty.readTail(decodeURIComponent(match[1]), maxChars)
        return json(res, 200, { data })
      }
      match = m(/^\/api\/terminals\/([^/]+)\/write$/)
      if (match && method === 'POST') {
        const body = await requireBody(req)
        pty.write(decodeURIComponent(match[1]), str(body.data) ?? '')
        return json(res, 200, { ok: true })
      }
      match = m(/^\/api\/terminals\/([^/]+)\/resize$/)
      if (match && method === 'POST') {
        const body = await requireBody(req)
        const cols = num(body.cols)
        const rows = num(body.rows)
        if (!cols || !rows) throw new ApiError(400, 'cols + rows required')
        pty.resize(decodeURIComponent(match[1]), cols, rows)
        return json(res, 200, { ok: true })
      }
      match = m(/^\/api\/terminals\/([^/]+)(?:\/kill)?$/)
      if (match && (method === 'DELETE' || (method === 'POST' && path.endsWith('/kill')))) {
        await pty.kill(decodeURIComponent(match[1]))
        return json(res, 200, { ok: true })
      }
      throw new ApiError(404, 'not found')
    }

    // ── pane bridge passthrough ──
    if (method === 'POST' && path === '/api/pane') {
      const port = paneBridgePort()
      if (!port) throw new ApiError(503, 'pane bridge unavailable (open Workspace view)')
      const body = await readBody(req)
      const upstream = await fetch(`http://127.0.0.1:${port}/cmd`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json'
      })
      res.end(text)
      return
    }

    throw new ApiError(404, 'not found')
  }

  const server = createServer(async (req, res) => {
    try {
      if (!authed(req, token)) {
        if ((req.url ?? '').startsWith('/api/')) return json(res, 403, { error: 'forbidden' })
        res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
        return
      }
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'GET' && url.pathname === '/') {
        const buf = Buffer.from(page(token))
        res
          .writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': buf.length,
            'cache-control': 'no-store'
          })
          .end(buf)
        return
      }
      if (url.pathname.startsWith('/api/')) {
        try {
          await handleApi(req, res)
        } catch (err) {
          if (err instanceof ApiError) return json(res, err.status, { error: err.message })
          json(res, 500, { error: err instanceof Error ? err.message : 'internal' })
        }
        return
      }
      json(res, 404, { error: 'not found' })
    } catch {
      json(res, 500, { error: 'internal' })
    }
  })

  return new Promise<MobileInfo | null>((resolve) => {
    const tryPort = (port: number) => {
      if (port > PORT_MAX) return resolve(null)
      server.once('error', () => tryPort(port + 1))
      server.listen(port, '0.0.0.0', () => {
        const ip = lanIp()
        if (!ip) {
          server.close()
          return resolve(null)
        }
        const host = `http://${ip}:${port}`
        resolve({ host, port, ip, url: `${host}/?k=${token}` })
      })
    }
    tryPort(PORT_MIN)
  })
}
