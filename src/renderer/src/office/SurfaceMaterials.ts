import * as THREE from 'three'

export const surfaceAssets = {
  environment: new URL('./assets/urban_courtyard_02_1k.hdr', import.meta.url).href,
  wood: {
    color: new URL('./assets/wood_floor_diff_1k.jpg', import.meta.url).href,
    roughness: new URL('./assets/wood_floor_rough_1k.jpg', import.meta.url).href,
    normal: new URL('./assets/wood_floor_nor_gl_1k.jpg', import.meta.url).href
  },
  stone: {
    color: new URL('./assets/concrete_floor_01_diff_1k.jpg', import.meta.url).href,
    roughness: new URL('./assets/concrete_floor_01_rough_1k.jpg', import.meta.url).href,
    normal: new URL('./assets/concrete_floor_01_nor_gl_1k.jpg', import.meta.url).href
  }
}

const textures = new Map<string, THREE.Texture>()

export function surfaceTexture(url: string, kind: 'color' | 'roughness' | 'normal', repeat: readonly [number, number] = [1, 1], fallback?: HTMLCanvasElement): THREE.Texture {
  const key = `${url}:${kind}:${repeat.join(',')}`
  const cached = textures.get(key)
  if (cached) return cached
  const canvas = fallback ?? document.createElement('canvas')
  if (!fallback) {
    canvas.width = canvas.height = 2
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = kind === 'normal' ? '#8080ff' : '#ffffff'
    ctx.fillRect(0, 0, 2, 2)
  }
  const texture = new THREE.Texture(canvas) as THREE.Texture
  texture.needsUpdate = true
  texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  textures.set(key, texture)
  new THREE.ImageLoader().load(url, image => {
    texture.image = image
    texture.needsUpdate = true
  })
  return texture
}

export function surfaceMaps(kind: 'wood' | 'stone', repeat: readonly [number, number] = [1, 1]): THREE.MeshStandardMaterialParameters {
  const asset = surfaceAssets[kind]
  return {
    map: surfaceTexture(asset.color, 'color', repeat),
    roughnessMap: surfaceTexture(asset.roughness, 'roughness', repeat),
    normalMap: surfaceTexture(asset.normal, 'normal', repeat),
    normalScale: new THREE.Vector2(kind === 'wood' ? .36 : .3, kind === 'wood' ? .36 : .3)
  }
}

const micro = new Map<string, THREE.Texture>()

export function microSurface(kind: 'metal' | 'fabric' | 'stone' | 'asphalt' | 'skin'): THREE.MeshStandardMaterialParameters {
  let texture = micro.get(kind)
  if (!texture) {
    const size = 128
    const data = new Uint8Array(size * size * 4)
    let seed = 173
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const noise = (seed / 4294967296 - .5) * 28
      const weave = kind === 'fabric' ? Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2) * 26 : 0
      const brush = kind === 'metal' ? Math.sin(y * 1.1) * 18 : 0
      const value = Math.round(150 + noise + weave + brush)
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = value
      data[i + 3] = 255
    }
    texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(kind === 'metal' ? 2 : 4, kind === 'metal' ? 8 : 4)
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true
    texture.anisotropy = 4
    texture.needsUpdate = true
    micro.set(kind, texture)
  }
  return { bumpMap: texture, bumpScale: kind === 'metal' ? .002 : kind === 'skin' ? .0007 : kind === 'fabric' ? .004 : .009 }
}
