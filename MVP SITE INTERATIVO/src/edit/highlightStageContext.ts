/**
 * Fonte única de verdade para imagem + métricas dos highlights.
 * Não depende de token loadSeq — a fachada tem elemento próprio (#edit-bg-facade).
 */

import type { StageViewTransform } from '../core/coverCoords'
import { getFacadeStageImage } from './editStageController'
import {
  resolveHighlightStageMetrics,
  type HighlightStageMetrics,
} from './highlightStageMetrics'
import { onEditBgReady } from './editStageImage'

export const HIGHLIGHT_FACADE_LOADING_CLASS = 'edit-stage-bg--loading'

export function isHighlightFacadeReady(img: HTMLImageElement | null | undefined): boolean {
  if (!img?.getAttribute('src')) return false
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) return false
  if (img.classList.contains(HIGHLIGHT_FACADE_LOADING_CLASS)) return false
  return true
}

export function getHighlightFacadeImage(): HTMLImageElement | null {
  const img = getFacadeStageImage()
  if (!isHighlightFacadeReady(img)) return null
  return img
}

export function resolveHighlightFacadeMetrics(
  getView: () => StageViewTransform | null,
  stageEl: HTMLElement,
): HighlightStageMetrics | null {
  const img = getHighlightFacadeImage()
  if (!img) return null
  return resolveHighlightStageMetrics(img, getView, stageEl)
}

/** Aguarda a fachada estar decodificada antes do primeiro render de outlines. */
export function waitForHighlightFacadeReady(): Promise<void> {
  if (isHighlightFacadeReady(getFacadeStageImage())) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      if (!isHighlightFacadeReady(getFacadeStageImage())) return
      done = true
      off()
      clearInterval(poll)
      clearTimeout(timeout)
      resolve()
    }
    const off = onEditBgReady((layer) => {
      if (layer === 'facade') finish()
    })
    const poll = setInterval(finish, 32)
    const timeout = setTimeout(() => {
      done = true
      off()
      clearInterval(poll)
      resolve()
    }, 12_000)
  })
}

export function isHighlightFacadeLoading(): boolean {
  const img = getFacadeStageImage()
  if (!img?.getAttribute('src')) return false
  return img.classList.contains(HIGHLIGHT_FACADE_LOADING_CLASS) || !img.complete
}
