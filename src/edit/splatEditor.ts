import {
  removeMediaFromProject,
  saveMediaToProject,
  saveSplatsToProject,
} from '../admin/projectSave'
import {
  applySplatOverridesFile,
  buildSplatOverridesPayload,
  getEditableSplatState,
  getSplatModelPath,
  type SplatPinDefinition,
  type SplatOverridesFile,
} from '../config/splatConfig'
import { resolveMediaPath } from '../core/paths'
import { GaussianSplatViewer } from '../core/gaussianSplatViewer'
import { projectAnglesToClient } from '../core/splatSphereCoords'
import { resolveMediaSrc } from '../media/resolvePoiMedia'

type PendingPly = { file: File; previewUrl: string }
type ShowToast = (msg: string) => void

let pendingPly: PendingPly | null = null

export function hasPendingSplatPly(): boolean {
  return Boolean(pendingPly)
}

export async function flushPendingSplatPly(showToast: ShowToast): Promise<void> {
  if (!pendingPly) return
  const { path: savedPath } = await saveMediaToProject('splat-ply', pendingPly.file, {})
  URL.revokeObjectURL(pendingPly.previewUrl)
  pendingPly = null
  applySplatOverridesFile({ ...getEditableSplatState(), model: savedPath })
  showToast('PLY salvo no projeto')
}

