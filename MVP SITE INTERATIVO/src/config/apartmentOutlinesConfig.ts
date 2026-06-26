import apartmentOutlinesOverridesJson from './generated/apartmentOutlinesOverrides.json'
import { highlightPinId } from './apartmentPoiConfig'

export type OutlinePoint = { x: number; y: number }

export type UnitOutline = {
  points: OutlinePoint[]
  coordSpace: 'image'
}

export type ApartmentOutlinesOverridesFile = {
  version: 1
  /** Unidade cuja mídia _main é a fachada CRM compartilhada. */
  facadeApartmentId: string
  /** Contornos por id do pin (vários apartamentos na mesma face). */
  byPin?: Record<string, UnitOutline>
  /** @deprecated — migrado para byPin na leitura. */
  byUnit?: Record<string, UnitOutline>
}

export type ApartmentOutlinesEditorState = {
  facadeApartmentId: string
  byPin: Record<string, UnitOutline>
}

let overrides: ApartmentOutlinesOverridesFile = normalizeOverridesFile(
  apartmentOutlinesOverridesJson as ApartmentOutlinesOverridesFile,
)

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function normalizeOutline(raw: UnitOutline | undefined): UnitOutline | null {
  if (!raw?.points?.length) return null
  const points = raw.points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      x: round1(Math.max(0, Math.min(100, p.x))),
      y: round1(Math.max(0, Math.min(100, p.y))),
    }))
  if (points.length < 3) return null
  return { points, coordSpace: 'image' }
}

function normalizeOverridesFile(data: ApartmentOutlinesOverridesFile): ApartmentOutlinesOverridesFile {
  const byPin: Record<string, UnitOutline> = {}
  for (const [id, raw] of Object.entries(data.byPin ?? {})) {
    const norm = normalizeOutline(raw)
    if (norm) byPin[id] = norm
  }
  for (const [aptId, raw] of Object.entries(data.byUnit ?? {})) {
    const norm = normalizeOutline(raw)
    if (!norm) continue
    const pinId = highlightPinId(aptId)
    if (!byPin[pinId]) byPin[pinId] = norm
  }
  return {
    version: 1,
    facadeApartmentId: data.facadeApartmentId || 'apt-1',
    byPin,
  }
}

export function getFacadeApartmentId(): string {
  return overrides.facadeApartmentId || 'apt-1'
}

export function getOutlineForPin(pinId: string): UnitOutline | null {
  return normalizeOutline(overrides.byPin?.[pinId])
}

/** @deprecated Use getOutlineForPin — compat com chave legada por unidade. */
export function getOutlineForUnit(unitId: string): UnitOutline | null {
  return getOutlineForPin(highlightPinId(unitId))
}

export function getAllPinOutlines(): Record<string, UnitOutline> {
  const out: Record<string, UnitOutline> = {}
  for (const [id, raw] of Object.entries(overrides.byPin ?? {})) {
    const norm = normalizeOutline(raw)
    if (norm) out[id] = norm
  }
  return out
}

/** @deprecated Use getAllPinOutlines. */
export function getAllUnitOutlines(): Record<string, UnitOutline> {
  return getAllPinOutlines()
}

export function getEditableApartmentOutlinesState(): ApartmentOutlinesEditorState {
  return {
    facadeApartmentId: getFacadeApartmentId(),
    byPin: getAllPinOutlines(),
  }
}

export function applyApartmentOutlinesOverridesFile(data: ApartmentOutlinesOverridesFile) {
  overrides = normalizeOverridesFile(data)
}

export async function reloadApartmentOutlinesOverrides() {
  const t = Date.now()
  try {
    const res = await fetch(`/src/config/generated/apartmentOutlinesOverrides.json?t=${t}`)
    if (res.ok) {
      const data = (await res.json()) as ApartmentOutlinesOverridesFile
      applyApartmentOutlinesOverridesFile(data)
    }
  } catch {
    /* dev offline */
  }
}

export function buildApartmentOutlinesOverridesPayload(
  state: ApartmentOutlinesEditorState,
): ApartmentOutlinesOverridesFile {
  const byPin: Record<string, UnitOutline> = {}
  for (const [id, raw] of Object.entries(state.byPin)) {
    const norm = normalizeOutline(raw)
    if (norm) byPin[id] = norm
  }
  return {
    version: 1,
    facadeApartmentId: state.facadeApartmentId || 'apt-1',
    byPin,
  }
}
