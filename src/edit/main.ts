import '../styles/explorer.css'
import './edit.css'
import { clearSession, getSessionUsername, requireAuth, verifyCredentials } from '../auth/adminAuth'
import { getHeroRef, setHeroRef } from '../config/heroConfig'
import { POSTERS } from '../config/posters'
import { clearPoiOverrides, getEditablePoisMap, getEditableChildPoisMap } from '../config/poiConfig'
import { POIS_BY_VIEW } from '../config/pois'
import { resolveMediaPath } from '../core/paths'
import {
  isPanoramaImageCoordSpace,
  loadPosterImageMetrics,
  migratePanoramaPinToImageCoords,
  panoramaPinStagePct,
  pointerToPanoramaImagePct,
} from '../core/panoramaPinLayout'
import { PANORAMA_VIEW } from '../core/panoramaFade'
import type { PoiDefinition } from '../core/types'
import {
  finishInsolationSettings,
  flushAllInsolationPending,
  getPendingSolarFrameInitialSrc,
  renderInsolationPanel,
  resolveSolarFrameInitialSrc,
  hasInsolationPending,
} from './insolationPanel'
import {
  getAvailableViewIndices,
  addViewToMainMenu,
  createCustomViewpoint,
  getEditableDockState,
  getViewpoint,
  isProtectedView,
  isViewOnMainMenu,
  removeViewpointFromProject,
} from '../config/pointsConfig'
import { TRACK_ORDER, VIEWPOINTS } from '../config/points'
import { getEditableInteriorsState } from '../config/interiorsConfig'
import { getEditableApartmentsState, getFacadeApartmentId } from '../config/apartmentsConfig'
import { CRM_UNITS_VERSION_KEY, reloadCrmUnits } from '../config/crmConfig'
import {
  isProjectSaveAvailable,
  removeMediaFromProject,
  resetProjectOverrides,
  saveDockToProject,
  saveMediaToProject,
  savePoisMapToProject,
  saveScenesToProject,
  saveViewIdleModeToProject,
} from '../admin/projectSave'
import {
  getProjectMenuImagePath,
  getProjectMenuLoopVideoPath,
  getProjectPoiImagePath,
  getProjectPoiLoopVideoPath,
  getProjectPoiVideoPath,
  getProjectViewLoopPath,
  getViewIdleMode,
  isPoiLoopDirect,
  notifyProjectUpdated,
  reloadProjectFiles,
} from '../config/projectMedia'
import { captureVideoPosterObjectUrl } from '../core/apartmentFaceMedia'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import {
  captureEditBaselines,
  initEditDirtyProbe,
  isAnyTabDirty,
  isTabDirty,
  refreshEditTabDirtyIndicators,
  refreshGlobalSaveButton,
  type EditTab,
} from './editDirtyState'
import {
  flushPendingSplatPly,
  getEditableSplatStateFromConfig,
  hasPendingSplatPly,
  initSplatEditor,
} from './splatEditor'
import type { SplatOverridesFile } from '../config/splatConfig'
import {
  cloneDockState,
  flushAllPendingMenuMedia,
  hasPendingMenuVideos,
  initDockEditor,
  type DockEditorState,
} from './dockEditor'
import { hasPendingBookMedia, initBookEditor, type BookEditorState } from './bookEditor'
import {
  initApartmentsEditor,
  hasPendingApartmentMedia,
  resolveApartmentFacadePreviewSrc,
  type ApartmentsEditorState,
} from './apartmentsEditor'
import { getEditableApartmentPoisMap } from '../config/apartmentPoiConfig'
import {
  type ApartmentOutlinesEditorState,
  getEditableApartmentOutlinesState,
} from '../config/apartmentOutlinesConfig'
import {
  hasPendingApartmentPinMedia,
  initApartmentPinsEditor,
  type ApartmentPoisEditorState,
} from './apartmentPinsEditor'
import {
  flashSceneHero,
  getFacadeCoverImage,
  getFacadeStageImage,
  getSceneCoverImage,
  initEditStageController,
  loadFacadeImage,
  loadSceneImage,
  onStageImageReady,
  setActiveStageLayer,
} from './editStageController'
import { waitForHighlightFacadeReady } from './highlightStageContext'
import { installEditErrorBoundary } from './editErrorBoundary'
import {
  initEditStageViewport,
  setActiveEditStageViewport,
  type EditStageViewportHandle,
} from './editStageViewport'

if (!requireAuth()) {
  throw new Error('auth required')
}

const VIEW_OPTIONS = () =>
  getAvailableViewIndices().map((idx) => ({
    idx,
    label: getViewpoint(idx)?.label ?? VIEWPOINTS[idx]?.label ?? `Vista ${idx}`,
  }))

let poisMap = getEditablePoisMap()
let poisChildrenMap: Record<string, PoiDefinition[]> = getEditableChildPoisMap()
let currentView = 0
/** Pin pai cuja imagem final está sendo usada para posicionar pins filhos. */
let childEditPath: string[] = []

function getChildEditParentId(): string | null {
  return childEditPath.length ? childEditPath[childEditPath.length - 1] : null
}

function childEditBreadcrumb(): string {
  return childEditPath
    .map((id) => findPoiByIdInEditor(id)?.label ?? id)
    .join(' › ')
}

function isPoiOnScene(poi: PoiDefinition): boolean {
  for (const list of Object.values(poisMap)) {
    if (list.some((p) => p.id === poi.id)) return true
  }
  return false
}
/** Título do painel Pin — fixo na seleção; não muda ao editar campos do pin. */
let frozenPoiPanelTitle: string | null = null
let selectedId: string | null = null
/** Vista onde o pin selecionado está salvo (pode diferir de currentView ao ver destino). */
let selectedPoiView: number | null = null
let activeTab: EditTab = 'scene'

function findSelectedPoi(): PoiDefinition | undefined {
  if (!selectedId) return undefined
  if (getChildEditParentId()) {
    return (poisChildrenMap[getChildEditParentId()!] ?? []).find((p) => p.id === selectedId)
  }
  const owner = selectedPoiView ?? currentView
  return (poisMap[owner] ?? []).find((p) => p.id === selectedId)
}

function syncProjectMediaToChildPoisMap(map: Record<string, PoiDefinition[]>) {
  for (const list of Object.values(map)) {
    for (const poi of list) {
      const img = getProjectPoiImagePath(poi.id)
      const vid = getProjectPoiVideoPath(poi.id)
      if (img) poi.img = img
      else if (!pendingPoiCardImg[poi.id]) delete poi.img
      if (vid) poi.transitionVideo = vid
      else if (!pendingPoiVideo[poi.id]) delete poi.transitionVideo
    }
  }
}

function syncProjectMediaToPoisMap(map: Record<number, PoiDefinition[]>) {
  for (const list of Object.values(map)) {
    for (const poi of list) {
      const img = getProjectPoiImagePath(poi.id)
      const vid = getProjectPoiVideoPath(poi.id)
      if (img) poi.img = img
      else if (!pendingPoiCardImg[poi.id]) delete poi.img
      if (vid) poi.transitionVideo = vid
      else if (!pendingPoiVideo[poi.id]) delete poi.transitionVideo
    }
  }
}

function syncProjectMediaToApartmentPois(map: ApartmentPoisEditorState) {
  for (const list of Object.values(map)) {
    for (const poi of list) {
      const img = getProjectPoiImagePath(poi.id)
      const vid = getProjectPoiVideoPath(poi.id)
      if (img) poi.img = img
      if (vid) poi.transitionVideo = vid
    }
  }
}

/** Atualização leve após Salvar (mídia no disco) — não troca aba, vista nem seleção do menu. */
async function refreshAfterLocalMediaSave(
  scope: 'hero' | 'poi',
  opts: { viewIndex?: number; poi?: PoiDefinition } = {},
) {
  markEditDirty()
  if (scope === 'hero' && opts.viewIndex !== undefined) {
    if (activeTab !== 'apartments' && currentView === opts.viewIndex) {
      await refreshStageBackground(opts.viewIndex)
      if (activeTab === 'scene') await renderHeroPanel(opts.viewIndex)
    }
    return
  }
  if (scope === 'poi' && opts.poi) {
    if (getChildEditParentId() === opts.poi.id) {
      await refreshChildEditBackground(opts.poi.id)
      renderPins()
    }
    await updatePoiCard(opts.poi)
  }
}


function syncAptSubtabsVisibility() {
  const subtabs = document.getElementById('apt-edit-subtabs')
  if (subtabs) subtabs.hidden = apartmentsState.length === 0
}

function setAptSubtab(sub: AptSubtab) {
  activeAptSub = sub
  aptPinsEditor.onParentSubtabChange(sub)
  document.querySelectorAll<HTMLButtonElement>('.edit-apt-subtab').forEach((btn) => {
    const s = btn.dataset.aptSub as AptSubtab
    btn.classList.toggle('active', s === sub)
    btn.setAttribute('aria-selected', s === sub ? 'true' : 'false')
  })
  const unitPanel = document.getElementById('apartments-unit-panel')!
  const pinsPanel = document.getElementById('apartments-pins-panel')!
  unitPanel.hidden = sub !== 'unit'
  pinsPanel.hidden = sub !== 'pins'

  if (sub === 'pins') {
    ensureHighlightStageResizeObserver()
    aptPinsEditor.setSubtab('pins')
    stageViewportController?.refresh()
    void refreshHighlightEditorStage()
  } else {
    aptPinsEditor.setSubtab('unit')
    aptPinsEditor.clearStagePins()
    stageViewportController?.resetView()
    stageViewportController?.refresh()
    const aptId = apartmentsEditor.getSelectedUnitId()
    if (aptId) void refreshApartmentStagePreview(aptId)
  }
}

function refreshStageForTab() {
  if (activeTab === 'splat') {
    editStage.querySelectorAll('.edit-pin:not(.edit-apt-pin)').forEach((el) => el.remove())
    aptPinsEditor.clearStagePins()
    setActiveStageLayer('scene')
    stageViewportController?.resetView()
    splatEditor.mountStage()
    return
  }
  splatEditor.unmountStage()

  if (activeTab === 'apartments') {
    setActiveStageLayer('facade')
    editStage.querySelectorAll('.edit-pin:not(.edit-apt-pin)').forEach((el) => el.remove())
    syncAptSubtabsVisibility()
    if (activeAptSub === 'pins') {
      ensureHighlightStageResizeObserver()
      stageViewportController?.refresh()
      void refreshHighlightEditorStage()
    } else {
      aptPinsEditor.clearStagePins()
      stageViewportController?.resetView()
      stageViewportController?.refresh()
      const aptId = apartmentsEditor.getSelectedUnitId()
      if (aptId) void refreshApartmentStagePreview(aptId)
      else void loadFacadeImage(null)
    }
  } else {
    setActiveStageLayer('scene')
    aptPinsEditor.clearStagePins()
    if (getChildEditParentId()) {
      void refreshChildEditBackground(getChildEditParentId()!).then(() => renderPins())
    } else {
      void refreshStageBackground(getStageViewIndex())
      renderPins()
    }
  }
}

/** Aplica no editor tudo que foi gravado no disco (Salvar no projeto / sync externo). */
async function applyAllProjectChanges(opts: { loadFromDisk?: boolean } = {}) {
  const { loadFromDisk = true } = opts

  const keepTab = activeTab
  const keepView = currentView
  const keepDockView = dockEditor.getSelectedView()
  const keepPoiView = selectedPoiView
  const keepFrozenPoi = frozenPoiPanelTitle
  const keepSelectedId = selectedId
  const bookSel = bookEditor.getSelectedAmbienteId()
  const aptSel = apartmentsEditor.getSelectedUnitId()
  const keepAptSub = activeAptSub

  const keepPois = loadFromDisk ? null : (JSON.parse(JSON.stringify(poisMap)) as Record<number, PoiDefinition[]>)
  const keepDock = loadFromDisk ? null : cloneDockState(dockState)
  const keepBook = loadFromDisk ? null : (JSON.parse(JSON.stringify(bookState)) as BookEditorState)
  const keepApartments = loadFromDisk
    ? null
    : (JSON.parse(JSON.stringify(apartmentsState)) as ApartmentsEditorState)
  const keepAptPois = loadFromDisk
    ? null
    : (JSON.parse(JSON.stringify(apartmentPoisState)) as ApartmentPoisEditorState)
  const keepAptOutlines = loadFromDisk
    ? null
    : (JSON.parse(JSON.stringify(apartmentOutlinesState)) as ApartmentOutlinesEditorState)

  await reloadProjectFiles()

  if (loadFromDisk) {
    poisMap = getEditablePoisMap()
    poisChildrenMap = getEditableChildPoisMap()
    dockState = cloneDockState(getEditableDockState())
    bookState = getEditableInteriorsState()
    apartmentsState = getEditableApartmentsState()
    apartmentPoisState = getEditableApartmentPoisMap()
    apartmentOutlinesState = getEditableApartmentOutlinesState()
    splatState = getEditableSplatStateFromConfig()
    splatEditor.renderPanel()
  } else {
    poisMap = keepPois!
    syncProjectMediaToPoisMap(poisMap)
    syncProjectMediaToChildPoisMap(poisChildrenMap)
    dockState = keepDock!
    bookState = keepBook!
    apartmentsState = keepApartments!
    apartmentPoisState = keepAptPois!
    apartmentOutlinesState = keepAptOutlines!
  }

  currentView = keepView
  refreshViewSelectOptions(keepView)
  selectedPoiView = keepPoiView
  frozenPoiPanelTitle = keepFrozenPoi
  selectedId = keepSelectedId

  dockEditor.renderAll()
  if (keepDockView !== null) dockEditor.selectDockTab(keepDockView)
  bookEditor.renderAll()
  if (bookSel && bookState.some((i) => i.id === bookSel)) {
    bookEditor.selectAmbiente(bookSel)
  }
  apartmentsEditor.renderAll()
  if (aptSel && apartmentsState.some((i) => i.id === aptSel)) {
    apartmentsEditor.selectUnit(aptSel)
  }
  setAptSubtab(keepAptSub)

  setActiveTab(keepTab)
  refreshStageForTab()
  await renderHeroPanel(currentView)
  if (activeTab === 'insolation') refreshInsolationPanel()
  if (activeTab !== 'apartments') {
    renderPins()
    renderPinList()
  }
  if (selectedId) {
    const poi = findSelectedPoi()
    if (poi) void updatePoiCard(poi)
    else clearPoiSelection()
  }
  markEditDirty()
}

const EDIT_TABS: EditTab[] = ['scene', 'poi', 'insolation', 'menu', 'book', 'apartments', 'splat']
const EDIT_SAVED_FLAG = 'edit-project-saved'

/** Salva concluído — recarrega o editor com JSON e mídias frescos do disco. */
function reloadEditorAfterProjectSave() {
  const url = new URL(location.href)
  url.searchParams.set('view', String(currentView))
  url.searchParams.set('tab', activeTab)

  const aptId = apartmentsEditor.getSelectedUnitId()
  if (aptId) url.searchParams.set('apt', aptId)
  else url.searchParams.delete('apt')

  if (activeAptSub === 'pins') url.searchParams.set('aptSub', 'pins')
  else url.searchParams.delete('aptSub')

  const bookId = bookEditor.getSelectedAmbienteId()
  if (bookId) url.searchParams.set('book', bookId)
  else url.searchParams.delete('book')

  const dockView = dockEditor.getSelectedView()
  if (dockView !== null) url.searchParams.set('dock', String(dockView))
  else url.searchParams.delete('dock')

  sessionStorage.setItem(EDIT_SAVED_FLAG, '1')
  skipNextProjectUpdated = true
  notifyProjectUpdated()
  location.replace(url.toString())
}

