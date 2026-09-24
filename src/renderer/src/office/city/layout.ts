// ── city layout ──────────────────────────────────────────────────────
// Shared constants for the street-level city view. Units are meters at
// miniature-diorama scale — a minifig is ~0.5u, a storey ~0.95u, the HQ
// reads ~12-20u tall: a company tower seen from across the avenue, the
// hero of a golden-hour NYC block.
//
// World axes: +x east, +z toward the camera (south). The main road runs
// along X at z≈0. Camera sits south of the road looking north at the HQ.
// Two cross avenues (west + east) cut the block and open depth vistas.
//
// HQ keys (hqX … crownH, hqFacadeZ, floorBaseY, towerHeight) are shared
// with HQBuilding.tsx — keep them stable.

export const CITY = {
  // ground — one big paved slab; fog swallows its edges
  groundW: 320,
  groundD: 320,
  groundY: 0,

  // main road (along X) — parking lane + 2 travel lanes per direction
  roadZ: 0,
  roadW: 7, // asphalt strip depth
  roadLen: 320,
  laneDashLen: 0.9,
  laneGapLen: 1.5,

  // sidewalks
  walkNearZ: 4.6, // camera-side sidewalk center
  walkFarZ: -4.6, // building-side sidewalk center
  walkW: 1.9,

  // HQ tower — faces the road, entrance on +z facade. Slender proportions:
  // narrow footprint + tall slabs + a real spire so it reads skyscraper,
  // not office block.
  hqX: 0,
  hqZ: -10.05, // tower body center (keeps facade at hqFacadeZ)
  hqW: 8.2,
  hqD: 6.6,
  lobbyH: 1.9, // glazed podium/lobby
  floorH: 2.22, // height per department slab
  slabOverhang: 0.12, // each floor plate juts slightly
  crownH: 1.15, // roof parapet / sign band
  hqFacadeZ: -6.75, // front face plane — labels & entrance live here

  // pocket park — west of the HQ, fronting the far sidewalk
  gardenX: -12.6,
  gardenZ: -12.1,
  gardenW: 12.2,
  gardenD: 13,

  // cross avenues (run along Z) — roadway centers + widths
  avenueWX: -22.8,
  avenueEX: 27.4,
  avenueW: 4.6,
  avenueWalk: 1.5,

  // legacy spec masses (kept for contract compatibility; the block now
  // builds from its own building list)
  neighborA: { x: 15.5, z: -11.5, w: 9, d: 8, h: 7.5, hue: 215 },
  neighborB: { x: -25, z: -12.5, w: 7.5, d: 7, h: 5.5, hue: 30 },
  neighborC: { x: 26, z: -13, w: 8, d: 7, h: 9, hue: 200 },
  frontA: { x: -20, z: 12, w: 8, d: 6, h: 6, hue: 40 },
  frontB: { x: 21, z: 13, w: 9, d: 7, h: 8, hue: 220 },

  // distant skyline — silhouettes start here and recede into the haze
  skylineZ: -48,
  skylineSpread: 220,

  // camera — street-level 3/4 view across the road
  camPos: [7.5, 11.5, 22] as [number, number, number],
  camTarget: [0, 5.4, -10] as [number, number, number]
} as const

/** world-space Y of floor i's bottom edge (i = department index, 0-based) */
export const floorBaseY = (i: number) => CITY.lobbyH + i * CITY.floorH

/** total tower height for n departments */
export const towerHeight = (n: number) => CITY.lobbyH + n * CITY.floorH + CITY.crownH

// ── palette ──────────────────────────────────────────────────────────

export const CITY_COLORS = {
  sky: { top: '#7fb2e8', mid: '#a8c8ee', low: '#e8ddc8' },
  sun: '#fff3d6',
  cloud: '#ffffff',

  asphalt: '#3d3f45',
  asphaltOld: '#35373d',
  laneMark: '#ece8dc',
  laneYellow: '#e2b43c',
  crosswalk: '#e4e0d4',
  sidewalk: '#b9b2a6',
  curb: '#c9c4ba',
  paving: '#a8a196',
  plaza: '#cfc6b6',

  grass: '#6b8f4e',
  grassDark: '#587d42',
  hedge: '#3e6b35',
  treeTrunk: '#5a4632',
  treeCanopy: '#4e7d3d',
  treeCanopyLight: '#659353',
  path: '#d6c8a8',

  hqGlass: '#9fc6de',
  hqGlassDark: '#7ea9c4',
  hqFrame: '#c8ccd4',
  hqCore: '#e8eaee',
  lobbyGlass: '#a8d4e8',
  signBg: '#1c2430',

  lamp: '#ffd98a',
  carBody: ['#c94f4f', '#4f7dc9', '#d8d8d8', '#3a3d44', '#c9a44f', '#5d8a4a'],

  windowLit: '#ffe9b0',
  windowDark: '#5f7d94'
} as const
