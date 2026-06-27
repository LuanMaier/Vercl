import { SEQUENCES } from '../config/sequences'
import { getTransition } from '../config/transitions'
import { getHeroRef } from '../config/heroConfig'
import { POSTERS } from '../config/posters'
import { DEFAULT_POI_IMAGE } from '../config/pois'
import { getProjectPoiImagePath, getProjectPoiLoopVideoPath, getProjectSolarFrameInitial, getPoiCardMediaMode, getMenuMediaMode, getProjectMenuLoopVideoPath, getProjectMenuImagePath, getProjectMenuVideoPath, getProjectApartmentLoopVideoPath } from '../config/projectMedia'
import { findPoiById } from '../config/poiConfig'
import { getLightPoster, LIGHT_SEQUENCES, USE_LIGHT_FRAME_SEQUENCES } from '../config/lighting'
import {
  getLightTransitionVideo,
  isLightMotionBlurEnabled,
  lightModeAfterStep,
  lightModeBeforeStep,
  lightSequenceKeyForStep,
  resolveLightTransitionSteps,
  viewHasLightTransitionVideo,
} from '../config/lightMedia'
import { resolveViewLoop } from '../config/viewLoops'
import {
  getInteriorItem,
  getInteriorPagesForItem,
  resolveInteriorPageMediaPath,
} from '../config/interiorPages'
import { APARTMENTS_HUB_VIEW, apartmentMediaKey } from '../config/apartments'
import {
  getApartmentItem,
  getApartmentPagesForItem,
  resolveApartmentPageMediaPath,
} from '../config/apartmentPages'
import { getFacadeApartmentId } from '../config/apartmentOutlinesConfig'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { findPoiNavLink, resolvePoiTransitionForEdge } from './poiNavigation'
import { drawImageFit, motionBlurAmount } from './motionBlur'
import { STILL_VIEW_IMAGE_FIT, type ImageFitMode } from './coverCoords'
import { interiorFade } from './interiorFade'
import { isPanoramaView, panoramaFade } from './panoramaFade'
import { stageFade } from './stageFade'
import { prefetchForView, prefetchPoiVideo } from './prefetch'
import type { VideoPlayOptions } from './videoTransitionPlayer'
import { resolveMediaPath, prefersReducedMotion, isMobileViewport, desktopMediaPath } from './paths'
import type { FrameSequence, JumpOptions, LightMode, NavStep, PlayState, VideoTransition } from './types'
import { edgeKey, isSequenceTransition, isVideoTransition } from './types'
import type { VideoTransitionPlayer } from './videoTransitionPlayer'

export type EngineListener = () => void

