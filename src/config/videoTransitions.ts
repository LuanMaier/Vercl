import type { VideoTransition } from '../core/types'

/**
 * Transições em vídeo — quando definidas, substituem a sequência JPG da mesma chave.
 * Nome do arquivo: `{from}_{to}.webm` (ex: `0_6.webm` = Panorâmica → Parque)
 */
export const VIDEO_TRANSITIONS: Record<string, VideoTransition> = {
  // Descomente conforme for colocando os arquivos em public/media/trans/
  // '0_6': {
  //   type: 'video',
  //   src: '/media/trans/0_6.webm',
  //   mobileSrc: '/media/trans/mobile/0_6.webm',
  // },
}
