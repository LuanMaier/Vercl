import {
  imagePctToLayoutViewportPct,
  STILL_VIEW_IMAGE_FIT,
  type StageViewTransform,
} from '../core/coverCoords'
import type { OutlinePoint } from '../config/apartmentOutlinesConfig'
import { outlineBBox } from '../core/apartmentOutlineGeometry'

const MIN_ZOOM = 1
const MAX_ZOOM = 10
const ZOOM_WHEEL_STEP = 1.12

export type EditStageViewportHandle = {
  getView(): StageViewTransform | null
  isActive(): boolean
  isZoomed(): boolean
  resetView(): void
  focusOnImageBbox(bbox: { minX: number; maxX: number; minY: number; maxY: number }): void
  focusOnPoints(points: OutlinePoint[]): void
  zoomIn(): void
  zoomOut(): void
  refresh(): void
  destroy(): void
}

export function initEditStageViewport(deps: {
  viewportEl: HTMLElement
  stageEl: HTMLElement
  toolbarEl: HTMLElement
  zoomLabelEl: HTMLElement
  getImageSize: () => { w: number; h: number } | null
  getFocusBbox: () => { minX: number; maxX: number; minY: number; maxY: number } | null
  isEnabled: () => boolean
  onViewChange?: () => void
}): EditStageViewportHandle {
  let zoom = 1
  let panX = 0
  let panY = 0
  let panDrag: { startX: number; startY: number; startPanX: number; startPanY: number } | null = null
  let spaceHeld = false
  let listenersReady = false

  function layoutSize() {
    const r = deps.viewportEl.getBoundingClientRect()
    return { w: r.width, h: r.height }
  }

  function getView(): StageViewTransform | null {
    if (!deps.isEnabled()) return null
    const { w, h } = layoutSize()
    const vp = deps.viewportEl.getBoundingClientRect()
    return {
      zoom,
      panX,
      panY,
      layoutW: w,
      layoutH: h,
      viewportLeft: vp.left,
      viewportTop: vp.top,
    }
  }

  function clampPan(nextPanX: number, nextPanY: number, nextZoom: number) {
    const { w, h } = layoutSize()
    const scaledW = w * nextZoom
    const scaledH = h * nextZoom
    let px = nextPanX
    let py = nextPanY
    if (scaledW <= w) px = (w - scaledW) / 2
    else {
      px = Math.min(0, Math.max(w - scaledW, px))
    }
    if (scaledH <= h) py = (h - scaledH) / 2
    else {
      py = Math.min(0, Math.max(h - scaledH, py))
    }
    return { panX: px, panY: py }
  }

  let lastViewNotifyKey = ''

  function applyTransform() {
    deps.stageEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
    deps.stageEl.style.transformOrigin = '0 0'
    deps.viewportEl.classList.toggle('is-zoomed', zoom > 1.001 || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5)
    if (deps.zoomLabelEl) {
      deps.zoomLabelEl.textContent = `${Math.round(zoom * 100)}%`
    }
    const viewKey = `${zoom.toFixed(4)}|${panX.toFixed(2)}|${panY.toFixed(2)}`
    if (viewKey === lastViewNotifyKey) return
    lastViewNotifyKey = viewKey
    deps.onViewChange?.()
  }

  function resetView() {
    zoom = 1
    panX = 0
    panY = 0
    applyTransform()
  }

  function setZoomAt(nextZoom: number, anchorClientX?: number, anchorClientY?: number) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
    const vp = deps.viewportEl.getBoundingClientRect()
    const ax = anchorClientX ?? vp.left + vp.width / 2
    const ay = anchorClientY ?? vp.top + vp.height / 2
    const vx = ax - vp.left
    const vy = ay - vp.top
    const lx = (vx - panX) / zoom
    const ly = (vy - panY) / zoom
    panX = vx - lx * z
    panY = vy - ly * z
    zoom = z
    const clamped = clampPan(panX, panY, zoom)
    panX = clamped.panX
    panY = clamped.panY
    applyTransform()
  }

  function zoomIn() {
    setZoomAt(zoom * ZOOM_WHEEL_STEP)
  }

  function zoomOut() {
    setZoomAt(zoom / ZOOM_WHEEL_STEP)
  }

  function focusOnImageBbox(bbox: { minX: number; maxX: number; minY: number; maxY: number }) {
    const img = deps.getImageSize()
    if (!img?.w || !img.h) return
    const { w, h } = layoutSize()
    const tl = imagePctToLayoutViewportPct(bbox.minX, bbox.minY, w, h, img.w, img.h, STILL_VIEW_IMAGE_FIT)
    const br = imagePctToLayoutViewportPct(bbox.maxX, bbox.maxY, w, h, img.w, img.h, STILL_VIEW_IMAGE_FIT)
    if (!tl || !br) return

    const left = (Math.min(tl.x, br.x) / 100) * w
    const top = (Math.min(tl.y, br.y) / 100) * h
    const right = (Math.max(tl.x, br.x) / 100) * w
    const bottom = (Math.max(tl.y, br.y) / 100) * h
    const boxW = Math.max(right - left, w * 0.08)
    const boxH = Math.max(bottom - top, h * 0.08)
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2

    const padding = 0.22
    const zoomX = (w * (1 - padding * 2)) / boxW
    const zoomY = (h * (1 - padding * 2)) / boxH
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zoomX, zoomY, 6)))

    zoom = nextZoom
    panX = w / 2 - cx * zoom
    panY = h / 2 - cy * zoom
    const clamped = clampPan(panX, panY, zoom)
    panX = clamped.panX
    panY = clamped.panY
    applyTransform()
  }

  function focusOnPoints(points: OutlinePoint[]) {
    if (points.length < 3) return
    focusOnImageBbox(outlineBBox(points))
  }

  function refresh() {
    if (!deps.isEnabled()) {
      deps.toolbarEl.hidden = true
      if (zoom !== 1 || panX !== 0 || panY !== 0) resetView()
      return
    }
    deps.toolbarEl.hidden = false
    const clamped = clampPan(panX, panY, zoom)
    panX = clamped.panX
    panY = clamped.panY
    applyTransform()
  }

  function onWheel(e: WheelEvent) {
    if (!deps.isEnabled()) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP
    setZoomAt(zoom * factor, e.clientX, e.clientY)
  }

  function onPointerDown(e: PointerEvent) {
    if (!deps.isEnabled()) return
    const canPan =
      e.button === 1 ||
      (e.button === 0 && spaceHeld) ||
      (e.button === 2 && deps.viewportEl.classList.contains('is-zoomed'))
    if (!canPan) return
    e.preventDefault()
    panDrag = { startX: e.clientX, startY: e.clientY, startPanX: panX, startPanY: panY }
    deps.viewportEl.classList.add('is-panning')
    deps.viewportEl.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!panDrag) return
    panX = panDrag.startPanX + (e.clientX - panDrag.startX)
    panY = panDrag.startPanY + (e.clientY - panDrag.startY)
    const clamped = clampPan(panX, panY, zoom)
    panX = clamped.panX
    panY = clamped.panY
    applyTransform()
  }

  function onPointerUp(e: PointerEvent) {
    if (!panDrag) return
    panDrag = null
    deps.viewportEl.classList.remove('is-panning')
    try {
      deps.viewportEl.releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space' && !e.repeat) {
      spaceHeld = true
      deps.viewportEl.classList.add('is-space-pan')
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spaceHeld = false
      deps.viewportEl.classList.remove('is-space-pan')
    }
  }

  function ensureListeners() {
    if (listenersReady) return
    listenersReady = true
    deps.viewportEl.addEventListener('wheel', onWheel, { passive: false })
    deps.viewportEl.addEventListener('pointerdown', onPointerDown)
    deps.viewportEl.addEventListener('pointermove', onPointerMove)
    deps.viewportEl.addEventListener('pointerup', onPointerUp)
    deps.viewportEl.addEventListener('pointercancel', onPointerUp)
    deps.viewportEl.addEventListener('contextmenu', (e) => {
      if (deps.isEnabled() && zoom > 1) e.preventDefault()
    })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', () => {
      spaceHeld = false
      deps.viewportEl.classList.remove('is-space-pan')
    })
  }

  ensureListeners()
  refresh()

  return {
    getView,
    isActive: () => deps.isEnabled(),
    isZoomed: () => zoom > 1.001 || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5,
    resetView,
    focusOnImageBbox,
    focusOnPoints,
    zoomIn,
    zoomOut,
    refresh,
    destroy() {
      resetView()
      if (!listenersReady) return
      deps.viewportEl.removeEventListener('wheel', onWheel)
      deps.viewportEl.removeEventListener('pointerdown', onPointerDown)
      deps.viewportEl.removeEventListener('pointermove', onPointerMove)
      deps.viewportEl.removeEventListener('pointerup', onPointerUp)
      deps.viewportEl.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      listenersReady = false
    },
  }
}

let activeViewport: EditStageViewportHandle | null = null

export function setActiveEditStageViewport(handle: EditStageViewportHandle | null) {
  activeViewport = handle
}

export function getActiveEditStageViewport(): EditStageViewportHandle | null {
  return activeViewport
}
