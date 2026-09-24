import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

/* One instanced draw call for a set of identical sub-meshes.
 *
 * The office repeats small static shapes dozens of times — chair legs,
 * shelf spines, plant leaves, wall panels. Every mesh is drawn once for the
 * camera, again into the sun shadow map when it casts, and again into the
 * ContactShadows depth pass, so each instanced set saves ~2–3 draw calls
 * per replaced mesh. Sharing geometry/material via the shared G/M tables
 * already removed buffer/program churn; this removes the calls themselves.
 *
 * `mats` are baked Matrix4s (module constants or useMemo) — the layout is
 * static, so instance transforms are written once on mount and never
 * touched per frame. Deterministic: same inputs → same matrices → same
 * pixels as the individual meshes they replace.
 *
 * Optional `colors` (same length as `mats`) tints each instance through
 * instanceColor — multiplies the material color (use a white material for
 * exact per-instance colors). */
export function Inst({
  geo,
  mat,
  mats,
  colors,
  castShadow,
  receiveShadow
}: {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  mats: THREE.Matrix4[]
  colors?: THREE.Color[]
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    for (let i = 0; i < mats.length; i++) m.setMatrixAt(i, mats[i])
    m.instanceMatrix.needsUpdate = true
    if (colors && colors.length > 0) {
      for (let i = 0; i < mats.length; i++) m.setColorAt(i, colors[i] ?? colors[0])
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    // frustum culling uses the instances' union sphere — recompute lazily
    // whenever the matrices change
    m.boundingSphere = null
    m.boundingBox = null
  }, [mats, colors])
  return (
    <instancedMesh
      ref={ref}
      args={[geo, mat, mats.length]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  )
}
