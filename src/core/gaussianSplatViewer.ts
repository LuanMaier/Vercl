import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import {
  DEFAULT_SPLAT_MOVEMENT_LIMITS,
  type SplatMovementLimits,
  type SplatStartView,
} from '../config/splatConfig'
import type { SplatAngles } from './splatSphereCoords'
import { directionToAngles, pointerToWorldAngles } from './splatSphereCoords'

const UNRESTRICTED_MIN_DISTANCE = 0.4
const UNRESTRICTED_MAX_DISTANCE = 24
const POLAR_MARGIN = 0.05

const DEFAULT_CAMERA_POSITION = { x: 0, y: 0.2, z: 3.2 }
const DEFAULT_ORBIT_TARGET = { x: 0, y: 0, z: 0 }

export function applyOrbitStartView(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
  view: SplatStartView,
) {
  controls.target.set(view.targetX, view.targetY, view.targetZ)
  const offset = new THREE.Vector3().setFromSphericalCoords(view.distance, view.polar, view.azimuth)
  camera.position.copy(controls.target).add(offset)
  controls.update()
}

export function readOrbitStartView(
  controls: OrbitControls,
  camera: THREE.PerspectiveCamera,
): SplatStartView {
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
  const spherical = new THREE.Spherical().setFromVector3(offset)
  return {
    targetX: controls.target.x,
    targetY: controls.target.y,
    targetZ: controls.target.z,
    azimuth: spherical.theta,
    polar: spherical.phi,
    distance: spherical.radius,
  }
}

export function applyOrbitMovementLimits(
  controls: OrbitControls,
  homeAzimuth: number,
  homePolar: number,
  homeDistance: number,
  limits: SplatMovementLimits,
) {
  const fwd = limits.zoomForwardPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.zoomForwardPct
  const back = limits.zoomBackwardPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.zoomBackwardPct
  const yaw = limits.orbitYawPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.orbitYawPct
  const pitch = limits.orbitPitchPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.orbitPitchPct

  if (fwd >= 100) {
    controls.minDistance = UNRESTRICTED_MIN_DISTANCE
  } else {
    controls.minDistance = Math.max(
      UNRESTRICTED_MIN_DISTANCE,
      homeDistance * (1 - fwd / 100),
    )
  }

  if (back >= 100) {
    controls.maxDistance = UNRESTRICTED_MAX_DISTANCE
  } else {
    controls.maxDistance = Math.min(
      UNRESTRICTED_MAX_DISTANCE,
      homeDistance * (1 + back / 100),
    )
  }

  if (yaw >= 100) {
    controls.minAzimuthAngle = -Infinity
    controls.maxAzimuthAngle = Infinity
  } else {
    const halfSpan = (yaw / 100) * Math.PI
    controls.minAzimuthAngle = homeAzimuth - halfSpan
    controls.maxAzimuthAngle = homeAzimuth + halfSpan
  }

  if (pitch >= 100) {
    controls.minPolarAngle = POLAR_MARGIN
    controls.maxPolarAngle = Math.PI - POLAR_MARGIN
  } else {
    const halfSpan = (pitch / 100) * (Math.PI / 2)
    controls.minPolarAngle = Math.max(POLAR_MARGIN, homePolar - halfSpan)
    controls.maxPolarAngle = Math.min(Math.PI - POLAR_MARGIN, homePolar + halfSpan)
  }
}

export type GaussianSplatViewerOptions = {
  host: HTMLElement
  canvas: HTMLCanvasElement
  loadingEl?: HTMLElement
  onAnglesChange?: (angles: SplatAngles) => void
  onClickAngles?: (angles: SplatAngles, ev: PointerEvent) => void
  pinPlacement?: boolean
  movementLimits?: SplatMovementLimits
  startView?: SplatStartView | null
}

