import {
  BOOK_MAIN_PAGE_ID,
  interiorMediaKey,
  type InteriorItem,
  type InteriorPage,
} from './interiors'
import { getInteriorItem, getInteriorItems } from './interiorsConfig'
import {
  getProjectInteriorMediaPath,
  getProjectInteriorPosterPath,
  getProjectInteriorVideoPath,
  inferInteriorPagesFromMedia,
} from './projectMedia'

export function getInteriorPagesForItem(item: InteriorItem): InteriorPage[] {
  if (item.pages.length) {
    const main =
      item.pages.find((p) => p.id === BOOK_MAIN_PAGE_ID) ?? item.pages[0]
    return [{ ...main, id: BOOK_MAIN_PAGE_ID }]
  }

  const fromBook = inferInteriorPagesFromMedia(item.id)
  if (fromBook.length) {
    const p = fromBook[0]
    return [{ ...p, id: BOOK_MAIN_PAGE_ID }]
  }

  if (getProjectInteriorVideoPath(item.id)) {
    return [{ id: '_legacy-video', type: 'video', label: 'Vídeo' }]
  }
  if (getProjectInteriorPosterPath(item.id)) {
    return [{ id: '_legacy-poster', type: 'image', label: 'Imagem' }]
  }
  return []
}

export function ensureBookMainPage(item: InteriorItem): InteriorPage {
  const pages = getInteriorPagesForItem(item)
  if (pages.length) return pages[0]
  return { id: BOOK_MAIN_PAGE_ID, type: 'image', label: 'Mídia' }
}

export function withBookMainPageOnly(item: InteriorItem): InteriorItem {
  const page = ensureBookMainPage(item)
  return { ...item, pages: [{ ...page, id: BOOK_MAIN_PAGE_ID }] }
}

export function resolveInteriorPageMediaPath(itemId: string, page: InteriorPage): string | undefined {
  const key = interiorMediaKey(itemId, page.id)
  const fromBook = getProjectInteriorMediaPath(key)
  if (fromBook) return fromBook

  if (page.id === '_legacy-video') return getProjectInteriorVideoPath(itemId)
  if (page.id === '_legacy-poster') return getProjectInteriorPosterPath(itemId)
  return undefined
}

export { getInteriorItem, getInteriorItems }
