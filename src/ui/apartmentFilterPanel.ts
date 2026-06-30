import type { CrmUnitStatus } from '../config/crmConfig'
import {
  activeFilterCount,
  BEDROOM_FILTER_MAX,
  BEDROOM_FILTER_MIN,
  clearApartmentFilter,
  formatBedroomRangeLabel,
  formatPriceRangeLabel,
  getApartmentFilterState,
  getCrmStatusLabelFilter,
  isApartmentFilterActive,
  PRICE_FILTER_MAX,
  PRICE_FILTER_MIN,
  PRICE_FILTER_STEP,
  setBedroomRange,
  setPriceRange,
  toggleFilterStatus,
} from '../config/crmFilterConfig'
import { isMobileViewport } from '../core/paths'
import type { ExplorerEngine } from '../core/engine'
import {
  layoutMobileApartmentFilterDock,
  layoutMobileApartmentFilterTrigger,
  prepareMobileApartmentFilterDock,
  watchMobileApartmentFilterLayout,
} from './apartmentFilterLayout'

const STATUS_OPTIONS: CrmUnitStatus[] = ['available', 'reserved', 'sold']

function statusLabel(status: CrmUnitStatus): string {
  if (!isMobileViewport()) return getCrmStatusLabelFilter(status)
  switch (status) {
    case 'reserved':
      return 'Reserva'
    case 'sold':
      return 'Vendido'
    default:
      return 'Livre'
  }
}

function setupDualRange(
  root: HTMLElement,
  opts: {
    min: number
    max: number
    step: number
    getValues: () => [number, number]
    onChange: (min: number, max: number) => void
  },
): () => void {
  root.innerHTML = `
    <div class="apt-filter-range-track" aria-hidden="true">
      <div class="apt-filter-range-rail"></div>
      <div class="apt-filter-range-fill"></div>
    </div>
    <input type="range" class="apt-filter-range-input apt-filter-range-input--min" aria-label="Mínimo" />
    <input type="range" class="apt-filter-range-input apt-filter-range-input--max" aria-label="Máximo" />
  `

  const minInput = root.querySelector('.apt-filter-range-input--min') as HTMLInputElement
  const maxInput = root.querySelector('.apt-filter-range-input--max') as HTMLInputElement
  const fill = root.querySelector('.apt-filter-range-fill') as HTMLElement

  for (const input of [minInput, maxInput]) {
    input.min = String(opts.min)
    input.max = String(opts.max)
    input.step = String(opts.step)
  }

  const paint = () => {
    const [lo, hi] = opts.getValues()
    minInput.value = String(lo)
    maxInput.value = String(hi)
    const span = opts.max - opts.min || 1
    const pctLo = ((lo - opts.min) / span) * 100
    const pctHi = ((hi - opts.min) / span) * 100
    fill.style.left = `${pctLo}%`
    fill.style.width = `${Math.max(0, pctHi - pctLo)}%`
    root.classList.toggle('is-active', lo > opts.min || hi < opts.max)
  }

  const applyFrom = (focused: 'min' | 'max') => {
    let lo = Number(minInput.value)
    let hi = Number(maxInput.value)
    if (lo > hi) {
      if (focused === 'min') hi = lo
      else lo = hi
      minInput.value = String(lo)
      maxInput.value = String(hi)
    }
    opts.onChange(lo, hi)
    paint()
  }

  const onMin = () => applyFrom('min')
  const onMax = () => applyFrom('max')

  minInput.addEventListener('input', onMin)
  maxInput.addEventListener('input', onMax)

  paint()

  return paint
}

