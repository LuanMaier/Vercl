import { getPoisForApartment } from '../config/apartmentPoiConfig'
import { getAllPinOutlines } from '../config/apartmentOutlinesConfig'
import { getProjectPoiImagePath } from '../config/projectMedia'
import { unitLabelMatchesApartmentFilter } from '../config/crmFilterConfig'
import { ApartmentPlantaModal } from '../ui/apartmentPlantaModal'
import { pinViewportPosition, migrateAptHighlightToCenterAnchor } from './apartmentPinLayout'
import { outlineCentroid } from './apartmentOutlineGeometry'
import { resolveApartmentFaceDimensions } from './apartmentFaceMedia'
import { getStillViewFitRect } from './coverCoords'
import { getStageMetrics } from './stageMetrics'
import { collapseDockMenu } from '../ui/dockCollapse'
import { bindTap } from '../ui/bindTap'
import type { ExplorerEngine } from './engine'
import type { PoiDefinition } from './types'

export class ApartmentPoiManager {
  private mounted = false
  private unsubEngine: (() => void) | null = null
  private lastApartmentId: string | null = null
  private faceImageCache: { aptId: string; url: string; w: number; h: number } | null = null
  private resizeHandler: (() => void) | null = null
  private readonly plantaModal = new ApartmentPlantaModal(() => this.clearActive())

  constructor(private engine: ExplorerEngine) {}

  mount() {
    if (this.mounted) return
    this.mounted = true
    this.resizeHandler = () => void this.repositionAllPins()
    window.addEventListener('resize', this.resizeHandler)
    this.unsubEngine = this.engine.subscribe(() => this.onEngineUpdate())
    this.onEngineUpdate()
  }

  reload() {
    document.querySelectorAll('.poi--apartment').forEach((el) => el.remove())
    this.plantaModal.close()
    this.faceImageCache = null
    this.lastApartmentId = null
    if (!this.mounted) {
      this.mount()
      return
    }
    void this.syncPinsFromConfig()
  }

  /** Recria/sincroniza pins com o JSON atual (posições, novos pins, removidos). */
  async syncPinsFromConfig() {
    const aptId = this.engine.activeApartmentId
    if (!aptId) return

    const pins = getPoisForApartment(aptId)
    const wanted = new Set(pins.map((p) => `${aptId}:${p.id}`))

    document.querySelectorAll('.poi--apartment').forEach((el) => {
      const html = el as HTMLElement
      const apt = html.dataset.apt ?? ''
      const id = html.id.replace('apt-poi-', '')
      if (!wanted.has(`${apt}:${id}`)) html.remove()
    })

    pins.forEach((poi, index) => {
      if (!document.getElementById(`apt-poi-${poi.id}`)) {
        this.createPoi(aptId, poi, index)
      } else {
        const name = document.querySelector(`#apt-poi-${poi.id} .poi-name`)
        if (name) name.textContent = poi.label
        const el = document.getElementById(`apt-poi-${poi.id}`)
        if (el) this.clearCrmFromPin(el)
      }
    })

    this.lastApartmentId = aptId
    await this.repositionAllPins()
    this.applyCrmStyles()
    this.applyFilterVisibility()
    this.updateVisibility()
  }

  /** Remove cores CRM dos pins — status fica nos retângulos (ApartmentOutlineManager). */
  applyCrmStyles() {
    document.querySelectorAll('.poi--apartment').forEach((el) => {
      el.classList.remove('crm--available', 'crm--reserved', 'crm--sold')
    })
  }

  private clearCrmFromPin(el: HTMLElement) {
    el.classList.remove('crm--available', 'crm--reserved', 'crm--sold')
  }

  private onEngineUpdate() {
    const aptId = this.engine.activeApartmentId
    if (aptId !== this.lastApartmentId) {
      this.lastApartmentId = aptId
      this.faceImageCache = null
      this.plantaModal.close()
      document.querySelectorAll('.poi--apartment').forEach((el) => el.remove())
      if (aptId) {
        void this.syncPinsFromConfig()
      }
    }
    this.updateVisibility()
  }

  private updateVisibility() {
    const active = this.engine.activeApartmentId
    const faceReady = this.engine.isApartmentFaceReady()
    document.querySelectorAll<HTMLElement>('.poi--apartment').forEach((el) => {
      const apt = el.dataset.apt
      const show =
        Boolean(active) &&
        apt === active &&
        this.engine.apartmentsPanelOpen &&
        this.engine.state === 'idle' &&
        !this.plantaModal.isOpen() &&
        faceReady
      el.classList.toggle('hidden', !show)
      el.classList.toggle('is-face-revealed', show)
      if (!show) el.classList.remove('is-active')
    })
  }

  refreshVisibility() {
    this.updateVisibility()
    this.applyFilterVisibility()
  }

  applyFilterVisibility() {
    document.querySelectorAll<HTMLElement>('.poi--apartment').forEach((el) => {
      const labelEl = el.querySelector('.poi-name')
      const label = labelEl?.textContent?.trim() ?? ''
      const match = unitLabelMatchesApartmentFilter(label)
      el.classList.toggle('is-filter-hidden', !match)
    })
  }

