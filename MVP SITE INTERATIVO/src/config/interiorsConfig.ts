import interiorsOverridesJson from './generated/interiorsOverrides.json'
import { getInteriorPagesForItem, withBookMainPageOnly } from './interiorPages'
import {
  BOOK_MAIN_PAGE_ID,
  DEFAULT_INTERIOR_ITEMS,
  type InteriorItem,
  type InteriorPage,
} from './interiors'

export type InteriorsOverridesFile = {
  version: 1
  items?: InteriorItem[]
}

let overrides: InteriorsOverridesFile = {
  ...(interiorsOverridesJson as InteriorsOverridesFile),
  version: 1,
}

function normalizePage(raw: InteriorPage): InteriorPage | null {
  if (!raw?.id || (raw.type !== 'video' && raw.type !== 'image')) return null
  return {
    id: raw.id,
    type: raw.type,
    label: raw.label?.trim() || undefined,
  }
}

function normalizeItem(raw: InteriorItem): InteriorItem | null {
  if (!raw?.id) return null
  const pages = (raw.pages ?? [])
    .map(normalizePage)
    .filter((p): p is InteriorPage => Boolean(p))
  return {
    id: raw.id,
    label: raw.label?.trim() || raw.id,
    tag: raw.tag?.trim() || 'Interior',
    desc: raw.desc?.trim() || undefined,
    pages,
  }
}

export function getInteriorItems(): InteriorItem[] {
  const raw = overrides.items ?? DEFAULT_INTERIOR_ITEMS
  const out: InteriorItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const n = normalizeItem(item as InteriorItem)
    if (!n || seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  if (!out.length) {
    return DEFAULT_INTERIOR_ITEMS.map((i) => ({ ...i, pages: [...i.pages] }))
  }
  return out
}

export function getInteriorItem(id: string): InteriorItem | undefined {
  return getInteriorItems().find((i) => i.id === id)
}

export function getEditableInteriorsState(): InteriorItem[] {
  return getInteriorItems().map((i) => withBookMainPageOnly(i))
}

export function applyInteriorsOverridesFile(data: InteriorsOverridesFile) {
  overrides = { ...data, version: 1 }
}

export async function reloadInteriorsOverrides() {
  const t = Date.now()
  try {
    const res = await fetch(`/src/config/generated/interiorsOverrides.json?t=${t}`)
    if (res.ok) {
      overrides = { ...(await res.json()), version: 1 } as InteriorsOverridesFile
    }
  } catch {
    /* dev offline */
  }
}

export function buildInteriorsOverridesPayload(items: InteriorItem[]): InteriorsOverridesFile {
  return {
    version: 1,
    items: items.map((i) => ({
      id: i.id,
      label: i.label.trim() || i.id,
      tag: i.tag.trim() || 'Interior',
      desc: i.desc?.trim() || undefined,
      pages: (() => {
        const main =
          i.pages.find((p) => p.id === BOOK_MAIN_PAGE_ID) ??
          getInteriorPagesForItem(i)[0]
        if (!main) return []
        return [
          {
            id: BOOK_MAIN_PAGE_ID,
            type: main.type,
            label: main.label?.trim() || undefined,
          },
        ]
      })(),
    })),
  }
}
