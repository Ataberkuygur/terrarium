// ── cli-detect — which agent CLI a command line / process is ─────────
// Shared by main (process-tree probe: "what is running under this pane's
// shell?") and renderer (the command the user typed at a shell prompt,
// echoed on screen). Canonical ids match the resumable-CLI keys in
// ./cli-sessions (claude, codex, devin, cursor-agent, opencode, qoder…)
// so a detected CLI can feed the session store lookup directly.

/** Executable basename → canonical CLI id. */
const EXE: Record<string, string> = {
  claude: 'claude',
  'claude-code': 'claude',
  codex: 'codex',
  devin: 'devin',
  gemini: 'gemini',
  opencode: 'opencode',
  'cursor-agent': 'cursor-agent',
  qoder: 'qoder',
  qodercli: 'qodercli',
  aider: 'aider',
  amp: 'amp',
  copilot: 'copilot',
  cline: 'cline',
  muse: 'muse'
}

/** npm package (or node_modules path segment) → canonical CLI id. */
const PKG: Record<string, string> = {
  '@anthropic-ai/claude-code': 'claude',
  '@openai/codex': 'codex',
  '@google/gemini-cli': 'gemini',
  'opencode-ai': 'opencode',
  '@sourcegraph/amp': 'amp',
  '@github/copilot': 'copilot',
  cline: 'cline',
  'aider-chat': 'aider'
}

/** Launchers that run the *next* non-flag token (interpreters, shims, npx…). */
const WRAPPERS = new Set([
  'node', 'bun', 'deno', 'python', 'python3', 'py', 'pythonw', 'uv', 'uvx', 'pipx',
  'npx', 'pnpx', 'bunx', 'pnpm', 'yarn', 'npm',
  'cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh', 'env', 'call', 'start', '&'
])
/** Sub-verbs of package managers that precede the real program. */
const VERBS = new Set(['dlx', 'exec', 'x', 'run', 'tool'])
/** Launcher flags that consume the following token as their value. */
const VALUED_FLAGS = new Set(['-executionpolicy', '-ep', '-windowstyle', '--package'])

function tokenize(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function baseName(tok: string): string {
  return (tok.split(/[\\/]/).pop() ?? tok)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs|py)$/i, '')
}

function fromPackage(tok: string): string | null {
  // node_modules/@scope/pkg/… or node_modules/pkg/… (script paths)
  const nm = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/i.exec(tok)
  if (nm) {
    const id = PKG[nm[1].replace(/\\/g, '/').toLowerCase()]
    if (id) return id
  }
  // bare package spec: '@anthropic-ai/claude-code@latest'
  const spec = /^(@[^/@\s]+\/[^@\s/]+|[^@\s/\\]+)(?:@\S*)?$/.exec(tok)
  if (spec) return PKG[spec[1].toLowerCase()] ?? null
  return null
}

function fromExe(tok: string): string | null {
  const base = baseName(tok)
  if (EXE[base]) return EXE[base]
  // platform-suffixed native binaries: codex-x86_64-pc-windows-msvc.exe
  const dash = base.indexOf('-')
  if (dash > 0 && EXE[base.slice(0, dash)] && /x86|x64|arm|aarch|win|linux|darwin/.test(base)) {
    return EXE[base.slice(0, dash)]
  }
  return null
}

/**
 * Canonical CLI id for a command line ('claude --resume x',
 * 'node C:\…\@openai\codex\bin\codex.js', 'npx @google/gemini-cli',
 * 'cmd /c claude.cmd -c') — null for anything else (shells, pnpm dev…).
 */
export function cliFromCommandLine(cmdline: string | null | undefined): string | null {
  if (!cmdline) return null
  const toks = tokenize(cmdline.trim())
  let i = 0
  for (let hop = 0; hop < 6 && i < toks.length; hop++) {
    const tok = toks[i]
    const hit = fromExe(tok) ?? fromPackage(tok)
    if (hit) return hit
    const base = baseName(tok)
    // a quoted inline script (pwsh -Command "claude -c") — parse it whole;
    // a quoted path with spaces ('C:/Program Files/nodejs/node.exe') is not one
    if (/\s/.test(base.trim())) return cliFromCommandLine(tok)
    if (!WRAPPERS.has(base) && !(hop > 0 && VERBS.has(base))) return null
    // advance to the next program-ish token: skip flags (and their values)
    i++
    while (i < toks.length) {
      const t = toks[i]
      const low = t.toLowerCase()
      if (VERBS.has(low)) {
        i++
        continue
      }
      if (t.startsWith('-') || /^\/[a-z]$/i.test(t)) {
        i += VALUED_FLAGS.has(low) ? 2 : 1
        continue
      }
      break
    }
  }
  return null
}

/**
 * Screen/title signatures, for when neither the process tree nor an echoed
 * command line is available (custom prompts, alt-screen TUIs). Ordered:
 * devin before gemini — Devin's model picker lists gemini-* models.
 */
export const CLI_SCREEN_SIGNS: [string, RegExp][] = [
  ['claude', /Claude Code|\? for shortcuts|✻ Welcome to Claude|⏵⏵ |claude\.ai\/code/],
  ['codex', /OpenAI Codex|codex-cli|>_ .*Codex/],
  ['devin', /\bDevin\b/],
  ['cursor-agent', /Cursor Agent|cursor-agent/i],
  ['gemini', /Gemini CLI/],
  ['opencode', /\bopencode\b/i],
  ['aider', /^Aider v\d/m],
  ['copilot', /GitHub Copilot CLI|copilot-cli/i],
  ['qoder', /\bQoder\b/],
  ['amp', /ampcode\.com/i]
]

/** First CLI whose signature appears in `text`. */
export function cliFromScreen(text: string): string | null {
  return CLI_SCREEN_SIGNS.find(([, re]) => re.test(text))?.[0] ?? null
}
