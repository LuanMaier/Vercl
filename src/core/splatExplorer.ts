import type { SplatPinDefinition } from '../config/splatConfig'
import { resolveMediaPath } from './paths'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { GaussianSplatViewer } from './gaussianSplatViewer'
import { projectAnglesToClient } from './splatSphereCoords'

export class SplatExplorerModal {
  private viewer: GaussianSplatViewer | null = null
  private pinsLayer: HTMLElement | null = null
  private pins: SplatPinDefinition[] = []
  private pinClickHandler: ((pin: SplatPinDefinition) => void) | null = null
  private pinRaf = 0

  constructor(
    private modal: HTMLElement,
    private box: HTMLElement,
    private canvas: HTMLCanvasElement,
    private loading: HTMLElement,
  ) {}

  mount() {
    window.addEventListener('explorer:open-splat', () => {
      void this.open()
    })
    this.modal.querySelector('[data-splat-close]')?.addEventListener('click', () => this.close())
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('open')) this.close()
    })
  }

  setPinClickHandler(handler: (pin: SplatPinDefinition) => void) {
    this.pinClickHandler = handler
  }

  async open(modelRef?: string, pins?: SplatPinDefinition[]) {
    const { getSplatModelPath, getSplatMovementLimits, getSplatPins, getSplatStartView } = await import('../config/splatConfig')
    const ref = modelRef ?? getSplatModelPath()
    if (!ref) return

    this.pins = pins ?? getSplatPins()
    this.modal.classList.add('open')
    this.modal.setAttribute('aria-hidden', 'false')
    this.loading.classList.remove('hidden')
    this.loading.textContent = 'Carregando Gaussian Splat…'

    this.teardownViewer()

    if (!this.pinsLayer) {
      this.pinsLayer = document.createElement('div')
      this.pinsLayer.className = 'splat-pins-layer'
      this.box.appendChild(this.pinsLayer)
    }
    this.pinsLayer.innerHTML = ''

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)

    this.viewer = new GaussianSplatViewer({
      host: this.box,
      canvas: this.canvas,
      loadingEl: this.loading,
      movementLimits: getSplatMovementLimits(),
      startView: getSplatStartView() ?? null,
    })
    this.viewer.mount()

    const ok = await this.viewer.load(src)
    if (!ok) return

    this.renderPinButtons()
    this.startPinLoop()
  }

  private renderPinButtons() {
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
        this.pinClickHandler?.(pin)
      })
      this.pinsLayer!.appendChild(btn)
    }
  }

  private startPinLoop() {
    if (this.pinRaf) cancelAnimationFrame(this.pinRaf)
    const tick = () => {
      this.pinRaf = requestAnimationFrame(tick)
      if (!this.modal.classList.contains('open')) return
      this.repositionPins()
    }
    tick()
  }

  private repositionPins() {
    const camera = this.viewer?.getCamera()
    const layer = this.pinsLayer
    if (!camera || !layer) return
    const rect = this.box.getBoundingClientRect()
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

  close() {
    this.modal.classList.remove('open')
    this.modal.setAttribute('aria-hidden', 'true')
    this.teardownViewer()
  }

  private teardownViewer() {
    if (this.pinRaf) cancelAnimationFrame(this.pinRaf)
    this.pinRaf = 0
    this.viewer?.dispose()
    this.viewer = null
    this.pinsLayer?.replaceChildren()
  }
}
