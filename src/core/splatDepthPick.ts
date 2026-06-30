import * as THREE from 'three'
import type { SplatMesh } from '@sparkjsdev/spark'
import type { SplatPinDefinition } from '../config/splatConfig'
import { anglesToDirection } from './splatSphereCoords'

export type SplatWorldPoint = { x: number; y: number; z: number }

/** Modo de pick: fast = 1 raio (mediana); refined = grade 3×3 + média (clique/soltar). */
export type SplatPinPickMode = 'fast' | 'refined'

/** Opacidade mínima no raycast Spark — mais baixo ≈ casca externa do splat. */
export const SPLAT_MIN_RAYCAST_OPACITY = 0.08

/** Máximo de hits por raio usados na mediana de profundidade. */
const MEDIAN_HIT_CAP = 9

/** Espaçamento em px entre amostras da grade 3×3. */
const REFINED_SAMPLE_SPACING_PX = 5

export function hasPinWorldPosition(pin: SplatPinDefinition): boolean {
  return (
    typeof pin.x === 'number' &&
    typeof pin.y === 'number' &&
    typeof pin.z === 'number' &&
    Number.isFinite(pin.x) &&
    Number.isFinite(pin.y) &&
    Number.isFinite(pin.z)
  )
}

/** Posição local do pin no espaço do SplatMesh (x/y/z gravados no JSON). */
export function getPinLocalPosition(
  pin: SplatPinDefinition,
  orbitTarget: THREE.Vector3,
  markerDistance: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  if (hasPinWorldPosition(pin)) {
    return out.set(pin.x!, pin.y!, pin.z!)
  }
  const yaw = pin.yaw ?? 0
  const pitch = pin.pitch ?? 0
  const world = orbitTarget.clone().add(anglesToDirection(yaw, pitch).multiplyScalar(markerDistance))
  return out.copy(world)
}

/** Posição mundial do pin — converte local→mundo quando há SplatMesh. */
export function getPinWorldPosition(
  pin: SplatPinDefinition,
  orbitTarget: THREE.Vector3,
  markerDistance: number,
  out = new THREE.Vector3(),
  splatMesh?: THREE.Object3D | null,
): THREE.Vector3 {
  const local = getPinLocalPosition(pin, orbitTarget, markerDistance, out)
  if (hasPinWorldPosition(pin) && splatMesh) {
    out.copy(local)
    splatMesh.localToWorld(out)
    return out
  }
  return local
}

export function projectWorldToClient(
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
  world: THREE.Vector3,
): { x: number; y: number; visible: boolean } | null {
  const projected = world.clone().project(camera)
  if (projected.z > 1) return null
  const viewPos = world.clone().applyMatrix4(camera.matrixWorldInverse)
  if (viewPos.z >= -0.02) return null
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((-projected.y + 1) / 2) * rect.height,
    visible: true,
  }
}

function ndcFromClient(clientX: number, clientY: number, rect: DOMRect, out = new THREE.Vector2()) {
  return out.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
}

function readDepth01(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): number | null {
  const w = canvas.width
  const h = canvas.height
  if (w < 1 || h < 1) return null

  const px = Math.min(w - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * w)))
  const py = Math.min(h - 1, Math.max(0, Math.floor((1 - (clientY - rect.top) / rect.height) * h)))

  const buf = new Uint32Array(1)
  gl.readPixels(px, py, 1, 1, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, buf)
  const depth = buf[0] / 4294967295
  if (!Number.isFinite(depth) || depth >= 0.99999 || depth <= 0) return null
  return depth
}

function unprojectDepth(
  camera: THREE.PerspectiveCamera,
  ndcX: number,
  ndcY: number,
  depth01: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.set(ndcX, ndcY, depth01 * 2 - 1).unproject(camera)
}

/** Interseção do raio com plano perpendicular à câmera passando pelo alvo da órbita. */
function fallbackPlaneHit(
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  planePoint: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const ndc = ndcFromClient(clientX, clientY, rect)
  const planeRaycaster = new THREE.Raycaster()
  planeRaycaster.setFromCamera(ndc, camera)
  const plane = new THREE.Plane()
  camera.getWorldDirection(plane.normal)
  plane.constant = -plane.normal.dot(planePoint)
  return planeRaycaster.ray.intersectPlane(plane, out)
}

const raycaster = new THREE.Raycaster()
const hitBuffer: THREE.Intersection[] = []
const worldScratch = new THREE.Vector3()
const localScratch = new THREE.Vector3()
const distanceScratch: number[] = []

function medianDistance(distances: number[]): number | null {
  if (!distances.length) return null
  distances.sort((a, b) => a - b)
  const mid = Math.floor(distances.length / 2)
  if (distances.length % 2 === 1) return distances[mid]
  return (distances[mid - 1] + distances[mid]) / 2
}

