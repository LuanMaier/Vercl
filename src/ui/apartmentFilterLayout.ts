import { resolveApartmentFaceDimensions } from '../core/apartmentFaceMedia'
import { getStillViewFitRect } from '../core/coverCoords'
import { isMobileViewport } from '../core/paths'
import { getStageMetrics } from '../core/stageMetrics'

function measureMainDockHeight(): number {
  const track = document.getElementById('track')
  if (!track) return 148
  const h = track.getBoundingClientRect().height
  return h > 0 ? h + 8 : 148
}

/** Mobile: encaixa o filtro na faixa abaixo da imagem (contain), acima do menu. */
export async function layoutMobileApartmentFilterDock(
  dock: HTMLElement,
  aptId: string | null,
): Promise<void> {
  if (!isMobileViewport() || !aptId) {
    dock.style.top = ''
    dock.style.bottom = ''
    return
  }

  const dims = await resolveApartmentFaceDimensions(aptId)
  if (!dims) return

  const { w: viewW, h: viewH } = getStageMetrics()
  const cover = getStillViewFitRect(viewW, viewH, dims.w, dims.h)
  if (!cover) return

  const imageBottom = cover.dy + cover.dh
  const dockReserve = measureMainDockHeight()
  const gap = 6
  const panelH = dock.offsetHeight || 220

  let top = imageBottom + gap
  const ceiling = viewH - dockReserve - panelH - gap
  if (top > ceiling) top = Math.max(gap, ceiling)

  dock.style.top = `${Math.round(top)}px`
  dock.style.bottom = 'auto'
}
