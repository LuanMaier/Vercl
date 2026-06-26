import { getPoisForView } from '../config/poiConfig'
import { getProjectPoiVideoPath } from '../config/projectMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import type { PoiDefinition, VideoTransition } from './types'

function poiTargetsView(poi: PoiDefinition, toView: number) {
  if (poi.targetView === undefined || poi.targetView === null) return false
  return Number(poi.targetView) === toView
}

/** PIN na vista atual; se não houver, usa PIN da panorâmica (vista 0) com o mesmo destino. */
export function findPoiNavLink(fromView: number, toView: number): PoiDefinition | undefined {
  const local = getPoisForView(fromView).find((p) => poiTargetsView(p, toView))
  if (local) return local
  if (fromView !== 0) {
    return getPoisForView(0).find((p) => poiTargetsView(p, toView))
  }
  return undefined
}

export function isPoiOnView(poi: PoiDefinition, viewIndex: number) {
  return getPoisForView(viewIndex).some((p) => p.id === poi.id)
}

export async function resolvePoiTransitionForEdge(
  fromView: number,
  toView: number,
): Promise<VideoTransition | undefined> {
  const poi = findPoiNavLink(fromView, toView)
  const videoRef = poi?.transitionVideo ?? (poi ? getProjectPoiVideoPath(poi.id) : undefined)
  if (!videoRef) return undefined
  const src = await resolveMediaSrc(videoRef)
  if (!src) return undefined
  return { type: 'video', src }
}

export function getPoiVideoPrefetchPaths(viewIndex: number): string[] {
  const paths: string[] = []
  for (const poi of getPoisForView(viewIndex)) {
    const ref = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
    if (ref && !ref.startsWith('poi-media://')) {
      paths.push(ref)
    }
  }
  return paths
}
