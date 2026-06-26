import type { VideoTransition } from './types'

export function isMobileViewport(): boolean {
  return window.matchMedia('(hover: none)').matches || window.innerWidth < 768
}

export function resolveMediaPath(path: string): string {
  if (!isMobileViewport()) return path
  return path.replace('/images/seq_arch/', '/images/seq_arch_m/')
}

export function resolveVideoSrc(video: VideoTransition): string {
  if (isMobileViewport() && video.mobileSrc) return video.mobileSrc
  return video.src
}
