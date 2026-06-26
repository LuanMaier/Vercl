/** Vista do menu inferior que abre o submenu de interiores (não é vista 3D). */
export const INTERIORS_HUB_VIEW = 1

export type InteriorPageType = 'video' | 'image'

/** Uma mídia por ambiente (vídeo ou imagem). */
export const BOOK_MAIN_PAGE_ID = '_main'

export type InteriorPage = {
  id: string
  type: InteriorPageType
  /** Rótulo opcional na lista do editor */
  label?: string
}

export type InteriorItem = {
  id: string
  label: string
  tag: string
  /** Texto do capítulo (editor / card futuro) */
  desc?: string
  pages: InteriorPage[]
}

export const DEFAULT_INTERIOR_ITEMS: InteriorItem[] = [
  {
    id: 'int-1',
    label: 'Ambiente 1',
    tag: 'Interior',
    pages: [],
  },
  {
    id: 'int-2',
    label: 'Ambiente 2',
    tag: 'Interior',
    pages: [],
  },
  {
    id: 'int-3',
    label: 'Ambiente 3',
    tag: 'Interior',
    pages: [],
  },
]

export function interiorMediaKey(itemId: string, pageId: string) {
  return `${itemId}__${pageId}`
}
