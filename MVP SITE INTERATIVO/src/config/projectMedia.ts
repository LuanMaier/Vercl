import mediaOverridesJson from './generated/mediaOverrides.json'
import poisOverridesJson from './generated/poisOverrides.json'
import { reloadInteriorsOverrides } from './interiorsConfig'
import { reloadApartmentsOverrides } from './apartmentsConfig'
import { reloadApartmentPoisOverrides } from './apartmentPoiConfig'
import { reloadApartmentOutlinesOverrides } from './apartmentOutlinesConfig'
import { reloadPointsOverrides } from './pointsConfig'
import type { InteriorPage, InteriorPageType } from './interiors'
import type { ApartmentPage, ApartmentPageType } from './apartments'
import type { LightMode, PoiDefinition, Viewpoint } from '../core/types'

export type MediaOverridesFile = {
  version: 1
  heroes: Record<string, string>
  poiImages: Record<string, string>
  poiVideos: Record<string, string>
  /** Vídeo em loop no card / imagem final do pin */
  poiLoopVideos?: Record<string, string>
  /** Vídeo de transição por botão do menu (chave = índice da vista) */
  menuVideos?: Record<string, string>
  /** Imagem de transição por botão do menu (chave = índice da vista) */
  menuImages?: Record<string, string>
  /** Vídeo em loop ao chegar na vista via menu */
  menuLoopVideos?: Record<string, string>
  interiorVideos?: Record<string, string>
  interiorPosters?: Record<string, string>
  interiorMedia?: Record<string, string>
  apartmentMedia?: Record<string, string>
  /** Vídeo em loop por unidade (chave = itemId__pageId) */
  apartmentLoopVideos?: Record<string, string>
  lightPosters: Record<string, Partial<Record<LightMode, string>>>
  lightVideos: Record<string, Partial<Record<LightMode, string>>>
  /** Vídeo contínuo dia→noite para slider de insolação (chave = índice da vista) */
  lightSliderVideos?: Record<string, string>
  /** Frame dia (esquerda do slider) — Posição Solar */
  solarFrameInitial?: Record<string, string>
  /** Frame noite (direita do slider) — Posição Solar */
  solarFrameFinal?: Record<string, string>
  /** Motion blur nas transições só com imagem parada (sem vídeo de insolação) */
  lightMotionBlur?: Record<string, boolean>
  /** Vídeo em loop na vista idle (chave = índice da vista) */
  viewLoopVideos?: Record<string, string>
  /** Fundo idle: imagem HERO ou vídeo em loop */
  viewIdleMode?: Record<string, 'image' | 'loop'>
}

export type PoisOverridesFile = {
  version: 1
  byView: Record<string, PoiDefinition[]>
  /** Pins filhos posicionados na imagem final do pin pai */
  byParent?: Record<string, PoiDefinition[]>
}

export type ApartmentPoisOverridesFile = {
  version: 1
  byApartment: Record<string, PoiDefinition[]>
}

let mediaOverrides: MediaOverridesFile = { ...mediaOverridesJson } as MediaOverridesFile
let poisOverrides: PoisOverridesFile = { ...poisOverridesJson } as PoisOverridesFile

export function applyPoisOverridesFile(data: PoisOverridesFile) {
  poisOverrides = {
    version: 1,
    byView: data.byView ?? {},
    ...(data.byParent ? { byParent: data.byParent } : {}),
  }
}


export function getProjectHeroPath(viewIndex: number): string | undefined {
  return mediaOverrides.heroes[String(viewIndex)]
}

export function getProjectPoiImagePath(poiId: string): string | undefined {
  return mediaOverrides.poiImages[poiId]
}

export function getProjectPoiVideoPath(poiId: string): string | undefined {
  return mediaOverrides.poiVideos[poiId]
}

export function getProjectPoiLoopVideoPath(poiId: string): string | undefined {
  return mediaOverrides.poiLoopVideos?.[poiId]
}

export type PoiCardPlaybackMode = 'image' | 'loop' | 'loop-direct'

export function getPoiCardPlaybackMode(poi: PoiDefinition): PoiCardPlaybackMode {
  if (!getProjectPoiLoopVideoPath(poi.id)) return 'image'
  if (poi.cardMediaMode === 'loop-direct') return 'loop-direct'
  if (poi.cardMediaMode === 'loop') return 'loop'
  return 'image'
}