let skipNextProjectUpdated = false

let dockState: DockEditorState = getEditableDockState()
let bookState: BookEditorState = getEditableInteriorsState()
let apartmentsState: ApartmentsEditorState = getEditableApartmentsState()
let splatState: SplatOverridesFile = getEditableSplatStateFromConfig()
let apartmentPoisState: ApartmentPoisEditorState = getEditableApartmentPoisMap()
let aptPinsEditor!: ReturnType<typeof initApartmentPinsEditor>
let splatEditor!: ReturnType<typeof initSplatEditor>
let stageViewportController: EditStageViewportHandle | null = null

let apartmentOutlinesState: ApartmentOutlinesEditorState = getEditableApartmentOutlinesState()

type AptSubtab = 'unit' | 'pins'
let activeAptSub: AptSubtab = 'unit'


type PendingMedia = { file: File; previewUrl: string }
const pendingHeroByView: Record<number, PendingMedia> = {}
const pendingViewLoopByView: Record<number, PendingMedia> = {}
const pendingPoiCardImg: Record<string, PendingMedia> = {}
const pendingPoiVideo: Record<string, PendingMedia> = {}
const pendingPoiLoopVideo: Record<string, PendingMedia> = {}

const stage = document.createElement('div')
stage.className = 'edit-stage-wrap'

const stageZoomBar = document.createElement('div')
stageZoomBar.className = 'edit-stage-zoom-bar'
stageZoomBar.id = 'edit-stage-zoom-bar'
stageZoomBar.hidden = true
stageZoomBar.innerHTML = `
  <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="btn-stage-zoom-out" title="Diminuir zoom">−</button>
  <span class="edit-stage-zoom-label" id="edit-stage-zoom-label">100%</span>
  <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="btn-stage-zoom-in" title="Aumentar zoom">+</button>
  <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="btn-stage-zoom-focus" title="Focar no highlight (F)">Focar</button>
  <button type="button" class="edit-btn edit-btn--ghost edit-btn--sm" id="btn-stage-zoom-reset" title="Visão geral (Esc)">100%</button>
`

const stageViewport = document.createElement('div')
stageViewport.id = 'edit-stage-viewport'
stageViewport.className = 'edit-stage-viewport'

const editStageInner = document.createElement('div')
editStageInner.id = 'edit-stage'
initEditStageController(editStageInner)
stageViewport.appendChild(editStageInner)
stage.appendChild(stageViewport)

const stagePinBackBtn = document.createElement('button')
stagePinBackBtn.type = 'button'
stagePinBackBtn.id = 'edit-stage-pin-back'
stagePinBackBtn.className = 'edit-stage-back hidden'
stagePinBackBtn.textContent = '← Voltar à cena'
stagePinBackBtn.setAttribute('aria-label', 'Voltar à cena')
stage.appendChild(stagePinBackBtn)
stage.appendChild(stageZoomBar)

const sidebar = document.createElement('aside')
sidebar.className = 'edit-sidebar'
sidebar.innerHTML = `
  <header class="edit-head">
    <div class="edit-head-top">
      <h1>Editor</h1>
      <a href="/" class="edit-head-link">Site</a>
    </div>
    <p class="edit-head-note">Requer <strong>npm run dev</strong> para gravar arquivos no projeto.</p>
    <p class="edit-workflow-hint"><strong>Salvar</strong> (botão dourado) = arquivo no disco na hora · <strong>Finalizar [aba]</strong> = textos, ordem e JSON · <strong>Salvar no projeto</strong> = grava tudo e recarrega o editor. Abas com bolinha âmbar têm alterações pendentes.</p>
  </header>
  <nav class="edit-tabs" role="tablist" aria-label="Painéis">
    <button type="button" class="edit-tab active" data-tab="scene" role="tab">Cena</button>
    <button type="button" class="edit-tab" data-tab="poi" role="tab">Pin</button>
    <button type="button" class="edit-tab" data-tab="insolation" role="tab">Posição Solar</button>
    <button type="button" class="edit-tab" data-tab="menu" role="tab">Menu</button>
    <button type="button" class="edit-tab" data-tab="book" role="tab">Book</button>
    <button type="button" class="edit-tab" data-tab="apartments" role="tab">Apartamentos</button>
    <button type="button" class="edit-tab" data-tab="splat" role="tab">Gaussian Splat</button>
  </nav>
  <div class="edit-scroll">
    <section id="panel-scene" class="edit-panel active" role="tabpanel">
      <div class="edit-card">
        <span class="edit-card-kicker">Vista</span>
        <select id="view-select" class="edit-input"></select>
        <div class="edit-scene-actions">
          <button type="button" class="edit-btn edit-btn--ghost" id="btn-scene-add" title="Só no editor — não entra no menu do site">Adicionar cena</button>
          <button type="button" class="edit-btn edit-btn--gold" id="btn-scene-add-hero" title="Cria e adiciona botão no menu inferior">Adicionar cena hero</button>
        </div>
        <button type="button" class="edit-btn edit-btn--text" id="btn-scene-add-menu" hidden>Adicionar ao menu principal</button>
        <button type="button" class="edit-btn edit-btn--danger" id="btn-scene-remove" disabled>Excluir cena</button>
        <p class="edit-card-hint" id="scene-menu-hint">Use <strong>Adicionar cena hero</strong> para criar como Praia ou Portaria: botão no menu, HERO, pins e mídia de transição.</p>
      </div>
      <div id="edit-hero-panel" class="edit-card"></div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Pins</span>
          <span class="edit-card-meta" id="pin-count"></span>
        </div>
        <p class="edit-card-hint">Clique num pin para selecionar. Imagens/vídeos: <strong>Salvar</strong> no disco · metadados: <strong>Finalizar pin</strong>.</p>
        <div id="edit-pin-list" class="edit-chips"></div>
        <button type="button" class="edit-btn edit-btn--danger edit-btn--danger-inline" id="btn-pin-remove" disabled>
          Remover pin selecionado
        </button>
        <div class="edit-inline-add">
          <input type="text" id="new-label" class="edit-input" placeholder="Nome do novo pin" />
          <button type="button" class="edit-btn edit-btn--ghost" id="btn-add">+</button>
        </div>
      </div>
    </section>
    <section id="panel-poi" class="edit-panel" role="tabpanel" hidden>
      <button type="button" class="edit-back" id="btn-back-scene">← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <div class="edit-pin-head-row">
          <h2 id="poi-tab-title">Pin</h2>
          <button type="button" id="poi-position-lock" class="edit-lock-btn" hidden
            aria-label="Travar posição na prévia" title="Travar posição na prévia"></button>
        </div>
        <code id="poi-tab-id" class="edit-id"></code>
      </div>
      <div id="poi-card" class="edit-card edit-card--fields"></div>
      <button type="button" class="edit-btn edit-btn--finish" id="btn-poi-finish" disabled>Finalizar pin</button>
      <button type="button" class="edit-btn edit-btn--danger" id="btn-delete" disabled>Remover pin</button>
    </section>
    <section id="panel-insolation" class="edit-panel" role="tabpanel" hidden>
      <button type="button" class="edit-back" id="btn-back-scene-insolation">← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <h2>Posição Solar</h2>
        <p class="edit-card-hint">Vídeo + frame inicial (dia) + frame final (noite). Arquivos: <strong>Salvar</strong> · confirmação: <strong>Finalizar posição solar</strong>.</p>
      </div>
      <div id="edit-insolation-panel" class="edit-card edit-card--stack"></div>
      <button type="button" class="edit-btn edit-btn--finish" id="btn-insolation-finish">Finalizar posição solar</button>
    </section>
    <section id="panel-menu" class="edit-panel" role="tabpanel" hidden>
      <button type="button" class="edit-back" id="btn-back-scene-menu">← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <h2 id="dock-tab-title">Menu inferior</h2>
        <p class="edit-card-hint">Mesma aparência do site — <strong>arraste</strong> para ordem. Mídia (vídeo ou imagem): <strong>Salvar</strong> · nome/tag/blur: <strong>Finalizar menu</strong>. <strong>▶</strong> = mídia customizada.</p>
      </div>
      <div class="edit-card edit-card--dock-preview">
        <div id="edit-dock-preview" class="edit-dock-preview"></div>
      </div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Botões</span>
          <span class="edit-card-meta" id="dock-count"></span>
        </div>
        <div id="edit-dock-list" class="edit-chips"></div>
        <div class="edit-inline-add">
          <input type="text" id="dock-new-label" class="edit-input" placeholder="Nome do botão" />
          <button type="button" class="edit-btn edit-btn--ghost" id="btn-dock-add">+</button>
        </div>
      </div>
      <div id="dock-card" class="edit-card edit-card--fields"></div>
      <button type="button" class="edit-btn edit-btn--finish" id="btn-menu-finish">Finalizar menu</button>
      <button type="button" class="edit-btn edit-btn--danger" id="btn-dock-remove" disabled>Remover do menu</button>
      <p class="edit-card-hint edit-card-hint--spaced">Ambientes do book: aba <strong>Book</strong> · unidades CRM: aba <strong>Apartamentos</strong>.</p>
    </section>
    <section id="panel-book" class="edit-panel" role="tabpanel" hidden>
      <button type="button" class="edit-back" id="btn-back-scene-book">← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <h2>Book do empreendimento</h2>
        <p class="edit-card-desc">Cada ambiente = um capítulo em <strong>Interiores</strong>. Mídia: <strong>Salvar</strong> · textos e ordem: <strong>Finalizar book</strong>.</p>
      </div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Ambientes</span>
          <span class="edit-card-meta" id="book-ambiente-count"></span>
        </div>
        <p class="edit-card-hint">Clique para editar; <strong>arraste</strong> para a ordem. <strong>▶</strong> = mídia na prévia ou salva.</p>
        <div id="edit-book-list" class="edit-book-dock-wrap"></div>
        <div class="edit-inline-add">
          <input type="text" id="book-new-ambiente" class="edit-input" placeholder="Nome do ambiente" />
          <button type="button" class="edit-btn edit-btn--ghost" id="btn-book-add">+</button>
        </div>
      </div>
      <div id="book-card" class="edit-card edit-card--fields edit-card--stack"></div>
      <button type="button" class="edit-btn edit-btn--finish" id="btn-book-finish">Finalizar book</button>
      <button type="button" class="edit-btn edit-btn--danger" id="btn-book-remove" disabled>Remover ambiente</button>
    </section>
    <section id="panel-apartments" class="edit-panel" role="tabpanel" hidden>
      <button type="button" class="edit-back" id="btn-back-scene-apartments">← Voltar à cena</button>
      <div class="edit-card edit-card--pin-head">
        <h2>Menu Apartamentos (CRM)</h2>
        <p class="edit-card-desc">Cada botão = uma unidade no submenu de <strong>Apartamentos</strong>. Mídia: <strong>Salvar</strong> · textos e ordem: <strong>Finalizar apartamentos</strong>.</p>
        <p class="edit-card-hint edit-card-hint--spaced">CRM: planilha <strong>public/crm/unidades.xlsx</strong> — célula <span style="color:#e74c3c">vermelha</span> (vendido), <span style="color:#f1c40f">amarela</span> (reservado) ou preto/branco (disponível). Renomeie cada highlight com o <strong>código da unidade</strong> (ex.: 1102) — a cor do retângulo segue o Excel no editor e no site.</p>
        <button type="button" class="edit-btn edit-btn--ghost" id="btn-sync-crm">Atualizar CRM do Excel</button>
      </div>
      <div class="edit-card">
        <div class="edit-card-row">
          <span class="edit-card-kicker">Unidades</span>
          <span class="edit-card-meta" id="apartments-unit-count"></span>
        </div>
        <p class="edit-card-hint">Clique para editar; <strong>arraste</strong> para a ordem. <strong>▶</strong> = mídia na prévia ou salva.</p>
        <div id="edit-apartments-list" class="edit-apartments-dock-wrap"></div>
        <div class="edit-inline-add">
          <input type="text" id="apartments-new-unit" class="edit-input" placeholder="Nome da unidade" />
          <button type="button" class="edit-btn edit-btn--ghost" id="btn-apartments-add">+</button>
        </div>
      </div>
      <div id="apartments-card" class="edit-card edit-card--fields edit-card--stack"></div>
      <div class="edit-apt-subtabs" id="apt-edit-subtabs" role="tablist" hidden>
        <button type="button" class="edit-apt-subtab active" data-apt-sub="unit" role="tab" aria-selected="true">Unidade</button>
        <button type="button" class="edit-apt-subtab" data-apt-sub="pins" role="tab" aria-selected="false">Highlights</button>
      </div>
      <div id="apartments-unit-panel">
        <button type="button" class="edit-btn edit-btn--finish" id="btn-apartments-finish">Finalizar apartamentos</button>
        <button type="button" class="edit-btn edit-btn--danger" id="btn-apartments-remove" disabled>Remover unidade</button>
      </div>
      <div id="apartments-pins-panel" hidden>
        <div class="edit-card">
          <div class="edit-card-row">
            <span class="edit-card-kicker">Highlights na face</span>
            <span class="edit-card-meta" id="apt-pin-count">0 pins</span>
          </div>
          <p class="edit-card-hint">Clique no <strong>retângulo</strong> para mover · seleção múltipla na lista · <strong>Ctrl+C/V</strong> copiar/colar · <strong>Ctrl+Z</strong> desfazer · <strong>F</strong> focar.</p>
          <div id="edit-apt-pin-list" class="edit-pin-list"></div>
          <div class="edit-inline-add">
            <input type="text" id="apt-new-pin" class="edit-input" placeholder="Nome do pin" />
            <button type="button" class="edit-btn edit-btn--ghost" id="btn-apt-pin-add">+</button>
          </div>
        </div>
        <div id="apt-pin-card" class="edit-card edit-card--fields edit-card--stack"></div>
        <button type="button" class="edit-btn edit-btn--finish" id="btn-apt-pins-finish">Finalizar highlights</button>
        <button type="button" class="edit-btn edit-btn--danger" id="btn-apt-pin-remove" disabled>Remover pin</button>
      </div>
    </section>
    <section id="panel-splat" class="edit-panel" role="tabpanel" hidden>
      <div id="edit-splat-panel"></div>
    </section>
  </div>
  <footer class="edit-foot">
    <button type="button" class="edit-btn edit-btn--primary" id="btn-save">Salvar no projeto</button>
    <div class="edit-foot-row">
      <button type="button" class="edit-btn edit-btn--ghost" id="btn-reset">Resetar</button>
      <button type="button" class="edit-btn edit-btn--ghost" id="btn-logout">Sair</button>
    </div>
  </footer>
`

const toast = document.createElement('div')
toast.className = 'edit-toast'
toast.id = 'toast'

