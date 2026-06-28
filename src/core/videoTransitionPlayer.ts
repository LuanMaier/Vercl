import { isMobileViewport, resolveVideoSrcCandidates } from './paths'
import { drawImageFit } from './motionBlur'
import type { ImageFitMode } from './coverCoords'
import { getDefaultCanvasFit } from './coverCoords'
import { syncStageCanvas } from './stageMetrics'
import type { VideoTransition } from './types'

export type VideoPlayOptions = {
  /** Mostra frame 0 no canvas antes de dar play */
  primeFirstFrame?: boolean
  /** Reproduz do fim para o início (rollback de insolação). */
  reverse?: boolean
  /** Chamado quando o vídeo de transição fica visível (tira overlay preto). */
  onPlaybackVisible?: () => void
  /** Book: espera o vídeo dar play antes de onPlaybackVisible (evita piscada). */
  deferPlaybackVisibleUntilPlaying?: boolean
  /** Desenha frames no canvas com blur (vídeo fica oculto). */
  motionBlur?: boolean
  onMotionBlurFrame?: (video: HTMLVideoElement, progress: number) => void
  /** Ao terminar: não congela último frame do vídeo — caller desenha imagem no canvas. */
  endOnStillPoster?: boolean
  /** Imagem do pin exibida no canvas ao terminar (com endOnStillPoster). */
  endImageRef?: string
  /** POI ativo após exibir endImageRef — habilita pins filhos. */
  immersivePoiId?: string
}

