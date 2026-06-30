import {
  getProjectLightSliderVideoPath,
  getProjectSolarFrameFinal,
  getProjectSolarFrameInitial,
} from '../config/projectMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import {
  resolveMediaPath,
  isMobileViewport,
  resolveVideoSrcCandidates,
} from '../core/paths'
import type { ExplorerEngine } from '../core/engine'
import type { VideoTransitionPlayer } from '../core/videoTransitionPlayer'

function expandSliderVideoCandidates(ref: string, resolved: string): string[] {
  const out: string[] = []
  const push = (src: string) => {
    if (src && !out.includes(src)) out.push(src)
  }

  if (ref.includes('/media/mobile/')) push(ref)
  else if (ref.includes('/media/')) push(ref.replace(/^\/media\//, '/media/mobile/'))

  for (const src of resolveVideoSrcCandidates({ type: 'video', src: resolved })) push(src)
  push(resolved)
  push(ref)
  push(ref.replace('/media/mobile/', '/media/'))

  return out
}

function seekVideoTo(video: HTMLVideoElement, time: number, interactive: boolean): void {
  const duration = video.duration
  if (!duration || !Number.isFinite(duration)) return

  const clamped = Math.max(0, Math.min(time, duration - 0.001))
  if (Math.abs(video.currentTime - clamped) < (interactive ? 0.008 : 0.02)) return

  try {
    const fastSeek = (video as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek
    if (interactive && typeof fastSeek === 'function') fastSeek.call(video, clamped)
    else video.currentTime = clamped
  } catch {
    /* ignore */
  }
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = video.duration
  if (!duration || !Number.isFinite(duration)) return Promise.resolve()

  const clamped = Math.max(0, Math.min(time, duration - 0.001))
  if (Math.abs(video.currentTime - clamped) < 0.02) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', onSeeked)
      window.clearTimeout(timer)
      resolve()
    }
    const onSeeked = () => finish()
    const timer = window.setTimeout(finish, isMobileViewport() ? 180 : 280)

    video.addEventListener('seeked', onSeeked)
    seekVideoTo(video, clamped, false)
  })
}

async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  const rvfc = (
    video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
  ).requestVideoFrameCallback
  if (typeof rvfc === 'function') {
    await new Promise<void>((resolve) => {
      rvfc.call(video, () => resolve())
    })
    return
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function mountSolarVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.setAttribute('aria-hidden', 'true')
  video.tabIndex = -1
  video.className = 'light-slider-source-video'
  video.preload = 'auto'

  const stage = document.getElementById('stage')
  if (stage) stage.appendChild(video)
  else document.body.appendChild(video)
  return video
}

