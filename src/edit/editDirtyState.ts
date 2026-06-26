import type { DockEditorState } from './dockEditor'
import type { BookEditorState } from './bookEditor'
import type { ApartmentsEditorState } from './apartmentsEditor'
import type { ApartmentPoisEditorState } from './apartmentPinsEditor'
import type { ApartmentOutlinesEditorState } from '../config/apartmentOutlinesConfig'
import type { PoiDefinition } from '../core/types'

export type EditTab = 'scene' | 'poi' | 'insolation' | 'menu' | 'book' | 'apartments'

type Baselines = {
  pois: string
  dock: string
  book: string
  apartments: string
  apartmentPois: string
  apartmentOutlines: string
}

let baselines: Baselines = {
  pois: '',
  dock: '',
  book: '',
  apartments: '',
  apartmentPois: '',
  apartmentOutlines: '',
}

type DirtyProbe = {
  poisMap: () => Record<number, PoiDefinition[]>
  dockState: () => DockEditorState
  bookState: () => BookEditorState
  apartmentsState: () => ApartmentsEditorState
  apartmentPoisState: () => ApartmentPoisEditorState
  apartmentOutlinesState: () => ApartmentOutlinesEditorState
  hasPendingHero: () => boolean
  hasPendingPoiMedia: () => boolean
  hasPendingMenuVideo: () => boolean
  hasPendingBookMedia: () => boolean
  hasPendingApartmentMedia: () => boolean
  hasPendingApartmentPinMedia: () => boolean
  hasInsolationPending: () => boolean
}

let probe: DirtyProbe | null = null

function probeJson(getter: (() => unknown) | undefined, fallback = '[]'): string {
  if (typeof getter !== 'function') return fallback
  try {
    return JSON.stringify(getter())
  } catch {
    return fallback
  }
}

function probeBool(getter: (() => boolean) | undefined): boolean {
  if (typeof getter !== 'function') return false
  try {
    return getter()
  } catch {
    return false
  }
}

export function initEditDirtyProbe(p: DirtyProbe) {
  probe = p
}

export function captureEditBaselines() {
  if (!probe) return
  baselines = {
    pois: probeJson(probe.poisMap, '[]'),
    dock: probeJson(probe.dockState, '[]'),
    book: probeJson(probe.bookState, '[]'),
    apartments: probeJson(probe.apartmentsState, '[]'),
    apartmentPois: probeJson(probe.apartmentPoisState, '{}'),
    apartmentOutlines: probeJson(probe.apartmentOutlinesState, '{}'),
  }
}

export function isTabDirty(tab: EditTab): boolean {
  if (!probe) return false
  switch (tab) {
    case 'scene':
      return probeBool(probe.hasPendingHero)
    case 'poi':
      return (
        probeJson(probe.poisMap, '[]') !== baselines.pois || probeBool(probe.hasPendingPoiMedia)
      )
    case 'insolation':
      return probeBool(probe.hasInsolationPending)
    case 'menu':
      return (
        probeJson(probe.dockState, '[]') !== baselines.dock || probeBool(probe.hasPendingMenuVideo)
      )
    case 'book':
      return (
        probeJson(probe.bookState, '[]') !== baselines.book || probeBool(probe.hasPendingBookMedia)
      )
    case 'apartments':
      return (
        probeJson(probe.apartmentsState, '[]') !== baselines.apartments ||
        probeJson(probe.apartmentPoisState, '{}') !== baselines.apartmentPois ||
        probeJson(probe.apartmentOutlinesState, '{}') !== baselines.apartmentOutlines ||
        probeBool(probe.hasPendingApartmentMedia) ||
        probeBool(probe.hasPendingApartmentPinMedia)
      )
    default:
      return false
  }
}

export function isAnyTabDirty(): boolean {
  return (['scene', 'poi', 'insolation', 'menu', 'book', 'apartments'] as EditTab[]).some(
    isTabDirty,
  )
}

export function refreshEditTabDirtyIndicators() {
  document.querySelectorAll<HTMLButtonElement>('.edit-tab[data-tab]').forEach((btn) => {
    const tab = btn.dataset.tab as EditTab
    btn.classList.toggle('edit-tab--dirty', isTabDirty(tab))
  })
}

export function refreshGlobalSaveButton(saveBtn: HTMLButtonElement | null) {
  if (!saveBtn || saveBtn.disabled) return
  const dirty = isAnyTabDirty()
  saveBtn.classList.toggle('edit-btn--needs-save', dirty)
  saveBtn.setAttribute(
    'aria-label',
    dirty ? 'Salvar no projeto (alterações pendentes)' : 'Salvar no projeto',
  )
}
