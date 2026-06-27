import type { VideoTransition } from './types'

let mobileSeqArchAvailable: boolean | null = null
let mobileMediaRootAvailable: boolean | null = null

export function isMobileViewport(): boolean {
  return window.matchMedia('(hover: none)').matches || window.innerWidth < 768
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function isCellularConnection(): boolean {
  const conn = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } })
    .connection
  if (!conn) return false
  if (conn.type === 'cellular') return true
  return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g'
}

export function mobileSeqArchEnabled(): boolean {
  return mobileSeqArchAvailable !== false
}

export function mobileMediaRootEnabled(): boolean {
  return mobileMediaRootAvailable !== false
}

/** Sonda assets mobile no boot — evita 404 quando pastas ainda não existem. */
export async function probeMobileAssets(): Promise<void> {
  if (!isMobileViewport()) return

  const checks = await Promise.all([
    fetch('/images/seq_arch_m/arch_00.jpg', { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false),
    fetch('/media/mobile/.gitkeep', { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() =>
        fetch('/media/mobile/', { method: 'HEAD' })
          .then((r) => r.ok)
          .catch(() => false),
      ),
  ])

  mobileSeqArchAvailable = checks[0]
  mobileMediaRootAvailable = checks[1]
}

export function toMobileVideoPath(path: string): string {
  if (!isMobileViewport() || mobileMediaRootAvailable === false) return path
  if (path.includes('/media/mobile/')) return path
  if (!/^\/media\//.test(path)) return path
  if (!/\.(mp4|webm|mov)(\?|#|$)/i.test(path)) return path
  return path.replace(/^\/media\//, '/media/mobile/')
}

export function desktopMediaPath(path: string): string {
  return path.replace('/images/seq_arch_m/', '/images/seq_arch/').replace('/media/mobile/', '/media/')
}

export function resolveMediaPath(path: string): string {
  if (!isMobileViewport()) return path

  let out = path
  if (mobileSeqArchAvailable !== false && path.includes('/images/seq_arch/')) {
    out = path.replace('/images/seq_arch/', '/images/seq_arch_m/')
  }
  return toMobileVideoPath(out)
}

export function resolveVideoSrc(video: VideoTransition): string {
  if (isMobileViewport() && video.mobileSrc) return video.mobileSrc
  return isMobileViewport() ? toMobileVideoPath(video.src) : video.src
}

/** Ordem de tentativa: mobile → desktop (fallback em erro de rede). */
export function resolveVideoSrcCandidates(video: VideoTransition): string[] {
  const primary = resolveVideoSrc(video)
  const candidates = [primary]
  if (!candidates.includes(video.src)) candidates.push(video.src)
  if (video.mobileSrc && !candidates.includes(video.mobileSrc)) candidates.push(video.mobileSrc)
  return candidates
}
