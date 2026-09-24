// Daytime loft palette — warm light-gray walls, oak floor, sun through the
// windows. Warm practicals stay lit but subtle; hue accents live in layout.ts.
export const P = {
  floor: '#a68e6d', // saturated oak (base tint under the painted plank texture)
  floorLine: '#8a7156',
  wall: '#c8c1b4', // warm mid-gray — not near-white, so ACES keeps depth
  wallTrim: '#aaa190',
  ceiling: '#dcd7cb',
  beam: '#8a6d4b', // warm oak ceiling beams — readable from top-down, not black slabs

  deskTop: '#8a6a4c', // warm walnut
  deskEdge: '#6f5238',
  deskLeg: '#3c3e45',

  chairSeat: '#4b4f58',
  chairAccent: '#5b606b',

  screenOff: '#15171d',
  bezel: '#2a2c32',
  metal: '#41444c',

  rugLounge: '#96a1ad',
  rugBorder: '#f5a524',

  couchBase: '#8496a8',
  couchCushion: '#93a5b6',

  leaf: '#4d8058',
  pot: '#a4715a',

  lampWarm: '#ffd9a0',
  pendant: '#31343c', // dark shades read against the bright ceiling
  podGlow: '#ffe3ba', // warm strip inside the meeting pod
  monitorCyan: '#3bc8db', // matches --color-monitor in styles.css

  bankerGreen: '#2e6b4e', // banker's lamp shade
  brass: '#8a6f3f',
  rackBody: '#262a31',
  paper: '#f1eee6',
  manila: '#d9c49a',
  cork: '#d9cbb0',
  easelWood: '#7a5c3e',
  artFrame: '#3a332c',
  mousePad: '#33363e',
  deskMat: '#2f323a', // felt desk mat under keyboard+mouse
  blind: '#e7e2d6', // venetian slats
  appliance: '#2b2e35', // coffee machine / microwave bodies
  pcBody: '#22242b',
  ledGreen: '#9fe8bd', // power LEDs
  duct: '#83868e', // galvanized HVAC duct
  pillow: '#c7b299', // throw pillow — muted tan
  counterTop: '#d8d2c4', // kitchenette stone counter

  sunPatch: '#ffe6bd', // warm sun pool on the floor under the windows
  fog: '#d6dee8',

  // neon accent — tiny glow details (status LEDs, pinboard pins)
  neonCyan: '#2de2e6'
}

/* ── Loft v2 palette ─────────────────────────────────────────────────────
 * Warm creative-studio loft: honey oak floor, exposed brick + warm plaster,
 * blackened-steel window frames, white-oak desks on black steel, charcoal
 * task chairs, and a restrained terracotta / mustard / sage accent trio in
 * the soft furnishings. `P` above stays as-is for the shared M table. */
export const L = {
  // shell
  slabSide: '#3a3632', // diorama plinth edge
  slabCap: '#2c2926',
  plaster: '#e7ddcd',
  plasterShade: '#d9ccb8',
  baseboard: '#e9e1d3',
  wallCut: '#2f2b28', // cutaway wall section cap
  steel: '#1d1f23', // window frames, desk frames
  steelSoft: '#2b2d32',
  concrete: '#b9b3a9',

  // desks
  laminate: '#f1ede5',
  deskFrame: '#24262b',
  tray: '#303338',
  screenOff: '#0d0f13',
  bezel: '#16181c',
  monitorBack: '#2c2f35',

  // chairs
  chairFabric: '#34373e',
  chairShell: '#1f2126',
  caster: '#141518',

  // soft furnishings — accent trio
  mustard: '#d2a13f',
  sage: '#8ea184',
  cream: '#efe6d6',
  sofa: '#b8674a',
  sofaCushion: '#c4775a',
  leather: '#8a5536',

  // plants
  leafDark: '#3f6b45',
  leaf: '#5a8a52',
  leafLight: '#7aa767',
  potTerracotta: '#b86a4c',
  potCream: '#e6ded1',
  potCharcoal: '#3a3b3e',

  // light
  warmBulb: '#ffd7a1'
}
