import type { LightMode } from '../core/types'
import {
  getProjectLightMotionBlur,
  getProjectLightPosterPath,
  getProjectLightVideoPath,
} from './projectMedia'

export const LIGHT_MODE_LABELS: Record<LightMode, string> = {
  day: 'Dia',
  sunset: 'Tarde',
  night: 'Noite',
}

export const LIGHT_MODES: LightMode[] = ['day', 'sunset', 'night']

/** Ordem do ciclo: dia → tarde → noite → dia */
const LIGHT_RING: LightMode[] = ['day', 'sunset', 'night']

/**
 * Vídeo da aresta no sentido horário (próximo mood no anel).
 * - sunset: dia → tarde
 * - night: tarde → noite
 * - day: noite → dia
 */
export const LIGHT_EDGE_VIDEO_LABELS: Record<LightMode, string> = {
  sunset: 'Vídeo dia → tarde',
  night: 'Vídeo tarde → noite',
  day: 'Vídeo noite → dia',
}

export type LightTransitionStep = {
  /** Chave do vídeo no projeto (aresta horária que chega neste mood). */
  edge: LightMode
  reverse: boolean
}

export function resolveLightTransitionSteps(
  from: LightMode,
  to: LightMode,
): LightTransitionStep[] {
  if (from === to) return []

  const fi = LIGHT_RING.indexOf(from)
  const ti = LIGHT_RING.indexOf(to)
  const forward = (ti - fi + 3) % 3
  const backward = (fi - ti + 3) % 3
  const steps: LightTransitionStep[] = []

  if (forward <= backward) {
    let cur = fi
    for (let i = 0; i < forward; i++) {
      const next = (cur + 1) % 3
      steps.push({ edge: LIGHT_RING[next], reverse: false })
      cur = next
    }
  } else {
    let cur = fi
    for (let i = 0; i < backward; i++) {
      steps.push({ edge: LIGHT_RING[cur], reverse: true })
      cur = (cur + 2) % 3
    }
  }

  return steps
}

/** Ex.: noite → tarde = vídeo tarde→noite (`night`) em reverse. */
export function describeLightTransition(from: LightMode, to: LightMode): string {
  const steps = resolveLightTransitionSteps(from, to)
  if (!steps.length) return ''
  const s = steps[0]
  const label = LIGHT_EDGE_VIDEO_LABELS[s.edge]
  if (steps.length > 1) return `${steps.length} transições até ${LIGHT_MODE_LABELS[to]}`
  return s.reverse ? `${label} (reverso)` : label
}

/** Chave em LIGHT_SEQUENCES (JPG) para um passo do anel. */
export function lightSequenceKeyForStep(step: LightTransitionStep): string {
  if (step.reverse) {
    const prev: Record<LightMode, LightMode> = {
      day: 'night',
      sunset: 'day',
      night: 'sunset',
    }
    return `${step.edge}_${prev[step.edge]}`
  }
  const prev: Record<LightMode, LightMode> = {
    sunset: 'day',
    night: 'sunset',
    day: 'night',
  }
  return `${prev[step.edge]}_${step.edge}`
}

/** Vídeo da aresta horária (arquivo salvo sob o mood de destino da aresta). */
export function getLightTransitionVideo(
  viewIndex: number,
  edge: LightMode,
): string | undefined {
  return getProjectLightVideoPath(viewIndex, edge)
}

export function getCustomLightPoster(
  viewIndex: number,
  mode: LightMode,
): string | undefined {
  return getProjectLightPosterPath(viewIndex, mode)
}

export function isLightMotionBlurEnabled(viewIndex: number): boolean {
  return getProjectLightMotionBlur(viewIndex)
}

/** Mood de chegada após um passo do anel (vídeo ou crossfade de poster). */
export function lightModeAfterStep(step: LightTransitionStep): LightMode {
  const prev: Record<LightMode, LightMode> = {
    sunset: 'day',
    night: 'sunset',
    day: 'night',
  }
  return step.reverse ? prev[step.edge] : step.edge
}

/** Mood do poster inicial antes do vídeo do passo. */
export function lightModeBeforeStep(step: LightTransitionStep): LightMode {
  if (step.reverse) return step.edge
  const prev: Record<LightMode, LightMode> = {
    sunset: 'day',
    night: 'sunset',
    day: 'night',
  }
  return prev[step.edge]
}

export function viewHasLightTransitionVideo(
  viewIndex: number,
  from: LightMode,
  to: LightMode,
): boolean {
  return resolveLightTransitionSteps(from, to).some((step) =>
    Boolean(getLightTransitionVideo(viewIndex, step.edge)),
  )
}
