/** Mapeamento de pins com a mesma lógica object-fit: cover / contain. */

export type ImageFitMode = 'cover' | 'contain'

/** Vista idle — contain nítido + fundo cover desfocado (sem barras pretas nem zoom agressivo). */
export const STILL_VIEW_IMAGE_FIT: ImageFitMode = 'contain'

export type CoverRect = {
  dx: number
  dy: number
  dw: number
  dh: number
  viewW: number
  viewH: number
}

export function getImageFitRect(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
  mode: ImageFitMode = 'cover',
): CoverRect | null {
  if (!viewW || !viewH || !imgW || !imgH) return null
  const scale =
    mode === 'contain'
      ? Math.min(viewW / imgW, viewH / imgH)
      : Math.max(viewW / imgW, viewH / imgH)
  const dw = imgW * scale
  const dh = imgH * scale
  return {
    dx: (viewW - dw) / 2,
    dy: (viewH - dh) / 2,
    dw,
    dh,
    viewW,
    viewH,
  }
}

export function getCoverRect(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): CoverRect | null {
  return getImageFitRect(viewW, viewH, imgW, imgH, 'cover')
}

export function getContainRect(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): CoverRect | null {
  return getImageFitRect(viewW, viewH, imgW, imgH, 'contain')
}

/** Mesmo fit das vistas idle no site (canvas + pins + outlines). */
export function getStillViewFitRect(
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
): CoverRect | null {
  return getImageFitRect(viewW, viewH, imgW, imgH, STILL_VIEW_IMAGE_FIT)
}

/** % da imagem (0–100) → % do viewport/stage para posicionar o pin. */
export function imagePctToViewportPct(
  xImg: number,
  yImg: number,
  cover: CoverRect,
): { x: number; y: number } {
  const px = cover.dx + (xImg / 100) * cover.dw
  const py = cover.dy + (yImg / 100) * cover.dh
  return {
    x: (px / cover.viewW) * 100,
    y: (py / cover.viewH) * 100,
  }
}

/** Clique/arraste no stage → % da imagem. */
export function viewportPctToImagePct(
  xVp: number,
  yVp: number,
  cover: CoverRect,
): { x: number; y: number } {
  const px = (xVp / 100) * cover.viewW
  const py = (yVp / 100) * cover.viewH
  return {
    x: ((px - cover.dx) / cover.dw) * 100,
    y: ((py - cover.dy) / cover.dh) * 100,
  }
}

export function clampImagePct(x: number, y: number) {
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
  }
}

/** Pan/zoom da prévia do editor (highlights). */
export type StageViewTransform = {
  zoom: number
  panX: number
  panY: number
  layoutW: number
  layoutH: number
  viewportLeft: number
  viewportTop: number
}

export function isDefaultStageView(view: StageViewTransform | null | undefined): boolean {
  if (!view) return true
  return view.zoom === 1 && view.panX === 0 && view.panY === 0
}

export function clientToLayoutViewportPct(
  clientX: number,
  clientY: number,
  view: StageViewTransform,
): { x: number; y: number } {
  const vx = clientX - view.viewportLeft
  const vy = clientY - view.viewportTop
  const lx = (vx - view.panX) / view.zoom
  const ly = (vy - view.panY) / view.zoom
  return {
    x: (lx / view.layoutW) * 100,
    y: (ly / view.layoutH) * 100,
  }
}

export function layoutViewportPctToClient(
  xVp: number,
  yVp: number,
  view: StageViewTransform,
): { x: number; y: number } {
  const lx = (xVp / 100) * view.layoutW
  const ly = (yVp / 100) * view.layoutH
  return {
    x: view.viewportLeft + view.panX + lx * view.zoom,
    y: view.viewportTop + view.panY + ly * view.zoom,
  }
}

export function pointerToImagePctWithView(
  clientX: number,
  clientY: number,
  imgW: number,
  imgH: number,
  view: StageViewTransform | null,
  fallbackRect: DOMRect,
): { x: number; y: number } | null {
  if (!view || isDefaultStageView(view)) {
    const cover = getStillViewFitRect(fallbackRect.width, fallbackRect.height, imgW, imgH)
    if (!cover) return null
    const xVp = ((clientX - fallbackRect.left) / fallbackRect.width) * 100
    const yVp = ((clientY - fallbackRect.top) / fallbackRect.height) * 100
    const img = viewportPctToImagePct(xVp, yVp, cover)
    return clampImagePct(img.x, img.y)
  }
  const cover = getStillViewFitRect(view.layoutW, view.layoutH, imgW, imgH)
  if (!cover) return null
  const local = clientToLayoutViewportPct(clientX, clientY, view)
  const img = viewportPctToImagePct(local.x, local.y, cover)
  return clampImagePct(img.x, img.y)
}

export function imagePctToLayoutViewportPct(
  xImg: number,
  yImg: number,
  layoutW: number,
  layoutH: number,
  imgW: number,
  imgH: number,
  mode: ImageFitMode = 'cover',
): { x: number; y: number } | null {
  const cover = getImageFitRect(layoutW, layoutH, imgW, imgH, mode)
  if (!cover) return null
  return imagePctToViewportPct(xImg, yImg, cover)
}

export function imagePointToClientPxWithView(
  point: { x: number; y: number },
  imgW: number,
  imgH: number,
  view: StageViewTransform | null,
  fallbackRect: DOMRect,
): { x: number; y: number } | null {
  if (!view || isDefaultStageView(view)) {
    const stage = imagePctToLayoutViewportPct(
      point.x,
      point.y,
      fallbackRect.width,
      fallbackRect.height,
      imgW,
      imgH,
      STILL_VIEW_IMAGE_FIT,
    )
    if (!stage) return null
    return {
      x: fallbackRect.left + (stage.x / 100) * fallbackRect.width,
      y: fallbackRect.top + (stage.y / 100) * fallbackRect.height,
    }
  }
  const stage = imagePctToLayoutViewportPct(
    point.x,
    point.y,
    view.layoutW,
    view.layoutH,
    imgW,
    imgH,
    STILL_VIEW_IMAGE_FIT,
  )
  if (!stage) return null
  return layoutViewportPctToClient(stage.x, stage.y, view)
}

/** Converte coordenadas legadas (% do stage) para % da imagem. */
export function migrateStagePctToImagePct(
  xStage: number,
  yStage: number,
  viewW: number,
  viewH: number,
  imgW: number,
  imgH: number,
  mode: ImageFitMode = STILL_VIEW_IMAGE_FIT,
): { x: number; y: number } | null {
  const cover = getImageFitRect(viewW, viewH, imgW, imgH, mode)
  if (!cover) return null
  return viewportPctToImagePct(xStage, yStage, cover)
}