export function isPoiLoopDirect(poi: PoiDefinition): boolean {
  return getPoiCardPlaybackMode(poi) === 'loop-direct'
}

export function getPoiCardMediaMode(poi: PoiDefinition): 'image' | 'loop' {
  return getPoiCardPlaybackMode(poi) === 'image' ? 'image' : 'loop'
}

export function getProjectMenuVideoPath(viewIndex: number): string | undefined {
  return mediaOverrides.menuVideos?.[String(viewIndex)]
}

export function getProjectMenuImagePath(viewIndex: number): string | undefined {
  return mediaOverrides.menuImages?.[String(viewIndex)]
}

export function getProjectMenuLoopVideoPath(viewIndex: number): string | undefined {
  return mediaOverrides.menuLoopVideos?.[String(viewIndex)]
}

export function getMenuMediaMode(viewIndex: number, patch?: Partial<Viewpoint>): 'image' | 'video' | 'loop' {
  const mode = patch?.menuMediaMode
  if (mode === 'loop' && getProjectMenuLoopVideoPath(viewIndex)) return 'loop'
  if (mode === 'video') {
    if (getProjectMenuVideoPath(viewIndex) || patch?.transitionVideo) return 'video'
  }
  if (mode === 'loop' || mode === 'video' || mode === 'image') return mode
  if (getProjectMenuLoopVideoPath(viewIndex)) return 'loop'
  if (getProjectMenuVideoPath(viewIndex) && !getProjectMenuImagePath(viewIndex)) return 'video'
  return 'image'
}

export function resolveMenuMediaModeEditor(
  viewIndex: number,
  patch?: Partial<Viewpoint>,
): 'image' | 'video' | 'loop' {
  const mode = patch?.menuMediaMode
  if (mode === 'image' || mode === 'video' || mode === 'loop') return mode
  if (getProjectMenuLoopVideoPath(viewIndex)) return 'loop'
  if (getProjectMenuVideoPath(viewIndex) && !getProjectMenuImagePath(viewIndex)) return 'video'
  return 'image'
}

export function getProjectApartmentLoopVideoPath(mediaKey: string): string | undefined {
  return mediaOverrides.apartmentLoopVideos?.[mediaKey]
}

export type ViewIdleMode = 'image' | 'loop'

export function getProjectViewLoopPath(viewIndex: number): string | undefined {
  return mediaOverrides.viewLoopVideos?.[String(viewIndex)]
}

export function getViewIdleMode(viewIndex: number): ViewIdleMode {
  const mode = mediaOverrides.viewIdleMode?.[String(viewIndex)]
  if (mode === 'loop' || mode === 'image') return mode
  if (mediaOverrides.viewLoopVideos?.[String(viewIndex)]) return 'loop'
  return 'image'
}

export function patchProjectViewIdleMode(viewIndex: number, mode: ViewIdleMode) {
  if (!mediaOverrides.viewIdleMode) mediaOverrides.viewIdleMode = {}
  mediaOverrides.viewIdleMode[String(viewIndex)] = mode
}

export function getProjectInteriorVideoPath(id: string): string | undefined {
  return mediaOverrides.interiorVideos?.[id]
}

export function getProjectInteriorPosterPath(id: string): string | undefined {
  return mediaOverrides.interiorPosters?.[id]
}

export function getProjectInteriorMediaPath(mediaKey: string): string | undefined {
  return mediaOverrides.interiorMedia?.[mediaKey]
}

export function getProjectApartmentMediaPath(mediaKey: string): string | undefined {
  return mediaOverrides.apartmentMedia?.[mediaKey]
}

/** Recupera páginas do book a partir de mídias já salvas (quando interiorsOverrides veio vazio). */
export function inferInteriorPagesFromMedia(itemId: string): InteriorPage[] {
  const media = mediaOverrides.interiorMedia
  if (!media) return []

  const prefix = `${itemId}__`
  const pages: InteriorPage[] = []

  for (const key of Object.keys(media)) {
    if (!key.startsWith(prefix)) continue
    const pageId = key.slice(prefix.length)
    const path = media[key]
    if (!path) continue
    const type: InteriorPageType = /\/media\/|\.(mp4|webm|mov)(\?|$)/i.test(path)
      ? 'video'
      : 'image'
    pages.push({
      id: pageId,
      type,
      label: type === 'video' ? 'Vídeo' : 'Imagem',
    })
  }

  return pages.sort((a, b) => a.id.localeCompare(b.id))
}

