import type { FrameSequence, LightMode } from '../core/types'
import { getCustomLightPoster, getLightTransitionVideo } from './lightMedia'
import { getHeroRef } from './heroConfig'
import { POSTERS } from './posters'

export { getLightTransitionVideo }

/** Se true, usa sequências JPG de 48 frames entre moods (pesado). */
export const USE_LIGHT_FRAME_SEQUENCES = false

export const LIGHT_SEQUENCES: Record<string, FrameSequence> = {
  day_night: { base: '/images/seq_arch/dia_to_noite_', count: 48, pad: 2, ext: 'jpg' },
  night_day: { base: '/images/seq_arch/dia_to_noite_', count: 48, pad: 2, ext: 'jpg', reverse: true },
  day_sunset: { base: '/images/seq_arch/dia_to_sunset_', count: 48, pad: 2, ext: 'jpg' },
  sunset_day: { base: '/images/seq_arch/dia_to_sunset_', count: 48, pad: 2, ext: 'jpg', reverse: true },
  night_sunset: { base: '/images/seq_arch/noite_to_sol_', count: 48, pad: 2, ext: 'jpg' },
  sunset_night: { base: '/images/seq_arch/sunset_to_noite_', count: 48, pad: 2, ext: 'jpg' },
}

/** Poster por vista + mood — preferido em produção (leve). */
export const LIGHT_POSTERS_BY_VIEW: Partial<
  Record<number, Partial<Record<LightMode, string>>>
> = {
  0: {
    day: '/images/custom/view-0-light-day.png',
    sunset: '/images/custom/view-0-light-day.png',
    night: '/images/custom/view-0-light-day.png',
  },
  6: {
    day: '/images/custom/view-6-hero.png',
    sunset: '/images/custom/view-6-hero.png',
    night: '/images/custom/view-6-hero.png',
  },
  7: {
    day: '/images/custom/view-7-hero.png',
    sunset: '/images/custom/view-7-hero.png',
    night: '/images/custom/view-7-hero.png',
  },
  8: {
    day: '/images/custom/view-8-hero.png',
    sunset: '/images/custom/view-8-hero.png',
    night: '/images/custom/view-8-hero.png',
  },
  9: {
    day: '/images/custom/view-8-hero.png',
    sunset: '/images/custom/view-8-hero.png',
    night: '/images/custom/view-8-hero.png',
  },
}

/** Fallback global quando a vista não tem entrada em LIGHT_POSTERS_BY_VIEW */
export const LIGHT_POSTERS: Partial<Record<LightMode, string>> = {
  night: '/images/custom/view-0-light-day.png',
  sunset: '/images/custom/view-0-light-day.png',
}

export function getLightPoster(viewIndex: number, mode: LightMode): string | undefined {
  const hero = getHeroRef(viewIndex)
  if (hero && mode === 'day') return hero

  const custom = getCustomLightPoster(viewIndex, mode)
  if (custom) return custom

  const perView = LIGHT_POSTERS_BY_VIEW[viewIndex]?.[mode]
  if (perView) return perView
  if (mode === 'day') return POSTERS[viewIndex]
  return LIGHT_POSTERS[mode]
}
