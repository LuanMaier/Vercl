import { APARTMENTS_HUB_VIEW } from '../config/apartments'
import { INTERIORS_HUB_VIEW } from '../config/interiors'
import { getPoisForView, getChildPoisForParent, getParentIdsWithChildren, findPoiById, getAllConfiguredPoiIds } from '../config/poiConfig'
import { getPoiCardMediaMode, getMenuMediaMode, getProjectPoiLoopVideoPath, isPoiLoopDirect } from '../config/projectMedia'
import { DEFAULT_POI_IMAGE, DEFAULT_PANORAMA } from '../config/pois'
import {
  getProjectMenuImagePath,
  getProjectMenuVideoPath,
  getProjectPoiImagePath,
  getProjectPoiVideoPath,
} from '../config/projectMedia'
import { getAvailableViewIndices, getViewpoint } from '../config/pointsConfig'
import { resolveMediaSrc, revokeAllPoiMediaUrls } from '../media/resolvePoiMedia'
import { isPoiMediaRef } from '../media/poiMediaStore'
import {
  loadPosterImageMetrics,
  migratePanoramaPinToImageCoords,
  panoramaPinStagePct,
  resolveViewMediaMetrics,
} from './panoramaPinLayout'
import { collapseDockMenu } from '../ui/dockCollapse'
import { bindTap } from '../ui/bindTap'
import { getStageMetrics } from './stageMetrics'
import type { ExplorerEngine } from './engine'
import type { JumpOptions, PoiDefinition } from './types'

type PendingCard = {
  poi: PoiDefinition
  targetView: number
  sourceView: number
}

export class PoiManager {
  private cardEl: HTMLElement | null = null
  private pending: PendingCard | null = null
  private activePoiId: string | null = null
  /** Vista em experiência de pin — oculta pins locais até voltar pelo menu. */
  private pinVisitView: number | null = null
  private mounted = false
  private unsubEngine: (() => void) | null = null
  private resizeHandler: (() => void) | null = null
  private viewportHandler: (() => void) | null = null
  private stageResizeObserver: ResizeObserver | null = null
  private repositionTimer: ReturnType<typeof setTimeout> | null = null
  private lastView = -1
  private lastLight = ''
  private lastState = 'idle'
  private lastImmersivePoiId: string | null = null
  private posterMetricsCache = new Map<string, { w: number; h: number }>()
  private immersiveImageMetricsCache = new Map<string, { w: number; h: number }>()

  constructor(private engine: ExplorerEngine) {}

  mount() {
    if (this.mounted) return
    this.mounted = true
    this.ensureCard()
    this.mountAll()
    this.resizeHandler = () => this.scheduleReposition(true)
    window.addEventListener('resize', this.resizeHandler)
    this.viewportHandler = () => this.scheduleReposition(true)
    window.visualViewport?.addEventListener('resize', this.viewportHandler)
    window.addEventListener('orientationchange', this.viewportHandler)
    if (typeof ResizeObserver !== 'undefined') {
      this.stageResizeObserver = new ResizeObserver(() => this.scheduleReposition(true))
      const stage = document.getElementById('stage')
      if (stage) this.stageResizeObserver.observe(stage)
    }
    this.unsubEngine = this.engine.subscribe(() => this.onEngineUpdate())
    void this.repositionAllPins()
  }

  private scheduleReposition(clearMetrics = false) {
    if (clearMetrics) this.posterMetricsCache.clear()
    if (this.repositionTimer) clearTimeout(this.repositionTimer)
    this.repositionTimer = setTimeout(() => {
      this.repositionTimer = null
      void this.repositionAllPins()
    }, 48)
  }

