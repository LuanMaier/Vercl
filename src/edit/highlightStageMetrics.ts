import {
  imagePctToLayoutViewportPct,
  pointerToImagePctWithView,
  STILL_VIEW_IMAGE_FIT,
  type StageViewTransform,
} from '../core/coverCoords'
import type { OutlinePoint } from '../config/apartmentOutlinesConfig'
import {
  imagePointToStagePct,
  outlineToSvgPointsAttr,
} from '../core/apartmentOutlineGeometry'

export type HighlightStageMetrics = {
  rect: DOMRect
  view: StageViewTransform | null
  stageW: number
  stageH: number
  imgW: number
  imgH: number
}

export function resolveHighlightStageMetrics(
  img: HTMLImageElement | null,
  getView: () => StageViewTransform | null,
  stageEl: HTMLElement,
): HighlightStageMetrics | null {
  if (!img?.naturalWidth || !img.naturalHeight) return null
  const viewport = document.getElementById('edit-stage-viewport')
  const vpRect = (viewport ?? stageEl).getBoundingClientRect()
  if (!vpRect.width || !vpRect.height) return null

  const rawView = getView()
  const stageW = rawView?.layoutW ?? vpRect.width
  const stageH = rawView?.layoutH ?? vpRect.height
  const view = rawView
    ? {
        ...rawView,
        layoutW: stageW,
        layoutH: stageH,
        viewportLeft: vpRect.left,
        viewportTop: vpRect.top,
      }
    : null

  return {
    rect: new DOMRect(vpRect.left, vpRect.top, stageW, stageH),
    view,
    stageW,
    stageH,
    imgW: img.naturalWidth,
    imgH: img.naturalHeight,
  }
}

export function pointerToHighlightImagePoint(
  clientX: number,
  clientY: number,
  metrics: HighlightStageMetrics,
): OutlinePoint | null {
  const raw = pointerToImagePctWithView(
    clientX,
    clientY,
    metrics.imgW,
    metrics.imgH,
    metrics.view,
    metrics.rect,
  )
  if (!raw) return null
  return { x: raw.x, y: raw.y }
}

export function highlightImageToStagePct(
  xImg: number,
  yImg: number,
  metrics: HighlightStageMetrics,
): { x: number; y: number } | null {
  return imagePctToLayoutViewportPct(
    xImg,
    yImg,
    metrics.stageW,
    metrics.stageH,
    metrics.imgW,
    metrics.imgH,
    STILL_VIEW_IMAGE_FIT,
  )
}

export function outlinePointsToSvgAttr(
  points: OutlinePoint[],
  metrics: HighlightStageMetrics,
): string {
  return outlineToSvgPointsAttr(
    points,
    metrics.stageW,
    metrics.stageH,
    metrics.imgW,
    metrics.imgH,
  )
}

export function outlinePointToSvgXY(
  point: OutlinePoint,
  metrics: HighlightStageMetrics,
): { x: string; y: string } | null {
  const stage = imagePointToStagePct(
    point,
    metrics.stageW,
    metrics.stageH,
    metrics.imgW,
    metrics.imgH,
  )
  if (!stage) return null
  return { x: String(stage.x), y: String(stage.y) }
}
