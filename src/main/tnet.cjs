#!/usr/bin/env node
// tnet — drive a Terrarium orchestration network from the orchestrator's shell.
// Installed by the app into ~/.terrarium/bin (on PATH inside network terminals)
// and run through the app's own runtime (ELECTRON_RUN_AS_NODE) — no Node needed.
// Talks to the pane bridge (/cmd) with the caller's TERRARIUM_SID, so every
// command lands in the network this terminal belongs to.
'use strict'

const http = require('http')

const ENDPOINT =
  process.env.TERRARIUM_WS_CMD || process.env.TERRARIUM_BROWSER_CMD || 'http://127.0.0.1:8791/cmd'
const SID = process.env.TERRARIUM_SID || ''
const NET = process.env.TERRARIUM_NET || ''

const HELP = [
  'tnet — orchestrate subagent terminals in your Terrarium network',
  '',
  '  tnet ls                                  subagents + status (busy|idle|starting|exited)',
  '  tnet spawn [task…] [--cli claude] [--name N] [--cwd DIR] [--count K]',
  '                                           tether new subagent(s); task = first prompt',
  '  tnet ask <agent> <message…> [--idle S] [--timeout S] [--lines N]',
  '                                           send, wait until it goes quiet, print its screen',
  '  tnet send <agent> <message…> [--no-enter]  type into a subagent',
  '  tnet read <agent> [--lines N]            rendered screen of a subagent (default 60 lines)',
  '  tnet wait <agent|all> [--idle S] [--timeout S]  block until quiet',
  '  tnet broadcast <message…>                send to every subagent',
  '  tnet kill <agent>                        cut the tether (ends the subagent)',
  '  tnet focus <agent>                       pop it open in the UI',
  '  tnet rename <agent> <name>               rename a subagent',
  '  tnet topic <words…>                      label this network ("Web 1: <topic>"); no words clears',
  '  tnet info | tnet nets                    this network / all networks',
  '  tnet mcp [on|off]                        Devin browser MCPs (playwright + chrome-devtools);',
  '                                           on = loaded by Devin sessions started/resumed after it',
  '',
  '  An idle Devin subagent is put to sleep after a while (status "asleep") —',
  '  `tnet send`/`ask` wakes it in the same conversation.',
  '  <agent> = index (1, 2…) | name (prefix ok) | id | "orchestrator"',
  '  --json prints raw JSON. Idle = no output for --idle seconds (default 4).',
  '',
  'Pattern: spawn workers with self-contained tasks → `tnet wait all` →',
  '`tnet read <n>` each → integrate. Use `tnet ask` for quick back-and-forth.'
].join('\n')

function parse(argv) {
  const flags = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      pos.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1)
      else if (a === '--json' || a === '--no-enter' || a === '--raw') flags[a.slice(2)] = true
      else flags[a.slice(2)] = argv[++i]
    } else pos.push(a)
  }
  return { flags, pos }
}

function call(cmd, args, timeoutMs) {
  const body = Object.assign({ cmd: cmd, sid: SID || undefined }, args || {})
  if (NET && body.net === undefined) body.net = NET
  if (timeoutMs) body.timeoutMs = timeoutMs
  const payload = JSON.stringify(body)
  const u = new URL(ENDPOINT)
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
      },
      function (res) {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', function (c) {
          data += c
        })
        res.on('end', function () {
          let j
          try {
            j = JSON.parse(data)
          } catch (e) {
            return reject(new Error('bad reply: ' + data.slice(0, 200)))
          }
          if (!j.ok) return reject(new Error(j.error || 'command failed'))
          resolve(j.result)
        })
      }
    )
    req.on('error', function (e) {
      reject(new Error('Terrarium not reachable at ' + ENDPOINT + ' (' + e.message + ')'))
    })
    req.setTimeout((timeoutMs || 20000) + 5000, function () {
      req.destroy(new Error('timed out'))
    })
    req.end(payload)
  })
}

function secs(v, d) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n * 1000 : d
}

