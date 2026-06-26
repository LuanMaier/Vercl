import {
  clampImagePct,
  getStillViewFitRect,
  imagePctToViewportPct,
  viewportPctToImagePct,
} from './coverCoords'
import type { PoiDefinition } from './types'

export function isImageCoordSpace(poi: PoiDefinition) {
  return poi.coordSpace === 'image'
}

export function ensureImageCoordSpace(
  poi: PoiDefinition,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
  options?: { legacyCenterAnchor?: boolean },
): boolean {
  if (isImageCoordSpace(poi)) return false
  const cover = getStillViewFitRect(viewW, viewH, imgW, imgH)
  if (!cover) return false

  let xVp = poi.x
  let yVp = poi.y
  if (options?.legacyCenterAnchor) {
    const centerToBottomPx = 18
    yVp = (((poi.y / 100) * viewH + centerToBottomPx) / viewH) * 100
  }

  const migrated = viewportPctToImagePct(xVp, yVp, cover)
  const clamped = clampImagePct(migrated.x, migrated.y)
  poi.x = Math.round(clamped.x * 10) / 10
  poi.y = Math.round(clamped.y * 10) / 10
  poi.coordSpace = 'image'
  return true
}

export function pinViewportPosition(
  poi: PoiDefinition,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  const cover = getStillViewFitRect(viewW, viewH, imgW, imgH)
  if (!cover) return null
  const xImg = isImageCoordSpace(poi) ? poi.x : poi.x
  const yImg = isImageCoordSpace(poi) ? poi.y : poi.y
  return imagePctToViewportPct(xImg, yImg, cover)
}

export function pointerToImagePct(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  const cover = getStillViewFitRect(stageRect.width, stageRect.height, imgW, imgH)
  if (!cover) return null
  const xVp = ((clientX - stageRect.left) / stageRect.width) * 100
  const yVp = ((clientY - stageRect.top) / stageRect.height) * 100
  const { x, y } = viewportPctToImagePct(xVp, yVp, cover)
  return clampImagePct(x, y)
}

export function imagePctToStagePct(
  xImg: number,
  yImg: number,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  const cover = getStillViewFitRect(viewW, viewH, imgW, imgH)
  if (!cover) return null
  return imagePctToViewportPct(xImg, yImg, cover)
}

/** Distância (px no cover) da âncora inferior legada ao centro do quadrado. */
export const APT_HIGHLIGHT_CENTER_OFFSET_PX = 23

function centerYOffsetImagePct(coverHeight: number, offsetPx = APT_HIGHLIGHT_CENTER_OFFSET_PX) {
  return (offsetPx / coverHeight) * 100
}

/** Converte posição legada (ponta inferior) para centro do quadrado. */
export function migrateAptHighlightToCenterAnchor(
  poi: PoiDefinition,
  cover: { dh: number },
): boolean {
  if (poi.highlightAnchor === 'center') return false
  if (poi.coordSpace !== 'image') return false
  const dy = centerYOffsetImagePct(cover.dh)
  poi.y = Math.round((poi.y - dy) * 10) / 10
  poi.highlightAnchor = 'center'
  return true
}

/** Âncora inferior (legado) → centro do quadrado em %. */
export function aptPinAnchorToCenter(
  x: number,
  y: number,
  cover: { dh: number },
  offsetPx = APT_HIGHLIGHT_CENTER_OFFSET_PX,
): { cx: number; cy: number } {
  const dy = centerYOffsetImagePct(cover.dh, offsetPx)
  return { cx: x, cy: y - dy }
}

/** Centro visual do highlight → âncora inferior (poi x/y) em %. */
export function aptPinCenterToAnchor(
  cx: number,
  cy: number,
  cover: { dh: number },
  offsetPx = APT_HIGHLIGHT_CENTER_OFFSET_PX,
): { x: number; y: number } {
  const dy = centerYOffsetImagePct(cover.dh, offsetPx)
  return { x: cx, y: cy + dy }
}

/** Mede no DOM a distância da âncora inferior ao centro do .edit-pin-dot. */
export function measureAptPinCenterOffsetPx(el: HTMLElement): number {
  const dot = el.querySelector('.edit-pin-dot')
  if (!dot) return APT_HIGHLIGHT_CENTER_OFFSET_PX
  const elRect = el.getBoundingClientRect()
  const dotRect = dot.getBoundingClientRect()
  return elRect.bottom - (dotRect.top + dotRect.height / 2)
}
