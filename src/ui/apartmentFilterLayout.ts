import { resolveApartmentFaceDimensions, type ApartmentFaceDimensions } from '../core/apartmentFaceMedia'
import { getStillViewFitRect } from '../core/coverCoords'
import { isMobileViewport } from '../core/paths'

function measureBandBottom(): number {
  const track = document.getElementById('track')
  if (track) {
    const top = track.getBoundingClientRect().top
    if (top > 0) return top
  }
  const h = track?.getBoundingClientRect().height ?? 148
  return window.innerHeight - h
}

function readLiveFaceDimensions(): ApartmentFaceDimensions | null {
  const stage = document.getElementById('stage')
  if (!stage) return null

  for (const video of stage.querySelectorAll('video')) {
    const el = video as HTMLVideoElement
    if (el.videoWidth > 0 && el.videoHeight > 0) {
      return { w: el.videoWidth, h: el.videoHeight, url: el.currentSrc || el.src }
    }
  }

  for (const img of stage.querySelectorAll('img')) {
    const el = img as HTMLImageElement
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      return { w: el.naturalWidth, h: el.naturalHeight, url: el.currentSrc || el.src }
    }
  }

  return null
}

function getStageImageBottom(dims: ApartmentFaceDimensions): number | null {
  const stage = document.getElementById('stage')
  if (!stage) return null
  const stageRect = stage.getBoundingClientRect()
  if (!stageRect.width || !stageRect.height) return null
  const cover = getStillViewFitRect(stageRect.width, stageRect.height, dims.w, dims.h)
  if (!cover) return null
  return stageRect.top + cover.dy + cover.dh
}

function clearMobileTriggerStyles(trigger: HTMLElement) {
  cancelAnimationFrame(triggerLayoutRaf)
  triggerLayoutRaf = 0
  trigger.style.top = ''
  trigger.style.bottom = ''
  trigger.style.left = ''
  trigger.classList.remove('is-layout-ready')
}

function clearMobileDockStyles(dock: HTMLElement) {
  cancelAnimationFrame(layoutRaf)
  layoutRaf = 0
  dock.style.top = ''
  dock.style.bottom = ''
  dock.style.maxHeight = ''
  dock.style.overflowY = ''
  dock.classList.remove('is-layout-ready')
}

function applyMobileTriggerLayout(trigger: HTMLElement, dims: ApartmentFaceDimensions): boolean {
  const stage = document.getElementById('stage')
  if (!stage) return false

  const stageRect = stage.getBoundingClientRect()
  const imageBottom = getStageImageBottom(dims)
  if (imageBottom == null) return false

  trigger.style.top = `${Math.round(imageBottom + 8)}px`
  trigger.style.bottom = 'auto'
  trigger.style.left = `${Math.round(stageRect.left + Math.max(10, 0))}px`
  trigger.classList.add('is-layout-ready')
  return true
}

function applyMobileDockLayout(dock: HTMLElement, dims: ApartmentFaceDimensions): boolean {
  const stage = document.getElementById('stage')
  if (!stage) return false

  const stageRect = stage.getBoundingClientRect()
  if (!stageRect.width || !stageRect.height) return false

  const imageBottom = getStageImageBottom(dims)
  if (imageBottom == null) return false

  const gap = 8
  const bandBottom = measureBandBottom() - gap
  const trigger = document.getElementById('apt-filter-trigger')
  const triggerRect = trigger?.getBoundingClientRect()
  const triggerBottom = triggerRect && triggerRect.height > 0 ? triggerRect.bottom : imageBottom + 40

  let top = triggerBottom + 6
  if (top >= bandBottom - 48) {
    top = Math.max(stageRect.top + gap, bandBottom - (dock.offsetHeight || 200) - gap)
  }

  const maxHeight = Math.max(72, bandBottom - top)
  dock.style.top = `${Math.round(top)}px`
  dock.style.bottom = 'auto'
  dock.style.maxHeight = `${Math.round(maxHeight)}px`
  dock.style.overflowY = 'auto'
  dock.classList.add('is-layout-ready')
  return true
}

let layoutRaf = 0
let triggerLayoutRaf = 0

