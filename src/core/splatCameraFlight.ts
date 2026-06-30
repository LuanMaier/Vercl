import * as THREE from 'three'
import type { SplatPinDefinition, SplatStartView } from '../config/splatConfig'
import { getPinWorldPosition, hasPinWorldPosition } from './splatDepthPick'

export type CameraPose = {
  target: THREE.Vector3
  cameraPosition: THREE.Vector3
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function poseFromStartView(view: SplatStartView, out?: CameraPose): CameraPose {
  const target = new THREE.Vector3(view.targetX, view.targetY, view.targetZ)
  const offset = new THREE.Vector3().setFromSphericalCoords(view.distance, view.polar, view.azimuth)
  const cameraPosition = target.clone().add(offset)
  if (out) {
    out.target.copy(target)
    out.cameraPosition.copy(cameraPosition)
    return out
  }
  return { target, cameraPosition }
}

/** Pose final ao focar num pin (mesma lógica do focus instantâneo). */
export function computePinFocusPose(
  pin: SplatPinDefinition,
  controlsTarget: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  splatMesh: THREE.Object3D | null | undefined,
  markerDistance: number,
  zoomPct: number,
  scratch = new THREE.Vector3(),
): CameraPose {
  const t = Math.min(100, Math.max(0, zoomPct)) / 100
  const pinWorld = getPinWorldPosition(pin, controlsTarget, markerDistance, scratch, splatMesh)
  const target = controlsTarget.clone()
  const cameraPosition = camera.position.clone()

  if (hasPinWorldPosition(pin)) {
    target.lerp(pinWorld, t * 0.85)
    cameraPosition.lerp(pinWorld, t * 0.35)
    return { target, cameraPosition }
  }

  const pinDir = pinWorld.clone().sub(controlsTarget).normalize()
  const offset = new THREE.Vector3().subVectors(camera.position, controlsTarget)
  const current = new THREE.Spherical().setFromVector3(offset)
  const pinSph = new THREE.Spherical().setFromVector3(pinDir)
  const newTheta = current.theta + (pinSph.theta - current.theta) * t
  const newPhi = current.phi + (pinSph.phi - current.phi) * t
  const minDistance = 0.4
  const newRadius = Math.max(minDistance, current.radius * (1 - t))
  const newOffset = new THREE.Vector3().setFromSphericalCoords(newRadius, newPhi, newTheta)
  cameraPosition.copy(controlsTarget).add(newOffset)
  return { target, cameraPosition }
}
