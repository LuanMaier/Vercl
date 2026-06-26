import type { Viewpoint } from '../core/types'

/** Sparse array: index = viewpoint id */
export const VIEWPOINTS: (Viewpoint | null)[] = [
  {
    id: 'panoramica',
    label: 'Panorâmica',
    index: 0,
    tag: 'Visão geral',
    title: 'Panorâmica',
    desc: 'Vista panorâmica do empreendimento.',
  },
  {
    id: 'interiores',
    label: 'Interiores',
    index: 1,
    tag: 'Por dentro',
    title: 'Interiores',
    desc: 'Ambientes internos do empreendimento.',
  },
  {
    id: 'apartamentos',
    label: 'Apartamentos',
    index: 2,
    tag: 'CRM',
    title: 'Apartamentos',
    desc: 'Unidades disponíveis do empreendimento.',
  },
  null,
  null,
  null,
  {
    id: 'parque',
    label: 'Parque',
    index: 6,
    tag: 'Área verde',
    title: 'Parque',
    desc: 'Área verde do empreendimento.',
  },
  {
    id: 'predio-1',
    label: 'Prédio 1',
    index: 7,
    tag: 'Residencial',
    title: 'Prédio 1',
    desc: 'Torre residencial principal.',
  },
  {
    id: 'portaria',
    label: 'Portaria',
    index: 8,
    tag: 'Acesso',
    title: 'Portaria',
    desc: 'Entrada principal do empreendimento.',
  },
  {
    id: 'estacionamento',
    label: 'Estacionamento',
    index: 9,
    tag: 'Infraestrutura',
    title: 'Estacionamento',
    desc: 'Vagas e acesso veicular.',
  },
]

export const TRACK_ORDER = [0, 1, 2, 6, 9, 8, 7] as const
