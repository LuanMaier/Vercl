import './styles/explorer.css'
import { ExplorerEngine } from './core/engine'
import { Panorama360 } from './core/panorama360'
import { PoiManager } from './core/poiManager'
import { ApartmentPoiManager } from './core/apartmentPoiManager'
import { ApartmentOutlineManager } from './core/apartmentOutlineManager'
import { POI_STORAGE_KEY } from './config/poiConfig'
import { APARTMENT_POIS_VERSION_KEY, POIS_OVERRIDES_VERSION_KEY, reloadProjectFiles } from './config/projectMedia'
import { CRM_UNITS_VERSION_KEY, reloadCrmUnits } from './config/crmConfig'
import { clearPrefetchCache } from './core/prefetch'
import { initMobileExperience } from './ui/mobile'
import { POI_MEDIA_VERSION_KEY } from './media/poiMediaStore'
import { revokeAllPoiMediaUrls } from './media/resolvePoiMedia'
import { VideoTransitionPlayer } from './core/videoTransitionPlayer'
import { bindTrack, refreshMainDockLayout, syncUi } from './ui/bindUi'
import { mountLightSlider } from './ui/lightSlider'
import { observeDockTabsLayout } from './ui/dockLayout'
import { mountApartmentsNav, applyApartmentsNavCrmStyles } from './ui/apartmentsNav'
import { mountApartmentFilterPanel } from './ui/apartmentFilterPanel'
import { subscribeApartmentFilter } from './config/crmFilterConfig'
import { mountDockCollapse } from './ui/dockCollapse'
import { mountInteriorsNav } from './ui/interiorsNav'
import { createShell } from './ui/shell'

const shell = createShell()
mountDockCollapse(shell.track)
const engine = new ExplorerEngine(shell.canvas)

const videoPlayer = new VideoTransitionPlayer(
  shell.videoA,
  shell.videoB,
  shell.canvas,
  (loading) => {
    shell.transitionLoading.classList.toggle('show', loading)
    shell.transitionLoading.setAttribute('aria-hidden', loading ? 'false' : 'true')
  },
)
engine.setVideoPlayer(videoPlayer)

const poiManager = new PoiManager(engine)
const apartmentPoiManager = new ApartmentPoiManager(engine)
const apartmentOutlineManager = new ApartmentOutlineManager(engine, (pinId) => {
  apartmentPoiManager.activatePoiById(pinId)
})

bindTrack(engine, shell.track, poiManager)
mountInteriorsNav(engine, shell.track)
mountApartmentsNav(engine, shell.track)
observeDockTabsLayout(shell.track.querySelector('#track-pts'))
window.addEventListener('resize', () => refreshMainDockLayout())

function rebuildExplorerDock() {
  bindTrack(engine, shell.track, poiManager)
  mountInteriorsNav(engine, shell.track)
  mountApartmentsNav(engine, shell.track)
  refreshMainDockLayout()
}
apartmentPoiManager.mount()
apartmentOutlineManager.mount()

mountApartmentFilterPanel(engine)
subscribeApartmentFilter(() => {
  void apartmentOutlineManager.reload()
  apartmentPoiManager.applyFilterVisibility()
})

new Panorama360(
  shell.panoModal,
  shell.panoCanvas,
  shell.panoBox,
  shell.panoLoading,
).mount()

engine.subscribe(() => syncUi(engine, poiManager, apartmentPoiManager))

window.addEventListener('storage', (e) => {
  if (e.key === POI_STORAGE_KEY || e.key === POI_MEDIA_VERSION_KEY) {
    revokeAllPoiMediaUrls()
    poiManager.reload()
    apartmentPoiManager.reload()
    apartmentOutlineManager.reload()
    engine.showPoster(engine.currentView)
    return
  }
  if (e.key === APARTMENT_POIS_VERSION_KEY || e.key === POIS_OVERRIDES_VERSION_KEY) {
    void reloadProjectFiles().then(() => {
      poiManager.syncPinsFromConfig()
      apartmentPoiManager.reload()
      apartmentOutlineManager.reload()
      rebuildExplorerDock()
      syncUi(engine, poiManager, apartmentPoiManager)
    })
  }
  if (e.key === CRM_UNITS_VERSION_KEY) {
    void reloadCrmUnits().then(() => {
      apartmentPoiManager.applyCrmStyles()
      apartmentOutlineManager.applyCrmStyles()
      void apartmentOutlineManager.reload()
      applyApartmentsNavCrmStyles(shell.track)
      syncUi(engine, poiManager, apartmentPoiManager)
    })
  }
})

window.addEventListener('explorer:project-updated', async () => {
  await reloadProjectFiles()
  await reloadCrmUnits()
  clearPrefetchCache()
  revokeAllPoiMediaUrls()
  poiManager.syncPinsFromConfig()
  apartmentPoiManager.reload()
  apartmentOutlineManager.reload()
  apartmentPoiManager.applyCrmStyles()
  apartmentOutlineManager.applyCrmStyles()
  rebuildExplorerDock()
  engine.showPoster(engine.currentView)
  syncUi(engine, poiManager, apartmentPoiManager)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (apartmentPoiManager.isPlantaModalOpen()) {
      apartmentPoiManager.closePlantaModal()
      return
    }
    if (engine.interiorsPanelOpen || engine.activeInteriorId) {
      engine.closeInteriorsPanel()
      syncUi(engine, poiManager, apartmentPoiManager)
      return
    }
    if (engine.apartmentsPanelOpen || engine.activeApartmentId) {
      void engine.closeApartmentsPanel()
      syncUi(engine, poiManager, apartmentPoiManager)
      return
    }
    poiManager.closeAll()
  }
  if (engine.interiorBookOpen && engine.state !== 'playing') {
    if (e.key === 'ArrowLeft') void engine.interiorBookPrev()
    if (e.key === 'ArrowRight') void engine.interiorBookNext()
  }
})

void (async () => {
  await initMobileExperience()
  await reloadProjectFiles()
  await reloadCrmUnits()
  poiManager.mount()
  apartmentPoiManager.reload()
  apartmentOutlineManager.reload()
  apartmentPoiManager.applyCrmStyles()
  apartmentOutlineManager.applyCrmStyles()
  rebuildExplorerDock()
  await engine.bootPanorama()
  mountLightSlider(engine, videoPlayer, shell.moodBar)
  document.getElementById('immersive-back')?.addEventListener('click', () => {
    void engine.goBackImmersiveLevel().then((ok) => {
      if (ok) syncUi(engine, poiManager, apartmentPoiManager)
    })
  })
  syncUi(engine, poiManager, apartmentPoiManager)
})()

const CRM_POLL_MS = 20_000
setInterval(() => {
  void reloadCrmUnits().then((changed) => {
    if (!changed) return
    apartmentPoiManager.applyCrmStyles()
    apartmentOutlineManager.applyCrmStyles()
    void apartmentOutlineManager.reload()
    applyApartmentsNavCrmStyles(shell.track)
    syncUi(engine, poiManager, apartmentPoiManager)
  })
}, CRM_POLL_MS)

;(window as unknown as { __explorer: ExplorerEngine }).__explorer = engine
