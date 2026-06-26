import { clearHeroOverrides } from './heroConfig'
import {
  getProjectPoiImagePath,
  getProjectPoiVideoPath,
  getProjectPoisMap,
  getProjectChildPoisMap,
} from './projectMedia'
import { POIS_BY_VIEW } from './pois'
import { getAvailableViewIndices } from './pointsConfig'
import type { PoiDefinition } from '../core/types'

export type PoiPositionOverrides = Record<number, Record<string, { x: number; y: number }>>

type PoiStorageV2 = {
  version: 2
  byView: Record<number, PoiDefinition[]>
  byParent?: Record<string, PoiDefinition[]>
}

export const POI_STORAGE_KEY = 'explorer-poi-overrides'

function poiViewIndices(): number[] {
  const indices = new Set(getAvailableViewIndices())
  const project = getProjectPoisMap()
  if (project) {
    for (const key of Object.keys(project)) {
      const n = Number(key)
      if (Number.isFinite(n)) indices.add(n)
    }
  }
  return [...indices].sort((a, b) => a - b)
}

/** Mapa canônico — mesma regra no site, editor e sync de DOM. */
function resolvePoisByView(): Record<number, PoiDefinition[]> {
  const project = getProjectPoisMap()
  if (project) {
    const out: Record<number, PoiDefinition[]> = {}
    for (const idx of poiViewIndices()) {
      const list = idx in project ? project[idx] : []
      out[idx] = list.map((p) => applyProjectMediaFields({ ...p }))
    }
    return out
  }

  const raw = localStorage.getItem(POI_STORAGE_KEY)
  if (raw) {
    const data = parseStorage(raw)
    if (data && (data as PoiStorageV2).version === 2) {
      const v2 = data as PoiStorageV2
      const out: Record<number, PoiDefinition[]> = {}
      for (const idx of poiViewIndices()) {
        const list = idx in v2.byView ? v2.byView[idx] : []
        out[idx] = list.map((p) => applyProjectMediaFields({ ...p }))
      }
      return out
    }
  }

  const overrides = loadPoiOverrides()
  const out: Record<number, PoiDefinition[]> = {}
  for (const idx of poiViewIndices()) {
    out[idx] = applyPositionOverrides(idx, POIS_BY_VIEW[idx] ?? [], overrides)
  }
  return out
}

function resolveChildPoisByParent(): Record<string, PoiDefinition[]> {
  const map = loadChildPoisFromStorage()
  if (!map) return {}

  const allPinIds = new Set<string>()
  for (const list of Object.values(resolvePoisByView())) {
    for (const p of list) allPinIds.add(p.id)
  }
  for (const list of Object.values(map)) {
    for (const p of list) allPinIds.add(p.id)
  }

  const out: Record<string, PoiDefinition[]> = {}
  for (const [parentId, list] of Object.entries(map)) {
    if (!allPinIds.has(parentId)) continue
    out[parentId] = list.map((p) =>
      applyProjectMediaFields({ ...p, parentId: p.parentId ?? parentId }),
    )
  }
  return out
}

function parseStorage(raw: string): PoiPositionOverrides | PoiStorageV2 | null {
  try {
    const data = JSON.parse(raw) as unknown
    if (data && typeof data === 'object' && (data as PoiStorageV2).version === 2) {
      return data as PoiStorageV2
    }
    return data as PoiPositionOverrides
  } catch {
    return null
  }
}

export function applyProjectMediaFields(poi: PoiDefinition): PoiDefinition {
  const img = poi.img ?? getProjectPoiImagePath(poi.id)
  const transitionVideo = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
  return {
    ...poi,
    ...(img ? { img } : {}),
    ...(transitionVideo ? { transitionVideo } : {}),
  }
}

export function loadPoiOverrides(): PoiPositionOverrides {
  const raw = localStorage.getItem(POI_STORAGE_KEY)
  if (!raw) return {}
  const data = parseStorage(raw)
  if (!data || (data as PoiStorageV2).version === 2) return {}
  return data as PoiPositionOverrides
}

export function loadFullPoisMap(): Record<number, PoiDefinition[]> | null {
  const project = getProjectPoisMap()
  if (project) return resolvePoisByView()

  const raw = localStorage.getItem(POI_STORAGE_KEY)
  if (!raw) return null
  const data = parseStorage(raw)
  if (data && (data as PoiStorageV2).version === 2) return resolvePoisByView()
  return null
}

export function savePoiOverrides(data: PoiPositionOverrides) {
  localStorage.setItem(POI_STORAGE_KEY, JSON.stringify(data))
}

export function saveFullPoisMap(
  poisByView: Record<number, PoiDefinition[]>,
  byParent?: Record<string, PoiDefinition[]>,
) {
  const byView: Record<number, PoiDefinition[]> = {}
  for (const [k, list] of Object.entries(poisByView)) {
    byView[Number(k)] = list.map((p) => ({ ...p }))
  }
  const payload: PoiStorageV2 = {
    version: 2,
    byView,
    ...(byParent && Object.keys(byParent).length ? { byParent } : {}),
  }
  localStorage.setItem(POI_STORAGE_KEY, JSON.stringify(payload))
}

