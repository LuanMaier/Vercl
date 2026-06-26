import { getApartmentItems } from '../config/apartmentsConfig'
import { crmStatusClass, getCrmStatusForUnit } from '../config/crmConfig'
import type { ExplorerEngine } from '../core/engine'
import { collapseDockMenu } from './dockCollapse'
import { observeDockTabsLayout, syncDockTabsLayout } from './dockLayout'

let unsubEngine: (() => void) | null = null
let teardownApartmentLayout: (() => void) | null = null

/** Atualiza só as cores CRM nos botões — sem remontar o submenu. */
export function applyApartmentsNavCrmStyles(track: HTMLElement) {
  const pts = track.querySelector('#dock-apartments-pts')
  if (!pts) return
  const items = getApartmentItems()
  pts.querySelectorAll<HTMLElement>('.dock-apartment-tab').forEach((el) => {
    const item = items.find((i) => i.id === el.dataset.apartmentId)
    if (!item) return
    el.classList.remove('crm--available', 'crm--reserved', 'crm--sold')
    el.classList.add(crmStatusClass(getCrmStatusForUnit(item.label)))
  })
}

export function mountApartmentsNav(engine: ExplorerEngine, track: HTMLElement) {
  unsubEngine?.()
  unsubEngine = null

  const panel = track.querySelector('.dock-panel')
  if (!panel) return () => {}

  let sub = panel.querySelector('#dock-apartments-sub') as HTMLElement | null
  if (!sub) {
    sub = document.createElement('div')
    sub.id = 'dock-apartments-sub'
    sub.className = 'dock-apartments-sub'
    sub.setAttribute('aria-hidden', 'true')
    sub.innerHTML = `
      <div class="dock-block dock-block--apartments">
        <p class="dock-apartments-eyebrow">Escolha a unidade</p>
        <div id="dock-apartments-pts" class="dock-tabs dock-apartments-tabs" role="tablist"></div>
      </div>
    `
    panel.appendChild(sub)
  }

  const pts = sub.querySelector('#dock-apartments-pts') as HTMLElement
  let wasOpen = false

  function renderSubButtons() {
    pts.innerHTML = ''
    getApartmentItems().forEach((item, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className =
        'dock-tab dock-apartment-tab ' + crmStatusClass(getCrmStatusForUnit(item.label))
      el.dataset.apartmentId = item.id
      el.style.setProperty('--dock-stagger', `${i * 0.07}s`)
      el.setAttribute('role', 'tab')
      el.innerHTML = `
        <span class="dock-tab-glow" aria-hidden="true"></span>
        <span class="dock-tab-label">${item.label}</span>
        <span class="dock-tab-tag">${item.tag}</span>
      `
      const go = () => {
        collapseDockMenu()
        void engine.selectApartment(item.id)
      }
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

  function syncUiState() {
    const open = engine.apartmentsPanelOpen

    if (open && !wasOpen) {
      collapseDockMenu()
      pts.querySelectorAll<HTMLElement>('.dock-apartment-tab').forEach((el) => {
        el.style.animation = 'none'
        void el.offsetHeight
        el.style.animation = ''
      })
    }
    wasOpen = open
    track.classList.toggle('dock-apartments-open', open)
    sub!.setAttribute('aria-hidden', open ? 'false' : 'true')
    document.body.classList.toggle('apartments-active', Boolean(engine.activeApartmentId))

    sub!.querySelectorAll<HTMLButtonElement>('.dock-apartment-tab').forEach((btn) => {
      const on = btn.dataset.apartmentId === engine.activeApartmentId
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    })
  }

  renderSubButtons()
  teardownApartmentLayout?.()
  teardownApartmentLayout = observeDockTabsLayout(pts)
  unsubEngine = engine.subscribe(syncUiState)
  syncUiState()

  return () => {
    renderSubButtons()
    syncDockTabsLayout(pts)
    syncUiState()
  }
}
