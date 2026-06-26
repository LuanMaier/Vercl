/** Fade da vista Panorâmica (0) — usa o mesmo overlay e tempo do menu. */
import { stageFade } from './stageFade'

export const PANORAMA_VIEW = 0

export const panoramaFade = stageFade

export function isPanoramaView(viewIndex: number) {
  return viewIndex === PANORAMA_VIEW
}

/** @deprecated use panoramaFade — mantido para imports antigos */
export function resetStageOpacity() {
  panoramaFade.forceOff()
}

export const fadePanoramaOut = () => panoramaFade.cover()
export const fadePanoramaIn = () => panoramaFade.reveal()
