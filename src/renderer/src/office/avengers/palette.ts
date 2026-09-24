/* ── Avengers Compound palette ────────────────────────────────────────
 * Three families, nothing else:
 *   architecture — white/grey composite panels, graphite polished floor
 *   tech         — arc-reactor cyan (holograms, light lines) on near-black
 *   iconic       — iron red / gold, shield blue, bar walnut + brass
 * Every prop pulls from this table so the compound reads as one designed
 * space. (Keys used by city/HQBuilding: holoCyan — keep them stable.) */
export const P = {
  // architecture
  floor: '#1b1f26', // graphite polished resin
  floorTile: '#1b1f26',
  floorLine: '#46c8f0', // cyan light lines inlaid in the floor
  wall: '#e6e9ee', // white composite panels
  wallShade: '#cfd5de', // recessed panel faces
  wallTrim: '#9aa4b3', // brushed aluminium reveals
  wallDark: '#2a2f38', // graphite feature panels
  glassBlue: '#a6d9f0', // glazing tint
  column: '#c3cad5',
  soffit: '#f3f5f8',

  // furniture
  benchTop: '#191c23', // console glass-black
  benchEdge: '#3d4350',
  benchInlay: '#4c5670',
  stool: '#1d2129',
  chairShell: '#eef1f5', // white shell chairs
  chairPad: '#2c313b',
  sofaBase: '#2a2e36',
  sofaCushion: '#3b4150',
  tableDark: '#14171d',
  walnut: '#5b3a26',
  walnutDark: '#3a2518',
  brass: '#c9a45c',
  rug: '#30353f',

  // tech
  holoCyan: '#6fd4ff', // hologram / UI emissive
  holoDeep: '#1f7fb8',
  holoWhite: '#d9f5ff',
  screenDark: '#0b121c',
  rackBody: '#1a1e27',
  rackLed: '#5be07a',
  ledWarn: '#ffb04a',
  alert: '#ff5a4f',
  ok: '#4fe08a',

  // arc reactor + iron
  arcCore: '#e2f9ff',
  arcRing: '#7fd6ff',
  ironRed: '#9e1f1a',
  ironGold: '#d8a83e',
  warMachine: '#4a4f57',
  shieldRed: '#b3261e',
  shieldWhite: '#eceef0',
  shieldBlue: '#1f3f8a',

  // exterior — upstate compound lawn at golden afternoon
  lawn: '#5b7045',
  lawnDark: '#4a5e38',
  tree: '#3e6537',
  treeDark: '#2c4a2a',
  trunk: '#4a3a2c',
  tarmac: '#3c4148',
  concrete: '#b9bdc2',
  skyTop: '#7fa9d6',
  skyHorizon: '#d9e6ef',
  haze: '#c9d8e4',

  // misc
  logo: '#e8ecf2',
  plant: '#3f6b4a'
} as const
