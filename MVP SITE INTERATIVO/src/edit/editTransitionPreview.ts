/** Prévia de vídeo de transição no stage do editor (menu / pin). */

let activeCleanup: (() => void) | null = null

export function stopEditTransitionPreview() {
  activeCleanup?.()
  activeCleanup = null
}

export async function playEditImagePreview(src: string, host: HTMLElement): Promise<void> {
  stopEditTransitionPreview()

  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.className = 'edit-trans-preview'
    root.innerHTML = `
      <div class="edit-trans-preview-fade is-on" aria-hidden="true"></div>
      <img class="edit-trans-preview-image" alt="" />
      <button type="button" class="edit-trans-preview-close" aria-label="Fechar prévia">×</button>
    `
    host.appendChild(root)

    const fade = root.querySelector('.edit-trans-preview-fade') as HTMLElement
    const img = root.querySelector('img') as HTMLImageElement
    const closeBtn = root.querySelector('.edit-trans-preview-close') as HTMLButtonElement

    const cleanup = () => {
      root.remove()
      activeCleanup = null
      resolve()
    }
    activeCleanup = cleanup

    const finish = () => {
      fade.classList.add('is-on')
      window.setTimeout(cleanup, 280)
    }

    closeBtn.addEventListener('click', finish)
    img.addEventListener('error', cleanup)
    img.addEventListener('load', () => {
      requestAnimationFrame(() => fade.classList.remove('is-on'))
    })
    img.src = src
  })
}

export async function playEditTransitionPreview(
  src: string,
  host: HTMLElement,
): Promise<void> {
  stopEditTransitionPreview()

  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.className = 'edit-trans-preview'
    root.innerHTML = `
      <div class="edit-trans-preview-fade is-on" aria-hidden="true"></div>
      <video class="edit-trans-preview-video" playsinline muted></video>
      <button type="button" class="edit-trans-preview-close" aria-label="Fechar prévia">×</button>
    `
    host.appendChild(root)

    const fade = root.querySelector('.edit-trans-preview-fade') as HTMLElement
    const video = root.querySelector('video') as HTMLVideoElement
    const closeBtn = root.querySelector('.edit-trans-preview-close') as HTMLButtonElement

    const cleanup = () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      root.remove()
      activeCleanup = null
      resolve()
    }

    activeCleanup = cleanup

    const reveal = () => {
      fade.classList.remove('is-on')
    }

    const finish = () => {
      fade.classList.add('is-on')
      window.setTimeout(cleanup, 280)
    }

    closeBtn.addEventListener('click', finish)
    video.addEventListener('ended', finish)
    video.addEventListener('error', () => {
      cleanup()
    })

    video.src = src
    video.addEventListener(
      'playing',
      () => {
        requestAnimationFrame(() => reveal())
      },
      { once: true },
    )
    void video.play().catch(() => cleanup())
  })
}
