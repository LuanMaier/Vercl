import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import type { SplatAngles } from './splatSphereCoords'
import { directionToAngles, pointerToWorldAngles } from './splatSphereCoords'

export type GaussianSplatViewerOptions = {
  host: HTMLElement
  canvas: HTMLCanvasElement
  loadingEl?: HTMLElement
  onAnglesChange?: (angles: SplatAngles) => void
  onClickAngles?: (angles: SplatAngles, ev: PointerEvent) => void
  pinPlacement?: boolean
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

  constructor(private opts: GaussianSplatViewerOptions) {
    this.pinPlacement = Boolean(opts.pinPlacement)
    this.onAnglesChange = opts.onAnglesChange ?? null
    this.onClickAngles = opts.onClickAngles ?? null
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
    controls.minDistance = 0.4
    controls.maxDistance = 24
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
