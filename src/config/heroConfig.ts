import { bumpMediaVersion } from '../media/poiMediaStore'
import { getProjectHeroPath } from './projectMedia'

const HERO_STORAGE_KEY = 'explorer-hero-overrides'

type HeroStore = {
  version: 1
  byView: Record<number, string>
}

export function loadHeroOverrides(): Record<number, string> {
  try {
    const raw = localStorage.getItem(HERO_STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as HeroStore
    if (data.version !== 1) return {}
    return { ...data.byView }
  } catch {
    return {}
  }
}

export function getHeroRef(viewIndex: number): string | undefined {
  return getProjectHeroPath(viewIndex) ?? loadHeroOverrides()[viewIndex]
}

export function setHeroRef(viewIndex: number, ref: string | null) {
  const byView = loadHeroOverrides()
  if (ref) byView[viewIndex] = ref
  else delete byView[viewIndex]
  const payload: HeroStore = { version: 1, byView }
  localStorage.setItem(HERO_STORAGE_KEY, JSON.stringify(payload))
  bumpMediaVersion()
}

export function clearHeroOverrides() {
  localStorage.removeItem(HERO_STORAGE_KEY)
}
