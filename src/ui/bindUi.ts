import { APARTMENTS_HUB_VIEW } from '../config/apartments'
import { INTERIORS_HUB_VIEW } from '../config/interiors'
import { isDockHubView } from '../config/dockHubs'
import { getProjectLightSliderVideoPath } from '../config/projectMedia'
import { getTrackOrder, getViewpoint } from '../config/pointsConfig'
import type { ApartmentPoiManager } from '../core/apartmentPoiManager'
import type { ExplorerEngine } from '../core/engine'
import type { PoiManager } from '../core/poiManager'
import { syncDockTabsLayout } from './dockLayout'
import { bindTap } from './bindTap'

let mainDockTabsEl: HTMLElement | null = null

export function bindTrack(
  engine: ExplorerEngine,
  track: HTMLElement,
  poiManager: PoiManager,
) {
  const wrap = (track.querySelector('#track-pts') ?? track) as HTMLElement
  mainDockTabsEl = wrap
  wrap.innerHTML = ''

  getTrackOrder().forEach((idx) => {
    const vp = getViewpoint(idx)
    if (!vp) return
    const el = document.createElement('button')
    el.type = 'button'
    el.className = `dock-tab t-pt${idx === 0 ? ' t-pt-main' : ''}`
    el.dataset.i = String(idx)
    el.setAttribute('role', 'tab')
    el.setAttribute('aria-selected', 'false')
    el.innerHTML = `
      <span class="dock-tab-glow" aria-hidden="true"></span>
      <span class="dock-tab-label">${vp.label}</span>
      <span class="dock-tab-tag">${vp.tag}</span>
    `
    const go = () => {
      if (isDockHubView(idx)) {
        if (idx === INTERIORS_HUB_VIEW) {
          engine.toggleInteriorsPanel()
          return
        }
        if (idx === APARTMENTS_HUB_VIEW) {
          engine.toggleApartmentsPanel()
          return
        }
      }
      void engine.closeInteriorsPanel()
      void engine.closeApartmentsPanel()
      void poiManager.navigateToView(idx)
    }
    bindTap(el, go)
    wrap.appendChild(el)
  })
  syncDockTabsLayout(wrap)
}

export function refreshMainDockLayout() {
  syncDockTabsLayout(mainDockTabsEl)
}

/** @deprecated Botões dia/tarde/noite desativados — use mountLightSlider */
export function bindMoodBar(_engine: ExplorerEngine, _moodBar: HTMLElement) {}

export function syncUi(
  engine: ExplorerEngine,
  poiManager: PoiManager,
  apartmentPoiManager?: ApartmentPoiManager,
) {
  const active = engine.getActiveTrackIndex()
  document.querySelectorAll('.t-pt').forEach((el) => {
    const btn = el as HTMLButtonElement
    const isActive = parseInt(btn.dataset.i!, 10) === active
    btn.classList.toggle('active', isActive)
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false')
  })

  const moodBar = document.getElementById('mood-bar')
  const hideForHub =
    engine.interiorsPanelOpen ||
    Boolean(engine.activeInteriorId) ||
    engine.apartmentsPanelOpen ||
    Boolean(engine.activeApartmentId)
  const hasSliderVideo = Boolean(getProjectLightSliderVideoPath(engine.currentView))
  const moodVisible = !hideForHub && hasSliderVideo
  const lightEnabled =
    engine.canChangeLight() && !poiManager.isInsolationBlocked()

  moodBar?.classList.toggle('show', moodVisible)
  moodBar?.classList.toggle('is-disabled', moodVisible && !lightEnabled)

  const slider = moodBar?.querySelector<HTMLInputElement>('#light-slider')
  if (slider && moodVisible) {
    slider.disabled = !lightEnabled
  }

  document.body.classList.toggle('is-playing', engine.state === 'playing')
  document.body.classList.toggle('interiors-panel-open', engine.interiorsPanelOpen)
  document.body.classList.toggle('apartments-panel-open', engine.apartmentsPanelOpen)
  document.body.classList.toggle('pin-immersive-active', engine.isPinImmersiveActive())

  const backBtn = document.getElementById('immersive-back')
  if (backBtn) {
    const showBack = engine.canGoBackImmersive()
    backBtn.classList.toggle('hidden', !showBack)
    backBtn.toggleAttribute('disabled', engine.state === 'playing')
  }

  poiManager.updateVisibility()
  apartmentPoiManager?.refreshVisibility()
}