export function clearPoiOverrides() {
  localStorage.removeItem(POI_STORAGE_KEY)
  clearHeroOverrides()
}

function applyPositionOverrides(
  viewIndex: number,
  pois: PoiDefinition[],
  overrides: PoiPositionOverrides,
): PoiDefinition[] {
  const view = overrides[viewIndex]
  if (!view) return pois.map((p) => applyProjectMediaFields({ ...p }))
  return pois.map((p) =>
    applyProjectMediaFields({
      ...p,
      x: view[p.id]?.x ?? p.x,
      y: view[p.id]?.y ?? p.y,
    }),
  )
}

export function getPoisForView(viewIndex: number): PoiDefinition[] {
  return resolvePoisByView()[viewIndex] ?? []
}

function loadChildPoisFromStorage(): Record<string, PoiDefinition[]> | null {
  const project = getProjectChildPoisMap()
  if (project) return project

  const raw = localStorage.getItem(POI_STORAGE_KEY)
  if (!raw) return null
  const data = parseStorage(raw)
  if (data && (data as PoiStorageV2).version === 2) {
    const byParent = (data as PoiStorageV2).byParent
    if (!byParent || !Object.keys(byParent).length) return null
    const out: Record<string, PoiDefinition[]> = {}
    for (const [parentId, list] of Object.entries(byParent)) {
      out[parentId] = list.map((p) =>
        applyProjectMediaFields({ ...p, parentId: p.parentId ?? parentId }),
      )
    }
    return out
  }
  return null
}

export function getChildPoisForParent(parentId: string): PoiDefinition[] {
  return resolveChildPoisByParent()[parentId] ?? []
}

export function getParentIdsWithChildren(): string[] {
  return Object.keys(resolveChildPoisByParent())
}

export function getEditableChildPoisMap(): Record<string, PoiDefinition[]> {
  return { ...resolveChildPoisByParent() }
}

export function findPoiById(poiId: string): PoiDefinition | undefined {
  for (const idx of poiViewIndices()) {
    const hit = getPoisForView(idx).find((p) => p.id === poiId)
    if (hit) return hit
  }
  const childMap = resolveChildPoisByParent()
  for (const list of Object.values(childMap)) {
    const hit = list.find((p) => p.id === poiId)
    if (hit) return hit
  }
  return undefined
}

export function getEditablePoisMap(): Record<number, PoiDefinition[]> {
  return { ...resolvePoisByView() }
}

/** IDs de todos os pins raiz + filhos válidos (para limpar DOM órfão). */
export function getAllConfiguredPoiIds(): Set<string> {
  const ids = new Set<string>()
  for (const list of Object.values(resolvePoisByView())) {
    for (const p of list) ids.add(p.id)
  }
  for (const list of Object.values(resolveChildPoisByParent())) {
    for (const p of list) ids.add(p.id)
  }
  return ids
}

export function exportOverridesFromPois(
  poisByView: Record<number, PoiDefinition[]>,
): PoiPositionOverrides {
  const out: PoiPositionOverrides = {}
  for (const [viewKey, pois] of Object.entries(poisByView)) {
    const idx = Number(viewKey)
    out[idx] = {}
    for (const p of pois) {
      out[idx][p.id] = { x: round1(p.x), y: round1(p.y) }
    }
  }
  return out
}

export function formatPoisAsTypeScript(poisByView: Record<number, PoiDefinition[]>): string {
  const lines: string[] = [
    '// Cole em src/config/pois.ts — POIS_BY_VIEW',
    "import type { PoiDefinition } from '../core/types'",
    '',
    'export const POIS_BY_VIEW: Record<number, PoiDefinition[]> = {',
  ]

  for (const viewKey of Object.keys(poisByView).sort((a, b) => Number(a) - Number(b))) {
    const idx = Number(viewKey)
    if (!poisByView[idx]?.length) continue
    lines.push(`  ${idx}: [`)
    for (const p of poisByView[idx]) {
      lines.push(`    {`)
      lines.push(`      id: '${p.id}',`)
      lines.push(`      label: '${escapeTs(p.label)}',`)
      lines.push(`      x: ${round1(p.x)},`)
      lines.push(`      y: ${round1(p.y)},`)
      lines.push(`      tag: '${escapeTs(p.tag)}',`)
      lines.push(`      title: '${escapeTs(p.title)}',`)
      lines.push(`      desc: '${escapeTs(p.desc)}',`)
      if (p.targetView !== undefined) lines.push(`      targetView: ${p.targetView},`)
      if (p.img) lines.push(`      img: '${p.img.replace(/'/g, "\\'")}',`)
      if (p.transitionVideo)
        lines.push(`      transitionVideo: '${p.transitionVideo.replace(/'/g, "\\'")}',`)
      if (p.motionBlur) lines.push(`      motionBlur: true,`)
      if (p.positionLocked) lines.push(`      positionLocked: true,`)
      lines.push(`    },`)
    }
    lines.push(`  ],`)
  }
  lines.push('}')
  return lines.join('\n')
}

function escapeTs(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}
