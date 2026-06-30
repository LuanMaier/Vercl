import { buildInteriorsOverridesPayload } from '../config/interiorsConfig'
import type { InteriorItem } from '../config/interiors'
import { buildApartmentsOverridesPayload } from '../config/apartmentsConfig'
import type { ApartmentItem } from '../config/apartments'
import {
  applyApartmentOutlinesOverridesFile,
  buildApartmentOutlinesOverridesPayload,
  type ApartmentOutlinesEditorState,
} from '../config/apartmentOutlinesConfig'
import {
  applyApartmentPoisOverridesFile,
  buildApartmentPoisOverridesPayload,
} from '../config/apartmentPoiConfig'
import {
  clearSavedMediaPath,
  applyPoisOverridesFile,
  notifyProjectUpdated,
  patchProjectLightMotionBlur,
  patchProjectViewIdleMode,
  patchSavedMediaPath,
  reloadProjectFiles,
} from '../config/projectMedia'
import {
  applyPointsOverridesFile,
  buildPointsOverridesPayload,
  buildScenesOverridesPayload,
  getAvailableViewIndices,
} from '../config/pointsConfig'
import type { PoiDefinition, Viewpoint } from '../core/types'

export type SaveMediaKind =
  | 'hero'
  | 'poi-img'
  | 'poi-video'
  | 'poi-loop'
  | 'menu-video'
  | 'menu-image'
  | 'menu-loop'
  | 'interior-video'
  | 'interior-poster'
  | 'interior-media'
  | 'apartment-media'
  | 'apartment-loop'
  | 'light-poster'
  | 'light-video'
  | 'solar-video'
  | 'solar-frame-initial'
  | 'solar-frame-final'
  | 'view-loop'
  | 'splat-ply'

function extFromFile(file: File | Blob) {
  const name = file instanceof File ? file.name : ''
  const fromName = name.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type === 'video/webm') return 'webm'
  if (file.type === 'video/mp4') return 'mp4'
  if (fromName === 'ply') return 'ply'
  return 'jpg'
}

export async function isProjectSaveAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/ping')
    return res.ok
  } catch {
    return false
  }
}

export type SaveProjectOpts = {
  /** true = recarrega JSON e dispara project-updated (só no save global do editor). */
  reload?: boolean
}

async function afterProjectPersist(opts?: SaveProjectOpts) {
  if (opts?.reload === true) {
    await reloadProjectFiles()
    notifyProjectUpdated()
  }
}

