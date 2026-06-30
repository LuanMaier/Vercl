import {
  removeMediaFromProject,
  saveMediaToProject,
  saveSplatsToProject,
} from '../admin/projectSave'
import {
  applySplatOverridesFile,
  buildSplatOverridesPayload,
  DEFAULT_SPLAT_CAMERA_FLIGHT_SEC,
  DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT,
  getEditableSplatState,
  getSplatModelPath,
  type SplatPinDefinition,
  type SplatMovementLimits,
  type SplatOverridesFile,
} from '../config/splatConfig'
import { resolveMediaPath } from '../core/paths'
import { GaussianSplatViewer } from '../core/gaussianSplatViewer'
import { worldPointToPinFields, type SplatWorldPoint } from '../core/splatDepthPick'
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

  type ActivePinDrag = {
    el: HTMLElement
    pinId: string
    dragging: boolean
    startX: number
    startY: number
    lastX: number
    lastY: number
  }
  let activePinDrag: ActivePinDrag | null = null
  let pinDragListenersReady = false

  let splatHost: HTMLElement | null = null
  let splatCanvas: HTMLCanvasElement | null = null
  let splatLoading: HTMLElement | null = null

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

    splatHost.append(splatLoading, splatCanvas)
    deps.stageViewport.appendChild(splatHost)
  }

  function resolveLimits(state: SplatOverridesFile): Required<SplatMovementLimits> {
    const l = state.limits ?? {}
    return {
      zoomForwardPct: l.zoomForwardPct ?? 100,
      zoomBackwardPct: l.zoomBackwardPct ?? 100,
      orbitYawPct: l.orbitYawPct ?? 100,
      orbitPitchPct: l.orbitPitchPct ?? 100,
    }
  }

  function clampLimitPct(value: number): number {
    if (!Number.isFinite(value)) return 100
    return Math.min(100, Math.max(0, Math.round(value)))
  }

  function updateLimit(key: keyof SplatMovementLimits, raw: string) {
    const state = deps.getState()
    const limits = resolveLimits(state)
    limits[key] = clampLimitPct(Number(raw))
    deps.setState({ ...state, limits })
    viewer?.setMovementLimits(limits)
    deps.onDirty()
  }

  function resolveNavigation(state: SplatOverridesFile) {
    const zoom = state.pinFocusZoomPct
    const flight = state.cameraFlightDurationSec
    return {
      pinFocusZoomPct:
        typeof zoom === 'number' && Number.isFinite(zoom)
          ? Math.min(100, Math.max(0, Math.round(zoom)))
          : DEFAULT_SPLAT_PIN_FOCUS_ZOOM_PCT,
      cameraFlightDurationSec:
        typeof flight === 'number' && Number.isFinite(flight)
          ? Math.min(8, Math.max(0.15, Math.round(flight * 100) / 100))
          : DEFAULT_SPLAT_CAMERA_FLIGHT_SEC,
    }
  }

  function updateNavigation(patch: Partial<ReturnType<typeof resolveNavigation>>) {
    const state = deps.getState()
    const nav = { ...resolveNavigation(state), ...patch }
    deps.setState({ ...state, ...nav })
    viewer?.setNavigationSettings(nav)
    deps.onDirty()
  }

  function renderPanel() {
    const state = deps.getState()
    const hasSaved = Boolean(state.model)
    const hasPending = Boolean(pendingPly)
    const pins = state.pins ?? []
    const limits = resolveLimits(state)
    const nav = resolveNavigation(state)
    const hasStartView = Boolean(state.startView)

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
        <div class="edit-field edit-field--row">
          <label class="edit-field-label" for="splat-dock-enabled">Habilitar botão «Interativo» no menu</label>
          <input type="checkbox" id="splat-dock-enabled" ${state.dockEnabled ? 'checked' : ''} ${hasSaved ? '' : 'disabled'} />
        </div>
        <p class="edit-card-hint">Quando ativo, visitantes veem o botão <strong>Interativo</strong> na barra inferior e abrem o Gaussian Splat na tela principal.</p>
      </div>
      <div class="edit-card edit-card--stack">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Início da visualização</span>
          <span class="edit-badge ${hasStartView ? 'is-ok' : ''}">${hasStartView ? 'Posição salva' : 'Padrão do PLY'}</span>
        </div>
        <p class="edit-card-hint">Gire e dê zoom na prévia até a câmera ficar na altura e ângulo desejados (ex.: sair de «debaixo da terra»). Salve aqui — essa é a vista inicial no site. Os <strong>limites de movimento</strong> abaixo usam esta posição como referência.</p>
        <div class="edit-btn-row">
          <button type="button" class="edit-btn edit-btn--gold" data-splat-save-start ${hasSaved || hasPending ? '' : 'disabled'}>Salvar posição atual</button>
          <button type="button" class="edit-btn edit-btn--text" data-splat-reset-start ${hasStartView ? '' : 'disabled'}>Redefinir padrão</button>
        </div>
      </div>
      <div class="edit-card edit-card--fields edit-card--stack">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Navegação por pins (site)</span>
        </div>
        <p class="edit-card-hint">No explorador: <strong>clique no pin</strong> voa até ele; <strong>clique no modelo</strong> (fora do pin) volta à posição inicial salva. Clicar no mesmo pin de novo não faz nada.</p>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-pin-focus-zoom">Zoom ao clicar no pin (%)</label>
          <input id="splat-pin-focus-zoom" class="edit-input" type="number" min="0" max="100" step="1" value="${nav.pinFocusZoomPct}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-camera-flight-sec">Duração do voo (segundos)</label>
          <input id="splat-camera-flight-sec" class="edit-input" type="number" min="0.15" max="8" step="0.1" value="${nav.cameraFlightDurationSec}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
      </div>
      <div class="edit-card edit-card--fields edit-card--stack">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Limites de movimento</span>
        </div>
        <p class="edit-card-hint">Percentagens relativas à <strong>posição inicial</strong> da câmera ao carregar. <strong>100%</strong> = sem restrição. Zoom: aproximar/afastar em relação à distância inicial. Órbita: arco horizontal total de 360° ou vertical de 180°, centrado na vista inicial.</p>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-limit-zoom-forward">Zoom para frente (%)</label>
          <input id="splat-limit-zoom-forward" class="edit-input" type="number" min="0" max="100" step="1" value="${limits.zoomForwardPct}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-limit-zoom-back">Zoom para trás (%)</label>
          <input id="splat-limit-zoom-back" class="edit-input" type="number" min="0" max="100" step="1" value="${limits.zoomBackwardPct}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-limit-orbit-yaw">Órbita horizontal (%)</label>
          <input id="splat-limit-orbit-yaw" class="edit-input" type="number" min="0" max="100" step="1" value="${limits.orbitYawPct}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
        <div class="edit-field">
          <label class="edit-field-label" for="splat-limit-orbit-pitch">Órbita vertical (%)</label>
          <input id="splat-limit-orbit-pitch" class="edit-input" type="number" min="0" max="100" step="1" value="${limits.orbitPitchPct}" ${hasSaved || hasPending ? '' : 'disabled'} />
        </div>
      </div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Pins</span>
          <span class="edit-card-meta" data-splat-pin-count>${pins.length === 1 ? '1 pin' : `${pins.length} pins`}</span>
        </div>
        <p class="edit-card-hint">Clique num pin para selecionar; arraste para reposicionar no modelo 3D. <strong>+ Colocar pin</strong> e clique no PLY — o ponto é fixado na superfície do splat. Recoloque pins antigos se ainda deslizarem ao girar.</p>
        <div class="edit-chips" data-splat-pin-list></div>
        <button type="button" class="edit-btn edit-btn--danger edit-btn--danger-inline" data-splat-remove-selected ${selectedPinId ? '' : 'disabled'}>
          Remover pin selecionado
        </button>
        <div class="edit-inline-add">
          <input type="text" data-splat-new-label class="edit-input" placeholder="Nome do novo pin" />
          <button type="button" class="edit-btn edit-btn--ghost" data-splat-add-pin ${hasSaved || hasPending ? '' : 'disabled'}>+</button>
        </div>
        <div class="edit-btn-row">
          <button type="button" class="edit-btn ${placePinMode ? 'edit-btn--gold' : 'edit-btn--ghost'}" data-splat-place-pin ${hasSaved || hasPending ? '' : 'disabled'}>
            ${placePinMode ? 'Colocando pin…' : '+ Colocar pin'}
          </button>
        </div>
      </div>
      <div id="splat-pin-card" class="edit-card edit-card--fields edit-card--stack"></div>
      <button type="button" class="edit-btn edit-btn--finish" data-splat-finish>Finalizar splat</button>
    `

    const list = deps.panelEl.querySelector('[data-splat-pin-list]')!
    if (!pins.length) {
      list.innerHTML = `<span class="edit-chips-empty">Nenhum pin — use + Colocar pin na prévia</span>`
    } else {
      list.innerHTML = pins
        .map(
          (pin) =>
            `<button type="button" class="edit-chip${pin.id === selectedPinId ? ' is-on' : ''}" data-pin-id="${pin.id}">${escapeHtml(pin.label)}</button>`,
        )
        .join('')
      list.querySelectorAll<HTMLButtonElement>('[data-pin-id]').forEach((chip) => {
        chip.addEventListener('click', () => selectPin(chip.dataset.pinId!))
      })
    }

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
    card.innerHTML = `
      <div class="edit-field">
        <label class="edit-field-label" for="splat-pin-label">Nome</label>
        <input id="splat-pin-label" class="edit-input" type="text" value="${escapeAttr(pin.label)}" />
      </div>
      <code class="edit-id">id: ${escapeHtml(pin.id)}</code>
      ${
        typeof pin.x === 'number'
          ? `<p class="edit-card-hint edit-card-meta">3D: ${pin.x}, ${pin.y}, ${pin.z}</p>`
          : ''
      }
    `
    card.querySelector('#splat-pin-label')?.addEventListener('input', (e) => {
      updatePin(pin.id, { label: (e.target as HTMLInputElement).value })
    })
  }

  function escapeAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  }

  function escapeHtml(s: string) {
    return escapeAttr(s).replace(/>/g, '&gt;')
  }

  function getNewPinLabel(): string {
    const input = deps.panelEl.querySelector('[data-splat-new-label]') as HTMLInputElement | null
    const trimmed = input?.value.trim()
    if (trimmed) return trimmed
    const n = (deps.getState().pins?.length ?? 0) + 1
    return `Pin ${n}`
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
        const next = { ...deps.getState(), model: null, pins: [], startView: null }
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

    deps.panelEl.querySelector('#splat-dock-enabled')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked
      deps.setState({ ...deps.getState(), dockEnabled: checked })
      deps.onDirty()
    })

    deps.panelEl.querySelector('[data-splat-save-start]')?.addEventListener('click', () => {
      const snap = viewer?.getStartViewSnapshot()
      if (!snap) {
        deps.showToast('Carregue o PLY na prévia primeiro')
        return
      }
      deps.setState({ ...deps.getState(), startView: snap })
      deps.onDirty()
      deps.showToast('Posição inicial salva')
      renderPanel()
    })

    deps.panelEl.querySelector('[data-splat-reset-start]')?.addEventListener('click', () => {
      deps.setState({ ...deps.getState(), startView: null })
      viewer?.setStartView(null)
      deps.onDirty()
      deps.showToast('Posição inicial redefinida')
      renderPanel()
    })

    deps.panelEl.querySelector('#splat-pin-focus-zoom')?.addEventListener('change', (e) => {
      updateNavigation({
        pinFocusZoomPct: Math.min(100, Math.max(0, Math.round(Number((e.target as HTMLInputElement).value)))),
      })
    })
    deps.panelEl.querySelector('#splat-camera-flight-sec')?.addEventListener('change', (e) => {
      const raw = Number((e.target as HTMLInputElement).value)
      updateNavigation({
        cameraFlightDurationSec: Math.min(8, Math.max(0.15, Math.round(raw * 10) / 10)),
      })
    })

    deps.panelEl.querySelector('#splat-limit-zoom-forward')?.addEventListener('change', (e) => {
      updateLimit('zoomForwardPct', (e.target as HTMLInputElement).value)
    })
    deps.panelEl.querySelector('#splat-limit-zoom-back')?.addEventListener('change', (e) => {
      updateLimit('zoomBackwardPct', (e.target as HTMLInputElement).value)
    })
    deps.panelEl.querySelector('#splat-limit-orbit-yaw')?.addEventListener('change', (e) => {
      updateLimit('orbitYawPct', (e.target as HTMLInputElement).value)
    })
    deps.panelEl.querySelector('#splat-limit-orbit-pitch')?.addEventListener('change', (e) => {
      updateLimit('orbitPitchPct', (e.target as HTMLInputElement).value)
    })

    deps.panelEl.querySelector('[data-splat-place-pin]')?.addEventListener('click', () => {
      placePinMode = !placePinMode
      viewer?.setPinPlacement(placePinMode)
      renderPanel()
    })

    deps.panelEl.querySelector('[data-splat-add-pin]')?.addEventListener('click', () => {
      beginAddPin()
    })

    deps.panelEl.querySelector('[data-splat-new-label]')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault()
        beginAddPin()
      }
    })

    deps.panelEl.querySelector('[data-splat-remove-selected]')?.addEventListener('click', () => {
      if (selectedPinId) removePin(selectedPinId)
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
    if (Object.keys(patch).length === 1 && patch.label !== undefined) {
      viewer?.updatePinLabel(id, patch.label)
      const chip = deps.panelEl.querySelector(`[data-pin-id="${id}"]`)
      if (chip) chip.textContent = patch.label
      return
    }
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
    highlightPin(id, { refreshStage: true })
  }

  function highlightPin(id: string, opts?: { refreshStage?: boolean }) {
    selectedPinId = id
    viewer?.setSelectedPin(id)
    renderPanel()
    if (opts?.refreshStage !== false) renderStagePins()
  }

  function beginAddPin() {
    if (viewer?.isReady()) {
      const rect = splatHost?.getBoundingClientRect()
      if (rect) {
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const world = viewer.pointerToWorld(cx, cy, 'refined')
        if (world) {
          addPinAtWorld(world)
          return
        }
      }
    }
    placePinMode = true
    viewer?.setPinPlacement(true)
    deps.showToast('Clique no modelo 3D para fixar o pin na profundidade')
    renderPanel()
  }

  function addPinAtWorld(point: SplatWorldPoint) {
    const state = deps.getState()
    const pins = [...(state.pins ?? [])]
    const label = getNewPinLabel()
    const pin: SplatPinDefinition = {
      id: `splat-pin-${Date.now()}`,
      label,
      ...worldPointToPinFields(point),
    }
    pins.push(pin)
    deps.setState({ ...state, pins })
    selectedPinId = pin.id
    placePinMode = false
    viewer?.setPinPlacement(false)
    const labelInput = deps.panelEl.querySelector('[data-splat-new-label]') as HTMLInputElement | null
    if (labelInput) labelInput.value = ''
    deps.onDirty()
    renderPanel()
    renderStagePins()
    deps.showToast('Pin fixado no modelo 3D')
  }

  async function resolvePreviewUrl(): Promise<string | null> {
    if (pendingPly) return pendingPly.previewUrl
    const ref = deps.getState().model ?? getSplatModelPath()
    if (!ref) return null
    return (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
  }

  async function refreshStagePreview() {
    ensureStageDom()
    if (!splatHost || !splatCanvas || !splatLoading) return

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
        movementLimits: resolveLimits(deps.getState()),
        startView: deps.getState().startView ?? null,
        onClickWorld: (point) => {
          if (placePinMode) addPinAtWorld(point)
        },
      })
      viewer.mount()
    }
    viewer.setPinPlacement(placePinMode)
    viewer.setMovementLimits(resolveLimits(deps.getState()))
    viewer.setStartView(deps.getState().startView ?? null)
    viewer.setNavigationSettings(resolveNavigation(deps.getState()))
    await viewer.load(url)
    renderStagePins()
  }

  function setPinWorldPosition(pinId: string, point: SplatWorldPoint) {
    const state = deps.getState()
    const pins = (state.pins ?? []).map((p) =>
      p.id === pinId ? { ...p, ...worldPointToPinFields(point) } : p,
    )
    deps.setState({ ...state, pins })
    viewer?.setPinWorldPoint(pinId, point)
    const pin = pins.find((p) => p.id === pinId)
    if (pin) updatePinCoordsInCard(pin)
  }

  function movePinDrag(clientX: number, clientY: number) {
    if (!activePinDrag) return
    if (!activePinDrag.dragging) {
      const dx = clientX - activePinDrag.startX
      const dy = clientY - activePinDrag.startY
      if (Math.hypot(dx, dy) < 4) return
      activePinDrag.dragging = true
      activePinDrag.el.classList.add('dragging')
      viewer?.setOrbitEnabled(false)
    }
    const world = viewer?.pointerToWorld(clientX, clientY, 'fast')
    if (!world) return
    activePinDrag.lastX = clientX
    activePinDrag.lastY = clientY
    setPinWorldPosition(activePinDrag.pinId, world)
  }

  function endPinDrag() {
    if (!activePinDrag) return
    const drag = activePinDrag
    activePinDrag = null
    drag.el.classList.remove('dragging')
    viewer?.setOrbitEnabled(true)
    if (!drag.dragging) return
    const refined = viewer?.pointerToWorld(drag.lastX, drag.lastY, 'refined')
    if (refined) setPinWorldPosition(drag.pinId, refined)
    deps.onDirty()
    renderPinCard()
  }

  function updatePinCoordsInCard(pin: SplatPinDefinition) {
    if (pin.id !== selectedPinId) return
    const coords = deps.panelEl.querySelector('#splat-pin-card .edit-card-meta')
    if (coords && typeof pin.x === 'number') {
      coords.textContent = `3D: ${pin.x}, ${pin.y}, ${pin.z}`
    }
  }

  function flushActivePinDrag() {
    if (activePinDrag?.dragging) endPinDrag()
    else if (activePinDrag) {
      activePinDrag.el.classList.remove('dragging')
      activePinDrag = null
      viewer?.setOrbitEnabled(true)
    }
  }

  function ensurePinDragListeners() {
    if (pinDragListenersReady) return
    pinDragListenersReady = true
    document.addEventListener('mousemove', (e) => movePinDrag(e.clientX, e.clientY))
    document.addEventListener('mouseup', () => endPinDrag())
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!activePinDrag) return
        e.preventDefault()
        movePinDrag(e.touches[0].clientX, e.touches[0].clientY)
      },
      { passive: false },
    )
    document.addEventListener('touchend', () => endPinDrag())
  }

  function makePinDraggable(el: HTMLElement, pinId: string) {
    ensurePinDragListeners()
    const startDrag = (clientX: number, clientY: number) => {
      if (selectedPinId !== pinId) {
        highlightPin(pinId, { refreshStage: false })
        viewer?.setSelectedPin(pinId)
        el.classList.add('selected')
      }
      activePinDrag = {
        el,
        pinId,
        dragging: false,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastY: clientY,
      }
    }
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      startDrag(e.clientX, e.clientY)
    })
    el.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        startDrag(e.touches[0].clientX, e.touches[0].clientY)
      },
      { passive: false },
    )
  }

  function renderStagePins() {
    if (!viewer?.isReady()) return
    const pins = deps.getState().pins ?? []
    viewer.setPins(pins, {
      mode: 'editor',
      selectedId: selectedPinId,
      onPinClick: (pin) => {
        if (activePinDrag?.dragging) return
        selectPin(pin.id)
      },
      onPinElement: (el, pin) => makePinDraggable(el, pin.id),
    })
  }

  function mountStage() {
    ensureStageDom()
    if (splatHost) splatHost.hidden = false
    stageMounted = true
    void refreshStagePreview()
  }

  function unmountStage() {
    flushActivePinDrag()
    if (splatHost) splatHost.hidden = true
    placePinMode = false
    viewer?.setPinPlacement(false)
    stageMounted = false
  }

  async function persist() {
    await flushPendingSplatPly(deps.showToast)
    const state = deps.getState()
    const model = state.model ?? getSplatModelPath() ?? null
    await saveSplatsToProject(
      buildSplatOverridesPayload(
        state.pins ?? [],
        model,
        state.dockEnabled,
        resolveLimits(state),
        state.startView ?? null,
        resolveNavigation(state),
      ),
    )
    deps.showToast('Splat finalizado')
  }

  renderPanel()

  return {
    renderPanel,
    mountStage,
    unmountStage,
    persist,
    flushActivePinDrag,
    isStageMounted: () => stageMounted,
    getStateSnapshot: () => deps.getState(),
  }
}

export function getEditableSplatStateFromConfig(): SplatOverridesFile {
  return getEditableSplatState()
}