export function inferApartmentPagesFromMedia(itemId: string): ApartmentPage[] {
  const media = mediaOverrides.apartmentMedia
  if (!media) return []

  const prefix = `${itemId}__`
  const pages: ApartmentPage[] = []

  for (const key of Object.keys(media)) {
    if (!key.startsWith(prefix)) continue
    const pageId = key.slice(prefix.length)
    const loopPath = mediaOverrides.apartmentLoopVideos?.[key]
    if (loopPath) {
      pages.push({
        id: pageId,
        type: 'loop',
        label: 'Loop',
      })
      continue
    }
    const path = media[key]
    if (!path) continue
    const type: ApartmentPageType = /\/media\/|\.(mp4|webm|mov)(\?|$)/i.test(path)
      ? 'video'
      : 'image'
    pages.push({
      id: pageId,
      type,
      label: type === 'video' ? 'Vídeo' : 'Imagem',
    })
  }

  return pages.sort((a, b) => a.id.localeCompare(b.id))
}

export function getProjectLightPosterPath(
  viewIndex: number,
  mode: LightMode,
): string | undefined {
  return mediaOverrides.lightPosters?.[String(viewIndex)]?.[mode]
}

export function getProjectLightVideoPath(
  viewIndex: number,
  mode: LightMode,
): string | undefined {
  return mediaOverrides.lightVideos?.[String(viewIndex)]?.[mode]
}

export function getProjectLightSliderVideoPath(viewIndex: number): string | undefined {
  return mediaOverrides.lightSliderVideos?.[String(viewIndex)]
}

export function getProjectSolarFrameInitial(viewIndex: number): string | undefined {
  return (
    mediaOverrides.solarFrameInitial?.[String(viewIndex)] ??
    mediaOverrides.lightPosters?.[String(viewIndex)]?.day
  )
}

export function getProjectSolarFrameFinal(viewIndex: number): string | undefined {
  return (
    mediaOverrides.solarFrameFinal?.[String(viewIndex)] ??
    mediaOverrides.lightPosters?.[String(viewIndex)]?.night
  )
}

export function viewHasSolarPosition(viewIndex: number): boolean {
  return Boolean(getProjectLightSliderVideoPath(viewIndex))
}

export function getProjectLightMotionBlur(viewIndex: number): boolean {
  return Boolean(mediaOverrides.lightMotionBlur?.[String(viewIndex)])
}







/** Recupera páginas do book a partir de mídias já salvas (quando interiorsOverrides veio vazio). */









export function getProjectPoisMap(): Record<number, PoiDefinition[]> | null {
  const byView = poisOverrides.byView
  const keys = Object.keys(byView)
  if (!keys.length) return null
  const out: Record<number, PoiDefinition[]> = {}
  for (const key of keys) {
    const list = byView[key]
    out[Number(key)] = (list ?? []).map((p) => ({ ...p }))
  }
  return out
}

export function getProjectChildPoisMap(): Record<string, PoiDefinition[]> | null {
  const byParent = poisOverrides.byParent
  if (!byParent || !Object.keys(byParent).length) return null
  const out: Record<string, PoiDefinition[]> = {}
  for (const [parentId, list] of Object.entries(byParent)) {
    out[parentId] = (list ?? []).map((p) => ({ ...p, parentId: p.parentId ?? parentId }))
  }
  return out
}

export function applyProjectMediaFields(poi: PoiDefinition): PoiDefinition {
  const img = poi.img ?? getProjectPoiImagePath(poi.id)
  const transitionVideo = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
  return {
    ...poi,
    ...(img ? { img } : {}),
    ...(transitionVideo ? { transitionVideo } : {}),
  }
}