export function mountLightSlider(
  engine: ExplorerEngine,
  _videoPlayer: VideoTransitionPlayer,
  moodBar: HTMLElement,
) {
  const range = moodBar.querySelector('#light-slider') as HTMLInputElement
  if (!range) return () => {}

  const video = mountSolarVideoElement()

  let loadedView = -1
  let loadGen = 0
  let scrubToken = 0
  let scrubbing = false
  let scrubRaf = 0
  let pendingProgress: number | null = null
  let videoPrimed = false
  let primePromise: Promise<boolean> | null = null
  let frameInitial: HTMLImageElement | null = null
  let frameFinal: HTMLImageElement | null = null
  let endpointGen = 0

  function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  async function loadEndpoints(viewIndex: number) {
    const gen = ++endpointGen
    const initialRef = getProjectSolarFrameInitial(viewIndex)
    const finalRef = getProjectSolarFrameFinal(viewIndex)

    const [initialSrc, finalSrc] = await Promise.all([
      initialRef
        ? (await resolveMediaSrc(initialRef)) ?? resolveMediaPath(initialRef)
        : undefined,
      finalRef ? (await resolveMediaSrc(finalRef)) ?? resolveMediaPath(finalRef) : undefined,
    ])

    if (gen !== endpointGen) return

    frameInitial = initialSrc ? await loadImage(initialSrc) : null
    if (gen !== endpointGen) return
    frameFinal = finalSrc ? await loadImage(finalSrc) : null
  }

  function progressFromRange() {
    return Number(range.value) / 1000
  }

  function syncRangeFromEngine() {
    range.value = String(Math.round(engine.lightSliderProgress * 1000))
  }

  function hideTransitionVideos() {
    document.querySelectorAll<HTMLVideoElement>('.transition-video').forEach((v) => {
      v.classList.remove('visible')
      v.pause()
    })
  }

  function isVideoReady() {
    return (
      loadedView === engine.currentView &&
      Boolean(video.src) &&
      video.readyState >= 2 &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.videoWidth > 0
    )
  }

  async function primeVideoForScrub(): Promise<boolean> {
    if (!isVideoReady()) return false
    if (videoPrimed) return true
    if (!primePromise) {
      primePromise = (async () => {
        try {
          video.muted = true
          await video.play()
        } catch {
          /* iOS: gesto necessário */
        }
        video.pause()
        await waitForSeek(video, 0)
        await waitForVideoFrame(video)
        return isVideoReady()
      })().finally(() => {
        primePromise = null
      })
    }
    videoPrimed = await primePromise
    return videoPrimed
  }

  function paintVideoFrame() {
    if (!video.videoWidth) return
    hideTransitionVideos()
    engine.presentVideoFrame(video)
  }

  async function presentVideoProgress(progress: number, interactive: boolean) {
    if (!isVideoReady()) return false
    if (!(await primeVideoForScrub())) return false

    const token = ++scrubToken
    const t = progress * video.duration

    if (interactive) {
      seekVideoTo(video, t, true)
      if (token !== scrubToken) return false
      paintVideoFrame()
      return true
    }

    await waitForSeek(video, t)
    if (token !== scrubToken) return false
    await waitForVideoFrame(video)
    if (token !== scrubToken || !video.videoWidth) return false
    paintVideoFrame()
    return true
  }

  function queueLiveScrub(progress: number) {
    pendingProgress = progress
    if (scrubRaf) return
    scrubRaf = requestAnimationFrame(() => {
      scrubRaf = 0
      const p = pendingProgress
      pendingProgress = null
      if (p == null) return
      void presentVideoProgress(p, true)
    })
  }

  function showProgress(progress: number) {
    if (!scrubbing && !engine.lightSliderFrameHeld) return

    const p = Math.max(0, Math.min(1, progress))

    if (p <= 0) {
      if (frameInitial) {
        hideTransitionVideos()
        engine.presentStillImage(frameInitial)
      }
      return
    }

    if (p >= 1) {
      if (frameFinal) {
        hideTransitionVideos()
        engine.presentStillImage(frameFinal)
      }
      return
    }

    if (scrubbing) {
      queueLiveScrub(p)
      return
    }

    void presentVideoProgress(p, false)
  }

  function maybeRestoreHeldFrame() {
    if (
      !engine.lightSliderFrameHeld ||
      engine.currentView !== loadedView ||
      engine.state !== 'idle' ||
      !videoPrimed
    ) {
      return
    }
    showProgress(engine.lightSliderProgress)
  }

  function loadVideoFromSrc(src: string, gen: number): Promise<boolean> {
    return new Promise((resolve) => {
      const cleanup = () => {
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('error', onError)
      }
      const onReady = () => {
        cleanup()
        resolve(
          gen === loadGen &&
            video.readyState >= 2 &&
            Number.isFinite(video.duration) &&
            video.duration > 0,
        )
      }
      const onError = () => {
        cleanup()
        resolve(false)
      }

      video.addEventListener('loadeddata', onReady)
      video.addEventListener('error', onError)
      video.src = src
      video.load()
    })
  }

  async function loadForView(viewIndex: number) {
    const ref = getProjectLightSliderVideoPath(viewIndex)
    if (!ref) {
      loadedView = -1
      videoPrimed = false
      return false
    }

    if (loadedView === viewIndex && isVideoReady()) {
      maybeRestoreHeldFrame()
      return true
    }

    const resolved = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    const candidates = expandSliderVideoCandidates(ref, resolved)

    const gen = ++loadGen
    loadedView = viewIndex
    videoPrimed = false

    let loaded = false
    for (const src of candidates) {
      if (gen !== loadGen) return false
      if (await loadVideoFromSrc(src, gen)) {
        loaded = true
        break
      }
    }

    if (gen !== loadGen) return false
    if (!loaded) {
      loadedView = -1
      return false
    }

    maybeRestoreHeldFrame()
    return true
  }

  function applyProgress(progress: number) {
    const p = Math.max(0, Math.min(1, progress))
    engine.setLightSliderProgress(p)
    range.value = String(Math.round(p * 1000))
    showProgress(p)
  }

  function onScrubInput() {
    if (!engine.canChangeLight()) return
    scrubbing = true
    applyProgress(progressFromRange())
  }

  function endScrub() {
    scrubbing = false
    const p = progressFromRange()
    void presentVideoProgress(p, false)
  }

  const beginScrub = () => {
    if (range.disabled) return
    scrubbing = true
    void (async () => {
      if (!isVideoReady()) await loadForView(engine.currentView)
      await primeVideoForScrub()
      if (scrubbing) applyProgress(progressFromRange())
    })()
  }

  const onPointerDown = (e: PointerEvent) => {
    if (range.disabled) return
    beginScrub()
    try {
      range.setPointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    try {
      range.releasePointerCapture(e.pointerId)
    } catch {
      /* ok */
    }
    if (!scrubbing) return
    applyProgress(progressFromRange())
    endScrub()
  }

  range.addEventListener('pointerdown', onPointerDown)
  range.addEventListener('input', onScrubInput)
  range.addEventListener('change', () => {
    if (!range.disabled) applyProgress(progressFromRange())
    endScrub()
  })
  range.addEventListener('pointerup', onPointerUp)
  range.addEventListener('pointercancel', onPointerUp)

  async function syncFromEngine() {
    const ref = getProjectLightSliderVideoPath(engine.currentView)
    const hubHidden =
      engine.interiorsPanelOpen ||
      Boolean(engine.activeInteriorId) ||
      engine.apartmentsPanelOpen ||
      Boolean(engine.activeApartmentId)

    moodBar.classList.toggle('light-slider--no-video', !ref)
    if (!ref || hubHidden) return

    const enabled = engine.canChangeLight()
    range.disabled = !enabled
    moodBar.classList.toggle('is-disabled', !enabled)

    if (!scrubbing) syncRangeFromEngine()

    if (!engine.isPanoramaBooted()) return
    if (engine.state !== 'idle' && !scrubbing) return

    void loadEndpoints(engine.currentView)
    await loadForView(engine.currentView)
  }

  const unsub = engine.subscribe(() => {
    void syncFromEngine()
  })

  void syncFromEngine()

  return () => {
    unsub()
    if (scrubRaf) cancelAnimationFrame(scrubRaf)
    video.remove()
  }
}
