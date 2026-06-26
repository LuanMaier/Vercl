import { getPrefetchKeysForView, TRANSITIONS } from '../config/transitions'
import { getViewLoopConfig } from '../config/viewLoops'
import { resolveMediaPath } from './paths'
import { getPoiVideoPrefetchPaths } from './poiNavigation'
import { isVideoTransition } from './types'
import { VideoTransitionPlayer } from './videoTransitionPlayer'

const prefetched = new Set<string>()

export function clearPrefetchCache() {
  prefetched.clear()
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

  for (const ref of getPoiVideoPrefetchPaths(viewIndex)) {
    const key = `poi_${viewIndex}_${ref}`
    if (prefetched.has(key)) continue
    prefetched.add(key)
    videoPlayer?.prefetch({ type: 'video', src: resolveMediaPath(ref) })
  }
}
