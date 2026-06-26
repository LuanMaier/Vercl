import {
  APT_MAIN_PAGE_ID,
  apartmentMediaKey,
  type ApartmentItem,
  type ApartmentPage,
} from './apartments'
import { getApartmentItem, getApartmentItems } from './apartmentsConfig'
import {
  getProjectApartmentMediaPath,
  inferApartmentPagesFromMedia,
} from './projectMedia'

export function getApartmentPagesForItem(item: ApartmentItem): ApartmentPage[] {
  if (item.pages.length) {
    const main =
      item.pages.find((p) => p.id === APT_MAIN_PAGE_ID) ?? item.pages[0]
    return [{ ...main, id: APT_MAIN_PAGE_ID }]
  }

  const fromMedia = inferApartmentPagesFromMedia(item.id)
  if (fromMedia.length) {
    const p = fromMedia[0]
    return [{ ...p, id: APT_MAIN_PAGE_ID }]
  }

  return []
}

export function ensureAptMainPage(item: ApartmentItem): ApartmentPage {
  const pages = getApartmentPagesForItem(item)
  if (pages.length) return pages[0]
  return { id: APT_MAIN_PAGE_ID, type: 'image', label: 'Mídia' }
}

export function withAptMainPageOnly(item: ApartmentItem): ApartmentItem {
  const page = ensureAptMainPage(item)
  return { ...item, pages: [{ ...page, id: APT_MAIN_PAGE_ID }] }
}

export function resolveApartmentPageMediaPath(
  itemId: string,
  page: ApartmentPage,
): string | undefined {
  const key = apartmentMediaKey(itemId, page.id)
  return getProjectApartmentMediaPath(key)
}

export { getApartmentItem, getApartmentItems }
