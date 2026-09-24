import * as THREE from 'three'
import type { AgentDomain } from '@shared/types'
import { P } from './palette'
import { ROOM, ZONES } from './layout'
import { woodTex, plasterTex, plasterDataTex, fabricTex, keyboardTex } from './Textures'
import { microSurface } from './SurfaceMaterials'
import { foldedLeaf, profileSolid } from './ModelGeometry'

/**
 * Shared geometries & materials.
 *
 * The office repeats a handful of small shapes hundreds of times (chair legs,
 * plant cones, shelf boards, monitor arms, character capsules…). Previously
 * every `<boxGeometry>`/`<meshStandardMaterial>` JSX element allocated its own
 * BufferGeometry + Material — one GPU buffer / program-variant entry per mesh.
 * Module-level instances let three reuse buffers and programs across meshes.
 *
 * Safe to share: these are never mutated at runtime, and three re-uploads
 * automatically after a dispose/context loss (e.g. view switch remount).
 * Rule: if a mesh needs per-instance params (per-agent color, dynamic
 * emissive — e.g. the server-rack LEDs), keep an inline material — never
 * mutate a shared one.
 */

/* instance-matrix bakers for <Inst> — explicit T·R·S products in the same
 * order JSX nesting produces (parent transform · … · mesh transform), so a
 * baked Matrix4 is a drop-in for the mesh it replaces. Module-load allocs
 * only; nothing here runs per frame. */
export const mT = (x: number, y: number, z: number) =>
  new THREE.Matrix4().makeTranslation(x, y, z)
export const mR = (x = 0, y = 0, z = 0) =>
  new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z))
export const mS = (x: number, y: number, z: number) =>
  new THREE.Matrix4().makeScale(x, y, z)

