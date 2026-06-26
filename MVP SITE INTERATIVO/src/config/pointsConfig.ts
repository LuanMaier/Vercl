import pointsOverridesJson from './generated/pointsOverrides.json'
import { DOCK_HUB_VIEWS, isDockHubView } from './dockHubs'
import { getProjectMenuImagePath, getProjectMenuVideoPath } from './projectMedia'
import { TRACK_ORDER as DEFAULT_TRACK_ORDER, VIEWPOINTS as DEFAULT_VIEWPOINTS } from './points'
import type { Viewpoint } from '../core/types'

export type PointsOverridesFile = {
  version: 1
  trackOrder?: number[]
  viewpoints?: Record<string, Partial<Viewpoint>>
  /** Cenas criadas no editor (chave = índice) */
  customViews?: Record<string, Viewpoint>
  /** Índices das cenas padrão removidas pelo editor */
  removedViews?: number[]
}

const MAX_VIEW_INDEX = 63
const PROTECTED_VIEW_INDICES = new Set([0, ...DOCK_HUB_VIEWS])

let overrides: PointsOverridesFile = {
  ...(pointsOverridesJson as PointsOverridesFile),
  version: 1,
}

function slugViewId(label: string, index: number): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'cena'
  return `${base}-${index}`
}

export function isProtectedView(viewIndex: number): boolean {
  return PROTECTED_VIEW_INDICES.has(viewIndex)
}

/** Índices de vista ativos no projeto. */
export function getAvailableViewIndices(): number[] {
  const indices = new Set<number>()

  for (let i = 0; i < DEFAULT_VIEWPOINTS.length; i++) {
    if (DEFAULT_VIEWPOINTS[i] && !overrides.removedViews?.includes(i)) {
      indices.add(i)
    }
  }

  if (overrides.customViews) {
    for (const key of Object.keys(overrides.customViews)) {
      const idx = Number(key)
      if (Number.isFinite(idx)) indices.add(idx)
    }
  }

  return [...indices].sort((a, b) => a - b)
}

export function getTrackOrder(): number[] {
  const raw = overrides.trackOrder ?? [...DEFAULT_TRACK_ORDER]
  const seen = new Set<number>()
  const order: number[] = []
  for (const idx of raw) {
    if (seen.has(idx) || !getViewpoint(idx)) continue
    seen.add(idx)
    order.push(idx)
  }
  if (!order.includes(0) && getViewpoint(0)) order.unshift(0)
  for (const hub of DOCK_HUB_VIEWS) {
    if (getViewpoint(hub) && !order.includes(hub)) {
      const pano = order.indexOf(0)
      const lastHub = DOCK_HUB_VIEWS.filter((h) => order.includes(h)).pop()
      const insertAt =
        lastHub !== undefined ? order.indexOf(lastHub) + 1 : pano >= 0 ? pano + 1 : 0
      order.splice(insertAt, 0, hub)
    }
  }
  return order
}

export function getViewpoint(viewIndex: number): Viewpoint | null {
  if (overrides.removedViews?.includes(viewIndex)) return null

  const custom = overrides.customViews?.[String(viewIndex)]
  const base = custom ?? DEFAULT_VIEWPOINTS[viewIndex]
  if (!base) return null

  const ov = overrides.viewpoints?.[String(viewIndex)]
  const transitionVideo = getProjectMenuVideoPath(viewIndex)
  const transitionImage = getProjectMenuImagePath(viewIndex)
  return {
    ...base,
    ...ov,
    index: viewIndex,
    id: ov?.id ?? base.id,
    label: ov?.label ?? base.label,
    tag: ov?.tag ?? base.tag,
    title: ov?.title ?? base.title,
    desc: ov?.desc ?? base.desc,
    ...(transitionVideo ? { transitionVideo } : {}),
    ...(transitionImage ? { transitionImage } : {}),
  }
}

export function allocateNewViewIndex(): number {
  const used = new Set(getAvailableViewIndices())
  for (const slot of [3, 4, 5]) {
    if (!used.has(slot)) return slot
  }
  for (let i = 10; i <= MAX_VIEW_INDEX; i++) {
    if (!used.has(i)) return i
  }
  throw new Error('Limite de cenas atingido')
}

export function createCustomViewpoint(label: string, opts?: { heroMenu?: boolean }): number {
  const trimmed = label.trim()
  if (!trimmed) throw new Error('Nome da cena não pode ficar vazio')

  const index = allocateNewViewIndex()
  if (!overrides.customViews) overrides.customViews = {}
  overrides.customViews[String(index)] = {
    id: slugViewId(trimmed, index),
    label: trimmed,
    index,
    tag: opts?.heroMenu ? 'Destaque' : 'Nova cena',
    title: trimmed,
    desc: '',
  }
  if (opts?.heroMenu) addViewToMainMenu(index)
  return index
}

