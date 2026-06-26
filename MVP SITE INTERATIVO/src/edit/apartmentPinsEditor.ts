import {
  type ApartmentItem,
} from '../config/apartments'
import {
  removeMediaFromProject,
  saveApartmentOutlinesToProject,
  saveApartmentPoisToProject,
  saveMediaToProject,
} from '../admin/projectSave'
import type { ApartmentOutlinesEditorState, OutlinePoint } from '../config/apartmentOutlinesConfig'
import { cloneOutlinePoints, outlineBBox, outlineCentroid, resolveOutlineBodySnap, translateOutlinePoints } from '../core/apartmentOutlineGeometry'
import type { StageViewTransform } from '../core/coverCoords'
import { getActiveEditStageViewport } from './editStageViewport'
import { createHighlightOutlineLayer } from './apartmentHighlightOutlineLayer'
import {
  highlightImageToStagePct,
  pointerToHighlightImagePoint,
} from './highlightStageMetrics'
import { onEditBgReady } from './editStageImage'
import {
  getHighlightFacadeImage,
  resolveHighlightFacadeMetrics,
} from './highlightStageContext'
import {
  crmStatusClass,
  getCrmStatusForUnit,
  getCrmStatusLabel,
  isCrmUnitKnown,
} from '../config/crmConfig'
import {
  getProjectPoiImagePath,
  getProjectPoiVideoPath,
} from '../config/projectMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import {
  ensureImageCoordSpace,
  migrateAptHighlightToCenterAnchor,
  measureAptPinCenterOffsetPx,
} from '../core/apartmentPinLayout'
import { getStillViewFitRect } from '../core/coverCoords'
import { getFacadeApartmentId } from '../config/apartmentsConfig'
import type { PoiDefinition } from '../core/types'

export type ApartmentPoisEditorState = Record<string, PoiDefinition[]>

type PendingImg = { file: File; previewUrl: string }
type PendingVideo = { file: File }
type ShowToast = (msg: string) => void

const pendingAptPinImg: Record<string, PendingImg> = {}
const pendingAptPinVideo: Record<string, PendingVideo> = {}

/** Distância em px para o pin “grudar” na coluna de outro pin. */
const SNAP_THRESHOLD_PX = 14

const PASTE_GAP_PCT = 0.6
const HIGHLIGHT_UNDO_MAX = 40

function clonePoisState(state: ApartmentPoisEditorState): ApartmentPoisEditorState {
  return JSON.parse(JSON.stringify(state)) as ApartmentPoisEditorState
}

function cloneOutlinesState(state: ApartmentOutlinesEditorState): ApartmentOutlinesEditorState {
  return JSON.parse(JSON.stringify(state)) as ApartmentOutlinesEditorState
}

type CopiedHighlightItem = {
  pinFields: Omit<PoiDefinition, 'id' | 'x' | 'y'>
  /** Distância vertical em relação ao pivot (1ª seleção). */
  dPivotY: number
  /** Contorno relativo ao pivot da 1ª seleção. */
  outlineRel: OutlinePoint[]
}

type CopiedHighlightBatch = {
  pivotX: number
  pivotY: number
  /** Contorno do pivot na hora da cópia — define largura do deslocamento ao colar. */
  pivotOutline: OutlinePoint[]
  items: CopiedHighlightItem[]
}

/** Desloca o lote colado ao lado do pivot, sem sobrepor e dentro da foto. */
function computePasteOffset(points: OutlinePoint[]): { dx: number; dy: number } {
  if (!points.length) return { dx: PASTE_GAP_PCT, dy: 0 }
  const bb = outlineBBox(points)
  const spanX = Math.max(bb.maxX - bb.minX, 0.8)
  const spanY = Math.max(bb.maxY - bb.minY, 0.5)
  const stepX = spanX + PASTE_GAP_PCT
  const stepY = spanY + PASTE_GAP_PCT

  const fits = (dx: number, dy: number) =>
    bb.minX + dx >= 0 &&
    bb.maxX + dx <= 100 &&
    bb.minY + dy >= 0 &&
    bb.maxY + dy <= 100

  const candidates = [
    { dx: stepX, dy: 0 },
    { dx: -stepX, dy: 0 },
    { dx: 0, dy: stepY },
    { dx: 0, dy: -stepY },
  ]
  for (const c of candidates) {
    if (fits(c.dx, c.dy)) return c
  }

  const dxRight = Math.min(stepX, 100 - bb.maxX)
  if (dxRight > 0.2) return { dx: dxRight, dy: 0 }
  const dxLeft = Math.max(-stepX, -bb.minX)
  if (dxLeft < -0.2) return { dx: dxLeft, dy: 0 }
  const dyDown = Math.min(stepY, 100 - bb.maxY)
  if (dyDown > 0.2) return { dx: 0, dy: dyDown }
  const dyUp = Math.max(-stepY, -bb.minY)
  if (dyUp < -0.2) return { dx: 0, dy: dyUp }

  return { dx: dxRight, dy: 0 }
}

/** Incrementa o bloco numérico final (1A1 → 1A2, 1102 → 1103). */
export function incrementTrailingNumber(label: string, delta: number): string {
  if (delta === 0) return label
  const m = label.match(/^(.*?)(\d+)$/)
  if (!m) return delta > 0 ? `${label}${delta}` : label
  const prefix = m[1]!
  const numStr = m[2]!
  const next = parseInt(numStr, 10) + delta
  if (!Number.isFinite(next)) return label
  const nextStr =
    numStr.length > 1 && numStr.startsWith('0')
      ? String(Math.max(0, next)).padStart(numStr.length, '0')
      : String(next)
  return `${prefix}${nextStr}`
}

const BATCH_RENAME_ROW_Y_TOLERANCE = 1.8

export function groupPinsByRow(
  pins: PoiDefinition[],
  pointForPin: (pin: PoiDefinition) => { x: number; y: number },
  toleranceY = BATCH_RENAME_ROW_Y_TOLERANCE,
): PoiDefinition[][] {
  const ranked = pins
    .map((pin) => ({ pin, ...pointForPin(pin) }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Array<Array<{ pin: PoiDefinition; x: number; y: number }>> = []
  for (const item of ranked) {
    const lastRow = rows[rows.length - 1]
    if (!lastRow?.length || Math.abs(item.y - lastRow[0]!.y) > toleranceY) {
      rows.push([item])
    } else {
      lastRow.push(item)
    }
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    return row.map((item) => item.pin)
  })
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node) return false
  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(node.isContentEditable)
}

export function hasPendingApartmentPinMedia(): boolean {
  return (
    Object.keys(pendingAptPinImg).length > 0 || Object.keys(pendingAptPinVideo).length > 0
  )
}

function clearPendingImg(poiId: string) {
  const p = pendingAptPinImg[poiId]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingAptPinImg[poiId]
}

