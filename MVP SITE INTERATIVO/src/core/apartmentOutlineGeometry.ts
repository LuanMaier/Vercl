import {
  clampImagePct,
  getStillViewFitRect,
  imagePctToLayoutViewportPct,
  imagePctToViewportPct,
  isDefaultStageView,
  layoutViewportPctToClient,
  pointerToImagePctWithView,
  STILL_VIEW_IMAGE_FIT,
  type CoverRect,
  type StageViewTransform,
} from './coverCoords'
import type { OutlinePoint } from '../config/apartmentOutlinesConfig'

export function roundOutlineCoord(n: number) {
  return Math.round(n * 10) / 10
}

export function getStageCoverMetrics(
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): CoverRect | null {
  return getStillViewFitRect(stageW, stageH, imgW, imgH)
}

export function imagePointToStagePct(
  point: OutlinePoint,
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): OutlinePoint | null {
  const cover = getStillViewFitRect(stageW, stageH, imgW, imgH)
  if (!cover) return null
  return imagePctToViewportPct(point.x, point.y, cover)
}

export function stagePctToImagePoint(
  xStage: number,
  yStage: number,
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): OutlinePoint | null {
  const cover = getStillViewFitRect(stageW, stageH, imgW, imgH)
  if (!cover) return null
  const px = (xStage / 100) * cover.viewW
  const py = (yStage / 100) * cover.viewH
  const raw = {
    x: ((px - cover.dx) / cover.dw) * 100,
    y: ((py - cover.dy) / cover.dh) * 100,
  }
  const clamped = clampImagePct(raw.x, raw.y)
  return {
    x: roundOutlineCoord(clamped.x),
    y: roundOutlineCoord(clamped.y),
  }
}

export function pointerToImagePoint(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  view?: StageViewTransform | null,
): OutlinePoint | null {
  const raw = pointerToImagePctWithView(clientX, clientY, imgW, imgH, view ?? null, stageRect)
  if (!raw) return null
  return { x: roundOutlineCoord(raw.x), y: roundOutlineCoord(raw.y) }
}

export function outlineToSvgPointsAttr(
  points: OutlinePoint[],
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): string {
  const parts: string[] = []
  for (const p of points) {
    const stage = imagePointToStagePct(p, stageW, stageH, imgW, imgH)
    if (!stage) continue
    parts.push(`${roundOutlineCoord(stage.x)},${roundOutlineCoord(stage.y)}`)
  }
  return parts.join(' ')
}

export function offsetOutlinePoints(
  points: OutlinePoint[],
  dx: number,
  dy: number,
): OutlinePoint[] {
  return points.map((p) => {
    const c = clampImagePct(p.x + dx, p.y + dy)
    return { x: roundOutlineCoord(c.x), y: roundOutlineCoord(c.y) }
  })
}

export function cloneOutlinePoints(points: OutlinePoint[]): OutlinePoint[] {
  return points.map((p) => ({ x: p.x, y: p.y }))
}

/** Default half-size (% of image) for auto rectangle on new highlight. */
export const HIGHLIGHT_RECT_HALF_W = 2.2
export const HIGHLIGHT_RECT_HALF_H = 1.6
/** Novos highlights nascem 25% maiores — evita estado visual quebrado ao selecionar. */
export const HIGHLIGHT_RECT_CREATE_SCALE = 1.25

export function rectOutlineAround(
  cx: number,
  cy: number,
  halfW = HIGHLIGHT_RECT_HALF_W,
  halfH = HIGHLIGHT_RECT_HALF_H,
): OutlinePoint[] {
  const tl = clampImagePct(cx - halfW, cy - halfH)
  const tr = clampImagePct(cx + halfW, cy - halfH)
  const br = clampImagePct(cx + halfW, cy + halfH)
  const bl = clampImagePct(cx - halfW, cy + halfH)
  return [
    { x: roundOutlineCoord(tl.x), y: roundOutlineCoord(tl.y) },
    { x: roundOutlineCoord(tr.x), y: roundOutlineCoord(tr.y) },
    { x: roundOutlineCoord(br.x), y: roundOutlineCoord(br.y) },
    { x: roundOutlineCoord(bl.x), y: roundOutlineCoord(bl.y) },
  ]
}

