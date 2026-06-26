/** Vista do menu inferior que abre o submenu de apartamentos (não é vista 3D). */
export const APARTMENTS_HUB_VIEW = 2

export type ApartmentPageType = 'video' | 'image' | 'loop'

/** Uma mídia por unidade (vídeo ou imagem). */
export const APT_MAIN_PAGE_ID = '_main'

export type ApartmentPage = {
  id: string
  type: ApartmentPageType
  label?: string
}

export type ApartmentItem = {
  id: string
  label: string
  tag: string
  desc?: string
  pages: ApartmentPage[]
}

export const DEFAULT_APARTMENT_ITEMS: ApartmentItem[] = [
  { id: 'apt-1', label: 'Apartamento 1', tag: 'Unidade', pages: [] },
  { id: 'apt-2', label: 'Apartamento 2', tag: 'Unidade', pages: [] },
  { id: 'apt-3', label: 'Apartamento 3', tag: 'Unidade', pages: [] },
  { id: 'apt-4', label: 'Apartamento 4', tag: 'Unidade', pages: [] },
  { id: 'apt-5', label: 'Apartamento 5', tag: 'Unidade', pages: [] },
]

export function apartmentMediaKey(itemId: string, pageId: string) {
  return `${itemId}__${pageId}`
}
