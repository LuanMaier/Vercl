import { resolveMediaPath } from '../core/paths'
import {
  getPoiMediaBlob,
  isPoiMediaRef,
  parsePoiMediaRef,
} from './poiMediaStore'
import { getViewHeroBlob, isSceneMediaRef, parseSceneHeroRef } from './sceneMediaStore'

const objectUrlCache = new Map<string, string>()

export function revokeAllPoiMediaUrls() {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  objectUrlCache.clear()
}

/** Resolve `poi-media://`, `scene-media://` ou caminho em /public */
export async function resolveMediaSrc(ref: string | undefined): Promise<string | null> {
  if (!ref) return null
  if (!isPoiMediaRef(ref) && !isSceneMediaRef(ref)) return resolveMediaPath(ref)

  const cached = objectUrlCache.get(ref)
  if (cached) return cached

  let blob: Blob | null = null

  if (isPoiMediaRef(ref)) {
    const parsed = parsePoiMediaRef(ref)
    if (parsed) blob = await getPoiMediaBlob(parsed.poiId, parsed.kind)
  } else if (isSceneMediaRef(ref)) {
    const parsed = parseSceneHeroRef(ref)
    if (parsed) blob = await getViewHeroBlob(parsed.viewIndex)
  }

  if (!blob) return null

  const url = URL.createObjectURL(blob)
  objectUrlCache.set(ref, url)
  return url
}

/** @deprecated use resolveMediaSrc */
export const resolvePoiMediaSrc = resolveMediaSrc
