import { getHeroRef } from '../config/heroConfig'
import { getLightPoster } from '../config/lighting'
import { getProjectSolarFrameInitial } from '../config/projectMedia'
import { POSTERS } from '../config/posters'
import { getViewLoopConfig } from '../config/viewLoops'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { isPanoramaView } from './panoramaFade'
import {
  getImageFitRect,
  imagePctToViewportPct,
  migrateStagePctToImagePct,
  STILL_VIEW_IMAGE_FIT,
  viewportPctToImagePct,
  clampImagePct,
} from './coverCoords'
import { resolveMediaPath } from './paths'
import type { LightMode, PoiDefinition } from './types'

export function isPanoramaImageCoordSpace(poi: PoiDefinition) {
  return poi.coordSpace === 'image'
}

export function pointerToPanoramaImagePct(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  const cover = getImageFitRect(stageRect.width, stageRect.height, imgW, imgH, STILL_VIEW_IMAGE_FIT)
  if (!cover) return null
  const xVp = ((clientX - stageRect.left) / stageRect.width) * 100
  const yVp = ((clientY - stageRect.top) / stageRect.height) * 100
  const { x, y } = viewportPctToImagePct(xVp, yVp, cover)
  return clampImagePct(x, y)
}

export function panoramaPinStagePct(
  poi: PoiDefinition,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  const cover = getImageFitRect(viewW, viewH, imgW, imgH, STILL_VIEW_IMAGE_FIT)
  if (!cover) return null
  if (isPanoramaImageCoordSpace(poi)) {
    return imagePctToViewportPct(poi.x, poi.y, cover)
  }
  return { x: poi.x, y: poi.y }
}

export function migratePanoramaPinToImageCoords(
  poi: PoiDefinition,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): boolean {
  if (isPanoramaImageCoordSpace(poi)) return false
  const migrated = migrateStagePctToImagePct(
    poi.x,
    poi.y,
    viewW,
    viewH,
    imgW,
    imgH,
    STILL_VIEW_IMAGE_FIT,
  )
  if (!migrated) return false
  poi.x = Math.round(migrated.x * 10) / 10
  poi.y = Math.round(migrated.y * 10) / 10
  poi.coordSpace = 'image'
  return true
}

export async function resolveViewStillPosterSrc(
  viewIndex: number,
  light: LightMode,
): Promise<string | undefined> {
  const ref = isPanoramaView(viewIndex)
    ? (getProjectSolarFrameInitial(viewIndex) ?? getHeroRef(viewIndex) ?? POSTERS[viewIndex])
    : (getLightPoster(viewIndex, light) ?? getHeroRef(viewIndex) ?? POSTERS[viewIndex])
  if (!ref) return undefined
  return (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
}

/** Proporção padrão dos renders (fallback se poster/vídeo não carregar). */
export const DEFAULT_VIEW_MEDIA_METRICS = { w: 1928, h: 1072 }

export function loadVideoMetrics(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    const done = (metrics: { w: number; h: number } | null) => {
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      resolve(metrics)
    }

    video.onloadedmetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        done({ w: video.videoWidth, h: video.videoHeight })
      } else {
        done(null)
      }
    }
    video.onerror = () => done(null)
    video.src = src
  })
}

/** Poster → loop da vista → proporção padrão. */
export async function resolveViewMediaMetrics(
  viewIndex: number,
  light: LightMode,
  liveVideo?: { w: number; h: number } | null,
): Promise<{ w: number; h: number }> {
  if (liveVideo) return liveVideo

  const posterSrc = await resolveViewStillPosterSrc(viewIndex, light)
  if (posterSrc) {
    const poster = await loadPosterImageMetrics(posterSrc)
    if (poster) return poster
  }

  const loop = getViewLoopConfig(viewIndex)
  if (loop?.src) {
    const loopSrc = (await resolveMediaSrc(loop.src)) ?? resolveMediaPath(loop.src)
    if (loopSrc) {
      const video = await loadVideoMetrics(loopSrc)
      if (video) return video
    }
  }

  return DEFAULT_VIEW_MEDIA_METRICS
}

export function loadPosterImageMetrics(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const finish = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        resolve({ w: img.naturalWidth, h: img.naturalHeight })
      } else {
        resolve(null)
      }
    }
    img.onload = () => {
      void img.decode?.().then(finish).catch(finish)
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}
