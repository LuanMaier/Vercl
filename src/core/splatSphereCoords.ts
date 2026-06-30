import * as THREE from 'three'

export type SplatAngles = { yaw: number; pitch: number }

/** Direção unitária a partir de yaw/pitch (graus), mesmo sistema da panorâmica. */
export function anglesToDirection(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - pitch)
  const theta = THREE.MathUtils.degToRad(yaw)
  out.set(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  )
  return out
}

export function directionToAngles(dir: THREE.Vector3): SplatAngles {
  const n = dir.clone().normalize()
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)))
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(n.x, -n.z))
  return { yaw, pitch }
}

export function projectAnglesToClient(
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
  yaw: number,
  pitch: number,
  distance = 4,
): { x: number; y: number; visible: boolean } | null {
  const world = anglesToDirection(yaw, pitch).multiplyScalar(distance)
  const projected = world.project(camera)
  if (projected.z > 1) return null
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((-projected.y + 1) / 2) * rect.height,
    visible: true,
  }
}

/** Clique na tela → direção no mundo (interseção com esfera unitária). */
export function pointerToWorldAngles(
  clientX: number,
  clientY: number,
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  target = new THREE.Vector3(0, 0, 0),
  radius = 2,
): SplatAngles | null {
  const rect = dom.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(ndc, camera)
  const sphere = new THREE.Sphere(target, radius)
  const hit = new THREE.Vector3()
  if (!raycaster.ray.intersectSphere(sphere, hit)) {
    return directionToAngles(raycaster.ray.direction.clone().normalize())
  }
  return directionToAngles(hit.sub(target).normalize())
}
