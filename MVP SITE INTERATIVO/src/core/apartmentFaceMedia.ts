/** Métricas da face da unidade — imagem ou vídeo (dimensões do quadro). */

import { apartmentMediaKey } from '../config/apartments'
import {
  ensureAptMainPage,
  getApartmentItem,
  resolveApartmentPageMediaPath,
  withAptMainPageOnly,
} from '../config/apartmentPages'
import { getProjectApartmentLoopVideoPath } from '../config/projectMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { resolveMediaPath } from './paths'

export type ApartmentFaceDimensions = {
  w: number
  h: number
  url: string
}

function loadVideoElement(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const finish = (result: HTMLVideoElement | null) => {
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      resolve(result)
    }
    const ready = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null)
        return
      }
      finish(video)
    }
    video.onerror = () => finish(null)
    video.onseeked = () => ready()
    video.onloadeddata = () => {
      if (video.currentTime > 0) {
        ready()
        return
      }
      try {
        video.currentTime = 0.01
      } catch {
        ready()
      }
    }
    video.src = url
    video.load()
  })
}

export async function loadVideoDimensions(url: string): Promise<ApartmentFaceDimensions | null> {
  const video = await loadVideoElement(url)
  if (!video?.videoWidth || !video.videoHeight) return null
  return { w: video.videoWidth, h: video.videoHeight, url }
}

/** Primeiro frame do vídeo — para prévia de highlights no editor (camada img). */
export async function captureVideoPosterObjectUrl(url: string): Promise<string | null> {
  const video = await loadVideoElement(url)
  if (!video?.videoWidth || !video.videoHeight) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

export function loadImageDimensions(url: string): Promise<ApartmentFaceDimensions | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        resolve(null)
        return
      }
      resolve({ w: img.naturalWidth, h: img.naturalHeight, url })
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export async function resolveMediaDimensions(
  url: string,
  kind: 'image' | 'video',
): Promise<ApartmentFaceDimensions | null> {
  return kind === 'video' ? loadVideoDimensions(url) : loadImageDimensions(url)
}

export async function resolveApartmentFaceDimensions(
  aptId: string,
): Promise<ApartmentFaceDimensions | null> {
  const item = getApartmentItem(aptId)
  if (!item) return null
  const apt = withAptMainPageOnly(item)
  const page = ensureAptMainPage(apt)

  if (page.type === 'video') {
    const mediaRef = resolveApartmentPageMediaPath(aptId, page)
    if (!mediaRef) return null
    const url = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)
    if (!url) return null
    return loadVideoDimensions(url)
  }

  if (page.type === 'loop') {
    const posterRef = resolveApartmentPageMediaPath(aptId, page)
    if (posterRef) {
      const url = (await resolveMediaSrc(posterRef)) ?? resolveMediaPath(posterRef)
      if (url) return loadImageDimensions(url)
    }
    const loopPath = getProjectApartmentLoopVideoPath(apartmentMediaKey(aptId, page.id))
    if (loopPath) {
      const url = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
      if (url) return loadVideoDimensions(url)
    }
    return null
  }

  const mediaRef = resolveApartmentPageMediaPath(aptId, page)
  if (!mediaRef) return null
  const url = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)
  if (!url) return null
  return loadImageDimensions(url)
}