document.body.appendChild(sidebar)
document.body.appendChild(stage)
document.body.appendChild(toast)

const viewSelect = document.getElementById('view-select') as HTMLSelectElement
const btnSceneAdd = document.getElementById('btn-scene-add') as HTMLButtonElement
const btnSceneAddHero = document.getElementById('btn-scene-add-hero') as HTMLButtonElement
const btnSceneAddMenu = document.getElementById('btn-scene-add-menu') as HTMLButtonElement
const btnSceneRemove = document.getElementById('btn-scene-remove') as HTMLButtonElement
const sceneMenuHint = document.getElementById('scene-menu-hint') as HTMLParagraphElement
const heroPanel = document.getElementById('edit-hero-panel')!
const insolationPanel = document.getElementById('edit-insolation-panel')!
const poiCard = document.getElementById('poi-card')!
const editStage = document.getElementById('edit-stage')!
const btnDelete = document.getElementById('btn-delete') as HTMLButtonElement
const btnPoiFinish = document.getElementById('btn-poi-finish') as HTMLButtonElement
const btnSave = document.getElementById('btn-save') as HTMLButtonElement

function syncPoiFinishButton() {
  btnPoiFinish.disabled = !isTabDirty('poi')
}

function markEditDirty() {
  refreshEditTabDirtyIndicators()
  syncPoiFinishButton()
  refreshGlobalSaveButton(btnSave)
}

const btnPinRemove = document.getElementById('btn-pin-remove') as HTMLButtonElement



const newLabelInput = document.getElementById('new-label') as HTMLInputElement
const pinListEl = document.getElementById('edit-pin-list')!
const poiTabTitle = document.getElementById('poi-tab-title')!
const poiTabId = document.getElementById('poi-tab-id')!
const panelScene = document.getElementById('panel-scene')!
const panelPoi = document.getElementById('panel-poi')!
const panelInsolation = document.getElementById('panel-insolation')!
const panelMenu = document.getElementById('panel-menu')!
const panelBook = document.getElementById('panel-book')!
const panelApartments = document.getElementById('panel-apartments')!
const panelSplat = document.getElementById('panel-splat')!
const pinCountEl = document.getElementById('pin-count')!

const poiPositionLockBtn = document.getElementById('poi-position-lock') as HTMLButtonElement

