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

function clearMobileDockStyles(dock: HTMLElement) {
  cancelAnimationFrame(layoutRaf)
  layoutRaf = 0
  dock.style.top = ''
  dock.style.bottom = ''
  dock.style.maxHeight = ''
  dock.style.overflowY = ''
  dock.classList.remove('is-layout-ready')
}

function applyMobileDockLayout(dock: HTMLElement, dims: ApartmentFaceDimensions): boolean {
  const stage = document.getElementById('stage')
  if (!stage) return false

  const stageRect = stage.getBoundingClientRect()
  if (!stageRect.width || !stageRect.height) return false

  const cover = getStillViewFitRect(stageRect.width, stageRect.height, dims.w, dims.h)
  if (!cover) return false

  const imageBottom = stageRect.top + cover.dy + cover.dh
  const gap = 8
  const bandBottom = measureBandBottom() - gap

  let top = imageBottom + gap
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

/** Mobile: faixa abaixo da imagem (contain), alinhada ao stage real na tela. */
export function layoutMobileApartmentFilterDock(
  dock: HTMLElement,
  aptId: string | null,
): void {
  cancelAnimationFrame(layoutRaf)
  layoutRaf = 0

  if (!isMobileViewport() || !aptId) {
    if (!dock.classList.contains('is-visible')) clearMobileDockStyles(dock)
    return
  }

  dock.classList.remove('is-layout-ready')

  let configRequested = false
  const tryLayout = () => {
    if (!dock.classList.contains('is-visible')) {
      layoutRaf = 0
      return
    }

    const live = readLiveFaceDimensions()
    if (live && applyMobileDockLayout(dock, live)) {
      layoutRaf = 0
      return
    }

    if (!configRequested) {
      configRequested = true
      void resolveApartmentFaceDimensions(aptId).then((dims) => {
        if (!dims || !dock.classList.contains('is-visible')) return
        if (applyMobileDockLayout(dock, dims)) layoutRaf = 0
      })
    }

    layoutRaf = requestAnimationFrame(tryLayout)
  }

  tryLayout()
}

export function watchMobileApartmentFilterLayout(
  dock: HTMLElement,
  getAptId: () => string | null,
): () => void {
  const run = () => {
    const apt = getAptId()
    if (!dock.classList.contains('is-visible') || !apt) return
    layoutMobileApartmentFilterDock(dock, apt)
  }

  const stage = document.getElementById('stage')
  const ro = new ResizeObserver(() => run())
  if (stage) {
    ro.observe(stage)
    stage.addEventListener('loadedmetadata', run, true)
    stage.addEventListener('loadeddata', run, true)
  }
  ro.observe(dock)

  window.addEventListener('resize', run)
  window.visualViewport?.addEventListener('resize', run)
  window.visualViewport?.addEventListener('scroll', run)

  return () => {
    ro.disconnect()
    stage?.removeEventListener('loadedmetadata', run, true)
    stage?.removeEventListener('loadeddata', run, true)
    window.removeEventListener('resize', run)
    window.visualViewport?.removeEventListener('resize', run)
    window.visualViewport?.removeEventListener('scroll', run)
  }
}
