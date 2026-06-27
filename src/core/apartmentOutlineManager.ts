import { getAllPinOutlines } from '../config/apartmentOutlinesConfig'
import { getPoisForApartment } from '../config/apartmentPoiConfig'
import { crmStatusClass, getCrmStatusForUnit } from '../config/crmConfig'
import { unitLabelMatchesApartmentFilter } from '../config/crmFilterConfig'
import { getStageMetrics } from './stageMetrics'
import { resolveApartmentFaceDimensions } from './apartmentFaceMedia'
import { outlineToSvgPointsAttr } from './apartmentOutlineGeometry'
import type { ExplorerEngine } from './engine'

export class ApartmentOutlineManager {
  private mounted = false
  private unsubEngine: (() => void) | null = null
  private svgEl: SVGSVGElement | null = null
  private faceImageCache: { aptId: string; url: string; w: number; h: number } | null = null
  private resizeHandler: (() => void) | null = null
  private hoveredPinId: string | null = null
  private lastApartmentId: string | null = null
  private renderGeneration = 0

  constructor(
    private engine: ExplorerEngine,
    private onPinClick?: (pinId: string) => void,
  ) {}

  mount() {
    if (this.mounted) return
    this.mounted = true
    this.ensureSvg()
    this.resizeHandler = () => void this.render()
    window.addEventListener('resize', this.resizeHandler)
    this.unsubEngine = this.engine.subscribe(() => this.onEngineUpdate())
    this.onEngineUpdate()
  }

  destroy() {
    this.renderGeneration++
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    this.unsubEngine?.()
    this.unsubEngine = null
    this.svgEl?.remove()
    this.svgEl = null
    this.mounted = false
    this.faceImageCache = null
    this.hoveredPinId = null
    this.lastApartmentId = null
  }

  reload() {
    this.faceImageCache = null
    void this.render()
  }

  /** Atualiza cores CRM (disponível / reservado / vendido) nos retângulos da face ativa. */
  applyCrmStyles() {
    if (!this.svgEl) return
    this.svgEl.querySelectorAll<SVGPolygonElement>('.apt-outline').forEach((el) => {
      const label = el.dataset.label
      if (!label) return
      el.classList.remove('crm--available', 'crm--reserved', 'crm--sold')
      el.classList.add(crmStatusClass(getCrmStatusForUnit(label)))
    })
  }

  private ensureSvg() {
    if (this.svgEl) return
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = 'apt-outline-layer'
    svg.setAttribute('class', 'apt-outline-layer')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('aria-hidden', 'true')
    document.body.appendChild(svg)
    this.svgEl = svg
  }

  private onEngineUpdate() {
    if (this.engine.activeApartmentId !== this.lastApartmentId) {
      this.lastApartmentId = this.engine.activeApartmentId
      this.faceImageCache = null
      this.hoveredPinId = null
    }
    this.updateVisibility()
    void this.render()
  }

  private updateVisibility() {
    const show =
      this.engine.apartmentsPanelOpen &&
      this.engine.state === 'idle' &&
      !this.engine.interiorsPanelOpen &&
      !this.engine.activeInteriorId &&
      !this.engine.isPinImmersiveActive() &&
      !document.body.classList.contains('apt-planta-open') &&
      Boolean(this.engine.activeApartmentId) &&
      this.engine.isApartmentFaceReady()
    this.svgEl?.classList.toggle('is-visible', show)
    this.svgEl?.classList.toggle('is-face-ready', show)
  }

  private async getUnitMetrics(aptId: string): Promise<{ w: number; h: number; url: string } | null> {
    if (this.faceImageCache?.aptId === aptId) {
      return {
        url: this.faceImageCache.url,
        w: this.faceImageCache.w,
        h: this.faceImageCache.h,
      }
    }
    const dims = await resolveApartmentFaceDimensions(aptId)
    if (!dims) return null
    this.faceImageCache = { aptId, url: dims.url, w: dims.w, h: dims.h }
    return dims
  }

  private crmClassForPinLabel(label: string): string {
    return crmStatusClass(getCrmStatusForUnit(label))
  }

  private async render() {
    const gen = ++this.renderGeneration
    if (!this.svgEl) return
    const show = this.svgEl.classList.contains('is-visible')
    if (!show) {
      this.svgEl.innerHTML = ''
      return
    }

    const activeId = this.engine.activeApartmentId
    if (!activeId) {
      this.svgEl.innerHTML = ''
      return
    }

    const metrics = await this.getUnitMetrics(activeId)
    if (gen !== this.renderGeneration) return
    if (!metrics) {
      this.svgEl.innerHTML = ''
      return
    }

    const { w: viewW, h: viewH } = getStageMetrics()
    const outlines = getAllPinOutlines()
    const pins = getPoisForApartment(activeId)
    const parts: string[] = []
    let revealIndex = 0

    for (const pin of pins) {
      const outline = outlines[pin.id]
      if (!outline?.points.length) continue
      if (!unitLabelMatchesApartmentFilter(pin.label)) continue
      const pts = outlineToSvgPointsAttr(outline.points, viewW, viewH, metrics.w, metrics.h)
      if (!pts) continue
      const hovered = this.hoveredPinId === pin.id
      const crm = this.crmClassForPinLabel(pin.label)
      const delay = revealIndex * 0.07
      revealIndex++
      parts.push(
        `<polygon class="apt-outline ${crm} is-active${hovered ? ' is-hover' : ''}" data-pin="${pin.id}" data-label="${pin.label.replace(/"/g, '&quot;')}" style="--outline-delay:${delay}s" points="${pts}" />`,
      )
    }

    if (gen !== this.renderGeneration) return
    this.svgEl.innerHTML = parts.join('')

    this.svgEl.querySelectorAll<SVGPolygonElement>('.apt-outline').forEach((el) => {
      const pinId = el.dataset.pin!
      el.addEventListener('mouseenter', () => {
        this.hoveredPinId = pinId
        el.classList.add('is-hover')
      })
      el.addEventListener('mouseleave', () => {
        if (this.hoveredPinId === pinId) this.hoveredPinId = null
        el.classList.remove('is-hover')
      })
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.onPinClick) {
          this.onPinClick(pinId)
          return
        }
        void this.engine.selectApartment(activeId)
      })
    })
  }
}
