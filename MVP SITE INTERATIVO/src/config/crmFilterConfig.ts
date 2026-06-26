import {
  getCrmUnitRecord,
  type CrmUnitStatus,
} from './crmConfig'

export type PriceRangeDef = {
  id: string
  label: string
  min: number
  max: number
}

/** Faixas padrão de valor (BRL) — referência para labels. */
export const DEFAULT_PRICE_RANGES: PriceRangeDef[] = [
  { id: 'p1', label: 'Até R$ 500 mil', min: 0, max: 500_000 },
  { id: 'p2', label: 'R$ 500 mil – 800 mil', min: 500_000, max: 800_000 },
  { id: 'p3', label: 'R$ 800 mil – 1,2 mi', min: 800_000, max: 1_200_000 },
  { id: 'p4', label: 'R$ 1,2 mi – 2 mi', min: 1_200_000, max: 2_000_000 },
  { id: 'p5', label: 'Acima de R$ 2 mi', min: 2_000_000, max: Number.MAX_SAFE_INTEGER },
]

export const BEDROOM_FILTER_MIN = 1
export const BEDROOM_FILTER_MAX = 5
export const PRICE_FILTER_MIN = 0
export const PRICE_FILTER_MAX = 2_000_000
export const PRICE_FILTER_STEP = 100_000

export type ApartmentFilterState = {
  statuses: Set<CrmUnitStatus>
  bedroomMin: number
  bedroomMax: number
  priceMin: number
  priceMax: number
}

const state: ApartmentFilterState = {
  statuses: new Set(),
  bedroomMin: BEDROOM_FILTER_MIN,
  bedroomMax: BEDROOM_FILTER_MAX,
  priceMin: PRICE_FILTER_MIN,
  priceMax: PRICE_FILTER_MAX,
}

type FilterListener = () => void
const listeners = new Set<FilterListener>()

export function getApartmentFilterState(): ApartmentFilterState {
  return state
}

export function subscribeApartmentFilter(listener: FilterListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((fn) => fn())
}

export function isBedroomFilterActive(): boolean {
  return state.bedroomMin > BEDROOM_FILTER_MIN || state.bedroomMax < BEDROOM_FILTER_MAX
}

export function isPriceFilterActive(): boolean {
  return state.priceMin > PRICE_FILTER_MIN || state.priceMax < PRICE_FILTER_MAX
}

export function isApartmentFilterActive(): boolean {
  return state.statuses.size > 0 || isBedroomFilterActive() || isPriceFilterActive()
}

export function clearApartmentFilter() {
  state.statuses.clear()
  state.bedroomMin = BEDROOM_FILTER_MIN
  state.bedroomMax = BEDROOM_FILTER_MAX
  state.priceMin = PRICE_FILTER_MIN
  state.priceMax = PRICE_FILTER_MAX
  notify()
}

export function toggleFilterStatus(status: CrmUnitStatus) {
  if (state.statuses.has(status)) state.statuses.delete(status)
  else state.statuses.add(status)
  notify()
}

export function setBedroomRange(min: number, max: number) {
  const lo = Math.max(BEDROOM_FILTER_MIN, Math.min(min, max))
  const hi = Math.min(BEDROOM_FILTER_MAX, Math.max(min, max))
  if (state.bedroomMin === lo && state.bedroomMax === hi) return
  state.bedroomMin = lo
  state.bedroomMax = hi
  notify()
}

export function setPriceRange(min: number, max: number) {
  const lo = Math.max(PRICE_FILTER_MIN, Math.min(min, max))
  const hi = Math.min(PRICE_FILTER_MAX, Math.max(min, max))
  if (state.priceMin === lo && state.priceMax === hi) return
  state.priceMin = lo
  state.priceMax = hi
  notify()
}

function bedroomsMatchFilter(bedrooms: number | null | undefined): boolean {
  if (!isBedroomFilterActive()) return true
  if (bedrooms == null) return false
  if (bedrooms < state.bedroomMin) return false
  if (state.bedroomMax >= BEDROOM_FILTER_MAX) return true
  return bedrooms <= state.bedroomMax
}

function priceMatchFilter(price: number | null | undefined): boolean {
  if (!isPriceFilterActive()) return true
  if (price == null) return false
  if (price < state.priceMin) return false
  if (state.priceMax >= PRICE_FILTER_MAX) return true
  return price <= state.priceMax
}

/** Highlight/pin label (código CRM) passa no filtro atual? */
export function unitLabelMatchesApartmentFilter(label: string): boolean {
  if (!isApartmentFilterActive()) return true

  const key = label.trim()
  if (!key) return false

  const unit = getCrmUnitRecord(key)
  const status = unit?.status ?? 'available'

  if (state.statuses.size > 0 && !state.statuses.has(status)) return false
  if (!bedroomsMatchFilter(unit?.bedrooms)) return false
  if (!priceMatchFilter(unit?.price)) return false

  return true
}

/** Contagem de filtros ativos (para badge). */
export function activeFilterCount(): number {
  let count = state.statuses.size
  if (isBedroomFilterActive()) count++
  if (isPriceFilterActive()) count++
  return count
}

export function formatFilterPrice(value: number): string {
  if (value >= PRICE_FILTER_MAX) return 'R$ 2 mi+'
  if (value >= 1_000_000) {
    const mi = value / 1_000_000
    const text = mi % 1 === 0 ? String(mi) : mi.toFixed(1).replace('.', ',')
    return `R$ ${text} mi`
  }
  if (value >= 1_000) return `R$ ${Math.round(value / 1_000)} mil`
  if (value <= 0) return 'R$ 0'
  return `R$ ${value.toLocaleString('pt-BR')}`
}

export function formatBedroomValue(value: number, asMax = false): string {
  if (asMax && value >= BEDROOM_FILTER_MAX) return '5+'
  return String(value)
}

export function formatBedroomRangeLabel(min: number, max: number): string {
  if (!isBedroomFilterActive()) return 'Todos'
  if (min === max) return formatBedroomValue(min, max >= BEDROOM_FILTER_MAX)
  return `${formatBedroomValue(min)} – ${formatBedroomValue(max, true)}`
}

export function formatPriceRangeLabel(min: number, max: number): string {
  if (!isPriceFilterActive()) return 'Qualquer valor'
  if (min <= PRICE_FILTER_MIN && max >= PRICE_FILTER_MAX) return 'Qualquer valor'
  if (min <= PRICE_FILTER_MIN) return `Até ${formatFilterPrice(max)}`
  if (max >= PRICE_FILTER_MAX) return `A partir de ${formatFilterPrice(min)}`
  return `${formatFilterPrice(min)} – ${formatFilterPrice(max)}`
}

export function getCrmStatusLabelFilter(status: CrmUnitStatus): string {
  switch (status) {
    case 'reserved':
      return 'Reservado'
    case 'sold':
      return 'Vendido'
    default:
      return 'Disponível'
  }
}
