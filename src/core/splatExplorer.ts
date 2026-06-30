import type { SplatPinDefinition } from '../config/splatConfig'
import { resolveMediaPath } from './paths'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import type { GaussianSplatViewer } from './gaussianSplatViewer'

export class SplatExplorerModal {
  private viewer: GaussianSplatViewer | null = null
  private pins: SplatPinDefinition[] = []
  private pinClickHandler: ((pin: SplatPinDefinition) => void) | null = null

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
    const { getSplatCameraFlightDurationSec, getSplatModelPath, getSplatMovementLimits, getSplatPinFocusZoomPct, getSplatPins, getSplatStartView } = await import('../config/splatConfig')
    const ref = modelRef ?? getSplatModelPath()
    if (!ref) return

    this.pins = pins ?? getSplatPins()
    this.modal.classList.add('open')
    this.modal.setAttribute('aria-hidden', 'false')
    this.loading.classList.remove('hidden')
    this.loading.textContent = 'Carregando Gaussian Splat…'

    this.teardownViewer()

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    // Carregado sob demanda: evita baixar Spark/Three (~1,8 MB gzip) em todo
    // carregamento do site, já que só é usado ao abrir este modal.
    const { GaussianSplatViewer } = await import('./gaussianSplatViewer')

    this.viewer = new GaussianSplatViewer({
      host: this.box,
      canvas: this.canvas,
      loadingEl: this.loading,
      movementLimits: getSplatMovementLimits(),
      startView: getSplatStartView() ?? null,
      explorePins: true,
      pinFocusZoomPct: getSplatPinFocusZoomPct(),
      cameraFlightDurationSec: getSplatCameraFlightDurationSec(),
    })
    this.viewer.mount()

    const ok = await this.viewer.load(src)
    if (!ok) return

    this.renderPins()
  }

  private renderPins() {
    if (!this.viewer?.isReady()) return
    this.viewer.setPins(this.pins, {
      mode: 'explorer',
      onPinClick: (pin) => {
        this.viewer?.focusPin(pin)
        this.pinClickHandler?.(pin)
      },
    })
  }

  close() {
    this.modal.classList.remove('open')
    this.modal.setAttribute('aria-hidden', 'true')
    this.teardownViewer()
  }

  private teardownViewer() {
    this.viewer?.dispose()
    this.viewer = null
  }
}