const LOCK_ICON_OPEN = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 10V8a5 5 0 0 1 9.9-1h-2.1A3 3 0 0 0 9 8v2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm0 2v8h10v-8H7z"/></svg>`
const LOCK_ICON_CLOSED = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 11V8a5 5 0 0 1 10 0v1h-2V8a3 3 0 0 0-6 0v3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/></svg>`

function syncPoiLockButton(poi: PoiDefinition | null) {
  if (!poi) {
    poiPositionLockBtn.hidden = true
    return
  }
  poiPositionLockBtn.hidden = false
  const locked = Boolean(poi.positionLocked)
  poiPositionLockBtn.classList.toggle('is-locked', locked)
  poiPositionLockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false')
  poiPositionLockBtn.setAttribute(
    'aria-label',
    locked ? 'Destravar posição na prévia' : 'Travar posição na prévia',
  )
  poiPositionLockBtn.title = locked
    ? 'Destravar — permite arrastar o pin'
    : 'Travar — impede mover o pin ao clicar'
  poiPositionLockBtn.innerHTML = locked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN
}

poiPositionLockBtn.addEventListener('click', async () => {
  const poi = findSelectedPoi()
  if (!poi) return
  poi.positionLocked = !poi.positionLocked
  syncPoiLockButton(poi)
  renderPins()
  void updatePoiCard(poi)
  markEditDirty()
  showToast(
    poi.positionLocked
      ? 'Posição travada — Finalizar pin'
      : 'Posição liberada — Finalizar pin',
  )
})

btnPoiFinish.addEventListener('click', async () => {
  try {
    await flushAllPendingPoiMedia()
    await persistPoisMapToProject()
    captureEditBaselines()
    markEditDirty()
    showToast('Pin salvo no projeto')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
})

document.getElementById('btn-menu-finish')!.addEventListener('click', async () => {
  try {
    if (!dockEditor.flushCardEdits()) return
    await flushAllPendingMenuMedia()
    await saveDockToProject(dockState.trackOrder, dockState.viewpoints, { reload: false })
    captureEditBaselines()
    markEditDirty()
    showToast('Menu salvo no projeto')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
})

document.getElementById('btn-insolation-finish')!.addEventListener('click', async () => {
  try {
    await finishInsolationSettings(currentView, showToast)
    captureEditBaselines()
    markEditDirty()
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
})

document.getElementById('btn-book-finish')!.addEventListener('click', () => {
  void bookEditor.finish().then(
    () => {
      captureEditBaselines()
      markEditDirty()
    },
    () => {
      markEditDirty()
    },
  )
})

document.getElementById('btn-apartments-finish')!.addEventListener('click', () => {
  void apartmentsEditor.finish().then(
    () => {
      captureEditBaselines()
      markEditDirty()
    },
    () => {
      markEditDirty()
    },
  )
})

function syncStagePinBackButton() {
  const inChildEdit = Boolean(getChildEditParentId())
  const show = inChildEdit || Boolean(selectedId)
  stagePinBackBtn.classList.toggle('hidden', !show)
  if (inChildEdit) {
    const label = childEditPath.length > 1 ? '← Voltar' : '← Voltar à cena'
    stagePinBackBtn.textContent = label
    stagePinBackBtn.setAttribute(
      'aria-label',
      childEditPath.length > 1 ? 'Voltar ao nível anterior' : 'Voltar à cena',
    )
  } else {
    stagePinBackBtn.textContent = '← Voltar à cena'
    stagePinBackBtn.setAttribute('aria-label', 'Voltar à cena')
  }
}

function handleStagePinBack() {
  if (getChildEditParentId() && selectedId) {
    selectedId = null
    const parentId = getChildEditParentId()!
    frozenPoiPanelTitle = `Filhos · ${findPoiByIdInEditor(parentId)?.label ?? parentId}`
    poiTabTitle.textContent = frozenPoiPanelTitle
    poiTabId.textContent = childEditBreadcrumb()
    renderPins()
    renderPinList()
    syncPoiLockButton(null)
    syncPinRemoveButtons()
    void updatePoiCard(null)
    syncStagePinBackButton()
    return
  }
  if (getChildEditParentId()) {
    if (childEditPath.length > 1) popChildEditLevel()
    else exitChildEditMode()
    return
  }
  clearPoiSelection()
  setActiveTab('scene')
}

function setActiveTab(tab: EditTab) {
  activeTab = tab

  document.querySelectorAll('.edit-tab').forEach((el) => {
    const btn = el as HTMLButtonElement
    const t = btn.dataset.tab as EditTab
    btn.classList.toggle('active', t === tab)
    btn.setAttribute('aria-selected', t === tab ? 'true' : 'false')
  })

  panelScene.classList.toggle('active', tab === 'scene')
  panelScene.hidden = tab !== 'scene'
  panelPoi.classList.toggle('active', tab === 'poi')
  panelPoi.hidden = tab !== 'poi'
  panelInsolation.classList.toggle('active', tab === 'insolation')
  panelInsolation.hidden = tab !== 'insolation'
  panelMenu.classList.toggle('active', tab === 'menu')
  panelMenu.hidden = tab !== 'menu'
  panelBook.classList.toggle('active', tab === 'book')
  panelBook.hidden = tab !== 'book'
  panelApartments.classList.toggle('active', tab === 'apartments')
  panelApartments.hidden = tab !== 'apartments'
  panelSplat.classList.toggle('active', tab === 'splat')
  panelSplat.hidden = tab !== 'splat'
  sidebar.classList.toggle(
    'is-poi-tab',
    tab === 'poi' ||
      tab === 'insolation' ||
      tab === 'menu' ||
      tab === 'book' ||
      tab === 'apartments' ||
      tab === 'splat',
  )
  document.body.classList.toggle('edit-splat-tab', tab === 'splat')
  markEditDirty()
  refreshStageForTab()
  syncStagePinBackButton()
}




function refreshInsolationPanel() {
  void renderInsolationPanel(insolationPanel, currentView, showToast, () => {
    void refreshStageBackground(currentView)
  }, markEditDirty)
}

function syncPinRemoveButtons() {
  const on = Boolean(selectedId)
  btnDelete.disabled = !on
  btnPinRemove.disabled = !on
}

function updatePoiPinSelectionVisual() {
  editStage.querySelectorAll<HTMLElement>('.edit-pin:not(.edit-apt-pin)').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === selectedId)
    const poi =
      getChildEditParentId() && selectedId
        ? (poisChildrenMap[getChildEditParentId()!] ?? []).find((p) => p.id === selectedId)
        : (poisMap[currentView] ?? []).find((p) => p.id === el.dataset.id)
    el.classList.toggle('is-locked', Boolean(poi?.positionLocked))
  })
}

function highlightChildPoi(poi: PoiDefinition) {
  selectedId = poi.id
  selectedPoiView = null
  frozenPoiPanelTitle = poi.label
  updatePoiPinSelectionVisual()
  renderPinList()
  poiTabTitle.textContent = frozenPoiPanelTitle
  poiTabId.textContent = getChildEditParentId() ? childEditBreadcrumb() : ''
  syncPoiLockButton(poi)
  syncPinRemoveButtons()
}

function highlightPoi(poi: PoiDefinition, opts?: { refreshStage?: boolean }) {
  selectedId = poi.id
  const ownerView = currentView
  selectedPoiView = ownerView
  frozenPoiPanelTitle = poi.label
  if (opts?.refreshStage === false) updatePoiPinSelectionVisual()
  else renderPins()
  renderPinList()
  poiTabTitle.textContent = frozenPoiPanelTitle
  poiTabId.textContent = `id: ${poi.id}`
  syncPoiLockButton(poi)
  syncPinRemoveButtons()
}

function selectPoi(poi: PoiDefinition) {
  if (getChildEditParentId()) {
    highlightChildPoi(poi)
    setActiveTab('poi')
    void updatePoiCard(poi)
    return
  }
  highlightPoi(poi)
  setActiveTab('poi')
  const selected = findSelectedPoi()
  if (selected) void updatePoiCard(selected)
}

function clearPoiSelection() {
  selectedId = null
  selectedPoiView = null
  frozenPoiPanelTitle = null
  renderPins()
  renderPinList()
  poiTabTitle.textContent = 'Pin'
  poiTabId.textContent = ''
  syncPoiLockButton(null)
  syncPinRemoveButtons()
  syncStagePinBackButton()
  if (activeTab === 'poi') void updatePoiCard(null)
}

function renderPinList() {
  if (getChildEditParentId()) {
    const pois = poisChildrenMap[getChildEditParentId()!] ?? []
    pinCountEl.textContent =
      pois.length === 1 ? '1 pin filho' : `${pois.length} pins filhos`
    if (!pois.length) {
      pinListEl.innerHTML = `<span class="edit-chips-empty">Nenhum pin filho — use + na prévia</span>`
      return
    }
    pinListEl.innerHTML = pois
      .map(
        (p) =>
          `<button type="button" class="edit-chip${p.id === selectedId ? ' is-on' : ''}" data-poi-id="${p.id}">${p.label}</button>`,
      )
      .join('')
    pinListEl.querySelectorAll<HTMLButtonElement>('.edit-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const poi = pois.find((p) => p.id === btn.dataset.poiId)
        if (poi) highlightChildPoi(poi)
      })
    })
    syncPinRemoveButtons()
    return
  }

  const pois = poisMap[getStageViewIndex()] ?? []
  pinCountEl.textContent = pois.length === 1 ? '1 pin' : `${pois.length} pins`

  if (!pois.length) {
    pinListEl.innerHTML = `<span class="edit-chips-empty">Nenhum pin nesta vista</span>`
    return
  }

  pinListEl.innerHTML = pois
    .map((p) => {
      const childN = (poisChildrenMap[p.id] ?? []).length
      const childBadge = childN > 0 ? ` <span class="edit-chip-meta">+${childN} filho${childN > 1 ? 's' : ''}</span>` : ''
      return `<button type="button" class="edit-chip${p.id === selectedId ? ' is-on' : ''}" data-poi-id="${p.id}">${p.label}${childBadge}</button>`
    })
    .join('')

  pinListEl.querySelectorAll<HTMLButtonElement>('.edit-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const poi = pois.find((p) => p.id === btn.dataset.poiId)
      if (poi) highlightPoi(poi)
    })
  })
  syncPinRemoveButtons()
}

document.querySelectorAll('.edit-tab').forEach((el) => {
  el.addEventListener('click', () => {
    const tab = (el as HTMLElement).dataset.tab as EditTab
    if (tab === 'poi' && !selectedId) {
      const pois = poisMap[getStageViewIndex()] ?? []
      if (pois.length) {
        selectPoi(pois[0])
        return
      }
      setActiveTab('poi')
      void updatePoiCard(null)
      return
    }
    if (tab === 'poi' && selectedId) {
      const poi = findSelectedPoi()
      if (poi) void updatePoiCard(poi)
    }
    if (tab === 'insolation') refreshInsolationPanel()
    if (tab === 'menu') {
      dockEditor.renderAll()
    }
    if (tab === 'book') bookEditor.renderAll()
    if (tab === 'apartments') {
      apartmentsEditor.renderAll()
      syncAptSubtabsVisibility()
    }
    setActiveTab(tab)
  })
})

stagePinBackBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  handleStagePinBack()
})

document.getElementById('btn-back-scene')!.addEventListener('click', () => setActiveTab('scene'))
document.getElementById('btn-back-scene-menu')!.addEventListener('click', () => setActiveTab('scene'))
document.getElementById('btn-back-scene-book')!.addEventListener('click', () => setActiveTab('scene'))
document.getElementById('btn-back-scene-apartments')!.addEventListener('click', () =>
  setActiveTab('scene'),
)

function installEditDirtyProbe() {
  initEditDirtyProbe({
    poisMap: () => poisMap,
    dockState: () => dockState,
    bookState: () => bookState,
    apartmentsState: () => apartmentsState,
    apartmentPoisState: () => apartmentPoisState,
    apartmentOutlinesState: () => apartmentOutlinesState,
    hasPendingHero: () =>
      Object.keys(pendingHeroByView).length > 0 || Object.keys(pendingViewLoopByView).length > 0,
    hasPendingPoiMedia: () =>
      Object.keys(pendingPoiCardImg).length > 0 ||
      Object.keys(pendingPoiVideo).length > 0 ||
      Object.keys(pendingPoiLoopVideo).length > 0,
    hasPendingMenuVideo: hasPendingMenuVideos,
    hasPendingBookMedia: hasPendingBookMedia,
    hasPendingApartmentMedia: hasPendingApartmentMedia,
    hasPendingApartmentPinMedia: hasPendingApartmentPinMedia,
    hasInsolationPending,
    splatState: () => splatState,
    hasPendingSplatPly,
  })
}

installEditDirtyProbe()

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    installEditDirtyProbe()
    captureEditBaselines()
    markEditDirty()
  })
}

const dockEditor = initDockEditor({
  previewEl: document.getElementById('edit-dock-preview')!,
  chipListEl: document.getElementById('edit-dock-list')!,
  cardEl: document.getElementById('dock-card')!,
  previewHost: stage,
  tabTitle: document.getElementById('dock-tab-title')!,
  removeBtn: document.getElementById('btn-dock-remove') as HTMLButtonElement,
  newLabelInput: document.getElementById('dock-new-label') as HTMLInputElement,
  addBtn: document.getElementById('btn-dock-add') as HTMLButtonElement,
  showToast,
  onDirty: markEditDirty,
  onViewSelect: (idx) => {
    if (idx !== currentView) switchViewContext(idx, { skipTabSwitch: true })
  },
  getState: () => dockState,
  setState: (s) => {
    dockState = s
    const countEl = document.getElementById('dock-count')
    if (countEl) {
      const n = dockState.trackOrder.length
      countEl.textContent = n === 1 ? '1 botão' : `${n} botões`
    }
    markEditDirty()
  },
})

dockEditor.renderAll()
document.getElementById('btn-back-scene-insolation')!.addEventListener('click', () => setActiveTab('scene'))

const bookEditor = initBookEditor({
  ambienteListEl: document.getElementById('edit-book-list')!,
  ambienteCountEl: document.getElementById('book-ambiente-count')!,
  cardEl: document.getElementById('book-card')!,
  newAmbienteInput: document.getElementById('book-new-ambiente') as HTMLInputElement,
  addAmbienteBtn: document.getElementById('btn-book-add') as HTMLButtonElement,
  removeAmbienteBtn: document.getElementById('btn-book-remove') as HTMLButtonElement,
  showToast,
  onDirty: markEditDirty,
  getState: () => bookState,
  setState: (s) => {
    bookState = s
    markEditDirty()
  },
})


const apartmentsEditor = initApartmentsEditor({
  unitListEl: document.getElementById('edit-apartments-list')!,
  unitCountEl: document.getElementById('apartments-unit-count')!,
  cardEl: document.getElementById('apartments-card')!,
  newUnitInput: document.getElementById('apartments-new-unit') as HTMLInputElement,
  addUnitBtn: document.getElementById('btn-apartments-add') as HTMLButtonElement,
  removeUnitBtn: document.getElementById('btn-apartments-remove') as HTMLButtonElement,
  showToast,
  onDirty: markEditDirty,
  onUnitSelected: (id) => {
    stageViewportController?.resetView()
    stageViewportController?.refresh()
    aptPinsEditor?.onUnitChanged()
    if (activeTab !== 'apartments') return
    if (activeAptSub === 'pins') {
      void refreshApartmentHighlightPreview().then(() => syncHighlightStageLayout())
    } else {
      aptPinsEditor?.clearStagePins()
      void (id ? refreshApartmentStagePreview(id) : loadFacadeImage(null))
    }
  },
  onUnitRemoved: (id) => {
    const removedPins = apartmentPoisState[id] ?? []
    const nextPois = { ...apartmentPoisState }
    delete nextPois[id]
    apartmentPoisState = nextPois
    const nextOutlines = { ...apartmentOutlinesState, byPin: { ...apartmentOutlinesState.byPin } }
    for (const pin of removedPins) delete nextOutlines.byPin[pin.id]
    apartmentOutlinesState = nextOutlines
    aptPinsEditor?.onUnitChanged()
    markEditDirty()
  },
  getState: () => apartmentsState,
  setState: (s) => {
    apartmentsState = s
    markEditDirty()
  },
})

aptPinsEditor = initApartmentPinsEditor({
  editStage,
  pinListEl: document.getElementById('edit-apt-pin-list')!,
  pinCardEl: document.getElementById('apt-pin-card')!,
  pinCountEl: document.getElementById('apt-pin-count')!,
  subPanelUnit: document.getElementById('apartments-unit-panel')!,
  subPanelPins: document.getElementById('apartments-pins-panel')!,
  subtabBtns: document.querySelectorAll<HTMLButtonElement>(
    '.edit-apt-subtab[data-apt-sub="unit"], .edit-apt-subtab[data-apt-sub="pins"]',
  ),
  newPinInput: document.getElementById('apt-new-pin') as HTMLInputElement,
  addPinBtn: document.getElementById('btn-apt-pin-add') as HTMLButtonElement,
  removePinBtn: document.getElementById('btn-apt-pin-remove') as HTMLButtonElement,
  finishBtn: document.getElementById('btn-apt-pins-finish') as HTMLButtonElement,
  showToast,
  onDirty: markEditDirty,
  getPoisState: () => apartmentPoisState,
  setPoisState: (s) => {
    apartmentPoisState = s
    markEditDirty()
  },
  getSelectedApartmentId: () => apartmentsEditor.getSelectedUnitId(),
  getApartmentsState: () => apartmentsState,
  getOutlinesState: () => apartmentOutlinesState,
  setOutlinesState: (s) => {
    apartmentOutlinesState = s
    markEditDirty()
  },
  onPreviewRefresh: () => {
    if (activeTab !== 'apartments') return
    if (activeAptSub === 'pins') void refreshApartmentHighlightPreview()
    else {
      const aptId = apartmentsEditor.getSelectedUnitId()
      if (aptId) void refreshApartmentStagePreview(aptId)
    }
  },
  onAptSubtabChange: (sub) => setAptSubtab(sub),
  shouldShowStagePins: () => activeTab === 'apartments' && activeAptSub === 'pins',
})

splatEditor = initSplatEditor({
  panelEl: document.getElementById('edit-splat-panel')!,
  stageViewport: stageViewport,
  showToast,
  onDirty: markEditDirty,
  getState: () => splatState,
  setState: (s) => {
    splatState = s
    markEditDirty()
  },
  getAvailableViews: () => getAvailableViewIndices(),
  getViewLabel: (idx) => getViewpoint(idx)?.label ?? `Vista ${idx}`,
})

window.addEventListener('edit:splat-back', () => setActiveTab('scene'))

stageViewportController = initEditStageViewport({
  viewportEl: stageViewport,
  stageEl: editStageInner,
  toolbarEl: stageZoomBar,
  zoomLabelEl: document.getElementById('edit-stage-zoom-label')!,
  getImageSize: () => {
    const img = getFacadeCoverImage() ?? getFacadeStageImage()
    if (!img?.naturalWidth) return null
    return { w: img.naturalWidth, h: img.naturalHeight }
  },
  getFocusBbox: () => aptPinsEditor?.getSelectedOutlineBbox() ?? null,
  isEnabled: () => activeTab === 'apartments' && activeAptSub === 'pins',
  onViewChange: () => syncHighlightStageLayout(),
})
setActiveEditStageViewport(stageViewportController)

document.getElementById('btn-stage-zoom-in')!.addEventListener('click', () => {
  stageViewportController?.zoomIn()
})
document.getElementById('btn-stage-zoom-out')!.addEventListener('click', () => {
  stageViewportController?.zoomOut()
})
document.getElementById('btn-stage-zoom-focus')!.addEventListener('click', () => {
  aptPinsEditor?.focusViewportOnSelected()
})
document.getElementById('btn-stage-zoom-reset')!.addEventListener('click', () => {
  stageViewportController?.resetView()
})

window.addEventListener('resize', () => {
  stageViewportController?.refresh()
  if (activeTab === 'apartments' && activeAptSub === 'pins') {
    syncHighlightStageLayout()
  }
})

document.getElementById('btn-apt-pins-finish')!.addEventListener('click', () => {
  void aptPinsEditor.finish().then(() => {
    captureEditBaselines()
    markEditDirty()
  }).catch((e) => {
    showToast(e instanceof Error ? e.message : 'Use npm run dev para salvar highlights')
  })
})

document.getElementById('btn-sync-crm')!.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/sync-crm', { method: 'POST' })
    if (!res.ok) throw new Error('Falha ao sincronizar CRM')
    const data = (await res.json()) as { count?: number }
    await reloadCrmUnits()
    aptPinsEditor?.refreshCrmPreview()
    showToast(`CRM do Excel atualizado — ${data.count ?? 0} unidades`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
})

window.addEventListener('storage', (e) => {
  if (e.key !== CRM_UNITS_VERSION_KEY) return
  void reloadCrmUnits().then(() => aptPinsEditor?.refreshCrmPreview())
})

dockEditor.renderAll()

editStage.addEventListener('click', () => {
  if (activeTab === 'apartments') return
  if (selectedId) handleStagePinBack()
})

function refreshSceneMenuControls(viewIndex: number) {
  btnSceneRemove.disabled = isProtectedView(viewIndex)
  const onMenu = isViewOnMainMenu(viewIndex)
  const canAddMenu = !onMenu && !isProtectedView(viewIndex) && Boolean(getViewpoint(viewIndex))
  btnSceneAddMenu.hidden = !canAddMenu
  if (onMenu && !isProtectedView(viewIndex)) {
    sceneMenuHint.textContent =
      'Esta cena está no menu inferior do site — configure HERO, pins e mídia de transição na aba Menu.'
  } else if (isProtectedView(viewIndex)) {
    sceneMenuHint.textContent =
      'Panorâmica e hubs (Interiores, Apartamentos) são fixos no menu.'
  } else {
    sceneMenuHint.textContent =
      'Use Adicionar cena hero para criar como Praia ou Portaria. Adicionar cena fica só no editor; depois use "Adicionar ao menu principal" se quiser.'
  }
}

function refreshViewSelectOptions(preferredIndex?: number) {
  const prev = preferredIndex ?? currentView
  viewSelect.innerHTML = ''
  for (const { idx, label } of VIEW_OPTIONS()) {
    const opt = document.createElement('option')
    opt.value = String(idx)
    const menuTag = isViewOnMainMenu(idx) ? ' · menu' : ''
    opt.textContent = `${label}${menuTag} (índice ${idx})`
    viewSelect.appendChild(opt)
  }
  const indices = getAvailableViewIndices()
  const next = indices.includes(prev) ? prev : indices[0] ?? 0
  viewSelect.value = String(next)
  refreshSceneMenuControls(next)
  if (next !== currentView) switchViewContext(next, { skipTabSwitch: true })
}

refreshViewSelectOptions(currentView)

function promptSceneLabel(heroMenu: boolean): string | null {
  const label = prompt(
    heroMenu ? 'Nome da nova cena hero (vai para o menu):' : 'Nome da nova cena:',
  )?.trim()
  return label || null
}

async function commitNewScene(heroMenu: boolean) {
  const label = promptSceneLabel(heroMenu)
  if (!label) return
  try {
    const idx = createCustomViewpoint(label, { heroMenu })
    if (!poisMap[idx]) poisMap[idx] = []
    await saveScenesToProject({ reload: false })
    dockState = cloneDockState(getEditableDockState())
    dockEditor.renderAll()
    refreshViewSelectOptions(idx)
    switchViewContext(idx)
    markEditDirty()
    showToast(
      heroMenu
        ? `Cena hero "${label}" criada — botão no menu. Envie HERO e pins.`
        : `Cena "${label}" criada (índice ${idx}) — só no editor`,
    )
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

btnSceneAdd.addEventListener('click', () => {
  void commitNewScene(false)
})

btnSceneAddHero.addEventListener('click', () => {
  void commitNewScene(true)
})

btnSceneAddMenu.addEventListener('click', () => {
  void (async () => {
    try {
      addViewToMainMenu(currentView)
      await saveScenesToProject({ reload: false })
      dockState = cloneDockState(getEditableDockState())
      dockEditor.renderAll()
      refreshViewSelectOptions(currentView)
      markEditDirty()
      showToast('Cena adicionada ao menu inferior')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })()
})

btnSceneRemove.addEventListener('click', () => {
  void (async () => {
    const idx = currentView
    const vp = getViewpoint(idx)
    if (isProtectedView(idx)) {
      showToast('Esta cena não pode ser removida')
      return
    }
    const pinCount = (poisMap[idx] ?? []).length
    const msg = pinCount
      ? `Excluir a cena "${vp?.label ?? idx}" e ${pinCount} pin(s)?`
      : `Excluir a cena "${vp?.label ?? idx}"?`
    if (!confirm(msg)) return
    try {
      delete poisMap[idx]
      removeViewpointFromProject(idx)
      await saveScenesToProject({ reload: false })
      if (pinCount) {
        await savePoisMapToProject(poisMap, { reload: false, byParent: poisChildrenMap })
      }
      dockState = cloneDockState(getEditableDockState())
      dockEditor.renderAll()
      const fallback = getAvailableViewIndices().find((i) => i !== idx) ?? 0
      refreshViewSelectOptions(fallback)
      switchViewContext(fallback)
      markEditDirty()
      showToast('Cena removida do projeto')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })()
})

function showToast(msg: string) {
  toast.textContent = msg
  toast.classList.add('show')
  setTimeout(() => toast.classList.remove('show'), 2200)
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function getEditStageCoverImage(): HTMLImageElement | null {
  return getSceneCoverImage()
}

function getHighlightStageCoverImage(): HTMLImageElement | null {
  return getFacadeCoverImage()
}

function handleEditStageImageReady(layer: 'scene' | 'facade') {
  if (layer === 'facade' && activeTab === 'apartments' && activeAptSub === 'pins') {
    void waitForHighlightFacadeReady().then(() => {
      if (!getHighlightStageCoverImage()) return
      aptPinsEditor.syncStageLayout()
    })
    return
  }
  if (
    layer === 'scene' &&
    (activeTab === 'scene' ||
      activeTab === 'poi' ||
      activeTab === 'insolation' ||
      activeTab === 'menu' ||
      activeTab === 'book')
  ) {
    void migratePanoramaPinsForView(getStageViewIndex()).then(() => renderPins())
  }
}

function initEditStageImageSystem() {
  installEditErrorBoundary()
  onStageImageReady((layer) => handleEditStageImageReady(layer))
}

/** Recalcula geometria dos highlights após layout/zoom estabilizar. */
function syncHighlightStageLayout() {
  requestAnimationFrame(() => {
    stageViewportController?.refresh()
    requestAnimationFrame(() => {
      if (activeTab === 'apartments' && activeAptSub === 'pins') {
        aptPinsEditor?.syncStageLayout()
      }
    })
  })
}

let highlightStageResizeObserver: ResizeObserver | null = null

function ensureHighlightStageResizeObserver() {
  if (highlightStageResizeObserver) return
  highlightStageResizeObserver = new ResizeObserver(() => {
    if (activeTab === 'apartments' && activeAptSub === 'pins') {
      syncHighlightStageLayout()
    }
  })
  highlightStageResizeObserver.observe(stageViewport)
}

async function migratePanoramaPinsForView(viewIndex: number) {
  const list = poisMap[viewIndex]
  if (!list?.length) return
  const img = getEditStageCoverImage()
  if (!img) return
  const rect = editStage.getBoundingClientRect()
  let dirty = false
  for (const poi of list) {
    if (
      migratePanoramaPinToImageCoords(
        poi,
        rect.width,
        rect.height,
        img.naturalWidth,
        img.naturalHeight,
      )
    ) {
      dirty = true
    }
  }
  if (dirty) {
    commitPoisMapView(viewIndex)
    markEditDirty()
  }
}

async function migrateAllPanoramaPinsBeforeSave() {
  const rect = editStage.getBoundingClientRect()
  for (const idx of getAvailableViewIndices()) {
    const list = poisMap[idx]
    if (!list?.length) continue
    const src =
      idx === 0
        ? await resolveSolarFrameInitialSrc(idx)
        : (await resolveMediaSrc(getHeroRef(idx) ?? POSTERS[idx] ?? '')) ??
          resolveMediaPath(getHeroRef(idx) ?? POSTERS[idx] ?? '')
    if (!src) continue
    const metrics = await loadPosterImageMetrics(src)
    if (!metrics) continue
    for (const poi of list) {
      migratePanoramaPinToImageCoords(poi, rect.width, rect.height, metrics.w, metrics.h)
    }
    commitPoisMapView(idx)
  }
}

function applyPanoramaPinPosition(el: HTMLElement, poi: PoiDefinition) {
  const img = getEditStageCoverImage()
  const rect = editStage.getBoundingClientRect()
  if (img && isPanoramaImageCoordSpace(poi)) {
    const pos = panoramaPinStagePct(
      poi,
      rect.width,
      rect.height,
      img.naturalWidth,
      img.naturalHeight,
    )
    if (pos) {
      el.style.left = `${pos.x}%`
      el.style.top = `${pos.y}%`
      return
    }
  }
  el.style.left = `${poi.x}%`
  el.style.top = `${poi.y}%`
}

function commitPoisMapView(viewIndex: number) {
  const list = poisMap[viewIndex]
  if (!list?.length) return
  poisMap = {
    ...poisMap,
    [viewIndex]: list.map((p) => ({
      ...p,
      x: round1(p.x),
      y: round1(p.y),
    })),
  }
}

function commitAllPoisMapViews() {
  for (const idx of getAvailableViewIndices()) {
    commitPoisMapView(idx)
  }
}

async function persistPoisMapToProject() {
  flushActivePinDrag()
  aptPinsEditor.flushActiveDrag()
  await migrateAllPanoramaPinsBeforeSave()
  commitAllPoisMapViews()
  commitAllChildPoisMaps()
  syncProjectMediaToPoisMap(poisMap)
  syncProjectMediaToChildPoisMap(poisChildrenMap)
  await savePoisMapToProject(poisMap, { reload: false, byParent: poisChildrenMap })
}

function flushActivePinDrag() {
  if (activePinDrag?.dragging) endPinDrag()
}










function slugChildId(label: string, parentId: string) {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  let id = `${parentId}-${base || 'filho'}`
  let n = 1
  const ids = new Set<string>()
  for (const list of Object.values(poisChildrenMap)) {
    for (const p of list) ids.add(p.id)
  }
  while (ids.has(id)) {
    id = `${parentId}-${base || 'filho'}-${n++}`
  }
  return id
}

function slugId(label: string, viewIndex: number) {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  let id = `v${viewIndex}-${base || 'pin'}`
  let n = 1
  const ids = new Set((poisMap[viewIndex] ?? []).map((p) => p.id))
  while (ids.has(id)) {
    id = `v${viewIndex}-${base || 'pin'}-${n++}`
  }
  return id
}

function clearPendingHero(viewIndex: number) {
  const pending = pendingHeroByView[viewIndex]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingHeroByView[viewIndex]
}

function clearPendingViewLoop(viewIndex: number) {
  const pending = pendingViewLoopByView[viewIndex]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingViewLoopByView[viewIndex]
}

async function refreshApartmentHighlightPreview() {
  const aptId = apartmentsEditor.getSelectedUnitId() || getFacadeApartmentId()
  await refreshApartmentStagePreview(aptId)
}

/** Só renderiza highlights depois da fachada carregar — evita vértices desalinhados na abertura. */
async function refreshHighlightEditorStage() {
  if (activeTab !== 'apartments' || activeAptSub !== 'pins') return
  setActiveStageLayer('facade')
  await refreshApartmentHighlightPreview()
  await waitForHighlightFacadeReady()
  if (!getHighlightStageCoverImage()) return
  stageViewportController?.refresh()
  aptPinsEditor.renderAll()
  syncHighlightStageLayout()
}

let apartmentFacadePosterBlob: string | null = null
let poiChildStagePosterBlob: string | null = null
let editorScenePosterBlob: string | null = null

function revokePoiChildStagePosterBlob() {
  if (poiChildStagePosterBlob) {
    URL.revokeObjectURL(poiChildStagePosterBlob)
    poiChildStagePosterBlob = null
  }
}

function revokeEditorScenePosterBlob() {
  if (editorScenePosterBlob) {
    URL.revokeObjectURL(editorScenePosterBlob)
    editorScenePosterBlob = null
  }
}

function probeImageSrc(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    const finish = (ok: boolean) => {
      img.onload = null
      img.onerror = null
      resolve(ok)
    }
    img.onload = () => finish(img.naturalWidth > 0)
    img.onerror = () => finish(false)
    img.src = src
  })
}

async function resolveMediaUrl(ref: string): Promise<string | null> {
  return (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref) ?? null
}

function getStageViewIndex(): number {
  return selectedPoiView ?? currentView
}

function refreshPoiChildStageIfNeeded(poiId: string) {
  if (getChildEditParentId() === poiId) {
    void refreshChildEditBackground(poiId).then(() => renderPins())
  }
}

async function resolveViewStageAlignmentSrc(viewIndex: number): Promise<string | null> {
  const pendingHero = pendingHeroByView[viewIndex]
  if (pendingHero) return pendingHero.previewUrl

  const refs: string[] = []
  const savedHero = getHeroRef(viewIndex)
  if (savedHero) refs.push(savedHero)

  const vp = getViewpoint(viewIndex)
  const menuPoster = vp?.transitionImage ?? getProjectMenuImagePath(viewIndex)
  if (menuPoster) refs.push(menuPoster)

  const defaultPoster = POSTERS[viewIndex]
  if (defaultPoster && !refs.includes(defaultPoster)) refs.push(defaultPoster)

  for (const ref of refs) {
    const src = await resolveMediaUrl(ref)
    if (!src) continue
    if (await probeImageSrc(src)) return src
  }

  const loopPath =
    getProjectViewLoopPath(viewIndex) ?? getProjectMenuLoopVideoPath(viewIndex)
  if (loopPath) {
    const loopUrl = await resolveMediaUrl(loopPath)
    if (loopUrl) return captureVideoPosterObjectUrl(loopUrl)
  }

  return null
}

async function resolvePoiChildStageSrc(parentId: string): Promise<string | null> {
  const parent = findPoiByIdInEditor(parentId)
  const pendingImg = pendingPoiCardImg[parentId]
  const pendingLoop = pendingPoiLoopVideo[parentId]
  const loopDirect = parent ? isPoiLoopDirect(parent) : false

  if (!loopDirect) {
    const imgRef = pendingImg?.previewUrl ?? parent?.img ?? getProjectPoiImagePath(parentId)
    if (imgRef) {
      return (
        pendingImg?.previewUrl ??
        ((await resolveMediaSrc(imgRef)) ?? resolveMediaPath(imgRef) ?? null)
      )
    }
  }

  const loopRef =
    pendingLoop?.previewUrl ?? getProjectPoiLoopVideoPath(parentId) ?? parent?.img ?? getProjectPoiImagePath(parentId)
  if (!loopRef) return null

  if (pendingLoop?.previewUrl || /\.(mp4|webm|mov)(\?|$)/i.test(loopRef)) {
    const loopUrl =
      pendingLoop?.previewUrl ??
      ((await resolveMediaSrc(loopRef)) ?? resolveMediaPath(loopRef) ?? null)
    if (!loopUrl) return null
    return captureVideoPosterObjectUrl(loopUrl)
  }

  return (await resolveMediaSrc(loopRef)) ?? resolveMediaPath(loopRef) ?? null
}

function revokeApartmentFacadePosterBlob() {
  if (apartmentFacadePosterBlob) {
    URL.revokeObjectURL(apartmentFacadePosterBlob)
    apartmentFacadePosterBlob = null
  }
}

async function refreshApartmentStagePreview(apartmentId: string) {
  setActiveStageLayer('facade')
  const item = apartmentsState.find((i) => i.id === apartmentId)
  if (!item) {
    revokeApartmentFacadePosterBlob()
    await loadFacadeImage(null)
    return
  }
  revokeApartmentFacadePosterBlob()
  const src = await resolveApartmentFacadePreviewSrc(item)
  if (!src) {
    await loadFacadeImage(null)
    return
  }
  if (src.startsWith('blob:')) apartmentFacadePosterBlob = src
  await loadFacadeImage(src)
}


async function refreshChildEditBackground(parentId: string) {
  setActiveStageLayer('scene')
  revokePoiChildStagePosterBlob()
  const src = await resolvePoiChildStageSrc(parentId)
  if (!src) {
    await loadSceneImage(null)
    return
  }
  if (src.startsWith('blob:')) poiChildStagePosterBlob = src
  await loadSceneImage(src, { hideWhileLoading: false })
}

function findPoiByIdInEditor(poiId: string): PoiDefinition | undefined {
  for (const list of Object.values(poisMap)) {
    const hit = list.find((p) => p.id === poiId)
    if (hit) return hit
  }
  for (const list of Object.values(poisChildrenMap)) {
    const hit = list.find((p) => p.id === poiId)
    if (hit) return hit
  }
  return undefined
}

function enterChildEditMode(parentPoi: PoiDefinition) {
  if (childEditPath[childEditPath.length - 1] === parentPoi.id) {
    /* já neste nível */
  } else if (childEditPath.length) {
    childEditPath.push(parentPoi.id)
  } else {
    childEditPath = [parentPoi.id]
  }
  selectedId = null
  selectedPoiView = null
  frozenPoiPanelTitle = `Filhos · ${parentPoi.label}`
  poiTabTitle.textContent = frozenPoiPanelTitle
  poiTabId.textContent = childEditBreadcrumb()
  void refreshChildEditBackground(parentPoi.id).then(() => {
    renderPins()
    renderPinList()
  })
  setActiveTab('scene')
  void updatePoiCard(null)
  syncStagePinBackButton()
}

function popChildEditLevel() {
  childEditPath.pop()
  if (!childEditPath.length) {
    exitChildEditMode()
    return
  }
  selectedId = null
  const parentId = getChildEditParentId()!
  frozenPoiPanelTitle = `Filhos · ${findPoiByIdInEditor(parentId)?.label ?? parentId}`
  poiTabTitle.textContent = frozenPoiPanelTitle
  poiTabId.textContent = childEditBreadcrumb()
  void refreshChildEditBackground(parentId).then(() => {
    renderPins()
    renderPinList()
  })
  void updatePoiCard(null)
  syncStagePinBackButton()
}

function exitChildEditMode() {
  childEditPath = []
  selectedId = null
  selectedPoiView = null
  frozenPoiPanelTitle = null
  void refreshStageBackground(currentView).then(() => {
    renderPins()
    renderPinList()
  })
  poiTabTitle.textContent = 'Pin'
  poiTabId.textContent = ''
  void updatePoiCard(null)
  syncStagePinBackButton()
}

function deleteChildPoiBranch(poiId: string) {
  const descendants = new Set<string>([poiId])
  let changed = true
  while (changed) {
    changed = false
    for (const list of Object.values(poisChildrenMap)) {
      for (const p of list) {
        if (p.parentId && descendants.has(p.parentId) && !descendants.has(p.id)) {
          descendants.add(p.id)
          changed = true
        }
      }
    }
  }
  for (const id of descendants) {
    delete poisChildrenMap[id]
  }
  for (const [parentId, list] of Object.entries(poisChildrenMap)) {
    const next = list.filter((p) => !descendants.has(p.id))
    if (next.length !== list.length) {
      if (next.length) poisChildrenMap[parentId] = next
      else delete poisChildrenMap[parentId]
    }
  }
}

function commitChildPoisMap(parentId: string) {
  const list = poisChildrenMap[parentId]
  if (!list?.length) return
  poisChildrenMap = {
    ...poisChildrenMap,
    [parentId]: list.map((p) => ({
      ...p,
      parentId,
      x: round1(p.x),
      y: round1(p.y),
      coordSpace: 'image' as const,
    })),
  }
}

function commitAllChildPoisMaps() {
  for (const parentId of Object.keys(poisChildrenMap)) {
    commitChildPoisMap(parentId)
  }
}

async function refreshStageBackground(viewIndex: number) {
  if (activeTab === 'apartments') return
  setActiveStageLayer('scene')
  if (activeTab === 'insolation') {
    const pendingSolar = getPendingSolarFrameInitialSrc(viewIndex)
    if (pendingSolar) {
      await loadSceneImage(pendingSolar, { hideWhileLoading: false })
      return
    }
    const solarSrc = await resolveSolarFrameInitialSrc(viewIndex)
    if (solarSrc) {
      await loadSceneImage(solarSrc, { hideWhileLoading: false })
      return
    }
  }

  revokeEditorScenePosterBlob()
  const src = await resolveViewStageAlignmentSrc(viewIndex)
  if (!src) {
    await loadSceneImage(null)
    return
  }
  if (src.startsWith('blob:')) editorScenePosterBlob = src
  const result = await loadSceneImage(src, { hideWhileLoading: false })
  if (result === 'ready' && pendingHeroByView[viewIndex]) flashSceneHero()
}

async function commitHeroSave(viewIndex: number) {
  const pending = pendingHeroByView[viewIndex]
  if (!pending) {
    showToast('Envie uma imagem antes de salvar')
    return
  }

  try {
    const { path } = await saveMediaToProject(
      'hero',
      pending.file,
      { view: String(viewIndex) },
      { reload: false },
    )
    if (viewIndex === PANORAMA_VIEW) {
      await saveMediaToProject(
        'solar-frame-initial',
        pending.file,
        { view: String(viewIndex) },
        { reload: false },
      )
    }
    clearPendingHero(viewIndex)
    await loadSceneImage(path, { hideWhileLoading: false })
    flashSceneHero()
    setHeroRef(viewIndex, path)
    await refreshAfterLocalMediaSave('hero', { viewIndex })
    showToast(
      viewIndex === PANORAMA_VIEW
        ? `Panorâmica salva (HERO + frame dia no site)`
        : `HERO salvo no projeto (${path})`,
    )
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

async function commitViewLoopSave(viewIndex: number) {
  const pending = pendingViewLoopByView[viewIndex]
  if (!pending) {
    showToast('Envie um vídeo antes de salvar')
    return
  }

  try {
    const { path } = await saveMediaToProject(
      'view-loop',
      pending.file,
      { view: String(viewIndex) },
      { reload: false },
    )
    clearPendingViewLoop(viewIndex)
    await saveViewIdleModeToProject(viewIndex, 'loop', { reload: false })
    await refreshAfterLocalMediaSave('hero', { viewIndex })
    showToast(
      viewIndex === PANORAMA_VIEW
        ? `Loop salvo (${path}) — HERO continua como capa dos pins`
        : `Vídeo em loop salvo (${path})`,
    )
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

async function renderHeroPanel(viewIndex: number) {
  const label = VIEWPOINTS[viewIndex]?.label ?? `Vista ${viewIndex}`
  const idleMode = getViewIdleMode(viewIndex)
  const pendingHero = pendingHeroByView[viewIndex]
  const pendingLoop = pendingViewLoopByView[viewIndex]
  const heroRef = getHeroRef(viewIndex)
  const loopRef = getProjectViewLoopPath(viewIndex)
  const savedHeroPreview = heroRef ? ((await resolveMediaSrc(heroRef)) ?? '') : ''
  const savedLoopPreview = loopRef ? ((await resolveMediaSrc(loopRef)) ?? '') : ''
  const heroThumbSrc = pendingHero?.previewUrl ?? savedHeroPreview
  const loopThumbSrc = pendingLoop?.previewUrl ?? savedLoopPreview
  const hasSavedHero = Boolean(heroRef)
  const hasSavedLoop = Boolean(loopRef)
  const hasPendingHero = Boolean(pendingHero)
  const hasPendingLoop = Boolean(pendingLoop)

  let heroStatus = 'Nenhuma imagem personalizada'
  if (hasPendingHero) heroStatus = 'Prévia — clique Salvar'
  else if (hasSavedHero) heroStatus = 'Salva ✓ (site e editor)'

  let loopStatus = 'Nenhum vídeo de loop'
  if (hasPendingLoop) loopStatus = 'Prévia — clique Salvar'
  else if (hasSavedLoop) loopStatus = 'Salvo ✓ (reproduz no site)'

  const panoramaNote =
    viewIndex === PANORAMA_VIEW
      ? `<p class="edit-card-hint">Na <strong>Panorâmica</strong>, o slider de sol substitui o loop ao mudar a luz. Imagem HERO posiciona pins e serve de capa.</p>`
      : `<p class="edit-card-hint">Vídeo sem áudio, em loop contínuo. A imagem HERO abaixo posiciona os pins e aparece enquanto o vídeo carrega.</p>`

  heroPanel.innerHTML = `
    <span class="edit-card-kicker">Fundo da vista</span>
    <p class="edit-card-desc">${label} · imagem fixa ou vídeo com movimento (VEG, água, etc.)</p>
    ${panoramaNote}
    <div class="edit-idle-mode-row edit-btn-row">
      <button type="button" class="edit-btn edit-btn--ghost${idleMode === 'image' ? ' active' : ''}" id="idle-mode-image">Imagem fixa</button>
      <button type="button" class="edit-btn edit-btn--ghost${idleMode === 'loop' ? ' active' : ''}" id="idle-mode-loop">Vídeo em loop</button>
    </div>
    <div id="hero-image-section"${idleMode === 'loop' ? ' hidden' : ''}>
      <span class="edit-card-kicker">Imagem HERO</span>
      <span class="edit-badge ${hasPendingHero ? 'is-warn' : hasSavedHero ? 'is-ok' : ''}">${heroStatus}</span>
      ${heroThumbSrc ? `<img class="edit-preview" id="hero-thumb" src="${heroThumbSrc}" alt="" />` : ''}
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="hero-file" accept="image/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="hero-save" ${hasPendingHero ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="hero-clear" ${hasSavedHero || hasPendingHero ? '' : 'disabled'}>Limpar</button>
      </div>
    </div>
    <div id="hero-loop-section"${idleMode === 'loop' ? '' : ' hidden'}>
      <span class="edit-card-kicker">Vídeo em loop</span>
      <span class="edit-badge ${hasPendingLoop ? 'is-warn' : hasSavedLoop ? 'is-ok' : ''}">${loopStatus}</span>
      ${loopThumbSrc ? `<video class="edit-preview edit-preview--video" id="loop-thumb" src="${loopThumbSrc}" muted loop autoplay playsinline></video>` : ''}
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="loop-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="loop-save" ${hasPendingLoop ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="loop-clear" ${hasSavedLoop || hasPendingLoop ? '' : 'disabled'}>Limpar</button>
      </div>
    </div>
  `

  document.getElementById('idle-mode-image')!.addEventListener('click', () => {
    void (async () => {
      try {
        await saveViewIdleModeToProject(viewIndex, 'image', { reload: false })
        await renderHeroPanel(viewIndex)
        showToast('Modo imagem fixa — site usa HERO estático')
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Use npm run dev')
      }
    })()
  })

  document.getElementById('idle-mode-loop')!.addEventListener('click', () => {
    void (async () => {
      try {
        await saveViewIdleModeToProject(viewIndex, 'loop', { reload: false })
        await renderHeroPanel(viewIndex)
        showToast(hasSavedLoop || hasPendingLoop ? 'Modo vídeo em loop' : 'Envie e salve um vídeo de loop')
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Use npm run dev')
      }
    })()
  })

  document.getElementById('hero-file')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Use JPG, PNG ou WebP')
      return
    }
    clearPendingHero(viewIndex)
    const previewUrl = URL.createObjectURL(file)
    pendingHeroByView[viewIndex] = { file, previewUrl }
    void refreshStageBackground(viewIndex)
    void renderHeroPanel(viewIndex)
    markEditDirty()
    showToast('Prévia no fundo — clique Salvar')
  })

  document.getElementById('hero-save')!.addEventListener('click', () => {
    void commitHeroSave(viewIndex)
  })

  document.getElementById('hero-clear')!.addEventListener('click', async () => {
    clearPendingHero(viewIndex)
    try {
      await removeMediaFromProject('hero', { view: String(viewIndex) }, { reload: false })
      setHeroRef(viewIndex, null)
      await refreshAfterLocalMediaSave('hero', { viewIndex })
      showToast('HERO removido do projeto')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })

  document.getElementById('loop-file')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      showToast('Use MP4 ou WebM')
      return
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
      return
    }
    clearPendingViewLoop(viewIndex)
    const previewUrl = URL.createObjectURL(file)
    pendingViewLoopByView[viewIndex] = { file, previewUrl }
    void renderHeroPanel(viewIndex)
    markEditDirty()
    showToast('Prévia do loop — clique Salvar')
  })

  document.getElementById('loop-save')!.addEventListener('click', () => {
    void commitViewLoopSave(viewIndex)
  })

  document.getElementById('loop-clear')!.addEventListener('click', async () => {
    clearPendingViewLoop(viewIndex)
    try {
      await removeMediaFromProject('view-loop', { view: String(viewIndex) }, { reload: false })
      await refreshAfterLocalMediaSave('hero', { viewIndex })
      showToast('Loop removido — voltou para imagem fixa')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })
}

const MAX_VIDEO_MB = 120

function clearPendingPoiCardImg(poiId: string) {
  const pending = pendingPoiCardImg[poiId]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingPoiCardImg[poiId]
}

function clearPendingPoiVideo(poiId: string) {
  const pending = pendingPoiVideo[poiId]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingPoiVideo[poiId]
}

function clearPendingPoiLoopVideo(poiId: string) {
  const pending = pendingPoiLoopVideo[poiId]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingPoiLoopVideo[poiId]
}

async function commitPoiCardImageSave(poi: PoiDefinition) {
  const pending = pendingPoiCardImg[poi.id]
  if (!pending) {
    showToast('Envie uma imagem antes de salvar')
    return
  }

  try {
    const { path } = await saveMediaToProject(
      'poi-img',
      pending.file,
      { id: poi.id },
      { reload: false },
    )
    poi.img = path
    clearPendingPoiCardImg(poi.id)
    await refreshAfterLocalMediaSave('poi', { poi })
    showToast(`Imagem no projeto (${path}) — Finalizar pin`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

async function commitPoiLoopVideoSave(poi: PoiDefinition) {
  const pending = pendingPoiLoopVideo[poi.id]
  if (!pending) {
    showToast('Envie um vídeo de loop antes de salvar')
    return
  }

  try {
    const { path } = await saveMediaToProject(
      'poi-loop',
      pending.file,
      { id: poi.id },
      { reload: false },
    )
    if (poi.cardMediaMode !== 'loop-direct') poi.cardMediaMode = 'loop'
    clearPendingPoiLoopVideo(poi.id)
    await refreshAfterLocalMediaSave('poi', { poi })
    refreshPoiChildStageIfNeeded(poi.id)
    showToast(`Loop salvo (${path}) — Finalizar pin`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

async function commitPoiVideoSave(poi: PoiDefinition) {
  const pending = pendingPoiVideo[poi.id]
  if (!pending) {
    showToast('Envie um vídeo antes de salvar')
    return
  }

  try {
    const { path } = await saveMediaToProject(
      'poi-video',
      pending.file,
      { id: poi.id },
      { reload: false },
    )
    poi.transitionVideo = path
    clearPendingPoiVideo(poi.id)
    await refreshAfterLocalMediaSave('poi', { poi })
    showToast(`Vídeo no projeto (${path}) — Finalizar pin`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

async function updatePoiCard(poi: PoiDefinition | null) {
  syncPinRemoveButtons()
  syncPoiFinishButton()
  if (!poi) {
    frozenPoiPanelTitle = getChildEditParentId()
      ? `Filhos · ${findPoiByIdInEditor(getChildEditParentId()!)?.label ?? getChildEditParentId()}`
      : null
    if (getChildEditParentId()) {
      poiTabTitle.textContent = frozenPoiPanelTitle ?? 'Filhos'
      poiTabId.textContent = childEditBreadcrumb()
    } else {
      poiTabTitle.textContent = 'Pin'
      poiTabId.textContent = ''
    }
    const backOneLevel =
      childEditPath.length > 1
        ? `<button type="button" class="edit-btn edit-btn--ghost" id="poi-pop-child-level">← Nível anterior</button>`
        : ''
    poiCard.innerHTML = getChildEditParentId()
      ? `<p class="edit-card-hint edit-card-hint--trail">${childEditBreadcrumb()}</p>
         <p class="edit-empty-poi">Modo <strong>pins filhos</strong> — só imagem + fade no site (sem vídeo).</p>
         ${backOneLevel}
         <button type="button" class="edit-btn edit-btn--ghost" id="poi-exit-children">← Voltar à cena</button>`
      : `<p class="edit-empty-poi">
        Nenhum pin selecionado nesta vista.
        Escolha um pin na lista em <strong>Cena</strong> ou clique no <strong>+</strong> na prévia.
        Use <strong>+</strong> ao lado do campo de nome para criar um pin novo.
      </p>`
    document.getElementById('poi-exit-children')?.addEventListener('click', () => exitChildEditMode())
    document.getElementById('poi-pop-child-level')?.addEventListener('click', () => popChildEditLevel())
    return
  }

  if (frozenPoiPanelTitle) {
    poiTabTitle.textContent = frozenPoiPanelTitle
  }
  poiTabId.textContent = `id: ${poi.id}`

  const imgPath = poi.img ?? getProjectPoiImagePath(poi.id)
  const loopPath = getProjectPoiLoopVideoPath(poi.id)
  const videoPath = poi.transitionVideo ?? getProjectPoiVideoPath(poi.id)
  const pendingImg = pendingPoiCardImg[poi.id]
  const pendingLoop = pendingPoiLoopVideo[poi.id]
  const cardMediaMode = poi.cardMediaMode === 'loop-direct' ? 'loop-direct' : 'loop'
  const savedImgPreview = imgPath ? ((await resolveMediaSrc(imgPath)) ?? '') : ''
  const savedLoopPreview = loopPath ? ((await resolveMediaSrc(loopPath)) ?? '') : ''
  const imgThumbSrc = pendingImg?.previewUrl ?? savedImgPreview
  const loopThumbSrc = pendingLoop?.previewUrl ?? savedLoopPreview
  const hasSavedImg = Boolean(imgPath)
  const hasPendingImg = Boolean(pendingImg)
  const hasSavedLoop = Boolean(loopPath)
  const hasPendingLoop = Boolean(pendingLoop)

  let imgStatus = 'Usa imagem padrão do projeto'
  if (hasPendingImg) imgStatus = 'Prévia — clique SALVAR IMAGEM'
  else if (hasSavedImg) imgStatus = 'Salva ✓ (capa + pins)'

  let loopStatus = 'Nenhum loop salvo'
  if (hasPendingLoop) loopStatus = 'Prévia — clique SALVAR LOOP'
  else if (hasSavedLoop) loopStatus = 'Salvo ✓ (card e tela cheia)'

  const pendingVid = pendingPoiVideo[poi.id]
  const hasSavedVideo = Boolean(videoPath)
  const hasPendingVideo = Boolean(pendingVid)
  let videoStatus = 'Usa vídeo padrão do projeto'
  if (hasPendingVideo) videoStatus = 'Prévia — clique SALVAR VÍDEO'
  else if (hasSavedVideo) videoStatus = `Salvo ✓ (${videoPath})`

  const viewOpts = getAvailableViewIndices().map((idx) => {
    const label = getViewpoint(idx)?.label ?? VIEWPOINTS[idx]?.label ?? `Vista ${idx}`
    const sel = poi.targetView === idx ? 'selected' : ''
    return `<option value="${idx}" ${sel}>${label} (${idx})</option>`
  }).join('')

  syncPoiLockButton(poi)

  const isNestedPin = !isPoiOnScene(poi)
  const childCount = (poisChildrenMap[poi.id] ?? []).length
  const locked = Boolean(poi.positionLocked)
  const needsTargetForVideo =
    !isNestedPin &&
    (hasSavedVideo || hasPendingVideo) &&
    (poi.targetView === undefined || poi.targetView === null)
  const canEditChildren =
    hasSavedImg ||
    hasPendingImg ||
    (cardMediaMode === 'loop-direct' && (hasSavedLoop || hasPendingLoop))
  const targetBlock = isNestedPin
    ? `<p class="edit-card-hint">Pin filho — no site a transição é <strong>fade</strong> (sem vídeo). Posicione na imagem do pai; ao clicar, esmaece e mostra a foto deste pin.</p>`
    : `<div class="edit-field">
      <label class="edit-field-label" for="poi-target-view">Ir para vista</label>
      <select id="poi-target-view" class="edit-input">
        <option value="">Mesma vista (vídeo + imagem)</option>
        ${viewOpts}
      </select>
      ${
        needsTargetForVideo
          ? '<p class="edit-card-hint edit-card-hint--warn">Com vídeo salvo na mesma vista, o visitante vê vídeo → imagem final com pins filhos.</p>'
          : '<p class="edit-card-hint">Destino ao clicar no pin no site. Mesma vista = experiência imersiva com pins filhos.</p>'
      }
    </div>`
  const childrenBlock =
    canEditChildren
      ? `<div class="edit-field">
      <span class="edit-field-label">Navegação interna</span>
      <button type="button" class="edit-btn edit-btn--ghost" id="poi-edit-children">
        Editar pins filhos (${childCount})
      </button>
      <p class="edit-card-hint">Posicione pins na mídia deste pin — filhos usam fade entre fotos.</p>
    </div>`
      : ''
  const imgFieldLabel = isNestedPin ? 'Mídia no site' : 'Mídia do pin'
  const imgFieldHint = isNestedPin
    ? 'Exibida com fade ao clicar neste pin. Imagem obrigatória para posicionar filhos.'
    : 'Escolha como o visitante entra na experiência deste pin.'
  const showLoopSection = !isNestedPin && (cardMediaMode === 'loop' || cardMediaMode === 'loop-direct')
  const imgModeBlock = `
    <div class="edit-idle-mode-row edit-btn-row">
      <button type="button" class="edit-btn edit-btn--ghost${cardMediaMode === 'loop' ? ' active' : ''}" id="poi-card-mode-loop">Loop após transição</button>
      <button type="button" class="edit-btn edit-btn--ghost${cardMediaMode === 'loop-direct' ? ' active' : ''}" id="poi-card-mode-loop-direct">Só loop</button>
    </div>
    ${
      cardMediaMode === 'loop-direct'
        ? '<p class="edit-card-hint">No site: ao clicar, vai <strong>direto</strong> para o loop em tela cheia (sem vídeo de transição).</p>'
        : '<p class="edit-card-hint">No site: vídeo de transição → loop em tela cheia ao terminar.</p>'
    }`
  const imgPosterBlock = `
    <span class="edit-field-label">Imagem de capa</span>
    <span class="edit-badge ${hasPendingImg ? 'is-warn' : hasSavedImg ? 'is-ok' : ''}">${imgStatus}</span>
    ${imgThumbSrc ? `<img class="edit-preview edit-preview--sm" src="${imgThumbSrc}" alt="" />` : ''}
    <p class="edit-card-hint">Sempre necessária para posicionar pins e como capa enquanto o loop carrega.</p>
    <div class="edit-btn-row">
      <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="poi-img-file" accept="image/*" hidden /></label>
      <button type="button" class="edit-btn edit-btn--gold" id="poi-img-save" ${hasPendingImg ? '' : 'disabled'}>Salvar</button>
      <button type="button" class="edit-btn edit-btn--text" id="poi-img-clear" ${hasSavedImg || hasPendingImg ? '' : 'disabled'}>Limpar</button>
    </div>`
  const loopBlock = `
    <span class="edit-field-label">Vídeo em loop</span>
    <span class="edit-badge ${hasPendingLoop ? 'is-warn' : hasSavedLoop ? 'is-ok' : ''}">${loopStatus}</span>
    ${loopThumbSrc ? `<video class="edit-preview edit-preview--video edit-preview--sm" src="${loopThumbSrc}" muted loop autoplay playsinline></video>` : ''}
    <p class="edit-card-hint">${
      cardMediaMode === 'loop-direct'
        ? 'Sem áudio. No editor, pins filhos usam o <strong>1º frame</strong> deste vídeo para alinhamento.'
        : 'Sem áudio, repete na tela final — encaixe <strong>contain</strong> (mesmo tamanho da capa).'
    }</p>
    <div class="edit-btn-row">
      <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="poi-loop-file" accept="video/webm,video/mp4,video/*" hidden /></label>
      <button type="button" class="edit-btn edit-btn--gold" id="poi-loop-save" ${hasPendingLoop ? '' : 'disabled'}>Salvar</button>
      <button type="button" class="edit-btn edit-btn--text" id="poi-loop-clear" ${hasSavedLoop || hasPendingLoop ? '' : 'disabled'}>Limpar</button>
    </div>`
  const videoBlock =
    isNestedPin || cardMediaMode === 'loop-direct'
    ? ''
    : `
    <div class="edit-field">
      <label class="edit-field-label">Vídeo de transição</label>
      <span class="edit-badge ${hasPendingVideo ? 'is-warn' : hasSavedVideo ? 'is-ok' : ''}">${videoStatus}</span>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="poi-video-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="poi-video-save" ${hasPendingVideo ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="poi-video-clear" ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'}>Limpar</button>
      </div>
    </div>
    <div class="edit-field">
      <label class="edit-check-row" for="poi-video-rollback">
        <input type="checkbox" id="poi-video-rollback" ${poi.videoRollback ? 'checked' : ''} ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'} />
        Botão Rollback no site
      </label>
      <p class="edit-card-hint">Marcado = após o vídeo aparece <strong>Rollback</strong> no site para o visitante desfazer manualmente. Sem marcação = só ida, sem botão.</p>
    </div>
    <div class="edit-field">
      <label class="edit-check-row" for="poi-motion-blur">
        <input type="checkbox" id="poi-motion-blur" ${poi.motionBlur ? 'checked' : ''} />
        Motion blur na transição
      </label>
      <p class="edit-card-hint">Blur suave no meio do caminho ao clicar neste pin (vídeo do pin, sequência JPG ou rota padrão).</p>
    </div>`
  poiCard.innerHTML = `
    ${targetBlock}
    ${childrenBlock}
    <div class="edit-field">
      <label class="edit-field-label" for="poi-label">Nome no mapa</label>
      <input type="text" id="poi-label" class="edit-input" maxlength="48"
        placeholder="Ex.: Parque, Portaria…" autocomplete="off" />
      <p class="edit-card-hint">Texto ao lado do pin na prévia e na lista de pins.</p>
    </div>
    <div class="edit-field">
      <label class="edit-field-label" for="poi-title">Título</label>
      <input type="text" id="poi-title" class="edit-input" maxlength="80" autocomplete="off" />
    </div>
    <div class="edit-field">
      <label class="edit-field-label" for="poi-tag">Tag</label>
      <input type="text" id="poi-tag" class="edit-input" maxlength="32" autocomplete="off" />
    </div>
    <div class="edit-field">
      <span class="edit-field-label">Posição na prévia</span>
      <span class="edit-coords">${poi.x}% horizontal · ${poi.y}% vertical</span>
      <p class="edit-card-hint">${
        locked
          ? 'Travado — use o cadeado ao lado do título para liberar e arrastar.'
          : 'Livre — arraste o pin na imagem; trave com o cadeado se clicar e ele se mexer.'
      }</p>
    </div>
    <div class="edit-field">
      <label class="edit-field-label">${imgFieldLabel}</label>
      ${
        isNestedPin
          ? `<p class="edit-card-hint">${imgFieldHint}</p>${imgPosterBlock}`
          : `<p class="edit-card-hint">${imgFieldHint}</p>
      ${imgModeBlock}
      ${cardMediaMode === 'loop' ? imgPosterBlock : ''}
      <div id="poi-card-loop-section"${showLoopSection ? '' : ' hidden'}>${loopBlock}</div>`
      }
    </div>
    ${videoBlock}
  `

  wirePoiNameFields(poi)

  const targetSel = document.getElementById('poi-target-view') as HTMLSelectElement | null
  targetSel?.addEventListener('change', () => {
    const v = targetSel.value
    if (v === '') {
      delete poi.targetView
      markEditDirty()
      showToast('Destino: mesma vista (só card) — Finalizar pin')
      return
    }
    const idx = Number(v)
    if (!getAvailableViewIndices().includes(idx)) {
      targetSel.value = poi.targetView !== undefined ? String(poi.targetView) : ''
      showToast('Vista inválida')
      return
    }
    poi.targetView = idx
    markEditDirty()
    const owner = selectedPoiView ?? currentView
    showToast(
      `Destino: vista ${idx} — o pin continua na cena ${owner} (reposicione em Cena/Pin)`,
    )
  })

  document.getElementById('poi-img-file')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Use JPG, PNG ou WebP')
      return
    }
    clearPendingPoiCardImg(poi.id)
    pendingPoiCardImg[poi.id] = { file, previewUrl: URL.createObjectURL(file) }
    markEditDirty()
    void updatePoiCard(poi)
    refreshPoiChildStageIfNeeded(poi.id)
    showToast('Prévia no card — clique SALVAR IMAGEM')
  })

  document.getElementById('poi-img-save')?.addEventListener('click', () => {
    void commitPoiCardImageSave(poi)
  })

  document.getElementById('poi-img-clear')?.addEventListener('click', async () => {
    clearPendingPoiCardImg(poi.id)
    try {
      await removeMediaFromProject('poi-img', { id: poi.id }, { reload: false })
      delete poi.img
      await refreshAfterLocalMediaSave('poi', { poi })
      showToast('Imagem removida — Finalizar pin')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })

  document.getElementById('poi-card-mode-loop')?.addEventListener('click', () => {
    poi.cardMediaMode = 'loop'
    markEditDirty()
    void updatePoiCard(poi)
    refreshPoiChildStageIfNeeded(poi.id)
    if (!hasSavedLoop && !hasPendingLoop) {
      showToast('Envie e salve um vídeo de loop')
    }
  })

  document.getElementById('poi-card-mode-loop-direct')?.addEventListener('click', () => {
    poi.cardMediaMode = 'loop-direct'
    markEditDirty()
    void updatePoiCard(poi)
    refreshPoiChildStageIfNeeded(poi.id)
    if (!hasSavedLoop && !hasPendingLoop) {
      showToast('Envie e salve um vídeo de loop')
    }
  })

  document.getElementById('poi-loop-file')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      showToast('Use MP4 ou WebM')
      return
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
      return
    }
    clearPendingPoiLoopVideo(poi.id)
    pendingPoiLoopVideo[poi.id] = { file, previewUrl: URL.createObjectURL(file) }
    if (poi.cardMediaMode !== 'loop-direct') poi.cardMediaMode = 'loop'
    markEditDirty()
    void updatePoiCard(poi)
    refreshPoiChildStageIfNeeded(poi.id)
    showToast('Prévia do loop — clique SALVAR LOOP')
  })

  document.getElementById('poi-loop-save')?.addEventListener('click', () => {
    void commitPoiLoopVideoSave(poi)
  })

  document.getElementById('poi-loop-clear')?.addEventListener('click', async () => {
    clearPendingPoiLoopVideo(poi.id)
    try {
      await removeMediaFromProject('poi-loop', { id: poi.id }, { reload: false })
      if (poi.cardMediaMode === 'loop-direct') poi.cardMediaMode = 'loop'
      await refreshAfterLocalMediaSave('poi', { poi })
      showToast('Loop removido')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })

  document.getElementById('poi-video-file')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      showToast('Use WebM ou MP4')
      return
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
      return
    }
    clearPendingPoiVideo(poi.id)
    pendingPoiVideo[poi.id] = { file, previewUrl: URL.createObjectURL(file) }
    markEditDirty()
    void updatePoiCard(poi)
    showToast('Vídeo na prévia — clique SALVAR VÍDEO')
  })

  document.getElementById('poi-video-save')?.addEventListener('click', () => {
    void commitPoiVideoSave(poi)
  })

  document.getElementById('poi-video-clear')?.addEventListener('click', async () => {
    clearPendingPoiVideo(poi.id)
    try {
      await removeMediaFromProject('poi-video', { id: poi.id }, { reload: false })
      delete poi.transitionVideo
      await refreshAfterLocalMediaSave('poi', { poi })
      showToast('Vídeo removido — Finalizar pin')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
  })

  document.getElementById('poi-video-rollback')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked
    if (on) poi.videoRollback = true
    else delete poi.videoRollback
    markEditDirty()
    showToast(on ? 'Rollback ativado — Finalizar pin' : 'Rollback desativado — Finalizar pin')
  })

  document.getElementById('poi-motion-blur')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked
    if (on) poi.motionBlur = true
    else delete poi.motionBlur
    markEditDirty()
    showToast(on ? 'Motion blur ativado — Finalizar pin' : 'Motion blur desativado — Finalizar pin')
  })
}

function wirePoiNameFields(poi: PoiDefinition) {
  document.getElementById('poi-edit-children')?.addEventListener('click', () => {
    enterChildEditMode(poi)
  })

  const labelIn = document.getElementById('poi-label') as HTMLInputElement
  const titleIn = document.getElementById('poi-title') as HTMLInputElement
  const tagIn = document.getElementById('poi-tag') as HTMLInputElement
  if (!labelIn || !titleIn || !tagIn) return

  labelIn.value = poi.label
  titleIn.value = poi.title
  tagIn.value = poi.tag

  const commit = () => {
    void (async () => {
      const label = labelIn.value.trim()
      if (!label) {
        labelIn.value = poi.label
        showToast('O nome do pin não pode ficar vazio')
        return
      }
      poi.label = label
      poi.title = titleIn.value.trim() || label
      poi.tag = tagIn.value.trim() || 'Destaque'
      titleIn.value = poi.title
      tagIn.value = poi.tag
      if (getChildEditParentId()) commitChildPoisMap(getChildEditParentId()!)
      else commitPoisMapView(selectedPoiView ?? currentView)
      renderPins()
      renderPinList()
      markEditDirty()
      showToast('Texto na prévia — Finalizar pin')
    })()
  }

  labelIn.addEventListener('change', commit)
  titleIn.addEventListener('change', commit)
  tagIn.addEventListener('change', commit)
}


function renderPins() {
  editStage.querySelectorAll('.edit-pin:not(.edit-apt-pin)').forEach((el) => el.remove())
  if (activeTab === 'apartments') return

  const img = getEditStageCoverImage()
  const childParentId = getChildEditParentId()
  const pinView = getStageViewIndex()
  const pois = childParentId
    ? (poisChildrenMap[childParentId] ?? [])
    : (poisMap[pinView] ?? [])
  const viewIndexForDrag = childParentId ? -1 : pinView

  if (img && pois.length) {
    const rect = editStage.getBoundingClientRect()
    let dirty = false
    for (const poi of pois) {
      if (
        migratePanoramaPinToImageCoords(
          poi,
          rect.width,
          rect.height,
          img.naturalWidth,
          img.naturalHeight,
        )
      ) {
        dirty = true
      }
    }
    if (dirty) {
      if (childParentId) commitChildPoisMap(childParentId)
      else commitPoisMapView(pinView)
      markEditDirty()
    }
  }

  pois.forEach((poi) => {
    const el = document.createElement('div')
    const locked = Boolean(poi.positionLocked)
    el.className =
      'edit-pin' +
      (poi.id === selectedId ? ' selected' : '') +
      (locked ? ' is-locked' : '') +
      (childParentId ? ' edit-pin--child' : '')
    el.dataset.id = poi.id
    applyPanoramaPinPosition(el, poi)
    el.innerHTML = `
      <div class="edit-pin-dot">+</div>
      <div class="edit-pin-label">${poi.label}</div>
    `
    if (locked) {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        selectPoi(poi)
      })
    } else {
      makeDraggable(el, poi, viewIndexForDrag)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        selectPoi(poi)
      })
    }
    editStage.appendChild(el)
  })
}

type ActivePinDrag = {
  el: HTMLElement
  poi: PoiDefinition
  viewIndex: number
  dragging: boolean
  startX: number
  startY: number
}
let activePinDrag: ActivePinDrag | null = null
let pinDragListenersReady = false

function movePinDrag(clientX: number, clientY: number) {
  if (!activePinDrag) return
  if (!activePinDrag.dragging) {
    const dx = clientX - activePinDrag.startX
    const dy = clientY - activePinDrag.startY
    if (Math.hypot(dx, dy) < 4) return
    activePinDrag.dragging = true
    activePinDrag.el.classList.add('dragging')
  }
  const { el, poi } = activePinDrag
  const rect = editStage.getBoundingClientRect()
  const img = getEditStageCoverImage()
  if (img) {
    const imgPct = pointerToPanoramaImagePct(
      clientX,
      clientY,
      rect,
      img.naturalWidth,
      img.naturalHeight,
    )
    if (imgPct) {
      poi.coordSpace = 'image'
      poi.x = round1(Math.max(0, Math.min(100, imgPct.x)))
      poi.y = round1(Math.max(0, Math.min(100, imgPct.y)))
      applyPanoramaPinPosition(el, poi)
      if (selectedId === poi.id) {
        const coords = poiCard.querySelector('.edit-coords')
        if (coords) {
          coords.textContent = `${poi.x}% horizontal · ${poi.y}% vertical`
        }
      }
      return
    }
  }
  const x = ((clientX - rect.left) / rect.width) * 100
  const y = ((clientY - rect.top) / rect.height) * 100
  poi.x = round1(Math.max(0, Math.min(100, x)))
  poi.y = round1(Math.max(0, Math.min(100, y)))
  el.style.left = `${poi.x}%`
  el.style.top = `${poi.y}%`
}

function endPinDrag() {
  if (!activePinDrag) return
  const drag = activePinDrag
  activePinDrag = null
  if (!drag.dragging) return
  const { poi, viewIndex, el } = drag
  el.classList.remove('dragging')
  const childParentId = getChildEditParentId()
  if (childParentId && viewIndex === -1) {
    commitChildPoisMap(childParentId)
  } else {
    commitPoisMapView(viewIndex)
  }
  const saved =
    childParentId && viewIndex === -1
      ? (poisChildrenMap[childParentId] ?? []).find((p) => p.id === poi.id) ?? poi
      : (poisMap[viewIndex] ?? []).find((p) => p.id === poi.id) ?? poi
  if (selectedId === saved.id) {
    const coords = poiCard.querySelector('.edit-coords')
    if (coords) {
      coords.textContent = `${saved.x}% horizontal · ${saved.y}% vertical`
    }
  }
  markEditDirty()
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

function makeDraggable(el: HTMLElement, poi: PoiDefinition, viewIndex: number) {
  ensurePinDragListeners()
  const startDrag = (clientX: number, clientY: number) => {
    if (poi.positionLocked) return
    if (selectedId !== poi.id) highlightPoi(poi, { refreshStage: false })
    activePinDrag = { el, poi, viewIndex, dragging: false, startX: clientX, startY: clientY }
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

type SwitchViewOpts = {
  keepPinSelection?: boolean
  stayOnTab?: EditTab
  /** Não troca a imagem de fundo (ex.: boot direto em Apartamentos). */
  skipBackground?: boolean
  /** Não muda a aba ativa (boot aplica tab depois). */
  skipTabSwitch?: boolean
}

function switchViewContext(idx: number, opts: SwitchViewOpts = {}) {
  if (getChildEditParentId()) exitChildEditMode()
  currentView = idx
  viewSelect.value = String(idx)
  refreshSceneMenuControls(idx)
  if (!poisMap[idx]) poisMap[idx] = []
  if (!opts.skipBackground) void refreshStageBackground(idx)
  void renderHeroPanel(idx)
  if (activeTab === 'insolation') refreshInsolationPanel()
  renderPins()
  renderPinList()

  if (opts.keepPinSelection && selectedId) {
    const selected = findSelectedPoi()
    if (selected && activeTab === 'poi') void updatePoiCard(selected)
    return
  }

  if (opts.skipTabSwitch) return

  selectedId = null
  selectedPoiView = null
  frozenPoiPanelTitle = null
  if (opts.stayOnTab) {
    setActiveTab(opts.stayOnTab)
    if (opts.stayOnTab === 'poi') void updatePoiCard(null)
  } else {
    setActiveTab('scene')
    void updatePoiCard(null)
  }
}

function switchView(idx: number) {
  switchViewContext(idx)
}

viewSelect.addEventListener('change', () => {
  switchView(Number(viewSelect.value))
})

document.getElementById('btn-add')!.addEventListener('click', () => {
  void (async () => {
    const label = newLabelInput.value.trim() || 'Novo pin'
    const childParentId = getChildEditParentId()
    if (childParentId) {
      const id = slugChildId(label, childParentId)
      const poi: PoiDefinition = {
        id,
        parentId: childParentId,
        label,
        x: 50,
        y: 50,
        coordSpace: 'image',
        tag: 'Destaque',
        title: label,
        desc: 'Descrição do ponto de interesse.',
      }
      if (!poisChildrenMap[childParentId]) poisChildrenMap[childParentId] = []
      poisChildrenMap[childParentId].push(poi)
      commitChildPoisMap(childParentId)
      newLabelInput.value = ''
      renderPins()
      renderPinList()
      selectPoi(poi)
      markEditDirty()
      try {
        await persistPoisMapToProject()
        captureEditBaselines()
        markEditDirty()
        showToast('Pin filho criado — posicione na imagem do pai')
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Pin filho criado — Finalizar pin')
      }
      return
    }
    const id = slugId(label, currentView)
    const poi: PoiDefinition = {
      id,
      label,
      x: 50,
      y: 50,
      coordSpace: 'image',
      tag: 'Destaque',
      title: label,
      desc: 'Descrição do ponto de interesse.',
    }
    if (!poisMap[currentView]) poisMap[currentView] = []
    poisMap[currentView].push(poi)
    commitPoisMapView(currentView)
    newLabelInput.value = ''
    renderPins()
    renderPinList()
    selectPoi(poi)
    markEditDirty()
    const viewLabel = getViewpoint(currentView)?.label ?? `Vista ${currentView}`
    try {
      await persistPoisMapToProject()
      captureEditBaselines()
      markEditDirty()
      showToast(`Pin criado e salvo em ${viewLabel} — aparece no site nesta vista`)
    } catch (e) {
      showToast(
        e instanceof Error
          ? e.message
          : `Pin criado em ${viewLabel} — clique Finalizar pin ou Salvar no projeto (npm run dev)`,
      )
    }
  })()
})

async function removeSelectedPoi() {
  if (!selectedId) return
  const childParentId = getChildEditParentId()
  if (childParentId) {
    const list = poisChildrenMap[childParentId]
    if (!list) return
    const poi = list.find((p) => p.id === selectedId)
    if (!poi || !confirm(`Remover pin "${poi.label}" e filhos dele?`)) return
    try {
      clearPendingPoiCardImg(poi.id)
      clearPendingPoiVideo(poi.id)
      await removeMediaFromProject('poi-img', { id: poi.id }, { reload: false }).catch(() => {})
      await removeMediaFromProject('poi-video', { id: poi.id }, { reload: false }).catch(() => {})
      await removeMediaFromProject('poi-loop', { id: poi.id }, { reload: false }).catch(() => {})
      deleteChildPoiBranch(poi.id)
      poisChildrenMap[childParentId] = (poisChildrenMap[childParentId] ?? []).filter(
        (p) => p.id !== selectedId,
      )
      if (!poisChildrenMap[childParentId].length) delete poisChildrenMap[childParentId]
      commitChildPoisMap(childParentId)
      await persistPoisMapToProject()
      selectedId = null
      renderPins()
      renderPinList()
      syncPinRemoveButtons()
      void updatePoiCard(null)
      showToast('Pin removido')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Use npm run dev')
    }
    return
  }
  const ownerView = selectedPoiView ?? currentView
  const list = poisMap[ownerView]
  if (!list) return
  const poi = list.find((p) => p.id === selectedId)
  if (!poi || !confirm(`Remover pin "${poi.label}" desta vista?`)) return
  try {
    clearPendingPoiCardImg(poi.id)
    clearPendingPoiVideo(poi.id)
    await removeMediaFromProject('poi-img', { id: poi.id }, { reload: false }).catch(() => {})
    await removeMediaFromProject('poi-video', { id: poi.id }, { reload: false }).catch(() => {})
    deleteChildPoiBranch(poi.id)
    poisMap[ownerView] = list.filter((p) => p.id !== selectedId)
    commitPoisMapView(ownerView)
    await persistPoisMapToProject()
    selectedId = null
    selectedPoiView = null
    frozenPoiPanelTitle = null
    renderPins()
    renderPinList()
    syncPinRemoveButtons()
    if (activeTab === 'poi') {
      poiTabTitle.textContent = 'Pin'
      poiTabId.textContent = ''
      syncPoiLockButton(null)
      void updatePoiCard(null)
    } else {
      poiTabTitle.textContent = 'Pin'
      poiTabId.textContent = ''
      syncPoiLockButton(null)
    }
    setActiveTab('scene')
    showToast('Pin removido do projeto')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
}

btnDelete.addEventListener('click', async () => {
  void removeSelectedPoi()
})
btnPinRemove.addEventListener('click', () => {
  void removeSelectedPoi()
})

async function flushAllPendingHero() {
  for (const [viewStr, pending] of Object.entries(pendingHeroByView)) {
    const viewIndex = Number(viewStr)
    const { path } = await saveMediaToProject(
      'hero',
      pending.file,
      { view: viewStr },
      { reload: false },
    )
    if (viewIndex === PANORAMA_VIEW) {
      await saveMediaToProject(
        'solar-frame-initial',
        pending.file,
        { view: viewStr },
        { reload: false },
      )
    }
    setHeroRef(viewIndex, path)
    clearPendingHero(viewIndex)
  }
  for (const [viewStr, pending] of Object.entries(pendingViewLoopByView)) {
    const viewIndex = Number(viewStr)
    await saveMediaToProject('view-loop', pending.file, { view: viewStr }, { reload: false })
    await saveViewIdleModeToProject(viewIndex, 'loop', { reload: false })
    clearPendingViewLoop(viewIndex)
  }
}

async function flushAllPendingPoiMedia() {
  for (const list of Object.values(poisMap)) {
    for (const poi of list) {
      if (pendingPoiCardImg[poi.id]) await commitPoiCardImageSave(poi)
      if (pendingPoiVideo[poi.id]) await commitPoiVideoSave(poi)
    }
  }
  for (const list of Object.values(poisChildrenMap)) {
    for (const poi of list) {
      if (pendingPoiCardImg[poi.id]) await commitPoiCardImageSave(poi)
      if (pendingPoiVideo[poi.id]) await commitPoiVideoSave(poi)
    }
  }
}

document.getElementById('btn-save')!.addEventListener('click', async () => {
  const btn = document.getElementById('btn-save') as HTMLButtonElement
  if (btn.disabled) return
  btn.disabled = true
  try {
    flushActivePinDrag()
    aptPinsEditor.flushActiveDrag()
    await flushAllPendingHero()
    await flushAllPendingPoiMedia()
    await flushAllPendingMenuMedia()
    await flushAllInsolationPending()
    await flushPendingSplatPly(showToast)
    syncProjectMediaToApartmentPois(apartmentPoisState)
    await bookEditor.persist()
    await apartmentsEditor.persist()
    await splatEditor.persist()
    await persistPoisMapToProject()
    await aptPinsEditor.persist()
    if (!dockEditor.flushCardEdits()) {
      btn.disabled = false
      return
    }
    await saveDockToProject(dockState.trackOrder, dockState.viewpoints, { reload: false })
    reloadEditorAfterProjectSave()
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
    btn.disabled = false
    markEditDirty()
  }
})

document.getElementById('btn-logout')!.addEventListener('click', () => {
  clearSession()
  location.replace('/admin.html')
})

document.getElementById('btn-reset')!.addEventListener('click', async () => {
  if (!confirm('Apagar pins, menu, mídias e voltar aos padrões do projeto?')) return
  const password = prompt('Digite a senha do administrador para confirmar o reset:')
  if (password === null) return
  if (!password.trim()) {
    showToast('Senha obrigatória')
    return
  }
  const username = getSessionUsername() ?? import.meta.env.VITE_ADMIN_USER?.trim() ?? ''
  if (!(await verifyCredentials(username, password))) {
    showToast('Senha de administrador incorreta')
    return
  }
  try {
    await resetProjectOverrides(password)
    clearPoiOverrides()
    await reloadProjectFiles()
    poisMap = Object.fromEntries(
      Object.entries(POIS_BY_VIEW).map(([k, v]) => [Number(k), v.map((p) => ({ ...p }))]),
    ) as Record<number, PoiDefinition[]>
    poisChildrenMap = {}
    for (const idx of TRACK_ORDER) {
      if (!poisMap[idx]) poisMap[idx] = []
    }
    dockState = cloneDockState(getEditableDockState())
    bookState = getEditableInteriorsState()
    apartmentsState = getEditableApartmentsState()
    apartmentPoisState = getEditableApartmentPoisMap()
    apartmentOutlinesState = getEditableApartmentOutlinesState()
    splatState = getEditableSplatStateFromConfig()
    splatEditor.renderPanel()
    dockEditor.renderAll()
    bookEditor.renderAll()
    apartmentsEditor.renderAll()
    aptPinsEditor.renderAll()
    refreshViewSelectOptions(currentView)
    captureEditBaselines()
    markEditDirty()
    switchView(currentView)
    showToast('Projeto resetado')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Use npm run dev')
  }
})

window.addEventListener('explorer:project-updated', async () => {
  if (skipNextProjectUpdated) {
    skipNextProjectUpdated = false
    return
  }
  await applyAllProjectChanges({ loadFromDisk: false })
})

window.addEventListener('beforeunload', (e) => {
  if (!isAnyTabDirty()) return
  e.preventDefault()
  e.returnValue = ''
})

const params = new URLSearchParams(location.search)
const viewParam = params.get('view')
const parsedInitialView = viewParam !== null ? Number(viewParam) : NaN
const initialView =
  Number.isFinite(parsedInitialView) && getAvailableViewIndices().includes(parsedInitialView)
    ? parsedInitialView
    : 0
const initialTab = EDIT_TABS.includes(params.get('tab') as EditTab)
  ? (params.get('tab') as EditTab)
  : 'scene'

void (async () => {
  initEditStageImageSystem()
  if (!(await isProjectSaveAvailable())) {
    showToast('Rode npm run dev para gravar na pasta do projeto')
  }
  await reloadProjectFiles()
  refreshViewSelectOptions(currentView)
  await reloadCrmUnits()
  poisMap = getEditablePoisMap()
  poisChildrenMap = getEditableChildPoisMap()
  dockState = cloneDockState(getEditableDockState())
  bookState = getEditableInteriorsState()
  apartmentsState = getEditableApartmentsState()
  apartmentPoisState = getEditableApartmentPoisMap()
  apartmentOutlinesState = getEditableApartmentOutlinesState()
  splatState = getEditableSplatStateFromConfig()
  splatEditor.renderPanel()
  dockEditor.renderAll()
  bookEditor.renderAll()
  apartmentsEditor.renderAll()
  switchViewContext(initialView, {
    skipBackground: initialTab === 'apartments',
    skipTabSwitch: true,
  })
  viewSelect.value = String(currentView)

  const bookParam = params.get('book')
  if (bookParam && bookState.some((i) => i.id === bookParam)) {
    bookEditor.selectAmbiente(bookParam)
  }

  const aptParam = params.get('apt')
  if (aptParam && apartmentsState.some((i) => i.id === aptParam)) {
    apartmentsEditor.selectUnit(aptParam)
  }

  if (params.get('aptSub') === 'pins' || params.get('aptSub') === 'contornos') {
    setAptSubtab('pins')
  }

  const dockParam = params.get('dock')
  if (dockParam !== null && dockParam !== '') {
    const dockView = Number(dockParam)
    if (!Number.isNaN(dockView)) dockEditor.selectDockTab(dockView)
  }

  setActiveTab(initialTab)
  installEditDirtyProbe()
  captureEditBaselines()
  markEditDirty()

  if (sessionStorage.getItem(EDIT_SAVED_FLAG)) {
    sessionStorage.removeItem(EDIT_SAVED_FLAG)
    showToast('Projeto salvo e recarregado com todas as alterações')
  }
})()