export function outlineCentroid(points: OutlinePoint[]): OutlinePoint {
  if (!points.length) return { x: 50, y: 50 }
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  return {
    x: roundOutlineCoord(sx / points.length),
    y: roundOutlineCoord(sy / points.length),
  }
}

export function translateOutlinePoints(
  points: OutlinePoint[],
  dx: number,
  dy: number,
): OutlinePoint[] {
  return offsetOutlinePoints(points, dx, dy)
}

function distPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number; x: number; y: number } {
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  if (lenSq < 1e-9) {
    const d = Math.hypot(px - ax, py - ay)
    return { dist: d, t: 0, x: ax, y: ay }
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * abx
  const y = ay + t * aby
  return { dist: Math.hypot(px - x, py - y), t, x, y }
}

/** Nearest edge within threshold (image % units). */
export function closestOutlineEdgeHit(
  click: OutlinePoint,
  points: OutlinePoint[],
  thresholdPct: number,
): { edgeIndex: number; insertPoint: OutlinePoint } | null {
  if (points.length < 2) return null
  let best: { edgeIndex: number; insertPoint: OutlinePoint; dist: number } | null = null
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const hit = distPointToSegment(click.x, click.y, a.x, a.y, b.x, b.y)
    if (hit.dist <= thresholdPct && (!best || hit.dist < best.dist)) {
      const c = clampImagePct(hit.x, hit.y)
      best = {
        edgeIndex: i,
        insertPoint: { x: roundOutlineCoord(c.x), y: roundOutlineCoord(c.y) },
        dist: hit.dist,
      }
    }
  }
  return best ? { edgeIndex: best.edgeIndex, insertPoint: best.insertPoint } : null
}

/** ~8px at typical cover width → image % threshold. */
export function edgeHitThresholdPct(coverWidthPx: number, px = 8): number {
  return (px / Math.max(coverWidthPx, 1)) * 100
}

