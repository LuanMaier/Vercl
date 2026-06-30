import type { SplatPinDefinition } from '../config/splatConfig'
import {
  getSplatCameraFlightDurationSec,
  getSplatModelPath,
  getSplatMovementLimits,
  getSplatPinFocusZoomPct,
  getSplatPins,
  getSplatStartView,
} from '../config/splatConfig'
import { resolveMediaPath } from './paths'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { GaussianSplatViewer } from './gaussianSplatViewer'

export class SplatStage {
  private viewer: GaussianSplatViewer | null = null
  private layer: HTMLElement | null = null
  private loadingEl: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private active = false
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

    this.layer.append(this.loadingEl, this.canvas)
    this.stage.appendChild(this.layer)
  }

  async open(): Promise<boolean> {
    const ref = getSplatModelPath()
    if (!ref) return false

    this.ensureDom()
    if (!this.layer || !this.canvas || !this.loadingEl) return false

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
      explorePins: true,
      pinFocusZoomPct: getSplatPinFocusZoomPct(),
      cameraFlightDurationSec: getSplatCameraFlightDurationSec(),
    })
    this.viewer.mount()

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    const ok = await this.viewer.load(src)
    if (!ok) {
      this.close()
      return false
    }

    this.renderPins()
    return true
  }

  close() {
    this.active = false
    this.viewer?.dispose()
    this.viewer = null
    if (this.layer) this.layer.hidden = true
    this.stage.classList.remove('splat-stage-active')
    document.body.classList.remove('interactive-splat-active')
  }

  private renderPins() {
    if (!this.viewer?.isReady()) return
    this.viewer.setPins(this.pins, {
      mode: 'explorer',
      onPinClick: (pin) => {
        this.viewer?.focusPin(pin)
        this.onPinClick?.(pin)
      },
    })
  }

  dispose() {
    this.close()
    this.layer?.remove()
    this.layer = null
  }
}