function pad(s, n) {
  s = String(s == null ? '' : s)
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function printNet(info) {
  const o = info.orchestrator
  console.log((info.label || info.name) + '  (' + info.agents.length + ' subagents, default cli: ' + info.agentCommand + ')')
  console.log('  0  ' + pad(o.title, 16) + pad(o.status, 9) + o.command)
  for (const a of info.agents) {
    const quiet = a.quietSec == null ? '' : ' quiet ' + a.quietSec + 's'
    console.log(
      '  ' + pad(a.i, 3) + pad(a.title, 16) + pad(a.status, 9) + pad(a.command, 14) +
        (a.task ? ' — ' + a.task.slice(0, 60) : '') + quiet
    )
  }
}

/** Loop net.wait under the bridge's 120s ceiling until done or deadline. */
async function waitLoop(agent, idleMs, totalMs, since) {
  const deadline = Date.now() + totalMs
  for (;;) {
    const left = deadline - Date.now()
    const chunk = Math.max(3000, Math.min(110000, left))
    const r = await call('net.wait', { agent: agent, idleMs: idleMs, since: since }, chunk + 2000)
    if (r.done || Date.now() >= deadline) return r
  }
}

async function main() {
  const { flags, pos } = parse(process.argv.slice(2))
  const sub = (pos.shift() || 'help').toLowerCase()
  const json = !!flags.json
  const out = function (r, pretty) {
    if (json || !pretty) console.log(JSON.stringify(r, null, 2))
    else pretty(r)
  }
  const idleMs = secs(flags.idle, 4000)
  const totalMs = secs(flags.timeout, 600000)
  const lines = flags.lines ? Number(flags.lines) : 60

  switch (sub) {
    case 'help':
    case '-h':
    case '--help':
      console.log(HELP)
      return
    case 'ls':
    case 'list':
    case 'info':
      return out(await call('net.info'), printNet)
    case 'nets':
      return out(await call('net.list'), function (r) {
        r.forEach(function (n, i) {
          console.log(pad(i + 1, 3) + pad(n.label || n.name, 28) + n.agents.length + ' subagents' + (n.active ? '  (active tab)' : ''))
        })
      })
    case 'spawn': {
      const r = await call('net.spawn', {
        task: pos.join(' ') || undefined,
        command: flags.cli || flags.command,
        title: flags.name,
        cwd: flags.cwd,
        count: flags.count ? Number(flags.count) : undefined
      })
      return out(r, function (r) {
        r.spawned.forEach(function (a) {
          console.log('spawned #' + a.i + ' ' + a.title + ' (' + a.command + ')' + (a.task ? ' — task queued' : ''))
        })
      })
    }
    case 'send': {
      const agent = pos.shift()
      const r = await call('net.send', { agent: agent, data: pos.join(' '), enter: !flags['no-enter'], raw: !!flags.raw }, 90000)
      return out(r, function (r) {
        console.log('sent to ' + r.agent)
      })
    }
    case 'broadcast': {
      const r = await call('net.broadcast', { data: pos.join(' ') })
      return out(r, function (r) {
        console.log('sent to ' + r.sent + ' subagents')
      })
    }
    case 'read': {
      const r = await call('net.read', { agent: pos.shift(), lines: lines })
      return out(r, function (r) {
        console.log('── ' + r.agent + ' [' + r.status + '] ──')
        console.log(r.text)
      })
    }
    case 'wait': {
      const agent = pos.shift() || 'all'
      const r = await waitLoop(agent, idleMs, totalMs, 0)
      return out(r, function (r) {
        r.agents.forEach(function (a) {
          console.log(pad(a.agent, 16) + (a.done ? 'done' : 'still working') + ' (' + a.status + ')')
        })
        if (!r.done) process.exitCode = 2
      })
    }
    case 'ask': {
      const agent = pos.shift()
      const sent = await call('net.send', { agent: agent, data: pos.join(' ') }, 90000)
      const w = await waitLoop(agent, idleMs, totalMs, sent.sentAt)
      const r = await call('net.read', { agent: agent, lines: lines })
      r.done = w.done
      return out(r, function (r) {
        console.log('── ' + r.agent + ' [' + r.status + (r.done ? '' : ', timed out') + '] ──')
        console.log(r.text)
        if (!r.done) process.exitCode = 2
      })
    }
    case 'kill':
      return out(await call('net.kill', { agent: pos.shift() }), function (r) {
        console.log('killed ' + r.killed)
      })
    case 'focus':
      return out(await call('net.focus', { agent: pos.shift() }), function (r) {
        console.log('focused ' + r.focused)
      })
    case 'rename': {
      const agent = pos.shift()
      return out(await call('net.rename', { agent: agent, title: pos.join(' ') }), function (r) {
        console.log('renamed → ' + r.renamed)
      })
    }
    case 'topic':
      return out(await call('net.topic', { topic: pos.join(' ') }), function (r) {
        console.log(r.topic ? 'network → ' + r.label : 'topic cleared (' + r.network + ')')
      })
    case 'mcp': {
      const want = (pos.shift() || '').toLowerCase()
      const args = want === 'on' || want === 'off' ? { on: want === 'on' } : {}
      return out(await call('mcp.browser', args, 30000), function (r) {
        if (!r.available) return console.log('browser MCPs are not configured for Devin')
        console.log(
          'browser MCPs ' + (r.enabled ? 'ON' : 'OFF') + ' · ' + r.running + ' server process(es) running' +
            (r.enabled && want === 'on' ? '\nnew or resumed Devin sessions load them' : '')
        )
      })
    }
    default:
      console.error('unknown command: ' + sub + '\n')
      console.log(HELP)
      process.exitCode = 1
  }
}

main().catch(function (e) {
  console.error('tnet: ' + (e && e.message ? e.message : e))
  process.exitCode = 1
})
