# City module — build contract

Street-level miniature city view for Terrarium's Office tab. The default office
camera becomes a view **across a main road** at the company HQ tower; each
tower floor is a department; clicking a floor enters that department's office
interior; a split-screen mode shows 4/6/8/all departments at once.

## Fixed interfaces (DO NOT change)

`lib/departments.ts` (already written — import from `../../lib/departments`):
```ts
export interface Department { id: string; name: string; hue: number; domains?: AgentDomain[]; builtin?: boolean }
export function useDepartments(): Department[]
export function useDeptMap(agents: Agent[]): { depts: Department[]; byDept: Record<string, Agent[]> }
export function createDepartment(name: string, hue?: number, domains?: AgentDomain[]): Department
export function removeDepartment(id: string): void
export function setAgentDepartment(agentId: string, deptId: string | null): void
export function agentsForDept(agents: Agent[], deptId: string, depts: Department[]): Agent[]
export const DEPARTMENT_DOMAINS: AgentDomain[]
```

`office/city/layout.ts` (already written — import from `./layout`):
```ts
export const CITY = { groundW, groundD, roadZ, roadW, roadLen, laneDashLen, laneGapLen,
  walkNearZ, walkFarZ, walkW, hqX, hqZ, hqW, hqD, lobbyH, floorH, slabOverhang,
  crownH, hqFacadeZ, gardenX, gardenZ, gardenW, gardenD,
  neighborA, neighborB, neighborC, frontA, frontB, skylineZ, skylineSpread,
  camPos, camTarget }
export const floorBaseY(i: number): number
export const towerHeight(n: number): number
export const CITY_COLORS = { ... }   // asphalt/sidewalk/grass/hqGlass/... see file
export const CITY_SKY = { top, mid, low, sun, cloud }
```

## Files to build (one owner each)

### `office/city/HQBuilding.tsx`
```tsx
export interface HQBuildingProps {
  departments: Department[]
  counts?: Record<string, number>          // deptId -> member count
  onFloorClick?: (deptId: string) => void
  theme?: 'loft' | 'avengers'              // tower skin — default 'loft'
}
export function HQBuilding(props): JSX.Element
```

**theme='loft'** — modern NYC glass skyscraper: taller/sleeker curtain wall,
floor-to-ceiling glazing, darker reflective glass, metal fins, setback
crown + spire. **theme='avengers'** — the actual Stark/Avengers Tower:
iconic giant "A" lettermark on the upper facade, slanted/cantilevered
crown, glowing arc-reactor ring, quinjet landing pad protruding, cyan
arc-tech accent lighting (dept nameplates/counts still readable).
Detailed company tower at CITY.hqX/hqZ, facing the road (+z facade at
hqFacadeZ): glazed lobby podium w/ entrance doors + canopy + company sign,
N department slabs (floorBaseY/towerHeight from layout). Each floor:
glass curtain wall (frame mullions + spandrel), accent band in dept.hue,
lit-window texture variance, floor label (Html or canvas texture) showing
dept.name (+ member count). Roof crown w/ parapet + subtle sign. Per-floor
invisible click volume → onFloorClick(dept.id); hover → floor brightens +
cursor pointer (use onPointerOver/Out + document.body.style.cursor).
Miniature-diorama detail level — this is the hero object.

### `office/city/CityBlock.tsx`
```tsx
export function CityBlock({ animated = true }: { animated?: boolean }): JSX.Element
```
Everything around the HQ: ground plane (grass), main road w/ lane dashes +
crosswalk + curbs, both sidewalks, streetlamps (emissive heads), neighbor
mid-rises (CITY.neighborA/B/C + frontA/frontB — varied heights/hues, window
grids), distant skyline silhouettes (CITY.skylineZ row, cheap boxes w/ lit
windows, desaturated), garden plot (CITY.garden*): paths, hedges, trees
(trunk + 2-3 canopy blobs), benches, small fountain. Animated cars driving
both directions on the road (instanced, wrap-around at roadLen) when
`animated`. All procedural, instanced where repeated, zero postprocessing.