export const G = {
  // room
  unitPlane: new THREE.PlaneGeometry(1, 1), // scaled rugs / sun patch / pads
  unitBox: new THREE.BoxGeometry(1, 1, 1), // scaled per instance — walls, frames, trims
  floorLine: new THREE.PlaneGeometry(ROOM.w, 0.02),
  beam: new THREE.BoxGeometry(ROOM.w, 0.2, 0.17),

  // entrance & architectural details
  doorJamb: new THREE.BoxGeometry(0.06, 2.45, 0.12),
  doorLintel: new THREE.BoxGeometry(2.4, 0.06, 0.12),
  doorLeaf: new THREE.BoxGeometry(1.15, 2.38, 0.035),
  doorHandle: new THREE.CylinderGeometry(0.016, 0.016, 0.7, 10),
  woodSlat: new THREE.BoxGeometry(0.045, 3.2, 0.04),
  signPlaque: new THREE.BoxGeometry(1.8, 0.4, 0.02),


  // desk set
  deskLeg: new THREE.BoxGeometry(0.07, 0.74, 0.72),
  deskLegTall: new THREE.BoxGeometry(0.07, 0.98, 0.72),
  monitorArmBase: new THREE.CylinderGeometry(0.05, 0.07, 0.03, 12),
  monitorArmPole: new THREE.BoxGeometry(0.04, 0.38, 0.04),
  monitorArmPoleTall: new THREE.BoxGeometry(0.045, 0.46, 0.045),
  monitorArmSegment: new THREE.BoxGeometry(0.024, 0.032, 0.2),
  monitorVesaPlate: new THREE.BoxGeometry(0.12, 0.12, 0.015),
  monitorHinge: new THREE.CylinderGeometry(0.018, 0.018, 0.045, 10),
  doorStandoff: new THREE.CylinderGeometry(0.01, 0.01, 0.04, 8),
  meetingMicPuck: new THREE.CylinderGeometry(0.08, 0.09, 0.022, 16),
  meetingMicRing: new THREE.TorusGeometry(0.065, 0.005, 8, 16),
  couchLeg: new THREE.CylinderGeometry(0.025, 0.018, 0.08, 10),
  serverBlade: new THREE.BoxGeometry(0.48, 0.085, 0.38),
  switchUnit: new THREE.BoxGeometry(0.48, 0.042, 0.28),
  screen: new THREE.PlaneGeometry(0.62, 0.4),
  mugCup: new THREE.CylinderGeometry(0.045, 0.04, 0.11, 14),
  mugHandle: new THREE.TorusGeometry(0.03, 0.008, 8, 12, Math.PI),
  lampBase: new THREE.CylinderGeometry(0.07, 0.09, 0.02, 12),
  lampArm: new THREE.CylinderGeometry(0.015, 0.015, 0.28, 8),
  lampShade: new THREE.ConeGeometry(0.07, 0.09, 12, 1, true),
  cableDrop: new THREE.BoxGeometry(0.018, 1, 0.018), // scaled per desk height

  // desk clutter (domain props ride on the desktop)
  mouse: new THREE.CapsuleGeometry(0.028, 0.045, 4, 10),
  thermos: new THREE.CylinderGeometry(0.036, 0.042, 0.17, 10),
  thermosLid: new THREE.CylinderGeometry(0.03, 0.03, 0.045, 10),
  paperSheet: new THREE.BoxGeometry(0.24, 0.014, 0.32),
  folder: new THREE.BoxGeometry(0.27, 0.009, 0.35),
  tabletProp: new THREE.BoxGeometry(0.32, 0.018, 0.22),
  tabletPen: new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6),
  stickyNote: new THREE.PlaneGeometry(0.055, 0.055),

  // banker's lamp (legal desk)
  bankerBase: new THREE.CylinderGeometry(0.075, 0.095, 0.025, 14),
  bankerStem: new THREE.CylinderGeometry(0.014, 0.014, 0.2, 8),
  bankerShade: new THREE.CapsuleGeometry(0.055, 0.1, 4, 12),

  // standing-desk stool
  stoolSeat: new THREE.CylinderGeometry(0.17, 0.17, 0.045, 14),
  stoolPole: new THREE.CylinderGeometry(0.024, 0.024, 0.55, 8),
  stoolBase: new THREE.CylinderGeometry(0.2, 0.22, 0.028, 14),

  // chair
  chairStem: new THREE.CylinderGeometry(0.028, 0.028, 0.38, 10),
  chairLeg: new THREE.BoxGeometry(0.24, 0.025, 0.045),
  chairSpine: new THREE.BoxGeometry(0.045, 0.38, 0.04),
  chairArmStalk: new THREE.BoxGeometry(0.022, 0.18, 0.035),
  chairArmPad: new THREE.BoxGeometry(0.075, 0.025, 0.22),
  chairCaster: new THREE.CylinderGeometry(0.022, 0.022, 0.025, 10),
  chairMechanism: new THREE.BoxGeometry(0.16, 0.08, 0.18),

  // tables / shelf / plant / pendant / pod
  tableLeg: new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8),
  shelfBoard: new THREE.BoxGeometry(1.78, 0.04, 0.32),
  shelfGroove: new THREE.BoxGeometry(1.78, 0.035, 0.02), // shadow line under a shelf edge
  bookSpine: new THREE.BoxGeometry(0.1, 1, 0.22), // scaled per book: [width, height, 1]
  plantPot: profileSolid([[0, .09, .09], [.02, .095, .095], [.24, .123, .123], [.28, .125, .125]]).translate(0, -0.14, 0),
  plantLeaf: foldedLeaf(),
  pendantCord: new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6),
  pendantShade: new THREE.ConeGeometry(0.22, 0.18, 16, 1, true),
  pendantBulb: new THREE.SphereGeometry(0.05, 12, 12),
  pendantHalo: new THREE.SphereGeometry(0.085, 12, 12),
  podLeg: new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8),
  podPost: new THREE.BoxGeometry(0.07, 2.2, 0.07),
  podBeam: new THREE.BoxGeometry(2.28, 0.07, 0.07),
  podBeamSide: new THREE.BoxGeometry(0.07, 0.07, 1.88),
  boardMark: new THREE.BoxGeometry(0.3, 0.04, 0.005),

  // floor lamp / credenza
  floorLampBase: new THREE.CylinderGeometry(0.16, 0.2, 0.03, 16),
  floorLampPole: new THREE.CylinderGeometry(0.02, 0.02, 1.45, 8),
  floorLampShade: new THREE.CylinderGeometry(0.15, 0.19, 0.28, 16, 1, true),
  credenzaLeg: new THREE.BoxGeometry(0.05, 0.12, 0.05),

  // server rack (backend zone)
  rackBody: new THREE.BoxGeometry(0.58, 1.4, 0.44),
  rackSlot: new THREE.BoxGeometry(0.5, 0.055, 0.02),
  rackLed: new THREE.SphereGeometry(0.014, 8, 8),
  rackFoot: new THREE.BoxGeometry(0.07, 0.09, 0.07),

  // pin/mood boards, easel, rolling whiteboard, art frames
  pinBoard: new THREE.BoxGeometry(0.85, 0.6, 0.035),
  pinNote: new THREE.PlaneGeometry(0.095, 0.095),
  boardLeg: new THREE.BoxGeometry(0.05, 1.2, 0.05),
  easelLeg: new THREE.CylinderGeometry(0.016, 0.021, 1.3, 7),
  easelBar: new THREE.BoxGeometry(0.46, 0.045, 0.05),
  easelCanvas: new THREE.BoxGeometry(0.4, 0.5, 0.025),
  artFrame: new THREE.BoxGeometry(0.95, 0.72, 0.045),
  artInner: new THREE.PlaneGeometry(0.85, 0.62),
  wbPanel: new THREE.BoxGeometry(1.25, 0.85, 0.05),
  wbLeg: new THREE.BoxGeometry(0.05, 1.5, 0.05),
  wbFoot: new THREE.BoxGeometry(0.07, 0.045, 0.55),

  // fake light pool on the desk under a lit monitor
  screenSpill: new THREE.PlaneGeometry(0.85, 0.6),

  // ── realism pass: repeated detail props ──
  kbBase: new THREE.BoxGeometry(0.5, 0.028, 0.18), // textured keyboard slab
  powerLed: new THREE.BoxGeometry(0.02, 0.009, 0.005), // monitor power dot
  pcTower: new THREE.BoxGeometry(0.19, 0.42, 0.42),
  pcLed: new THREE.BoxGeometry(0.015, 0.1, 0.008),
  trashBin: new THREE.CylinderGeometry(0.13, 0.11, 0.27, 12, 1, true),
  penCup: new THREE.CylinderGeometry(0.035, 0.03, 0.09, 10),
  penStick: new THREE.CylinderGeometry(0.005, 0.005, 0.13, 6),
  blindSlat: new THREE.BoxGeometry(1, 0.018, 0.09), // scaled x per window
  blindCord: new THREE.BoxGeometry(0.014, 0.7, 0.014),
  ledHousing: new THREE.BoxGeometry(1.34, 0.05, 0.09), // linear fixture under beams
  ledDiffuser: new THREE.BoxGeometry(1.28, 0.02, 0.06),
  duct: new THREE.CylinderGeometry(0.15, 0.15, 8.6, 14), // HVAC along left wall
  ductStrap: new THREE.BoxGeometry(0.36, 0.035, 0.06),
  clockRim: new THREE.TorusGeometry(0.15, 0.016, 8, 28),
  clockFace: new THREE.CylinderGeometry(0.145, 0.145, 0.02, 28),
  clockHandM: new THREE.BoxGeometry(0.014, 0.115, 0.006),
  clockHandH: new THREE.BoxGeometry(0.018, 0.075, 0.006),
  clockPin: new THREE.SphereGeometry(0.012, 8, 8),

  // kitchenette
  counterKick: new THREE.BoxGeometry(1.3, 0.08, 0.5),
  counterHandle: new THREE.BoxGeometry(0.13, 0.018, 0.02),
  coffeeBase: new THREE.BoxGeometry(0.24, 0.3, 0.28),
  coffeeHead: new THREE.BoxGeometry(0.22, 0.07, 0.2),
  coffeeTray: new THREE.BoxGeometry(0.2, 0.02, 0.16),
  coffeeSpout: new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8),
  mwBody: new THREE.BoxGeometry(0.32, 0.19, 0.26),
  mwDoor: new THREE.BoxGeometry(0.26, 0.15, 0.012),
  mwHandle: new THREE.BoxGeometry(0.02, 0.13, 0.018),
  shelfMini: new THREE.BoxGeometry(0.9, 0.03, 0.24),
  shelfBracket: new THREE.BoxGeometry(0.03, 0.12, 0.2),
  jar: new THREE.CylinderGeometry(0.045, 0.045, 0.11, 10),
  towelRoll: new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12),

  // shelf top / couch / pod extras
  storageBox: new THREE.BoxGeometry(0.4, 0.26, 0.3),
  storageLid: new THREE.BoxGeometry(0.42, 0.03, 0.32),
  laptopBase: new THREE.BoxGeometry(0.3, 0.015, 0.2),
  laptopLid: new THREE.BoxGeometry(0.3, 0.19, 0.012),
  laptopScreen: new THREE.PlaneGeometry(0.27, 0.16),

  // character accessories
  headBand: new THREE.TorusGeometry(0.135, 0.013, 6, 16, Math.PI),
  headCup: new THREE.CylinderGeometry(0.032, 0.032, 0.026, 10),
  hairBun: new THREE.SphereGeometry(0.048, 10, 8),

  // character
  head: new THREE.SphereGeometry(0.115, 20, 16),
  hair: new THREE.SphereGeometry(0.115, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
  eye: new THREE.SphereGeometry(0.012, 8, 8),
  legStand: new THREE.CapsuleGeometry(0.048, 0.52, 6, 12),
  legLounge: new THREE.CapsuleGeometry(0.048, 0.4, 6, 12),
  thighSit: new THREE.CapsuleGeometry(0.048, 0.24, 6, 12),
  calfSit: new THREE.CapsuleGeometry(0.044, 0.26, 6, 12),
  armStand: new THREE.CapsuleGeometry(0.04, 0.3, 6, 10),
  armSit: new THREE.CapsuleGeometry(0.04, 0.26, 6, 10),
  armLounge: new THREE.CapsuleGeometry(0.04, 0.22, 6, 10),
  shoulderCap: new THREE.SphereGeometry(0.055, 12, 10),
  // body detail — hands ride inside the arm meshes, shoes instance per pose
  hand: new THREE.SphereGeometry(0.038, 10, 8),
  shoe: new THREE.BoxGeometry(0.085, 0.055, 0.18),
  ear: new THREE.SphereGeometry(0.02, 8, 8),
  nose: new THREE.BoxGeometry(0.024, 0.03, 0.028),
  neck: new THREE.CylinderGeometry(0.04, 0.048, 0.08, 10),

  // Stylized Anime Creator Character Geometries
  animeSpike: new THREE.ConeGeometry(0.036, 0.13, 5),
  animeStrand: new THREE.ConeGeometry(0.025, 0.1, 4),
  hairFadeCut: new THREE.SphereGeometry(0.116, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
  sunglassLens: new THREE.BoxGeometry(0.072, 0.036, 0.01),
  sunglassBridge: new THREE.BoxGeometry(0.028, 0.006, 0.01),
  sneakerSole: new THREE.BoxGeometry(0.09, 0.034, 0.22),
  hoodiePocket: new THREE.BoxGeometry(0.24, 0.12, 0.035),

  // fidelity pass — small parts reused across props
  grommet: new THREE.CylinderGeometry(0.032, 0.032, 0.012, 12), // desk cable port
  potRim: new THREE.CylinderGeometry(0.128, 0.122, 0.035, 12), // planter lip
  soil: new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12), // visible potting soil
  kettle: new THREE.CylinderGeometry(0.062, 0.08, 0.18, 12),
  kettleLid: new THREE.CylinderGeometry(0.045, 0.048, 0.018, 12)
}

