import { getPrefetchKeysForView, TRANSITIONS } from '../config/transitions'
import { getViewLoopConfig } from '../config/viewLoops'
import { isCellularConnection, isMobileViewport, resolveMediaPath } from './paths'
import { getPoiVideoPrefetchPaths } from './poiNavigation'
import { isVideoTransition } from './types'
import { VideoTransitionPlayer } from './videoTransitionPlayer'

const prefetched = new Set<string>()

export function clearPrefetchCache() {
  prefetched.clear()
}

function shouldPrefetchPoiVideos(): boolean {
  if (!isMobileViewport()) return true
  return !isCellularConnection()
}

export function prefetchForView(viewIndex: number, videoPlayer?: VideoTransitionPlayer) {
  const keys = getPrefetchKeysForView(viewIndex)

  for (const key of keys) {
    if (prefetched.has(key)) continue
    const t = TRANSITIONS[key]
    if (!t || !isVideoTransition(t)) continue
    prefetched.add(key)
    videoPlayer?.prefetch(t)
  }

  const loopKey = `loop_${viewIndex}`
  const loop = getViewLoopConfig(viewIndex)
  if (loop && isVideoTransition(loop) && !prefetched.has(loopKey)) {
    prefetched.add(loopKey)
    videoPlayer?.prefetch(loop)
  }

  if (!shouldPrefetchPoiVideos()) return

  const poiPaths = isMobileViewport()
    ? getPoiVideoPrefetchPaths(viewIndex).slice(0, 1)
    : getPoiVideoPrefetchPaths(viewIndex)

  for (const ref of poiPaths) {
    const key = `poi_${viewIndex}_${ref}`
    if (prefetched.has(key)) continue
    prefetched.add(key)
    videoPlayer?.prefetch({ type: 'video', src: resolveMediaPath(ref) })
  }
}

/** Prefetch sob demanda ao tocar num pin (mobile / 4G). */
export function prefetchPoiVideo(ref: string, videoPlayer?: VideoTransitionPlayer) {
  if (!ref || ref.startsWith('poi-media://')) return
  const key = `poi_on_demand_${ref}`
  if (prefetched.has(key)) return
  prefetched.add(key)
  videoPlayer?.prefetch({ type: 'video', src: resolveMediaPath(ref) })
}