### `office/city/CitySky.tsx`
```tsx
export function CitySky(): JSX.Element
```
Day sky: large gradient dome (BackSide sphere w/ vertex-color or canvas
gradient CITY_SKY top→mid→low), sun billboard w/ soft halo, 4-6 drifting
cloud sprites (slow useFrame drift, wrap around). No shaders lib needed —
canvas textures + basic materials fine.

### `office/city/CityScene.tsx`
```tsx
export interface CitySceneProps {
  departments: Department[]
  counts?: Record<string, number>
  onEnterDept: (deptId: string) => void
  paused?: boolean
  theme?: 'loft' | 'avengers'              // forwarded to HQBuilding
}
export function CityScene(props): JSX.Element
```
R3F Canvas composing HQBuilding + CityBlock + CitySky. Camera: PerspectiveCamera
at CITY.camPos looking at camTarget; OrbitControls (three-stdlib or
@react-three/drei — check what's already imported in office/ first, reuse
the same import style) with limits: azimuth ±0.45 rad, polar 0.9-1.35,
minDistance 8, maxDistance 30, target locked near camTarget, damping on.
Lights: warm sun directional (w/ shadows OFF or cheap), hemisphere sky/ground,
soft ambient. Light fog for skyline depth. `paused` → frameloop='never'
(same pattern as OfficeScene). Fill parent: style height/width 100%.

### `office/city/StreetLife.tsx`
```tsx
export function StreetLife({ animated = true }: { animated?: boolean }): JSX.Element
```
Sidewalk life: 6-10 tiny minifig pedestrians (capsule body + sphere head +
2 legs, ~0.5 units tall, varied shirt colors — keep cheap, do NOT import
office/Character) strolling both sidewalks (useFrame walk along x, wrap),
a bus-stop shelter + bench on walkFarZ, planters, a mailbox, hydrant on
walkNearZ, 2-3 pigeons hopping (tiny, subtle). Only animate when `animated`.

### `office/DeptInterior.tsx`
```tsx
export interface DeptInteriorProps {
  dept: Department
  agents: Agent[]              // already filtered to this dept
  theme: 'loft' | 'avengers'
  allAgents?: Agent[]          // for the Manage popover (optional)
  departments?: Department[]   // for the Manage popover (optional)
  compact?: boolean            // split-tile mode: slimmer overlay
  paused?: boolean
  standalone?: boolean         // show Back button + fuller header
  onBack?: () => void
  onSelectAgent?: (id: string) => void   // click agent → focus terminal
  onTargetChange?: (agent: Agent | null) => void
}
export function DeptInterior(props): JSX.Element
```
Wrapper: renders OfficeScene (theme 'loft') or AvengersScene ('avengers')
with the dept's agents, passing agents/onInteract→onSelectAgent/
onTargetChange/paused through (match OfficeView's current call signature —
read it). Overlay header (top-left, pointer-events none except controls):
dept hue chip + name + member count; when standalone → Back button +
"Manage" popover listing allAgents with a dept <select> each
(setAgentDepartment). compact → header shrinks to a chip + name only.

## Rules
- React Three Fiber + three only. Check `office/` imports first — reuse
  `../shared` geometries/materials (G.*, M.*, mT/mR/mS) and `./Inst` patterns
  where natural; drei may be used only if already a dependency (check
  package.json / other office files).
- NO postprocessing composer, NO bloom — fake glow via emissive + opacity.
- Performance: instanced meshes for repeated elements; cheap materials
  (MeshStandardMaterial/Lambert); total new draw calls should stay modest.
- `paused`/`animated` props must actually stop useFrame work.
- TypeScript strict: no `any`, imports typed, props interfaces exported.
- Style matches existing office modules: JSDoc header comment, small
  section banners, named exported component, helpers unexported.
