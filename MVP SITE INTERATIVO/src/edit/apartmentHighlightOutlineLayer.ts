import type {
  ApartmentOutlinesEditorState,
  OutlinePoint,
  UnitOutline,
} from '../config/apartmentOutlinesConfig'
import type { StageViewTransform } from '../core/coverCoords'
import { crmStatusClass, getCrmStatusForUnit } from '../config/crmConfig'
import {
  cloneOutlinePoints,
  outlineBBox,
  outlineCentroid,
  outlineEdgeInsertHit,
  outlineEdgeHandleCenters,
  pointInPolygon,
  rectOutlineAround,
  resizeOutlineByEdge,
  resizeOutlineByCorner,
  rectOutlineFromPoints,
  resolveOutlineEdgeResizePointer,
  outlineEdgeResizePointer,
  resolveOutlineVertexSnap,
  resolveOutlineBodySnap,
  roundOutlineCoord,
  sanitizeOutlinePoints,
  translateOutlinePoints,
  type OutlineEdgeHandle,
  type OutlineVertexSnapResult,
} from '../core/apartmentOutlineGeometry'
import {
  outlinePointToSvgXY,
  outlinePointsToSvgAttr,
  pointerToHighlightImagePoint,
  type HighlightStageMetrics,
} from './highlightStageMetrics'
import {
  isHighlightFacadeLoading,
  resolveHighlightFacadeMetrics,
} from './highlightStageContext'

type PinDom = {
  group: SVGGElement
  poly: SVGPolygonElement
  bodyHit: SVGPolygonElement
  edgeHit: SVGPolygonElement
}

type ActiveUiDom = {
  group: SVGGElement
  vertexHits: SVGCircleElement[]
  vertices: SVGCircleElement[]
  edgeHits: SVGRectElement[]
  edgeHandles: SVGRectElement[]
}