export class VideoTransitionPlayer {
  private active: HTMLVideoElement
  private inactive: HTMLVideoElement
  private playing = false
  private looping = false
  private transitionReverse = false
  private endOnStillPoster = false
  private reverseRaf: number | null = null
  private motionBlurRaf: number | null = null
  private settle: ((ok: boolean) => void) | null = null
  private loopSettle: ((ok: boolean) => void) | null = null
  private loopRaf: number | null = null
  private loopFit: ImageFitMode = 'cover'
  private bailTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    videoA: HTMLVideoElement,
    videoB: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private onLoading?: (loading: boolean) => void,
  ) {
    this.active = videoA
    this.inactive = videoB
    this.bind(videoA)
    this.bind(videoB)
  }

  private bind(v: HTMLVideoElement) {
    v.playsInline = true
    v.muted = true
    v.preload = isMobileViewport() ? 'metadata' : 'auto'

    v.addEventListener('ended', () => {
      if (!this.playing || this.looping || v !== this.active) return
      if (this.transitionReverse) return
      this.endTransition(true)
    })

    v.addEventListener('error', () => {
      if (this.looping && v === this.active) {
        this.stopLoop()
        return
      }
      if (!this.playing || v !== this.active) return
      this.endTransition(false)
    })
  }

  isTransitioning() {
    return this.playing
  }

  isLooping() {
    return this.looping
  }

  /** Dimensões do vídeo ativo no player (loop ou transição). */
  getLoopVideoMetrics(): { w: number; h: number } | null {
    const v = this.active
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      return { w: v.videoWidth, h: v.videoHeight }
    }
    return null
  }

  stopLoop(opts?: { keepCanvasHidden?: boolean }) {
    if (!this.looping) return
    const v = this.active
    this.stopCanvasLoopDraw()
    if (!opts?.keepCanvasHidden && v.readyState >= 2 && v.videoWidth > 0) {
      this.snapVideoFrameToCanvas(v)
    }
    this.looping = false
    this.active.loop = false
    this.active.pause()
    this.active.classList.remove('visible')
    if (!opts?.keepCanvasHidden) {
      this.canvas.classList.remove('hidden')
    }
    const loopSettle = this.loopSettle
    this.loopSettle = null
    loopSettle?.(false)
  }

  private stopCanvasLoopDraw() {
    if (this.loopRaf) {
      cancelAnimationFrame(this.loopRaf)
      this.loopRaf = null
    }
  }

  cancel(opts?: { keepCanvasHidden?: boolean }) {
    this.stopReverseAnimation()
    this.stopMotionBlurLoop()
    const settle = this.settle
    const loopSettle = this.loopSettle
    this.settle = null
    this.loopSettle = null
    this.stopLoop({ keepCanvasHidden: opts?.keepCanvasHidden })
    this.playing = false
    this.transitionReverse = false
    this.endOnStillPoster = false
    if (this.bailTimer) clearTimeout(this.bailTimer)
    this.bailTimer = null
    this.active.pause()
    this.inactive.pause()
    this.active.classList.remove('visible')
    this.inactive.classList.remove('visible')
    if (!opts?.keepCanvasHidden) {
      this.canvas.classList.remove('hidden')
    }
    this.onLoading?.(false)
    settle?.(false)
    loopSettle?.(false)
  }

  private loadVideoSources(
    v: HTMLVideoElement,
    config: VideoTransition,
    onReady: () => void,
    onFail: () => void,
  ) {
    const sources = resolveVideoSrcCandidates(config)
    let idx = 0

    const cleanup = () => {
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', onMeta)
      v.onerror = null
    }

    const onMeta = () => {
      cleanup()
      onReady()
    }

    const tryNext = () => {
      cleanup()
      if (idx >= sources.length) {
        onFail()
        return
      }
      const src = sources[idx++]!
      v.onerror = () => tryNext()
      v.addEventListener('loadedmetadata', onMeta)
      v.addEventListener('loadeddata', onMeta)
      v.src = src
      if (config.poster) v.poster = config.poster
      v.load()
    }

    tryNext()
  }

  /** Loop idle (Genvis-style). @returns false se o vídeo não carregar */
  playLoop(config: VideoTransition): Promise<boolean> {
    return this.playCanvasLoop(config, 'cover')
  }

  /** Loop desenhado no canvas — mesmo fit das imagens (contain + fundo). */
  playCanvasLoop(config: VideoTransition, fit: ImageFitMode = 'contain'): Promise<boolean> {
    return new Promise((resolve) => {
      this.cancel({ keepCanvasHidden: true })
      this.looping = true
      this.loopFit = fit
      this.loopSettle = resolve

      const v = this.active
      v.loop = true
      const ctx = this.canvas.getContext('2d')
      let firstFramePainted = false

      const bail = window.setTimeout(() => {
        if (!this.looping) return
        this.loopSettle = null
        this.stopLoop({ keepCanvasHidden: true })
        resolve(false)
      }, isMobileViewport() ? 35000 : 25000)

      const finish = (ok: boolean) => {
        clearTimeout(bail)
        if (this.loopSettle !== resolve) return
        this.loopSettle = null
        if (!ok) this.stopLoop({ keepCanvasHidden: true })
        resolve(ok)
      }

      const draw = () => {
        if (!this.looping) return
        if (ctx && v.readyState >= 2 && v.videoWidth > 0) {
          const layout = syncStageCanvas(this.canvas, ctx)
          drawImageFit(ctx, v, layout.w, layout.h, 0, this.loopFit)
          this.canvas.classList.remove('hidden')
          if (!firstFramePainted) {
            firstFramePainted = true
            finish(true)
          }
        }
        this.loopRaf = requestAnimationFrame(draw)
      }

      const onReady = () => {
        v.oncanplay = null
        void v.play().then(
          () => {
            v.classList.remove('visible')
            this.inactive.classList.remove('visible')
            draw()
          },
          () => finish(false),
        )
      }

      v.oncanplay = onReady

      this.loadVideoSources(
        v,
        config,
        () => {
          if (!this.looping) return
          if (v.readyState >= 2) onReady()
        },
        () => finish(false),
      )
    })
  }

  /** @returns true se o vídeo terminou; false em erro/timeout */
  play(config: VideoTransition, options?: VideoPlayOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.cancel({ keepCanvasHidden: true })
      this.playing = true
      this.transitionReverse = options?.reverse ?? false
      this.endOnStillPoster = options?.endOnStillPoster ?? false
      this.settle = resolve

      const target = this.inactive
      this.inactive = this.active
      this.active = target
      const v = this.active
      v.loop = false

      this.onLoading?.(true)
      const reverse = this.transitionReverse
      const primeFirstFrame = (options?.primeFirstFrame ?? false) && !reverse
      if (!primeFirstFrame && !reverse) this.canvas.classList.add('hidden')

      this.bailTimer = window.setTimeout(() => {
        if (this.playing) this.endTransition(false)
      }, isMobileViewport() ? 35000 : 25000)

      const useMotionBlur =
        !reverse && options?.motionBlur && Boolean(options.onMotionBlurFrame)

      const schedulePlaybackVisible = () => {
        if (!options?.onPlaybackVisible) return
        if (options.deferPlaybackVisibleUntilPlaying) {
          const onPlaying = () => {
            v.removeEventListener('playing', onPlaying)
            requestAnimationFrame(() => {
              requestAnimationFrame(() => options.onPlaybackVisible!())
            })
          }
          v.addEventListener('playing', onPlaying)
          return
        }
        options.onPlaybackVisible()
      }

      const beginPlay = () => {
        this.inactive.classList.remove('visible')
        this.onLoading?.(false)
        if (useMotionBlur) {
          options?.onPlaybackVisible?.()
          v.classList.remove('visible')
          this.canvas.classList.remove('hidden')
          void v.play().catch(() => this.endTransition(false))
          this.startMotionBlurLoop(v, options!.onMotionBlurFrame!)
        } else {
          v.classList.add('visible')
          this.canvas.classList.add('hidden')
          schedulePlaybackVisible()
          if (reverse) {
            void this.playReverse(v).catch(() => this.endTransition(false))
          } else {
            void v.play().catch(() => this.endTransition(false))
          }
        }
      }

      const afterReady = () => {
        if (primeFirstFrame) {
          const prime = () => {
            if (!v.duration || !Number.isFinite(v.duration)) {
              beginPlay()
              return
            }
            v.currentTime = 0
          }
          const onSeeked = () => {
            v.removeEventListener('seeked', onSeeked)
            this.snapVideoFrameToCanvas(v)
            this.canvas.classList.remove('hidden')
            v.classList.remove('visible')
            this.onLoading?.(false)
            requestAnimationFrame(() => beginPlay())
          }
          v.addEventListener('seeked', onSeeked)
          prime()
        } else {
          beginPlay()
        }
      }

      let ready = false
      const markReady = () => {
        if (ready) return
        ready = true
        afterReady()
      }

      this.loadVideoSources(v, config, markReady, () => this.endTransition(false))
    })
  }

  private endTransition(ok: boolean) {
    if (!this.playing) return
    this.stopReverseAnimation()
    this.stopMotionBlurLoop()
    this.playing = false
    if (this.bailTimer) clearTimeout(this.bailTimer)
    this.bailTimer = null

    const v = this.active
    const resolve = this.settle
    this.settle = null

    const finish = () => {
      v.classList.remove('visible')
      this.inactive.classList.remove('visible')
      this.canvas.classList.remove('hidden')
      this.onLoading?.(false)
      resolve?.(ok)
    }

    if (!ok) {
      this.transitionReverse = false
      this.endOnStillPoster = false
      finish()
      return
    }

    v.pause()
    v.playbackRate = 1

    if (this.endOnStillPoster) {
      v.classList.remove('visible')
      this.inactive.classList.remove('visible')
      this.transitionReverse = false
      this.endOnStillPoster = false
      this.onLoading?.(false)
      resolve?.(ok)
      return
    }

    const snapEnd = () => {
      this.snapVideoFrameToCanvas(v)
      this.transitionReverse = false
      finish()
    }

    if (v.duration && Number.isFinite(v.duration)) {
      const reverse = this.transitionReverse
      const snapTime = reverse ? 0 : Math.max(0, v.duration - 1 / 30)
      if (Math.abs(v.currentTime - snapTime) < 0.02) {
        snapEnd()
        return
      }
      v.addEventListener('seeked', () => snapEnd(), { once: true })
      v.currentTime = snapTime
      return
    }

    snapEnd()
  }

  private stopReverseAnimation() {
    if (this.reverseRaf) {
      cancelAnimationFrame(this.reverseRaf)
      this.reverseRaf = null
    }
  }

  private stopMotionBlurLoop() {
    if (this.motionBlurRaf) {
      cancelAnimationFrame(this.motionBlurRaf)
      this.motionBlurRaf = null
    }
  }

  private startMotionBlurLoop(
    v: HTMLVideoElement,
    onFrame: (video: HTMLVideoElement, progress: number) => void,
  ) {
    this.stopMotionBlurLoop()
    const tick = () => {
      if (!this.playing || v !== this.active) return
      const dur = v.duration && Number.isFinite(v.duration) ? v.duration : 0
      const progress = dur > 0 ? Math.min(1, Math.max(0, v.currentTime / dur)) : 0
      onFrame(v, progress)
      this.motionBlurRaf = requestAnimationFrame(tick)
    }
    this.motionBlurRaf = requestAnimationFrame(tick)
  }

  private playReverse(v: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.playing) {
        reject(new Error('cancelled'))
        return
      }
      if (!v.duration || !Number.isFinite(v.duration)) {
        reject(new Error('no duration'))
        return
      }

      const finish = () => {
        cleanup()
        v.pause()
        v.playbackRate = 1
        this.endTransition(true)
        resolve()
      }

      const fail = (err: Error) => {
        cleanup()
        reject(err)
      }

      let nativeGuard: ReturnType<typeof setTimeout> | null = null
      let nativeMoving = false
      let lastNativeTime = v.duration

      const cleanup = () => {
        this.stopReverseAnimation()
        v.removeEventListener('timeupdate', onNativeTime)
        if (nativeGuard) clearTimeout(nativeGuard)
      }

      const onNativeTime = () => {
        if (v.playbackRate < 0 && v.currentTime < lastNativeTime - 0.0005) {
          nativeMoving = true
        }
        lastNativeTime = v.currentTime
        if (v.currentTime <= 0.04) finish()
      }

      const startScrubFallback = () => {
        cleanup()
        v.pause()
        v.playbackRate = 1
        void this.playReverseScrub(v)
          .then(finish)
          .catch((err) => {
            if (err instanceof Error && err.message === 'cancelled') fail(err)
            else fail(err instanceof Error ? err : new Error('reverse failed'))
          })
      }

      // Mesma via da ida: vídeo visível em 1x (fluidez e FPS do arquivo).
      v.pause()
      v.playbackRate = -1
      v.classList.add('visible')
      this.canvas.classList.add('hidden')
      v.addEventListener('timeupdate', onNativeTime)

      const tryNativePlay = () => {
        void v.play()
          .then(() => {
            nativeGuard = window.setTimeout(() => {
              if (!this.playing) return
              if (!nativeMoving && v.currentTime > v.duration * 0.85) {
                startScrubFallback()
              }
            }, 450)
          })
          .catch(() => startScrubFallback())
      }

      if (Math.abs(v.currentTime - v.duration) < 0.05) {
        tryNativePlay()
        return
      }

      v.addEventListener(
        'seeked',
        () => {
          tryNativePlay()
        },
        { once: true },
      )
      try {
        v.currentTime = Math.max(0, v.duration - 0.001)
      } catch {
        startScrubFallback()
      }
    })
  }

  /**
   * Fallback: scrub no canvas na mesma duração do vídeo (1x), sem await por seek.
   */
  private playReverseScrub(v: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.playing) {
        reject(new Error('cancelled'))
        return
      }
      if (!v.duration || !Number.isFinite(v.duration)) {
        reject(new Error('no duration'))
        return
      }

      v.pause()
      v.playbackRate = 1
      v.classList.remove('visible')
      this.canvas.classList.remove('hidden')

      const duration = v.duration
      const wallStart = performance.now()
      let lastSeekTarget = -1

      const tick = (now: number) => {
        if (!this.playing) {
          reject(new Error('cancelled'))
          return
        }

        const elapsed = Math.min(duration, (now - wallStart) / 1000)
        const targetTime = duration * (1 - elapsed / duration)

        if (Math.abs(targetTime - lastSeekTarget) >= 0.02) {
          lastSeekTarget = targetTime
          try {
            if (Math.abs(v.currentTime - targetTime) >= 0.012) {
              v.currentTime = targetTime
            }
          } catch {
            /* ignore seek errors */
          }
        }

        this.snapVideoFrameToCanvas(v)

        if (elapsed < duration) {
          this.reverseRaf = requestAnimationFrame(tick)
          return
        }

        try {
          v.currentTime = 0
        } catch {
          /* ignore */
        }
        this.snapVideoFrameToCanvas(v)
        resolve()
      }

      const boot = () => {
        this.snapVideoFrameToCanvas(v)
        this.reverseRaf = requestAnimationFrame(tick)
      }

      try {
        v.currentTime = Math.max(0, duration - 0.001)
      } catch {
        boot()
        return
      }

      v.addEventListener('seeked', boot, { once: true })
      window.setTimeout(boot, 48)
    })
  }

  snapVideoFrameToCanvas(v: HTMLVideoElement) {
    if (!v.videoWidth) return
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const layout = syncStageCanvas(this.canvas, ctx)
    drawImageFit(ctx, v, layout.w, layout.h, 0, getDefaultCanvasFit())
  }

  prefetch(config: VideoTransition) {
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'video'
    link.href = resolveVideoSrcCandidates(config)[0]!
    document.head.appendChild(link)
  }
}