function runLiveLayout(
  el: HTMLElement,
  aptId: string,
  apply: (el: HTMLElement, dims: ApartmentFaceDimensions) => boolean,
  rafKey: 'dock' | 'trigger',
): void {
  let configRequested = false
  const tryLayout = () => {
    const needsOpen = rafKey === 'dock' ? el.classList.contains('is-open') : el.classList.contains('is-visible')
    if (!needsOpen) {
      if (rafKey === 'dock') layoutRaf = 0
      else triggerLayoutRaf = 0
      return
    }

    const live = readLiveFaceDimensions()
    if (live && apply(el, live)) {
      if (rafKey === 'dock') layoutRaf = 0
      else triggerLayoutRaf = 0
      return
    }

    if (!configRequested) {
      configRequested = true
      void resolveApartmentFaceDimensions(aptId).then((dims) => {
        const stillNeeds =
          rafKey === 'dock' ? el.classList.contains('is-open') : el.classList.contains('is-visible')
        if (!dims || !stillNeeds) return
        if (apply(el, dims)) {
          if (rafKey === 'dock') layoutRaf = 0
          else triggerLayoutRaf = 0
        }
      })
    }

    const id = requestAnimationFrame(tryLayout)
    if (rafKey === 'dock') layoutRaf = id
    else triggerLayoutRaf = id
  }

  tryLayout()
}

/** Mobile: botão na faixa abaixo da imagem. */
export function layoutMobileApartmentFilterTrigger(
  trigger: HTMLElement,
  aptId: string | null,
): void {
  if (!isMobileViewport() || !aptId) {
    if (!trigger.classList.contains('is-visible')) clearMobileTriggerStyles(trigger)
    return
  }

  if (!trigger.classList.contains('is-visible')) {
    clearMobileTriggerStyles(trigger)
    return
  }

  const live = readLiveFaceDimensions()
  if (live && applyMobileTriggerLayout(trigger, live)) return

  if (trigger.classList.contains('is-layout-ready')) return

  cancelAnimationFrame(triggerLayoutRaf)
  triggerLayoutRaf = 0
  runLiveLayout(trigger, aptId, applyMobileTriggerLayout, 'trigger')
}

/** Mobile: painel abaixo do botão. Posiciona antes de abrir; ao fechar não limpa top (evita salto). */
export function layoutMobileApartmentFilterDock(
  dock: HTMLElement,
  aptId: string | null,
): void {
  cancelAnimationFrame(layoutRaf)
  layoutRaf = 0

  if (!isMobileViewport() || !aptId) {
    if (!dock.classList.contains('is-open')) clearMobileDockStyles(dock)
    return
  }

  if (!dock.classList.contains('is-open')) {
    return
  }

  const live = readLiveFaceDimensions()
  if (live && applyMobileDockLayout(dock, live)) return

  runLiveLayout(dock, aptId, applyMobileDockLayout, 'dock')
}

/** Pré-posiciona o painel antes de `is-open` (evita flash no toggle). */
export function prepareMobileApartmentFilterDock(
  dock: HTMLElement,
  aptId: string | null,
): void {
  if (!isMobileViewport() || !aptId) return

  const live = readLiveFaceDimensions()
  if (live && applyMobileDockLayout(dock, live)) return

  void resolveApartmentFaceDimensions(aptId).then((dims) => {
    if (!dims || !dock.isConnected) return
    applyMobileDockLayout(dock, dims)
  })
}

export function watchMobileApartmentFilterLayout(
  dock: HTMLElement,
  trigger: HTMLElement,
  getAptId: () => string | null,
): () => void {
  let debounce = 0

  const run = () => {
    const apt = getAptId()
    if (!apt) return
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      if (trigger.classList.contains('is-visible')) {
        layoutMobileApartmentFilterTrigger(trigger, apt)
      }
      if (dock.classList.contains('is-open')) {
        layoutMobileApartmentFilterDock(dock, apt)
      }
    }, 32)
  }

  const stage = document.getElementById('stage')
  const ro = new ResizeObserver(() => run())
  if (stage) {
    ro.observe(stage)
    stage.addEventListener('loadedmetadata', run, true)
    stage.addEventListener('loadeddata', run, true)
  }

  window.addEventListener('resize', run)
  window.visualViewport?.addEventListener('resize', run)
  window.visualViewport?.addEventListener('scroll', run)

  return () => {
    ro.disconnect()
    stage?.removeEventListener('loadedmetadata', run, true)
    stage?.removeEventListener('loadeddata', run, true)
    window.removeEventListener('resize', run)
    window.visualViewport?.removeEventListener('resize', run)
    window.clearTimeout(debounce)
  }
}
