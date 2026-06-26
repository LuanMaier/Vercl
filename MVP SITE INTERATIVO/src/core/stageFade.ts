/** Fade do site — imagem esmaece (#stage) + cortina preta (#stage-fade) na troca. */

/** Tempo igual para esmaecer OUT e IN (ms). */
export const STAGE_FADE_MS = 200

const EASE = 'cubic-bezier(0.33, 0, 0.2, 1)'

class StageFadeController {
  private covered = false
  private transitionHold = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private fadeResolve: (() => void) | null = null

  private stageEl() {
    return document.getElementById('stage')
  }

  private overlayEl() {
    return document.getElementById('stage-fade')
  }

  isCovered() {
    return this.covered
  }

  isTransitionHold() {
    return this.transitionHold
  }

  lockForTransition() {
    this.setOverlay(true, false)
    this.transitionHold = true
    this.covered = true
  }

  releaseForPlayback() {
    if (!this.transitionHold) return
    this.transitionHold = false
    void this.reveal()
  }

  async cover(): Promise<void> {
    if (this.covered) return
    await this.fadeStageTo(0)
    await this.fadeOverlayIn(false)
    this.covered = true
  }

  forceCover() {
    this.cancelFade()
    this.setStageOpacity(0)
    this.setOverlay(true, false)
    this.covered = true
  }

  async reveal(): Promise<void> {
    this.transitionHold = false
    await this.fadeOverlayOut()

    if (!this.covered) {
      this.ensureVisible()
      return
    }

    await this.fadeStageTo(1)
    this.covered = false
  }

  forceOff() {
    this.cancelFade()
    this.setOverlay(false, false)
    this.ensureVisible()
    this.covered = false
    this.transitionHold = false
  }

  ensureVisible() {
    const stage = this.stageEl()
    if (!stage) return
    stage.style.transition = 'none'
    stage.style.opacity = '1'
    void stage.offsetWidth
    stage.style.removeProperty('transition')
  }

  private setOverlay(on: boolean, animate: boolean) {
    const el = this.overlayEl()
    if (!el) return
    if (!animate) el.style.transition = 'none'
    el.classList.toggle('is-on', on)
    if (!animate) {
      void el.offsetWidth
      el.style.removeProperty('transition')
    }
  }

  private fadeOverlayIn(cancelPending = true): Promise<void> {
    const el = this.overlayEl()
    if (!el) return Promise.resolve()
    if (cancelPending) this.cancelFade()
    return new Promise((resolve) => {
      this.fadeResolve = resolve
      el.style.transition = `opacity ${STAGE_FADE_MS}ms ${EASE}`
      el.classList.add('is-on')
      this.timer = window.setTimeout(() => {
        this.timer = null
        this.fadeResolve = null
        resolve()
      }, STAGE_FADE_MS)
    })
  }

  private fadeOverlayOut(): Promise<void> {
    const el = this.overlayEl()
    if (!el) return Promise.resolve()
    if (!el.classList.contains('is-on')) return Promise.resolve()
    this.cancelFade()
    return new Promise((resolve) => {
      this.fadeResolve = resolve
      el.style.transition = `opacity ${STAGE_FADE_MS}ms ${EASE}`
      el.classList.remove('is-on')
      this.timer = window.setTimeout(() => {
        this.timer = null
        this.fadeResolve = null
        resolve()
      }, STAGE_FADE_MS)
    })
  }

  private fadeStageTo(opacity: number): Promise<void> {
    const el = this.stageEl()
    if (!el) return Promise.resolve()

    this.cancelFade()
    return new Promise((resolve) => {
      this.fadeResolve = resolve
      el.style.transition = `opacity ${STAGE_FADE_MS}ms ${EASE}`
      el.style.opacity = String(opacity)
      this.timer = window.setTimeout(() => {
        this.timer = null
        this.fadeResolve = null
        resolve()
      }, STAGE_FADE_MS)
    })
  }

  private setStageOpacity(opacity: number) {
    const el = this.stageEl()
    if (!el) return
    el.style.transition = 'none'
    el.style.opacity = String(opacity)
    void el.offsetWidth
    el.style.removeProperty('transition')
  }

  private cancelFade() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.fadeResolve) {
      const done = this.fadeResolve
      this.fadeResolve = null
      done()
    }
  }
}

export const stageFade = new StageFadeController()