export function mountApartmentFilterPanel(engine: ExplorerEngine): () => void {
  const existingCleanup = (mountApartmentFilterPanel as { _cleanup?: () => void })._cleanup
  existingCleanup?.()

  document.getElementById('apt-filter-panel')?.remove()
  document.getElementById('apt-filter-dock')?.remove()
  document.getElementById('apt-filter-trigger')?.remove()

  let filterOpen = false

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.id = 'apt-filter-trigger'
  trigger.className = 'apt-filter-trigger'
  trigger.setAttribute('aria-label', 'Filtrar unidades')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-controls', 'apt-filter-dock')
  trigger.innerHTML = `
    <svg class="apt-filter-trigger-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3.5h12M4.5 8h7M6.5 12.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    <span class="apt-filter-trigger-label">Filtrar</span>
    <span class="apt-filter-trigger-badge" hidden>0</span>
  `
  document.body.appendChild(trigger)

  const dock = document.createElement('div')
  dock.id = 'apt-filter-dock'
  dock.className = 'apt-filter-dock'
  dock.setAttribute('aria-hidden', 'true')
  dock.innerHTML = `
      <div class="apt-filter-dock-panel">
        <header class="apt-filter-dock-head">
          <div class="apt-filter-dock-head-text">
            <p class="apt-filter-eyebrow">Unidades na fachada</p>
            <h2 class="apt-filter-dock-title">Filtrar</h2>
          </div>
          <div class="apt-filter-dock-head-actions">
            <span class="apt-filter-dock-badge" hidden>0</span>
            <button type="button" class="apt-filter-dock-close" aria-label="Fechar filtros">×</button>
          </div>
        </header>

        <div class="apt-filter-dock-body">
          <section class="apt-filter-section">
            <p class="apt-filter-section-label">Status</p>
            <div class="apt-filter-segment" data-filter="status" role="group" aria-label="Status"></div>
          </section>

          <section class="apt-filter-section">
            <div class="apt-filter-section-head">
              <p class="apt-filter-section-label">Quartos</p>
              <output class="apt-filter-range-label" data-label="bedrooms">Todos</output>
            </div>
            <div class="apt-filter-range" data-range="bedrooms"></div>
          </section>

          <section class="apt-filter-section">
            <div class="apt-filter-section-head">
              <p class="apt-filter-section-label">Valor</p>
              <output class="apt-filter-range-label" data-label="price">Qualquer valor</output>
            </div>
            <div class="apt-filter-range" data-range="price"></div>
          </section>
        </div>

        <footer class="apt-filter-dock-foot">
          <button type="button" class="apt-filter-clear">Limpar filtros</button>
        </footer>
      </div>
  `
  document.body.appendChild(dock)

  const triggerBadge = trigger.querySelector('.apt-filter-trigger-badge') as HTMLElement
  const closeBtn = dock.querySelector('.apt-filter-dock-close') as HTMLButtonElement
  const clearBtn = dock.querySelector('.apt-filter-clear') as HTMLButtonElement
  const statusEl = dock.querySelector('[data-filter="status"]') as HTMLElement
  const bedroomRangeEl = dock.querySelector('[data-range="bedrooms"]') as HTMLElement
  const priceRangeEl = dock.querySelector('[data-range="price"]') as HTMLElement
  const bedroomLabel = dock.querySelector('[data-label="bedrooms"]') as HTMLOutputElement
  const priceLabel = dock.querySelector('[data-label="price"]') as HTMLOutputElement
  const badge = dock.querySelector('.apt-filter-dock-badge') as HTMLElement

  let paintBedroomRange: (() => void) | null = null
  let paintPriceRange: (() => void) | null = null

  function setFilterOpen(open: boolean) {
    filterOpen = open
    updateVisibility()
  }

  function updateRangeLabels() {
    const state = getApartmentFilterState()
    bedroomLabel.textContent = formatBedroomRangeLabel(state.bedroomMin, state.bedroomMax)
    priceLabel.textContent = formatPriceRangeLabel(state.priceMin, state.priceMax)
  }

  function renderStatus() {
    const state = getApartmentFilterState()
    statusEl.innerHTML = STATUS_OPTIONS.map(
      (s) => `
      <button type="button" class="apt-filter-segment-btn crm--${s}${state.statuses.has(s) ? ' is-on' : ''}" data-status="${s}">
        ${statusLabel(s)}
      </button>
    `,
    ).join('')
  }

  function syncControls() {
    renderStatus()
    paintBedroomRange?.()
    paintPriceRange?.()
    updateRangeLabels()
  }

  function syncFilterBadges() {
    const count = activeFilterCount()
    triggerBadge.hidden = count === 0
    triggerBadge.textContent = String(count)
    badge.hidden = count === 0
    badge.textContent = String(count)
    trigger.classList.toggle('has-filters', isApartmentFilterActive())
    dock.classList.toggle('has-filters', isApartmentFilterActive())
  }

  function layoutFilterUi(aptId: string | null, dockOpen: boolean) {
    if (!aptId) {
      layoutMobileApartmentFilterTrigger(trigger, null)
      layoutMobileApartmentFilterDock(dock, null)
      return
    }
    layoutMobileApartmentFilterTrigger(trigger, aptId)
    if (dockOpen) {
      layoutMobileApartmentFilterDock(dock, aptId)
    }
  }

  function updateVisibility() {
    const inContext =
      !engine.interactiveSplatOpen &&
      engine.apartmentsPanelOpen &&
      Boolean(engine.activeApartmentId) &&
      engine.state === 'idle' &&
      engine.isApartmentFaceReady()

    if (!inContext) filterOpen = false

    const aptId = engine.activeApartmentId
    const dockOpen = inContext && filterOpen

    trigger.classList.toggle('is-visible', inContext)
    trigger.classList.toggle('is-open', dockOpen)
    trigger.setAttribute('aria-expanded', dockOpen ? 'true' : 'false')

    if (dockOpen && aptId) {
      prepareMobileApartmentFilterDock(dock, aptId)
    }

    dock.classList.toggle('is-open', dockOpen)
    dock.setAttribute('aria-hidden', dockOpen ? 'false' : 'true')

    syncFilterBadges()
    layoutFilterUi(aptId, dockOpen)
  }

  paintBedroomRange = setupDualRange(bedroomRangeEl, {
    min: BEDROOM_FILTER_MIN,
    max: BEDROOM_FILTER_MAX,
    step: 1,
    getValues: () => {
      const s = getApartmentFilterState()
      return [s.bedroomMin, s.bedroomMax]
    },
    onChange: (min, max) => {
      setBedroomRange(min, max)
      updateRangeLabels()
      syncFilterBadges()
    },
  })

  paintPriceRange = setupDualRange(priceRangeEl, {
    min: PRICE_FILTER_MIN,
    max: PRICE_FILTER_MAX,
    step: PRICE_FILTER_STEP,
    getValues: () => {
      const s = getApartmentFilterState()
      return [s.priceMin, s.priceMax]
    },
    onChange: (min, max) => {
      setPriceRange(min, max)
      updateRangeLabels()
      syncFilterBadges()
    },
  })

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    setFilterOpen(!filterOpen)
  })

  closeBtn.addEventListener('click', () => {
    setFilterOpen(false)
  })

  statusEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-status]')
    if (!btn?.dataset.status) return
    toggleFilterStatus(btn.dataset.status as CrmUnitStatus)
    renderStatus()
    syncFilterBadges()
  })

  clearBtn.addEventListener('click', () => {
    clearApartmentFilter()
    syncControls()
    syncFilterBadges()
  })

  const onOutsideClick = (e: MouseEvent) => {
    if (!filterOpen) return
    const target = e.target as Node
    if (dock.contains(target) || trigger.contains(target)) return
    setFilterOpen(false)
  }

  document.addEventListener('click', onOutsideClick, true)

  const unsub = engine.subscribe(() => updateVisibility())
  const onViewportChange = () => {
    renderStatus()
    const apt = engine.activeApartmentId
    if (!apt) return
    if (trigger.classList.contains('is-visible')) {
      layoutMobileApartmentFilterTrigger(trigger, apt)
    }
    if (dock.classList.contains('is-open')) {
      layoutMobileApartmentFilterDock(dock, apt)
    }
  }
  const unwatchLayout = watchMobileApartmentFilterLayout(dock, trigger, () => engine.activeApartmentId)
  window.addEventListener('resize', onViewportChange)
  syncControls()
  updateVisibility()

  const cleanup = () => {
    unsub()
    unwatchLayout()
    window.removeEventListener('resize', onViewportChange)
    document.removeEventListener('click', onOutsideClick, true)
    filterOpen = false
    updateVisibility()
  }
  ;(mountApartmentFilterPanel as { _cleanup?: () => void })._cleanup = cleanup
  return cleanup
}