export function initSplatEditor(deps: {
  panelEl: HTMLElement
  stageViewport: HTMLElement
  showToast: ShowToast
  onDirty: () => void
  getState: () => SplatOverridesFile
  setState: (s: SplatOverridesFile) => void
  getAvailableViews: () => number[]
  getViewLabel: (idx: number) => string
}) {
  let selectedPinId: string | null = null
  let placePinMode = false
  let viewer: GaussianSplatViewer | null = null
  let stageMounted = false
  let pinRaf = 0

  let splatHost: HTMLElement | null = null
  let splatCanvas: HTMLCanvasElement | null = null
  let splatLoading: HTMLElement | null = null
  let pinsLayer: HTMLElement | null = null

  function ensureStageDom() {
    if (splatHost) return
    splatHost = document.createElement('div')
    splatHost.id = 'edit-splat-stage'
    splatHost.className = 'edit-splat-stage'
    splatHost.hidden = true

    splatLoading = document.createElement('div')
    splatLoading.className = 'edit-splat-loading'
    splatLoading.textContent = 'Carregando Gaussian Splat…'

    splatCanvas = document.createElement('canvas')
    splatCanvas.className = 'edit-splat-canvas'
    splatCanvas.setAttribute('aria-label', 'Prévia Gaussian Splat')

    pinsLayer = document.createElement('div')
    pinsLayer.className = 'edit-splat-pins'

    splatHost.append(splatLoading, splatCanvas, pinsLayer)
    deps.stageViewport.appendChild(splatHost)
  }

  function renderPanel() {
    const state = deps.getState()
    const hasSaved = Boolean(state.model)
    const hasPending = Boolean(pendingPly)
    const pins = state.pins ?? []

    deps.panelEl.innerHTML = `
      <button type="button" class="edit-back" data-splat-back>← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <h2>Gaussian Splat</h2>
        <p class="edit-card-hint">Envie um arquivo <strong>.ply</strong> (3D Gaussian Splatting). Gire e dê zoom na prévia à direita. Pins ancoram em direções 3D no modelo.</p>
      </div>
      <div class="edit-card edit-card--stack">
        <div class="edit-field">
          <span class="edit-field-label">Modelo PLY</span>
          <span class="edit-badge ${hasPending ? 'is-warn' : hasSaved ? 'is-ok' : ''}">
            ${hasPending ? 'Prévia local' : hasSaved ? 'Salvo' : 'Pendente'}
          </span>
          <div class="edit-btn-row">
            <label class="edit-btn edit-btn--ghost">Enviar PLY<input type="file" data-splat-file accept=".ply,application/octet-stream" hidden /></label>
            <button type="button" class="edit-btn edit-btn--gold" data-splat-save-ply ${hasPending ? '' : 'disabled'}>Salvar PLY</button>
            <button type="button" class="edit-btn edit-btn--text" data-splat-clear-ply ${hasSaved || hasPending ? '' : 'disabled'}>Limpar</button>
          </div>
        </div>
        <button type="button" class="edit-btn edit-btn--ghost" data-splat-open-explorer ${hasSaved || hasPending ? '' : 'disabled'}>Abrir no explorador</button>
      </div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Pins no splat</span>
          <span class="edit-card-meta">${pins.length} pin${pins.length === 1 ? '' : 's'}</span>
        </div>
        <p class="edit-card-hint">Ative <strong>+ Colocar pin</strong> e clique na prévia. Metadados: <strong>Finalizar splat</strong>.</p>
        <div class="edit-btn-row">
          <button type="button" class="edit-btn ${placePinMode ? 'edit-btn--gold' : 'edit-btn--ghost'}" data-splat-place-pin ${hasSaved || hasPending ? '' : 'disabled'}>
            ${placePinMode ? 'Colocando pin…' : '+ Colocar pin'}
          </button>
        </div>
        <div class="edit-chips" data-splat-pin-list></div>
      </div>
      <div id="splat-pin-card" class="edit-card edit-card--fields edit-card--stack"></div>
      <button type="button" class="edit-btn edit-btn--finish" data-splat-finish>Finalizar splat</button>
    `

    const list = deps.panelEl.querySelector('[data-splat-pin-list]')!
    list.innerHTML = ''
    pins.forEach((pin) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'edit-chip' + (pin.id === selectedPinId ? ' active' : '')
      chip.textContent = pin.label
      chip.addEventListener('click', () => selectPin(pin.id))
      list.appendChild(chip)
    })

    renderPinCard()
    wirePanelEvents()
  }

  function renderPinCard() {
    const card = deps.panelEl.querySelector('#splat-pin-card') as HTMLElement | null
    if (!card) return
    const pin = deps.getState().pins?.find((p) => p.id === selectedPinId)
    if (!pin) {
      card.innerHTML = '<p class="edit-card-hint">Selecione um pin ou coloque um novo na prévia.</p>'
      return
    }
    const views = deps.getAvailableViews()
    const viewOpts = views
      .map(
        (v) =>
          `<option value="${v}" ${pin.targetView === v ? 'selected' : ''}>${deps.getViewLabel(v)}</option>`,
      )
      .join('')
    card.innerHTML = `
      <div class="edit-field">
        <label class="edit-field-label" for="splat-pin-label">Nome</label>
        <input id="splat-pin-label" class="edit-input" type="text" value="${escapeAttr(pin.label)}" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="splat-pin-tag">Tag</label>
        <input id="splat-pin-tag" class="edit-input" type="text" value="${escapeAttr(pin.tag ?? '')}" placeholder="Opcional" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="splat-pin-target">Ir para vista (opcional)</label>
        <select id="splat-pin-target" class="edit-input">
          <option value="">— nenhuma —</option>
          ${viewOpts}
        </select>
      </div>
      <button type="button" class="edit-btn edit-btn--danger" data-splat-remove-pin>Remover pin</button>
    `
    card.querySelector('#splat-pin-label')?.addEventListener('input', (e) => {
      updatePin(pin.id, { label: (e.target as HTMLInputElement).value })
    })
    card.querySelector('#splat-pin-tag')?.addEventListener('input', (e) => {
      updatePin(pin.id, { tag: (e.target as HTMLInputElement).value })
    })
    card.querySelector('#splat-pin-target')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value
      updatePin(pin.id, { targetView: v ? Number(v) : undefined })
    })
    card.querySelector('[data-splat-remove-pin]')?.addEventListener('click', () => removePin(pin.id))
  }

  function escapeAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }

  function wirePanelEvents() {
    deps.panelEl.querySelector('[data-splat-back]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('edit:splat-back'))
    })

    deps.panelEl.querySelector('[data-splat-file]')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      if (pendingPly) URL.revokeObjectURL(pendingPly.previewUrl)
      pendingPly = { file, previewUrl: URL.createObjectURL(file) }
      deps.onDirty()
      renderPanel()
      void refreshStagePreview()
    })

    deps.panelEl.querySelector('[data-splat-save-ply]')?.addEventListener('click', () => {
      void (async () => {
        await flushPendingSplatPly(deps.showToast)
        deps.onDirty()
        renderPanel()
        void refreshStagePreview()
      })()
    })

    deps.panelEl.querySelector('[data-splat-clear-ply]')?.addEventListener('click', () => {
      void (async () => {
        if (pendingPly) {
          URL.revokeObjectURL(pendingPly.previewUrl)
          pendingPly = null
        }
        const saved = getSplatModelPath()
        if (saved) await removeMediaFromProject('splat-ply', {})
        const next = { ...deps.getState(), model: null, pins: [] }
        deps.setState(next)
        selectedPinId = null
        deps.onDirty()
        renderPanel()
        void refreshStagePreview()
        deps.showToast('Modelo splat removido')
      })()
    })

    deps.panelEl.querySelector('[data-splat-open-explorer]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('explorer:open-splat'))
    })

    deps.panelEl.querySelector('[data-splat-place-pin]')?.addEventListener('click', () => {
      placePinMode = !placePinMode
      viewer?.setPinPlacement(placePinMode)
      renderPanel()
    })

    deps.panelEl.querySelector('[data-splat-finish]')?.addEventListener('click', () => {
      void persist()
    })
  }

  function updatePin(id: string, patch: Partial<SplatPinDefinition>) {
    const state = deps.getState()
    const pins = (state.pins ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p))
    deps.setState({ ...state, pins })
    deps.onDirty()
    renderPanel()
    renderStagePins()
  }

  function removePin(id: string) {
    const state = deps.getState()
    deps.setState({
      ...state,
      pins: (state.pins ?? []).filter((p) => p.id !== id),
    })
    if (selectedPinId === id) selectedPinId = null
    deps.onDirty()
    renderPanel()
    renderStagePins()
  }

  function selectPin(id: string) {
    selectedPinId = id
    renderPanel()
    renderStagePins()
  }

  function addPin(angles: { yaw: number; pitch: number }) {
    const state = deps.getState()
    const pins = [...(state.pins ?? [])]
    const n = pins.length + 1
    const pin: SplatPinDefinition = {
      id: `splat-pin-${Date.now()}`,
      label: `Pin ${n}`,
      yaw: angles.yaw,
      pitch: angles.pitch,
    }
    pins.push(pin)
    deps.setState({ ...state, pins })
    selectedPinId = pin.id
    placePinMode = false
    viewer?.setPinPlacement(false)
    deps.onDirty()
    renderPanel()
    renderStagePins()
    deps.showToast('Pin adicionado')
  }

  async function resolvePreviewUrl(): Promise<string | null> {
    if (pendingPly) return pendingPly.previewUrl
    const ref = deps.getState().model ?? getSplatModelPath()
    if (!ref) return null
    return (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
  }

  async function refreshStagePreview() {
    ensureStageDom()
    if (!splatHost || !splatCanvas || !splatLoading || !pinsLayer) return

    const url = await resolvePreviewUrl()
    if (!url) {
      splatHost.hidden = true
      viewer?.dispose()
      viewer = null
      return
    }

    splatHost.hidden = false
    if (!viewer) {
      viewer = new GaussianSplatViewer({
        host: splatHost,
        canvas: splatCanvas,
        loadingEl: splatLoading,
        pinPlacement: placePinMode,
        onClickAngles: (angles) => {
          if (placePinMode) addPin(angles)
        },
      })
      viewer.mount()
    }
    viewer.setPinPlacement(placePinMode)
    await viewer.load(url)
    renderStagePins()
    startPinLoop()
  }

  function renderStagePins() {
    if (!pinsLayer) return
    pinsLayer.innerHTML = ''
    const pins = deps.getState().pins ?? []
    for (const pin of pins) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'edit-pin edit-splat-pin' + (pin.id === selectedPinId ? ' selected' : '')
      el.dataset.id = pin.id
      el.innerHTML = `<span class="edit-pin-label">${pin.label}</span>`
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        selectPin(pin.id)
      })
      pinsLayer.appendChild(el)
    }
  }

  function startPinLoop() {
    if (pinRaf) cancelAnimationFrame(pinRaf)
    const tick = () => {
      pinRaf = requestAnimationFrame(tick)
      if (!splatHost || splatHost.hidden) return
      const camera = viewer?.getCamera()
      if (!camera || !pinsLayer) return
      const rect = splatHost.getBoundingClientRect()
      pinsLayer.querySelectorAll<HTMLElement>('.edit-splat-pin').forEach((el) => {
        const pin = deps.getState().pins?.find((p) => p.id === el.dataset.id)
        if (!pin) return
        const pos = projectAnglesToClient(camera, rect, pin.yaw, pin.pitch)
        if (!pos) {
          el.style.opacity = '0'
          return
        }
        el.style.opacity = '1'
        el.style.left = `${pos.x - rect.left}px`
        el.style.top = `${pos.y - rect.top}px`
      })
    }
    tick()
  }

  function mountStage() {
    ensureStageDom()
    if (splatHost) splatHost.hidden = false
    stageMounted = true
    void refreshStagePreview()
  }

  function unmountStage() {
    if (pinRaf) cancelAnimationFrame(pinRaf)
    pinRaf = 0
    if (splatHost) splatHost.hidden = true
    placePinMode = false
    viewer?.setPinPlacement(false)
    stageMounted = false
  }

  async function persist() {
    await flushPendingSplatPly(deps.showToast)
    const state = deps.getState()
    const model = state.model ?? getSplatModelPath() ?? null
    await saveSplatsToProject(buildSplatOverridesPayload(state.pins ?? [], model))
    deps.showToast('Splat finalizado')
  }

  renderPanel()

  return {
    renderPanel,
    mountStage,
    unmountStage,
    persist,
    isStageMounted: () => stageMounted,
    getStateSnapshot: () => deps.getState(),
  }
}

export function getEditableSplatStateFromConfig(): SplatOverridesFile {
  return getEditableSplatState()
}
