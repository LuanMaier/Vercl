export type PlayState = 'idle' | 'playing'

export type LightMode = 'day' | 'sunset' | 'night'

export type Viewpoint = {
  id: string
  label: string
  index: number
  tag: string
  title: string
  desc: string
  /** Vídeo ao clicar neste botão do menu — `/media/...` */
  transitionVideo?: string
  /** Imagem ao clicar neste botão do menu — `/images/...` */
  transitionImage?: string
  /** Motion blur na transição ao clicar neste botão do menu */
  motionBlur?: boolean
  /** Exibe botão Rollback no site após tocar o vídeo deste botão */
  videoRollback?: boolean
  /** Mídia ao chegar na vista: imagem fixa, vídeo one-shot ou loop */
  menuMediaMode?: 'image' | 'video' | 'loop'
}

export type FrameSequence = {
  type?: 'sequence'
  base: string
  count: number
  pad?: number
  ext?: string
  fps?: number
  reverse?: boolean
}

export type VideoTransition = {
  type: 'video'
  src: string
  mobileSrc?: string
  poster?: string
}

export type TransitionConfig = FrameSequence | VideoTransition

export function isVideoTransition(t: TransitionConfig): t is VideoTransition {
  return t.type === 'video'
}

export function isSequenceTransition(t: TransitionConfig): t is FrameSequence {
  return t.type !== 'video'
}

export type PoiDefinition = {
  id: string
  label: string
  x: number
  y: number
  tag: string
  title: string
  desc: string
  /** Vista para onde navegar ao clicar; card abre ao chegar */
  targetView?: number
  /** Thumbnail do card — caminho `/images/...` ou `poi-media://id/img` */
  img?: string
  /** Vídeo da transição ao clicar — `/media/...` ou `poi-media://id/video` */
  transitionVideo?: string
  panorama360?: string
  /** Apartamentos: % sobre a foto (object-fit cover); omitido = legado % do stage */
  coordSpace?: 'image' | 'stage'
  /** Highlights: x/y no centro do quadrado (não na ponta inferior) */
  highlightAnchor?: 'center'
  /** Editor: trava arraste na prévia */
  positionLocked?: boolean
  /** Efeito de motion blur na transição ao clicar neste pin */
  motionBlur?: boolean
  /** Exibe botão Rollback no site após tocar o vídeo deste pin */
  videoRollback?: boolean
  /** Card / imagem final: imagem fixa, loop após transição ou só loop (sem transição) */
  cardMediaMode?: 'image' | 'loop' | 'loop-direct'
  /** Pin filho — posicionado na imagem final (`img`) do pin pai */
  parentId?: string
}

export type NavStep = { from: number; to: number }

export type JumpOptions = {
  transitionVideo?: VideoTransition
  /** Imagem full-screen na transição do menu — caminho em /public */
  transitionImage?: string
  /** Fade preto/reveal — só aba Panorâmica do dock */
  panoramaFade?: boolean
  /** Fade padronizado ao clicar nos botões do menu inferior */
  menuFade?: boolean
  /** Motion blur na transição (definido pelo pin) */
  motionBlur?: boolean
  /** Imagem do pin no canvas ao terminar o vídeo de transição */
  poiEndImage?: string
  /** Grava estado para o botão Rollback manual no site */
  videoRollback?: boolean
  /** POI ativo ao terminar o vídeo — habilita pins filhos na imagem final */
  immersivePoiId?: string
}

export function edgeKey(from: number, to: number) {
  return `${from}_${to}`
}