export async function saveMediaToProject(
  kind: SaveMediaKind,
  file: File | Blob,
  meta: Record<string, string>,
  opts?: SaveProjectOpts,
): Promise<{ path: string }> {
  const params = new URLSearchParams({ kind, ext: extFromFile(file), ...meta })
  const res = await fetch(`/api/admin/save-media?${params}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || 'Falha ao salvar no projeto')
  }
  const data = (await res.json()) as { path: string }
  if (opts?.reload !== true) {
    patchSavedMediaPath(kind, meta, data.path)
  }
  await afterProjectPersist(opts)
  return data
}

export async function removeMediaFromProject(
  kind: SaveMediaKind,
  meta: Record<string, string>,
  opts?: SaveProjectOpts,
): Promise<void> {
  const params = new URLSearchParams({ kind, ...meta })
  const res = await fetch(`/api/admin/remove-media?${params}`, { method: 'POST' })
  if (!res.ok) throw new Error('Falha ao remover do projeto')
  if (opts?.reload !== true) {
    clearSavedMediaPath(kind, meta)
  }
  await afterProjectPersist(opts)
}

export async function saveViewIdleModeToProject(
  viewIndex: number,
  mode: 'image' | 'loop',
  opts?: SaveProjectOpts,
): Promise<void> {
  const res = await fetch('/api/admin/save-view-idle-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view: String(viewIndex), mode }),
  })
  if (!res.ok) throw new Error('Falha ao salvar modo de fundo')
  if (opts?.reload !== true) {
    patchProjectViewIdleMode(viewIndex, mode)
  }
  await afterProjectPersist(opts)
}

export async function saveInteriorsToProject(
  items: InteriorItem[],
  opts?: SaveProjectOpts,
): Promise<void> {
  const body = buildInteriorsOverridesPayload(items)
  const res = await fetch('/api/admin/save-interiors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar interiores no projeto')
  await afterProjectPersist(opts)
}

export async function saveApartmentsToProject(
  items: ApartmentItem[],
  opts?: SaveProjectOpts,
): Promise<void> {
  const body = buildApartmentsOverridesPayload(items)
  const res = await fetch('/api/admin/save-apartments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar apartamentos no projeto')
  await afterProjectPersist(opts)
}

export async function saveApartmentOutlinesToProject(
  state: ApartmentOutlinesEditorState,
  opts?: SaveProjectOpts,
): Promise<void> {
  const body = buildApartmentOutlinesOverridesPayload(state)
  const res = await fetch('/api/admin/save-apartment-outlines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar contornos de apartamentos no projeto')
  if (opts?.reload !== true) {
    applyApartmentOutlinesOverridesFile(body)
  }
  await afterProjectPersist(opts)
}

export async function saveApartmentPoisToProject(
  byApartment: Record<string, PoiDefinition[]>,
  opts?: SaveProjectOpts,
): Promise<void> {
  const body = buildApartmentPoisOverridesPayload(byApartment)
  const res = await fetch('/api/admin/save-apartment-pois', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar pins de apartamentos no projeto')
  if (opts?.reload !== true) {
    applyApartmentPoisOverridesFile(body)
    notifyProjectUpdated()
  }
  await afterProjectPersist(opts)
}

export async function saveLightSettingsToProject(
  viewIndex: number,
  motionBlur: boolean,
  opts?: SaveProjectOpts,
): Promise<void> {
  const res = await fetch('/api/admin/save-light-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view: String(viewIndex), motionBlur }),
  })
  if (!res.ok) throw new Error('Falha ao salvar insolação no projeto')
  if (opts?.reload !== true) {
    patchProjectLightMotionBlur(viewIndex, motionBlur)
  }
  await afterProjectPersist(opts)
}

export async function saveScenesToProject(opts?: SaveProjectOpts): Promise<void> {
  const body = buildScenesOverridesPayload()
  const res = await fetch('/api/admin/save-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar cenas no projeto')
  if (opts?.reload !== true) {
    applyPointsOverridesFile(body)
    notifyProjectUpdated()
  }
  await afterProjectPersist(opts)
}

export async function saveDockToProject(
  trackOrder: number[],
  viewpoints: Record<number, Partial<Viewpoint>>,
  opts?: SaveProjectOpts,
): Promise<void> {
  const body = buildPointsOverridesPayload(trackOrder, viewpoints)
  const res = await fetch('/api/admin/save-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Falha ao salvar menu no projeto')
  if (opts?.reload !== true) {
    applyPointsOverridesFile(body)
    notifyProjectUpdated()
  }
  await afterProjectPersist(opts)
}

export async function savePoisMapToProject(
  poisByView: Record<number, PoiDefinition[]>,
  opts?: SaveProjectOpts & { byParent?: Record<string, PoiDefinition[]> },
): Promise<void> {
  const VIEW_INDICES = getAvailableViewIndices()
  const byView: Record<string, PoiDefinition[]> = {}
  for (const idx of VIEW_INDICES) {
    byView[String(idx)] = poisByView[idx] ?? []
  }
  const payload: {
    version: 1
    byView: Record<string, PoiDefinition[]>
    byParent?: Record<string, PoiDefinition[]>
  } = { version: 1, byView }
  if (opts?.byParent && Object.keys(opts.byParent).length) {
    const allPinIds = new Set<string>()
    for (const list of Object.values(byView)) {
      for (const p of list) allPinIds.add(p.id)
    }
    for (const list of Object.values(opts.byParent)) {
      for (const p of list) allPinIds.add(p.id)
    }
    const byParent: Record<string, PoiDefinition[]> = {}
    for (const [parentId, list] of Object.entries(opts.byParent)) {
      if (!allPinIds.has(parentId) || !list.length) continue
      byParent[parentId] = list
    }
    if (Object.keys(byParent).length) payload.byParent = byParent
  }
  const res = await fetch('/api/admin/save-pois', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao salvar pins no projeto')
  if (opts?.reload !== true) {
    applyPoisOverridesFile(payload)
    notifyProjectUpdated()
  }
  await afterProjectPersist(opts)
}

export async function saveSplatsToProject(
  payload: import('../config/splatConfig').SplatOverridesFile,
  opts?: SaveProjectOpts,
): Promise<void> {
  const res = await fetch('/api/admin/save-splats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Falha ao salvar splat no projeto')
  if (opts?.reload !== true) {
    const { applySplatOverridesFile } = await import('../config/splatConfig')
    applySplatOverridesFile(payload)
    notifyProjectUpdated()
  }
  await afterProjectPersist(opts)
}

export async function resetProjectOverrides(password: string): Promise<void> {
  const res = await fetch('/api/admin/reset-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.status === 403) throw new Error('Senha de administrador incorreta')
  if (!res.ok) throw new Error('Falha ao resetar projeto')
  await reloadProjectFiles()
  notifyProjectUpdated()
}
