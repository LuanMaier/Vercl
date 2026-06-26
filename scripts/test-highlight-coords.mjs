/**
 * Regressão: coordenadas + geometria retangular dos Highlights.
 * Run: npm run test:highlights
 */
import {
  getCoverRect,
  imagePctToLayoutViewportPct,
  pointerToImagePctWithView,
  imagePointToClientPxWithView,
  isDefaultStageView,
} from '../src/core/coverCoords.ts'
import {
  resizeOutlineByCorner,
  resizeOutlineByEdge,
  rectOutlineFromPoints,
  outlineBBox,
  imagePointToClientPx,
} from '../src/core/apartmentOutlineGeometry.ts'

const imgW = 3840
const imgH = 2160
const layoutW = 920
const layoutH = 640
const rect = { left: 412, top: 88, width: layoutW, height: layoutH }
const view = {
  zoom: 1,
  panX: 0,
  panY: 0,
  layoutW,
  layoutH,
  viewportLeft: rect.left,
  viewportTop: rect.top,
}
const zoomedView = { ...view, zoom: 2, panX: -40, panY: 20 }

const fallbackRect = {
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
}

function domRect(r) {
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    right: r.left + r.width,
    bottom: r.top + r.height,
  }
}

let failed = 0

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL:', name)
    failed++
  } else {
    console.log('ok:', name)
  }
}

// ── Coordenadas zoom 1 ──
assert('default view detected', isDefaultStageView(view))
assert('zoomed view not default', !isDefaultStageView(zoomedView))

const samples = [
  { x: 25, y: 30 },
  { x: 50, y: 50 },
  { x: 72, y: 18 },
]

for (const pt of samples) {
  const stage = imagePctToLayoutViewportPct(pt.x, pt.y, layoutW, layoutH, imgW, imgH)
  const client = imagePointToClientPxWithView(pt, imgW, imgH, view, domRect(fallbackRect))
  if (!stage || !client) {
    assert(`round-trip setup ${pt.x},${pt.y}`, false)
    continue
  }
  const lx = rect.left + (stage.x / 100) * layoutW
  const ly = rect.top + (stage.y / 100) * layoutH
  assert(`client matches stage ${pt.x},${pt.y}`, Math.abs(client.x - lx) < 0.01 && Math.abs(client.y - ly) < 0.01)

  const back = pointerToImagePctWithView(client.x, client.y, imgW, imgH, view, domRect(fallbackRect))
  assert(
    `pointer round-trip ${pt.x},${pt.y}`,
    back && Math.abs(back.x - pt.x) < 0.15 && Math.abs(back.y - pt.y) < 0.15,
  )

  const clientGeom = imagePointToClientPx(pt, domRect(fallbackRect), imgW, imgH, view)
  assert(
    `imagePointToClientPx matches at default zoom ${pt.x},${pt.y}`,
    clientGeom && Math.abs(clientGeom.x - client.x) < 0.01 && Math.abs(clientGeom.y - client.y) < 0.01,
  )
}

assert('cover rect exists', Boolean(getCoverRect(layoutW, layoutH, imgW, imgH)))

// ── Vértice = resize de canto (retângulo) ──
const rectStart = { minX: 40, minY: 30, maxX: 50, maxY: 38 }
const draggedTl = resizeOutlineByCorner(rectStart, 0, { x: 42, y: 32 })
const bbTl = outlineBBox(draggedTl)
assert('corner drag keeps 4 points', draggedTl.length === 4)
assert('corner drag fixes opposite corner', bbTl.maxX === rectStart.maxX && bbTl.maxY === rectStart.maxY)
assert('corner drag moves dragged corner', bbTl.minX === 42 && bbTl.minY === 32)

const draggedBr = resizeOutlineByCorner(rectStart, 2, { x: 52, y: 40 })
const bbBr = outlineBBox(draggedBr)
assert('BR drag fixes TL anchor', bbBr.minX === rectStart.minX && bbBr.minY === rectStart.minY)

// ── Barra = resize de borda (retângulo) ──
const baseRect = rectOutlineFromPoints([
  { x: 40, y: 30 },
  { x: 50, y: 30 },
  { x: 50, y: 38 },
  { x: 40, y: 38 },
])
const resizedLeft = resizeOutlineByEdge(baseRect, 'left', { x: 38, y: 34 })
const bbLeft = outlineBBox(resizedLeft)
assert('edge drag keeps rectangle', resizedLeft.length === 4)
assert('left edge moves', bbLeft.minX === 38 && bbLeft.maxX === 50)

// ── Normalização de polígono torto ──
const skewed = [
  { x: 40, y: 30 },
  { x: 50, y: 30 },
  { x: 50, y: 38 },
  { x: 42, y: 36 },
]
const normalized = rectOutlineFromPoints(skewed)
const bbNorm = outlineBBox(normalized)
assert('normalize skewed to axis-aligned rect', bbNorm.minX === 40 && bbNorm.maxX === 50 && bbNorm.minY === 30 && bbNorm.maxY === 38)
assert('normalized has 4 points', normalized.length === 4)

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll highlight regression tests passed.')
