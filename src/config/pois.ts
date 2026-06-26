import type { PoiDefinition } from '../core/types'

export const POIS_BY_VIEW: Record<number, PoiDefinition[]> = {
  0: [
    {
      id: 'pan-1',
      label: 'Estacionamento',
      x: 51.4,
      y: 37.9,
      tag: 'Infraestrutura',
      title: 'Estacionamento',
      desc: 'Área de estacionamento coberto.',
      targetView: 9,
    },
    {
      id: 'pan-2',
      label: 'Parque',
      x: 13.8,
      y: 65.2,
      tag: 'Lazer',
      title: 'Parque',
      desc: 'Espaço de convivência com playground e quadras.',
      targetView: 6,
    },
    {
      id: 'pan-3',
      label: 'Prédio Tipo 1',
      x: 59.1,
      y: 57.1,
      tag: 'Residencial',
      title: 'Prédio Tipo 1',
      desc: 'Torre residencial principal.',
      targetView: 7,
    },
    {
      id: 'pan-4',
      label: 'Portaria',
      x: 64.6,
      y: 71.0,
      tag: 'Acesso',
      title: 'Portaria',
      desc: 'Portaria com controle de acesso 24h.',
      targetView: 8,
    },
  ],
  6: [
    {
      id: 'parq-1',
      label: 'Parque',
      x: 53.6,
      y: 58.6,
      tag: 'Lazer',
      title: 'Parque',
      desc: 'Área verde do empreendimento.',
    },
  ],
  7: [
    {
      id: 'pred-1',
      label: 'Portaria',
      x: 56.9,
      y: 82.2,
      tag: 'Circulação',
      title: 'Portaria',
      desc: 'Hall de entrada do prédio.',
    },
  ],
  8: [
    {
      id: 'port-1',
      label: 'Acesso Principal',
      x: 50,
      y: 55,
      tag: 'Acesso',
      title: 'Portaria',
      desc: 'Controle de acesso e recepção.',
    },
  ],
  9: [
    {
      id: 'est-1',
      label: 'Estacionamento',
      x: 48.7,
      y: 59.7,
      tag: 'Infraestrutura',
      title: 'Acesso Veicular',
      desc: 'Entrada com cancela automática.',
    },
  ],
}

export const DEFAULT_POI_IMAGE = '/images/custom/poi-pan-4.png'
export const DEFAULT_PANORAMA = '/images/custom/view-0-hero.png'