function clearPendingVideo(poiId: string) {
  delete pendingAptPinVideo[poiId]
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

export function initApartmentPinsEditor(deps: {
  editStage: HTMLElement
  pinListEl: HTMLElement
  pinCardEl: HTMLElement
  pinCountEl: HTMLElement
  subPanelUnit: HTMLElement
  subPanelPins: HTMLElement
  subtabBtns: NodeListOf<HTMLButtonElement>
  newPinInput: HTMLInputElement
  addPinBtn: HTMLButtonElement
  removePinBtn: HTMLButtonElement
  finishBtn: HTMLButtonElement
  showToast: ShowToast
  onDirty?: () => void
  getPoisState: () => ApartmentPoisEditorState
  setPoisState: (s: ApartmentPoisEditorState) => void
  getSelectedApartmentId: () => string | null
  getApartmentsState: () => ApartmentItem[]
  getOutlinesState: () => ApartmentOutlinesEditorState
  setOutlinesState: (s: ApartmentOutlinesEditorState) => void
  onPreviewRefresh?: () => void
  onAptSubtabChange?: (sub: 'unit' | 'pins') => void
  /** Só true em Apartamentos → sub-aba Highlights. */
  shouldShowStagePins?: () => boolean
}) {
  let selectedPinId: string | null = null
  let selectedPinIds = new Set<string>()
  /** Ordem de seleção — o 1º é o pivot de cópia/movimento em grupo. */
  let selectedPinOrder: string[] = []
  let lastListAnchorPinId: string | null = null
  let activeSub: 'unit' | 'pins' = 'unit'
  let pinDragListenersReady = false
  let activePinDrag: {
    el: HTMLElement
    poi: PoiDefinition
    dragging: boolean
    undoPushed: boolean
    grabDx: number
    grabDy: number
    startX: number
    startY: number
  } | null = null
  let snapGuideXEl: HTMLElement | null = null
  let snapGuideYEl: HTMLElement | null = null
  let pinDragOrigin: {
    pinX: number
    pinY: number
    outlinePoints: ReturnType<typeof cloneOutlinePoints> | null
  } | null = null
  type PinDragSnapshot = {
    pinX: number
    pinY: number
    outlinePoints: ReturnType<typeof cloneOutlinePoints> | null
  }
  let pinDragGroup: Map<string, PinDragSnapshot> | null = null
  let copiedHighlightBatch: CopiedHighlightBatch | null = null
  type HighlightUndoSnapshot = {
    pois: ApartmentPoisEditorState
    outlines: ApartmentOutlinesEditorState
    selectedPinOrder: string[]
    selectedPinIds: string[]
    selectedPinId: string | null
  }
  const highlightUndoStack: HighlightUndoSnapshot[] = []
  let highlightUndoRestoring = false
  let highlightGeometryUndoArmed = false
  let inlineLabelEditor: { wrap: HTMLElement; input: HTMLInputElement; pinId: string } | null =
    null
  const HIGHLIGHT_TRIPLE_CLICK_MS = 520
  let highlightTripleClicks: { pinId: string; times: number[] } | null = null
  let highlightPointerDown: { pinId: string; x: number; y: number } | null = null

  const notifyDirty = () => deps.onDirty?.()

  function pushHighlightUndo() {
    if (highlightUndoRestoring) return
    highlightUndoStack.push({
      pois: clonePoisState(deps.getPoisState()),
      outlines: cloneOutlinesState(deps.getOutlinesState()),
      selectedPinOrder: [...selectedPinOrder],
      selectedPinIds: [...selectedPinIds],
      selectedPinId,
    })
    if (highlightUndoStack.length > HIGHLIGHT_UNDO_MAX) highlightUndoStack.shift()
  }

  function undoHighlight() {
    if (!highlightUndoStack.length) {
      deps.showToast('Nada para desfazer')
      return
    }
    if (activePinDrag?.dragging) {
      const drag = activePinDrag
      activePinDrag = null
      pinDragOrigin = null
      pinDragGroup = null
      drag.el.classList.remove('dragging')
      hideSnapGuides()
    } else if (activePinDrag) {
      activePinDrag = null
      pinDragOrigin = null
      pinDragGroup = null
    }
    outlineLayer.cancelPendingDrag()
    closeInlineLabelEditor({ cancel: true })
    const snap = highlightUndoStack.pop()!
    highlightUndoRestoring = true
    deps.setPoisState(snap.pois)
    deps.setOutlinesState(snap.outlines)
    selectedPinOrder = [...snap.selectedPinOrder]
    selectedPinIds = new Set(snap.selectedPinIds)
    selectedPinId = snap.selectedPinId
    highlightUndoRestoring = false
    highlightGeometryUndoArmed = false
    notifyDirty()
    renderPinsPanel()
    deps.showToast('Ação desfeita')
  }

  function armHighlightGeometryUndo() {
    if (highlightGeometryUndoArmed) return
    pushHighlightUndo()
    highlightGeometryUndoArmed = true
  }

  function getSelectedPinIdList(): string[] {
    if (selectedPinOrder.length) {
      return selectedPinOrder.filter((id) => selectedPinIds.has(id))
    }
    if (selectedPinIds.size) return [...selectedPinIds]
    return selectedPinId ? [selectedPinId] : []
  }

  function getPivotPinId(): string | null {
    return getSelectedPinIdList()[0] ?? selectedPinId
  }

  function addPinToSelectionOrder(id: string) {
    if (!selectedPinOrder.includes(id)) selectedPinOrder.push(id)
  }

  function removePinFromSelectionOrder(id: string) {
    selectedPinOrder = selectedPinOrder.filter((pid) => pid !== id)
  }

  function isPinSelected(id: string): boolean {
    return selectedPinIds.has(id)
  }

  function clearPinSelection() {
    selectedPinIds.clear()
    selectedPinOrder = []
    selectedPinId = null
    lastListAnchorPinId = null
  }

  function shouldShowOnStage() {
    return Boolean(deps.shouldShowStagePins?.()) && activeSub === 'pins'
  }

  /** Pins da unidade selecionada no submenu (cada face do prédio tem sua própria lista). */
  function getHighlightAptId(): string | null {
    const selected = deps.getSelectedApartmentId()
    if (selected) return selected
    if (!deps.getApartmentsState().length) return null
    return getFacadeApartmentId()
  }

  function getStageCoverImage(): HTMLImageElement | null {
    return getHighlightFacadeImage()
  }

  function getHighlightMetrics() {
    return resolveHighlightFacadeMetrics(getStageView, deps.editStage)
  }

  let pendingImageRender = false

  function scheduleRenderWhenImageReady() {
    if (!shouldShowOnStage() || pendingImageRender) return
    if (getStageCoverImage()) {
      renderPins()
      return
    }
    pendingImageRender = true
    const off = onEditBgReady((layer) => {
      if (layer !== 'facade') return
      off()
      pendingImageRender = false
      if (shouldShowOnStage() && getStageCoverImage()) renderPins()
    })
  }


  function getPinLabel(pinId: string): string {
    const aptId = getHighlightAptId()
    if (!aptId) return pinId
    const pin = getPinsForApt(aptId).find((p) => p.id === pinId)
    return pin?.label?.trim() || pinId
  }

  function nextPinId(aptId: string): string {
    const pins = getPinsForApt(aptId)
    const used = new Set(pins.map((p) => p.id))
    let n = pins.length + 1
    while (used.has(`${aptId}-h-${n}`)) n++
    return `${aptId}-h-${n}`
  }

  function getStageLayoutRect(): DOMRect {
    const metrics = getHighlightMetrics()
    if (metrics) return metrics.rect
    const viewport = document.getElementById('edit-stage-viewport')
    return (viewport ?? deps.editStage).getBoundingClientRect()
  }

  function getStageView(): StageViewTransform | null {
    return getActiveEditStageViewport()?.getView() ?? null
  }

  function pointerToImage(clientX: number, clientY: number) {
    const metrics = getHighlightMetrics()
    if (!metrics) return null
    return pointerToHighlightImagePoint(clientX, clientY, metrics)
  }

  function imageToStagePct(xImg: number, yImg: number) {
    const metrics = getHighlightMetrics()
    if (!metrics) return null
    return highlightImageToStagePct(xImg, yImg, metrics)
  }

  const outlineLayer = createHighlightOutlineLayer({
    editStage: deps.editStage,
    getOutlinesState: deps.getOutlinesState,
    setOutlinesState: deps.setOutlinesState,
    getActiveSceneId: () => getHighlightAptId(),
    getActivePinId: () => selectedPinId,
    getSelectedPinIds: () => getSelectedPinIdList(),
    getPivotPinId: () => getPivotPinId(),
    getScenePinIds: () => {
      const aptId = getHighlightAptId()
      if (!aptId) return []
      return getPinsForApt(aptId).map((p) => p.id)
    },
    getPinLabel,
    isVisible: () => shouldShowOnStage(),
    onDirty: () => notifyDirty(),
    onGeometryDragStart: () => armHighlightGeometryUndo(),
    onGeometryChanged: () => {
      highlightGeometryUndoArmed = false
      for (const id of getSelectedPinIdList()) syncPinToOutlineCentroidForPin(id)
      if (shouldShowOnStage()) outlineLayer.requestSync()
      markOutlineInteractionEnd()
    },
    onGeometryChanging: (pinId, points) => {
      syncPinToOutlineCentroidForPin(pinId, { visualOnly: true, points })
    },
    getStageCoverImage,
    getStageLayoutRect,
    getStageView,
    onEdgeClick: () => renderPinsPanel(),
    onOutlineClick: (pinId, opts) => {
      const aptId = getHighlightAptId()
      if (!aptId) return
      const poi = getPinsForApt(aptId).find((p) => p.id === pinId)
      if (poi) {
        selectPin(poi, {
          refreshStage: false,
          mode: opts?.addToSelection ? 'toggle' : 'replace',
        })
      }
    },
    ensurePinSelected: (pinId) => {
      if (isPinSelected(pinId) && selectedPinIds.size > 1) {
        if (selectedPinId !== pinId) {
          selectedPinId = pinId
          renderPinList()
          updatePinSelectionVisual()
          if (shouldShowOnStage()) outlineLayer.requestSync()
        }
        return
      }
      if (selectedPinId === pinId && selectedPinIds.size <= 1) return
      if (outlineLayer.isGeometryInteractionActive()) return
      const aptId = getHighlightAptId()
      if (!aptId) return
      const poi = getPinsForApt(aptId).find((p) => p.id === pinId)
      if (!poi) return
      selectPin(poi, { refreshStage: false, mode: 'replace' })
    },
    onOutlineLabelEdit: (pinId) => openHighlightLabelEdit(pinId),
  })

  function isHighlightStageTarget(target: HTMLElement): boolean {
    return Boolean(
      target.closest('.edit-apt-pin') ||
        target.closest('.edit-outline-label-editor') ||
        target.closest('.edit-outline-vertex') ||
        target.closest('.edit-outline-vertex-hit') ||
        target.closest('.edit-highlight-outline-body-hit') ||
        target.closest('.edit-highlight-outline-edge-hit') ||
        target.closest('.edit-outline-edge-handle') ||
        target.closest('.edit-outline-edge-handle-hit'),
    )
  }

  function focusViewportOnSelected() {
    const ids = getSelectedPinIdList()
    if (!ids.length) {
      deps.showToast('Selecione um highlight para focar')
      return
    }
    const allPoints: OutlinePoint[] = []
    for (const id of ids) {
      const outline = outlineLayer.getPinOutline(id)
      if (outline?.points?.length) allPoints.push(...outline.points)
    }
    if (!allPoints.length) {
      deps.showToast('Highlight sem contorno')
      return
    }
    getActiveEditStageViewport()?.focusOnPoints(allPoints)
  }

  function getSelectedOutlineBbox() {
    if (!selectedPinId) return null
    const outline = outlineLayer.getPinOutline(selectedPinId)
    if (!outline?.points?.length || outline.points.length < 3) return null
    return outlineBBox(outline.points)
  }

  function syncPinToOutlineCentroidForPin(
    pinId: string,
    opts?: { visualOnly?: boolean; points?: OutlinePoint[] },
  ) {
    const aptId = getHighlightAptId()
    if (!aptId) return false
    const pin = getPinsForApt(aptId).find((p) => p.id === pinId)
    const fromPoints = opts?.points
    const outline = fromPoints
      ? { points: fromPoints, coordSpace: 'image' as const }
      : outlineLayer.getPinOutline(pinId)
    if (!pin || !outline?.points?.length || outline.points.length < 3) return false
    const c = outlineCentroid(outline.points)
    pin.x = round1(c.x)
    pin.y = round1(c.y)
    pin.coordSpace = 'image'
    pin.highlightAnchor = 'center'

    if (!opts?.visualOnly) {
      commitAptPinsState(aptId)
    }

    const el = deps.editStage.querySelector<HTMLElement>(`.edit-apt-pin[data-id="${pin.id}"]`)
    if (el) applyPinPosition(el, pin)
    if (pin.id === selectedPinId) updatePinCoordsInCard(pin)

    if (!opts?.visualOnly && shouldShowOnStage() && pinId === selectedPinId) {
      outlineLayer.requestSync()
    }
    return true
  }

  function centerAllHighlightPinsOnOutlines(map: ApartmentPoisEditorState) {
    const outlines = deps.getOutlinesState().byPin
    for (const pins of Object.values(map)) {
      for (const pin of pins) {
        const outline = outlines[pin.id]
        if (!outline?.points?.length || outline.points.length < 3) continue
        const c = outlineCentroid(outline.points)
        pin.x = round1(c.x)
        pin.y = round1(c.y)
        pin.coordSpace = 'image'
        pin.highlightAnchor = 'center'
      }
    }
  }

  function migratePinsForScene(aptId: string) {
    const pins = getPinsForApt(aptId)
    let dirty = false
    for (const pin of pins) {
      const outline = outlineLayer.getPinOutline(pin.id)
      if (!outline) {
        outlineLayer.migrateFromPin(pin.id, pin.x, pin.y)
      } else {
        const c = outlineLayer.outlineCentroid(outline.points)
        if (Math.abs(pin.x - c.x) >= 0.05 || Math.abs(pin.y - c.y) >= 0.05) {
          pin.x = round1(c.x)
          pin.y = round1(c.y)
          pin.coordSpace = 'image'
          pin.highlightAnchor = 'center'
          dirty = true
        }
      }
    }
    if (dirty) {
      deps.setPoisState({ ...deps.getPoisState(), [aptId]: [...pins] })
      notifyDirty()
    }
  }

  function createHighlightAt(aptId: string, x: number, y: number, label?: string) {
    pushHighlightUndo()
    const pins = ensureAptPinsList(aptId)
    const unitLabel = label?.trim() || `Apartamento ${pins.length + 1}`
    const id = nextPinId(aptId)
    const poi: PoiDefinition = {
      id,
      label: unitLabel,
      x: round1(x),
      y: round1(y),
      coordSpace: 'image',
      highlightAnchor: 'center',
      tag: 'Planta',
      title: unitLabel,
      desc: 'Planta baixa do apartamento.',
    }
    pins.push(poi)
    deps.setPoisState({ ...deps.getPoisState(), [aptId]: [...pins] })
    outlineLayer.createRectAt(id, poi.x, poi.y)
    selectedPinIds = new Set([id])
    selectedPinOrder = [id]
    selectedPinId = id
    lastListAnchorPinId = id
    notifyDirty()
    return poi
  }

  function copySelectedHighlight() {
    const aptId = getHighlightAptId()
    const orderedIds = getSelectedPinIdList()
    if (!aptId || !orderedIds.length) {
      deps.showToast('Selecione um ou mais highlights para copiar')
      return
    }
    const pivotId = orderedIds[0]!
    const pivotPin = getPinsForApt(aptId).find((p) => p.id === pivotId)
    const pivotOutline = outlineLayer.getPinOutline(pivotId)
    if (!pivotPin || !pivotOutline) {
      deps.showToast('Highlight pivot sem contorno válido')
      return
    }
    const pivotX = pivotPin.x
    const pivotY = pivotPin.y
    const items: CopiedHighlightItem[] = []
    for (const id of orderedIds) {
      const outline = outlineLayer.getPinOutline(id)
      const pin = getPinsForApt(aptId).find((p) => p.id === id)
      if (!outline || !pin) continue
      const cx = outlineCentroid(outline.points).x
      const alignedOutline = translateOutlinePoints(outline.points, pivotX - cx, 0)
      const outlineRel = alignedOutline.map((p) => ({
        x: round1(p.x - pivotX),
        y: round1(p.y - pivotY),
      }))
      const { id: _id, x: _x, y: _y, ...pinFields } = pin
      items.push({
        pinFields,
        dPivotY: round1(pin.y - pivotY),
        outlineRel,
      })
    }
    if (!items.length) {
      deps.showToast('Nenhum highlight com contorno válido')
      return
    }
    copiedHighlightBatch = {
      pivotX,
      pivotY,
      pivotOutline: cloneOutlinePoints(pivotOutline.points),
      items,
    }
    const n = items.length
    deps.showToast(
      n === 1
        ? `"${items[0]!.pinFields.label}" copiado — Ctrl+V para colar`
        : `${n} highlights copiados (pivot: ${pivotPin.label}) — Ctrl+V para colar em lote`,
    )
  }

  function pasteHighlight() {
    const aptId = getHighlightAptId()
    if (!aptId) {
      deps.showToast('Selecione a face na lista de unidades')
      return
    }
    const batch = copiedHighlightBatch
    if (!batch?.items.length) {
      deps.showToast('Nada copiado — selecione highlights e use Ctrl+C')
      return
    }
    pushHighlightUndo()
    const pins = [...getPinsForApt(aptId)]
    const outlines = deps.getOutlinesState()
    const nextByPin = { ...outlines.byPin }
    const newIds: string[] = []
    const usedIds = new Set(pins.map((p) => p.id))
    const { dx: pasteDx, dy: pasteDy } = computePasteOffset(batch.pivotOutline)
    const newPivotX = round1(batch.pivotX + pasteDx)
    const newPivotY = round1(batch.pivotY + pasteDy)

    for (const item of batch.items) {
      let n = pins.length + 1
      while (usedIds.has(`${aptId}-h-${n}`)) n++
      const newId = `${aptId}-h-${n}`
      usedIds.add(newId)
      const nextPoints = item.outlineRel.map((p) => ({
        x: round1(newPivotX + p.x),
        y: round1(newPivotY + p.y),
      }))
      const centroid = outlineCentroid(nextPoints)
      const poi: PoiDefinition = {
        ...item.pinFields,
        id: newId,
        x: round1(centroid.x),
        y: round1(centroid.y),
        coordSpace: 'image',
        highlightAnchor: 'center',
      }
      pins.push(poi)
      nextByPin[newId] = { points: nextPoints, coordSpace: 'image' }
      newIds.push(newId)
    }
    deps.setPoisState({ ...deps.getPoisState(), [aptId]: [...pins] })
    deps.setOutlinesState({ ...outlines, byPin: nextByPin })
    selectedPinIds = new Set(newIds)
    selectedPinOrder = [...newIds]
    selectedPinId = newIds[0] ?? null
    lastListAnchorPinId = selectedPinId
    notifyDirty()
    renderPinsPanel()
    focusViewportOnSelected()
    const n = newIds.length
    deps.showToast(
      n === 1
        ? `"${batch.items[0]!.pinFields.label}" colado ao lado — ajuste o andar/nome se precisar`
        : `${n} highlights colados na mesma coluna do pivot — ajuste nomes se precisar`,
    )
  }

  function setSubtab(sub: 'unit' | 'pins') {
    activeSub = sub
    deps.subtabBtns.forEach((btn) => {
      const s = btn.dataset.aptSub as 'unit' | 'pins'
      btn.classList.toggle('active', s === sub)
      btn.setAttribute('aria-selected', s === sub ? 'true' : 'false')
    })
    deps.subPanelUnit.hidden = sub !== 'unit'
    deps.subPanelPins.hidden = sub !== 'pins'
    deps.onPreviewRefresh?.()
    if (sub === 'pins' && shouldShowOnStage()) renderPins()
    else {
      closeInlineLabelEditor({ cancel: true })
      clearAptPinsFromStage()
    }
  }

  function syncSubtabsVisibility() {
    const aptId = getHighlightAptId()
    const show = Boolean(aptId)
    const subtabs = deps.subtabBtns[0]?.closest('.edit-apt-subtabs') as HTMLElement | null
    if (subtabs) subtabs.hidden = !show
    if (!show) {
      setSubtab('unit')
      clearPinSelection()
      clearAptPinsFromStage()
    }
  }

  function resolveHighlightPinFromPointer(e: {
    clientX: number
    clientY: number
    target: EventTarget | null
  }): string | null {
    const el = e.target instanceof Element ? e.target : null
    if (el) {
      if (
        el.closest(
          '.edit-outline-vertex, .edit-outline-vertex-hit, .edit-outline-edge-handle, .edit-outline-edge-handle-hit, .edit-highlight-outline-edge-hit',
        )
      ) {
        return null
      }
      const bodyHit = el.closest('.edit-highlight-outline-body-hit') as SVGElement | null
      if (bodyHit?.dataset.pin) return bodyHit.dataset.pin
      const aptPin = el.closest('.edit-apt-pin') as HTMLElement | null
      if (aptPin?.dataset.id) return aptPin.dataset.id
      const grouped = el.closest('.edit-highlight-outline-group [data-pin]') as SVGElement | null
      if (grouped?.dataset.pin) return grouped.dataset.pin
    }
    return outlineLayer.isClickInsideHighlight(e.clientX, e.clientY)
  }

  function openHighlightLabelEdit(pinId: string) {
    highlightTripleClicks = null
    activePinDrag = null
    pinDragOrigin = null
    outlineLayer.cancelPendingDrag()
    startInlineLabelEdit(pinId)
  }

  let suppressStageClickUntil = 0

  function markOutlineInteractionEnd() {
    suppressStageClickUntil = Date.now() + 120
  }

  function registerHighlightTripleClickListeners() {
    const viewport =
      document.getElementById('edit-stage-viewport') ??
      (deps.editStage.parentElement as HTMLElement | null)
    if (!viewport) return

    viewport.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return
        if (!shouldShowOnStage() || deps.subPanelPins.hidden) return
        const target = e.target as HTMLElement
        if (
          target.closest('.edit-outline-vertex-hit') ||
          target.closest('.edit-outline-vertex') ||
          target.closest('.edit-outline-edge-handle-hit') ||
          target.closest('.edit-highlight-outline-edge-hit')
        ) {
          highlightPointerDown = null
          return
        }
        const pinId = resolveHighlightPinFromPointer(e)
        if (!pinId) {
          highlightPointerDown = null
          return
        }
        highlightPointerDown = { pinId, x: e.clientX, y: e.clientY }
      },
      true,
    )

    viewport.addEventListener(
      'pointerup',
      (e) => {
        if (e.button !== 0) return
        if (!shouldShowOnStage() || deps.subPanelPins.hidden) return
        if (activePinDrag?.dragging) return
        if (!highlightPointerDown) return

        const downPinId = highlightPointerDown.pinId
        const moved = Math.hypot(
          e.clientX - highlightPointerDown.x,
          e.clientY - highlightPointerDown.y,
        )
        highlightPointerDown = null

        const pinId = resolveHighlightPinFromPointer(e) ?? downPinId
        if (pinId !== downPinId || moved > 12) {
          highlightTripleClicks = null
          return
        }

        const now = Date.now()
        if (!highlightTripleClicks || highlightTripleClicks.pinId !== pinId) {
          highlightTripleClicks = { pinId, times: [now] }
          return
        }

        highlightTripleClicks.times = highlightTripleClicks.times.filter(
          (t) => now - t < HIGHLIGHT_TRIPLE_CLICK_MS,
        )
        highlightTripleClicks.times.push(now)
        if (highlightTripleClicks.times.length < 3) return

        outlineLayer.cancelPendingDrag()
        e.stopPropagation()
        e.preventDefault()
        openHighlightLabelEdit(pinId)
      },
      true,
    )
  }

  registerHighlightTripleClickListeners()

  function clearAptPinsFromStage(force = false) {
    if (!force && isStageInteractionActive()) return
    activePinDrag = null
    pinDragOrigin = null
    deps.editStage.querySelectorAll('.edit-apt-pin').forEach((el) => el.remove())
    outlineLayer.clear(force)
    hideSnapGuides()
  }

  function commitPinLabel(
    poi: PoiDefinition,
    label: string,
    opts?: { title?: string; tag?: string; toast?: boolean },
  ): boolean {
    const trimmed = label.trim()
    if (!trimmed) {
      deps.showToast('O nome do pin não pode ficar vazio')
      return false
    }
    const prev = poi.label
    const nextTitle = opts?.title !== undefined ? opts.title.trim() || trimmed : poi.title
    const nextTag = opts?.tag !== undefined ? opts.tag.trim() || 'Planta' : poi.tag
    if (
      trimmed === prev &&
      (opts?.title === undefined || nextTitle === poi.title) &&
      (opts?.tag === undefined || nextTag === poi.tag)
    ) {
      return true
    }
    pushHighlightUndo()
    poi.label = trimmed
    if (opts?.title !== undefined) poi.title = nextTitle
    else if (poi.title === prev || !poi.title.trim()) poi.title = trimmed
    if (opts?.tag !== undefined) poi.tag = nextTag
    const aptId = getHighlightAptId()
    if (aptId) commitAptPinsState(aptId)
    renderPins()
    renderPinList()
    void renderPinCard(poi)
    notifyDirty()
    if (opts?.toast !== false) deps.showToast(`"${trimmed}" atualizado`)
    return true
  }

  function closeInlineLabelEditor(opts?: { cancel?: boolean }) {
    if (!inlineLabelEditor) return
    inlineLabelEditor.wrap.remove()
    inlineLabelEditor = null
    if (opts?.cancel) return
  }

  function repositionInlineLabelEditor() {
    if (!inlineLabelEditor) return
    const outline = outlineLayer.getPinOutline(inlineLabelEditor.pinId)
    if (!outline?.points?.length) return
    const c = outlineCentroid(outline.points)
    const pos = imageToStagePct(c.x, c.y)
    if (!pos) return
    inlineLabelEditor.wrap.style.left = `${pos.x}%`
    inlineLabelEditor.wrap.style.top = `${pos.y}%`
  }

  function startInlineLabelEdit(pinId: string) {
    const aptId = getHighlightAptId()
    if (!aptId) return
    const poi = getPinsForApt(aptId).find((p) => p.id === pinId)
    if (!poi) return
    selectPin(poi, { refreshStage: false })

    closeInlineLabelEditor({ cancel: true })

    const outline = outlineLayer.getPinOutline(pinId)
    if (!outline?.points?.length) return
    const c = outlineCentroid(outline.points)
    const pos = imageToStagePct(c.x, c.y)
    if (!pos) return

    const crmClass = crmStatusClass(getCrmStatusForUnit(poi.label))
    const wrap = document.createElement('div')
    wrap.className = `edit-outline-label-editor ${crmClass}`
    wrap.style.left = `${pos.x}%`
    wrap.style.top = `${pos.y}%`

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'edit-outline-label-input'
    input.maxLength = 48
    input.value = poi.label
    input.placeholder = 'Ex.: 1102'
    input.setAttribute('aria-label', 'Nome da unidade (CRM)')

    wrap.appendChild(input)
    deps.editStage.appendChild(wrap)
    inlineLabelEditor = { wrap, input, pinId }

    let committing = false
    const commit = () => {
      if (committing) return
      committing = true
      const next = input.value.trim()
      if (!next) {
        deps.showToast('O nome do pin não pode ficar vazio')
        input.value = poi.label
        committing = false
        input.focus()
        return
      }
      closeInlineLabelEditor({ cancel: true })
      commitPinLabel(poi, next)
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeInlineLabelEditor({ cancel: true })
      }
    })
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (inlineLabelEditor?.input === input) commit()
      }, 0)
    })

    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  }

  function migratePinsIfNeeded(aptId: string, pins: PoiDefinition[]) {
    const img = getStageCoverImage()
    if (!img) return
    const layout = getStageLayoutRect()
    const cover = getStillViewFitRect(layout.width, layout.height, img.naturalWidth, img.naturalHeight)
    if (!cover) return
    let dirty = false
    for (const poi of pins) {
      if (
        ensureImageCoordSpace(poi, layout.width, layout.height, img.naturalWidth, img.naturalHeight, {
          legacyCenterAnchor: true,
        })
      ) {
        dirty = true
      }
      if (migrateAptHighlightToCenterAnchor(poi, cover)) dirty = true
    }
    if (dirty) {
      deps.setPoisState({ ...deps.getPoisState(), [aptId]: pins })
      notifyDirty()
      deps.showToast('Posições convertidas para a foto — Finalizar pins')
    }
  }

  function updatePinSelectionVisual() {
    const aptId = getHighlightAptId()
    const pins = aptId ? getPinsForApt(aptId) : []
    deps.editStage.querySelectorAll<HTMLElement>('.edit-apt-pin').forEach((el) => {
      const id = el.dataset.id
      const poi = id ? pins.find((p) => p.id === id) : null
      el.classList.toggle('selected', Boolean(id && isPinSelected(id)))
      el.classList.toggle('is-locked', Boolean(poi?.positionLocked))
    })
  }

  function computeGrabOffset(
    clientX: number,
    clientY: number,
    poi: PoiDefinition,
  ): { dx: number; dy: number } {
    const ptr = pointerToImage(clientX, clientY)
    if (!ptr) return { dx: 0, dy: 0 }
    return { dx: ptr.x - poi.x, dy: ptr.y - poi.y }
  }

  function pointerToPinCenter(
    clientX: number,
    clientY: number,
    grabDx: number,
    grabDy: number,
  ): { x: number; y: number } | null {
    const ptr = pointerToImage(clientX, clientY)
    if (!ptr) return null
    return { x: ptr.x - grabDx, y: ptr.y - grabDy }
  }

  function applyPinPosition(el: HTMLElement, poi: PoiDefinition) {
    const pos = imageToStagePct(poi.x, poi.y)
    if (pos) {
      el.style.left = `${pos.x}%`
      el.style.top = `${pos.y}%`
      return
    }
    el.style.left = `${poi.x}%`
    el.style.top = `${poi.y}%`
  }

  function imageGuideToStagePct(xImg: number, yImg: number) {
    return imageToStagePct(xImg, yImg) ?? { x: xImg, y: yImg }
  }

  function alignAllPinsToColumn(anchor: PoiDefinition) {
    const aptId = getHighlightAptId()
    if (!aptId) return
    pushHighlightUndo()
    const pins = getPinsForApt(aptId)
    const colX = anchor.x
    const next = pins.map((p) => (p.id === anchor.id ? p : { ...p, x: colX }))
    deps.setPoisState({ ...deps.getPoisState(), [aptId]: next })
    renderPins()
    renderPinList()
    notifyDirty()
    deps.showToast(`Todos os pins alinhados na coluna ${colX}%`)
  }

  function alignAllPinsToRow(anchor: PoiDefinition) {
    const aptId = getHighlightAptId()
    if (!aptId) return
    pushHighlightUndo()
    const pins = getPinsForApt(aptId)
    const rowY = anchor.y
    const next = pins.map((p) => (p.id === anchor.id ? p : { ...p, y: rowY }))
    deps.setPoisState({ ...deps.getPoisState(), [aptId]: next })
    renderPins()
    renderPinList()
    notifyDirty()
    deps.showToast(`Todos os pins alinhados na linha ${rowY}%`)
  }

  function readPinsForApt(aptId: string): PoiDefinition[] {
    return deps.getPoisState()[aptId] ?? []
  }

  function ensureAptPinsList(aptId: string): PoiDefinition[] {
    const map = deps.getPoisState()
    if (map[aptId]) return map[aptId]
    const next = { ...map, [aptId]: [] as PoiDefinition[] }
    deps.setPoisState(next)
    return next[aptId]
  }

  function getPinsForApt(aptId: string): PoiDefinition[] {
    return readPinsForApt(aptId)
  }

  function isStageInteractionActive() {
    return (
      outlineLayer.isGeometryInteractionActive() ||
      outlineLayer.isGeometryPendingInteraction?.() ||
      Boolean(activePinDrag)
    )
  }

  function commitAptPinsState(aptId: string) {
    const map = deps.getPoisState()
    const pins = getPinsForApt(aptId).map((p) => ({ ...p }))
    deps.setPoisState({ ...map, [aptId]: pins })
  }

  function renderPinList() {
    const aptId = getHighlightAptId()
    if (!aptId) {
      deps.pinListEl.innerHTML = ''
      deps.pinCountEl.textContent = '0 pins'
      return
    }
    const pins = getPinsForApt(aptId)
    deps.pinCountEl.textContent = `${pins.length} pin${pins.length === 1 ? '' : 's'}`
    deps.pinListEl.innerHTML = pins
      .map((p) => {
        const crm = crmStatusClass(getCrmStatusForUnit(p.label))
        const crmLabel = getCrmStatusLabel(getCrmStatusForUnit(p.label))
        const known = isCrmUnitKnown(p.label)
        return `
      <button type="button" class="edit-pin-list-item${isPinSelected(p.id) ? ' active' : ''}" data-id="${p.id}">
        <span class="edit-pin-list-dot ${crm}" title="${escapeAttr(crmLabel)}">+</span>
        <span class="edit-pin-list-label">${escapeHtml(p.label)}</span>
        <span class="edit-pin-list-crm ${crm}">${escapeHtml(known ? crmLabel : '—')}</span>
      </button>
    `
      })
      .join('')

    deps.pinListEl.querySelectorAll<HTMLButtonElement>('.edit-pin-list-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id!
        const poi = pins.find((p) => p.id === id)
        if (!poi) return
        const mod = e.ctrlKey || e.metaKey
        if (e.shiftKey && lastListAnchorPinId) {
          selectPinRange(poi)
        } else if (mod) {
          selectPin(poi, { mode: 'toggle' })
        } else {
          selectPin(poi)
        }
      })
    })
  }

  function selectPinRange(toPoi: PoiDefinition, opts?: { refreshStage?: boolean }) {
    outlineLayer.cancelPendingDrag()
    const aptId = getHighlightAptId()
    if (!aptId) return
    const pins = getPinsForApt(aptId)
    const anchorId = lastListAnchorPinId ?? selectedPinId
    if (!anchorId) {
      selectPin(toPoi, opts)
      return
    }
    const fromIdx = pins.findIndex((p) => p.id === anchorId)
    const toIdx = pins.findIndex((p) => p.id === toPoi.id)
    if (fromIdx < 0 || toIdx < 0) {
      selectPin(toPoi, opts)
      return
    }
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    for (let i = lo; i <= hi; i++) {
      const id = pins[i]!.id
      selectedPinIds.add(id)
      addPinToSelectionOrder(id)
    }
    selectedPinId = toPoi.id
    lastListAnchorPinId = toPoi.id
    renderPinList()
    updatePinSelectionVisual()
    if (opts?.refreshStage !== false) renderPins()
    else if (shouldShowOnStage()) outlineLayer.requestSync()
    void renderPinCard(toPoi)
    deps.removePinBtn.disabled = false
  }

  function selectPin(
    poi: PoiDefinition,
    opts?: { refreshStage?: boolean; mode?: 'replace' | 'toggle' },
  ) {
    outlineLayer.cancelPendingDrag()
    const mode = opts?.mode ?? 'replace'
    if (mode === 'toggle') {
      if (selectedPinIds.has(poi.id)) {
        selectedPinIds.delete(poi.id)
        removePinFromSelectionOrder(poi.id)
        if (selectedPinId === poi.id) {
          const remaining = getSelectedPinIdList()
          selectedPinId = remaining.length ? remaining[remaining.length - 1]! : null
        }
      } else {
        selectedPinIds.add(poi.id)
        addPinToSelectionOrder(poi.id)
        selectedPinId = poi.id
        lastListAnchorPinId = poi.id
      }
    } else {
      selectedPinIds = new Set([poi.id])
      selectedPinOrder = [poi.id]
      selectedPinId = poi.id
      lastListAnchorPinId = poi.id
    }
    renderPinList()
    updatePinSelectionVisual()
    if (opts?.refreshStage !== false) {
      renderPins()
    } else if (shouldShowOnStage()) {
      outlineLayer.requestSync()
    }
    if (selectedPinId) {
      const aptId = getHighlightAptId()
      const primary = aptId ? getPinsForApt(aptId).find((p) => p.id === selectedPinId) : undefined
      if (primary) void renderPinCard(primary)
      else deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Clique na prévia ou na lista para editar um pin.</p>`
    } else {
      deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Clique num retângulo · <strong>Ctrl+clique</strong> ou <strong>Shift+clique</strong> na lista para selecionar vários · arraste o corpo para mover em grupo.</p>`
    }
    deps.removePinBtn.disabled = selectedPinIds.size === 0
  }

  function getPinLayoutPoint(pin: PoiDefinition): { x: number; y: number } {
    const outline = outlineLayer.getPinOutline(pin.id)
    if (outline?.points?.length) return outlineCentroid(outline.points)
    return { x: pin.x, y: pin.y }
  }

  function applyBatchSequentialRename(startLabel: string) {
    const aptId = getHighlightAptId()
    if (!aptId) return
    const trimmed = startLabel.trim()
    if (!trimmed) {
      deps.showToast('Digite o primeiro nome da sequência (ex.: 1A1)')
      return
    }
    if (!/\d$/.test(trimmed)) {
      deps.showToast('O nome deve terminar em número (ex.: 1A1, 1102)')
      return
    }
    const ids = getSelectedPinIdList()
    if (ids.length < 2) {
      deps.showToast('Selecione 2 ou mais highlights (Ctrl+clique na lista)')
      return
    }
    const pins = getPinsForApt(aptId).filter((p) => ids.includes(p.id))
    const rows = groupPinsByRow(pins, getPinLayoutPoint)
    pushHighlightUndo()
    let total = 0
    for (const row of rows) {
      row.forEach((pin, index) => {
        const newLabel = incrementTrailingNumber(trimmed, index)
        pin.label = newLabel
        pin.title = newLabel
        total++
      })
    }
    commitAptPinsState(aptId)
    renderPins()
    renderPinList()
    const primaryId = selectedPinId ?? ids[0]
    const primary = pins.find((p) => p.id === primaryId) ?? pins[0]
    if (primary) void renderPinCard(primary)
    notifyDirty()
    const rowSummary =
      rows.length === 1
        ? `${total} nomes (${trimmed} → ${incrementTrailingNumber(trimmed, total - 1)})`
        : `${total} nomes em ${rows.length} linhas`
    deps.showToast(`Renomeado: ${rowSummary} · esquerda → direita`)
  }

  function repositionPinElements() {
    const aptId = getHighlightAptId()
    if (!aptId) return
    getPinsForApt(aptId).forEach((poi) => {
      const el = deps.editStage.querySelector<HTMLElement>(`.edit-apt-pin[data-id="${poi.id}"]`)
      if (el) applyPinPosition(el, poi)
    })
    repositionInlineLabelEditor()
  }

  function syncStageLayout() {
    if (!shouldShowOnStage()) {
      clearAptPinsFromStage()
      return
    }
    if (!getStageCoverImage()) {
      scheduleRenderWhenImageReady()
      return
    }
    repositionPinElements()
    outlineLayer.requestSync()
  }

  function syncHighlightStageGeometry() {
    if (!shouldShowOnStage()) {
      clearAptPinsFromStage()
      return
    }
    if (isStageInteractionActive()) {
      repositionPinElements()
      outlineLayer.queueRender()
      return
    }
    if (deps.editStage.querySelector('.edit-apt-pin')) {
      syncStageLayout()
      return
    }
    renderPins()
  }

  function renderPins() {
    if (!shouldShowOnStage()) return
    if (!getStageCoverImage()) {
      clearAptPinsFromStage()
      scheduleRenderWhenImageReady()
      return
    }
    clearAptPinsFromStage()
    const aptId = getHighlightAptId()
    if (!aptId) return
    migratePinsForScene(aptId)
    const pins = getPinsForApt(aptId)
    migratePinsIfNeeded(aptId, pins)
    outlineLayer.requestSync()
    pins.forEach((poi) => {
      const el = document.createElement('div')
      const locked = Boolean(poi.positionLocked)
      el.className =
        'edit-pin edit-apt-pin' +
        (isPinSelected(poi.id) ? ' selected' : '') +
        (locked ? ' is-locked' : '')
      el.dataset.id = poi.id
      el.innerHTML = `
        <div class="edit-pin-dot">+</div>
        <div class="edit-pin-label">${escapeHtml(poi.label)}</div>
      `
      applyPinPosition(el, poi)
      if (locked) {
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          selectPin(poi)
        })
      } else {
        makeDraggable(el, poi)
      }
      deps.editStage.appendChild(el)
    })
    repositionInlineLabelEditor()
  }

  function hideSnapGuides() {
    snapGuideXEl?.classList.remove('visible')
    snapGuideYEl?.classList.remove('visible')
  }

  function showSnapGuideX(xImg: number) {
    if (!snapGuideXEl) {
      snapGuideXEl = document.createElement('div')
      snapGuideXEl.className = 'edit-apt-snap-guide edit-apt-snap-guide--v'
      snapGuideXEl.setAttribute('aria-hidden', 'true')
      deps.editStage.appendChild(snapGuideXEl)
    }
    const stage = imageGuideToStagePct(xImg, 50)
    snapGuideXEl.style.left = `${stage.x}%`
    snapGuideXEl.classList.add('visible')
  }

  function hideSnapGuideX() {
    snapGuideXEl?.classList.remove('visible')
  }

  function showSnapGuideY(yImg: number) {
    if (!snapGuideYEl) {
      snapGuideYEl = document.createElement('div')
      snapGuideYEl.className = 'edit-apt-snap-guide edit-apt-snap-guide--h'
      snapGuideYEl.setAttribute('aria-hidden', 'true')
      deps.editStage.appendChild(snapGuideYEl)
    }
    const stage = imageGuideToStagePct(50, yImg)
    snapGuideYEl.style.top = `${stage.y}%`
    snapGuideYEl.classList.add('visible')
  }

  function hideSnapGuideY() {
    snapGuideYEl?.classList.remove('visible')
  }

  function snapToPeers(
    raw: number,
    values: number[],
    stageSize: number,
  ): { value: number; guide: number | null } {
    const thresholdPct = (SNAP_THRESHOLD_PX / stageSize) * 100
    let best: { value: number; dist: number } | null = null
    for (const v of values) {
      const dist = Math.abs(raw - v)
      if (dist <= thresholdPct && (!best || dist < best.dist)) {
        best = { value: v, dist }
      }
    }
    if (best) return { value: best.value, guide: best.value }
    return { value: raw, guide: null }
  }

  /** Alinha o centro X ao centro de outro highlight (coluna). */
  function snapXToColumn(
    rawCenterX: number,
    aptId: string,
    excludeId: string,
    stageWidth: number,
  ): { x: number; guideX: number | null } {
    const pins = getPinsForApt(aptId).filter((p) => p.id !== excludeId)
    const snapped = snapToPeers(
      rawCenterX,
      pins.map((p) => p.x),
      stageWidth,
    )
    return { x: snapped.value, guideX: snapped.guide }
  }

  /** Alinha o centro Y ao centro de outro highlight (linha). */
  function snapYToRow(
    rawCenterY: number,
    aptId: string,
    excludeId: string,
    cover: { dh: number },
    _centerOffsetPx?: number,
  ): { y: number; guideY: number | null } {
    const pins = getPinsForApt(aptId).filter((p) => p.id !== excludeId)
    const snapped = snapToPeers(
      rawCenterY,
      pins.map((p) => p.y),
      cover.dh,
    )
    return { y: snapped.value, guideY: snapped.guide }
  }

  function updatePinCoordsInCard(poi: PoiDefinition) {
    const coords = deps.pinCardEl.querySelector('.edit-coords')
    if (coords) coords.textContent = `${poi.x}% · ${poi.y}%`
  }

  function movePinDrag(clientX: number, clientY: number) {
    if (!activePinDrag) return
    if (!activePinDrag.dragging) {
      const dx = clientX - activePinDrag.startX
      const dy = clientY - activePinDrag.startY
      if (Math.hypot(dx, dy) < 4) return
      if (!activePinDrag.undoPushed) {
        pushHighlightUndo()
        activePinDrag.undoPushed = true
      }
      activePinDrag.dragging = true
      activePinDrag.el.classList.add('dragging')
    }
    const { el, poi } = activePinDrag
    const aptId = getHighlightAptId()
    const layout = getStageLayoutRect()
    const img = getStageCoverImage()

    if (!img) {
      const xVp = ((clientX - layout.left) / layout.width) * 100
      const yVp = ((clientY - layout.top) / layout.height) * 100
      poi.x = round1(Math.max(0, Math.min(100, xVp)))
      poi.y = round1(Math.max(0, Math.min(100, yVp)))
      el.style.left = `${poi.x}%`
      el.style.top = `${poi.y}%`
      if (poi.id === selectedPinId) updatePinCoordsInCard(poi)
      return
    }

    const center = pointerToPinCenter(
      clientX,
      clientY,
      activePinDrag.grabDx,
      activePinDrag.grabDy,
    )
    if (!center) {
      const xVp = ((clientX - layout.left) / layout.width) * 100
      const yVp = ((clientY - layout.top) / layout.height) * 100
      poi.x = round1(Math.max(0, Math.min(100, xVp)))
      poi.y = round1(Math.max(0, Math.min(100, yVp)))
      applyPinPosition(el, poi)
      if (poi.id === selectedPinId) updatePinCoordsInCard(poi)
      return
    }
    let x = center.x
    let y = center.y

    const cover = getStillViewFitRect(layout.width, layout.height, img.naturalWidth, img.naturalHeight)
    if (aptId && cover && !pinDragOrigin?.outlinePoints) {
      const snappedX = snapXToColumn(x, aptId, poi.id, cover.dw)
      x = snappedX.x
      if (snappedX.guideX !== null) showSnapGuideX(snappedX.guideX)
      else hideSnapGuideX()

      const centerOffsetPx = measureAptPinCenterOffsetPx(el)
      const snappedY = snapYToRow(y, aptId, poi.id, cover, centerOffsetPx)
      y = snappedY.y
      if (snappedY.guideY !== null) showSnapGuideY(snappedY.guideY)
      else hideSnapGuideY()
    } else {
      hideSnapGuides()
    }

    poi.coordSpace = 'image'
    poi.x = round1(Math.max(0, Math.min(100, x)))
    poi.y = round1(Math.max(0, Math.min(100, y)))
    applyPinPosition(el, poi)
    if (poi.id === selectedPinId) updatePinCoordsInCard(poi)

    if (aptId && pinDragOrigin?.outlinePoints) {
      const dx = poi.x - pinDragOrigin.pinX
      const dy = poi.y - pinDragOrigin.pinY
      let nextPoints = translateOutlinePoints(pinDragOrigin.outlinePoints, dx, dy)
      const peers = outlineLayer.getPeerOutlinePoints(poi.id)
      const snapped = resolveOutlineBodySnap(
        nextPoints,
        peers,
        layout,
        img.naturalWidth,
        img.naturalHeight,
        { view: getStageView() },
      )
      nextPoints = snapped.points
      if (snapped.guideX !== null) showSnapGuideX(snapped.guideX)
      else hideSnapGuideX()
      if (snapped.guideY !== null) showSnapGuideY(snapped.guideY)
      else hideSnapGuideY()
      const c = outlineCentroid(nextPoints)
      poi.x = round1(c.x)
      poi.y = round1(c.y)
      outlineLayer.setPinOutline(
        poi.id,
        {
          points: nextPoints,
          coordSpace: 'image',
        },
        { silent: true },
      )
      outlineLayer.queueRender()
      applyPinPosition(el, poi)
      if (poi.id === selectedPinId) updatePinCoordsInCard(poi)
      if (pinDragOrigin && pinDragGroup) {
        applyGroupPinDrag(poi.id, poi.x - pinDragOrigin.pinX, poi.y - pinDragOrigin.pinY)
      }
      return
    }

    if (pinDragOrigin && pinDragGroup) {
      applyGroupPinDrag(poi.id, poi.x - pinDragOrigin.pinX, poi.y - pinDragOrigin.pinY)
    }
  }

  function buildPinDragGroup(leaderId: string): Map<string, PinDragSnapshot> | null {
    const aptId = getHighlightAptId()
    if (!aptId) return null
    const ordered =
      isPinSelected(leaderId) && selectedPinIds.size > 1 ? getSelectedPinIdList() : [leaderId]
    if (ordered.length <= 1) return null
    const group = new Map<string, PinDragSnapshot>()
    for (const id of ordered) {
      const pin = getPinsForApt(aptId).find((p) => p.id === id)
      const outline = outlineLayer.getPinOutline(id)
      if (!pin) continue
      group.set(id, {
        pinX: pin.x,
        pinY: pin.y,
        outlinePoints: outline ? cloneOutlinePoints(outline.points) : null,
      })
    }
    return group.size > 1 ? group : null
  }

  function applyGroupPinDrag(leaderId: string, dx: number, dy: number) {
    if (!pinDragGroup?.has(leaderId)) return
    const aptId = getHighlightAptId()
    if (!aptId) return
    for (const [id, snap] of pinDragGroup) {
      if (id === leaderId) continue
      const pin = getPinsForApt(aptId).find((p) => p.id === id)
      if (!pin) continue
      pin.coordSpace = 'image'
      pin.x = round1(Math.max(0, Math.min(100, snap.pinX + dx)))
      pin.y = round1(Math.max(0, Math.min(100, snap.pinY + dy)))
      const peerEl = deps.editStage.querySelector<HTMLElement>(`.edit-apt-pin[data-id="${id}"]`)
      if (peerEl) applyPinPosition(peerEl, pin)
      if (snap.outlinePoints) {
        outlineLayer.setPinOutline(
          id,
          {
            points: translateOutlinePoints(snap.outlinePoints, dx, dy),
            coordSpace: 'image',
          },
          { silent: true },
        )
      }
    }
    outlineLayer.queueRender()
  }

  function endPinDrag() {
    if (!activePinDrag) return
    const drag = activePinDrag
    activePinDrag = null
    if (!drag.dragging) {
      pinDragOrigin = null
      pinDragGroup = null
      return
    }
    const aptId = getHighlightAptId()
    drag.dragging = false
    drag.el.classList.remove('dragging')
    hideSnapGuides()
    const syncIds = pinDragGroup ? [...pinDragGroup.keys()] : [drag.poi.id]
    if (aptId) {
      for (const id of syncIds) {
        if (outlineLayer.getPinOutline(id)) syncPinToOutlineCentroidForPin(id)
      }
    }
    pinDragOrigin = null
    pinDragGroup = null
    if (aptId) commitAptPinsState(aptId)
    notifyDirty()
  }

  function ensurePinDragListeners() {
    if (pinDragListenersReady) return
    pinDragListenersReady = true
    document.addEventListener('mousemove', (e) => movePinDrag(e.clientX, e.clientY))
    document.addEventListener('mouseup', () => endPinDrag())
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!activePinDrag) return
        e.preventDefault()
        movePinDrag(e.touches[0].clientX, e.touches[0].clientY)
      },
      { passive: false },
    )
    document.addEventListener('touchend', () => endPinDrag())
  }

  function makeDraggable(el: HTMLElement, poi: PoiDefinition) {
    ensurePinDragListeners()

    const onDown = (e: Event) => {
      e.stopPropagation()
      if (!isPinSelected(poi.id)) selectPin(poi, { refreshStage: false })
      else if (selectedPinId !== poi.id) {
        selectedPinId = poi.id
        renderPinList()
        updatePinSelectionVisual()
        outlineLayer.requestSync()
      }
      const outline = outlineLayer.getPinOutline(poi.id)
      if (outline) {
        syncPinToOutlineCentroidForPin(poi.id)
        applyPinPosition(el, poi)
      }
      pinDragGroup = buildPinDragGroup(poi.id)
      pinDragOrigin = {
        pinX: poi.x,
        pinY: poi.y,
        outlinePoints: outline ? cloneOutlinePoints(outline.points) : null,
      }
      const ev = e as MouseEvent | TouchEvent
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
      const clientY = 'touches' in ev ? ev.touches[0].clientY : ev.clientY
      const grab = computeGrabOffset(clientX, clientY, poi)
      activePinDrag = {
        el,
        poi,
        dragging: false,
        undoPushed: false,
        grabDx: grab.dx,
        grabDy: grab.dy,
        startX: clientX,
        startY: clientY,
      }
    }

    el.querySelector('.edit-pin-dot')?.addEventListener('mousedown', onDown)
    el.querySelector('.edit-pin-dot')?.addEventListener('touchstart', onDown, { passive: true })
  }

  async function renderPinCard(poi: PoiDefinition) {
    const imgPath = poi.img ?? getProjectPoiImagePath(poi.id)
    const videoPath = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
    const pendingImg = pendingAptPinImg[poi.id]
    const savedImgPreview = imgPath ? ((await resolveMediaSrc(imgPath)) ?? '') : ''
    const pendingIsPdf = Boolean(pendingImg && isPdfFile(pendingImg.file))
    const savedIsPdf = isPdfMediaRef(imgPath || savedImgPreview)
    const imgThumbSrc =
      pendingImg && !pendingIsPdf ? pendingImg.previewUrl : savedIsPdf ? '' : savedImgPreview
    const hasSavedImg = Boolean(imgPath)
    const hasPendingImg = Boolean(pendingImg)

    let imgStatus = 'Sem PDF — envie a planta baixa'
    if (hasPendingImg) {
      imgStatus = pendingIsPdf ? 'PDF na prévia — clique Salvar' : 'Prévia — clique Salvar'
    } else if (hasSavedImg) {
      imgStatus = savedIsPdf
        ? 'PDF salvo ✓ (abre no modal 70% no site)'
        : 'Imagem salva ✓ (abre no modal no site)'
    }

    const pendingVid = pendingAptPinVideo[poi.id]
    const hasSavedVideo = Boolean(videoPath)
    const hasPendingVideo = Boolean(pendingVid)
    let videoStatus = 'Sem vídeo (opcional)'
    if (hasPendingVideo) videoStatus = 'Prévia — clique Salvar vídeo'
    else if (hasSavedVideo) videoStatus = `Salvo ✓ (${videoPath})`

    const locked = Boolean(poi.positionLocked)
    const crmStatus = getCrmStatusForUnit(poi.label)
    const crmClass = crmStatusClass(crmStatus)
    const crmLabel = getCrmStatusLabel(crmStatus)
    const crmKnown = isCrmUnitKnown(poi.label)

    const multiCount = selectedPinIds.size
    const aptIdForBatch = getHighlightAptId()
    const selectedPinsForBatch =
      multiCount > 1 && aptIdForBatch
        ? getPinsForApt(aptIdForBatch).filter((p) => isPinSelected(p.id))
        : []
    const batchRows =
      selectedPinsForBatch.length > 1
        ? groupPinsByRow(selectedPinsForBatch, getPinLayoutPoint)
        : []
    const batchStartDefault = batchRows[0]?.[0]?.label ?? '1A1'
    const batchRenameBlock =
      multiCount > 1
        ? `
      <div class="edit-field edit-field--batch-rename">
        <span class="edit-field-label">Renomear seleção em lote</span>
        <p class="edit-card-hint">Na <strong>mesma linha</strong>, da esquerda para a direita: se o primeiro for <strong>1A1</strong>, os seguintes viram 1A2, 1A3… Cada linha recomeça pelo nome que você digitar.</p>
        <div class="edit-inline-add">
          <input type="text" id="apt-pin-batch-rename" class="edit-input" maxlength="48" value="${escapeAttr(batchStartDefault)}" placeholder="Ex.: 1A1" />
          <button type="button" class="edit-btn edit-btn--gold" id="apt-pin-batch-rename-apply">Aplicar</button>
        </div>
      </div>
    `
        : ''

    deps.pinCardEl.innerHTML = `
      <p class="edit-card-kicker">${multiCount > 1 ? `${multiCount} highlights selecionados` : 'Pin selecionado'}</p>
      <p class="edit-card-hint">Atalhos: <strong>Ctrl+Z</strong> desfazer · <strong>Ctrl+C/V</strong> copiar/colar · <strong>F</strong> focar · <strong>Delete</strong> remover.</p>
      ${batchRenameBlock}
      <p class="edit-card-meta">id: ${escapeHtml(poi.id)}</p>
      <div class="edit-field">
        <span class="edit-field-label">Status CRM (Excel)</span>
        <span class="edit-badge edit-badge--crm ${crmClass}">${escapeHtml(crmKnown ? crmLabel : 'Sem match no Excel — usa verde')}</span>
        <p class="edit-card-hint">O <strong>Nome no mapa</strong> deve ser igual à coluna <strong>Unidade</strong> do Excel (ex.: <strong>1102</strong>). <strong>Triplo clique</strong> no retângulo para editar o nome na cena. Cores: verde = disponível · amarelo = reservado · vermelho = vendido.</p>
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="apt-pin-label">Nome no mapa (código CRM)</label>
        <input type="text" id="apt-pin-label" class="edit-input" maxlength="48" value="${escapeAttr(poi.label)}" placeholder="Ex.: 1102" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="apt-pin-title">Título</label>
        <input type="text" id="apt-pin-title" class="edit-input" maxlength="80" value="${escapeAttr(poi.title)}" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="apt-pin-tag">Tag</label>
        <input type="text" id="apt-pin-tag" class="edit-input" maxlength="32" value="${escapeAttr(poi.tag)}" />
      </div>
      <div class="edit-field">
        <span class="edit-field-label">Posição na face</span>
        <span class="edit-coords">${poi.x}% · ${poi.y}%</span>
        <p class="edit-card-hint">${
          locked
            ? 'Travado — cadeado trava só o pin (+). Contorno, vértices e barras continuam editáveis.'
            : 'Arraste na prévia — o número fica no <strong>centro do contorno</strong>. Retângulos <strong>grudam</strong> nas bordas/vértices dos vizinhos (guias azuis).'
        }</p>
        <div class="edit-btn-row edit-btn-row--wrap">
          <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="apt-pin-align-col">
            Coluna (X)
          </button>
          <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="apt-pin-align-row">
            Linha (Y)
          </button>
        </div>
        <button type="button" class="edit-lock-btn${locked ? ' is-locked' : ''}" id="apt-pin-lock" aria-pressed="${locked}">
          ${locked ? '🔒 Travado' : '🔓 Livre'}
        </button>
      </div>
      <div class="edit-field">
        <label class="edit-field-label">Planta baixa (PDF)</label>
        <span class="edit-badge ${hasPendingImg ? 'is-warn' : hasSavedImg ? 'is-ok' : ''}">${imgStatus}</span>
        ${
          pendingIsPdf || savedIsPdf
            ? `<div class="edit-apt-pdf-chip" aria-hidden="true">PDF</div>`
            : imgThumbSrc
              ? `<img class="edit-preview edit-preview--sm" src="${imgThumbSrc}" alt="" />`
              : ''
        }
        <div class="edit-btn-row">
          <label class="edit-btn edit-btn--ghost">Enviar PDF<input type="file" id="apt-pin-img-file" accept="application/pdf,.pdf,image/*" hidden /></label>
          <button type="button" class="edit-btn edit-btn--gold" id="apt-pin-img-save" ${hasPendingImg ? '' : 'disabled'}>Salvar</button>
          <button type="button" class="edit-btn edit-btn--text" id="apt-pin-img-clear" ${hasSavedImg || hasPendingImg ? '' : 'disabled'}>Limpar</button>
        </div>
      </div>
      <div class="edit-field">
        <label class="edit-field-label">Vídeo de transição (opcional)</label>
        <span class="edit-badge ${hasPendingVideo ? 'is-warn' : hasSavedVideo ? 'is-ok' : ''}">${videoStatus}</span>
        <div class="edit-btn-row">
          <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="apt-pin-video-file" accept="video/webm,video/mp4,video/*" hidden /></label>
          <button type="button" class="edit-btn edit-btn--gold" id="apt-pin-video-save" ${hasPendingVideo ? '' : 'disabled'}>Salvar</button>
          <button type="button" class="edit-btn edit-btn--text" id="apt-pin-video-clear" ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'}>Limpar</button>
        </div>
      </div>
    `

    bindPinCardHandlers(poi)
    if (multiCount > 1) {
      const batchInput = document.getElementById('apt-pin-batch-rename') as HTMLInputElement | null
      const batchApply = document.getElementById('apt-pin-batch-rename-apply')
      batchApply?.addEventListener('click', () => {
        if (batchInput) applyBatchSequentialRename(batchInput.value)
      })
      batchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          applyBatchSequentialRename(batchInput.value)
        }
      })
    }
  }

  function bindPinCardHandlers(poi: PoiDefinition) {
    const labelIn = document.getElementById('apt-pin-label') as HTMLInputElement
    const titleIn = document.getElementById('apt-pin-title') as HTMLInputElement
    const tagIn = document.getElementById('apt-pin-tag') as HTMLInputElement

    const commit = () => {
      const label = labelIn.value.trim()
      if (!label) {
        labelIn.value = poi.label
        deps.showToast('O nome do pin não pode ficar vazio')
        return
      }
      closeInlineLabelEditor({ cancel: true })
      commitPinLabel(poi, label, {
        title: titleIn.value,
        tag: tagIn.value,
      })
    }
    labelIn.addEventListener('change', commit)
    titleIn.addEventListener('change', commit)
    tagIn.addEventListener('change', commit)

    document.getElementById('apt-pin-lock')!.addEventListener('click', () => {
      pushHighlightUndo()
      poi.positionLocked = !poi.positionLocked
      renderPins()
      void renderPinCard(poi)
      notifyDirty()
      deps.showToast(
        poi.positionLocked
          ? 'Pin travado — contorno ainda editável'
          : 'Pin livre para arrastar',
      )
    })

    document.getElementById('apt-pin-align-col')!.addEventListener('click', () => {
      alignAllPinsToColumn(poi)
      void renderPinCard(poi)
    })

    document.getElementById('apt-pin-align-row')!.addEventListener('click', () => {
      alignAllPinsToRow(poi)
      void renderPinCard(poi)
    })

    document.getElementById('apt-pin-img-file')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const isImage = file.type.startsWith('image/')
      const isPdf = isPdfFile(file)
      if (!isImage && !isPdf) {
        deps.showToast('Use PDF ou imagem (JPG, PNG, WebP)')
        return
      }
      if (isPdf) {
        clearPendingImg(poi.id)
        pendingAptPinImg[poi.id] = { file, previewUrl: '' }
        notifyDirty()
        void renderPinCard(poi)
        return
      }
      clearPendingImg(poi.id)
      pendingAptPinImg[poi.id] = { file, previewUrl: URL.createObjectURL(file) }
      notifyDirty()
      void renderPinCard(poi)
    })

    document.getElementById('apt-pin-img-save')!.addEventListener('click', async () => {
      const pending = pendingAptPinImg[poi.id]
      if (!pending) return
      try {
        const { path } = await saveMediaToProject('poi-img', pending.file, { id: poi.id }, { reload: false })
        poi.img = path
        clearPendingImg(poi.id)
        notifyDirty()
        void renderPinCard(poi)
        deps.showToast(
          isPdfFile(pending.file) ? 'PDF salvo — Finalizar pins' : 'Planta salva — Finalizar pins',
        )
      } catch (err) {
        deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })

    document.getElementById('apt-pin-img-clear')!.addEventListener('click', async () => {
      clearPendingImg(poi.id)
      const had = Boolean(poi.img ?? getProjectPoiImagePath(poi.id))
      if (had) {
        try {
          await removeMediaFromProject('poi-img', { id: poi.id }, { reload: false })
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
          return
        }
      }
      delete poi.img
      notifyDirty()
      void renderPinCard(poi)
    })

    document.getElementById('apt-pin-video-file')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file?.type.startsWith('video/')) {
        deps.showToast('Use WebM ou MP4')
        return
      }
      pendingAptPinVideo[poi.id] = { file }
      notifyDirty()
      void renderPinCard(poi)
    })

    document.getElementById('apt-pin-video-save')!.addEventListener('click', async () => {
      const pending = pendingAptPinVideo[poi.id]
      if (!pending) return
      try {
        const { path } = await saveMediaToProject('poi-video', pending.file, { id: poi.id }, { reload: false })
        poi.transitionVideo = path
        clearPendingVideo(poi.id)
        notifyDirty()
        void renderPinCard(poi)
        deps.showToast('Vídeo salvo — Finalizar pins')
      } catch (err) {
        deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })

    document.getElementById('apt-pin-video-clear')!.addEventListener('click', async () => {
      clearPendingVideo(poi.id)
      const had = Boolean(poi.transitionVideo ?? getProjectPoiVideoPath(poi.id))
      if (had) {
        try {
          await removeMediaFromProject('poi-video', { id: poi.id }, { reload: false })
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
          return
        }
      }
      delete poi.transitionVideo
      notifyDirty()
      void renderPinCard(poi)
    })
  }

  async function flushPendingPinMedia() {
    const map = deps.getPoisState()
    for (const list of Object.values(map)) {
      for (const poi of list) {
        if (pendingAptPinImg[poi.id]) {
          const pending = pendingAptPinImg[poi.id]
          const { path } = await saveMediaToProject('poi-img', pending.file, { id: poi.id }, { reload: false })
          poi.img = path
          clearPendingImg(poi.id)
        }
        if (pendingAptPinVideo[poi.id]) {
          const pending = pendingAptPinVideo[poi.id]
          const { path } = await saveMediaToProject('poi-video', pending.file, { id: poi.id }, { reload: false })
          poi.transitionVideo = path
          clearPendingVideo(poi.id)
        }
      }
    }
  }

  async function finishPins() {
    await flushPendingPinMedia()
    const map = JSON.parse(JSON.stringify(deps.getPoisState())) as ApartmentPoisEditorState
    centerAllHighlightPinsOnOutlines(map)
    for (const list of Object.values(map)) {
      for (const poi of list) {
        const img = getProjectPoiImagePath(poi.id)
        const vid = getProjectPoiVideoPath(poi.id)
        if (img) poi.img = img
        else delete poi.img
        if (vid) poi.transitionVideo = vid
        else delete poi.transitionVideo
      }
    }
    deps.setPoisState(map)
    await saveApartmentPoisToProject(map, { reload: false })
    await saveApartmentOutlinesToProject(deps.getOutlinesState(), { reload: false })
    renderPinsPanel()
    deps.showToast('Highlights salvos — pin centralizado no contorno')
  }

  function renderPinsPanel() {
    syncSubtabsVisibility()
    const aptId = getHighlightAptId()
    deps.finishBtn.disabled = !aptId
    deps.addPinBtn.disabled = !aptId
    if (!aptId) {
      deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Adicione unidades em Apartamentos para editar highlights na fachada.</p>`
      deps.removePinBtn.disabled = true
      renderPinList()
      return
    }
    renderPinList()
    if (selectedPinId) {
      const poi = getPinsForApt(aptId).find((p) => p.id === selectedPinId)
      if (poi) void renderPinCard(poi)
      else {
        clearPinSelection()
        deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Clique na prévia ou na lista para editar um pin.</p>`
        deps.removePinBtn.disabled = true
      }
    } else {
      deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Clique num retângulo · <strong>Ctrl+clique</strong> ou <strong>Shift+clique</strong> na lista para selecionar vários · <strong>triplo clique</strong> para renomear (CRM) · <strong>duplo clique</strong> na cena para novo highlight.</p>`
      deps.removePinBtn.disabled = true
    }
    if (shouldShowOnStage()) {
      if (getStageCoverImage()) renderPins()
      else {
        clearAptPinsFromStage()
        scheduleRenderWhenImageReady()
      }
    } else clearAptPinsFromStage()
  }

  deps.subtabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.aptSub as 'unit' | 'pins'
      if (!deps.getApartmentsState().length && sub === 'pins') {
        deps.showToast('Adicione unidades em Apartamentos primeiro')
        return
      }
      if (deps.onAptSubtabChange) deps.onAptSubtabChange(sub)
      else {
        setSubtab(sub)
        renderPinsPanel()
      }
    })
  })

  deps.addPinBtn.addEventListener('click', () => {
    const aptId = getHighlightAptId()
    if (!aptId) {
      deps.showToast('Adicione unidades em Apartamentos')
      return
    }
    const label = deps.newPinInput.value.trim()
    const poi = createHighlightAt(aptId, 50, 50, label || undefined)
    if (!poi) return
    deps.newPinInput.value = ''
    setSubtab('pins')
    renderPinsPanel()
    notifyDirty()
    deps.showToast('Highlight criado — clique Finalizar highlights para salvar')
  })

  async function removeSelectedPin(opts?: { skipConfirm?: boolean }) {
    const aptId = getHighlightAptId()
    const ids = getSelectedPinIdList()
    if (!aptId || !ids.length) return
    const pins = getPinsForApt(aptId)
    const toRemove = ids.map((id) => pins.find((p) => p.id === id)).filter(Boolean) as PoiDefinition[]
    if (!toRemove.length) return
    if (!opts?.skipConfirm) {
      const msg =
        toRemove.length === 1
          ? `Remover pin "${toRemove[0]!.label}"?`
          : `Remover ${toRemove.length} highlights?`
      if (!confirm(msg)) return
    }
    pushHighlightUndo()
    const removeSet = new Set(ids)
    for (const poi of toRemove) {
      clearPendingImg(poi.id)
      clearPendingVideo(poi.id)
      if (poi.img ?? getProjectPoiImagePath(poi.id)) {
        await removeMediaFromProject('poi-img', { id: poi.id }, { reload: false }).catch(() => {})
      }
      if (poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)) {
        await removeMediaFromProject('poi-video', { id: poi.id }, { reload: false }).catch(() => {})
      }
      outlineLayer.removePinOutline(poi.id)
    }
    const next = pins.filter((p) => !removeSet.has(p.id))
    deps.setPoisState({ ...deps.getPoisState(), [aptId]: next })
    clearPinSelection()
    renderPinsPanel()
    notifyDirty()
    deps.showToast(
      toRemove.length === 1 ? 'Pin removido — Finalizar pins' : `${toRemove.length} pins removidos — Finalizar pins`,
    )
  }

  deps.removePinBtn.addEventListener('click', async () => {
    await removeSelectedPin()
  })

  document.addEventListener('keydown', (e) => {
    if (!shouldShowOnStage() || deps.subPanelPins.hidden) return
    if (isTypingTarget(e.target)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      copySelectedHighlight()
      return
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      pasteHighlight()
      return
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undoHighlight()
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      focusViewportOnSelected()
      return
    }
    if (e.key === 'Escape') {
      if (getActiveEditStageViewport()?.isZoomed()) {
        e.preventDefault()
        getActiveEditStageViewport()?.resetView()
      }
      return
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    if (!getHighlightAptId() || !getSelectedPinIdList().length) return
    e.preventDefault()
    e.stopPropagation()
    void removeSelectedPin({ skipConfirm: true })
  })

  deps.editStage.addEventListener('click', (e) => {
    if (!shouldShowOnStage() || deps.subPanelPins.hidden) return
    if (Date.now() < suppressStageClickUntil) return
    const target = e.target as HTMLElement
    if (isHighlightStageTarget(target)) return
    const aptId = getHighlightAptId()
    if (!aptId) return

    const hitPinId = outlineLayer.isClickInsideHighlight(e.clientX, e.clientY)
    if (hitPinId) {
      const poi = getPinsForApt(aptId).find((p) => p.id === hitPinId)
      if (poi) {
        const mod = e.ctrlKey || e.metaKey
        selectPin(poi, { mode: mod ? 'toggle' : 'replace' })
      }
      return
    }

    if (getSelectedPinIdList().length) {
      clearPinSelection()
      deps.removePinBtn.disabled = true
      deps.pinCardEl.innerHTML = `<p class="edit-empty-poi">Clique num retângulo · <strong>Ctrl+clique</strong> ou <strong>Shift+clique</strong> na lista para selecionar vários · arraste o corpo para mover em grupo.</p>`
      renderPinList()
      if (shouldShowOnStage()) {
        outlineLayer.requestSync()
        updatePinSelectionVisual()
      }
    }
  })

  deps.editStage.addEventListener('dblclick', (e) => {
    if (!shouldShowOnStage() || deps.subPanelPins.hidden) return
    const target = e.target as HTMLElement
    if (isHighlightStageTarget(target)) return
    const aptId = getHighlightAptId()
    if (!aptId) return

    if (outlineLayer.isClickInsideHighlight(e.clientX, e.clientY)) return

    e.preventDefault()
    const img = getStageCoverImage()
    let x = 50
    let y = 50
    if (img) {
      const imgPct = pointerToImage(e.clientX, e.clientY)
      if (imgPct) {
        x = round1(imgPct.x)
        y = round1(imgPct.y)
      }
    }
    const label = deps.newPinInput.value.trim()
    const poi = createHighlightAt(aptId, x, y, label || undefined)
    if (!poi) return
    deps.newPinInput.value = ''
    renderPinsPanel()
    notifyDirty()
    deps.showToast('Highlight criado — clique Finalizar highlights para salvar')
  })

  return {
    renderAll() {
      renderPinsPanel()
    },
    onUnitChanged() {
      highlightUndoStack.length = 0
      highlightGeometryUndoArmed = false
      clearPinSelection()
      closeInlineLabelEditor({ cancel: true })
      clearAptPinsFromStage(true)
      renderPinsPanel()
      deps.onPreviewRefresh?.()
    },
    setSubtab,
    onParentSubtabChange(sub: 'unit' | 'pins') {
      if (sub !== 'pins') activeSub = 'unit'
      else activeSub = 'pins'
    },
    getActiveSub: () => activeSub,
    finish: finishPins,
    async persist() {
      await finishPins()
    },
    clearStagePins: clearAptPinsFromStage,
    flushActiveDrag() {
      if (activePinDrag?.dragging) endPinDrag()
    },
    repositionPins() {
      syncStageLayout()
    },
    syncStageLayout,
    refreshCrmPreview() {
      renderPinList()
      if (selectedPinId) {
        const aptId = getHighlightAptId()
        const poi = aptId ? getPinsForApt(aptId).find((p) => p.id === selectedPinId) : undefined
        if (poi) void renderPinCard(poi)
      }
      if (shouldShowOnStage()) renderPins()
    },
    focusViewportOnSelected,
    getSelectedOutlineBbox,
    onViewportChanged() {
      syncHighlightStageGeometry()
    },
    resetViewport() {
      getActiveEditStageViewport()?.resetView()
    },
  }
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(s: string) {
  return escapeAttr(s)
}

function isPdfMediaRef(ref: string) {
  return /\.pdf(\?|#|$)/i.test(ref)
}

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}
