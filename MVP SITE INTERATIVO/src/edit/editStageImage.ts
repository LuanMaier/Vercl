import { HIGHLIGHT_FACADE_LOADING_CLASS } from './highlightStageContext'

export type EditStageImageSetResult = 'ready' | 'hidden' | 'stale' | 'error'
export type EditStageImageLayer = 'scene' | 'facade'

const readyListeners = new Set<(layer: EditStageImageLayer) => void>()

const loadTurn: Record<EditStageImageLayer, Promise<EditStageImageSetResult>> = {
  scene: Promise.resolve('ready'),
  facade: Promise.resolve('ready'),
}

function absImageSrc(src: string): string {
  try {
    return new URL(src, location.href).href
  } catch {
    return src
  }
}

function isSameLoadedSrc(img: HTMLImageElement, src: string): boolean {
  if (!img.complete || !img.naturalWidth) return false
  const want = absImageSrc(src)
  const have = img.currentSrc || img.src
  return have === want
}

function setImageLoading(img: HTMLImageElement, loading: boolean) {
  img.classList.toggle(HIGHLIGHT_FACADE_LOADING_CLASS, loading)
}

export async function waitForEditBgReady(img: HTMLImageElement): Promise<void> {
  if (!img.getAttribute('src')) return
  try {
    if (!img.complete) {
      await new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          img.removeEventListener('load', onLoad)
          img.removeEventListener('error', onError)
          resolve()
        }
        const onError = () => {
          img.removeEventListener('load', onLoad)
          img.removeEventListener('error', onError)
          reject(new Error('Falha ao carregar imagem do stage'))
        }
        img.addEventListener('load', onLoad)
        img.addEventListener('error', onError)
      })
    }
    if (img.naturalWidth) await img.decode()
  } catch {
    /* decode opcional */
  }
}

async function applyStageImageSrc(
  img: HTMLImageElement,
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  if (!src) {
    img.removeAttribute('src')
    setImageLoading(img, false)
    return 'hidden'
  }

  const hideWhileLoading = opts?.hideWhileLoading !== false

  if (isSameLoadedSrc(img, src)) {
    setImageLoading(img, false)
    try {
      if (img.naturalWidth) await img.decode()
    } catch {
      /* ok */
    }
    return 'ready'
  }

  if (hideWhileLoading) setImageLoading(img, true)
  img.src = src

  try {
    await waitForEditBgReady(img)
  } catch {
    setImageLoading(img, false)
    return 'error'
  }

  setImageLoading(img, false)
  return 'ready'
}

function enqueueStageImageLoad(
  layer: EditStageImageLayer,
  img: HTMLImageElement,
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  const run = () => applyStageImageSrc(img, src, opts)
  const result = loadTurn[layer].then(run, run)
  loadTurn[layer] = result.catch(() => 'error' as EditStageImageSetResult)
  return result
}

export async function setSceneStageImageSrc(
  img: HTMLImageElement,
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  const outcome = await enqueueStageImageLoad('scene', img, src, opts)
  if (outcome === 'ready') notifyEditBgReady('scene')
  return outcome
}

export async function setFacadeStageImageSrc(
  img: HTMLImageElement,
  src: string | null,
  opts?: { hideWhileLoading?: boolean },
): Promise<EditStageImageSetResult> {
  const outcome = await enqueueStageImageLoad('facade', img, src, opts)
  if (outcome === 'ready') notifyEditBgReady('facade')
  return outcome
}

export function onEditBgReady(listener: (layer: EditStageImageLayer) => void): () => void {
  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}

function notifyEditBgReady(layer: EditStageImageLayer) {
  for (const listener of readyListeners) {
    try {
      listener(layer)
    } catch {
      /* listener isolado */
    }
  }
}