function worldPointFromMedianRaycast(): THREE.Vector3 | null {
  if (!hitBuffer.length) return null

  distanceScratch.length = 0
  const cap = Math.min(hitBuffer.length, MEDIAN_HIT_CAP)
  for (let i = 0; i < cap; i++) {
    distanceScratch.push(hitBuffer[i].distance)
  }
  const dist = medianDistance(distanceScratch)
  if (dist == null) return null

  return raycaster.ray.at(dist, worldScratch)
}

/**
 * Um raio no SplatMesh → mediana das profundidades dos primeiros hits → ponto local.
 */
function pickSplatLocalPointRaycast(
  splatMesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): SplatWorldPoint | null {
  const ndc = ndcFromClient(clientX, clientY, rect)
  raycaster.setFromCamera(ndc, camera)
  hitBuffer.length = 0
  splatMesh.raycast(raycaster, hitBuffer)
  const world = worldPointFromMedianRaycast()
  if (!world) return null

  localScratch.copy(world)
  splatMesh.worldToLocal(localScratch)
  return {
    x: roundCoord(localScratch.x),
    y: roundCoord(localScratch.y),
    z: roundCoord(localScratch.z),
  }
}

/** Grade 3×3 de raios com mediana em cada célula → média das posições locais. */
function pickSplatLocalPointRefined(
  splatMesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  rect: DOMRect,
): SplatWorldPoint | null {
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let count = 0

  for (let ix = -1; ix <= 1; ix++) {
    for (let iy = -1; iy <= 1; iy++) {
      const sample = pickSplatLocalPointRaycast(
        splatMesh,
        camera,
        clientX + ix * REFINED_SAMPLE_SPACING_PX,
        clientY + iy * REFINED_SAMPLE_SPACING_PX,
        rect,
      )
      if (!sample) continue
      sumX += sample.x
      sumY += sample.y
      sumZ += sample.z
      count++
    }
  }

  if (!count) return null
  return {
    x: roundCoord(sumX / count),
    y: roundCoord(sumY / count),
    z: roundCoord(sumZ / count),
  }
}

/**
 * Interseção com o SplatMesh (Spark raycast) → coordenadas locais do PLY.
 */
export function pickSplatLocalPointFromPointer(
  splatMesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  dom: HTMLElement,
  mode: SplatPinPickMode = 'fast',
): SplatWorldPoint | null {
  const rect = dom.getBoundingClientRect()
  if (mode === 'refined') {
    return pickSplatLocalPointRefined(splatMesh, camera, clientX, clientY, rect)
  }
  return pickSplatLocalPointRaycast(splatMesh, camera, clientX, clientY, rect)
}

/**
 * Fallback: lê profundidade do framebuffer (após render) e devolve ponto local.
 * Requer `preserveDrawingBuffer: true` no WebGLRenderer.
 */
export function pickWorldPointFromPointer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  dom: HTMLElement,
  fallbackPlaneOrigin = new THREE.Vector3(0, 0, 0),
  splatMesh?: SplatMesh | null,
): SplatWorldPoint | null {
  const rect = dom.getBoundingClientRect()
  const gl = renderer.getContext()
  const ndc = ndcFromClient(clientX, clientY, rect)

  let world: THREE.Vector3 | null = null
  const depth = readDepth01(gl, renderer.domElement, clientX, clientY, rect)
  if (depth != null) {
    world = unprojectDepth(camera, ndc.x, ndc.y, depth, worldScratch)
  } else {
    world = fallbackPlaneHit(camera, clientX, clientY, rect, fallbackPlaneOrigin, worldScratch)
  }
  if (!world) return null

  if (splatMesh) {
    localScratch.copy(world)
    splatMesh.worldToLocal(localScratch)
    return {
      x: roundCoord(localScratch.x),
      y: roundCoord(localScratch.y),
      z: roundCoord(localScratch.z),
    }
  }
  return { x: world.x, y: world.y, z: world.z }
}

/** Ponto no splat para gravar no pin — raycast Spark (mediana / 3×3), depois depth/plano. */
export function pickPinPointFromPointer(
  splatMesh: SplatMesh | null | undefined,
  renderer: THREE.WebGLRenderer | null,
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  dom: HTMLElement,
  fallbackPlaneOrigin = new THREE.Vector3(0, 0, 0),
  mode: SplatPinPickMode = 'fast',
): SplatWorldPoint | null {
  if (splatMesh?.isInitialized) {
    splatMesh.updateMatrixWorld(true)
    const local = pickSplatLocalPointFromPointer(splatMesh, camera, clientX, clientY, dom, mode)
    if (local) return local
  }
  if (!renderer) return null
  return pickWorldPointFromPointer(
    renderer,
    camera,
    clientX,
    clientY,
    dom,
    fallbackPlaneOrigin,
    splatMesh ?? undefined,
  )
}

export function worldPointToPinFields(point: SplatWorldPoint): Pick<SplatPinDefinition, 'x' | 'y' | 'z'> {
  return {
    x: roundCoord(point.x),
    y: roundCoord(point.y),
    z: roundCoord(point.z),
  }
}

function roundCoord(n: number) {
  return Math.round(n * 10000) / 10000
}
