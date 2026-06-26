import type { FrameSequence } from '../core/types'

/** Graph edges: `${from}_${to}` → image sequence prefix */
export const SEQUENCES: Record<string, FrameSequence> = {
  '0_6': { base: '/images/seq_arch/parque_', count: 48, pad: 2, ext: 'jpg' },
  '6_0': { base: '/images/seq_arch/parque_', count: 48, pad: 2, ext: 'jpg', reverse: true },

  '0_7': { base: '/images/seq_arch/torre_', count: 48, pad: 2, ext: 'jpg' },
  '7_0': { base: '/images/seq_arch/portaria_to_pan_', count: 48, pad: 2, ext: 'jpg' },
  '7_9': { base: '/images/seq_arch/portaria_to_est_', count: 48, pad: 2, ext: 'jpg' },
  '7_6': { base: '/images/seq_arch/portaria_to_parque_', count: 48, pad: 2, ext: 'jpg' },
  '7_8': { base: '/images/seq_arch/portaria_to_predio_', count: 48, pad: 2, ext: 'jpg' },

  '0_9': { base: '/images/seq_arch/est_', count: 48, pad: 2, ext: 'jpg' },
  '9_0': { base: '/images/seq_arch/est_', count: 48, pad: 2, ext: 'jpg', reverse: true },
  '9_8': { base: '/images/seq_arch/est_to_predio_', count: 48, pad: 2, ext: 'jpg' },
  '9_6': { base: '/images/seq_arch/est_to_parque_', count: 48, pad: 2, ext: 'jpg' },
  '9_7': { base: '/images/seq_arch/est_to_portaria_', count: 48, pad: 2, ext: 'jpg' },
  '6_9': { base: '/images/seq_arch/parque_to_', count: 48, pad: 2, ext: 'jpg' },
  '6_8': { base: '/images/seq_arch/parque_to_portaria_', count: 48, pad: 2, ext: 'jpg' },
  '6_7': { base: '/images/seq_arch/parque_to_predio_', count: 48, pad: 2, ext: 'jpg' },

  '0_8': { base: '/images/seq_arch/arch_', count: 48, pad: 2, ext: 'jpg' },
  '8_0': { base: '/images/seq_arch/arch_', count: 48, pad: 2, ext: 'jpg', reverse: true },
  '8_9': { base: '/images/seq_arch/predio_to_est_', count: 48, pad: 2, ext: 'jpg' },
}
