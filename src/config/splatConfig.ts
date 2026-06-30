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

export type SplatMovementLimits = {
  /** % de aproximação permitida a partir da distância inicial (100 = sem limite). */
  zoomForwardPct?: number
  /** % de afastamento permitido a partir da distância inicial (100 = sem limite). */
  zoomBackwardPct?: number
  /** % do arco horizontal total (360°) centrado na posição inicial (100 = livre). */
  orbitYawPct?: number
  /** % do arco vertical total (180°) centrado na posição inicial (100 = livre). */
  orbitPitchPct?: number
}

/** Posição orbital da câmera ao abrir o splat (referência para limites de movimento). */
export type SplatStartView = {
  targetX: number
  targetY: number
  targetZ: number
  /** Radianos — azimute horizontal (OrbitControls / THREE.Spherical.theta). */
  azimuth: number
  /** Radianos — ângulo polar (THREE.Spherical.phi). */
  polar: number
  distance: number
}

export const DEFAULT_SPLAT_MOVEMENT_LIMITS: Required<SplatMovementLimits> = {
  zoomForwardPct: 100,
  zoomBackwardPct: 100,
  orbitYawPct: 100,
  orbitPitchPct: 100,
}

export type SplatOverridesFile = {
  version: 1
  model?: string | null
  pins?: SplatPinDefinition[]
  /** Exibe o botão "Interativo" no menu inferior do site. */
  dockEnabled?: boolean
  limits?: SplatMovementLimits
  /** Vista inicial ao carregar o PLY; omitido = posição padrão do viewer. */
  startView?: SplatStartView | null
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

export function isSplatDockEnabled(): boolean {
  return Boolean(overrides.dockEnabled)
}

/** Botão Interativo visível no menu quando habilitado e com PLY salvo. */
export function isSplatInteractiveDockVisible(): boolean {
  return isSplatDockEnabled() && Boolean(getSplatModelPath())
}

export function getSplatPins(): SplatPinDefinition[] {
  return (overrides.pins ?? []).map((p) => ({ ...p }))
}

export function getSplatMovementLimits(): Required<SplatMovementLimits> {
  const l = overrides.limits ?? {}
  return {
    zoomForwardPct: l.zoomForwardPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.zoomForwardPct,
    zoomBackwardPct: l.zoomBackwardPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.zoomBackwardPct,
    orbitYawPct: l.orbitYawPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.orbitYawPct,
    orbitPitchPct: l.orbitPitchPct ?? DEFAULT_SPLAT_MOVEMENT_LIMITS.orbitPitchPct,
  }
}

function isValidStartView(v: unknown): v is SplatStartView {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.targetX === 'number' &&
    typeof o.targetY === 'number' &&
    typeof o.targetZ === 'number' &&
    typeof o.azimuth === 'number' &&
    typeof o.polar === 'number' &&
    typeof o.distance === 'number' &&
    Number.isFinite(o.distance) &&
    o.distance > 0
  )
}

export function getSplatStartView(): SplatStartView | undefined {
  const v = overrides.startView
  return isValidStartView(v) ? { ...v } : undefined
}

export function getEditableSplatState(): SplatOverridesFile {
  return {
    version: 1,
    model: overrides.model ?? null,
    pins: getSplatPins(),
    dockEnabled: Boolean(overrides.dockEnabled),
    limits: getSplatMovementLimits(),
    startView: getSplatStartView() ?? null,
  }
}

export function applySplatOverridesFile(data: SplatOverridesFile) {
  overrides = {
    version: 1,
    model: data.model ?? null,
    pins: (data.pins ?? []).map((p) => ({ ...p })),
    dockEnabled: Boolean(data.dockEnabled),
    limits: data.limits ? { ...data.limits } : undefined,
    startView: isValidStartView(data.startView) ? { ...data.startView } : undefined,
  }
}

export function buildSplatOverridesPayload(
  pins: SplatPinDefinition[],
  model?: string | null,
  dockEnabled?: boolean,
  limits?: SplatMovementLimits,
  startView?: SplatStartView | null,
): SplatOverridesFile {
  const resolvedLimits = limits ?? getSplatMovementLimits()
  const resolvedStart =
    startView === undefined
      ? getSplatStartView()
      : startView && isValidStartView(startView)
        ? { ...startView }
        : undefined
  return {
    version: 1,
    model: model ?? overrides.model ?? null,
    dockEnabled: dockEnabled ?? Boolean(overrides.dockEnabled),
    limits: { ...resolvedLimits },
    ...(resolvedStart ? { startView: resolvedStart } : {}),
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
