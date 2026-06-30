import { APARTMENTS_HUB_VIEW } from './apartments'
import { INTERACTIVE_HUB_VIEW } from './interactive'
import { INTERIORS_HUB_VIEW } from './interiors'

/** Hubs após a panorâmica (Interiores, Apartamentos). */
export const DOCK_LEADING_HUB_VIEWS = [
  INTERIORS_HUB_VIEW,
  APARTMENTS_HUB_VIEW,
] as const

/** Gaussian / Interativo — extra do cliente, sempre último no menu. */
export const DOCK_TRAILING_HUB_VIEW = INTERACTIVE_HUB_VIEW

/** Todos os hubs protegidos no menu. */
export const DOCK_HUB_VIEWS = [
  ...DOCK_LEADING_HUB_VIEWS,
  DOCK_TRAILING_HUB_VIEW,
] as const

/** Fixos no início: panorâmica + Interiores + Apartamentos. */
export const DOCK_PIN_FIRST_VIEWS = [0, ...DOCK_LEADING_HUB_VIEWS] as const

/** Sempre no fim da faixa. */
export const DOCK_PIN_LAST_VIEWS = [DOCK_TRAILING_HUB_VIEW] as const

export function isDockHubView(viewIndex: number): boolean {
  return (DOCK_HUB_VIEWS as readonly number[]).includes(viewIndex)
}
