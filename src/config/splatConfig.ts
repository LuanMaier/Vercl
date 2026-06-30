import splatOverridesJson from './generated/splatOverrides.json'

export type SplatPinDefinition = {
  id: string
  label: string
  /** Graus — azimute horizontal (0 = frente -Z). */
  yaw: number
  /** Graus — elevação (-90..90). */
  pitch: number
  tag?: string
  targetView?: number
}

export type SplatOverridesFile = {
  version: 1
  model?: string | null
  pins?: SplatPinDefinition[]
}

let overrides: SplatOverridesFile = {
  ...(splatOverridesJson as SplatOverridesFile),
  version: 1,
}

const SPLAT_RUNTIME_URLS = [
  '/config/splatOverrides.json',
  '/src/config/generated/splatOverrides.json',
]

export function getSplatModelPath(): string | undefined {
  const p = overrides.model
  return p && typeof p === 'string' ? p : undefined
}

export function getSplatPins(): SplatPinDefinition[] {
  return (overrides.pins ?? []).map((p) => ({ ...p }))
}

export function getEditableSplatState(): SplatOverridesFile {
  return {
    version: 1,
    model: overrides.model ?? null,
    pins: getSplatPins(),
  }
}

export function applySplatOverridesFile(data: SplatOverridesFile) {
  overrides = {
    version: 1,
    model: data.model ?? null,
    pins: (data.pins ?? []).map((p) => ({ ...p })),
  }
}

export function buildSplatOverridesPayload(
  pins: SplatPinDefinition[],
  model?: string | null,
): SplatOverridesFile {
  return {
    version: 1,
    model: model ?? overrides.model ?? null,
    pins: pins.map((p) => ({
      id: p.id,
      label: p.label,
      yaw: p.yaw,
      pitch: p.pitch,
      ...(p.tag ? { tag: p.tag } : {}),
      ...(p.targetView != null ? { targetView: p.targetView } : {}),
    })),
  }
}

export async function reloadSplatOverrides() {
  const t = Date.now()
  for (const base of SPLAT_RUNTIME_URLS) {
    try {
      const res = await fetch(`${base}?t=${t}`)
      if (!res.ok) continue
      applySplatOverridesFile((await res.json()) as SplatOverridesFile)
      return
    } catch {
      /* try next */
    }
  }
}