export function patchSavedMediaPath(
  kind: string,
  meta: Record<string, string>,
  path: string,
) {
  switch (kind) {
    case 'hero':
      mediaOverrides.heroes[meta.view] = path
      break
    case 'poi-img':
      mediaOverrides.poiImages[meta.id] = path
      break
    case 'poi-video':
      mediaOverrides.poiVideos[meta.id] = path
      break
    case 'poi-loop':
      if (!mediaOverrides.poiLoopVideos) mediaOverrides.poiLoopVideos = {}
      mediaOverrides.poiLoopVideos[meta.id] = path
      break
    case 'menu-video': {
      if (!mediaOverrides.menuVideos) mediaOverrides.menuVideos = {}
      mediaOverrides.menuVideos[meta.view] = path
      break
    }
    case 'menu-image': {
      if (!mediaOverrides.menuImages) mediaOverrides.menuImages = {}
      mediaOverrides.menuImages[meta.view] = path
      break
    }
    case 'menu-loop': {
      if (!mediaOverrides.menuLoopVideos) mediaOverrides.menuLoopVideos = {}
      mediaOverrides.menuLoopVideos[meta.view] = path
      break
    }
    case 'light-poster': {
      const view = meta.view
      const mode = meta.mode as LightMode
      if (!mediaOverrides.lightPosters[view]) mediaOverrides.lightPosters[view] = {}
      mediaOverrides.lightPosters[view][mode] = path
      break
    }
    case 'light-video': {
      const view = meta.view
      const mode = meta.mode as LightMode
      if (!mediaOverrides.lightVideos[view]) mediaOverrides.lightVideos[view] = {}
      mediaOverrides.lightVideos[view][mode] = path
      break
    }
    case 'solar-video': {
      if (!mediaOverrides.lightSliderVideos) mediaOverrides.lightSliderVideos = {}
      mediaOverrides.lightSliderVideos[meta.view] = path
      break
    }
    case 'solar-frame-initial': {
      if (!mediaOverrides.solarFrameInitial) mediaOverrides.solarFrameInitial = {}
      mediaOverrides.solarFrameInitial[meta.view] = path
      break
    }
    case 'solar-frame-final': {
      if (!mediaOverrides.solarFrameFinal) mediaOverrides.solarFrameFinal = {}
      mediaOverrides.solarFrameFinal[meta.view] = path
      break
    }
    case 'view-loop': {
      if (!mediaOverrides.viewLoopVideos) mediaOverrides.viewLoopVideos = {}
      mediaOverrides.viewLoopVideos[meta.view] = path
      patchProjectViewIdleMode(Number(meta.view), 'loop')
      break
    }
    case 'interior-media': {
      if (!mediaOverrides.interiorMedia) mediaOverrides.interiorMedia = {}
      const key = `${meta.item}__${meta.page}`
      mediaOverrides.interiorMedia[key] = path
      break
    }
    case 'apartment-media': {
      if (!mediaOverrides.apartmentMedia) mediaOverrides.apartmentMedia = {}
      const key = `${meta.item}__${meta.page}`
      mediaOverrides.apartmentMedia[key] = path
      break
    }
    case 'apartment-loop': {
      if (!mediaOverrides.apartmentLoopVideos) mediaOverrides.apartmentLoopVideos = {}
      const key = `${meta.item}__${meta.page}`
      mediaOverrides.apartmentLoopVideos[key] = path
      break
    }
    case 'interior-video':
      if (!mediaOverrides.interiorVideos) mediaOverrides.interiorVideos = {}
      mediaOverrides.interiorVideos[meta.id] = path
      break
    case 'interior-poster':
      if (!mediaOverrides.interiorPosters) mediaOverrides.interiorPosters = {}
      mediaOverrides.interiorPosters[meta.id] = path
      break
    default:
      break
  }
}

export function patchProjectLightMotionBlur(viewIndex: number, motionBlur: boolean) {
  if (!mediaOverrides.lightMotionBlur) mediaOverrides.lightMotionBlur = {}
  if (motionBlur) mediaOverrides.lightMotionBlur[String(viewIndex)] = true
  else delete mediaOverrides.lightMotionBlur[String(viewIndex)]
}


