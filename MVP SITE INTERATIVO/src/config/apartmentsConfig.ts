import apartmentsOverridesJson from './generated/apartmentsOverrides.json'
import { getFacadeApartmentId as getConfiguredFacadeId } from './apartmentOutlinesConfig'
import { getApartmentPagesForItem, withAptMainPageOnly } from './apartmentPages'
import {
  APT_MAIN_PAGE_ID,
  DEFAULT_APARTMENT_ITEMS,
  type ApartmentItem,
  type ApartmentPage,
} from './apartments'

export type ApartmentsOverridesFile = {
  version: 1
  items?: ApartmentItem[]
}

let overrides: ApartmentsOverridesFile = {
  ...(apartmentsOverridesJson as ApartmentsOverridesFile),
  version: 1,
}

function normalizePage(raw: ApartmentPage): ApartmentPage | null {
  if (!raw?.id || (raw.type !== 'video' && raw.type !== 'image' && raw.type !== 'loop')) return null
  return {
    id: raw.id,
    type: raw.type,
    label: raw.label?.trim() || undefined,
  }
}

function normalizeItem(raw: ApartmentItem): ApartmentItem | null {
  if (!raw?.id) return null
  const pages = (raw.pages ?? [])
    .map(normalizePage)
    .filter((p): p is ApartmentPage => Boolean(p))
  return {
    id: raw.id,
    label: raw.label?.trim() || raw.id,
    tag: raw.tag?.trim() || 'Unidade',
    desc: raw.desc?.trim() || undefined,
    pages,
  }
}

export function getApartmentItems(): ApartmentItem[] {
  const raw = overrides.items ?? DEFAULT_APARTMENT_ITEMS
  const out: ApartmentItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const n = normalizeItem(item as ApartmentItem)
    if (!n || seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  if (!out.length) {
    return DEFAULT_APARTMENT_ITEMS.map((i) => ({ ...i, pages: [...i.pages] }))
  }
  return out
}

export function getApartmentItem(id: string): ApartmentItem | undefined {
  return getApartmentItems().find((i) => i.id === id)
}

/** Unidade cuja mídia _main é a fachada CRM compartilhada (highlights + contornos). */
export function getFacadeApartmentId(): string {
  const configured = getConfiguredFacadeId()
  if (getApartmentItems().some((i) => i.id === configured)) return configured
  return getApartmentItems()[0]?.id ?? 'apt-1'
}

export function getEditableApartmentsState(): ApartmentItem[] {
  return getApartmentItems().map((i) => withAptMainPageOnly(i))
}

export function applyApartmentsOverridesFile(data: ApartmentsOverridesFile) {
  overrides = { ...data, version: 1 }
}

export async function reloadApartmentsOverrides() {
  const t = Date.now()
  try {
    const res = await fetch(`/src/config/generated/apartmentsOverrides.json?t=${t}`)
    if (res.ok) {
      overrides = { ...(await res.json()), version: 1 } as ApartmentsOverridesFile
    }
  } catch {
    /* dev offline */
  }
}

export function buildApartmentsOverridesPayload(items: ApartmentItem[]): ApartmentsOverridesFile {
  return {
    version: 1,
    items: items.map((i) => ({
      id: i.id,
      label: i.label.trim() || i.id,
      tag: i.tag.trim() || 'Unidade',
      desc: i.desc?.trim() || undefined,
      pages: (() => {
        const main =
          i.pages.find((p) => p.id === APT_MAIN_PAGE_ID) ?? getApartmentPagesForItem(i)[0]
        if (!main) return []
        return [
          {
            id: APT_MAIN_PAGE_ID,
            type: main.type,
            label: main.label?.trim() || undefined,
          },
        ]
      })(),
    })),
  }
}

export function resetApartmentItems() {
  overrides = {
    version: 1,
    items: DEFAULT_APARTMENT_ITEMS.map((i) => ({ ...i, pages: [...i.pages] })),
  }
}