export class ExplorerEngine {
  state: PlayState = 'idle'
  currentView = 0
  queue: NavStep[] = []
  currentLight: LightMode = 'day'
  /** 0 = dia, 1 = noite — posição do slider de sol */
  lightSliderProgress = 0
  /** Usuário arrastou o slider — mantém frame até Panorâmica ou reload */
  lightSliderFrameHeld = false
  interiorsPanelOpen = false
  activeInteriorId: string | null = null
  interiorBookOpen = false
  interiorBookPageIndex = 0
  apartmentsPanelOpen = false
  activeApartmentId: string | null = null
  /** Fachada CRM desenhada no canvas — highlights só aparecem após true. */
  apartmentFaceReady = false

  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private seqRaf: number | null = null
  private lightRaf: number | null = null
  private listeners = new Set<EngineListener>()
  private videoPlayer: VideoTransitionPlayer | null = null
  private customTransition: VideoTransition | null = null
  private customTransitionImage: string | null = null
  private panoArrivalReveal = false
  private transitionMotionBlur = false
  private pendingPoiEndImage: string | null = null
  private pendingMenuTransitionImage: string | null = null
  private holdPoiEndFrame = false
  private holdMenuTransitionFrame = false
  private poiEndImageCache = new Map<string, HTMLImageElement>()
  private static readonly POI_END_IMAGE_CACHE_MAX = 32
  private pinImmersiveActive = false
  /** POI cuja imagem final está no canvas — pins filhos aparecem sobre ela. */
  private immersivePoiId: string | null = null
  private immersiveImageRef: string | null = null
  private immersiveStack: Array<{ poiId: string; imageRef: string }> = []
  /** Vista do menu/cena antes de entrar no pin — alvo do botão Voltar. */
  private immersiveReturnView: number | null = null
  private pendingImmersivePoiId: string | null = null
  private menuFadeArrival = false
  /** Esmaecimento ao clicar pin (vídeo / imagem final) — não só menu. */
  private pinTransitionFade = false
  private emitLock = false
  /** Primeira carga da panorâmica concluída — slider pode pré-carregar TIMELAPSE. */
  private panoramaBooted = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    window.addEventListener('resize', () => this.resize())
    this.resize()
  }

  setVideoPlayer(player: VideoTransitionPlayer) {
    this.videoPlayer = player
  }

  prefetchPoiMedia(ref: string) {
    prefetchPoiVideo(ref, this.videoPlayer ?? undefined)
  }

  subscribe(fn: EngineListener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    if (this.emitLock) return
    this.emitLock = true
    try {
      this.listeners.forEach((fn) => fn())
    } finally {
      this.emitLock = false
    }
  }

  /** Atualiza chrome (insolação, dock) sem mudar estado de reprodução. */
  notifyUi() {
    this.emit()
  }

  resize() {
    const mobile = isMobileViewport()
    const dpr = mobile ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = window.innerWidth * dpr
    this.canvas.height = window.innerHeight * dpr
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  drawFrame(
    img: HTMLImageElement | HTMLVideoElement | ImageBitmap,
    blurPx = 0,
    fit: ImageFitMode = 'cover',
  ) {
    const w = window.innerWidth
    const h = window.innerHeight
    drawImageFit(this.ctx, img, w, h, blurPx, fit)
  }

  /** Frame de vídeo no canvas (slider de sol). */
  presentVideoFrame(video: HTMLVideoElement) {
    this.resize()
    this.cancelPlayback()
    this.videoPlayer?.cancel()
    this.videoPlayer?.stopLoop()
    this.canvas.classList.remove('hidden')
    this.drawFrame(video)
  }

  /** Frame pré-cacheada do slider (scrub fluido). */
  presentBitmapFrame(bitmap: ImageBitmap, fit: ImageFitMode = 'cover') {
    this.resize()
    this.cancelPlayback()
    this.videoPlayer?.cancel()
    this.videoPlayer?.stopLoop()
    this.canvas.classList.remove('hidden')
    this.drawFrame(bitmap, 0, fit)
  }

  /** Imagem parada no canvas (frames inicial/final do slider / vistas). */
  presentStillImage(img: HTMLImageElement, fit: ImageFitMode = STILL_VIEW_IMAGE_FIT) {
    this.presentCoverImage(img, fit)
  }

  /** Imagem no canvas — cover por padrão; vistas idle usam contain. */
  private presentCoverImage(img: HTMLImageElement, fit: ImageFitMode = 'cover') {
    this.resize()
    this.cancelPlayback()
    this.videoPlayer?.cancel()
    this.canvas.classList.remove('hidden')
    this.drawFrame(img, 0, fit)
  }

  private loadCoverImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const mobileSrc = resolveMediaPath(src)
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => {
        if (mobileSrc !== src) {
          const fallback = new Image()
          fallback.onload = () => resolve(fallback)
          fallback.onerror = () => resolve(null)
          fallback.src = desktopMediaPath(mobileSrc)
          return
        }
        resolve(null)
      }
      img.src = mobileSrc
    })
  }

  showPoster(viewIndex: number) {
    void this.arriveAtView(viewIndex)
  }

  isPinImmersiveActive() {
    return this.pinImmersiveActive
  }

  getImmersivePoiId() {
    return this.immersivePoiId
  }

  /** Vídeo idle em loop na vista atual — métricas para posicionar pins. */
  getLoopVideoMetrics(): { w: number; h: number } | null {
    return this.videoPlayer?.getLoopVideoMetrics() ?? null
  }

  getImmersiveImageRef() {
    return this.immersiveImageRef
  }

  canGoBackImmersive() {
    if (!this.pinImmersiveActive || this.activeApartmentId) return false
    return this.immersiveStack.length > 0 || this.immersiveReturnView !== null
  }

  /** Volta um nível na navegação imersiva (filho → pai) ou à cena anterior (pin → vista). */
  async goBackImmersiveLevel(): Promise<boolean> {
    if (this.state === 'playing') return false

    if (this.immersiveStack.length > 0) {
      const prev = this.immersiveStack.pop()
      if (!prev) return false

      this.state = 'playing'
      this.emit()

      try {
        await stageFade.cover()
        this.immersivePoiId = prev.poiId
        this.immersiveImageRef = prev.imageRef
        this.pinImmersiveActive = true
        this.holdPoiEndFrame = true

        const preloaded = await this.preloadPoiEndImage(prev.imageRef)
        if (preloaded) await this.applyPoiEndMedia(prev.imageRef, prev.poiId, preloaded)
        else await this.showPoiEndImage(prev.imageRef, prev.poiId)

        await stageFade.reveal()
        return true
      } catch {
        stageFade.forceOff()
        return false
      } finally {
        this.state = 'idle'
        this.emit()
      }
    }

    if (!this.pinImmersiveActive || this.immersiveReturnView === null) return false
    const returnView = this.immersiveReturnView
    await this.returnToMenuViewWithFade(returnView)
    return true
  }

  /** Pin filho — fade out/in entre imagens (sem vídeo). */
  async transitionToImmersivePoi(poiId: string, imageRef: string): Promise<boolean> {
    if (this.state === 'playing') return false
    this.state = 'playing'
    this.emit()

    try {
      await stageFade.cover()
      this.enterImmersivePoi(poiId, imageRef)
      const preloaded = await this.preloadPoiEndImage(imageRef)
      if (preloaded) await this.applyPoiEndMedia(imageRef, poiId, preloaded)
      else await this.showPoiEndImage(imageRef, poiId)
      await stageFade.reveal()
      return true
    } catch {
      stageFade.forceOff()
      return false
    } finally {
      this.state = 'idle'
      this.emit()
    }
  }

  /** Registra pin ativo e empilha nível anterior (navegação filho → filho). */
  enterImmersivePoi(poiId: string, imageRef: string) {
    if (this.immersivePoiId && this.immersiveImageRef) {
      this.immersiveStack.push({
        poiId: this.immersivePoiId,
        imageRef: this.immersiveImageRef,
      })
    } else if (this.immersiveReturnView === null) {
      this.immersiveReturnView = this.currentView
    }
    this.immersivePoiId = poiId
    this.immersiveImageRef = imageRef
    this.pinImmersiveActive = true
    this.holdPoiEndFrame = true
  }

  private rememberImmersiveReturnView(viewIndex: number) {
    if (this.immersiveReturnView === null && !this.immersivePoiId) {
      this.immersiveReturnView = viewIndex
    }
  }

  isApartmentFaceReady() {
    return this.apartmentFaceReady
  }

  private setApartmentFaceReady(ready: boolean) {
    if (this.apartmentFaceReady === ready) return
    this.apartmentFaceReady = ready
    this.emit()
  }

  /** Hero da panorâmica já foi exibido no boot (evita flash do TIMELAPSE). */
  isPanoramaBooted() {
    return this.panoramaBooted
  }

  /** Insolação só na panorâmica livre (vista 0, sem experiência de pin). */
  canChangeLight() {
    return (
      isPanoramaView(this.currentView) &&
      !this.pinImmersiveActive &&
      !this.interiorsPanelOpen &&
      !this.activeInteriorId &&
      !this.apartmentsPanelOpen &&
      !this.activeApartmentId
    )
  }

  /** Volta ao poster/HERO do botão do menu (mesma vista). */
  async returnToMenuViewWithFade(viewIndex: number): Promise<void> {
    if (this.state === 'playing') return
    this.resetPinExperience()
    this.holdMenuTransitionFrame = false

    const panorama = isPanoramaView(viewIndex)
    if (panorama) {
      this.clearLightSliderFrame()
      this.emit()
    }

    await stageFade.cover()
    this.currentView = viewIndex
    if (panorama) this.panoArrivalReveal = true
    await this.showIdle(viewIndex)
    await stageFade.reveal()
    this.panoArrivalReveal = false
    stageFade.ensureVisible()

    this.state = 'idle'
    this.emit()
  }

  /** Volta à panorâmica com fade (ex.: após analisar imagem do pin na mesma vista). */
  async returnToPanoramaWithFade(): Promise<void> {
    return this.returnToMenuViewWithFade(0)
  }

  /** Primeira carga no site (panorâmica). */
  async bootPanorama() {
    this.panoramaBooted = false
    this.currentView = 0
    panoramaFade.forceCover()
    await this.showIdle(0)
    await panoramaFade.reveal()
    this.state = 'idle'
    this.panoramaBooted = true
    this.emit()
  }

  private async arriveAtView(viewIndex: number) {
    if (isPanoramaView(viewIndex)) {
      stageFade.releaseForPlayback()
      await this.showIdle(viewIndex)
      if (this.panoArrivalReveal || stageFade.isCovered()) {
        this.panoArrivalReveal = false
        this.menuFadeArrival = false
        await stageFade.reveal()
      }
      return
    }
    this.panoArrivalReveal = false
    await this.showIdle(viewIndex)
  }

  /** Indo para panorâmica (dock): escurece a vista atual, transição, reveal ao chegar. */
  private async withPanoramaEntry(from: number, target: number, run: () => void) {
    if (isPanoramaView(from) || !isPanoramaView(target)) {
      run()
      return
    }
    if (panoramaFade.isTransitionHold()) {
      this.panoArrivalReveal = true
      run()
      return
    }
    await panoramaFade.cover()
    panoramaFade.lockForTransition()
    this.panoArrivalReveal = true
    run()
  }

  private releaseTransitionOverlay() {
    panoramaFade.releaseForPlayback()
  }

  private videoOptsForEdge(from: number): VideoPlayOptions {
    const useFade = stageFade.isTransitionHold() || stageFade.isCovered()
    const opts: VideoPlayOptions = {
      primeFirstFrame: useFade || isPanoramaView(from),
      onPlaybackVisible: useFade ? () => this.releaseTransitionOverlay() : undefined,
      deferPlaybackVisibleUntilPlaying: useFade,
    }
    if (this.transitionMotionBlur) {
      opts.motionBlur = true
      opts.onMotionBlurFrame = (video, progress) => {
        this.drawFrame(video, motionBlurAmount(progress))
      }
    }
    return opts
  }

  private async showIdle(viewIndex: number) {
    this.videoPlayer?.stopLoop()

    if (isPanoramaView(viewIndex)) {
      this.lightSliderFrameHeld = false
    }

    const loop = await resolveViewLoop(viewIndex)
    if (loop && this.videoPlayer) {
      const heroRef =
        (isPanoramaView(viewIndex)
          ? (getProjectSolarFrameInitial(viewIndex) ?? getHeroRef(viewIndex))
          : getHeroRef(viewIndex)) ?? POSTERS[viewIndex]
      if (heroRef) {
        const posterSrc = (await resolveMediaSrc(heroRef)) ?? resolveMediaPath(heroRef)
        if (posterSrc) loop.poster = posterSrc
      }
      const ok = await this.videoPlayer.playCanvasLoop(loop, STILL_VIEW_IMAGE_FIT)
      if (ok) {
        prefetchForView(viewIndex, this.videoPlayer)
        return
      }
    }

    await this.showStillFrame(viewIndex)
  }

  private async showStillFrame(viewIndex: number) {
    const ref = isPanoramaView(viewIndex)
      ? (getProjectSolarFrameInitial(viewIndex) ??
          getHeroRef(viewIndex) ??
          POSTERS[viewIndex])
      : (getLightPoster(viewIndex, this.currentLight) ??
          getHeroRef(viewIndex) ??
          POSTERS[viewIndex])
    if (!ref) return
    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    await new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => {
        this.presentCoverImage(img, STILL_VIEW_IMAGE_FIT)
        prefetchForView(viewIndex, this.videoPlayer ?? undefined)
        resolve()
      }
      img.onerror = () => {
        prefetchForView(viewIndex, this.videoPlayer ?? undefined)
        resolve()
      }
      img.src = src
    })
  }

  private async showPoiEndImage(imageRef: string, poiId?: string) {
    if (poiId && (await this.tryApplyPoiEndLoop(poiId, imageRef))) return
    const img = await this.preloadPoiEndImage(imageRef)
    if (img) this.applyPoiEndImage(img)
  }

  private async tryApplyMenuEndLoop(viewIndex: number, posterRef: string): Promise<boolean> {
    if (getMenuMediaMode(viewIndex) !== 'loop' || !this.videoPlayer) return false
    const loopPath = getProjectMenuLoopVideoPath(viewIndex)
    if (!loopPath) return false
    const src = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
    if (!src) return false
    let poster: string | undefined
    const posterRefResolved =
      posterRef ?? getProjectMenuImagePath(viewIndex) ?? getHeroRef(viewIndex) ?? POSTERS[viewIndex]
    if (posterRefResolved) {
      poster = (await resolveMediaSrc(posterRefResolved)) ?? resolveMediaPath(posterRefResolved)
    }
    return this.videoPlayer.playCanvasLoop(
      { type: 'video', src, poster },
      STILL_VIEW_IMAGE_FIT,
    )
  }

  private async applyMenuEndMedia(viewIndex: number, posterRef: string) {
    if (await this.tryApplyMenuEndLoop(viewIndex, posterRef)) return
    const img = await this.preloadPoiEndImage(posterRef)
    if (img) this.applyPoiEndImage(img)
  }

  private async tryApplyPoiEndLoop(poiId: string, posterRef: string): Promise<boolean> {
    const poi = findPoiById(poiId)
    if (!poi || getPoiCardMediaMode(poi) !== 'loop' || !this.videoPlayer) return false
    const loopPath = getProjectPoiLoopVideoPath(poiId)
    if (!loopPath) return false
    const src = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
    if (!src) return false
    let poster: string | undefined
    const posterRefResolved = posterRef || poi.img || getProjectPoiImagePath(poiId)
    if (posterRefResolved) {
      poster = (await resolveMediaSrc(posterRefResolved)) ?? resolveMediaPath(posterRefResolved)
    }
    return this.videoPlayer.playCanvasLoop(
      { type: 'video', src, poster },
      STILL_VIEW_IMAGE_FIT,
    )
  }

  private async applyPoiEndMedia(imageRef: string, poiId?: string, preloaded?: HTMLImageElement | null) {
    if (poiId && (await this.tryApplyPoiEndLoop(poiId, imageRef))) return
    if (preloaded) {
      this.applyPoiEndImage(preloaded)
      return
    }
    await this.showPoiEndImage(imageRef, poiId)
  }

  /** Pré-carrega imagem do pin para evitar piscada ao terminar o vídeo. */
  async preloadPoiEndImage(imageRef: string): Promise<HTMLImageElement | null> {
    const ref = imageRef || DEFAULT_POI_IMAGE
    const cached = this.poiEndImageCache.get(ref)
    if (cached?.complete && cached.naturalWidth) return cached

    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        if (this.poiEndImageCache.size >= ExplorerEngine.POI_END_IMAGE_CACHE_MAX) {
          const oldest = this.poiEndImageCache.keys().next().value
          if (oldest) this.poiEndImageCache.delete(oldest)
        }
        this.poiEndImageCache.set(ref, img)
        resolve(img)
      }
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  private applyPoiEndImage(img: HTMLImageElement) {
    this.presentCoverImage(img, STILL_VIEW_IMAGE_FIT)
  }

  private resolvePoiEndImage(
    from: number,
    to: number,
    explicit?: string | null,
  ): string | undefined {
    if (explicit) return explicit
    const poi = findPoiNavLink(from, to)
    if (poi) {
      return poi.img ?? getProjectPoiImagePath(poi.id) ?? DEFAULT_POI_IMAGE
    }
    const hero = getHeroRef(from) ?? POSTERS[from]
    return hero ?? DEFAULT_POI_IMAGE
  }

  private runQueue() {
    if (!this.queue.length) {
      this.transitionMotionBlur = false
      this.state = 'idle'
      this.emit()
      if (this.holdPoiEndFrame || this.holdMenuTransitionFrame) {
        this.holdPoiEndFrame = false
        this.holdMenuTransitionFrame = false
        prefetchForView(this.currentView, this.videoPlayer ?? undefined)
        void this.finishSceneFadeReveal()
        return
      }
      void this.settleAtView(this.currentView)
      return
    }
    const step = this.queue.shift()!
    this.playTransition(step.from, step.to)
  }

  /** Revela o idle final da vista (loop ou poster) — com fade só no menu. */
  private async settleAtView(viewIndex: number) {
    try {
      if (this.wantsSceneFade()) {
        await this.fadeSceneOut()
      }
      if (isPanoramaView(viewIndex)) {
        this.panoArrivalReveal = false
        stageFade.releaseForPlayback()
      }
      await this.showIdle(viewIndex)
      if (this.wantsSceneFade()) {
        await this.fadeSceneIn()
      } else {
        stageFade.ensureVisible()
        void this.finishSceneFadeReveal()
      }
      prefetchForView(viewIndex, this.videoPlayer ?? undefined)
    } catch {
      stageFade.forceOff()
      void this.finishSceneFadeReveal()
      await this.showIdle(viewIndex).catch(() => {})
    }
  }

  private wantsSceneFade() {
    return this.menuFadeArrival || this.pinTransitionFade
  }

  private async finishSceneFadeReveal() {
    this.menuFadeArrival = false
    this.pinTransitionFade = false
    if (stageFade.isCovered() || stageFade.isTransitionHold()) {
      await stageFade.reveal()
      return
    }
    stageFade.ensureVisible()
  }

  /** Esmaece a cena atual — menu ou transição de pin. */
  private async fadeSceneOut() {
    if (!this.wantsSceneFade()) return
    if (stageFade.isCovered()) return
    await stageFade.cover()
    stageFade.lockForTransition()
  }

  /** Revela a cena — menu ou transição de pin. */
  private async fadeSceneIn() {
    if (!this.wantsSceneFade()) return
    await this.finishSceneFadeReveal()
  }

  /** Chamado pelo menu antes de trocar de vista — descarta estado de pin. */
  resetForMenuNavigation() {
    this.resetPinExperience()
  }

  /** Limpa experiência de pin — menu sempre volta à cena do botão. */
  private resetPinExperience() {
    this.pinImmersiveActive = false
    this.holdPoiEndFrame = false
    this.holdMenuTransitionFrame = false
    this.pendingPoiEndImage = null
    this.pendingImmersivePoiId = null
    this.immersivePoiId = null
    this.immersiveImageRef = null
    this.immersiveReturnView = null
    this.immersiveStack = []
  }


  jumpTo(target: number, options?: JumpOptions) {
    if (this.state === 'playing') return

    const from = this.currentView
    const goingToPanorama = isPanoramaView(target)

    if (target === from) {
      if (this.pinImmersiveActive) {
        void this.returnToMenuViewWithFade(target)
      }
      return
    }

    if (options?.menuFade) {
      this.resetPinExperience()
    } else {
      this.pinImmersiveActive = false
    }
    this.menuFadeArrival = Boolean(options?.menuFade)
    this.pinTransitionFade =
      !options?.menuFade &&
      Boolean(
        options?.poiEndImage ||
          options?.immersivePoiId ||
          options?.transitionVideo ||
          options?.transitionImage,
      )

    const usePanoramaFade =
      options?.panoramaFade === true && goingToPanorama && !isPanoramaView(from)

    if (usePanoramaFade) {
      void this.withPanoramaEntry(from, target, () => {
        this.beginJumpTo(target, options)
      })
      return
    }

    this.beginJumpTo(target, options)
  }

  /** Vídeo do pin na mesma vista (sem mudar de cena) — ex.: destino = vista atual. */
  async playInlineTransition(
    video: VideoTransition,
    options?: {
      motionBlur?: boolean
      poiEndImage?: string
      videoRollback?: boolean
      immersivePoiId?: string
      sceneReturnView?: number
    },
  ): Promise<boolean> {
    if (this.state === 'playing' || !this.videoPlayer) return false
    this.transitionMotionBlur = Boolean(options?.motionBlur)
    this.state = 'playing'
    this.emit()

    const endImage = options?.poiEndImage ?? DEFAULT_POI_IMAGE
    const preloaded = await this.preloadPoiEndImage(endImage)

    try {
      await stageFade.cover()
      stageFade.lockForTransition()

      const edgeOpts = this.videoOptsForEdge(this.currentView)
      const ok = await this.videoPlayer.play(video, {
        ...edgeOpts,
        primeFirstFrame: false,
        endOnStillPoster: true,
      })
      this.releaseTransitionOverlay()
      this.transitionMotionBlur = false
      if (ok) {
        if (options?.sceneReturnView !== undefined) {
          this.rememberImmersiveReturnView(options.sceneReturnView)
        }
        if (preloaded) await this.applyPoiEndMedia(endImage, options?.immersivePoiId, preloaded)
        else await this.showPoiEndImage(endImage, options?.immersivePoiId)
        if (options?.immersivePoiId) {
          this.enterImmersivePoi(options.immersivePoiId, endImage)
        } else {
          this.rememberImmersiveReturnView(options?.sceneReturnView ?? this.currentView)
          this.pinImmersiveActive = true
          this.holdPoiEndFrame = true
        }
      }
      await stageFade.reveal()
      stageFade.ensureVisible()
      return ok
    } catch {
      stageFade.forceOff()
      return false
    } finally {
      this.state = 'idle'
      this.emit()
    }
  }

  /** Loop em tela cheia na mesma vista — sem vídeo de transição do pin. */
  async playDirectPoiLoop(options: {
    poiId: string
    poiEndImage?: string
    sceneReturnView?: number
  }): Promise<boolean> {
    if (this.state === 'playing' || !this.videoPlayer) return false
    this.state = 'playing'
    this.emit()

    const endImage = options.poiEndImage ?? DEFAULT_POI_IMAGE

    try {
      await stageFade.cover()
      stageFade.lockForTransition()
      if (options.sceneReturnView !== undefined) {
        this.rememberImmersiveReturnView(options.sceneReturnView)
      }
      await this.applyPoiEndMedia(endImage, options.poiId)
      this.enterImmersivePoi(options.poiId, endImage)
      this.holdPoiEndFrame = true
      await stageFade.reveal()
      stageFade.ensureVisible()
      return true
    } catch {
      stageFade.forceOff()
      return false
    } finally {
      this.state = 'idle'
      this.emit()
    }
  }

  private beginJumpTo(target: number, options?: JumpOptions) {
    const from = this.currentView
    const menuNav = Boolean(options?.menuFade)
    if (!menuNav && options?.immersivePoiId) {
      this.rememberImmersiveReturnView(from)
    }
    this.pendingPoiEndImage = menuNav ? null : (options?.poiEndImage ?? null)
    this.pendingImmersivePoiId = menuNav ? null : (options?.immersivePoiId ?? null)
    this.pendingMenuTransitionImage = options?.transitionImage ?? null
    this.transitionMotionBlur = Boolean(options?.motionBlur)
    this.customTransition = options?.transitionVideo ?? null
    this.customTransitionImage = options?.transitionImage ?? null
    const steps = this.buildNavSteps(from, target)

    if (this.customTransition || this.customTransitionImage) {
      this.queue = [{ from, to: target }]
      this.runQueue()
      return
    }

    if (steps.length) {
      this.queue = steps
      this.runQueue()
      return
    }

    this.cancelPlayback()
    this.queue = []
    this.currentView = target
    this.state = 'playing'
    this.emit()
    void (async () => {
      try {
        if (this.wantsSceneFade()) {
          await this.fadeSceneOut()
        }
        await this.showIdle(target)
        if (this.wantsSceneFade()) {
          await this.fadeSceneIn()
        }
      } catch {
        stageFade.forceOff()
        await this.showIdle(target).catch(() => {})
      } finally {
        this.state = 'idle'
        this.emit()
      }
    })()
  }

  /** Rota direta ou panorâmica (0) no meio — sem teleporte instantâneo. */
  private buildNavSteps(from: number, to: number): NavStep[] {
    if (from === to) return []

    const direct = getTransition(from, to)
    if (direct) return [{ from, to }]

    if (from !== 0) {
      const toHub = getTransition(from, 0)
      const fromHub = getTransition(0, to)
      if (toHub && fromHub) {
        return [
          { from, to: 0 },
          { from: 0, to },
        ]
      }
    }

    return []
  }

  private cancelPlayback() {
    if (this.seqRaf) {
      cancelAnimationFrame(this.seqRaf)
      this.seqRaf = null
    }
    this.videoPlayer?.cancel()
  }

  playTransition(from: number, to: number) {
    const explicitCustom = this.customTransition
    const explicitCustomImage = this.customTransitionImage
    const pendingEndImage = this.pendingPoiEndImage
    const pendingImmersivePoiId = this.pendingImmersivePoiId
    const pendingMenuImage = this.pendingMenuTransitionImage
    const menuImageRef = explicitCustomImage ?? pendingMenuImage
    this.customTransition = null
    this.customTransitionImage = null
    this.pendingPoiEndImage = null
    this.pendingImmersivePoiId = null
    this.pendingMenuTransitionImage = null

    const config = getTransition(from, to)
    const videoOpts = this.videoOptsForEdge(from)

    if (!explicitCustom && (menuImageRef || getMenuMediaMode(to) !== 'image')) {
      this.state = 'playing'
      this.emit()
      this.cancelPlayback()
      void this.playMenuMediaTransition(menuImageRef ?? undefined, to)
      return
    }

    this.state = 'playing'
    this.emit()
    this.cancelPlayback()

    void (async () => {
      try {
        await this.fadeSceneOut()

        const menuNav = this.menuFadeArrival
        const custom =
          explicitCustom ??
          (menuNav ? undefined : await resolvePoiTransitionForEdge(from, to))

        if (!config && !custom) {
          this.currentView = to
          this.runQueue()
          return
        }

        if (custom && this.videoPlayer) {
          const endImage = menuNav
            ? menuImageRef ??
              getProjectMenuImagePath(to) ??
              getHeroRef(to) ??
              POSTERS[to]
            : this.resolvePoiEndImage(from, to, pendingEndImage)
          if (endImage) {
            videoOpts.endOnStillPoster = true
            videoOpts.endImageRef = endImage
          }
          if (pendingImmersivePoiId) {
            videoOpts.immersivePoiId = pendingImmersivePoiId
          }
          void this.playVideoTransition(custom, from, to, config, videoOpts)
          return
        }

        if (custom && !this.videoPlayer) {
          this.currentView = to
          this.runQueue()
          return
        }

        if (!config) {
          this.currentView = to
          this.runQueue()
          return
        }

        if (isVideoTransition(config) && this.videoPlayer) {
          const ok = await this.videoPlayer.play(config, videoOpts)
          if (ok) {
            this.currentView = to
            this.runQueue()
            return
          }
          this.releaseTransitionOverlay()
          const fallback = SEQUENCES[edgeKey(from, to)]
          if (fallback) {
            this.playFrameSequence(fallback, () => {
              this.currentView = to
              this.runQueue()
            })
          } else {
            this.currentView = to
            this.runQueue()
          }
          return
        }

        if (isSequenceTransition(config)) {
          this.playFrameSequence(config, () => {
            this.currentView = to
            this.runQueue()
          })
        }
      } catch {
        this.currentView = to
        this.state = 'idle'
        stageFade.forceOff()
        void this.finishSceneFadeReveal()
        this.emit()
        this.runQueue()
      }
    })()
  }

  private async playMenuMediaTransition(imageRef: string | undefined, to: number) {
    const menuFade = this.menuFadeArrival
    this.currentView = to
    const useLoop = getMenuMediaMode(to) === 'loop'
    const useVideo = getMenuMediaMode(to) === 'video'
    const loopPath = useLoop ? getProjectMenuLoopVideoPath(to) : undefined
    const arrivalVideoPath = useVideo ? getProjectMenuVideoPath(to) : undefined

    try {
      await this.fadeSceneOut()
      this.videoPlayer?.stopLoop()

      if (loopPath && this.videoPlayer) {
        const src = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
        let poster: string | undefined
        const posterRef =
          imageRef ?? getProjectMenuImagePath(to) ?? getHeroRef(to) ?? POSTERS[to]
        if (posterRef) {
          poster = (await resolveMediaSrc(posterRef)) ?? resolveMediaPath(posterRef)
        }
        const ok = await this.videoPlayer.playCanvasLoop(
          { type: 'video', src, poster },
          STILL_VIEW_IMAGE_FIT,
        )
        if (!ok) await this.showStillFrame(to)
      } else if (arrivalVideoPath && this.videoPlayer) {
        const src = (await resolveMediaSrc(arrivalVideoPath)) ?? resolveMediaPath(arrivalVideoPath)
        const ok = await this.videoPlayer.play(
          { type: 'video', src },
          { primeFirstFrame: true, endOnStillPoster: true },
        )
        if (!ok) await this.showStillFrame(to)
      } else if (imageRef) {
        const src = (await resolveMediaSrc(imageRef)) ?? resolveMediaPath(imageRef)
        const img = await new Promise<HTMLImageElement | null>((resolve) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () => resolve(null)
          el.src = src
        })
        if (img) this.drawFrame(img, 0, STILL_VIEW_IMAGE_FIT)
        else await this.showStillFrame(to)
      } else {
        await this.showStillFrame(to)
      }

      this.emit()
      await this.fadeSceneIn()
      if (menuFade) this.holdMenuTransitionFrame = true
    } catch {
      await this.showStillFrame(to).catch(() => {})
      stageFade.forceOff()
      void this.finishSceneFadeReveal()
    } finally {
      this.state = 'idle'
      this.emit()
      this.runQueue()
    }
  }

  private playVideoTransition(
    video: VideoTransition,
    from: number,
    to: number,
    config: ReturnType<typeof getTransition>,
    playOptions?: VideoPlayOptions,
  ) {
    if (!this.videoPlayer) return
    const player = this.videoPlayer
    void (async () => {
      try {
        const endRef = playOptions?.endImageRef
        const preloaded = endRef ? await this.preloadPoiEndImage(endRef) : null
        const playOpts: VideoPlayOptions = {
          ...playOptions,
          primeFirstFrame: endRef
            ? Boolean(playOptions?.onPlaybackVisible)
            : playOptions?.primeFirstFrame,
        }
        const ok = await player.play(video, playOpts)
        if (ok) {
          if (endRef && !this.menuFadeArrival) {
            const immersiveId = playOptions?.immersivePoiId
            if (preloaded) await this.applyPoiEndMedia(endRef, immersiveId ?? undefined, preloaded)
            else await this.showPoiEndImage(endRef, immersiveId ?? undefined)
            this.holdPoiEndFrame = true
            if (immersiveId) {
              this.enterImmersivePoi(immersiveId, endRef)
            } else {
              this.pinImmersiveActive = true
            }
          } else if (endRef && this.menuFadeArrival) {
            await this.applyMenuEndMedia(to, endRef)
            this.holdMenuTransitionFrame = true
          } else if (playOpts?.endOnStillPoster) {
            await this.showStillFrame(to)
          }
          this.currentView = to
          this.runQueue()
          return
        }

        this.releaseTransitionOverlay()
        if (config && isSequenceTransition(config)) {
          this.playFrameSequence(config, () => {
            this.currentView = to
            this.runQueue()
          })
        } else if (config && isVideoTransition(config)) {
          const retryOk = await this.videoPlayer!.play(config, playOptions)
          if (retryOk) {
            this.currentView = to
            this.runQueue()
            return
          }
          this.releaseTransitionOverlay()
          this.currentView = to
          this.runQueue()
        } else {
          const fallback = SEQUENCES[edgeKey(from, to)]
          if (fallback) {
            this.playFrameSequence(fallback, () => {
              this.currentView = to
              this.runQueue()
            })
          } else {
            this.currentView = to
            this.runQueue()
          }
        }
      } catch {
        this.currentView = to
        stageFade.forceOff()
        void this.finishSceneFadeReveal()
        this.state = 'idle'
        this.emit()
        this.runQueue()
      }
    })()
  }

  /** Shared player for nav + lighting transitions */
  playFrameSequence(
    seq: FrameSequence,
    onDone: () => void,
    opts?: { releaseOverlayOnFirstFrame?: boolean },
  ) {
    const { pad = 2, ext = 'jpg', reverse = false } = seq
    const desktopBase = seq.base
    const mobileBase = resolveMediaPath(seq.base)
    const mobile = isMobileViewport()
    const reduced = prefersReducedMotion()
    const step = mobile ? 2 : 1
    const fps = reduced ? 14 : mobile ? 20 : (seq.fps ?? 36)
    const interval = 1000 / fps

    const indices: number[] = []
    for (let i = 0; i < seq.count; i += step) {
      indices.push(reverse ? seq.count - 1 - i : i)
    }
    const count = indices.length
    const frames: (HTMLImageElement | null)[] = new Array(count).fill(null)

    const frameSrc = (slot: number, useDesktop: boolean) => {
      const base = useDesktop ? desktopBase : mobileBase
      return base + String(indices[slot]).padStart(pad, '0') + '.' + ext
    }

    if (reduced && count > 0) {
      const finishStill = (useDesktop: boolean) => {
        const img = new Image()
        const slot = reverse ? 0 : count - 1
        img.onload = () => {
          this.drawFrame(img, 0, STILL_VIEW_IMAGE_FIT)
          if (opts?.releaseOverlayOnFirstFrame ?? stageFade.isTransitionHold()) {
            this.releaseTransitionOverlay()
          }
          onDone()
        }
        img.onerror = () => {
          if (!useDesktop && mobileBase !== desktopBase) finishStill(true)
          else onDone()
        }
        img.src = frameSrc(slot, useDesktop)
      }
      finishStill(false)
      return
    }

    const slots = mobile ? 4 : count
    let nextLoad = 0

    const loadSlot = () => {
      if (nextLoad >= count) return
      const i = nextLoad++
      const img = new Image()
      img.onload = loadSlot
      img.onerror = () => {
        if (mobile && mobileBase !== desktopBase && img.dataset.fallback !== '1') {
          img.dataset.fallback = '1'
          img.src = frameSrc(i, true)
          return
        }
        loadSlot()
      }
      img.src = frameSrc(i, false)
      frames[i] = img
    }
    for (let k = 0; k < Math.min(slots, count); k++) loadSlot()

    let frameIdx = 0
    let lastTime: number | null = null
    let overlayReleased = false
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      if (this.seqRaf) {
        cancelAnimationFrame(this.seqRaf)
        this.seqRaf = null
      }
      clearTimeout(bail)
      onDone()
    }

    const bail = window.setTimeout(() => {
      if (finished) return
      void this.showStillFrame(this.currentView).finally(finish)
    }, mobile ? 20000 : 8000)

    const tick = (ts: number) => {
      if (finished) return
      if (!lastTime) lastTime = ts
      if (ts - lastTime >= interval) {
        lastTime = ts
        const img = frames[frameIdx]
        if (img?.complete && img.naturalWidth) {
          const progress = count > 1 ? frameIdx / (count - 1) : 0
          const blur = this.transitionMotionBlur ? motionBlurAmount(progress) : 0
          this.drawFrame(img, blur, STILL_VIEW_IMAGE_FIT)
          if (!overlayReleased && (opts?.releaseOverlayOnFirstFrame ?? stageFade.isTransitionHold())) {
            overlayReleased = true
            this.releaseTransitionOverlay()
          }
          frameIdx++
        }
      }
      if (frameIdx < count) {
        this.seqRaf = requestAnimationFrame(tick)
      } else {
        finish()
      }
    }

    const start = () => {
      if (finished) return
      this.seqRaf = requestAnimationFrame(tick)
    }

    if (frames[0]?.complete && frames[0].naturalWidth) start()
    else if (frames[0]) {
      frames[0].onload = start
      frames[0].onerror = () => {
        void this.showStillFrame(this.currentView).finally(finish)
      }
    } else {
      void this.showStillFrame(this.currentView).finally(finish)
    }
  }

  setLightSliderProgress(progress: number) {
    this.lightSliderProgress = Math.max(0, Math.min(1, progress))
    this.lightSliderFrameHeld = true
  }

  clearLightSliderFrame() {
    this.lightSliderProgress = 0
    this.lightSliderFrameHeld = false
  }

  setLight(mode: LightMode) {
    if (!this.canChangeLight()) return
    if (mode === this.currentLight) return
    if (this.state === 'playing') return

    void this.playLightTransition(mode)
  }

  private async playLightTransition(target: LightMode) {
    const from = this.currentLight
    const steps = resolveLightTransitionSteps(from, target)
    if (!steps.length) return

    this.state = 'playing'
    this.emit()
    this.videoPlayer?.cancel({ keepCanvasHidden: true })
    this.videoPlayer?.stopLoop()

    const view = this.currentView
    const usePosterPath = !viewHasLightTransitionVideo(view, from, target)

    if (usePosterPath) {
      const motionBlur = isLightMotionBlurEnabled(view)
      await this.playLightPosterTransition(from, target, motionBlur)
      this.currentLight = target
      this.state = 'idle'
      this.emit()
      return
    }

    let ok = true
    for (const step of steps) {
      const played = await this.playLightStep(step)
      if (!played) {
        ok = false
        break
      }
    }

    if (ok) {
      this.currentLight = target
    } else {
      this.currentLight = from
      const seqKey = `${from}_${target}`
      await this.applyLightFallback(from, target, seqKey)
    }

    this.state = 'idle'
    this.emit()
  }

  private async loadLightPosterImage(mode: LightMode): Promise<HTMLImageElement | null> {
    const ref = getLightPoster(this.currentView, mode)
    if (!ref) return null
    const src = (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })
  }

  private crossfadeLightPosters(
    fromMode: LightMode,
    toMode: LightMode,
    motionBlur: boolean,
  ): Promise<void> {
    return new Promise((resolve) => {
      void (async () => {
        const imgFrom = await this.loadLightPosterImage(fromMode)
        const imgTo = await this.loadLightPosterImage(toMode)
        if (!imgTo) {
          resolve()
          return
        }
        if (!imgFrom || !motionBlur) {
          this.drawFrame(imgTo, 0, STILL_VIEW_IMAGE_FIT)
          resolve()
          return
        }

        const duration = 720
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration)
          const showTo = t >= 0.5
          const localT = showTo ? (t - 0.5) * 2 : t * 2
          const blur = motionBlurAmount(localT)
          this.drawFrame(showTo ? imgTo : imgFrom, blur, STILL_VIEW_IMAGE_FIT)
          if (t < 1) {
            this.lightRaf = requestAnimationFrame(tick)
          } else {
            this.lightRaf = null
            this.drawFrame(imgTo, 0, STILL_VIEW_IMAGE_FIT)
            resolve()
          }
        }
        this.lightRaf = requestAnimationFrame(tick)
      })()
    })
  }

  private async playLightPosterTransition(
    from: LightMode,
    to: LightMode,
    motionBlur: boolean,
  ) {
    const steps = resolveLightTransitionSteps(from, to)
    let cur = from
    for (const step of steps) {
      const next = lightModeAfterStep(step)
      await this.crossfadeLightPosters(cur, next, motionBlur)
      cur = next
    }
    if (cur !== to) {
      await this.crossfadeLightPosters(cur, to, motionBlur)
    }
  }

  private async playLightStep(step: {
    edge: LightMode
    reverse: boolean
  }): Promise<boolean> {
    const videoRef = getLightTransitionVideo(this.currentView, step.edge)
    if (!videoRef || !this.videoPlayer) return false

    const startMode = lightModeBeforeStep(step)
    const endMode = lightModeAfterStep(step)
    const startRef = getLightPoster(this.currentView, startMode)
    const endRef = getLightPoster(this.currentView, endMode)
    if (!startRef) return false

    const endPreload = endRef ? this.preloadPoiEndImage(endRef) : Promise.resolve(null)
    const startImg = await this.preloadPoiEndImage(startRef)
    if (startImg) this.applyPoiEndImage(startImg)

    const resolved = await resolveMediaSrc(videoRef)
    const src = resolved ?? resolveMediaPath(videoRef)
    const ok = await this.videoPlayer.play(
      { type: 'video', src },
      {
        primeFirstFrame: false,
        reverse: step.reverse,
        endOnStillPoster: Boolean(endRef),
      },
    )

    if (!ok) return false

    if (endRef) {
      const endImg = await endPreload
      if (endImg) this.applyPoiEndImage(endImg)
      else await this.showPoiEndImage(endRef)
    }
    return true
  }

  private async applyLightFallback(from: LightMode, mode: LightMode, seqKey: string) {
    this.videoPlayer?.stopLoop()
    void this.showStillFrame(this.currentView)

    const steps = resolveLightTransitionSteps(from, mode)
    const key =
      steps.length === 1 ? lightSequenceKeyForStep(steps[0]) : seqKey
    const seq = USE_LIGHT_FRAME_SEQUENCES
      ? LIGHT_SEQUENCES[key as keyof typeof LIGHT_SEQUENCES]
      : undefined

    if (seq) {
      if (this.lightRaf) {
        cancelAnimationFrame(this.lightRaf)
        this.lightRaf = null
      }
      const reverse =
        steps.length === 1 ? steps[0].reverse : Boolean(seq.reverse)
      const { pad = 2, ext = 'jpg', fps = 36 } = seq
      const base = resolveMediaPath(seq.base)
      const interval = 1000 / fps
      const indices = Array.from({ length: seq.count }, (_, i) => (reverse ? seq.count - 1 - i : i))
      const frames = indices.map((i) => {
        const img = new Image()
        img.src = base + String(i).padStart(pad, '0') + '.' + ext
        return img
      })

      let frameIdx = 0
      let lastTime: number | null = null

      const tick = (ts: number) => {
        if (!lastTime) lastTime = ts
        if (ts - lastTime >= interval) {
          lastTime = ts
          const img = frames[frameIdx]
          if (img.complete && img.naturalWidth) {
            this.drawFrame(img)
            frameIdx++
          }
        }
        if (frameIdx < seq.count) {
          this.lightRaf = requestAnimationFrame(tick)
        } else {
          this.lightRaf = null
        }
      }

      const start = () => {
        this.lightRaf = requestAnimationFrame(tick)
      }
      if (frames[0].complete && frames[0].naturalWidth) start()
      else frames[0].onload = start
      return
    }

    await this.playLightPosterTransition(
      from,
      mode,
      isLightMotionBlurEnabled(this.currentView),
    )
  }

  getActiveTrackIndex() {
    if (this.apartmentsPanelOpen || this.activeApartmentId) return APARTMENTS_HUB_VIEW
    if (this.interiorsPanelOpen || this.activeInteriorId) return 1
    return this.currentView >= 6 ? this.currentView : 0
  }

  openInteriorsPanel() {
    if (this.state === 'playing') return
    void this.closeApartmentsPanel()
    this.interiorsPanelOpen = true
    this.emit()
  }

  closeInteriorsPanel(): Promise<void> {
    if (!this.interiorsPanelOpen && !this.activeInteriorId) return Promise.resolve()
    const hadInterior = Boolean(this.activeInteriorId)
    this.interiorsPanelOpen = false
    this.activeInteriorId = null
    this.interiorBookOpen = false
    this.interiorBookPageIndex = 0
    this.emit()
    if (hadInterior && this.state === 'idle') {
      return this.closeInteriorWithFade()
    }
    if (this.state === 'idle') {
      return this.showIdle(this.currentView).then(() => undefined)
    }
    return Promise.resolve()
  }

  private async closeInteriorWithFade() {
    await interiorFade.cover()
    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.showIdle(this.currentView)
    await interiorFade.reveal()
  }

  toggleInteriorsPanel() {
    if (this.activeInteriorId) {
      void this.closeInteriorsPanel().then(() => this.openInteriorsPanel())
      return
    }
    if (this.interiorsPanelOpen) {
      void this.closeInteriorsPanel()
      return
    }
    this.openInteriorsPanel()
  }

  openApartmentsPanel() {
    if (this.state === 'playing') return
    void this.closeInteriorsPanel()
    this.apartmentFaceReady = false
    this.apartmentsPanelOpen = true
    this.activeApartmentId = getFacadeApartmentId()
    this.emit()
    void this.presentCrmFacade()
  }

  /** Exibe a fachada CRM compartilhada (imagem da unidade-fachada). */
  private async presentCrmFacade() {
    const facadeId = getFacadeApartmentId()
    const item = getApartmentItem(facadeId)
    if (!item) return
    const pages = getApartmentPagesForItem(item)
    if (!pages.length) return

    await interiorFade.cover()
    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.playApartmentPageAt(facadeId, 0)
  }

  closeApartmentsPanel(): Promise<void> {
    if (!this.apartmentsPanelOpen && !this.activeApartmentId) return Promise.resolve()
    const hadApartment = Boolean(this.activeApartmentId)
    this.resetPinExperience()
    this.apartmentsPanelOpen = false
    this.activeApartmentId = null
    this.apartmentFaceReady = false
    this.emit()
    if (hadApartment && this.state === 'idle') {
      return this.closeApartmentWithFade()
    }
    if (this.state === 'idle') {
      return this.showIdle(this.currentView).then(() => undefined)
    }
    return Promise.resolve()
  }

  private async closeApartmentWithFade() {
    await interiorFade.cover()
    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.showIdle(this.currentView)
    await interiorFade.reveal()
  }

  toggleApartmentsPanel() {
    if (this.activeApartmentId) {
      void this.closeApartmentsPanel().then(() => this.openApartmentsPanel())
      return
    }
    if (this.apartmentsPanelOpen) {
      void this.closeApartmentsPanel()
      return
    }
    this.openApartmentsPanel()
  }

  /** Abre unidade no submenu — exibe imagem ou vídeo da unidade. */
  async selectApartment(id: string) {
    if (this.state === 'playing') return
    const item = getApartmentItem(id)
    if (!item) return

    if (this.activeApartmentId === id && this.pinImmersiveActive) {
      await this.returnToApartmentFace()
      return
    }
    if (this.activeApartmentId === id) return

    const pages = getApartmentPagesForItem(item)
    if (!pages.length) {
      void this.closeInteriorsPanel()
      this.apartmentFaceReady = false
      this.apartmentsPanelOpen = true
      this.activeApartmentId = id
      this.emit()
      return
    }

    await interiorFade.cover()
    void this.closeInteriorsPanel()
    this.apartmentFaceReady = false
    this.apartmentsPanelOpen = true
    this.activeApartmentId = id
    this.emit()

    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.playApartmentPageAt(id, 0)
  }

  private apartmentVideoOpts(onPlaybackVisible?: () => void): VideoPlayOptions {
    return {
      primeFirstFrame: true,
      deferPlaybackVisibleUntilPlaying: true,
      onPlaybackVisible: () => {
        void interiorFade.reveal()
        onPlaybackVisible?.()
      },
    }
  }

  private async playApartmentPageAt(itemId: string, pageIndex: number) {
    this.setApartmentFaceReady(false)

    const item = getApartmentItem(itemId)
    if (!item || !this.videoPlayer) {
      interiorFade.forceOff()
      return
    }
    const pages = getApartmentPagesForItem(item)
    const page = pages[pageIndex]
    if (!page) {
      interiorFade.forceOff()
      return
    }

    const mediaRef = resolveApartmentPageMediaPath(itemId, page)

    if (page.type === 'loop') {
      const loopKey = apartmentMediaKey(itemId, page.id)
      const loopPath = getProjectApartmentLoopVideoPath(loopKey)
      if (loopPath && this.videoPlayer) {
        const loopSrc = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
        let poster: string | undefined
        if (mediaRef) {
          poster = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)
        }
        const ok = await this.videoPlayer.playCanvasLoop(
          { type: 'video', src: loopSrc, poster },
          STILL_VIEW_IMAGE_FIT,
        )
        if (!ok) {
          await this.showIdle(this.currentView)
          await interiorFade.reveal()
          this.emit()
          return
        }
        this.setApartmentFaceReady(true)
        await interiorFade.reveal()
        this.emit()
        return
      }
    }

    if (!mediaRef) {
      await this.showIdle(this.currentView)
      await interiorFade.reveal()
      return
    }

    const src = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)

    if (page.type === 'video') {
      this.state = 'playing'
      this.emit()
      const ok = await this.videoPlayer.play(
        { type: 'video', src },
        this.apartmentVideoOpts(() => this.setApartmentFaceReady(true)),
      )
      this.state = 'idle'
      if (!ok) {
        await this.showIdle(this.currentView)
        await interiorFade.reveal()
        this.emit()
        return
      }
      this.emit()
      return
    }

    const img = await this.loadCoverImage(src)
    if (img) this.presentCoverImage(img, STILL_VIEW_IMAGE_FIT)
    await interiorFade.reveal()
    if (img) this.setApartmentFaceReady(true)
    else this.emit()
  }

  /** Pin na face do prédio → planta baixa (mesma unidade, sem trocar de vista). */
  async playApartmentPinInline(
    poi: { id: string; img?: string; motionBlur?: boolean },
    options?: { transitionVideo?: VideoTransition },
  ): Promise<boolean> {
    if (this.state === 'playing' || !this.videoPlayer || !this.activeApartmentId) return false

    const plantaRef = poi.img ?? getProjectPoiImagePath(poi.id)
    if (!plantaRef) return false

    await interiorFade.cover()
    this.setApartmentFaceReady(false)
    this.transitionMotionBlur = Boolean(poi.motionBlur)
    this.state = 'playing'
    this.emit()

    const preloaded = await this.preloadPoiEndImage(plantaRef)

    try {
      if (options?.transitionVideo) {
        const ok = await this.videoPlayer.play(options.transitionVideo, {
          ...this.apartmentVideoOpts(),
          primeFirstFrame: false,
          endOnStillPoster: true,
        })
        if (!ok) {
          this.transitionMotionBlur = false
          this.state = 'idle'
          await interiorFade.reveal()
          this.emit()
          return false
        }
      }

      if (preloaded) this.applyPoiEndImage(preloaded)
      else await this.showPoiEndImage(plantaRef)

      this.pinImmersiveActive = true
      this.holdPoiEndFrame = true
      return true
    } catch {
      interiorFade.forceOff()
      return false
    } finally {
      this.transitionMotionBlur = false
      this.state = 'idle'
      await interiorFade.reveal()
      this.emit()
    }
  }

  /** Volta da planta baixa para a face da unidade ativa. */
  async returnToApartmentFace(): Promise<void> {
    const aptId = this.activeApartmentId
    if (!aptId || this.state === 'playing') return
    this.resetPinExperience()
    await interiorFade.cover()
    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.playApartmentPageAt(aptId, 0)
  }

  async playInterior(id: string) {
    if (this.state === 'playing') return
    const item = getInteriorItem(id)
    if (!item) return
    const pages = getInteriorPagesForItem(item)
    if (!pages.length) return

    await interiorFade.cover()

    this.interiorsPanelOpen = true
    this.activeInteriorId = id
    this.interiorBookPageIndex = 0
    this.interiorBookOpen = pages.length > 1
    this.emit()

    this.cancelPlayback()
    this.videoPlayer?.stopLoop()
    await this.playInteriorPageAt(id, 0)
  }

  async interiorBookPrev() {
    if (!this.activeInteriorId || this.interiorBookPageIndex <= 0) return
    await interiorFade.cover()
    this.interiorBookPageIndex--
    this.emit()
    this.cancelPlayback()
    await this.playInteriorPageAt(this.activeInteriorId, this.interiorBookPageIndex)
  }

  async interiorBookNext() {
    const item = this.activeInteriorId ? getInteriorItem(this.activeInteriorId) : undefined
    const pages = item ? getInteriorPagesForItem(item) : []
    if (!this.activeInteriorId || this.interiorBookPageIndex >= pages.length - 1) return
    await interiorFade.cover()
    this.interiorBookPageIndex++
    this.emit()
    this.cancelPlayback()
    await this.playInteriorPageAt(this.activeInteriorId, this.interiorBookPageIndex)
  }

  private interiorVideoOpts(): VideoPlayOptions {
    return {
      primeFirstFrame: true,
      deferPlaybackVisibleUntilPlaying: true,
      onPlaybackVisible: () => {
        void interiorFade.reveal()
      },
    }
  }

  private async playInteriorPageAt(itemId: string, pageIndex: number) {
    const item = getInteriorItem(itemId)
    if (!item || !this.videoPlayer) {
      interiorFade.forceOff()
      return
    }
    const pages = getInteriorPagesForItem(item)
    const page = pages[pageIndex]
    if (!page) {
      interiorFade.forceOff()
      return
    }

    const mediaRef = resolveInteriorPageMediaPath(itemId, page)
    if (!mediaRef) {
      this.interiorBookPageIndex = Math.max(0, pageIndex - 1)
      await this.showIdle(this.currentView)
      await interiorFade.reveal()
      this.emit()
      return
    }

    const src = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)

    if (page.type === 'video') {
      this.state = 'playing'
      this.emit()
      const ok = await this.videoPlayer.play({ type: 'video', src }, this.interiorVideoOpts())
      this.state = 'idle'
      this.emit()
      if (!ok) {
        await this.showIdle(this.currentView)
        await interiorFade.reveal()
      }
      return
    }

    const img = await this.loadCoverImage(src)
    if (img) this.presentCoverImage(img, STILL_VIEW_IMAGE_FIT)
    await interiorFade.reveal()
    this.emit()
  }
}