/** Inclui a vista no menu inferior do site (como Praia, Portaria…). */
export function addViewToMainMenu(viewIndex: number): void {
  if (!getViewpoint(viewIndex)) throw new Error('Vista inválida')
  const current = overrides.trackOrder ?? getTrackOrder()
  if (current.includes(viewIndex)) return
  overrides.trackOrder = normalizeTrackOrder([...current, viewIndex])
}

export function isViewOnMainMenu(viewIndex: number): boolean {
  return getTrackOrder().includes(viewIndex)
}

export function removeViewpointFromProject(viewIndex: number): boolean {
  if (isProtectedView(viewIndex)) return false

  if (overrides.customViews?.[String(viewIndex)]) {
    delete overrides.customViews[String(viewIndex)]
    if (overrides.customViews && !Object.keys(overrides.customViews).length) {
      delete overrides.customViews
    }
  } else if (DEFAULT_VIEWPOINTS[viewIndex]) {
    if (!overrides.removedViews) overrides.removedViews = []
    if (!overrides.removedViews.includes(viewIndex)) {
      overrides.removedViews.push(viewIndex)
    }
  } else {
    return false
  }

  if (overrides.trackOrder) {
    overrides.trackOrder = overrides.trackOrder.filter((i) => i !== viewIndex)
  }
  if (overrides.viewpoints?.[String(viewIndex)]) {
    delete overrides.viewpoints[String(viewIndex)]
  }

  return true
}

export function getEditableDockState() {
  const trackOrder = getTrackOrder()
  const viewpoints: Record<number, Partial<Viewpoint>> = {}
  if (overrides.viewpoints) {
    for (const [k, v] of Object.entries(overrides.viewpoints)) {
      viewpoints[Number(k)] = { ...v }
    }
  }
  return { trackOrder: [...trackOrder], viewpoints }
}

export function applyPointsOverridesFile(data: PointsOverridesFile) {
  overrides = { ...data, version: 1 }
}

export function getPointsOverridesSnapshot(): PointsOverridesFile {
  return {
    version: 1,
    trackOrder: overrides.trackOrder ? [...overrides.trackOrder] : undefined,
    viewpoints: overrides.viewpoints ? { ...overrides.viewpoints } : undefined,
    customViews: overrides.customViews ? { ...overrides.customViews } : undefined,
    removedViews: overrides.removedViews ? [...overrides.removedViews] : undefined,
  }
}

export async function reloadPointsOverrides() {
  const t = Date.now()
  try {
    const res = await fetch(`/src/config/generated/pointsOverrides.json?t=${t}`)
    if (res.ok) {
      overrides = { ...(await res.json()), version: 1 } as PointsOverridesFile
    }
  } catch {
    /* dev offline */
  }
}

export function buildPointsOverridesPayload(
  trackOrder: number[],
  viewpoints: Record<number, Partial<Viewpoint>>,
): PointsOverridesFile {
  const vpOut: Record<string, Partial<Viewpoint>> = {}
  for (const idx of trackOrder) {
    const patch = viewpoints[idx]
    if (
      !patch ||
      (!patch.label &&
        !patch.tag &&
        !patch.title &&
        !patch.desc &&
        patch.motionBlur === undefined &&
        patch.videoRollback === undefined &&
        patch.menuMediaMode === undefined)
    )
      continue
    vpOut[String(idx)] = patch
  }
  return {
    version: 1,
    trackOrder: normalizeTrackOrder(trackOrder),
    viewpoints: Object.keys(vpOut).length ? vpOut : undefined,
    customViews: overrides.customViews,
    removedViews: overrides.removedViews?.length ? [...overrides.removedViews] : undefined,
  }
}

export function buildScenesOverridesPayload(): PointsOverridesFile {
  return getPointsOverridesSnapshot()
}

export function normalizeTrackOrder(order: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  if (order.includes(0) && getViewpoint(0)) {
    out.push(0)
    seen.add(0)
  }
  for (const hub of DOCK_HUB_VIEWS) {
    if (getViewpoint(hub)) {
      out.push(hub)
      seen.add(hub)
    }
  }
  for (const idx of order) {
    if (idx === 0 || isDockHubView(idx) || seen.has(idx) || !getViewpoint(idx)) continue
    seen.add(idx)
    out.push(idx)
  }
  return out
}

export function defaultViewpointPatch(viewIndex: number): Partial<Viewpoint> {
  const base = getViewpoint(viewIndex)
  if (!base) return {}
  return { label: base.label, tag: base.tag, title: base.title, desc: base.desc }
}
