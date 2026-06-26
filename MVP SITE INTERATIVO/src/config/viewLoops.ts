import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { resolveMediaPath } from '../core/paths'
import type { VideoTransition } from '../core/types'
import { getProjectViewLoopPath, getViewIdleMode } from './projectMedia'

/**
 * Loops idle hardcoded (legado / dev). Preferir viewLoopVideos no editor.
 */
export const VIEW_LOOPS: Partial<Record<number, VideoTransition>> = {
  // Exemplo:
  // 0: { type: 'video', src: '/media/loops/0_day.webm' },
}

/** Config síncrona do loop (prefetch). */
export function getViewLoopConfig(viewIndex: number): VideoTransition | null {
  if (getViewIdleMode(viewIndex) === 'loop') {
    const path = getProjectViewLoopPath(viewIndex)
    if (path) return { type: 'video', src: path }
  }
  return VIEW_LOOPS[viewIndex] ?? null
}

/** Resolve src do loop (IndexedDB / paths). */
export async function resolveViewLoop(viewIndex: number): Promise<VideoTransition | null> {
  const config = getViewLoopConfig(viewIndex)
  if (!config) return null
  const src = (await resolveMediaSrc(config.src)) ?? resolveMediaPath(config.src)
  if (!src) return null
  return { ...config, src }
}
