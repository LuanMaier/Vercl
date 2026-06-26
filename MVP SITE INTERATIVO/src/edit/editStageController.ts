/**
 * Duas camadas de imagem no stage: cena (hero/POI) e fachada (highlights).
 * Visibilidade por CSS — camadas não compartilham src nem dimensões.
 */

import {
  onEditBgReady,
  setFacadeStageImageSrc,
  setSceneStageImageSrc,
  type EditStageImageSetResult,
} from './editStageImage'
import { getHighlightFacadeImage } from './highlightStageContext'

export type EditStageLayer = 'scene' | 'facade'

const SCENE_IMG_ID = 'edit-bg-scene'
const SCENE_BACKDROP_ID = 'edit-bg-scene-backdrop'
const FACADE_IMG_ID = 'edit-bg-facade'
const INACTIVE_CLASS = 'edit-stage-bg--inactive'

let stageEl: HTMLElement | null = null
let sceneImg: HTMLImageElement | null = null
let sceneBackdropImg: HTMLImageElement | null = null
let facadeImg: HTMLImageElement | null = null
let activeLayer: EditStageLayer = 'scene'

function createLayerImg(id: string): HTMLImageElement {
  const img = document.createElement('img')
  img.id = id
  img.alt = ''
  img.className = 'edit-stage-bg'
  return img
}

export function initEditStageController(container: HTMLElement) {
  stageEl = container
  container.innerHTML = ''
  sceneBackdropImg = createLayerImg(SCENE_BACKDROP_ID)
  sceneBackdropImg.classList.add('edit-stage-bg--backdrop')
  sceneImg = createLayerImg(SCENE_IMG_ID)
  facadeImg = createLayerImg(FACADE_IMG_ID)
  container.append(sceneBackdropImg, sceneImg, facadeImg)
  setActiveStageLayer('scene')
  return { sceneImg, facadeImg }
}

export function getSceneStageImage(): HTMLImageElement | null {
  return sceneImg
}

export function getFacadeStageImage(): HTMLImageElement | null {
  return facadeImg
}

export function getActiveStageLayer(): EditStageLayer {
  return activeLayer
}

export function setActiveStageLayer(layer: EditStageLayer) {
  activeLayer = layer
  if (!sceneImg || !facadeImg || !stageEl) return
  sceneImg.classList.toggle(INACTIVE_CLASS, layer !== 'scene')
  sceneBackdropImg?.classList.toggle(INACTIVE_CLASS, layer !== 'scene')
  facadeImg.classList.toggle(INACTIVE_CLASS, layer !== 'facade')
  stageEl.dataset.stageLayer = layer
}

export function getSceneCoverImage(): HTMLImageElement | null {
  if (activeLayer !== 'scene') return null
  const img = sceneImg
  if (!img?.src || img.classList.contains(INACTIVE_CLASS)) return null
  if (!img.complete || !img.naturalWidth) return null
  return img
}

export function getFacadeCoverImage(): HTMLImageElement | null {
  if (activeLayer !== 'facade') return null
  return getHighlightFacadeImage()
}

export function onStageImageReady(
  listener: (layer: EditStageLayer) => void,
): () => void {
  return onEditBgReady((layer) => listener(layer))
}

export async function loadSceneImage(
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  if (!sceneImg) return 'error'
  if (sceneBackdropImg) {
    if (src) sceneBackdropImg.src = src
    else sceneBackdropImg.removeAttribute('src')
  }
  return setSceneStageImageSrc(sceneImg, src, opts)
}

export async function loadFacadeImage(
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  if (!facadeImg) return 'error'
  return setFacadeStageImageSrc(facadeImg, src, opts)
}

export function flashSceneHero() {
  if (!sceneImg) return
  sceneImg.classList.remove('hero-flash')
  void sceneImg.offsetWidth
  sceneImg.classList.add('hero-flash')
}
