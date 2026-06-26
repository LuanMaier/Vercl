import { resolveMediaSrc } from '../media/resolvePoiMedia'
import type { PoiDefinition } from '../core/types'

function isPdfMedia(ref: string, resolvedSrc?: string) {
  return (
    /\.pdf(\?|#|$)/i.test(ref) || Boolean(resolvedSrc && /\.pdf(\?|#|$)/i.test(resolvedSrc))
  )
}

export class ApartmentPlantaModal {
  private el: HTMLElement
  private box: HTMLElement
  private mediaHost: HTMLElement
  private titleEl: HTMLElement
  private tagEl: HTMLElement
  private loadingEl: HTMLElement
  private loadingTextEl: HTMLElement
  private open = false

  constructor(private onClose?: () => void) {
    const root = document.createElement('div')
    root.id = 'apt-planta-modal'
    root.className = 'apt-planta-modal'
    root.setAttribute('aria-hidden', 'true')
    root.innerHTML = `
      <div class="apt-planta-modal-box" role="dialog" aria-modal="true" aria-labelledby="apt-planta-title">
        <div class="apt-planta-modal-accent" aria-hidden="true"></div>
        <button type="button" class="apt-planta-modal-close" aria-label="Fechar planta">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <header class="apt-planta-modal-head">
          <div class="apt-planta-modal-head-main">
            <span class="apt-planta-modal-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.5"/>
                <path d="M14 3v6h6" stroke="currentColor" stroke-width="1.5"/>
                <path d="M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </span>
            <div class="apt-planta-modal-head-text">
              <span class="apt-planta-modal-tag" id="apt-planta-tag"></span>
              <h2 class="apt-planta-modal-title" id="apt-planta-title"></h2>
            </div>
          </div>
        </header>
        <div class="apt-planta-modal-body">
          <div class="apt-planta-modal-frame">
            <div class="apt-planta-modal-media">
              <div class="apt-planta-modal-loading">
                <span class="apt-planta-modal-spinner" aria-hidden="true"></span>
                <span class="apt-planta-modal-loading-text">Carregando planta…</span>
              </div>
            </div>
          </div>
        </div>
        <footer class="apt-planta-modal-foot">
          <span>Esc</span>
          <span class="apt-planta-modal-foot-dot" aria-hidden="true"></span>
          <span>clique fora para fechar</span>
        </footer>
      </div>
    `
    document.body.appendChild(root)
    this.el = root
    this.box = root.querySelector('.apt-planta-modal-box')!
    this.mediaHost = root.querySelector('.apt-planta-modal-media')!
    this.titleEl = root.querySelector('.apt-planta-modal-title')!
    this.tagEl = root.querySelector('.apt-planta-modal-tag')!
    this.loadingEl = root.querySelector('.apt-planta-modal-loading')!
    this.loadingTextEl = root.querySelector('.apt-planta-modal-loading-text')!

    root.addEventListener('click', (e) => {
      if (e.target === root) this.close()
    })
    this.box.addEventListener('click', (e) => e.stopPropagation())
    root.querySelector('.apt-planta-modal-close')!.addEventListener('click', () => this.close())
  }

  isOpen() {
    return this.open
  }

  async openWith(poi: PoiDefinition, mediaRef: string) {
    this.titleEl.textContent = poi.title || poi.label
    this.tagEl.textContent = poi.tag || 'Planta baixa'
    this.clearMedia()
    this.loadingEl.classList.remove('hidden')
    this.el.classList.add('open')
    this.el.setAttribute('aria-hidden', 'false')
    this.open = true
    document.body.classList.add('apt-planta-open')

    const src = (await resolveMediaSrc(mediaRef)) ?? mediaRef
    if (!src) {
      this.showError('Planta não encontrada')
      return
    }

    if (isPdfMedia(mediaRef, src)) {
      const iframe = document.createElement('iframe')
      iframe.className = 'apt-planta-modal-pdf'
      iframe.title = poi.title || poi.label
      iframe.src = `${src}#view=FitH&toolbar=1`
      iframe.addEventListener('load', () => this.loadingEl.classList.add('hidden'))
      this.mediaHost.classList.add('is-pdf')
      this.box.classList.add('is-pdf')
      this.mediaHost.appendChild(iframe)
      return
    }

    this.mediaHost.classList.remove('is-pdf')
    this.box.classList.remove('is-pdf')
    const img = document.createElement('img')
    img.className = 'apt-planta-modal-img'
    img.alt = poi.title || poi.label
    img.addEventListener('load', () => this.loadingEl.classList.add('hidden'))
    img.addEventListener('error', () => this.showError('Não foi possível carregar a planta'))
    img.src = src
    this.mediaHost.appendChild(img)
  }

  close() {
    if (!this.open) return
    this.el.classList.remove('open')
    this.el.setAttribute('aria-hidden', 'true')
    this.open = false
    document.body.classList.remove('apt-planta-open')
    this.clearMedia()
    this.loadingEl.classList.remove('hidden')
    this.onClose?.()
  }

  private clearMedia() {
    this.mediaHost.classList.remove('is-pdf')
    this.box.classList.remove('is-pdf')
    this.mediaHost.querySelectorAll('img, iframe').forEach((n) => n.remove())
    this.loadingEl.classList.remove('hidden')
    this.loadingTextEl.textContent = 'Carregando planta…'
    this.loadingEl.classList.remove('apt-planta-modal-loading--error')
  }

  private showError(msg: string) {
    this.loadingTextEl.textContent = msg
    this.loadingEl.classList.add('apt-planta-modal-loading--error')
    this.loadingEl.classList.remove('hidden')
  }
}
