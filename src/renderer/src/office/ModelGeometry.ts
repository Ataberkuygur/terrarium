import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export function beveledBox(w: number, h: number, d: number, radius = .025, segments = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) * .24))
}

export function sculptedCanopy(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(.55, 16, 12)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / .55, y = p.getY(i) / .55, z = p.getZ(i) / .55
    const r = 1 + .085 * Math.sin(x * 11 + y * 7) * Math.cos(z * 9 - y * 5) + .035 * Math.sin(z * 19 + x * 13)
    p.setXYZ(i, p.getX(i) * r, p.getY(i) * r, p.getZ(i) * r)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function vehicleCab(): THREE.BufferGeometry {
  const geometry = beveledBox(1, 1, 1, .075, 2)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const taper = THREE.MathUtils.smoothstep(p.getY(i), -.2, .45)
    p.setXYZ(i, p.getX(i) * (1 - taper * .25), p.getY(i), p.getZ(i) * (1 - taper * .16))
  }
  geometry.computeVertexNormals()
  return geometry
}

export type ProfileRing = readonly [y: number, xRadius: number, zRadius: number, zOffset?: number]

export function profileSolid(rings: readonly ProfileRing[], segments = 24): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz, offset = 0] = rings[r]
    for (let s = 0; s <= segments; s++) {
      const a = s / segments * Math.PI * 2
      positions.push(Math.sin(a) * rx, y, Math.cos(a) * rz + offset)
      uvs.push(s / segments, r / (rings.length - 1))
      if (r < rings.length - 1 && s < segments) {
        const i = r * (segments + 1) + s, j = i + segments + 1
        indices.push(i, i + 1, j, i + 1, j + 1, j)
      }
    }
  }
  for (const r of [0, rings.length - 1]) {
    const center = positions.length / 3
    positions.push(0, rings[r][0], rings[r][3] ?? 0)
    uvs.push(.5, r ? 1 : 0)
    for (let s = 0; s < segments; s++) {
      const i = r * (segments + 1) + s
      if (r === 0) indices.push(center, i + 1, i)
      else indices.push(center, i, i + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const nrm = geometry.attributes.normal
  for (let r = 0; r < rings.length; r++) {
    const a = r * (segments + 1), b = a + segments
    const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b)
    const len = Math.hypot(nx, ny, nz) || 1
    nrm.setXYZ(a, nx / len, ny / len, nz / len)
    nrm.setXYZ(b, nx / len, ny / len, nz / len)
  }
  return geometry
}

export function upholsteredBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * .34)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const top = THREE.MathUtils.smoothstep(y, h * .1, h * .46)
    const dent = Math.exp(-Math.pow(x / (w * .36), 2) - Math.pow(z / (d * .36), 2)) * h * .1
    p.setY(i, y - top * dent)
  }
  geometry.computeVertexNormals()
  return geometry
}

export function curvedChairBack(w = .44, h = .52): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(w, h, 16, 20)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    const width = 1 - .12 * Math.pow(y / h * 2, 2)
    p.setXYZ(i, x * width, y, -.045 * Math.exp(-Math.pow((y / h + .12) / .32, 2)) + .04 * Math.pow(x / (w / 2), 2))
  }
  geometry.computeVertexNormals()
  return geometry
}

export function roundedPiping(w: number, d: number, radius = .004): THREE.BufferGeometry {
  const x = w / 2, z = d / 2, c = Math.min(w, d) * .1
  const points = [[-x + c, 0, -z], [x - c, 0, -z], [x, 0, -z + c], [x, 0, z - c], [x - c, 0, z], [-x + c, 0, z], [-x, 0, z - c], [-x, 0, -z + c]].map(p => new THREE.Vector3(...p as [number, number, number]))
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'centripetal'), 48, radius, 5, true)
}

export function foldedLeaf(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(.11, .45, 8, 14)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = (y + .225) / .45
    const x = p.getX(i) * Math.pow(Math.max(.001, Math.sin(t * Math.PI)), .72)
    p.setXYZ(i, x, y, .032 * Math.sin(t * Math.PI) + .075 * t * t + .012 * Math.abs(x / .055))
  }
  geometry.computeVertexNormals()
  return geometry
}
