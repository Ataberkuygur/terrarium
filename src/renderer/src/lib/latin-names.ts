// ── latin-names — every terminal gets a name, not a number ──────────
// Terminal leaves used to be titled 'Terminal 1', 'Terminal 2'… Now each
// one is a named worker: a single evocative Latin word drawn from the
// pool below. Two pick modes:
//   • latinNameForId — deterministic, derived from the leaf id, so a
//     restored layout always lands on the same name (idempotent; the
//     deserializer can call it on every load without flapping).
//   • randomLatinName — for freshly spawned leaves, skips names already
//     on the board.
// Capitalized on the way out — the pool is lowercase Latin.

/** ~160 meaningful Latin words — work, mind, craft, elements, place. */
export const LATIN_NAMES: readonly string[] = [
  // craft & work
  'opus', 'operis', 'labor', 'fabrica', 'machina', 'officina', 'ministerium',
  'negotium', 'munus', 'actio', 'factum', 'gesta', 'praxis', 'ars',
  'artificium', 'studium', 'industria', 'cultura', 'textura', 'structura',
  // mind & knowledge
  'mens', 'animus', 'ingenium', 'genius', 'ratio', 'sapientia', 'prudentia',
  'scientia', 'theoria', 'cognitio', 'memoria', 'consilium', 'cogitatio',
  'sensus', 'intellectus', 'notitia', 'disciplina', 'lumen', 'veritas',
  // language & signal
  'verbum', 'nomen', 'vox', 'lingua', 'sermo', 'oratio', 'signum', 'nota',
  'littera', 'scriptum', 'codicillus', 'tabula', 'charta', 'pagina',
  'historia', 'fabula', 'carmen', 'poema', 'cantus', 'sonus', 'melos',
  'rhythmus', 'imago', 'figura', 'forma', 'pictura', 'exemplar', 'species',
  // order & measure
  'ordo', 'series', 'norma', 'regula', 'lex', 'ius', 'modus', 'numerus',
  'summa', 'pars', 'totum', 'medium', 'centrum', 'punctum', 'terminus',
  'limes', 'initium', 'finis', 'gradus', 'modulus', 'vertex', 'apex',
  'culmen', 'fastigium', 'cardinus', 'axis', 'basis', 'fundamentum',
  // place & structure
  'atrium', 'forum', 'curia', 'aedes', 'domus', 'turris', 'arx', 'castra',
  'portus', 'via', 'iter', 'pons', 'agger', 'murus', 'porta', 'limen',
  'camara', 'cella', 'theatrum', 'arena', 'campus', 'agora', 'statio',
  'habitat', 'sedes', 'locus', 'spatium', 'regio', 'terra', 'mundus',
  // nature & elements
  'ignis', 'aqua', 'aer', 'unda', 'flumen', 'rivus', 'lacus', 'mare',
  'oceanus', 'mons', 'collis', 'vallis', 'silva', 'hortus', 'ager',
  'natura', 'elementum', 'materia', 'corpus', 'anima', 'spiritus',
  // sky & time
  'sol', 'luna', 'stella', 'astra', 'caelum', 'nubes', 'ventus',
  'tempestas', 'aurora', 'nox', 'dies', 'hora', 'tempus', 'momentum',
  'aetas', 'saeculum', 'crepusculum', 'meridies', 'vesper',
  // virtue & outcome
  'virtus', 'fortitudo', 'honor', 'gloria', 'fama', 'meritum', 'praemium',
  'palma', 'corona', 'triumphus', 'victoria', 'pax', 'concordia', 'unio',
  'societas', 'collegium', 'foedus', 'fides', 'spes', 'vigor', 'vis',
  'potentia', 'facultas', 'ardor', 'impetus', 'motus'
]

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** djb2-style hash → stable pool index for a leaf id. */
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0
  return h >>> 0
}

/**
 * Deterministic name for a leaf — same id always yields the same word.
 * `taken` holds names already on the board; on collision the probe walks
 * forward so two leaves never share a tag. Returns capitalized.
 */
export function latinNameForId(id: string, taken: ReadonlySet<string>): string {
  const start = hashId(id) % LATIN_NAMES.length
  for (let k = 0; k < LATIN_NAMES.length; k++) {
    const candidate = capitalize(LATIN_NAMES[(start + k) % LATIN_NAMES.length])
    if (!taken.has(candidate)) return candidate
  }
  // pool exhausted — numbered fallback keeps every tag unique
  return `Nomen ${hashId(id) % 997}`
}

/**
 * Random name for a freshly spawned leaf, skipping `taken`. Falls back
 * to a roman-numeral suffix when the pool runs dry.
 */
export function randomLatinName(taken: ReadonlySet<string>): string {
  const free = LATIN_NAMES.map(capitalize).filter((n) => !taken.has(n))
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)]
  const base = capitalize(LATIN_NAMES[Math.floor(Math.random() * LATIN_NAMES.length)])
  for (const numeral of ROMAN) {
    const candidate = `${base} ${numeral}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base} ${Math.floor(Math.random() * 90) + 10}`
}

/**
 * Titles the system itself generated — 'Terminal', 'Terminal 3', the CLI
 * display names the office launcher used to stamp on leaves. User-typed
 * renames don't match these and are never touched by the migration.
 */
export function isAutoTerminalTitle(title: string | undefined): boolean {
  if (!title) return true
  return /^(Terminal( \d+)?|Terminal Shell|Claude Code|Codex Agent|Clark|Devin|Cursor Agent|Cline|Aider|OpenCode|PowerShell|Bash Shell|Interactive Terminal Session)$/.test(
    title.trim()
  )
}
