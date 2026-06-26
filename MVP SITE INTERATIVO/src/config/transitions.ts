import { SEQUENCES } from './sequences'
import { VIDEO_TRANSITIONS } from './videoTransitions'
import type { TransitionConfig } from '../core/types'
import { edgeKey } from '../core/types'

function buildRegistry(): Record<string, TransitionConfig> {
  const out: Record<string, TransitionConfig> = {}

  for (const [key, seq] of Object.entries(SEQUENCES)) {
    out[key] = { type: 'sequence', ...seq }
  }

  for (const [key, video] of Object.entries(VIDEO_TRANSITIONS)) {
    out[key] = video
  }

  return out
}

export const TRANSITIONS = buildRegistry()

export function getTransition(from: number, to: number): TransitionConfig | undefined {
  return TRANSITIONS[edgeKey(from, to)]
}

/** Chaves `from_to` ligadas a uma vista (para prefetch) */
export function getEdgesFromView(viewIndex: number): string[] {
  return Object.keys(TRANSITIONS).filter((k) => k.startsWith(`${viewIndex}_`))
}

export function getEdgesToView(viewIndex: number): string[] {
  return Object.keys(TRANSITIONS).filter((k) => k.endsWith(`_${viewIndex}`))
}

export function getPrefetchKeysForView(viewIndex: number): string[] {
  const keys = new Set<string>()
  getEdgesFromView(viewIndex).forEach((k) => keys.add(k))
  getEdgesToView(viewIndex).forEach((k) => keys.add(k))
  return [...keys]
}