export class GaussianSplatViewer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private spark: SparkRenderer | null = null
  private splatMesh: SplatMesh | null = null
  private frame = 0
  private resizeObserver: ResizeObserver | null = null
  private loadGen = 0
  private pinPlacement = false
  private onAnglesChange: ((angles: SplatAngles) => void) | null = null
  private onClickAngles: ((angles: SplatAngles, ev: PointerEvent) => void) | null = null
  private movementLimits: SplatMovementLimits = { ...DEFAULT_SPLAT_MOVEMENT_LIMITS }
  private startView: SplatStartView | null | undefined
  private homeAzimuth = 0
  private homePolar = Math.PI / 2
  private homeDistance = 3.2

  constructor(private opts: GaussianSplatViewerOptions) {
    this.pinPlacement = Boolean(opts.pinPlacement)
    this.onAnglesChange = opts.onAnglesChange ?? null
    this.onClickAngles = opts.onClickAngles ?? null
    if (opts.movementLimits) {
      this.movementLimits = { ...opts.movementLimits }
    }
    this.startView = opts.startView
  }

  setMovementLimits(limits: SplatMovementLimits) {
    this.movementLimits = { ...limits }
    this.applyMovementLimits()
  }

  setStartView(view: SplatStartView | null | undefined) {
    this.startView = view
    if (!this.controls || !this.camera || !this.splatMesh?.isInitialized) return
    if (view) {
      applyOrbitStartView(this.controls, this.camera, view)
    } else {
      this.controls.target.set(
        DEFAULT_ORBIT_TARGET.x,
        DEFAULT_ORBIT_TARGET.y,
        DEFAULT_ORBIT_TARGET.z,
      )
      this.camera.position.set(
        DEFAULT_CAMERA_POSITION.x,
        DEFAULT_CAMERA_POSITION.y,
        DEFAULT_CAMERA_POSITION.z,
      )
      this.controls.update()
    }
    this.captureHomeCamera()
    this.applyMovementLimits()
  }

  getStartViewSnapshot(): SplatStartView | null {
    if (!this.controls || !this.camera) return null
    return readOrbitStartView(this.controls, this.camera)
  }

  mount() {
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.opts.host)
    this.opts.canvas.addEventListener('pointerdown', this.onPointerDown)
  }

  setPinPlacement(enabled: boolean) {
    this.pinPlacement = enabled
    this.opts.canvas.style.cursor = enabled ? 'crosshair' : ''
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return this.camera
  }

  getHostRect(): DOMRect {
    return this.opts.host.getBoundingClientRect()
  }

  isReady() {
    return Boolean(this.splatMesh?.isInitialized)
  }

  async load(url: string): Promise<boolean> {
    const gen = ++this.loadGen
    this.disposeScene()
    this.showLoading(true)

    const w = Math.max(1, this.opts.host.clientWidth)
    const h = Math.max(1, this.opts.host.clientHeight)

    const renderer = new THREE.WebGLRenderer({
      canvas: this.opts.canvas,
      antialias: false,
      alpha: true,
    })
    renderer.setSize(w, h, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0b)
    this.scene = scene

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.05, 500)
    camera.position.set(0, 0.2, 3.2)
    this.camera = camera

    const controls = new OrbitControls(camera, this.opts.canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)
    controls.addEventListener('change', () => {
      if (this.onAnglesChange && this.camera) {
        const dir = this.camera.position.clone().sub(controls.target).normalize()
        this.onAnglesChange(directionToAngles(dir))
      }
    })
    this.controls = controls

    const spark = new SparkRenderer({ renderer })
    scene.add(spark)
    this.spark = spark

    try {
      const splat = new SplatMesh({ url })
      this.splatMesh = splat
      splat.quaternion.set(1, 0, 0, 0)
      scene.add(splat)
      await splat.initialized
      if (gen !== this.loadGen) return false
      if (this.startView) {
        applyOrbitStartView(controls, camera, this.startView)
      }
      this.captureHomeCamera()
      this.applyMovementLimits()
      this.showLoading(false)
      this.startLoop()
      return true
    } catch {
      if (gen !== this.loadGen) return false
      this.showLoading(false, 'Falha ao carregar PLY')
      return false
    }
  }

  pointerToAngles(clientX: number, clientY: number): SplatAngles | null {
    if (!this.camera) return null
    return pointerToWorldAngles(clientX, clientY, this.camera, this.opts.host)
  }

  private startLoop() {
    if (this.frame) cancelAnimationFrame(this.frame)
    const tick = () => {
      this.frame = requestAnimationFrame(tick)
      if (!this.renderer || !this.scene || !this.camera) return
      this.controls?.update()
      this.renderer.render(this.scene, this.camera)
    }
    tick()
  }

  private resize() {
    if (!this.renderer || !this.camera) return
    const w = Math.max(1, this.opts.host.clientWidth)
    const h = Math.max(1, this.opts.host.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private captureHomeCamera() {
    if (!this.controls || !this.camera) return
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    this.homeAzimuth = spherical.theta
    this.homePolar = spherical.phi
    this.homeDistance = spherical.radius
  }

  private applyMovementLimits() {
    if (!this.controls) return
    applyOrbitMovementLimits(
      this.controls,
      this.homeAzimuth,
      this.homePolar,
      this.homeDistance,
      this.movementLimits,
    )
  }

  private showLoading(on: boolean, message?: string) {
    const el = this.opts.loadingEl
    if (!el) return
    el.classList.toggle('hidden', !on)
    if (message) el.textContent = message
    else if (on) el.textContent = 'Carregando Gaussian Splat…'
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (!this.pinPlacement || !this.onClickAngles) return
    if (ev.button !== 0) return
    const angles = this.pointerToAngles(ev.clientX, ev.clientY)
    if (!angles) return
    ev.preventDefault()
    ev.stopPropagation()
    this.onClickAngles(angles, ev)
  }

  private disposeScene() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.controls?.dispose()
    this.controls = null
    if (this.splatMesh) {
      this.scene?.remove(this.splatMesh)
      this.splatMesh.dispose()
      this.splatMesh = null
    }
    if (this.spark) {
      this.scene?.remove(this.spark)
      this.spark = null
    }
    this.renderer?.dispose()
    this.renderer = null
    this.scene = null
    this.camera = null
  }

  dispose() {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.opts.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.disposeScene()
  }
}