  reload() {
    revokeAllPoiMediaUrls()
    this.hideCard()
    this.pending = null
    this.pinVisitView = null
    this.lastImmersivePoiId = null
    this.posterMetricsCache.clear()
    this.immersiveImageMetricsCache.clear()
    document.querySelectorAll('.poi:not(.poi--apartment)').forEach((el) => el.remove())
    this.mounted = false
    this.unsubEngine?.()
    this.unsubEngine = null
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.viewportHandler) {
      window.visualViewport?.removeEventListener('resize', this.viewportHandler)
      window.removeEventListener('orientationchange', this.viewportHandler)
      this.viewportHandler = null
    }
    this.stageResizeObserver?.disconnect()
    this.stageResizeObserver = null
    if (this.repositionTimer) {
      clearTimeout(this.repositionTimer)
      this.repositionTimer = null
    }
    this.mount()
    this.updateVisibility()
  }

  /** Atualiza posições e lista de pins sem recriar o manager inteiro. */
  async syncPinsFromConfig() {
    for (const ptIdx of getAvailableViewIndices()) {
      const pois = getPoisForView(ptIdx)
      const wanted = new Set(pois.map((p) => p.id))

      document.querySelectorAll<HTMLElement>(`.poi[data-pt="${ptIdx}"]:not(.poi--child)`).forEach((el) => {
        if (el.classList.contains('poi--apartment')) return
        const id = el.id.replace('poi-', '')
        if (!wanted.has(id)) el.remove()
      })

      for (let i = 0; i < pois.length; i++) {
        const poi = pois[i]
        const existing = document.getElementById(`poi-${poi.id}`)
        if (!existing) {
          this.createPoi(ptIdx, poi, i)
        } else {
          existing.style.setProperty('--poi-delay', `${i * 0.11}s`)
          const name = existing.querySelector('.poi-name')
          if (name) name.textContent = poi.label
          const btn = existing.querySelector('.poi-btn')
          if (btn) btn.setAttribute('aria-label', poi.label)
        }
      }
    }

    const childIds = new Set<string>()
    for (const parentId of getParentIdsWithChildren()) {
      const children = getChildPoisForParent(parentId)
      children.forEach((p) => childIds.add(p.id))
      document.querySelectorAll<HTMLElement>(`.poi--child[data-parent-id="${parentId}"]`).forEach((el) => {
        const id = el.id.replace('poi-', '')
        if (!children.some((p) => p.id === id)) el.remove()
      })
      for (let i = 0; i < children.length; i++) {
        const poi = children[i]
        const existing = document.getElementById(`poi-${poi.id}`)
        if (!existing) {
          this.createChildPoi(parentId, poi, i)
        } else {
          existing.style.setProperty('--poi-delay', `${i * 0.11}s`)
          const name = existing.querySelector('.poi-name')
          if (name) name.textContent = poi.label
          const btn = existing.querySelector('.poi-btn')
          if (btn) btn.setAttribute('aria-label', poi.label)
        }
      }
    }

    document.querySelectorAll<HTMLElement>('.poi--child').forEach((el) => {
      const id = el.id.replace('poi-', '')
      if (!childIds.has(id)) el.remove()
    })

    this.pruneOrphanPoiMarkers()

    await this.repositionAllPins()
    this.updateVisibility()
  }

  /** Remove pins no DOM que não existem mais no JSON (ex.: defaults antigos pan-1…). */
  private pruneOrphanPoiMarkers() {
    const wanted = getAllConfiguredPoiIds()
    document.querySelectorAll<HTMLElement>('.poi:not(.poi--apartment)').forEach((el) => {
      const id = el.id.replace('poi-', '')
      if (!wanted.has(id)) el.remove()
    })
  }

  private async getViewPosterMetrics(
    viewIndex: number,
  ): Promise<{ w: number; h: number }> {
    const live =
      this.engine.currentView === viewIndex ? this.engine.getLoopVideoMetrics() : null
    const key = `${viewIndex}:${this.engine.currentLight}:${live ? `${live.w}x${live.h}` : 'static'}`
    const cached = this.posterMetricsCache.get(key)
    if (cached) return cached

    const metrics = await resolveViewMediaMetrics(
      viewIndex,
      this.engine.currentLight,
      live,
    )
    this.posterMetricsCache.set(key, metrics)
    return metrics
  }

  private async applyPinPosition(poi: PoiDefinition, viewIndex: number) {
    const el = document.getElementById(`poi-${poi.id}`) as HTMLElement | null
    if (!el) return
    const { w: viewW, h: viewH } = getStageMetrics()
    const metrics = await this.getViewPosterMetrics(viewIndex)
    const resolved = { ...poi }
    migratePanoramaPinToImageCoords(resolved, viewW, viewH, metrics.w, metrics.h)
    let pos: { x: number; y: number } | null = null
    if (resolved.coordSpace === 'image') {
      pos = panoramaPinStagePct(resolved, viewW, viewH, metrics.w, metrics.h)
    } else {
      pos = { x: resolved.x, y: resolved.y }
    }
    if (!pos) return
    el.style.left = `${pos.x}%`
    el.style.top = `${pos.y}%`
    el.style.visibility = ''
  }

  private async getImmersiveImageMetrics(
    parentId: string,
  ): Promise<{ w: number; h: number } | null> {
    const key = parentId
    const cached = this.immersiveImageMetricsCache.get(key)
    if (cached) return cached
    const parent = findPoiById(parentId)
    const imgRef = parent?.img ?? getProjectPoiImagePath(parentId)
    if (!imgRef) return null
    const src = (await resolveMediaSrc(imgRef)) ?? imgRef
    const metrics = await loadPosterImageMetrics(src)
    if (!metrics) return null
    this.immersiveImageMetricsCache.set(key, metrics)
    return metrics
  }

  private async applyChildPinPosition(poi: PoiDefinition, parentId: string) {
    const el = document.getElementById(`poi-${poi.id}`) as HTMLElement | null
    if (!el) return
    const { w: viewW, h: viewH } = getStageMetrics()
    const metrics = await this.getImmersiveImageMetrics(parentId)
    const resolved = { ...poi, coordSpace: 'image' as const }
    if (metrics) {
      migratePanoramaPinToImageCoords(resolved, viewW, viewH, metrics.w, metrics.h)
    }
    let pos: { x: number; y: number } | null = null
    if (resolved.coordSpace === 'image') {
      if (!metrics) return
      pos = panoramaPinStagePct(resolved, viewW, viewH, metrics.w, metrics.h)
    } else {
      pos = { x: resolved.x, y: resolved.y }
    }
    if (!pos) return
    el.style.left = `${pos.x}%`
    el.style.top = `${pos.y}%`
    el.style.visibility = ''
  }

  private async repositionChildPins(parentId: string) {
    const children = getChildPoisForParent(parentId)
    for (const poi of children) {
      await this.applyChildPinPosition(poi, parentId)
    }
  }

  private async repositionAllPins() {
    for (const ptIdx of getAvailableViewIndices()) {
      const pois = getPoisForView(ptIdx)
      for (const poi of pois) {
        await this.applyPinPosition(poi, ptIdx)
      }
    }
    const immersiveId = this.engine.getImmersivePoiId()
    if (immersiveId) {
      await this.repositionChildPins(immersiveId)
    }
  }

  private ensureCard() {
    if (this.cardEl) return
    const card = document.createElement('aside')
    card.id = 'poi-info-card'
    card.className = 'poi-card'
    card.setAttribute('aria-hidden', 'true')
    card.innerHTML = `
      <button type="button" class="poi-card-close" aria-label="Fechar">×</button>
      <div class="poi-card-inner">
        <div class="poi-card-media">
          <img class="poi-card-img" alt="" />
          <video class="poi-card-video" muted loop playsinline hidden></video>
        </div>
        <div class="poi-card-body">
          <span class="poi-card-tag"></span>
          <h3 class="poi-card-title"></h3>
          <p class="poi-card-desc"></p>
          <button type="button" class="poi-card-360">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z"/></svg>
            360°
          </button>
        </div>
      </div>
    `
    card.querySelector('.poi-card-close')?.addEventListener('click', () => this.hideCard())
    card.querySelector('.poi-card-360')?.addEventListener('click', () => {
      const src = card.querySelector<HTMLElement>('.poi-card-360')?.dataset.pano
      if (src) window.dispatchEvent(new CustomEvent('explorer:open-pano', { detail: { src } }))
    })
    document.body.appendChild(card)
    this.cardEl = card
  }

  private onEngineUpdate() {
    if (this.engine.state === 'playing') {
      this.hideCardSilently()
      this.lastView = this.engine.currentView
      this.updateVisibility()
      return
    }

    const view = this.engine.currentView
    const prevView = this.lastView

    if (this.pending && view === this.pending.targetView) {
      const { poi, sourceView } = this.pending
      this.pending = null
      if (isPoiLoopDirect(poi) && getProjectPoiLoopVideoPath(poi.id)) {
        const endImage = poi.img ?? getProjectPoiImagePath(poi.id) ?? DEFAULT_POI_IMAGE
        void this.engine
          .playDirectPoiLoop({
            poiId: poi.id,
            poiEndImage: endImage,
            sceneReturnView: sourceView,
          })
          .then(() => this.updateVisibility())
      } else {
        void this.showCard(poi)
      }
    } else if (
      this.cardEl?.classList.contains('open') &&
      prevView !== -1 &&
      prevView !== view &&
      !this.pending
    ) {
      this.hideCard()
    }

    if (
      this.pinVisitView !== null &&
      !this.engine.isPinImmersiveActive() &&
      !this.activePoiId &&
      !this.cardEl?.classList.contains('open') &&
      !this.pending
    ) {
      this.pinVisitView = null
    }

    const viewChanged = view !== prevView
    const lightChanged = this.engine.currentLight !== this.lastLight
    const stateChanged = this.engine.state !== this.lastState
    const becameIdle = stateChanged && this.engine.state === 'idle'
    const immersiveId = this.engine.getImmersivePoiId()
    if (immersiveId !== this.lastImmersivePoiId) {
      this.lastImmersivePoiId = immersiveId
      if (immersiveId) {
        this.immersiveImageMetricsCache.delete(immersiveId)
        void this.repositionChildPins(immersiveId)
      }
    }
    this.updateVisibility()
    if (viewChanged || lightChanged || becameIdle) {
      if (lightChanged || becameIdle) this.posterMetricsCache.clear()
      this.lastLight = this.engine.currentLight
      void this.repositionAllPins()
    }
    this.lastView = view
    this.lastState = this.engine.state
  }

  private mountAll() {
    for (const ptIdx of getAvailableViewIndices()) {
      getPoisForView(ptIdx).forEach((poi, i) => this.createPoi(ptIdx, poi, i))
    }
    for (const parentId of getParentIdsWithChildren()) {
      getChildPoisForParent(parentId).forEach((poi, i) => this.createChildPoi(parentId, poi, i))
    }
  }

  /** Card/pin aberto na panorâmica — bloqueia insolação. */
  isInsolationBlocked(): boolean {
    return (
      Boolean(this.activePoiId) ||
      this.cardEl?.classList.contains('open') === true
    )
  }

  updateVisibility() {
    const hidePins =
      this.engine.interiorsPanelOpen ||
      Boolean(this.engine.activeInteriorId) ||
      this.engine.apartmentsPanelOpen ||
      Boolean(this.engine.activeApartmentId)

    if (this.engine.isPinImmersiveActive()) {
      const immersiveId = this.engine.getImmersivePoiId()
      document.querySelectorAll<HTMLElement>('.poi:not(.poi--apartment)').forEach((el) => {
        const isChild = el.classList.contains('poi--child')
        const show =
          !hidePins &&
          this.engine.state === 'idle' &&
          isChild &&
          immersiveId !== null &&
          el.dataset.parentId === immersiveId
        el.classList.toggle('hidden', !show)
        if (!show) el.classList.remove('is-active')
      })
      return
    }

    document.querySelectorAll<HTMLElement>('.poi--child').forEach((el) => {
      el.classList.add('hidden')
      el.classList.remove('is-active')
    })

    const inPoiExperience =
      Boolean(this.activePoiId) ||
      this.cardEl?.classList.contains('open') ||
      this.pinVisitView === this.engine.currentView
    document.querySelectorAll<HTMLElement>('.poi:not(.poi--child)').forEach((el) => {
      if (el.classList.contains('poi--apartment')) return
      const ptIdx = Number(el.dataset.pt)
      const show =
        !hidePins &&
        !inPoiExperience &&
        this.engine.state === 'idle' &&
        ptIdx === this.engine.currentView
      el.classList.toggle('hidden', !show)
      if (show) el.style.visibility = ''
      if (!show) {
        el.classList.remove('is-active')
      }
    })
  }

  private createChildPoi(parentId: string, poi: PoiDefinition, index = 0) {
    const marker = this.buildPoiMarker(poi, index)
    marker.classList.add('poi--child', 'hidden')
    marker.dataset.parentId = parentId
    const activate = (e: Event) => {
      e.stopPropagation()
      void this.onChildPoiClick(poi)
    }
    this.bindPoiActivate(marker, poi, activate)
    document.body.appendChild(marker)
  }

  private createPoi(viewIndex: number, poi: PoiDefinition, index = 0) {
    const marker = this.buildPoiMarker(poi, index)
    marker.dataset.pt = String(viewIndex)
    const activate = (e: Event) => {
      e.stopPropagation()
      void this.onPoiClick(poi, viewIndex)
    }
    this.bindPoiActivate(marker, poi, activate)
    document.body.appendChild(marker)
  }

  private buildPoiMarker(poi: PoiDefinition, index: number) {
    const marker = document.createElement('div')
    marker.className = 'poi hidden'
    marker.id = `poi-${poi.id}`
    if (poi.coordSpace === 'image') {
      marker.style.visibility = 'hidden'
    } else {
      marker.style.left = `${poi.x}%`
      marker.style.top = `${poi.y}%`
    }
    marker.style.setProperty('--poi-delay', `${index * 0.11}s`)
    marker.innerHTML = `
      <div class="poi-actions">
        <span class="poi-ring poi-ring--1" aria-hidden="true"></span>
        <span class="poi-ring poi-ring--2" aria-hidden="true"></span>
        <span class="poi-ring poi-ring--3" aria-hidden="true"></span>
        <span class="poi-glow" aria-hidden="true"></span>
        <span class="poi-stem" aria-hidden="true"></span>
        <button type="button" class="poi-btn" aria-label="${poi.label}">
          <span class="poi-btn-core" aria-hidden="true"></span>
        </button>
      </div>
      <div class="poi-name">${poi.label}</div>
    `
    return marker
  }

  private bindPoiActivate(marker: HTMLElement, poi: PoiDefinition, activate: (e: Event) => void) {
    const btn = marker.querySelector('.poi-btn') as HTMLElement
    const warmPrefetch = () => {
      const videoRef = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
      if (videoRef) this.engine.prefetchPoiMedia(videoRef)
    }
    bindTap(
      btn,
      (e) => {
        warmPrefetch()
        activate(e)
      },
      { stopPropagation: true },
    )
  }

  private async onChildPoiClick(poi: PoiDefinition) {
    if (this.engine.state === 'playing') return
    collapseDockMenu()
    this.hideCard()
    this.clearActiveMarker()

    const imageRef = poi.img ?? getProjectPoiImagePath(poi.id) ?? DEFAULT_POI_IMAGE
    void this.engine.preloadPoiEndImage(imageRef)

    const ok = await this.engine.transitionToImmersivePoi(poi.id, imageRef)
    if (ok) this.updateVisibility()
  }

  /** Menu inferior — usa só mídia do botão. */
  async navigateToView(targetView: number) {
    if (targetView === INTERIORS_HUB_VIEW) {
      this.engine.toggleInteriorsPanel()
      return
    }
    if (targetView === APARTMENTS_HUB_VIEW) {
      this.engine.toggleApartmentsPanel()
      return
    }
    await this.engine.closeInteriorsPanel()
    await this.engine.closeApartmentsPanel()
    if (this.engine.state === 'playing') return

    if (targetView === this.engine.currentView) {
      this.hideCard()
      this.pending = null
      this.clearActiveMarker()
      this.pinVisitView = null
      await this.engine.returnToMenuViewWithFade(targetView)
      this.lastImmersivePoiId = null
      this.updateVisibility()
      return
    }

    this.hideCard()
    this.clearActiveMarker()
    this.pending = null
    this.pinVisitView = null
    this.lastImmersivePoiId = null
    this.engine.resetForMenuNavigation()

    const menuVideoOpts = await this.buildMenuJumpOptions(targetView)
    const menuImage =
      menuVideoOpts?.transitionImage ??
      getProjectMenuImagePath(targetView) ??
      getViewpoint(targetView)?.transitionImage

    const opts: JumpOptions = {
      menuFade: true,
      ...(menuVideoOpts ?? {}),
    }
    if (menuImage && !opts.transitionVideo) {
      opts.transitionImage = menuImage
    }

    this.engine.jumpTo(targetView, opts)
  }

  private async onPoiClick(poi: PoiDefinition, sourceView: number) {
    collapseDockMenu()

    const targetView = poi.targetView ?? sourceView

    this.hideCard()
    this.clearActiveMarker()
    this.pending = null
    this.pinVisitView = targetView

    const jumpOpts = await this.buildJumpOptions(poi)
    if (jumpOpts?.poiEndImage) {
      void this.engine.preloadPoiEndImage(jumpOpts.poiEndImage)
    }
    if (isPoiLoopDirect(poi)) {
      const loopPath = getProjectPoiLoopVideoPath(poi.id)
      if (loopPath) this.engine.prefetchPoiMedia(loopPath)
    }

    if (targetView !== this.engine.currentView) {
      this.pending = { poi, targetView, sourceView }
      const opts: JumpOptions = {
        ...jumpOpts,
        immersivePoiId: poi.id,
      }
      this.engine.jumpTo(targetView, opts)
      return
    }

    if (isPoiLoopDirect(poi) && getProjectPoiLoopVideoPath(poi.id)) {
      void this.engine
        .playDirectPoiLoop({
          poiId: poi.id,
          poiEndImage: jumpOpts?.poiEndImage,
          sceneReturnView: sourceView,
        })
        .then(() => {
          this.updateVisibility()
        })
      return
    }

    if (jumpOpts?.transitionVideo) {
      void this.engine
        .playInlineTransition(jumpOpts.transitionVideo, {
          motionBlur: jumpOpts.motionBlur,
          poiEndImage: jumpOpts.poiEndImage,
          immersivePoiId: poi.id,
          sceneReturnView: sourceView,
        })
        .then(() => {
          this.updateVisibility()
        })
      return
    }

    void this.showCard(poi)
  }

  private async buildJumpOptions(poi: PoiDefinition): Promise<JumpOptions | undefined> {
    const opts: JumpOptions = {}
    if (poi.motionBlur) opts.motionBlur = true
    opts.poiEndImage = poi.img ?? getProjectPoiImagePath(poi.id) ?? DEFAULT_POI_IMAGE
    if (poi.videoRollback) opts.videoRollback = true
    if (!isPoiLoopDirect(poi)) {
      const videoRef = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
      if (videoRef) {
        const src = await resolveMediaSrc(videoRef)
        if (src) opts.transitionVideo = { type: 'video', src }
      }
    }
    return opts.motionBlur || opts.transitionVideo || opts.poiEndImage || opts.videoRollback
      ? opts
      : undefined
  }

  /** Mídia do menu (vídeo ou imagem) — prioridade sobre o pin. */
  private async buildMenuJumpOptions(
    targetView: number,
  ): Promise<JumpOptions | undefined> {
    const vp = getViewpoint(targetView)
    if (!vp) return undefined
    const opts: JumpOptions = {}
    if (vp.motionBlur) opts.motionBlur = true
    const menuVideo = vp.transitionVideo ?? getProjectMenuVideoPath(targetView)
    const menuPoster =
      vp.transitionImage ??
      getProjectMenuImagePath(targetView)
    if (menuVideo) {
      const src = await resolveMediaSrc(menuVideo)
      if (src) opts.transitionVideo = { type: 'video', src }
      if (vp.videoRollback) opts.videoRollback = true
      if (menuPoster && getMenuMediaMode(targetView, vp) !== 'video') {
        opts.transitionImage = menuPoster
      }
    } else if (getMenuMediaMode(targetView, vp) === 'loop') {
      if (menuPoster) opts.transitionImage = menuPoster
    } else if (menuPoster) {
      opts.transitionImage = menuPoster
    }
    return opts.motionBlur || opts.transitionVideo || opts.transitionImage || opts.videoRollback
      ? opts
      : undefined
  }

  private async showCard(poi: PoiDefinition) {
    this.ensureCard()
    const card = this.cardEl!
    const imgRef = poi.img ?? DEFAULT_POI_IMAGE
    const pano = poi.panorama360 ?? DEFAULT_PANORAMA

    const imgEl = card.querySelector<HTMLImageElement>('.poi-card-img')!
    const vidEl = card.querySelector<HTMLVideoElement>('.poi-card-video')!
    const useLoop = getPoiCardMediaMode(poi) === 'loop'
    const loopPath = getProjectPoiLoopVideoPath(poi.id)
    const posterSrc = (await resolveMediaSrc(imgRef)) ?? (isPoiMediaRef(imgRef) ? DEFAULT_POI_IMAGE : imgRef)

    if (useLoop && loopPath) {
      const loopSrc = (await resolveMediaSrc(loopPath)) ?? loopPath
      imgEl.hidden = true
      vidEl.hidden = false
      vidEl.poster = posterSrc
      vidEl.src = loopSrc
      void vidEl.play().catch(() => {})
    } else {
      vidEl.hidden = true
      vidEl.pause()
      vidEl.removeAttribute('src')
      imgEl.hidden = false
      imgEl.src = posterSrc
    }
    imgEl.alt = poi.title
    card.querySelector('.poi-card-tag')!.textContent = poi.tag
    card.querySelector('.poi-card-title')!.textContent = poi.title
    card.querySelector('.poi-card-desc')!.textContent = poi.desc
    const btn360 = card.querySelector<HTMLElement>('.poi-card-360')!
    btn360.dataset.pano = pano

    card.classList.add('open')
    card.setAttribute('aria-hidden', 'false')
    this.activePoiId = poi.id
    this.setActiveMarker(poi.id)
    this.updateVisibility()
    this.engine.notifyUi()
  }

  hideCard() {
    this.hideCardSilently()
    this.engine.notifyUi()
  }

  private hideCardSilently() {
    this.cardEl?.classList.remove('open')
    this.cardEl?.setAttribute('aria-hidden', 'true')
    this.cardEl?.querySelector<HTMLVideoElement>('.poi-card-video')?.pause()
    this.clearActiveMarker()
    this.activePoiId = null
    if (!this.engine.isPinImmersiveActive()) {
      this.pinVisitView = null
    }
    this.updateVisibility()
  }

  private setActiveMarker(id: string) {
    this.clearActiveMarker()
    document.getElementById(`poi-${id}`)?.classList.add('is-active')
  }

  private clearActiveMarker() {
    document.querySelectorAll('.poi.is-active').forEach((el) => el.classList.remove('is-active'))
  }

  closeAll() {
    this.hideCard()
    this.pending = null
    this.pinVisitView = null
  }
}
