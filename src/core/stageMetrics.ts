import { isMobileViewport } from './paths'

export type StageMetrics = {
  w: number
  h: number
  dpr: number
}

/** Tamanho lógico do stage — visualViewport no mobile (Safari/iOS). */
export function getStageMetrics(): { w: number; h: number } {
  if (isMobileViewport()) {
    const vv = window.visualViewport
    if (vv) {
      return {
        w: Math.max(1, Math.round(vv.width)),
        h: Math.max(1, Math.round(vv.height)),
      }
    }
  }
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
  }
}

export function getStageDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2)
}

export function getStageLayout(): StageMetrics {
  const { w, h } = getStageMetrics()
  return { w, h, dpr: getStageDpr() }
}

/** Alinha buffer do canvas ao stage real (evita “tiling” no iOS). */
export function syncStageCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D | null,
): StageMetrics {
  const layout = getStageLayout()
  const bw = Math.max(1, Math.round(layout.w * layout.dpr))
  const bh = Math.max(1, Math.round(layout.h * layout.dpr))
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  ctx?.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0)
  return layout
}
