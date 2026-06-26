import { getInteriorItems } from '../config/interiorsConfig'
import type { ExplorerEngine } from '../core/engine'
import { observeDockTabsLayout, syncDockTabsLayout } from './dockLayout'

let unsubEngine: (() => void) | null = null
let teardownInteriorLayout: (() => void) | null = null

export function mountInteriorsNav(engine: ExplorerEngine, track: HTMLElement) {
  unsubEngine?.()
  unsubEngine = null

  const panel = track.querySelector('.dock-panel')
  if (!panel) return () => {}

  let sub = panel.querySelector('#dock-interiors-sub') as HTMLElement | null
  if (!sub) {
    sub = document.createElement('div')
    sub.id = 'dock-interiors-sub'
    sub.className = 'dock-interiors-sub'
    sub.setAttribute('aria-hidden', 'true')
    sub.innerHTML = `
      <div class="dock-block dock-block--interiors">
        <p class="dock-interiors-eyebrow">Escolha o ambiente</p>
        <div id="dock-interiors-pts" class="dock-tabs dock-interiors-tabs" role="tablist"></div>
      </div>
    `
    panel.appendChild(sub)
  }

  const pts = sub.querySelector('#dock-interiors-pts') as HTMLElement

  function renderSubButtons() {
    pts.innerHTML = ''
    getInteriorItems().forEach((item, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'dock-tab dock-interior-tab'
      el.dataset.interiorId = item.id
      el.style.setProperty('--dock-stagger', `${i * 0.07}s`)
      el.setAttribute('role', 'tab')
      el.innerHTML = `
        <span class="dock-tab-glow" aria-hidden="true"></span>
        <span class="dock-tab-label">${item.label}</span>
        <span class="dock-tab-tag">${item.tag}</span>
      `
      const go = () => void engine.playInterior(item.id)
      el.addEventListener('click', go)
      el.addEventListener(
        'touchstart',
        (e) => {
          if (e.cancelable) e.preventDefault()
          go()
        },
        { passive: false },
      )
      pts.appendChild(el)
    })
    syncDockTabsLayout(pts)
  }

  let wasOpen = false

  function sync() {
    const open = engine.interiorsPanelOpen
    if (open && !wasOpen) {
      pts.querySelectorAll<HTMLElement>('.dock-interior-tab').forEach((el) => {
        el.style.animation = 'none'
        void el.offsetHeight
        el.style.animation = ''
      })
    }
    wasOpen = open
    track.classList.toggle('dock-interiors-open', open)
    sub!.setAttribute('aria-hidden', open ? 'false' : 'true')
    document.body.classList.toggle('interiors-active', Boolean(engine.activeInteriorId))

    sub!.querySelectorAll<HTMLButtonElement>('.dock-interior-tab').forEach((btn) => {
      const on = btn.dataset.interiorId === engine.activeInteriorId
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    })
  }

  renderSubButtons()
  teardownInteriorLayout?.()
  teardownInteriorLayout = observeDockTabsLayout(pts)
  unsubEngine = engine.subscribe(sync)
  sync()

  return () => {
    renderSubButtons()
    syncDockTabsLayout(pts)
    sync()
  }
}
