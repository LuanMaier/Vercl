/** Minimal DOM shell — swap this layer later without touching core/ */
export function createShell(): {
  canvas: HTMLCanvasElement
  videoA: HTMLVideoElement
  videoB: HTMLVideoElement
  transitionLoading: HTMLElement
  track: HTMLElement
  moodBar: HTMLElement
  panoModal: HTMLElement
  panoCanvas: HTMLCanvasElement
  panoBox: HTMLElement
  panoLoading: HTMLElement
} {
  document.body.innerHTML = `
    <div id="stage">
      <video id="video-a" class="transition-video" playsinline muted></video>
      <video id="video-b" class="transition-video" playsinline muted></video>
      <canvas id="seq-canvas"></canvas>
      <div id="transition-loading" aria-hidden="true">Carregando transição…</div>
    </div>
    <div id="stage-fade" aria-hidden="true"></div>
    <nav id="track" class="dock show" aria-label="Vistas">
      <div class="dock-vignette" aria-hidden="true"></div>
      <div class="dock-panel">
        <div class="dock-block">
          <p class="dock-eyebrow">Explorar o empreendimento</p>
          <div id="track-pts" class="dock-tabs" role="tablist"></div>
        </div>
      </div>
    </nav>
    <div id="mood-bar" class="show light-slider-bar" role="toolbar" aria-label="Posição do sol">
      <div class="light-slider-wrap">
        <span class="light-slider-icon light-slider-icon--day" aria-hidden="true"></span>
        <input
          type="range"
          id="light-slider"
          class="light-slider"
          min="0"
          max="1000"
          value="0"
          step="1"
          aria-label="Sol — arraste do dia à noite"
        />
        <span class="light-slider-icon light-slider-icon--night" aria-hidden="true"></span>
      </div>
    </div>
    <button type="button" id="immersive-back" class="immersive-back hidden" aria-label="Voltar ao local anterior">
      ← Voltar
    </button>
    <div id="pano-modal" aria-hidden="true">
      <div id="pano-modal-box">
        <button type="button" data-pano-close aria-label="Fechar panorama">×</button>
        <div id="pano-loading">Carregando panorama 360°</div>
        <canvas id="pano-canvas"></canvas>
      </div>
    </div>
  `

  return {
    canvas: document.getElementById('seq-canvas') as HTMLCanvasElement,
    videoA: document.getElementById('video-a') as HTMLVideoElement,
    videoB: document.getElementById('video-b') as HTMLVideoElement,
    transitionLoading: document.getElementById('transition-loading')!,
    track: document.getElementById('track')!,
    moodBar: document.getElementById('mood-bar')!,
    panoModal: document.getElementById('pano-modal')!,
    panoCanvas: document.getElementById('pano-canvas') as HTMLCanvasElement,
    panoBox: document.getElementById('pano-modal-box')!,
    panoLoading: document.getElementById('pano-loading')!,
  }
}
