import apartmentPoisOverridesJson from './generated/apartmentPoisOverrides.json'
import { applyProjectMediaFields } from './poiConfig'
import type { PoiDefinition } from '../core/types'

export type ApartmentPoisOverridesFile = {
  version: 1
  byApartment?: Record<string, PoiDefinition[]>
}

let overrides: ApartmentPoisOverridesFile = {
  ...(apartmentPoisOverridesJson as ApartmentPoisOverridesFile),
  version: 1,
}

export function getPoisForApartment(apartmentId: string): PoiDefinition[] {
  const raw = overrides.byApartment?.[apartmentId] ?? []
  return raw.map((p) => applyProjectMediaFields({ ...p }))
}

/** Pin principal do highlight CRM na fachada compartilhada. */
export function highlightPinId(unitId: string): string {
  return `${unitId}-highlight`
}

/** Um highlight por unidade na fachada (fallback: primeiro pin legado). */
export function getFacadeHighlightPin(apartmentId: string): PoiDefinition | null {
  const pins = getPoisForApartment(apartmentId)
  return pins.find((p) => p.id === highlightPinId(apartmentId)) ?? pins[0] ?? null
}

export function getEditableApartmentPoisMap(): Record<string, PoiDefinition[]> {
  const out: Record<string, PoiDefinition[]> = {}
  const raw = overrides.byApartment ?? {}
  for (const [k, list] of Object.entries(raw)) {
    out[k] = list.map((p) => applyProjectMediaFields({ ...p }))
  }
  return out
}

export function applyApartmentPoisOverridesFile(data: ApartmentPoisOverridesFile) {
  overrides = { ...data, version: 1 }
}

const APARTMENT_POIS_RUNTIME_URLS = [
  '/config/apartmentPoisOverrides.json',
  '/src/config/generated/apartmentPoisOverrides.json',
]

export async function reloadApartmentPoisOverrides() {
  const t = Date.now()
  for (const base of APARTMENT_POIS_RUNTIME_URLS) {
    try {
      const res = await fetch(`${base}?t=${t}`)
      if (!res.ok) continue
      overrides = { ...(await res.json()), version: 1 } as ApartmentPoisOverridesFile
      return
    } catch {
      /* try next */
    }
  }
}

export function buildApartmentPoisOverridesPayload(
  byApartment: Record<string, PoiDefinition[]>,
): ApartmentPoisOverridesFile {
  const out: Record<string, PoiDefinition[]> = {}
  for (const [aptId, list] of Object.entries(byApartment)) {
    out[aptId] = list.map((p) => ({
      id: p.id,
      label: p.label,
      x: p.x,
      y: p.y,
      tag: p.tag,
      title: p.title,
      desc: p.desc,
      ...(p.img ? { img: p.img } : {}),
      ...(p.transitionVideo ? { transitionVideo: p.transitionVideo } : {}),
      ...(p.motionBlur ? { motionBlur: true } : {}),
      ...(p.positionLocked ? { positionLocked: true } : {}),
      ...(p.coordSpace === 'image' ? { coordSpace: 'image' as const } : {}),
      ...(p.highlightAnchor === 'center' ? { highlightAnchor: 'center' as const } : {}),
    }))
  }
  return { version: 1, byApartment: out }
}

/** Agrupa highlights espalhados por unidade na fachada compartilhada (apt principal). */
export function consolidateApartmentPoisOnFacade(
  byApartment: Record<string, PoiDefinition[]>,
  facadeApartmentId: string,
): Record<string, PoiDefinition[]> {
  const merged: PoiDefinition[] = []
  const seen = new Set<string>()
  for (const list of Object.values(byApartment)) {
    for (const poi of list) {
      if (seen.has(poi.id)) continue
      seen.add(poi.id)
      merged.push({ ...poi })
    }
  }
  const next: Record<string, PoiDefinition[]> = {}
  for (const aptId of Object.keys(byApartment)) {
    next[aptId] = aptId === facadeApartmentId ? merged.map((p) => ({ ...p })) : []
  }
  if (!next[facadeApartmentId]) next[facadeApartmentId] = merged.map((p) => ({ ...p }))
  return next
}