export function clearSavedMediaPath(kind: string, meta: Record<string, string>) {
  switch (kind) {
    case 'hero':
      delete mediaOverrides.heroes[meta.view]
      break
    case 'poi-img':
      delete mediaOverrides.poiImages[meta.id]
      break
    case 'poi-video':
      delete mediaOverrides.poiVideos[meta.id]
      break
    case 'poi-loop':
      if (mediaOverrides.poiLoopVideos) delete mediaOverrides.poiLoopVideos[meta.id]
      break
    case 'menu-video':
      if (mediaOverrides.menuVideos) delete mediaOverrides.menuVideos[meta.view]
      break
    case 'menu-image':
      if (mediaOverrides.menuImages) delete mediaOverrides.menuImages[meta.view]
      break
    case 'menu-loop':
      if (mediaOverrides.menuLoopVideos) delete mediaOverrides.menuLoopVideos[meta.view]
      break
    case 'light-poster': {
      const view = meta.view
      const mode = meta.mode as LightMode
      delete mediaOverrides.lightPosters[view]?.[mode]
      break
    }
    case 'light-video': {
      const view = meta.view
      const mode = meta.mode as LightMode
      delete mediaOverrides.lightVideos[view]?.[mode]
      break
    }
    case 'solar-video': {
      if (mediaOverrides.lightSliderVideos) delete mediaOverrides.lightSliderVideos[meta.view]
      break
    }
    case 'solar-frame-initial': {
      if (mediaOverrides.solarFrameInitial) delete mediaOverrides.solarFrameInitial[meta.view]
      break
    }
    case 'solar-frame-final': {
      if (mediaOverrides.solarFrameFinal) delete mediaOverrides.solarFrameFinal[meta.view]
      break
    }
    case 'view-loop': {
      if (mediaOverrides.viewLoopVideos) delete mediaOverrides.viewLoopVideos[meta.view]
      patchProjectViewIdleMode(Number(meta.view), 'image')
      break
    }
    case 'interior-media': {
      if (mediaOverrides.interiorMedia) {
        delete mediaOverrides.interiorMedia[`${meta.item}__${meta.page}`]
      }
      break
    }
    case 'apartment-media': {
      if (mediaOverrides.apartmentMedia) {
        delete mediaOverrides.apartmentMedia[`${meta.item}__${meta.page}`]
      }
      break
    }
    case 'apartment-loop': {
      if (mediaOverrides.apartmentLoopVideos) {
        delete mediaOverrides.apartmentLoopVideos[`${meta.item}__${meta.page}`]
      }
      break
    }
    case 'interior-video':
      if (mediaOverrides.interiorVideos) delete mediaOverrides.interiorVideos[meta.id]
      break
    case 'interior-poster':
      if (mediaOverrides.interiorPosters) delete mediaOverrides.interiorPosters[meta.id]
      break
    default:
      break
  }
}

/** Atualiza cache em memória após Salvar local (sem fetch do JSON). */


export async function reloadProjectFiles() {
  const t = Date.now()
  const poisUrls = ['/config/poisOverrides.json', '/src/config/generated/poisOverrides.json']
  const [mediaRes, ...poisResults] = await Promise.all([
    fetch(`/src/config/generated/mediaOverrides.json?t=${t}`),
    ...poisUrls.map((base) => fetch(`${base}?t=${t}`)),
  ])
  if (mediaRes.ok) mediaOverrides = (await mediaRes.json()) as MediaOverridesFile
  for (const poisRes of poisResults) {
    if (poisRes.ok) {
      poisOverrides = (await poisRes.json()) as PoisOverridesFile
      break
    }
  }
  await reloadPointsOverrides()
  await reloadInteriorsOverrides()
  await reloadApartmentsOverrides()
  await reloadApartmentPoisOverrides()
  await reloadApartmentOutlinesOverrides()
}

export const APARTMENT_POIS_VERSION_KEY = 'explorer-apartment-pois-version'
export const POIS_OVERRIDES_VERSION_KEY = 'explorer-pois-overrides-version'

export function bumpApartmentPoisVersion() {
  localStorage.setItem(APARTMENT_POIS_VERSION_KEY, String(Date.now()))
}

export function bumpPoisOverridesVersion() {
  localStorage.setItem(POIS_OVERRIDES_VERSION_KEY, String(Date.now()))
}

export function notifyProjectUpdated() {
  bumpApartmentPoisVersion()
  bumpPoisOverridesVersion()
  window.dispatchEvent(new CustomEvent('explorer:project-updated'))
}
