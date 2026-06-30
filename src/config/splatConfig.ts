import splatOverridesJson from './generated/splatOverrides.json'

export type SplatPinDefinition = {
  id: string
  label: string
  /** Posição local no SplatMesh (x/y/z relativos ao PLY). */
  x?: number
  y?: number
  z?: number
  /** Legado — direção esférica; usado se x/y/z ausentes. */
  yaw?: number
  pitch?: number
  tag?: string
  targetView?: number
}

/** Zoom padrão ao clicar num pin do splat (% de aproximação). */
export const DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT = 30

/** @deprecated use getSplatPinFocusZoomPct() */
export const SPLAT_PIN_FOCUS_ZOOM_PCT = DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT

/** Duração padrão do voo de câmera (segundos). */
export const DEFAULT_SPLAT_CAMERA_FLIGHT_SEC = 1

export type SplatNavigationSettings = {
  /** % de aproximação da câmera em direção ao pin ao clicar. */
  pinFocusZoomPct?: number
  /** Duração do voo suave pin ↔ vista inicial (segundos). */
  cameraFlightDurationSec?: number
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
} & SplatNavigationSettings

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

export function getSplatPinFocusZoomPct(): number {
  const v = overrides.pinFocusZoomPct
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT
  return Math.min(100, Math.max(0, Math.round(v)))
}

export function getSplatCameraFlightDurationSec(): number {
  const v = overrides.cameraFlightDurationSec
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SPLAT_CAMERA_FLIGHT_SEC
  return Math.min(8, Math.max(0.15, Math.round(v * 100) / 100))
}

export function getEditableSplatState(): SplatOverridesFile {
  return {
    version: 1,
    model: overrides.model ?? null,
    pins: getSplatPins(),
    dockEnabled: Boolean(overrides.dockEnabled),
    limits: getSplatMovementLimits(),
    startView: getSplatStartView() ?? null,
    pinFocusZoomPct: getSplatPinFocusZoomPct(),
    cameraFlightDurationSec: getSplatCameraFlightDurationSec(),
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
    pinFocusZoomPct:
      typeof data.pinFocusZoomPct === 'number' ? getSplatPinFocusZoomPctFromRaw(data.pinFocusZoomPct) : undefined,
    cameraFlightDurationSec:
      typeof data.cameraFlightDurationSec === 'number'
        ? getSplatCameraFlightDurationSecFromRaw(data.cameraFlightDurationSec)
        : undefined,
  }
}

function getSplatPinFocusZoomPctFromRaw(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT
  return Math.min(100, Math.max(0, Math.round(v)))
}

function getSplatCameraFlightDurationSecFromRaw(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SPLAT_CAMERA_FLIGHT_SEC
  return Math.min(8, Math.max(0.15, Math.round(v * 100) / 100))
}

export function buildSplatOverridesPayload(
  pins: SplatPinDefinition[],
  model?: string | null,
  dockEnabled?: boolean,
  limits?: SplatMovementLimits,
  startView?: SplatStartView | null,
  navigation?: SplatNavigationSettings,
): SplatOverridesFile {
  const resolvedLimits = limits ?? getSplatMovementLimits()
  const resolvedStart =
    startView === undefined
      ? getSplatStartView()
      : startView && isValidStartView(startView)
        ? { ...startView }
        : undefined
  const pinFocusZoomPct = navigation?.pinFocusZoomPct ?? getSplatPinFocusZoomPct()
  const cameraFlightDurationSec = navigation?.cameraFlightDurationSec ?? getSplatCameraFlightDurationSec()
  return {
    version: 1,
    model: model ?? overrides.model ?? null,
    dockEnabled: dockEnabled ?? Boolean(overrides.dockEnabled),
    limits: { ...resolvedLimits },
    pinFocusZoomPct,
    cameraFlightDurationSec,
    ...(resolvedStart ? { startView: resolvedStart } : {}),
    pins: pins.map((p) => ({
      id: p.id,
      label: p.label,
      ...(typeof p.x === 'number' ? { x: p.x } : {}),
      ...(typeof p.y === 'number' ? { y: p.y } : {}),
      ...(typeof p.z === 'number' ? { z: p.z } : {}),
      ...(typeof p.yaw === 'number' ? { yaw: p.yaw } : {}),
      ...(typeof p.pitch === 'number' ? { pitch: p.pitch } : {}),
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
