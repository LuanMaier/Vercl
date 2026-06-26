import { APARTMENTS_HUB_VIEW } from './apartments'
import { INTERIORS_HUB_VIEW } from './interiors'

/** Hubs do dock — ordem fixa após a panorâmica. */
export const DOCK_HUB_VIEWS = [INTERIORS_HUB_VIEW, APARTMENTS_HUB_VIEW] as const

export function isDockHubView(viewIndex: number): boolean {
  return (DOCK_HUB_VIEWS as readonly number[]).includes(viewIndex)
}
