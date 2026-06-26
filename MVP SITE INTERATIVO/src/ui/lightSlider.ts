import {
  getProjectLightSliderVideoPath,
  getProjectSolarFrameFinal,
  getProjectSolarFrameInitial,
} from '../config/projectMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { resolveMediaPath } from '../core/paths'
import { STILL_VIEW_IMAGE_FIT } from '../core/coverCoords'
import type { ExplorerEngine } from '../core/engine'
import type { VideoTransitionPlayer } from '../core/videoTransitionPlayer'

/** Frames em memória — scrub instantâneo sem seek no vídeo. */
const SLIDER_FRAME_COUNT = 40
const SLIDER_CACHE_MAX_WIDTH = 960

function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  const clamped = Math.max(0, Math.min(time, (video.duration || time) - 0.001))
  if (Math.abs(video.currentTime - clamped) < 0.01) return Promise.resolve()

  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    try {
      const fastSeek = (video as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek
      if (typeof fastSeek === 'function') fastSeek.call(video, clamped)
      else video.currentTime = clamped
    } catch {
      video.removeEventListener('seeked', done)
      resolve()
    }
  })
}

async function captureFrameBitmap(video: HTMLVideoElement): Promise<ImageBitmap | null> {
  if (!video.videoWidth) return null
  const scale = Math.min(1, SLIDER_CACHE_MAX_WIDTH / video.videoWidth)
  const w = Math.max(1, Math.round(video.videoWidth * scale))
  const h = Math.max(1, Math.round(video.videoHeight * scale))
  try {
    return await createImageBitmap(video, { resizeWidth: w, resizeHeight: h })
  } catch {
    return null
  }
}

function disposeFrameCache(frames: ImageBitmap[]) {
  for (const frame of frames) {
    try {
      frame.close()
    } catch {
      /* ignore */
    }
  }
}

export function mountLightSlider(
  engine: ExplorerEngine,
  _videoPlayer: VideoTransitionPlayer,
  moodBar: HTMLElement,
) {
  const range = moodBar.querySelector('#light-slider') as HTMLInputElement
  if (!range) return () => {}

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.setAttribute('aria-hidden', 'true')
  video.tabIndex = -1
  video.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;visibility:hidden'
  document.body.appendChild(video)

  let loadedView = -1
  let loadedSrc = ''
  let loadGen = 0
  let cacheGen = 0
  let scrubbing = false
  let frameCache: ImageBitmap[] = []
  let cacheReady = false
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

  function presentCachedProgress(progress: number) {
    if (!frameCache.length) return false
    const idx = Math.min(
      frameCache.length - 1,
      Math.round(progress * (frameCache.length - 1)),
    )
    hideTransitionVideos()
    engine.presentBitmapFrame(frameCache[idx], STILL_VIEW_IMAGE_FIT)
    return true
  }

  async function presentVideoProgress(progress: number) {
    if (!video.duration || !Number.isFinite(video.duration)) return
    await seekToTime(video, progress * video.duration)
    hideTransitionVideos()
    engine.presentVideoFrame(video)
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

    if (!presentCachedProgress(p)) {
      void presentVideoProgress(p)
    }
  }

  function maybeRestoreHeldFrame() {
    if (
      !engine.lightSliderFrameHeld ||
      engine.currentView !== loadedView ||
      !cacheReady ||
      engine.state !== 'idle'
    ) {
      return
    }
    showProgress(engine.lightSliderProgress)
  }

  async function buildFrameCache(gen: number) {
    if (!video.duration || !Number.isFinite(video.duration)) return

    moodBar.classList.add('light-slider--loading')
    cacheReady = false
    disposeFrameCache(frameCache)
    frameCache = []

    const count = SLIDER_FRAME_COUNT
    const duration = video.duration

    for (let i = 0; i < count; i++) {
      if (gen !== cacheGen) return
      const t = count <= 1 ? 0 : (i / (count - 1)) * Math.max(0, duration - 0.001)
      await seekToTime(video, t)
      const bitmap = await captureFrameBitmap(video)
      if (gen !== cacheGen) return
      if (bitmap) frameCache.push(bitmap)
    }

    if (gen !== cacheGen) return
    cacheReady = frameCache.length > 0
    moodBar.classList.remove('light-slider--loading')
    maybeRestoreHeldFrame()
  }

  async function loadForView(viewIndex: number) {
    const ref = getProjectLightSliderVideoPath(viewIndex)
    if (!ref) {
      loadedView = -1
      loadedSrc = ''
      cacheGen++
      disposeFrameCache(frameCache)
      frameCache = []
      cacheReady = false
      moodBar.classList.remove('light-slider--loading')
      return false
    }

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    if (!src) return false

    if (loadedView === viewIndex && loadedSrc === src && video.readyState >= 1) {
      if (!cacheReady) {
        const cacheRun = ++cacheGen
        void buildFrameCache(cacheRun)
      } else {
        maybeRestoreHeldFrame()
      }
      return true
    }

    const gen = ++loadGen
    cacheGen++
    loadedView = viewIndex
    loadedSrc = src
    cacheReady = false
    disposeFrameCache(frameCache)
    frameCache = []

    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady)
        video.removeEventListener('error', onReady)
        resolve()
      }
      video.addEventListener('loadedmetadata', onReady)
      video.addEventListener('error', onReady)
      video.src = src
      video.load()
    })

    if (gen !== loadGen) return false
    if (!video.duration || !Number.isFinite(video.duration)) return false

    const cacheRun = ++cacheGen
    void buildFrameCache(cacheRun)
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
  }

  range.addEventListener('pointerdown', () => {
    scrubbing = true
    if (video.preload !== 'auto') {
      video.preload = 'auto'
      if (loadedSrc && video.readyState < 2) video.load()
    }
  })
  range.addEventListener('input', onScrubInput)
  range.addEventListener('change', endScrub)
  range.addEventListener('pointerup', endScrub)
  range.addEventListener('pointercancel', endScrub)
  range.addEventListener('touchend', endScrub)

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
    cacheGen++
    disposeFrameCache(frameCache)
    frameCache = []
    video.remove()
  }
}