/* zone rug + edge materials — one per domain, built from ZONES so the rug
 * tint in layout.ts is the single source of truth */
const zoneRug = {} as Record<AgentDomain, THREE.MeshStandardMaterial>
const zoneEdge = {} as Record<AgentDomain, THREE.MeshStandardMaterial>
for (const [domain, spec] of Object.entries(ZONES) as [AgentDomain, (typeof ZONES)[AgentDomain]][]) {
  zoneRug[domain] = new THREE.MeshStandardMaterial({
    color: spec.rugTint,
    roughness: 1,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  })
  zoneEdge[domain] = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 1 })
}
for (const material of Object.values(zoneRug)) {
  material.color.lerp(new THREE.Color('#7d776c'), 0.72)
  material.roughness = 1
  Object.assign(material, microSurface('fabric'))
}

export const M = {
  // plaster speckle rides as map+bump+roughness — matte walls with subtle
  // grain instead of a flat fill (map is sRGB; bump/rough use the linear copy)
  wall: new THREE.MeshStandardMaterial({
    color: P.wall,
    roughness: 1,
    map: plasterTex(),
    bumpMap: plasterDataTex(),
    bumpScale: 0.015,
    roughnessMap: plasterDataTex()
  }),
  wallTrim: new THREE.MeshStandardMaterial({ color: P.wallTrim }),
  ceiling: new THREE.MeshStandardMaterial({ color: P.ceiling, ...microSurface('stone') }),
  beam: new THREE.MeshStandardMaterial({ color: P.beam, roughness: 0.8 }),
  floorLine: new THREE.MeshStandardMaterial({ color: P.floorLine, roughness: 1 }),
  rugBorder: new THREE.MeshStandardMaterial({
    color: P.rugBorder,
    roughness: 1,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  rugLounge: new THREE.MeshStandardMaterial({
    color: P.rugLounge,
    roughness: 1,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  zoneRug,
  zoneEdge,
  windowFrame: new THREE.MeshStandardMaterial({
    color: '#4a4d55',
    roughness: 0.55,
    metalness: 0.3,
    ...microSurface('metal')
  }),

  // walnut grain painted in the final hue — white tint so the map IS the color
  deskTop: new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.45 }),
  deskLeg: new THREE.MeshStandardMaterial({
    color: P.deskLeg,
    roughness: 0.6,
    metalness: 0.3
  }),
  bezel: new THREE.MeshStandardMaterial({ color: P.bezel, roughness: 0.4, metalness: 0.2 }),
  screenOff: new THREE.MeshStandardMaterial({
    color: '#15171d',
    roughness: 0.4,
    metalness: 0.1
  }),

  // three metal flavors used across props (defaults: roughness 1, metalness 0)
  metal: new THREE.MeshStandardMaterial({
    color: P.metal,
    roughness: 0.55,
    metalness: 0.3,
    ...microSurface('metal')
  }),
  metalMid: new THREE.MeshStandardMaterial({
    color: P.metal,
    metalness: 0.5,
    roughness: 0.4,
    ...microSurface('metal')
  }),
  metalHi: new THREE.MeshStandardMaterial({
    color: P.metal,
    metalness: 0.6,
    roughness: 0.35,
    ...microSurface('metal')
  }),
  brass: new THREE.MeshStandardMaterial({
    color: P.brass,
    metalness: 0.55,
    roughness: 0.45,
    ...microSurface('metal')
  }),
  cable: new THREE.MeshStandardMaterial({ color: '#23252c', roughness: 0.8 }),

  pot: new THREE.MeshStandardMaterial({ color: P.pot, roughness: 0.5 }),
  plantPot: new THREE.MeshStandardMaterial({ color: P.pot, roughness: 0.6 }),
  leaf: new THREE.MeshStandardMaterial({ color: P.leaf, roughness: 0.86, side: THREE.DoubleSide }),

  pendant: new THREE.MeshStandardMaterial({ color: P.pendant }),
  pendantShade: new THREE.MeshStandardMaterial({
    color: P.pendant,
    side: THREE.DoubleSide,
    roughness: 0.5
  }),
  bulb: new THREE.MeshBasicMaterial({ color: P.lampWarm, toneMapped: false }),
  // additive halo shells — depthWrite off so they never occlude the bulb
  bulbHalo: new THREE.MeshBasicMaterial({
    color: P.lampWarm,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),
  floorShade: new THREE.MeshStandardMaterial({
    color: P.metal,
    emissive: P.lampWarm,
    emissiveIntensity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.6
  }),
  // warm glow strip inside the meeting pod
  podStrip: new THREE.MeshBasicMaterial({ color: P.podGlow, toneMapped: false }),
  // cyan monitor spill on the desktop — additive fake, no light needed
  screenSpill: new THREE.MeshBasicMaterial({
    color: P.monitorCyan,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),
  // warm pool of sunlight on the floor in front of the windows
  sunPatch: new THREE.MeshBasicMaterial({
    color: P.sunPatch,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }),

  chairSeat: new THREE.MeshStandardMaterial({
    color: P.chairSeat,
    roughness: 0.9,
    ...microSurface('fabric')
  }),
  chairAccent: new THREE.MeshStandardMaterial({
    color: P.chairAccent,
    roughness: 0.9,
    side: THREE.DoubleSide,
    ...microSurface('fabric')
  }),
  chairMesh: new THREE.MeshStandardMaterial({ color: '#22262f', roughness: 0.8, metalness: 0.1 }),
  micRing: new THREE.MeshBasicMaterial({ color: '#4ade80', toneMapped: false }),
  serverBlade: new THREE.MeshStandardMaterial({ color: '#1a1f29', roughness: 0.5, metalness: 0.4 }),
  serverGrill: new THREE.MeshStandardMaterial({ color: '#0d1117', roughness: 0.9 }),

  couchBase: new THREE.MeshStandardMaterial({
    color: P.couchBase,
    roughness: 0.85,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  couchBaseSoft: new THREE.MeshStandardMaterial({
    color: P.couchBase,
    roughness: 0.9,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  couchCushion: new THREE.MeshStandardMaterial({
    color: P.couchCushion,
    roughness: 0.85,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  book: new THREE.MeshStandardMaterial({ color: '#7a4a3a', roughness: 0.7 }),

  shelfBody: new THREE.MeshStandardMaterial({ color: P.deskEdge, roughness: 0.7 }),
  shelfBoard: new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.55 }),
  shelfGroove: new THREE.MeshStandardMaterial({ color: '#33261a', roughness: 1 }),
  // muted book-spine palette — index by BOOK_ROWS in Props.tsx
  spines: ['#7d4a3c', '#46607a', '#576b4a', '#8a7444', '#5d4a6e', '#3f6b66', '#8a5a44'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
  ),

  glass: new THREE.MeshPhysicalMaterial({
    color: '#bcd2e8',
    transparent: true,
    opacity: 0.15,
    roughness: 0.05,
    metalness: 0
  }),
  podTable: new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.45 }),
  whiteboard: new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.3 }),

  // zone props
  rackBody: new THREE.MeshStandardMaterial({
    color: P.rackBody,
    metalness: 0.35,
    roughness: 0.55
  }),
  rackFace: new THREE.MeshStandardMaterial({ color: '#171a1f', metalness: 0.3, roughness: 0.5 }),
  paper: new THREE.MeshStandardMaterial({ color: P.paper, roughness: 0.95 }),
  manila: new THREE.MeshStandardMaterial({ color: P.manila, roughness: 0.9 }),
  thermos: new THREE.MeshStandardMaterial({ color: '#33373f', metalness: 0.5, roughness: 0.35 }),
  thermosBand: new THREE.MeshStandardMaterial({ color: '#b8bdc6', metalness: 0.6, roughness: 0.3 }),
  cork: new THREE.MeshStandardMaterial({ color: P.cork, roughness: 0.95 }),
  easelWood: new THREE.MeshStandardMaterial({ color: P.easelWood, roughness: 0.7 }),
  canvas: new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.9 }),
  artFrame: new THREE.MeshStandardMaterial({ color: P.artFrame, roughness: 0.5 }),
  mousePad: new THREE.MeshStandardMaterial({ color: P.mousePad, roughness: 0.9 }),
  mouse: new THREE.MeshStandardMaterial({ color: '#26282e', roughness: 0.5 }),
  stoolSeat: new THREE.MeshStandardMaterial({
    color: P.chairSeat,
    roughness: 0.9,
    ...microSurface('fabric')
  }),

  // sticky-note colors (mood board + desk notes)
  noteY: new THREE.MeshStandardMaterial({ color: '#ffd166', roughness: 0.9 }),
  noteP: new THREE.MeshStandardMaterial({ color: '#ef8fa3', roughness: 0.9 }),
  noteG: new THREE.MeshStandardMaterial({ color: '#7dd181', roughness: 0.9 }),
  noteB: new THREE.MeshStandardMaterial({ color: '#7fb2e5', roughness: 0.9 }),

  // ── realism pass: detail materials ──
  // textured keyboard — the busy tint just lifts the baked key color a touch
  keyOff: new THREE.MeshStandardMaterial({ map: keyboardTex(), color: '#b6bbc6', roughness: 0.55 }),
  keyOn: new THREE.MeshStandardMaterial({ map: keyboardTex(), roughness: 0.5 }),
  deskMat: new THREE.MeshStandardMaterial({
    color: P.deskMat,
    roughness: 0.95,
    bumpMap: fabricTex(),
    bumpScale: 0.005
  }),
  ledOn: new THREE.MeshBasicMaterial({ color: P.ledGreen, toneMapped: false }),
  pcTower: new THREE.MeshStandardMaterial({ color: P.pcBody, roughness: 0.55, metalness: 0.3 }),
  pcLed: new THREE.MeshBasicMaterial({ color: P.monitorCyan, toneMapped: false }),
  bin: new THREE.MeshStandardMaterial({
    color: '#4a4d55',
    roughness: 0.6,
    metalness: 0.4,
    side: THREE.DoubleSide
  }),
  blind: new THREE.MeshStandardMaterial({ color: P.blind, roughness: 0.75 }),
  ledStrip: new THREE.MeshBasicMaterial({ color: '#fff3da', toneMapped: false }),
  duct: new THREE.MeshStandardMaterial({
    color: P.duct,
    roughness: 0.45,
    metalness: 0.55,
    ...microSurface('metal')
  }),
  clockFace: new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.85 }),
  clockHand: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.5 }),

  // kitchenette
  counterTop: new THREE.MeshStandardMaterial({ color: P.counterTop, roughness: 0.35 }),
  appliance: new THREE.MeshStandardMaterial({ color: P.appliance, roughness: 0.45, metalness: 0.3 }),
  mwDoor: new THREE.MeshStandardMaterial({ color: '#14161b', roughness: 0.25, metalness: 0.4 }),
  jar: new THREE.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.6 }),

  storageBox: new THREE.MeshStandardMaterial({ color: '#a89a7e', roughness: 0.9 }),
  laptopScreen: new THREE.MeshBasicMaterial({ color: '#7fb8d8', toneMapped: false }),
  pillow: new THREE.MeshStandardMaterial({
    color: P.pillow,
    roughness: 0.95,
    bumpMap: fabricTex(),
    bumpScale: 0.008
  }),
  // character
  pants: new THREE.MeshStandardMaterial({ color: '#33363f', roughness: 0.8 }),
  shoe: new THREE.MeshStandardMaterial({ color: '#26211d', roughness: 0.65 }),
  eye: new THREE.MeshStandardMaterial({ color: '#14151a', roughness: 0.3 }),
  tablet: new THREE.MeshStandardMaterial({ color: '#1a1c22', roughness: 0.4 }),

  // architectural entrance & ceiling
  woodSlat: new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.45 }),
  signMetal: new THREE.MeshStandardMaterial({ color: '#1a1c22', roughness: 0.35, metalness: 0.7 }),
  signEmissive: new THREE.MeshBasicMaterial({ color: '#fff5de', toneMapped: false }),
  doorFrame: new THREE.MeshStandardMaterial({ color: '#252830', roughness: 0.4, metalness: 0.6 }),
  doorHandle: new THREE.MeshStandardMaterial({ color: '#e5e9f0', roughness: 0.25, metalness: 0.85 }),


  // character accents — shared by props that need a small bright part
  softboxFrontMat: new THREE.MeshBasicMaterial({ color: '#fff6e5', toneMapped: false }),
  tallyRed: new THREE.MeshBasicMaterial({ color: '#ff2222', toneMapped: false }),
  neonCyanMat: new THREE.MeshBasicMaterial({ color: P.neonCyan, toneMapped: false }),
  sneakerWhite: new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.4 }),
  sunglassGlass: new THREE.MeshStandardMaterial({ color: '#0e1116', roughness: 0.1, metalness: 0.8 }),

  // fidelity pass — desk edges, monitor backs, kitchen finishes
  edgeBand: new THREE.MeshStandardMaterial({ color: '#26282e', roughness: 0.55 }),
  grommetMat: new THREE.MeshStandardMaterial({ color: '#14161a', roughness: 0.7 }),
  trayMat: new THREE.MeshStandardMaterial({ color: '#1e2126', roughness: 0.75 }),
  monBackMat: new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.45, metalness: 0.3 }),
  tileMat: new THREE.MeshStandardMaterial({ color: '#eae7df', roughness: 0.3 }),
  soilMat: new THREE.MeshStandardMaterial({ color: '#2b2018', roughness: 1 }),
  outletMat: new THREE.MeshStandardMaterial({ color: '#dedbd2', roughness: 0.6 })
}