export function createHighlightOutlineLayer(deps: {
  editStage: HTMLElement
  getOutlinesState: () => ApartmentOutlinesEditorState
  setOutlinesState: (s: ApartmentOutlinesEditorState) => void
  getActiveSceneId: () => string | null
  getActivePinId: () => string | null
  getScenePinIds: () => string[]
  getPinLabel: (pinId: string) => string
  isVisible: () => boolean
  onDirty: () => void
  onGeometryChanged: () => void
  onGeometryDragStart?: () => void
  onGeometryChanging?: (pinId: string, points: OutlinePoint[]) => void
  getSelectedPinIds?: () => string[]
  getPivotPinId?: () => string | null
  getStageCoverImage: () => HTMLImageElement | null
  getStageLayoutRect: () => DOMRect
  getStageView?: () => StageViewTransform | null
  onEdgeClick?: () => void
  onOutlineClick?: (pinId: string, opts?: { addToSelection?: boolean }) => void
  onOutlineLabelEdit?: (pinId: string) => void
  ensurePinSelected?: (pinId: string) => void
}) {
  let vertexDrag: {
    pinId: string
    index: number
    anchorBb: { minX: number; minY: number; maxX: number; maxY: number }
  } | null = null
  let edgeHandleDrag: {
    pinId: string
    edge: OutlineEdgeHandle
    buffer: OutlinePoint[]
  } | null = null
  let bodyDrag: {
    leaderPinId: string
    pinIds: string[]
    buffers: Map<string, OutlinePoint[]>
    startImg: OutlinePoint
  } | null = null
  let pendingBodyDrag: {
    pinId: string
    clientX: number
    clientY: number
    addToSelection: boolean
  } | null = null
  let pendingEdgeInsert: { pinId: string; clientX: number; clientY: number } | null = null
  let vertexSnapGuide: OutlineVertexSnapResult | null = null
  let syncRaf = 0
  let svgRoot: SVGSVGElement | null = null
  let activeUiDom: ActiveUiDom | null = null
  let activeUiPinId: string | null = null
  const pinDom = new Map<string, PinDom>()
  let dragListenersReady = false

  const BODY_DRAG_THRESHOLD_PX = 4
  const NS = 'http://www.w3.org/2000/svg'

  function getMetrics(): HighlightStageMetrics | null {
    return resolveHighlightFacadeMetrics(
      () => deps.getStageView?.() ?? null,
      deps.editStage,
    )
  }

  function getPinOutline(pinId: string): UnitOutline | null {
    const raw = deps.getOutlinesState().byPin[pinId]
    if (!raw?.points?.length || raw.points.length < 3) return null
    return { ...raw, points: sanitizeOutlinePoints(raw.points), coordSpace: 'image' }
  }

  function setPinOutline(
    pinId: string,
    outline: UnitOutline | null,
    opts?: { silent?: boolean },
  ) {
    const state = deps.getOutlinesState()
    const byPin = { ...state.byPin }
    if (!outline || outline.points.length < 3) delete byPin[pinId]
    else byPin[pinId] = outline
    deps.setOutlinesState({ ...state, byPin })
    if (!opts?.silent) {
      deps.onDirty()
      deps.onGeometryChanged()
    }
  }

  function removePinOutline(pinId: string) {
    setPinOutline(pinId, null)
  }

  function createRectAt(pinId: string, cx: number, cy: number): UnitOutline {
    const outline: UnitOutline = {
      points: rectOutlineAround(cx, cy),
      coordSpace: 'image',
    }
    setPinOutline(pinId, outline)
    return outline
  }

  function isGeometryInteractionActive() {
    return Boolean(vertexDrag || edgeHandleDrag || bodyDrag)
  }

  function isGeometryPendingInteraction() {
    return Boolean(pendingBodyDrag || pendingEdgeInsert)
  }

  function resetGeometryInteraction() {
    vertexDrag = null
    edgeHandleDrag = null
    bodyDrag = null
    pendingBodyDrag = null
    pendingEdgeInsert = null
    vertexSnapGuide = null
  }

  function collectVertexSnapTargets(pinId: string, excludeIndex: number): OutlinePoint[] {
    const targets: OutlinePoint[] = []
    for (const pid of deps.getScenePinIds()) {
      const outline = getPinOutline(pid)
      if (!outline?.points?.length) continue
      outline.points.forEach((p, idx) => {
        if (pid === pinId && idx === excludeIndex) return
        targets.push(p)
      })
    }
    return targets
  }

  function collectPeerOutlinePoints(excludePinIds: string | string[]): OutlinePoint[][] {
    const exclude = new Set(Array.isArray(excludePinIds) ? excludePinIds : [excludePinIds])
    return deps
      .getScenePinIds()
      .filter((id) => !exclude.has(id))
      .map((id) => getPinOutline(id)?.points ?? [])
      .filter((pts): pts is OutlinePoint[] => pts.length >= 3)
  }

  function bodyDragPinIds(leaderPinId: string): string[] {
    const selected = deps.getSelectedPinIds?.() ?? []
    if (selected.includes(leaderPinId) && selected.length > 1) return selected
    return [leaderPinId]
  }

  function tearDownSvg(force = false) {
    if ((isGeometryInteractionActive() || isGeometryPendingInteraction()) && !force) return
    resetGeometryInteraction()
    pinDom.clear()
    activeUiDom = null
    activeUiPinId = null
    svgRoot?.remove()
    svgRoot = null
  }

  function clear(force = false) {
    deps.editStage.querySelector('#edit-highlight-vertices-svg')?.remove()
    deps.editStage.querySelector('#edit-highlight-outline-crm-svg')?.remove()
    tearDownSvg(force)
  }

  function ensureSvgRoot(): SVGSVGElement {
    deps.editStage.querySelector('#edit-highlight-vertices-svg')?.remove()
    if (svgRoot && svgRoot.parentElement !== deps.editStage) {
      svgRoot.remove()
      svgRoot = null
    }
    if (svgRoot) return svgRoot
    svgRoot = document.createElementNS(NS, 'svg')
    svgRoot.id = 'edit-highlight-outline-svg'
    svgRoot.setAttribute('class', 'edit-outline-svg edit-highlight-outline-svg')
    svgRoot.setAttribute('viewBox', '0 0 100 100')
    svgRoot.setAttribute('preserveAspectRatio', 'none')
    deps.editStage.appendChild(svgRoot)
    return svgRoot
  }

  function createPolygon(className: string, pinId: string): SVGPolygonElement {
    const poly = document.createElementNS(NS, 'polygon') as SVGPolygonElement
    poly.setAttribute('class', className)
    poly.dataset.pin = pinId
    return poly
  }

  function ensurePinDom(svg: SVGSVGElement, pinId: string): PinDom {
    const existing = pinDom.get(pinId)
    if (existing) return existing
    const group = document.createElementNS(NS, 'g') as SVGGElement
    group.classList.add('edit-highlight-outline-group')
    group.dataset.pin = pinId
    const poly = createPolygon('edit-highlight-outline-poly', pinId)
    const bodyHit = createPolygon('edit-highlight-outline-body-hit', pinId)
    const edgeHit = createPolygon('edit-highlight-outline-edge-hit', pinId)
    group.append(poly, bodyHit, edgeHit)
    svg.appendChild(group)
    const dom = { group, poly, bodyHit, edgeHit }
    pinDom.set(pinId, dom)
    return dom
  }

  function updatePinDom(
    dom: PinDom,
    pinId: string,
    outline: UnitOutline,
    selection: { highlighted: boolean; showEdgeHit: boolean },
    metrics: HighlightStageMetrics,
  ) {
    const pts = outlinePointsToSvgAttr(outline.points, metrics)
    dom.poly.setAttribute('points', pts)
    dom.bodyHit.setAttribute('points', pts)
    dom.edgeHit.setAttribute('points', pts)
    dom.poly.classList.remove(
      'crm--available',
      'crm--reserved',
      'crm--sold',
      'edit-outline-active',
      'edit-outline-inactive',
    )
    dom.poly.classList.add(crmClassForPin(pinId))
    dom.poly.classList.add(selection.highlighted ? 'edit-outline-active' : 'edit-outline-inactive')
    dom.edgeHit.style.display = selection.showEdgeHit ? '' : 'none'
  }

  function crmClassForPin(pinId: string) {
    return crmStatusClass(getCrmStatusForUnit(deps.getPinLabel(pinId)))
  }

  function edgeHandleLayouts(points: OutlinePoint[], metrics: HighlightStageMetrics) {
    const handles = outlineEdgeHandleCenters(points)
    const bb = outlineBBox(points)
    const tl = outlinePointToSvgXY({ x: bb.minX, y: bb.minY }, metrics)
    const tr = outlinePointToSvgXY({ x: bb.maxX, y: bb.minY }, metrics)
    const bl = outlinePointToSvgXY({ x: bb.minX, y: bb.maxY }, metrics)
    if (!tl || !tr || !bl) return []

    const topLen = Math.abs(Number(tr.x) - Number(tl.x))
    const leftLen = Math.abs(Number(bl.y) - Number(tl.y))
    const barSpan = (edgeLen: number) => {
      if (edgeLen <= 0.15) return edgeLen
      return roundOutlineCoord(
        Math.min(edgeLen, Math.max(edgeLen * 0.42, Math.min(1.4, edgeLen * 0.85))),
      )
    }
    const barThick = 0.36
    const hitThick = 1.0
    const edges: OutlineEdgeHandle[] = ['top', 'bottom', 'left', 'right']
    const layouts: Array<{
      edge: OutlineEdgeHandle
      cursor: string
      x: number
      y: number
      w: number
      h: number
      hx: number
      hy: number
      hitW: number
      hitH: number
    }> = []

    for (const edge of edges) {
      const center = handles[edge]
      const stage = outlinePointToSvgXY(center, metrics)
      if (!stage) continue
      const sx = Number(stage.x)
      const sy = Number(stage.y)
      const isHoriz = edge === 'top' || edge === 'bottom'
      const edgeLen = isHoriz ? topLen : leftLen
      const long = barSpan(edgeLen)
      const w = isHoriz ? long : barThick
      const h = isHoriz ? barThick : long
      const hitW = isHoriz ? long + 0.25 : hitThick
      const hitH = isHoriz ? hitThick : long + 0.25
      layouts.push({
        edge,
        cursor: isHoriz ? 'ns-resize' : 'ew-resize',
        x: roundOutlineCoord(sx - w / 2),
        y: roundOutlineCoord(sy - h / 2),
        w: roundOutlineCoord(w),
        h: roundOutlineCoord(h),
        hx: roundOutlineCoord(sx - hitW / 2),
        hy: roundOutlineCoord(sy - hitH / 2),
        hitW: roundOutlineCoord(hitW),
        hitH: roundOutlineCoord(hitH),
      })
    }
    return layouts
  }

  function removeActiveUi() {
    activeUiDom?.group.remove()
    activeUiDom = null
    activeUiPinId = null
  }

  function ensureActiveUi(
    svg: SVGSVGElement,
    pinId: string,
    points: OutlinePoint[],
    metrics: HighlightStageMetrics,
  ) {
    if (
      activeUiPinId === pinId &&
      activeUiDom &&
      activeUiDom.vertexHits.length !== points.length
    ) {
      removeActiveUi()
    }
    if (activeUiPinId !== pinId) {
      removeActiveUi()
      activeUiPinId = pinId
      const group = document.createElementNS(NS, 'g') as SVGGElement
      group.classList.add('edit-highlight-active-ui')
      group.dataset.pin = pinId
      const vertexHits: SVGCircleElement[] = []
      const vertices: SVGCircleElement[] = []
      const edgeHits: SVGRectElement[] = []
      const edgeHandles: SVGRectElement[] = []

      for (const layout of edgeHandleLayouts(points, metrics)) {
        const hit = document.createElementNS(NS, 'rect') as SVGRectElement
        hit.setAttribute('class', 'edit-outline-edge-handle-hit')
        hit.dataset.edge = layout.edge
        hit.dataset.pin = pinId
        hit.dataset.cursor = layout.cursor
        edgeHits.push(hit)
        group.appendChild(hit)

        const handle = document.createElementNS(NS, 'rect') as SVGRectElement
        handle.setAttribute('class', `edit-outline-edge-handle edit-outline-edge-handle--${layout.edge}`)
        handle.dataset.edge = layout.edge
        handle.dataset.pin = pinId
        edgeHandles.push(handle)
        group.appendChild(handle)
      }

      for (let i = 0; i < points.length; i++) {
        const hit = document.createElementNS(NS, 'circle') as SVGCircleElement
        hit.setAttribute('class', 'edit-outline-vertex-hit')
        hit.dataset.idx = String(i)
        hit.dataset.pin = pinId
        hit.setAttribute('r', '1.6')
        vertexHits.push(hit)
        group.appendChild(hit)

        const vertex = document.createElementNS(NS, 'circle') as SVGCircleElement
        vertex.setAttribute('class', 'edit-outline-vertex')
        vertex.dataset.idx = String(i)
        vertex.dataset.pin = pinId
        vertex.setAttribute('r', '0.45')
        vertices.push(vertex)
        group.appendChild(vertex)
      }

      svg.appendChild(group)
      activeUiDom = { group, vertexHits, vertices, edgeHits, edgeHandles }
    }

    if (!activeUiDom) return
    syncActiveUiGeometry(pinId, points, metrics)
    syncSnapGuides(metrics)
  }

  function syncSnapGuides(metrics: HighlightStageMetrics) {
    if (!activeUiDom) return
    activeUiDom.group
      .querySelectorAll('.edit-outline-snap-axis, .edit-outline-snap-guide')
      .forEach((el) => el.remove())
    if (!vertexSnapGuide) return
    const guide = vertexSnapGuide
    if (guide.guideX !== null) {
      const stage = outlinePointToSvgXY({ x: guide.guideX, y: 50 }, metrics)
      if (stage) {
        const line = document.createElementNS(NS, 'line')
        line.setAttribute('class', 'edit-outline-snap-axis edit-outline-snap-axis--v')
        line.setAttribute('x1', stage.x)
        line.setAttribute('y1', '0')
        line.setAttribute('x2', stage.x)
        line.setAttribute('y2', '100')
        activeUiDom.group.insertBefore(line, activeUiDom.group.firstChild)
      }
    }
    if (guide.guideY !== null) {
      const stage = outlinePointToSvgXY({ x: 50, y: guide.guideY }, metrics)
      if (stage) {
        const line = document.createElementNS(NS, 'line')
        line.setAttribute('class', 'edit-outline-snap-axis edit-outline-snap-axis--h')
        line.setAttribute('x1', '0')
        line.setAttribute('y1', stage.y)
        line.setAttribute('x2', '100')
        line.setAttribute('y2', stage.y)
        activeUiDom.group.insertBefore(line, activeUiDom.group.firstChild)
      }
    }
    if (guide.snappedCorner) {
      const pt = outlinePointToSvgXY(guide.snappedCorner, metrics)
      if (pt) {
        const circle = document.createElementNS(NS, 'circle')
        circle.setAttribute('class', 'edit-outline-snap-guide')
        circle.setAttribute('cx', pt.x)
        circle.setAttribute('cy', pt.y)
        circle.setAttribute('r', '0.42')
        activeUiDom.group.insertBefore(circle, activeUiDom.group.firstChild)
      }
    }
  }

  function syncActiveUiGeometry(
    pinId: string,
    points: OutlinePoint[],
    metrics: HighlightStageMetrics,
  ) {
    if (!activeUiDom || activeUiPinId !== pinId) return
    const layouts = edgeHandleLayouts(points, metrics)
    layouts.forEach((layout, i) => {
      const hit = activeUiDom!.edgeHits[i]
      const handle = activeUiDom!.edgeHandles[i]
      if (!hit || !handle) return
      hit.setAttribute('x', String(layout.hx))
      hit.setAttribute('y', String(layout.hy))
      hit.setAttribute('width', String(layout.hitW))
      hit.setAttribute('height', String(layout.hitH))
      handle.setAttribute('x', String(layout.x))
      handle.setAttribute('y', String(layout.y))
      handle.setAttribute('width', String(layout.w))
      handle.setAttribute('height', String(layout.h))
    })
    points.forEach((p, i) => {
      const pt = outlinePointToSvgXY(p, metrics)
      if (!pt) return
      activeUiDom!.vertexHits[i]?.setAttribute('cx', pt.x)
      activeUiDom!.vertexHits[i]?.setAttribute('cy', pt.y)
      activeUiDom!.vertices[i]?.setAttribute('cx', pt.x)
      activeUiDom!.vertices[i]?.setAttribute('cy', pt.y)
    })
  }

  function syncDom() {
    if (!deps.isVisible()) {
      clear(true)
      return
    }
    const sceneId = deps.getActiveSceneId()
    const metrics = getMetrics()
    if (!sceneId || !metrics) {
      if (
        !isGeometryInteractionActive() &&
        !isGeometryPendingInteraction() &&
        !isHighlightFacadeLoading()
      ) {
        tearDownSvg(true)
      }
      return
    }

    const pinIds = deps.getScenePinIds()
    const activePinId = deps.getActivePinId()
    const selectedIds = new Set(deps.getSelectedPinIds?.() ?? [])
    if (selectedIds.size === 0 && activePinId) selectedIds.add(activePinId)
    const svg = ensureSvgRoot()

    for (const id of [...pinDom.keys()]) {
      if (!pinIds.includes(id)) {
        pinDom.get(id)?.group.remove()
        pinDom.delete(id)
      }
    }

    let hasAny = false
    for (const pinId of pinIds) {
      const outline = getPinOutline(pinId)
      if (!outline) continue
      hasAny = true
      const dom = ensurePinDom(svg, pinId)
      const highlighted = selectedIds.has(pinId)
      updatePinDom(
        dom,
        pinId,
        outline,
        { highlighted, showEdgeHit: highlighted && pinId === activePinId },
        metrics,
      )
    }

    if (!hasAny) {
      tearDownSvg(true)
      return
    }

    if (activePinId && getPinOutline(activePinId)) {
      ensureActiveUi(svg, activePinId, getPinOutline(activePinId)!.points, metrics)
    } else {
      removeActiveUi()
    }
  }

  function requestSync() {
    if (syncRaf) return
    syncRaf = requestAnimationFrame(() => {
      syncRaf = 0
      if (isGeometryInteractionActive()) {
        patchActivePinGeometry()
        return
      }
      syncDom()
    })
  }

  function patchActivePinGeometry() {
    const activePinId = deps.getActivePinId()
    const metrics = getMetrics()
    if (!activePinId || !metrics) return
    const outline = getPinOutline(activePinId)
    if (!outline) return

    const dom = pinDom.get(activePinId)
    if (dom) {
      updatePinDom(
        dom,
        activePinId,
        outline,
        { highlighted: true, showEdgeHit: true },
        metrics,
      )
    }
    else syncDom()

    if (activeUiPinId === activePinId && activeUiDom) {
      syncActiveUiGeometry(activePinId, outline.points, metrics)
      syncSnapGuides(metrics)
    } else {
      ensureActiveUi(ensureSvgRoot(), activePinId, outline.points, metrics)
    }
  }

  function queueRender() {
    requestSync()
  }

  function render() {
    requestSync()
  }

  function pointerMetrics(clientX: number, clientY: number) {
    const metrics = getMetrics()
    if (!metrics) return null
    const point = pointerToHighlightImagePoint(clientX, clientY, metrics)
    if (!point) return null
    return { metrics, point }
  }

  function cornerIndexForVertex(points: OutlinePoint[], index: number): number {
    if (points.length === 4) return index
    const p = points[index]
    if (!p) return 0
    const bb = outlineBBox(rectOutlineFromPoints(points))
    const corners = [
      { x: bb.minX, y: bb.minY },
      { x: bb.maxX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY },
      { x: bb.minX, y: bb.maxY },
    ]
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < 4; i++) {
      const d = Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  function startVertexDrag(pinId: string, index: number) {
    deps.onGeometryDragStart?.()
    deps.ensurePinSelected?.(pinId)
    const outline = getPinOutline(pinId)
    if (!outline) return
    const rect = rectOutlineFromPoints(outline.points)
    const anchorBb = outlineBBox(rect)
    const corner = cornerIndexForVertex(outline.points, index)
    if (outline.points.length !== 4 || rect.some((p, i) => p.x !== outline.points[i]?.x || p.y !== outline.points[i]?.y)) {
      setPinOutline(pinId, { points: rect, coordSpace: 'image' }, { silent: true })
    }
    vertexDrag = { pinId, index: corner, anchorBb }
  }

  function startEdgeHandleDrag(pinId: string, edge: OutlineEdgeHandle) {
    deps.onGeometryDragStart?.()
    deps.ensurePinSelected?.(pinId)
    const outline = getPinOutline(pinId)
    if (!outline) return
    edgeHandleDrag = { pinId, edge, buffer: cloneOutlinePoints(outline.points) }
  }

  function moveEdgeHandle(clientX: number, clientY: number) {
    if (!edgeHandleDrag) return
    const hit = pointerMetrics(clientX, clientY)
    if (!hit) return
    const { metrics, point: raw } = hit
    const peers = collectPeerOutlinePoints(edgeHandleDrag.pinId)
    const locked = outlineEdgeResizePointer(edgeHandleDrag.edge, edgeHandleDrag.buffer, raw)
    const snapped = resolveOutlineEdgeResizePointer(
      edgeHandleDrag.edge,
      clientX,
      clientY,
      locked,
      metrics.rect,
      metrics.imgW,
      metrics.imgH,
      peers,
      { view: metrics.view },
    )
    vertexSnapGuide = {
      point: snapped.point,
      guideX: snapped.guideX,
      guideY: snapped.guideY,
      snappedCorner: null,
    }
    const nextPoints = resizeOutlineByEdge(edgeHandleDrag.buffer, edgeHandleDrag.edge, snapped.point)
    setPinOutline(edgeHandleDrag.pinId, { points: nextPoints, coordSpace: 'image' }, { silent: true })
    requestSync()
    deps.onGeometryChanging?.(edgeHandleDrag.pinId, nextPoints)
  }

  function moveVertex(clientX: number, clientY: number) {
    if (!vertexDrag) return
    const hit = pointerMetrics(clientX, clientY)
    if (!hit) return
    const { metrics, point: raw } = hit
    const targets = collectVertexSnapTargets(vertexDrag.pinId, vertexDrag.index)
    const snapped = resolveOutlineVertexSnap(
      clientX,
      clientY,
      raw,
      metrics.rect,
      metrics.imgW,
      metrics.imgH,
      targets,
      { view: metrics.view },
    )
    vertexSnapGuide = snapped
    const nextPoints = resizeOutlineByCorner(
      vertexDrag.anchorBb,
      vertexDrag.index,
      snapped.point,
    )
    setPinOutline(vertexDrag.pinId, { points: nextPoints, coordSpace: 'image' }, { silent: true })
    requestSync()
    deps.onGeometryChanging?.(vertexDrag.pinId, nextPoints)
  }

  function tryStartPendingBodyDrag(clientX: number, clientY: number) {
    if (!pendingBodyDrag) return
    const dx = clientX - pendingBodyDrag.clientX
    const dy = clientY - pendingBodyDrag.clientY
    if (Math.hypot(dx, dy) < BODY_DRAG_THRESHOLD_PX) return
    const { pinId, clientX: startX, clientY: startY } = pendingBodyDrag
    pendingBodyDrag = null
    startBodyDrag(pinId, startX, startY)
  }

  function startBodyDrag(pinId: string, clientX: number, clientY: number) {
    deps.onGeometryDragStart?.()
    deps.ensurePinSelected?.(pinId)
    const hit = pointerMetrics(clientX, clientY)
    if (!hit) return
    const pinIds = bodyDragPinIds(pinId)
    const pivotId = deps.getPivotPinId?.()
    const leaderPinId =
      pivotId && pinIds.includes(pivotId) ? pivotId : pinIds.includes(pinId) ? pinId : pinIds[0]!
    const buffers = new Map<string, OutlinePoint[]>()
    for (const id of pinIds) {
      const outline = getPinOutline(id)
      if (!outline) return
      buffers.set(id, cloneOutlinePoints(outline.points))
    }
    bodyDrag = { leaderPinId, pinIds, buffers, startImg: hit.point }
  }

  function moveBody(clientX: number, clientY: number) {
    if (!bodyDrag) return
    const start = pointerMetrics(clientX, clientY)
    if (!start) return
    const dx = start.point.x - bodyDrag.startImg.x
    const dy = start.point.y - bodyDrag.startImg.y
    const leaderBuffer = bodyDrag.buffers.get(bodyDrag.leaderPinId)
    if (!leaderBuffer) return
    const rawLeader = translateOutlinePoints(leaderBuffer, dx, dy)
    const peers = collectPeerOutlinePoints(bodyDrag.pinIds)
    const snapped = resolveOutlineBodySnap(
      rawLeader,
      peers,
      start.metrics.rect,
      start.metrics.imgW,
      start.metrics.imgH,
      { view: start.metrics.view },
    )
    const leaderPoints = snapped.points
    const rawCentroid = outlineCentroid(rawLeader)
    const leaderCentroid = outlineCentroid(leaderPoints)
    const adjustDx = leaderCentroid.x - rawCentroid.x
    const adjustDy = leaderCentroid.y - rawCentroid.y
    vertexSnapGuide = {
      point: leaderCentroid,
      guideX: snapped.guideX,
      guideY: snapped.guideY,
      snappedCorner: null,
    }
    for (const id of bodyDrag.pinIds) {
      const buffer = bodyDrag.buffers.get(id)
      if (!buffer) continue
      const nextPoints =
        id === bodyDrag.leaderPinId
          ? leaderPoints
          : translateOutlinePoints(translateOutlinePoints(buffer, dx, dy), adjustDx, adjustDy)
      setPinOutline(id, { points: nextPoints, coordSpace: 'image' }, { silent: true })
      deps.onGeometryChanging?.(id, nextPoints)
    }
    requestSync()
  }

  function finishEdgeHandleDrag() {
    if (!edgeHandleDrag) return
    edgeHandleDrag = null
    vertexSnapGuide = null
    deps.onDirty()
    deps.onGeometryChanged()
  }

  function finishVertexDrag() {
    if (!vertexDrag) return
    vertexDrag = null
    vertexSnapGuide = null
    deps.onDirty()
    deps.onGeometryChanged()
  }

  function finishBodyDrag() {
    if (!bodyDrag) return
    bodyDrag = null
    vertexSnapGuide = null
    deps.onDirty()
    deps.onGeometryChanged()
  }

  function onSvgPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const target = e.target as Element
    const pinId = (target as HTMLElement).dataset.pin
    if (!pinId) return

    if (
      target.classList.contains('edit-outline-vertex-hit') ||
      target.classList.contains('edit-outline-vertex')
    ) {
      e.stopPropagation()
      e.preventDefault()
      const idx = Number((target as HTMLElement).dataset.idx)
      if (Number.isNaN(idx)) return
      startVertexDrag(pinId, idx)
      return
    }

    if (target.classList.contains('edit-outline-edge-handle-hit')) {
      e.stopPropagation()
      e.preventDefault()
      const edge = (target as HTMLElement).dataset.edge as OutlineEdgeHandle | undefined
      if (!edge) return
      startEdgeHandleDrag(pinId, edge)
      return
    }

    if (target.classList.contains('edit-highlight-outline-body-hit')) {
      e.stopPropagation()
      e.preventDefault()
      pendingBodyDrag = {
        pinId,
        clientX: e.clientX,
        clientY: e.clientY,
        addToSelection: e.ctrlKey || e.metaKey,
      }
      return
    }

    if (target.classList.contains('edit-highlight-outline-edge-hit')) {
      e.stopPropagation()
      e.preventDefault()
      deps.ensurePinSelected?.(pinId)
      pendingEdgeInsert = { pinId, clientX: e.clientX, clientY: e.clientY }
    }
  }

  function ensureDragListeners() {
    if (dragListenersReady) return
    dragListenersReady = true
    const onMove = (clientX: number, clientY: number) => {
      tryStartPendingBodyDrag(clientX, clientY)
      moveVertex(clientX, clientY)
      moveEdgeHandle(clientX, clientY)
      moveBody(clientX, clientY)
    }
    const onEnd = (e?: PointerEvent) => {
      if (pendingEdgeInsert && !vertexDrag && !bodyDrag && !edgeHandleDrag) {
        const dx = e ? e.clientX - pendingEdgeInsert.clientX : 0
        const dy = e ? e.clientY - pendingEdgeInsert.clientY : 0
        if (Math.hypot(dx, dy) < BODY_DRAG_THRESHOLD_PX) {
          insertVertexOnEdge(
            pendingEdgeInsert.pinId,
            pendingEdgeInsert.clientX,
            pendingEdgeInsert.clientY,
          )
        }
      }
      pendingEdgeInsert = null
      if (pendingBodyDrag && !bodyDrag && !vertexDrag && !edgeHandleDrag) {
        deps.onOutlineClick?.(pendingBodyDrag.pinId, {
          addToSelection: pendingBodyDrag.addToSelection,
        })
      }
      pendingBodyDrag = null
      finishVertexDrag()
      finishEdgeHandleDrag()
      finishBodyDrag()
    }
    window.addEventListener(
      'pointermove',
      (e) => {
        if (!vertexDrag && !bodyDrag && !edgeHandleDrag && !pendingBodyDrag) return
        e.preventDefault()
        onMove(e.clientX, e.clientY)
      },
      { passive: false },
    )
    window.addEventListener('pointerup', (e) => onEnd(e))
    window.addEventListener('pointercancel', (e) => onEnd(e))

    deps.editStage.addEventListener('pointerdown', (e) => {
      const svg = (e.target as Element).closest('#edit-highlight-outline-svg')
      if (!svg) return
      onSvgPointerDown(e as PointerEvent)
    })
  }

  function insertVertexOnEdge(pinId: string, clientX: number, clientY: number): boolean {
    const outline = getPinOutline(pinId)
    const hit = pointerMetrics(clientX, clientY)
    if (!outline || !hit) return false
    const insertHit = outlineEdgeInsertHit(hit.point, outline.points, hit.metrics.rect.width)
    if (!insertHit) return false
    deps.onGeometryDragStart?.()
    const next = [...outline.points]
    next.splice(insertHit.edgeIndex + 1, 0, insertHit.insertPoint)
    setPinOutline(pinId, { points: next, coordSpace: 'image' })
    requestSync()
    deps.onEdgeClick?.()
    return true
  }

  function migrateFromPin(pinId: string, pinX: number, pinY: number) {
    if (getPinOutline(pinId)) return
    createRectAt(pinId, pinX, pinY)
  }

  function isClickInsideHighlight(clientX: number, clientY: number): string | null {
    const hit = pointerMetrics(clientX, clientY)
    if (!hit) return null
    let best: { pinId: string; area: number } | null = null
    for (const pinId of deps.getScenePinIds()) {
      const outline = getPinOutline(pinId)
      if (!outline || !pointInPolygon(hit.point, outline.points)) continue
      const bb = outlineBBox(outline.points)
      const area = (bb.maxX - bb.minX) * (bb.maxY - bb.minY)
      if (!best || area < best.area) best = { pinId, area }
    }
    return best?.pinId ?? null
  }

  function cancelPendingDrag() {
    pendingBodyDrag = null
    pendingEdgeInsert = null
    bodyDrag = null
    vertexDrag = null
    edgeHandleDrag = null
    vertexSnapGuide = null
  }

  ensureDragListeners()

  return {
    render,
    requestSync,
    renderVerticesOnTop: () => requestSync(),
    queueRender,
    clear,
    createRectAt,
    getPinOutline,
    setPinOutline,
    removePinOutline,
    getPeerOutlinePoints: collectPeerOutlinePoints,
    isClickInsideHighlight,
    migrateFromPin,
    refreshOutlinePolygons: requestSync,
    outlineCentroid,
    cancelPendingDrag,
    isGeometryInteractionActive,
    isGeometryPendingInteraction,
  }
}
