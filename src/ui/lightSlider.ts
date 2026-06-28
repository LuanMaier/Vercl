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
import { STILL_VIEW_IMAGE_FIT } from '../core/coverCoords'
import type { ExplorerEngine } from '../core/engine'
import type { VideoTransitionPlayer } from '../core/videoTransitionPlayer'

function sliderCacheSettings() {
  const mobile = isMobileViewport()
  return {
    maxWidth: mobile ? 640 : 960,
    frameCount: mobile ? 28 : 40,
    deferCacheUntilScrub: mobile,
  }
}

function expandSliderVideoCandidates(ref: string, resolved: string): string[] {
  const out: string[] = []
  const add = (src: string) => {
    if (src && !out.includes(src)) out.push(src)
  }

  for (const src of resolveVideoSrcCandidates({ type: 'video', src: resolved })) {
    add(src)
  }
  add(resolved)
  add(ref)

  if (ref.includes('/media/')) {
    add(ref.replace(/^\/media\//, '/media/mobile/'))
    add(ref.replace('/media/mobile/', '/media/'))
  }

  return out
}

function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = video.duration
  if (!duration || !Number.isFinite(duration)) return Promise.resolve()

  const clamped = Math.max(0, Math.min(time, duration - 0.001))
  if (Math.abs(video.currentTime - clamped) < 0.01) return Promise.resolve()

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
    const timer = window.setTimeout(finish, isMobileViewport() ? 180 : 300)

    video.addEventListener('seeked', onSeeked)
    try {
      video.currentTime = clamped
    } catch {
      finish()
    }
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

async function primeVideoForScrub(video: HTMLVideoElement): Promise<boolean> {
  if (!video.duration || !Number.isFinite(video.duration)) return false
  try {
    video.muted = true
    const playPromise = video.play()
    if (playPromise) await playPromise
  } catch {
    /* iOS pode bloquear até haver gesto — tenta seek mesmo assim */
  }
  video.pause()
  await seekToTime(video, 0)
  await waitForVideoFrame(video)
  return video.readyState >= 2 && video.videoWidth > 0
}

async function captureFrameBitmap(
  video: HTMLVideoElement,
  maxWidth: number,
): Promise<ImageBitmap | null> {
  if (!video.videoWidth) return null
  const scale = Math.min(1, maxWidth / video.videoWidth)
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

  const mobile = isMobileViewport()
  if (mobile) {
    const stage = document.getElementById('stage')
    if (stage) {
      stage.appendChild(video)
      return video
    }
    document.body.appendChild(video)
    return video
  }

  video.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;visibility:hidden'
  document.body.appendChild(video)
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
  const cacheSettings = sliderCacheSettings()

  let loadedView = -1
  let loadedSrc = ''
  let loadGen = 0
  let cacheGen = 0
  let scrubToken = 0
  let scrubbing = false
  let frameCache: ImageBitmap[] = []
  let cacheReady = false
  let cacheDeferred = false
  let videoReady = false
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

  function isSliderVideoReady() {
    return (
      videoReady &&
      video.readyState >= 2 &&
      Boolean(video.duration) &&
      Number.isFinite(video.duration)
    )
  }

  async function ensureVideoPrimed(): Promise<boolean> {
    if (videoPrimed && video.videoWidth > 0) return true
    if (!isSliderVideoReady()) return false
    if (!primePromise) {
      primePromise = primeVideoForScrub(video).finally(() => {
        primePromise = null
      })
    }
    videoPrimed = await primePromise
    return videoPrimed
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
    if (!isSliderVideoReady()) return false
    if (!(await ensureVideoPrimed())) return false

    const token = ++scrubToken
    await seekToTime(video, progress * video.duration)
    if (token !== scrubToken) return false
    await waitForVideoFrame(video)
    if (token !== scrubToken) return false
    if (!video.videoWidth) return false

    hideTransitionVideos()
    engine.presentVideoFrame(video)
    return true
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

    if (presentCachedProgress(p)) return
    void presentVideoProgress(p)
  }

  function maybeRestoreHeldFrame() {
    if (
      !engine.lightSliderFrameHeld ||
      engine.currentView !== loadedView ||
      engine.state !== 'idle'
    ) {
      return
    }
    const ready = cacheReady || (videoPrimed && isSliderVideoReady())
    if (!ready) return
    showProgress(engine.lightSliderProgress)
  }

  async function buildFrameCache(gen: number) {
    if (!video.duration || !Number.isFinite(video.duration)) return
    if (!(await ensureVideoPrimed())) return

    moodBar.classList.add('light-slider--loading')
    cacheReady = false
    disposeFrameCache(frameCache)
    frameCache = []

    const count = cacheSettings.frameCount
    const duration = video.duration

    for (let i = 0; i < count; i++) {
      if (gen !== cacheGen) return
      const t = count <= 1 ? 0 : (i / (count - 1)) * Math.max(0, duration - 0.001)
      await seekToTime(video, t)
      await waitForVideoFrame(video)
      const bitmap = await captureFrameBitmap(video, cacheSettings.maxWidth)
      if (gen !== cacheGen) return
      if (bitmap) frameCache.push(bitmap)
    }

    if (gen !== cacheGen) return
    cacheReady = frameCache.length > 0
    cacheDeferred = false
    moodBar.classList.remove('light-slider--loading')
    maybeRestoreHeldFrame()
  }

  function scheduleFrameCacheBuild() {
    const cacheRun = ++cacheGen
    void buildFrameCache(cacheRun)
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
            Boolean(video.duration) &&
            Number.isFinite(video.duration),
        )
      }
      const onError = () => {
        cleanup()
        resolve(false)
      }

      video.addEventListener('loadeddata', onReady)
      video.addEventListener('error', onError)
      video.preload = 'auto'
      video.src = src
      video.load()
    })
  }

  async function loadForView(viewIndex: number) {
    const ref = getProjectLightSliderVideoPath(viewIndex)
    if (!ref) {
      loadedView = -1
      loadedSrc = ''
      videoReady = false
      videoPrimed = false
      cacheGen++
      disposeFrameCache(frameCache)
      frameCache = []
      cacheReady = false
      cacheDeferred = false
      moodBar.classList.remove('light-slider--loading')
      return false
    }

    const resolved = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    const candidates = expandSliderVideoCandidates(ref, resolved)

    if (
      loadedView === viewIndex &&
      candidates.includes(loadedSrc) &&
      isSliderVideoReady()
    ) {
      if (!cacheReady && !cacheDeferred) {
        scheduleFrameCacheBuild()
      } else {
        maybeRestoreHeldFrame()
      }
      return true
    }

    const gen = ++loadGen
    cacheGen++
    loadedView = viewIndex
    loadedSrc = ''
    videoReady = false
    videoPrimed = false
    cacheReady = false
    cacheDeferred = false
    disposeFrameCache(frameCache)
    frameCache = []

    let loaded = false
    for (const src of candidates) {
      if (gen !== loadGen) return false
      if (await loadVideoFromSrc(src, gen)) {
        loadedSrc = src
        loaded = true
        break
      }
    }

    if (gen !== loadGen) return false
    if (!loaded) {
      moodBar.classList.remove('light-slider--loading')
      return false
    }

    videoReady = true

    if (cacheSettings.deferCacheUntilScrub) {
      cacheDeferred = true
      moodBar.classList.remove('light-slider--loading')
      maybeRestoreHeldFrame()
      return true
    }

    scheduleFrameCacheBuild()
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

  const beginScrub = () => {
    if (range.disabled) return
    scrubbing = true
    if (video.preload !== 'auto') {
      video.preload = 'auto'
      if (loadedSrc && video.readyState < 2) video.load()
    }
    void (async () => {
      if (!isSliderVideoReady()) return
      const primed = await ensureVideoPrimed()
      if (!primed) return
      if (cacheDeferred || (!cacheReady && !moodBar.classList.contains('light-slider--loading'))) {
        scheduleFrameCacheBuild()
      }
      if (scrubbing) showProgress(progressFromRange())
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
    cacheGen++
    disposeFrameCache(frameCache)
    frameCache = []
    video.remove()
  }
}
