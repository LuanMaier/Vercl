import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import {
  DEFAULT_SPLAT_MOVEMENT_LIMITS,
  DEFAULT_SPLAT_CAMERA_FLIGHT_SEC,
  DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT,
  type SplatMovementLimits,
  type SplatPinDefinition,
  type SplatStartView,
} from '../config/splatConfig'
import type { SplatAngles } from './splatSphereCoords'
import { directionToAngles, pointerToWorldAngles } from './splatSphereCoords'
import {
  computePinFocusPose,
  easeInOutCubic,
  poseFromStartView,
  type CameraPose,
} from './splatCameraFlight'
import {
  pickPinPointFromPointer,
  SPLAT_MIN_RAYCAST_OPACITY,
  type SplatPinPickMode,
  type SplatWorldPoint,
} from './splatDepthPick'
import { SplatPinLayer3D, type SplatPinLayerOptions } from './splatPinLayer3d'

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
  /** Clique com profundidade — posição 3D no modelo. */
  onClickWorld?: (point: SplatWorldPoint, ev: PointerEvent) => void
  pinPlacement?: boolean
  movementLimits?: SplatMovementLimits
  startView?: SplatStartView | null
  /** Navegação explorador: pin aproxima, clique no fundo volta à vista inicial. */
  explorePins?: boolean
  pinFocusZoomPct?: number
  cameraFlightDurationSec?: number
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
  private onClickWorld: ((point: SplatWorldPoint, ev: PointerEvent) => void) | null = null
  private movementLimits: SplatMovementLimits = { ...DEFAULT_SPLAT_MOVEMENT_LIMITS }
  private startView: SplatStartView | null | undefined
  private homeAzimuth = 0
  private homePolar = Math.PI / 2
  private homeDistance = 3.2
  private pinLayer: SplatPinLayer3D | null = null
  private pinWorldScratch = new THREE.Vector3()
  private explorePins = false
  private pinFocusZoomPct = DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT
  private cameraFlightDurationSec = DEFAULT_SPLAT_CAMERA_FLIGHT_SEC
  private focusedPinId: string | null = null
  private defaultHomeView: SplatStartView | null = null
  private flight: {
    startTarget: THREE.Vector3
    endTarget: THREE.Vector3
    startCam: THREE.Vector3
    endCam: THREE.Vector3
    startTime: number
    durationMs: number
  } | null = null
  private explorerClickStart: { x: number; y: number } | null = null
  private flightScratchA = new THREE.Vector3()
  private flightScratchB = new THREE.Vector3()

  constructor(private opts: GaussianSplatViewerOptions) {
    this.pinPlacement = Boolean(opts.pinPlacement)
    this.onAnglesChange = opts.onAnglesChange ?? null
    this.onClickAngles = opts.onClickAngles ?? null
    this.onClickWorld = opts.onClickWorld ?? null
    if (opts.movementLimits) {
      this.movementLimits = { ...opts.movementLimits }
    }
    this.startView = opts.startView
    this.explorePins = Boolean(opts.explorePins)
    if (typeof opts.pinFocusZoomPct === 'number') {
      this.pinFocusZoomPct = Math.min(100, Math.max(0, opts.pinFocusZoomPct))
    }
    if (typeof opts.cameraFlightDurationSec === 'number') {
      this.cameraFlightDurationSec = Math.min(8, Math.max(0.15, opts.cameraFlightDurationSec))
    }
  }

  setNavigationSettings(settings: {
    pinFocusZoomPct?: number
    cameraFlightDurationSec?: number
    explorePins?: boolean
  }) {
    if (typeof settings.pinFocusZoomPct === 'number') {
      this.pinFocusZoomPct = Math.min(100, Math.max(0, settings.pinFocusZoomPct))
    }
    if (typeof settings.cameraFlightDurationSec === 'number') {
      this.cameraFlightDurationSec = Math.min(8, Math.max(0.15, settings.cameraFlightDurationSec))
    }
    if (settings.explorePins != null) this.explorePins = settings.explorePins
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
    this.opts.canvas.addEventListener('pointerdown', this.onExplorerPointerDown)
    this.opts.canvas.addEventListener('pointerup', this.onExplorerPointerUp)
  }

  setPinPlacement(enabled: boolean) {
    this.pinPlacement = enabled
    this.opts.canvas.style.cursor = enabled ? 'crosshair' : ''
    this.syncOrbitEnabled()
  }

  setOrbitEnabled(enabled: boolean) {
    if (!this.controls) return
    this.controls.enabled = enabled && !this.pinPlacement && !this.isFlying()
  }

  private syncOrbitEnabled() {
    if (this.controls) {
      this.controls.enabled = !this.pinPlacement && !this.isFlying()
    }
  }

  getOrbitTarget(): THREE.Vector3 | null {
    return this.controls?.target.clone() ?? null
  }

  getPinMarkerDistance(): number {
    if (!this.camera || !this.controls) return 4
    return this.camera.position.distanceTo(this.controls.target) * 0.85
  }

  private isFlying() {
    return this.flight != null
  }

  private startFlight(end: CameraPose, durationSec?: number) {
    if (!this.controls || !this.camera) return
    const sec = durationSec ?? this.cameraFlightDurationSec
    if (sec <= 0) {
      this.controls.target.copy(end.target)
      this.camera.position.copy(end.cameraPosition)
      this.controls.update()
      return
    }
    this.flight = {
      startTarget: this.controls.target.clone(),
      endTarget: end.target.clone(),
      startCam: this.camera.position.clone(),
      endCam: end.cameraPosition.clone(),
      startTime: performance.now(),
      durationMs: sec * 1000,
    }
    this.controls.enabled = false
  }

  private tickFlight() {
    if (!this.flight || !this.controls || !this.camera) return
    const t = Math.min(1, (performance.now() - this.flight.startTime) / this.flight.durationMs)
    const e = easeInOutCubic(t)
    this.controls.target.lerpVectors(this.flight.startTarget, this.flight.endTarget, e)
    this.camera.position.lerpVectors(this.flight.startCam, this.flight.endCam, e)
    this.controls.update()
    if (t >= 1) {
      this.flight = null
      this.syncOrbitEnabled()
    }
  }

  /** Aproxima a câmera em direção ao pin (voo suave no explorador). */
  focusPin(
    pin: SplatPinDefinition,
    opts?: { zoomPct?: number; instant?: boolean },
  ) {
    if (!this.controls || !this.camera) return
    if (!opts?.instant && this.explorePins && this.focusedPinId === pin.id) return

    const zoomPct = opts?.zoomPct ?? this.pinFocusZoomPct
    const end = computePinFocusPose(
      pin,
      this.controls.target,
      this.camera,
      this.splatMesh,
      this.getPinMarkerDistance(),
      zoomPct,
      this.pinWorldScratch,
    )

    if (opts?.instant || !this.explorePins) {
      this.flight = null
      this.controls.target.copy(end.target)
      this.camera.position.copy(end.cameraPosition)
      this.controls.update()
    } else {
      this.startFlight(end)
    }

    this.focusedPinId = pin.id
    this.pinLayer?.setFocusedExplorerPin(pin.id)
  }

  /** Volta à vista inicial salva (voo suave). */
  goToHomeView(opts?: { instant?: boolean }) {
    if (!this.controls || !this.camera) return
    const view = this.startView ?? this.defaultHomeView
    if (!view) return

    const end = poseFromStartView(view, {
      target: this.flightScratchA,
      cameraPosition: this.flightScratchB,
    })

    if (opts?.instant || !this.explorePins) {
      this.flight = null
      applyOrbitStartView(this.controls, this.camera, view)
    } else {
      this.startFlight(end)
    }

    this.focusedPinId = null
    this.pinLayer?.setFocusedExplorerPin(null)
  }

  getFocusedPinId() {
    return this.focusedPinId
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return this.camera
  }

  getHostRect(): DOMRect {
    return this.opts.host.getBoundingClientRect()
  }

  private orbitTargetVec(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.controls) return out.copy(this.controls.target)
    return out.set(0, 0, 0)
  }

  private ensurePinLayer() {
    if (!this.scene) return
    if (!this.pinLayer) {
      this.pinLayer = new SplatPinLayer3D(this.opts.host)
    }
    this.pinLayer.attachToScene(this.scene)
  }

  setPins(pins: SplatPinDefinition[], options: Omit<SplatPinLayerOptions, 'getOrbitTarget' | 'getMarkerDistance'>) {
    if (!this.scene || !this.camera) return
    this.ensurePinLayer()
    this.pinLayer!.setSplatMesh(this.splatMesh)
    this.pinLayer!.setPins(pins, {
      ...options,
      getOrbitTarget: () => this.orbitTargetVec(),
      getMarkerDistance: () => this.getPinMarkerDistance(),
    })
  }

  setPinWorldPoint(pinId: string, point: SplatWorldPoint) {
    this.pinLayer?.setPinLocalPoint(pinId, point.x, point.y, point.z)
  }

  setSelectedPin(pinId: string | null) {
    this.pinLayer?.setSelected(pinId)
  }

  updatePinLabel(pinId: string, label: string) {
    this.pinLayer?.updatePinLabel(pinId, label)
  }

  getPinElement(pinId: string): HTMLElement | null {
    return this.pinLayer?.getElement(pinId) ?? null
  }

  clearPins() {
    this.pinLayer?.clear()
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
      preserveDrawingBuffer: true,
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
    controls.enabled = !this.pinPlacement
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
      const splat = new SplatMesh({
        url,
        minRaycastOpacity: SPLAT_MIN_RAYCAST_OPACITY,
      })
      this.splatMesh = splat
      splat.quaternion.set(1, 0, 0, 0)
      scene.add(splat)
      await splat.initialized
      if (gen !== this.loadGen) return false
      if (this.startView) {
        applyOrbitStartView(controls, camera, this.startView)
      }
      const homeSnap = readOrbitStartView(controls, camera)
      this.defaultHomeView = homeSnap
      this.focusedPinId = null
      this.flight = null
      this.captureHomeCamera()
      this.applyMovementLimits()
      this.ensurePinLayer()
      this.pinLayer?.setSplatMesh(splat)
      this.pinLayer?.setSize(w, h)
      this.showLoading(false)
      this.startLoop()
      return true
    } catch {
      if (gen !== this.loadGen) return false
      this.showLoading(false, 'Falha ao carregar PLY')
      return false
    }
  }

  pointerToWorld(
    clientX: number,
    clientY: number,
    mode: SplatPinPickMode = 'fast',
  ): SplatWorldPoint | null {
    if (!this.camera) return null
    this.controls?.update()
    if (this.renderer && this.scene) {
      this.renderer.render(this.scene, this.camera)
    }
    const target = this.controls?.target ?? new THREE.Vector3(0, 0, 0)
    return pickPinPointFromPointer(
      this.splatMesh,
      this.renderer,
      this.camera,
      clientX,
      clientY,
      this.opts.host,
      target,
      mode,
    )
  }

  pointerToAngles(clientX: number, clientY: number): SplatAngles | null {
    if (!this.camera) return null
    const target = this.controls?.target ?? new THREE.Vector3(0, 0, 0)
    return pointerToWorldAngles(clientX, clientY, this.camera, this.opts.host, target)
  }

  private startLoop() {
    if (this.frame) cancelAnimationFrame(this.frame)
    const tick = () => {
      this.frame = requestAnimationFrame(tick)
      if (!this.renderer || !this.scene || !this.camera) return
      if (this.flight) this.tickFlight()
      else this.controls?.update()
      this.renderer.render(this.scene, this.camera)
      this.pinLayer?.render(this.scene, this.camera)
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
    this.pinLayer?.setSize(w, h)
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
    if (!this.pinPlacement || ev.button !== 0) return
    if (this.onClickWorld) {
      const world = this.pointerToWorld(ev.clientX, ev.clientY, 'refined')
      if (!world) return
      ev.preventDefault()
      ev.stopPropagation()
      this.onClickWorld(world, ev)
      return
    }
    if (!this.onClickAngles) return
    const angles = this.pointerToAngles(ev.clientX, ev.clientY)
    if (!angles) return
    ev.preventDefault()
    ev.stopPropagation()
    this.onClickAngles(angles, ev)
  }

  private onExplorerPointerDown = (ev: PointerEvent) => {
    if (!this.explorePins || this.pinPlacement || ev.button !== 0 || this.isFlying()) return
    this.explorerClickStart = { x: ev.clientX, y: ev.clientY }
  }

  private onExplorerPointerUp = (ev: PointerEvent) => {
    if (!this.explorePins || !this.explorerClickStart || ev.button !== 0) return
    const start = this.explorerClickStart
    this.explorerClickStart = null
    if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) return
    if (this.pinPlacement || this.isFlying()) return
    this.goToHomeView()
  }

  private disposeScene() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.pinLayer?.dispose()
    this.pinLayer = null
    this.flight = null
    this.focusedPinId = null
    this.explorerClickStart = null
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
    this.opts.canvas.removeEventListener('pointerdown', this.onExplorerPointerDown)
    this.opts.canvas.removeEventListener('pointerup', this.onExplorerPointerUp)
    this.disposeScene()
  }
}