  private async getFaceImageMetrics(aptId: string): Promise<{ w: number; h: number } | null> {
    if (this.faceImageCache?.aptId === aptId) {
      return { w: this.faceImageCache.w, h: this.faceImageCache.h }
    }
    const dims = await resolveApartmentFaceDimensions(aptId)
    if (!dims) return null
    this.faceImageCache = { aptId, url: dims.url, w: dims.w, h: dims.h }
    return { w: dims.w, h: dims.h }
  }

  private async repositionAllPins() {
    const aptId = this.engine.activeApartmentId
    if (!aptId) return
    const pins = getPoisForApartment(aptId)
    if (!pins.length) return
    const metrics = await this.getFaceImageMetrics(aptId)
    if (!metrics) return
    const { w: viewW, h: viewH } = getStageMetrics()
    for (const poi of pins) {
      this.applyPinPosition(poi, viewW, viewH, metrics.w, metrics.h)
    }
  }

  private applyPinPosition(
    poi: PoiDefinition,
    viewW: number,
    viewH: number,
    imgW: number,
    imgH: number,
  ) {
    const el = document.getElementById(`apt-poi-${poi.id}`) as HTMLElement | null
    if (!el) return
    const resolved = { ...poi, highlightAnchor: 'center' as const }
    const outline = getAllPinOutlines()[poi.id]
    if (outline?.points?.length && outline.points.length >= 3) {
      const c = outlineCentroid(outline.points)
      resolved.x = c.x
      resolved.y = c.y
    }
    const cover = getStillViewFitRect(viewW, viewH, imgW, imgH)
    if (cover && resolved.highlightAnchor !== 'center') {
      migrateAptHighlightToCenterAnchor(resolved, cover)
    }
    const pos =
      resolved.coordSpace === 'image'
        ? pinViewportPosition(resolved, viewW, viewH, imgW, imgH)
        : { x: resolved.x, y: resolved.y }
    if (!pos) return
    el.style.left = `${pos.x}%`
    el.style.top = `${pos.y}%`
  }

  private createPoi(apartmentId: string, poi: PoiDefinition, index = 0) {
    const marker = document.createElement('div')
    marker.className = 'poi poi--apartment hidden'
    marker.id = `apt-poi-${poi.id}`
    marker.dataset.apt = apartmentId
    marker.style.left = `${poi.x}%`
    marker.style.top = `${poi.y}%`
    marker.style.setProperty('--poi-delay', `${index * 0.11}s`)
    marker.innerHTML = `
      <div class="poi-actions">
        <span class="poi-ring poi-ring--1" aria-hidden="true"></span>
        <span class="poi-ring poi-ring--2" aria-hidden="true"></span>
        <span class="poi-ring poi-ring--3" aria-hidden="true"></span>
        <span class="poi-glow" aria-hidden="true"></span>
        <span class="poi-stem" aria-hidden="true"></span>
        <button type="button" class="poi-btn" aria-label="${poi.label}">
          <span class="poi-btn-core" aria-hidden="true"></span>
        </button>
      </div>
      <div class="poi-name">${poi.label}</div>
    `

    const activate = (e: Event) => {
      e.stopPropagation()
      void this.onPoiClick(poi)
    }
    const btn = marker.querySelector('.poi-btn') as HTMLElement
    bindTap(btn, activate, { stopPropagation: true })
    document.body.appendChild(marker)
    this.clearCrmFromPin(marker)
  }

  private async onPoiClick(poi: PoiDefinition) {
    if (this.engine.state === 'playing') return

    collapseDockMenu()

    const plantaRef = poi.img ?? getProjectPoiImagePath(poi.id)
    if (!plantaRef) return

    this.setActiveMarker(poi.id)
    await this.plantaModal.openWith(poi, plantaRef)
  }

  closePlantaModal() {
    this.plantaModal.close()
    this.clearActive()
  }

  activatePoiById(pinId: string) {
    const aptId = this.engine.activeApartmentId
    if (!aptId) return
    const poi = getPoisForApartment(aptId).find((p) => p.id === pinId)
    if (poi) void this.onPoiClick(poi)
  }

  destroy() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    this.unsubEngine?.()
    this.unsubEngine = null
    document.querySelectorAll('.poi--apartment').forEach((el) => el.remove())
    this.plantaModal.close()
    this.mounted = false
    this.lastApartmentId = null
    this.faceImageCache = null
  }

  isPlantaModalOpen() {
    return this.plantaModal.isOpen()
  }

  private setActiveMarker(poiId: string) {
    document.querySelectorAll('.poi--apartment').forEach((el) => {
      el.classList.toggle('is-active', el.id === `apt-poi-${poiId}`)
    })
  }

  clearActive() {
    document.querySelectorAll('.poi--apartment').forEach((el) => el.classList.remove('is-active'))
    this.updateVisibility()
  }
}
