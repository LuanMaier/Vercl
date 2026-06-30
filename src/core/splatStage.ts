import type { SplatPinDefinition } from '../config/splatConfig'
import { getSplatModelPath, getSplatMovementLimits, getSplatPins, getSplatStartView } from '../config/splatConfig'
import { resolveMediaPath } from './paths'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { GaussianSplatViewer } from './gaussianSplatViewer'
import { projectAnglesToClient } from './splatSphereCoords'

export class SplatStage {
  private viewer: GaussianSplatViewer | null = null
  private layer: HTMLElement | null = null
  private pinsLayer: HTMLElement | null = null
  private loadingEl: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private active = false
  private pinRaf = 0
  private pins: SplatPinDefinition[] = []
  private onPinClick: ((pin: SplatPinDefinition) => void) | null = null

  constructor(private stage: HTMLElement) {}

  setPinClickHandler(handler: (pin: SplatPinDefinition) => void) {
    this.onPinClick = handler
  }

  isOpen() {
    return this.active
  }

  private ensureDom() {
    if (this.layer) return
    this.layer = document.createElement('div')
    this.layer.id = 'stage-splat-layer'
    this.layer.className = 'stage-splat-layer'
    this.layer.hidden = true

    this.loadingEl = document.createElement('div')
    this.loadingEl.className = 'stage-splat-loading'
    this.loadingEl.textContent = 'Carregando modelo 3D…'

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'stage-splat-canvas'
    this.canvas.setAttribute('aria-label', 'Gaussian Splat interativo')

    this.pinsLayer = document.createElement('div')
    this.pinsLayer.className = 'stage-splat-pins'

    this.layer.append(this.loadingEl, this.canvas, this.pinsLayer)
    this.stage.appendChild(this.layer)
  }

  async open(): Promise<boolean> {
    const ref = getSplatModelPath()
    if (!ref) return false

    this.ensureDom()
    if (!this.layer || !this.canvas || !this.loadingEl || !this.pinsLayer) return false

    this.pins = getSplatPins()
    this.active = true
    this.layer.hidden = false
    this.stage.classList.add('splat-stage-active')
    document.body.classList.add('interactive-splat-active')
    this.loadingEl.classList.remove('hidden')

    this.viewer?.dispose()
    this.viewer = new GaussianSplatViewer({
      host: this.layer,
      canvas: this.canvas,
      loadingEl: this.loadingEl,
      movementLimits: getSplatMovementLimits(),
      startView: getSplatStartView() ?? null,
    })
    this.viewer.mount()

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    const ok = await this.viewer.load(src)
    if (!ok) {
      this.close()
      return false
    }

    this.renderPins()
    this.startPinLoop()
    return true
  }

  close() {
    if (this.pinRaf) cancelAnimationFrame(this.pinRaf)
    this.pinRaf = 0
    this.active = false
    this.viewer?.dispose()
    this.viewer = null
    if (this.layer) this.layer.hidden = true
    if (this.pinsLayer) this.pinsLayer.innerHTML = ''
    this.stage.classList.remove('splat-stage-active')
    document.body.classList.remove('interactive-splat-active')
  }

  private renderPins() {
    if (!this.pinsLayer) return
    this.pinsLayer.innerHTML = ''
    for (const pin of this.pins) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'poi splat-pin'
      btn.dataset.pinId = pin.id
      btn.innerHTML = `<span class="poi-label">${pin.label}</span>`
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onPinClick?.(pin)
      })
      this.pinsLayer!.appendChild(btn)
    }
  }

  private startPinLoop() {
    if (this.pinRaf) cancelAnimationFrame(this.pinRaf)
    const tick = () => {
      this.pinRaf = requestAnimationFrame(tick)
      if (!this.active) return
      this.repositionPins()
    }
    tick()
  }

  private repositionPins() {
    const camera = this.viewer?.getCamera()
    const layer = this.pinsLayer
    if (!camera || !layer || !this.layer) return
    const rect = this.layer.getBoundingClientRect()
    layer.querySelectorAll<HTMLElement>('.splat-pin').forEach((el) => {
      const pin = this.pins.find((p) => p.id === el.dataset.pinId)
      if (!pin) return
      const pos = projectAnglesToClient(camera, rect, pin.yaw, pin.pitch)
      if (!pos) {
        el.classList.add('hidden')
        return
      }
      el.classList.remove('hidden')
      el.style.left = `${pos.x - rect.left}px`
      el.style.top = `${pos.y - rect.top}px`
    })
  }

  dispose() {
    this.close()
    this.layer?.remove()
    this.layer = null
  }
}