export function pointInPolygon(point: OutlinePoint, polygon: OutlinePoint[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Edge insert only on stroke hit — not on center/interior of the highlight. */
export function outlineEdgeInsertHit(
  click: OutlinePoint,
  points: OutlinePoint[],
  coverWidthPx: number,
): { edgeIndex: number; insertPoint: OutlinePoint } | null {
  if (points.length < 2) return null
  const threshold = edgeHitThresholdPct(coverWidthPx, 6)
  const hit = closestOutlineEdgeHit(click, points, threshold)
  if (!hit) return null

  const centroid = outlineCentroid(points)
  const distCentroid = Math.hypot(click.x - centroid.x, click.y - centroid.y)
  if (distCentroid < 1.05) return null

  if (pointInPolygon(click, points)) {
    let minEdgeDist = Infinity
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const seg = distPointToSegment(click.x, click.y, a.x, a.y, b.x, b.y)
      if (seg.dist < minEdgeDist) minEdgeDist = seg.dist
    }
    if (minEdgeDist > threshold * 0.85) return null
  }

  return hit
}

export function imagePointToClientPx(
  point: OutlinePoint,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  view?: StageViewTransform | null,
): { x: number; y: number } | null {
  if (!view || isDefaultStageView(view)) {
    const stage = imagePctToLayoutViewportPct(
      point.x,
      point.y,
      stageRect.width,
      stageRect.height,
      imgW,
      imgH,
      STILL_VIEW_IMAGE_FIT,
    )
    if (!stage) return null
    return {
      x: stageRect.left + (stage.x / 100) * stageRect.width,
      y: stageRect.top + (stage.y / 100) * stageRect.height,
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

/** Hard snap — vertex locks to peer when pointer is this close (px). */
export const OUTLINE_VERTEX_SNAP_ALIGN_PX = 4
/** Outer edge of soft magnet band (px). */
export const OUTLINE_VERTEX_SNAP_MAGNET_PX = 8

export function outlineBBox(points: OutlinePoint[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, maxX, minY, maxY }
}

/** Garante pontos válidos (0–100) e recupera retângulos degenerados/corrompidos. */
export function sanitizeOutlinePoints(points: OutlinePoint[]): OutlinePoint[] {
  if (points.length < 3) return points
  const clamped = points.map((p) => {
    const c = clampImagePct(p.x, p.y)
    return { x: roundOutlineCoord(c.x), y: roundOutlineCoord(c.y) }
  })
  const bb = outlineBBox(clamped)
  const spanX = bb.maxX - bb.minX
  const spanY = bb.maxY - bb.minY
  if (spanX < 0.3 || spanY < 0.3 || spanX > 40 || spanY > 40) {
    const c = outlineCentroid(clamped)
    return rectOutlineAround(c.x, c.y)
  }
  return clamped
}

export type OutlineEdgeHandle = 'top' | 'bottom' | 'left' | 'right'

export function outlineEdgeHandleCenters(points: OutlinePoint[]): Record<OutlineEdgeHandle, OutlinePoint> {
  const bb = outlineBBox(points)
  const cx = (bb.minX + bb.maxX) / 2
  const cy = (bb.minY + bb.maxY) / 2
  return {
    top: { x: cx, y: bb.minY },
    bottom: { x: cx, y: bb.maxY },
    left: { x: bb.minX, y: cy },
    right: { x: bb.maxX, y: cy },
  }
}

export const OUTLINE_MIN_SPAN = 0.8

function rectPointsFromBBox(minX: number, minY: number, maxX: number, maxY: number): OutlinePoint[] {
  const tl = clampImagePct(minX, minY)
  const tr = clampImagePct(maxX, minY)
  const br = clampImagePct(maxX, maxY)
  const bl = clampImagePct(minX, maxY)
  return [
    { x: roundOutlineCoord(tl.x), y: roundOutlineCoord(tl.y) },
    { x: roundOutlineCoord(tr.x), y: roundOutlineCoord(tr.y) },
    { x: roundOutlineCoord(br.x), y: roundOutlineCoord(br.y) },
    { x: roundOutlineCoord(bl.x), y: roundOutlineCoord(bl.y) },
  ]
}

export type OutlineCornerIndex = 0 | 1 | 2 | 3

/** Arrasta um canto do retângulo — mantém o canto oposto fixo (sempre 4 pontos TL→TR→BR→BL). */
export function resizeOutlineByCorner(
  anchor: { minX: number; minY: number; maxX: number; maxY: number },
  cornerIndex: number,
  pointer: OutlinePoint,
  minSpan = OUTLINE_MIN_SPAN,
): OutlinePoint[] {
  let { minX, maxX, minY, maxY } = anchor
  const x = roundOutlineCoord(Math.max(0, Math.min(100, pointer.x)))
  const y = roundOutlineCoord(Math.max(0, Math.min(100, pointer.y)))
  const corner = ((cornerIndex % 4) + 4) % 4
  switch (corner) {
    case 0:
      minX = roundOutlineCoord(Math.min(x, maxX - minSpan))
      minY = roundOutlineCoord(Math.min(y, maxY - minSpan))
      break
    case 1:
      maxX = roundOutlineCoord(Math.max(x, minX + minSpan))
      minY = roundOutlineCoord(Math.min(y, maxY - minSpan))
      break
    case 2:
      maxX = roundOutlineCoord(Math.max(x, minX + minSpan))
      maxY = roundOutlineCoord(Math.max(y, minY + minSpan))
      break
    case 3:
      minX = roundOutlineCoord(Math.min(x, maxX - minSpan))
      maxY = roundOutlineCoord(Math.max(y, minY + minSpan))
      break
  }
  return rectPointsFromBBox(minX, minY, maxX, maxY)
}

export function rectOutlineFromPoints(points: OutlinePoint[]): OutlinePoint[] {
  const bb = outlineBBox(points)
  return rectPointsFromBBox(bb.minX, bb.minY, bb.maxX, bb.maxY)
}

/** Redimensiona pelo centro de uma borda (topo/base/esquerda/direita). */
export function resizeOutlineByEdge(
  points: OutlinePoint[],
  edge: OutlineEdgeHandle,
  pointer: OutlinePoint,
  minSpan = OUTLINE_MIN_SPAN,
): OutlinePoint[] {
  const bb = outlineBBox(points)
  let { minX, maxX, minY, maxY } = bb
  const x = roundOutlineCoord(Math.max(0, Math.min(100, pointer.x)))
  const y = roundOutlineCoord(Math.max(0, Math.min(100, pointer.y)))
  switch (edge) {
    case 'top':
      minY = roundOutlineCoord(Math.min(y, maxY - minSpan))
      break
    case 'bottom':
      maxY = roundOutlineCoord(Math.max(y, minY + minSpan))
      break
    case 'left':
      minX = roundOutlineCoord(Math.min(x, maxX - minSpan))
      break
    case 'right':
      maxX = roundOutlineCoord(Math.max(x, minX + minSpan))
      break
  }
  return rectPointsFromBBox(minX, minY, maxX, maxY)
}

export type OutlineEdgeResizeSnapResult = {
  point: OutlinePoint
  guideX: number | null
  guideY: number | null
}

/** Ponto efetivo ao redimensionar uma borda — trava o eixo perpendicular. */
export function outlineEdgeResizePointer(
  edge: OutlineEdgeHandle,
  buffer: OutlinePoint[],
  raw: OutlinePoint,
): OutlinePoint {
  const bb = outlineBBox(buffer)
  const cx = roundOutlineCoord((bb.minX + bb.maxX) / 2)
  const cy = roundOutlineCoord((bb.minY + bb.maxY) / 2)
  if (edge === 'top' || edge === 'bottom') {
    return { x: cx, y: raw.y }
  }
  return { x: raw.x, y: cy }
}

function collectEdgeResizeSnapScalars(
  edge: OutlineEdgeHandle,
  peerPointsList: OutlinePoint[][],
): number[] {
  const vals = new Set<number>()
  for (const peer of peerPointsList) {
    if (peer.length < 3) continue
    const bb = outlineBBox(peer)
    if (edge === 'top' || edge === 'bottom') {
      vals.add(bb.minY)
      vals.add(bb.maxY)
    } else {
      vals.add(bb.minX)
      vals.add(bb.maxX)
    }
  }
  return [...vals]
}

function snapImageScalarToPeers(
  raw: number,
  clientCoord: number,
  peerValues: number[],
  axis: 'x' | 'y',
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  alignPx: number,
  magnetPx: number,
  view?: StageViewTransform | null,
): { value: number; guide: number | null } {
  const peers: { image: number; client: number }[] = []
  for (const v of peerValues) {
    const pt = axis === 'x' ? { x: v, y: 50 } : { x: 50, y: v }
    const px = imagePointToClientPx(pt, stageRect, imgW, imgH, view)
    if (!px) continue
    peers.push({ image: v, client: axis === 'x' ? px.x : px.y })
  }
  const snapped = snapScalarAxis(raw, clientCoord, peers, alignPx, magnetPx)
  return { value: snapped.image, guide: snapped.guide }
}

/** Snap ao arrastar barra lateral (só move um eixo). */
export function resolveOutlineEdgeResizePointer(
  edge: OutlineEdgeHandle,
  clientX: number,
  clientY: number,
  raw: OutlinePoint,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  peerPointsList: OutlinePoint[][],
  opts?: { view?: StageViewTransform | null; alignPx?: number; magnetPx?: number },
): OutlineEdgeResizeSnapResult {
  const zoom = opts?.view?.zoom ?? 1
  const alignPx = (opts?.alignPx ?? OUTLINE_VERTEX_SNAP_ALIGN_PX) / Math.max(zoom, 1)
  const magnetPx = (opts?.magnetPx ?? OUTLINE_VERTEX_SNAP_MAGNET_PX) / Math.max(zoom, 1)
  const snapScalars = collectEdgeResizeSnapScalars(edge, peerPointsList)

  if (edge === 'top' || edge === 'bottom') {
    const snappedY = snapImageScalarToPeers(
      raw.y,
      clientY,
      snapScalars,
      'y',
      stageRect,
      imgW,
      imgH,
      alignPx,
      magnetPx,
      opts?.view,
    )
    return {
      point: { x: roundOutlineCoord(raw.x), y: snappedY.value },
      guideX: null,
      guideY: snappedY.guide,
    }
  }

  const snappedX = snapImageScalarToPeers(
    raw.x,
    clientX,
    snapScalars,
    'x',
    stageRect,
    imgW,
    imgH,
    alignPx,
    magnetPx,
    opts?.view,
  )
  return {
    point: { x: snappedX.value, y: roundOutlineCoord(raw.y) },
    guideX: snappedX.guide,
    guideY: null,
  }
}

export type OutlineBodySnapResult = {
  points: OutlinePoint[]
  guideX: number | null
  guideY: number | null
}

/** Hard snap — retângulo encaixa nesta distância (px). */
export const OUTLINE_BODY_SNAP_ALIGN_PX = 6
/** Borda externa da zona magnética ao arrastar o corpo (px). */
export const OUTLINE_BODY_SNAP_MAGNET_PX = 14

function collectRectSnapAxes(peerPointsList: OutlinePoint[][]): { xs: number[]; ys: number[] } {
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (const peer of peerPointsList) {
    if (peer.length < 3) continue
    const bb = outlineBBox(peer)
    xs.add(bb.minX)
    xs.add(bb.maxX)
    ys.add(bb.minY)
    ys.add(bb.maxY)
    for (const p of peer) {
      xs.add(p.x)
      ys.add(p.y)
    }
  }
  return { xs: [...xs], ys: [...ys] }
}

function bestEdgeSnapDelta(
  edgeValue: number,
  peerValues: number[],
  axis: 'x' | 'y',
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  alignPx: number,
  magnetPx: number,
  view?: StageViewTransform | null,
): { delta: number; dist: number; guide: number | null } {
  const layoutW = view?.layoutW ?? stageRect.width
  const layoutH = view?.layoutH ?? stageRect.height
  const cover = getStillViewFitRect(layoutW, layoutH, imgW, imgH)
  if (!cover) return { delta: 0, dist: Infinity, guide: null }
  const zoom = view?.zoom ?? 1

  let best: { delta: number; dist: number; guide: number } | null = null
  for (const peer of peerValues) {
    const delta = peer - edgeValue
    const spanPx = axis === 'x' ? cover.dw : cover.dh
    const distPx = Math.abs((delta / 100) * spanPx * zoom)
    if (distPx > magnetPx) continue
    if (!best || distPx < best.dist) {
      best = { delta, dist: distPx, guide: peer }
    }
  }
  if (!best) return { delta: 0, dist: Infinity, guide: null }

  if (best.dist <= alignPx) {
    return { delta: best.delta, dist: best.dist, guide: best.guide }
  }

  const span = magnetPx - alignPx
  const t = Math.max(0, 1 - (best.dist - alignPx) / span)
  const pull = t * t * 0.45
  if (pull < 0.3) return { delta: 0, dist: best.dist, guide: null }
  return {
    delta: best.delta * pull,
    dist: best.dist,
    guide: best.guide,
  }
}

/** Alinha bordas/vértices do retângulo arrastado aos demais highlights da face. */
export function resolveOutlineBodySnap(
  translatedPoints: OutlinePoint[],
  peerPointsList: OutlinePoint[][],
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  opts?: { alignPx?: number; magnetPx?: number; view?: StageViewTransform | null },
): OutlineBodySnapResult {
  const zoom = opts?.view?.zoom ?? 1
  const alignPx = (opts?.alignPx ?? OUTLINE_BODY_SNAP_ALIGN_PX) / Math.max(zoom, 1)
  const magnetPx = (opts?.magnetPx ?? OUTLINE_BODY_SNAP_MAGNET_PX) / Math.max(zoom, 1)

  if (!translatedPoints.length || !peerPointsList.length) {
    return { points: translatedPoints, guideX: null, guideY: null }
  }

  const { xs, ys } = collectRectSnapAxes(peerPointsList)
  if (!xs.length && !ys.length) {
    return { points: translatedPoints, guideX: null, guideY: null }
  }

  const bb = outlineBBox(translatedPoints)

  let dx = 0
  let guideX: number | null = null
  let bestXDist = Infinity
  for (const edge of [bb.minX, bb.maxX]) {
    const snap = bestEdgeSnapDelta(edge, xs, 'x', stageRect, imgW, imgH, alignPx, magnetPx, opts?.view)
    if (snap.dist < bestXDist) {
      bestXDist = snap.dist
      dx = snap.delta
      guideX = snap.guide
    }
  }

  let dy = 0
  let guideY: number | null = null
  let bestYDist = Infinity
  for (const edge of [bb.minY, bb.maxY]) {
    const snap = bestEdgeSnapDelta(edge, ys, 'y', stageRect, imgW, imgH, alignPx, magnetPx, opts?.view)
    if (snap.dist < bestYDist) {
      bestYDist = snap.dist
      dy = snap.delta
      guideY = snap.guide
    }
  }

  if (dx === 0 && dy === 0) {
    return { points: translatedPoints, guideX: null, guideY: null }
  }

  return {
    points: translateOutlinePoints(translatedPoints, dx, dy),
    guideX,
    guideY,
  }
}

export type OutlineVertexSnapResult = {
  point: OutlinePoint
  guideX: number | null
  guideY: number | null
  snappedCorner: OutlinePoint | null
}

function snapScalarAxis(
  rawImage: number,
  pointerClient: number,
  peers: { image: number; client: number }[],
  alignPx: number,
  magnetPx: number,
): { image: number; guide: number | null } {
  let best: { image: number; dist: number } | null = null
  for (const peer of peers) {
    const d = Math.abs(peer.client - pointerClient)
    if (d <= magnetPx && (!best || d < best.dist)) {
      best = { image: peer.image, dist: d }
    }
  }
  if (!best) return { image: roundOutlineCoord(rawImage), guide: null }
  if (best.dist <= alignPx) {
    return { image: roundOutlineCoord(best.image), guide: best.image }
  }
  const span = magnetPx - alignPx
  const t = Math.max(0, 1 - (best.dist - alignPx) / span)
  const pull = t * t * 0.4
  if (pull < 0.35) return { image: roundOutlineCoord(rawImage), guide: null }
  return {
    image: roundOutlineCoord(rawImage + (best.image - rawImage) * pull),
    guide: best.image,
  }
}

/** Snap vertex to peer X/Y columns and rows (precise for rectangular facades). */
export function resolveOutlineVertexSnap(
  clientX: number,
  clientY: number,
  raw: OutlinePoint,
  stageRect: DOMRect,
  imgW: number,
  imgH: number,
  targets: OutlinePoint[],
  opts?: { alignPx?: number; magnetPx?: number; view?: StageViewTransform | null },
): OutlineVertexSnapResult {
  const zoom = opts?.view?.zoom ?? 1
  const alignPx = (opts?.alignPx ?? OUTLINE_VERTEX_SNAP_ALIGN_PX) / Math.max(zoom, 1)
  const magnetPx = (opts?.magnetPx ?? OUTLINE_VERTEX_SNAP_MAGNET_PX) / Math.max(zoom, 1)
  const view = opts?.view ?? null
  const free = { x: roundOutlineCoord(raw.x), y: roundOutlineCoord(raw.y) }

  if (!targets.length || !imgW || !imgH) {
    return { point: free, guideX: null, guideY: null, snappedCorner: null }
  }

  const xPeers: { image: number; client: number }[] = []
  const yPeers: { image: number; client: number }[] = []
  let cornerMatch: { p: OutlinePoint; dist: number } | null = null

  for (const p of targets) {
    const px = imagePointToClientPx(p, stageRect, imgW, imgH, view)
    if (!px) continue
    xPeers.push({ image: p.x, client: px.x })
    yPeers.push({ image: p.y, client: px.y })
    const d = Math.hypot(px.x - clientX, px.y - clientY)
    if (d <= magnetPx && (!cornerMatch || d < cornerMatch.dist)) {
      cornerMatch = { p, dist: d }
    }
  }

  if (cornerMatch && cornerMatch.dist <= alignPx) {
    const p = cornerMatch.p
    return {
      point: { x: p.x, y: p.y },
      guideX: p.x,
      guideY: p.y,
      snappedCorner: p,
    }
  }

  const snappedX = snapScalarAxis(free.x, clientX, xPeers, alignPx, magnetPx)
  const snappedY = snapScalarAxis(free.y, clientY, yPeers, alignPx, magnetPx)

  return {
    point: { x: snappedX.image, y: snappedY.image },
    guideX: snappedX.guide,
    guideY: snappedY.guide,
    snappedCorner:
      snappedX.guide !== null && snappedY.guide !== null
        ? { x: snappedX.guide, y: snappedY.guide }
        : null,
  }
}
