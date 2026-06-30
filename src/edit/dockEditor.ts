import { removeMediaFromProject, saveMediaToProject } from '../admin/projectSave'
import { APARTMENTS_HUB_VIEW } from '../config/apartments'
import { INTERIORS_HUB_VIEW } from '../config/interiors'
import { DOCK_PIN_FIRST_VIEWS, DOCK_PIN_LAST_VIEWS, isDockHubView } from '../config/dockHubs'
import { getProjectMenuImagePath, getProjectMenuVideoPath, getProjectMenuLoopVideoPath, resolveMenuMediaModeEditor } from '../config/projectMedia'
import {
  getAvailableViewIndices,
  defaultViewpointPatch,
  getViewpoint,
  normalizeTrackOrder,
} from '../config/pointsConfig'
import { VIEWPOINTS } from '../config/points'
import type { Viewpoint } from '../core/types'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { attachDockDragSort, readDockSortOrder } from '../ui/dockDragSort'
import { syncDockTabsLayout } from '../ui/dockLayout'
import { playEditImagePreview, playEditTransitionPreview } from './editTransitionPreview'

export type DockEditorState = {
  trackOrder: number[]
  viewpoints: Record<number, Partial<Viewpoint>>
}

const MAX_VIDEO_MB = 50
const MEDIA_ICON = `<span class="dock-tab-video-icon" title="Mídia customizada" aria-hidden="true">▶</span>`

type PendingFile = { file: File; previewUrl: string }
const pendingMenuTransitionVideo: Record<number, PendingFile> = {}
const pendingMenuPosterImage: Record<number, PendingFile> = {}
const pendingMenuLoopVideo: Record<number, PendingFile> = {}

export function hasPendingMenuVideos(): boolean {
  return (
    Object.keys(pendingMenuTransitionVideo).length > 0 ||
    Object.keys(pendingMenuPosterImage).length > 0 ||
    Object.keys(pendingMenuLoopVideo).length > 0
  )
}

export async function flushAllPendingMenuMedia() {
  for (const [viewStr, pending] of Object.entries(pendingMenuTransitionVideo)) {
    await saveMediaToProject('menu-video', pending.file, { view: viewStr }, { reload: false })
    clearPendingMenuTransitionVideo(Number(viewStr))
  }
  for (const [viewStr, pending] of Object.entries(pendingMenuPosterImage)) {
    await saveMediaToProject('menu-image', pending.file, { view: viewStr }, { reload: false })
    clearPendingMenuPosterImage(Number(viewStr))
  }
  for (const [viewStr, pending] of Object.entries(pendingMenuLoopVideo)) {
    await saveMediaToProject('menu-loop', pending.file, { view: viewStr }, { reload: false })
    clearPendingMenuLoopVideo(Number(viewStr))
  }
}

export function cloneDockState(src: DockEditorState): DockEditorState {
  return {
    trackOrder: [...src.trackOrder],
    viewpoints: Object.fromEntries(
      Object.entries(src.viewpoints).map(([k, v]) => [Number(k), { ...v }]),
    ),
  }
}

function clearPendingMenuTransitionVideo(viewIndex: number) {
  const pending = pendingMenuTransitionVideo[viewIndex]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingMenuTransitionVideo[viewIndex]
}

function clearPendingMenuPosterImage(viewIndex: number) {
  const pending = pendingMenuPosterImage[viewIndex]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingMenuPosterImage[viewIndex]
}

function clearPendingMenuLoopVideo(viewIndex: number) {
  const pending = pendingMenuLoopVideo[viewIndex]
  if (!pending) return
  URL.revokeObjectURL(pending.previewUrl)
  delete pendingMenuLoopVideo[viewIndex]
}

function hasMenuMedia(idx: number, vp: Viewpoint | null): boolean {
  if (!vp) return false
  return Boolean(
    pendingMenuTransitionVideo[idx] ||
      pendingMenuPosterImage[idx] ||
      pendingMenuLoopVideo[idx] ||
      vp.transitionVideo ||
      vp.transitionImage ||
      getProjectMenuVideoPath(idx) ||
      getProjectMenuImagePath(idx) ||
      getProjectMenuLoopVideoPath(idx) ||
      resolveMenuMediaModeEditor(idx, vp) !== 'image',
  )
}

export function initDockEditor(deps: {
  previewEl: HTMLElement
  chipListEl: HTMLElement
  cardEl: HTMLElement
  previewHost: HTMLElement
  tabTitle: HTMLElement
  removeBtn: HTMLButtonElement
  newLabelInput: HTMLInputElement
  addBtn: HTMLButtonElement
  showToast: (msg: string) => void
  onDirty?: () => void
  onViewSelect?: (viewIndex: number) => void
  getState: () => DockEditorState
  setState: (s: DockEditorState) => void
}) {
  let selectedView: number | null = null
  /** Título do painel — fixo na seleção; não muda ao editar "Nome no menu". */
  let frozenPanelTitle: string | null = null
  let teardownDockDrag: (() => void) | null = null

  const notifyDirty = () => deps.onDirty?.()

  function vpFor(idx: number): Viewpoint | null {
    const merged = getViewpoint(idx)
    if (!merged) return null
    const patch = deps.getState().viewpoints[idx] ?? {}
    const transitionVideo = getProjectMenuVideoPath(idx) ?? merged.transitionVideo
    const transitionImage = getProjectMenuImagePath(idx) ?? merged.transitionImage
    const motionBlur = patch.motionBlur !== undefined ? patch.motionBlur : merged.motionBlur
    const menuMediaMode = patch.menuMediaMode ?? merged.menuMediaMode
    return {
      ...merged,
      ...patch,
      index: idx,
      label: patch.label ?? merged.label,
      tag: patch.tag ?? merged.tag,
      ...(transitionVideo ? { transitionVideo } : {}),
      ...(transitionImage ? { transitionImage } : {}),
      ...(motionBlur ? { motionBlur } : {}),
      ...(menuMediaMode ? { menuMediaMode } : {}),
    }
  }

  /** Sincroniza trackOrder com a ordem atual na prévia (antes de re-render ou salvar). */
  function flushTrackOrderFromPreview(): void {
    const sortable = deps.previewEl.querySelector('#edit-dock-sortable') as HTMLElement | null
    if (!sortable) return
    const order = normalizeTrackOrder(
      readDockSortOrder(sortable, {
        keyAttr: 'data-i',
        parseKey: (v) => Number(v),
        pinFirst: [...DOCK_PIN_FIRST_VIEWS],
        pinLast: [...DOCK_PIN_LAST_VIEWS],
      }),
    )
    const st = deps.getState()
    const prev = st.trackOrder
    if (prev.length === order.length && prev.every((v, i) => v === order[i])) return
    st.trackOrder = order
    deps.setState(st)
    notifyDirty()
  }

  function syncSelectionUi() {
    deps.previewEl.querySelectorAll<HTMLButtonElement>('.dock-tab').forEach((btn) => {
      const idx = Number(btn.dataset.i)
      btn.classList.toggle('active', Number.isFinite(idx) && idx === selectedView)
    })
    deps.chipListEl.querySelectorAll<HTMLButtonElement>('.edit-chip').forEach((btn) => {
      const idx = Number(btn.dataset.view)
      btn.classList.toggle('is-on', Number.isFinite(idx) && idx === selectedView)
    })
  }

  function renderPreview() {
    flushTrackOrderFromPreview()
    const { trackOrder } = deps.getState()
    deps.previewEl.innerHTML = `
      <p class="edit-dock-drag-hint">Arraste os botões — <strong>Interativo</strong> fica sempre por último. <span class="edit-dock-legend">▶ = mídia customizada</span></p>
      <div class="dock-block">
        <p class="dock-eyebrow">Explorar o empreendimento</p>
        <div class="dock-tabs dock-tabs--sortable" id="edit-dock-sortable" role="tablist">
        ${trackOrder
          .map((idx) => {
            const vp = vpFor(idx)
            if (!vp) return ''
            const main = idx === 0 ? ' t-pt-main' : ''
            const on = idx === selectedView ? ' active' : ''
            const sortable = idx !== 0 && !isDockHubView(idx)
            const hasMedia = !isDockHubView(idx) && hasMenuMedia(idx, vp)
            return `
              <button type="button" class="dock-tab t-pt${main}${on}${sortable ? ' dock-tab--sortable' : ''}${hasMedia ? ' dock-tab--has-video' : ''}" data-i="${idx}" ${sortable ? 'draggable="true"' : ''}>
                ${sortable ? '<span class="dock-tab-grip" aria-hidden="true"></span>' : ''}
                ${hasMedia ? MEDIA_ICON : ''}
                <span class="dock-tab-glow" aria-hidden="true"></span>
                <span class="dock-tab-label">${vp.label}</span>
                <span class="dock-tab-tag">${vp.tag}</span>
              </button>
            `
          })
          .join('')}
        </div>
      </div>
    `

    syncDockTabsLayout(deps.previewEl.querySelector('#edit-dock-sortable'))

    teardownDockDrag?.()
    const sortable = deps.previewEl.querySelector('#edit-dock-sortable') as HTMLElement
    teardownDockDrag = attachDockDragSort(sortable, {
      keyAttr: 'data-i',
      parseKey: (v) => Number(v),
      pinFirst: [...DOCK_PIN_FIRST_VIEWS],
      pinLast: [...DOCK_PIN_LAST_VIEWS],
      isDraggable: (idx) => idx !== 0 && !isDockHubView(idx),
      onOrderChange: (order) => {
        const st = deps.getState()
        st.trackOrder = normalizeTrackOrder(order)
        deps.setState(st)
        renderChipList()
        notifyDirty()
        deps.showToast('Ordem do menu atualizada — Finalizar menu')
      },
    })

    deps.previewEl.querySelectorAll<HTMLButtonElement>('.dock-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dock-tab-grip')) return
        e.preventDefault()
        const idx = Number(btn.dataset.i)
        if (Number.isFinite(idx)) selectDockTab(idx)
      })
    })
  }

  function renderChipList() {
    const { trackOrder } = deps.getState()
    if (!trackOrder.length) {
      deps.chipListEl.innerHTML = `<span class="edit-chips-empty">Nenhum botão no menu</span>`
      return
    }
    deps.chipListEl.innerHTML = trackOrder
      .map((idx) => {
        const vp = vpFor(idx)
        const label = vp?.label ?? `Vista ${idx}`
        const locked = idx === 0 || isDockHubView(idx) ? ' · fixo' : ''
        const vid =
          !isDockHubView(idx) && hasMenuMedia(idx, vp)
            ? '<span class="edit-chip-media" aria-hidden="true">▶</span>'
            : ''
        return `<button type="button" class="edit-chip${idx === selectedView ? ' is-on' : ''}" data-view="${idx}">${vid}${label}${locked}</button>`
      })
      .join('')

    deps.chipListEl.querySelectorAll<HTMLButtonElement>('.edit-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectDockTab(Number(btn.dataset.view))
      })
    })
  }

  async function updateCard() {
    if (selectedView === null) {
      deps.tabTitle.textContent = 'Menu inferior'
      deps.removeBtn.disabled = true
      deps.cardEl.innerHTML = `
        <p class="edit-empty-poi">
          Selecione um botão na lista ou na prévia do menu inferior.
        </p>
      `
      return
    }

    const vp = vpFor(selectedView)
    if (!vp) {
      clearDockSelection()
      return
    }

    deps.tabTitle.textContent = frozenPanelTitle ?? vp.label
    deps.removeBtn.disabled = selectedView === 0 || isDockHubView(selectedView)

    const viewMeta = VIEWPOINTS[selectedView]?.label ?? `Vista ${selectedView}`
    const isBookHub = selectedView === INTERIORS_HUB_VIEW
    const isApartmentsHub = selectedView === APARTMENTS_HUB_VIEW
    const isPanorama = selectedView === 0

    const pendingTransVid = pendingMenuTransitionVideo[selectedView]
    const pendingPoster = pendingMenuPosterImage[selectedView]
    const pendingLoop = pendingMenuLoopVideo[selectedView]
    const savedVideoPath = vp.transitionVideo ?? getProjectMenuVideoPath(selectedView)
    const savedImagePath = vp.transitionImage ?? getProjectMenuImagePath(selectedView)
    const savedLoopPath = getProjectMenuLoopVideoPath(selectedView)
    const menuMediaMode = resolveMenuMediaModeEditor(selectedView, vp)
    const hasSavedVideo = Boolean(savedVideoPath)
    const hasPendingVideo = Boolean(pendingTransVid)
    const hasSavedImg = Boolean(savedImagePath)
    const hasPendingImg = Boolean(pendingPoster)
    const hasSavedLoop = Boolean(savedLoopPath)
    const hasPendingLoop = Boolean(pendingLoop)

    let videoStatus = 'Sem vídeo'
    if (hasPendingVideo) videoStatus = 'Prévia — clique Salvar'
    else if (hasSavedVideo) videoStatus = `Salvo ✓ (${savedVideoPath})`

    let transVideoStatus = 'Sem vídeo de transição'
    if (hasPendingVideo && menuMediaMode !== 'video') transVideoStatus = 'Prévia — clique Salvar'
    else if (hasSavedVideo && menuMediaMode !== 'video') transVideoStatus = `Salvo ✓ (${savedVideoPath})`

    let imgStatus = 'Sem imagem de capa'
    if (hasPendingImg) imgStatus = 'Prévia — clique Salvar'
    else if (hasSavedImg) imgStatus = 'Salva ✓ (capa + fade)'

    let loopStatus = 'Nenhum loop salvo'
    if (hasPendingLoop) loopStatus = 'Prévia — clique Salvar'
    else if (hasSavedLoop) loopStatus = 'Salvo ✓ (tela final)'

    const imgThumbSrc =
      pendingPoster?.previewUrl ??
      (savedImagePath ? (await resolveMediaSrc(savedImagePath)) ?? '' : '')
    const loopThumbSrc =
      pendingLoop?.previewUrl ?? (savedLoopPath ? (await resolveMediaSrc(savedLoopPath)) ?? '' : '')

    const canPreviewArrival =
      menuMediaMode === 'loop'
        ? hasPendingLoop || hasSavedLoop
        : menuMediaMode === 'video'
          ? hasPendingVideo || hasSavedVideo
          : hasPendingImg || hasSavedImg
    const canPreviewTransition =
      menuMediaMode !== 'video' && (hasPendingVideo || hasSavedVideo)

    const imgModeBlock = `
      <div class="edit-idle-mode-row edit-btn-row">
        <button type="button" class="edit-btn edit-btn--ghost${menuMediaMode === 'image' ? ' active' : ''}" id="dock-menu-mode-image">Imagem fixa</button>
        <button type="button" class="edit-btn edit-btn--ghost${menuMediaMode === 'video' ? ' active' : ''}" id="dock-menu-mode-video">Vídeo</button>
        <button type="button" class="edit-btn edit-btn--ghost${menuMediaMode === 'loop' ? ' active' : ''}" id="dock-menu-mode-loop">Vídeo em loop</button>
      </div>`
    const arrivalVideoBlock =
      menuMediaMode === 'video'
        ? `
      <span class="edit-field-label">Vídeo ao chegar</span>
      <span class="edit-badge ${hasPendingVideo ? 'is-warn' : hasSavedVideo ? 'is-ok' : ''}">${videoStatus}</span>
      <p class="edit-card-hint">One-shot com fade — toca uma vez ao clicar no menu.</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="dock-arrival-video-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="dock-arrival-video-save" ${hasPendingVideo ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="dock-arrival-video-clear" ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'}>Limpar</button>
      </div>`
        : ''
    const posterBlock =
      menuMediaMode === 'image' || menuMediaMode === 'loop'
        ? `
      <span class="edit-field-label">${menuMediaMode === 'loop' ? 'Imagem de capa' : 'Imagem ao chegar'}</span>
      <span class="edit-badge ${hasPendingImg ? 'is-warn' : hasSavedImg ? 'is-ok' : ''}">${imgStatus}</span>
      ${imgThumbSrc ? `<img class="edit-preview edit-preview--sm" src="${imgThumbSrc}" alt="" />` : ''}
      <p class="edit-card-hint">${menuMediaMode === 'loop' ? 'Poster enquanto o loop carrega.' : 'Exibida com fade ao chegar na vista.'}</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="dock-poster-file" accept="image/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="dock-poster-save" ${hasPendingImg ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="dock-poster-clear" ${hasSavedImg || hasPendingImg ? '' : 'disabled'}>Limpar</button>
      </div>`
        : ''
    const loopBlock = `
      <span class="edit-field-label">Vídeo em loop</span>
      <span class="edit-badge ${hasPendingLoop ? 'is-warn' : hasSavedLoop ? 'is-ok' : ''}">${loopStatus}</span>
      ${loopThumbSrc ? `<video class="edit-preview edit-preview--video edit-preview--sm" src="${loopThumbSrc}" muted loop autoplay playsinline></video>` : ''}
      <p class="edit-card-hint">Sem áudio, repete ao chegar — encaixe <strong>contain</strong> (sem esticar).</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="dock-loop-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="dock-loop-save" ${hasPendingLoop ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="dock-loop-clear" ${hasSavedLoop || hasPendingLoop ? '' : 'disabled'}>Limpar</button>
      </div>`

    const videoField = isBookHub
      ? `
      <div class="edit-field">
        <span class="edit-field-label">Hub do book</span>
        <p class="edit-card-hint">Este botão só abre o submenu de <strong>Interiores</strong>. Capítulos e mídias ficam na aba <strong>Book</strong> — não usa mídia de transição.</p>
      </div>`
      : isApartmentsHub
        ? `
      <div class="edit-field">
        <span class="edit-field-label">Hub de apartamentos</span>
        <p class="edit-card-hint">Este botão abre o submenu de <strong>Apartamentos</strong> (CRM). As 5 unidades e pins virão na aba dedicada — não usa mídia de transição.</p>
      </div>`
        : `
      ${menuMediaMode !== 'video' ? `
      <div class="edit-field">
        <label class="edit-field-label">Vídeo de transição</label>
        <span class="edit-badge ${hasPendingVideo ? 'is-warn' : hasSavedVideo ? 'is-ok' : ''}">${transVideoStatus}</span>
        <p class="edit-card-hint">Opcional — one-shot antes da imagem ou loop final.</p>
        <div class="edit-btn-row">
          <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="dock-trans-video-file" accept="video/webm,video/mp4,video/*" hidden /></label>
          <button type="button" class="edit-btn edit-btn--gold" id="dock-trans-video-save" ${hasPendingVideo ? '' : 'disabled'}>Salvar</button>
          <button type="button" class="edit-btn edit-btn--text" id="dock-trans-video-clear" ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'}>Limpar</button>
          <button type="button" class="edit-btn edit-btn--ghost" id="dock-trans-video-preview" ${canPreviewTransition ? '' : 'disabled'}>▶ Ver transição</button>
        </div>
      </div>` : ''}
      <div class="edit-field">
        <label class="edit-field-label">Mídia ao chegar na vista</label>
        <p class="edit-card-hint">Escolha imagem, vídeo one-shot ou loop — encaixe <strong>contain</strong> no loop.</p>
        ${imgModeBlock}
        ${arrivalVideoBlock}
        ${posterBlock}
        <div id="dock-menu-loop-section"${menuMediaMode === 'loop' ? '' : ' hidden'}>${loopBlock}</div>
        <div class="edit-btn-row">
          <button type="button" class="edit-btn edit-btn--ghost" id="dock-arrival-preview" ${canPreviewArrival ? '' : 'disabled'}>▶ Ver chegada</button>
        </div>
      </div>
      <div class="edit-field">
        <label class="edit-check-row" for="dock-motion-blur">
          <input type="checkbox" id="dock-motion-blur" ${vp.motionBlur ? 'checked' : ''} />
          Motion blur na transição
        </label>
        <p class="edit-card-hint">Blur suave no meio do caminho — igual aos pins.</p>
      </div>
      <div class="edit-field">
        <label class="edit-check-row" for="dock-video-rollback">
          <input type="checkbox" id="dock-video-rollback" ${vp.videoRollback ? 'checked' : ''} ${hasSavedVideo ? '' : 'disabled'} />
          Botão Rollback no site
        </label>
        <p class="edit-card-hint">Só para <strong>vídeo de transição</strong> salvo. Visitante desfaz com Rollback.</p>
      </div>`

    const panoramaNote = isPanorama
      ? '<p class="edit-card-hint">A panorâmica aceita vídeo ou imagem com <strong>fade preto</strong> na entrada (como no site).</p>'
      : ''

    deps.cardEl.innerHTML = `
      <div class="edit-field">
        <label class="edit-field-label" for="dock-label">Nome no menu</label>
        <input type="text" id="dock-label" class="edit-input" maxlength="32" autocomplete="off" />
        <p class="edit-card-hint">Texto grande no botão (como no site).</p>
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="dock-tag">Tag</label>
        <input type="text" id="dock-tag" class="edit-input" maxlength="28" autocomplete="off" />
        <p class="edit-card-hint">Linha menor abaixo do nome.</p>
      </div>
      <div class="edit-field">
        <span class="edit-field-label">Vista de destino</span>
        <span class="edit-coords">${viewMeta} · índice ${selectedView}</span>
        ${
          isPanorama
            ? '<p class="edit-card-hint">Panorâmica é fixa no menu e não pode ser removida.</p>'
            : isBookHub
              ? ''
              : '<p class="edit-card-hint">Ao clicar no site, navega para esta vista.</p>'
        }
        ${panoramaNote}
      </div>
      ${videoField}
    `

    const labelIn = document.getElementById('dock-label') as HTMLInputElement
    const tagIn = document.getElementById('dock-tag') as HTMLInputElement
    labelIn.value = vp.label
    tagIn.value = vp.tag

    const commit = (opts?: { refresh?: boolean }) => {
      const next = deps.getState()
      const label = labelIn.value.trim()
      if (!label) {
        labelIn.value = vp.label
        deps.showToast('O nome não pode ficar vazio')
        return false
      }
      if (!next.viewpoints[selectedView!]) {
        next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
      }
      const tag = tagIn.value.trim() || vp.tag
      const patch = next.viewpoints[selectedView!]!
      if (patch.label === label && patch.tag === tag) return true
      patch.label = label
      patch.tag = tag
      deps.setState(next)
      notifyDirty()
      if (opts?.refresh !== false) renderAll()
      return true
    }

    labelIn.addEventListener('change', () => {
      commit()
    })
    tagIn.addEventListener('change', () => {
      commit()
    })
    labelIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
    })

    if (!isBookHub) {
      const blurIn = document.getElementById('dock-motion-blur') as HTMLInputElement
      blurIn.addEventListener('change', () => {
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        if (blurIn.checked) next.viewpoints[selectedView!].motionBlur = true
        else delete next.viewpoints[selectedView!].motionBlur
        deps.setState(next)
        notifyDirty()
        deps.showToast('Motion blur — Finalizar menu')
      })

      const rollbackIn = document.getElementById('dock-video-rollback') as HTMLInputElement
      rollbackIn.addEventListener('change', () => {
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        if (rollbackIn.checked) next.viewpoints[selectedView!].videoRollback = true
        else delete next.viewpoints[selectedView!].videoRollback
        deps.setState(next)
        notifyDirty()
        deps.showToast(
          rollbackIn.checked
            ? 'Rollback ativado — Finalizar menu'
            : 'Rollback desativado — Finalizar menu',
        )
      })

      document.getElementById('dock-trans-video-file')!.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        if (!file.type.startsWith('video/')) {
          deps.showToast('Use WebM ou MP4')
          return
        }
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
          return
        }
        clearPendingMenuTransitionVideo(selectedView!)
        pendingMenuTransitionVideo[selectedView!] = {
          file,
          previewUrl: URL.createObjectURL(file),
        }
        notifyDirty()
        void updateCard()
        deps.showToast('Vídeo na prévia — clique Salvar')
      })

      document.getElementById('dock-trans-video-save')!.addEventListener('click', async () => {
        const pendingItem = pendingMenuTransitionVideo[selectedView!]
        if (!pendingItem) {
          deps.showToast('Envie um vídeo antes de salvar')
          return
        }
        try {
          const { path } = await saveMediaToProject(
            'menu-video',
            pendingItem.file,
            { view: String(selectedView) },
            { reload: false },
          )
          clearPendingMenuTransitionVideo(selectedView!)
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].transitionVideo = path
          deps.setState(next)
          notifyDirty()
          refreshMediaCard()
          deps.showToast(`Vídeo no disco (${path}) — Finalizar menu`)
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-trans-video-clear')!.addEventListener('click', async () => {
        clearPendingMenuTransitionVideo(selectedView!)
        try {
          await removeMediaFromProject(
            'menu-video',
            { view: String(selectedView) },
            { reload: false },
          ).catch(() => {})
          const next = deps.getState()
          if (next.viewpoints[selectedView!]) {
            delete next.viewpoints[selectedView!].transitionVideo
            delete next.viewpoints[selectedView!].videoRollback
            deps.setState(next)
          }
          notifyDirty()
          refreshMediaCard()
          deps.showToast('Vídeo de transição removido — Finalizar menu')
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-trans-video-preview')!.addEventListener('click', async () => {
        const pendingItem = pendingMenuTransitionVideo[selectedView!]
        let src: string | undefined = pendingItem?.previewUrl
        if (!src && savedVideoPath) {
          src = (await resolveMediaSrc(savedVideoPath)) ?? undefined
        }
        if (!src) {
          deps.showToast('Envie ou salve um vídeo de transição primeiro')
          return
        }
        await playEditTransitionPreview(src, deps.previewHost)
      })

      document.getElementById('dock-poster-file')!.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        if (!file.type.startsWith('image/')) {
          deps.showToast('Use JPG, PNG ou WebP')
          return
        }
        clearPendingMenuPosterImage(selectedView!)
        pendingMenuPosterImage[selectedView!] = {
          file,
          previewUrl: URL.createObjectURL(file),
        }
        notifyDirty()
        void updateCard()
        deps.showToast('Imagem na prévia — clique Salvar')
      })

      document.getElementById('dock-poster-save')!.addEventListener('click', async () => {
        const pendingItem = pendingMenuPosterImage[selectedView!]
        if (!pendingItem) {
          deps.showToast('Envie uma imagem antes de salvar')
          return
        }
        try {
          const { path } = await saveMediaToProject(
            'menu-image',
            pendingItem.file,
            { view: String(selectedView) },
            { reload: false },
          )
          clearPendingMenuPosterImage(selectedView!)
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].transitionImage = path
          deps.setState(next)
          notifyDirty()
          refreshMediaCard()
          deps.showToast(`Imagem no disco (${path}) — Finalizar menu`)
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-poster-clear')!.addEventListener('click', async () => {
        clearPendingMenuPosterImage(selectedView!)
        try {
          await removeMediaFromProject(
            'menu-image',
            { view: String(selectedView) },
            { reload: false },
          ).catch(() => {})
          const next = deps.getState()
          if (next.viewpoints[selectedView!]) {
            delete next.viewpoints[selectedView!].transitionImage
            deps.setState(next)
          }
          notifyDirty()
          refreshMediaCard()
          deps.showToast('Imagem de capa removida — Finalizar menu')
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-loop-file')!.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        if (!file.type.startsWith('video/')) {
          deps.showToast('Use MP4 ou WebM')
          return
        }
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
          return
        }
        clearPendingMenuLoopVideo(selectedView!)
        pendingMenuLoopVideo[selectedView!] = {
          file,
          previewUrl: URL.createObjectURL(file),
        }
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        next.viewpoints[selectedView!].menuMediaMode = 'loop'
        deps.setState(next)
        notifyDirty()
        void updateCard()
        deps.showToast('Loop na prévia — clique Salvar')
      })

      document.getElementById('dock-loop-save')!.addEventListener('click', async () => {
        const pendingItem = pendingMenuLoopVideo[selectedView!]
        if (!pendingItem) {
          deps.showToast('Envie um loop antes de salvar')
          return
        }
        try {
          await saveMediaToProject(
            'menu-loop',
            pendingItem.file,
            { view: String(selectedView) },
            { reload: false },
          )
          clearPendingMenuLoopVideo(selectedView!)
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].menuMediaMode = 'loop'
          deps.setState(next)
          notifyDirty()
          refreshMediaCard()
          deps.showToast('Loop salvo — Finalizar menu')
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-loop-clear')!.addEventListener('click', async () => {
        clearPendingMenuLoopVideo(selectedView!)
        try {
          await removeMediaFromProject(
            'menu-loop',
            { view: String(selectedView) },
            { reload: false },
          ).catch(() => {})
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].menuMediaMode = 'image'
          deps.setState(next)
          notifyDirty()
          refreshMediaCard()
          deps.showToast('Loop removido — voltou para imagem fixa')
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-menu-mode-image')!.addEventListener('click', () => {
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        next.viewpoints[selectedView!].menuMediaMode = 'image'
        deps.setState(next)
        notifyDirty()
        void updateCard()
      })

      document.getElementById('dock-menu-mode-video')!.addEventListener('click', () => {
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        next.viewpoints[selectedView!].menuMediaMode = 'video'
        deps.setState(next)
        notifyDirty()
        void updateCard()
        if (!hasSavedVideo && !hasPendingVideo) {
          deps.showToast('Envie e salve um vídeo')
        }
      })

      document.getElementById('dock-menu-mode-loop')!.addEventListener('click', () => {
        const next = deps.getState()
        if (!next.viewpoints[selectedView!]) {
          next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
        }
        next.viewpoints[selectedView!].menuMediaMode = 'loop'
        deps.setState(next)
        notifyDirty()
        void updateCard()
        if (!hasSavedLoop && !hasPendingLoop) {
          deps.showToast('Envie e salve um vídeo de loop')
        }
      })

      document.getElementById('dock-arrival-preview')!.addEventListener('click', async () => {
        if (menuMediaMode === 'loop') {
          const pendingItem = pendingMenuLoopVideo[selectedView!]
          let src: string | undefined = pendingItem?.previewUrl
          if (!src && savedLoopPath) {
            src = (await resolveMediaSrc(savedLoopPath)) ?? undefined
          }
          if (!src) {
            deps.showToast('Envie ou salve um loop primeiro')
            return
          }
          await playEditTransitionPreview(src, deps.previewHost)
        } else if (menuMediaMode === 'video') {
          const pendingItem = pendingMenuTransitionVideo[selectedView!]
          let src: string | undefined = pendingItem?.previewUrl
          if (!src && savedVideoPath) {
            src = (await resolveMediaSrc(savedVideoPath)) ?? undefined
          }
          if (!src) {
            deps.showToast('Envie ou salve um vídeo primeiro')
            return
          }
          await playEditTransitionPreview(src, deps.previewHost)
        } else {
          let src: string | undefined = pendingPoster?.previewUrl
          if (!src && savedImagePath) {
            src = (await resolveMediaSrc(savedImagePath)) ?? undefined
          }
          if (!src) {
            deps.showToast('Envie ou salve uma imagem de capa primeiro')
            return
          }
          await playEditImagePreview(src, deps.previewHost)
        }
      })

      const bindArrivalVideoUpload = (inputId: string) => {
        document.getElementById(inputId)?.addEventListener('change', (e) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (!file) return
          if (!file.type.startsWith('video/')) {
            deps.showToast('Use WebM ou MP4')
            return
          }
          if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
            deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
            return
          }
          clearPendingMenuTransitionVideo(selectedView!)
          pendingMenuTransitionVideo[selectedView!] = {
            file,
            previewUrl: URL.createObjectURL(file),
          }
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].menuMediaMode = 'video'
          deps.setState(next)
          notifyDirty()
          void updateCard()
          deps.showToast('Vídeo na prévia — clique Salvar')
        })
      }
      bindArrivalVideoUpload('dock-arrival-video-file')

      document.getElementById('dock-arrival-video-save')?.addEventListener('click', async () => {
        const pendingItem = pendingMenuTransitionVideo[selectedView!]
        if (!pendingItem) {
          deps.showToast('Envie um vídeo antes de salvar')
          return
        }
        try {
          const { path } = await saveMediaToProject(
            'menu-video',
            pendingItem.file,
            { view: String(selectedView) },
            { reload: false },
          )
          clearPendingMenuTransitionVideo(selectedView!)
          const next = deps.getState()
          if (!next.viewpoints[selectedView!]) {
            next.viewpoints[selectedView!] = defaultViewpointPatch(selectedView!)
          }
          next.viewpoints[selectedView!].transitionVideo = path
          next.viewpoints[selectedView!].menuMediaMode = 'video'
          deps.setState(next)
          notifyDirty()
          refreshMediaCard()
          deps.showToast(`Vídeo no disco (${path}) — Finalizar menu`)
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })

      document.getElementById('dock-arrival-video-clear')?.addEventListener('click', async () => {
        clearPendingMenuTransitionVideo(selectedView!)
        try {
          await removeMediaFromProject(
            'menu-video',
            { view: String(selectedView) },
            { reload: false },
          ).catch(() => {})
          const next = deps.getState()
          if (next.viewpoints[selectedView!]) {
            delete next.viewpoints[selectedView!].transitionVideo
            delete next.viewpoints[selectedView!].videoRollback
            deps.setState(next)
          }
          notifyDirty()
          refreshMediaCard()
          deps.showToast('Vídeo removido — Finalizar menu')
        } catch (e) {
          deps.showToast(e instanceof Error ? e.message : 'Use npm run dev')
        }
      })
    }
  }

  function refreshMediaCard() {
    renderPreview()
    void updateCard()
  }

  function renderAll() {
    renderPreview()
    renderChipList()
    void updateCard()
  }

  function selectDockTab(viewIndex: number) {
    flushTrackOrderFromPreview()
    selectedView = viewIndex
    const vp = vpFor(viewIndex)
    frozenPanelTitle =
      vp?.label ??
      VIEWPOINTS[viewIndex]?.label ??
      `Vista ${viewIndex}`
    syncSelectionUi()
    void updateCard()
    deps.onViewSelect?.(viewIndex)
  }

  function clearDockSelection() {
    selectedView = null
    frozenPanelTitle = null
    syncSelectionUi()
    void updateCard()
  }

  deps.newLabelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      deps.addBtn.click()
    }
  })

  deps.addBtn.addEventListener('click', () => {
    const st = deps.getState()
    const available = getAvailableViewIndices().filter((i) => !st.trackOrder.includes(i))
    if (!available.length) {
      deps.showToast('Todas as vistas já estão no menu')
      return
    }
    const label = deps.newLabelInput.value.trim()
    let viewIndex = available[0]
    if (label) {
      const match = available.find((i) => {
        const b = VIEWPOINTS[i]?.label.toLowerCase()
        return b && label.toLowerCase().includes(b)
      })
      if (match !== undefined) viewIndex = match
    }
    st.trackOrder = normalizeTrackOrder([...st.trackOrder, viewIndex])
    if (!st.viewpoints[viewIndex]) {
      st.viewpoints[viewIndex] = defaultViewpointPatch(viewIndex)
    }
    if (label) {
      st.viewpoints[viewIndex].label = label
      st.viewpoints[viewIndex].tag =
        st.viewpoints[viewIndex].tag ?? VIEWPOINTS[viewIndex]?.tag ?? 'Destaque'
    }
    deps.setState(st)
    deps.newLabelInput.value = ''
    notifyDirty()
    selectDockTab(viewIndex)
    deps.showToast('Botão adicionado — Finalizar menu')
  })

  deps.removeBtn.addEventListener('click', () => {
    if (selectedView === null || selectedView === 0 || selectedView === 1) return
    const st = deps.getState()
    const vp = vpFor(selectedView)
    if (!confirm(`Remover "${vp?.label}" do menu inferior?`)) return
    st.trackOrder = st.trackOrder.filter((i) => i !== selectedView)
    deps.setState(st)
    notifyDirty()
    clearDockSelection()
    deps.showToast('Removido do menu — Finalizar menu')
  })

  /** Grava nome/tag do card aberto antes de Finalizar menu — evita perder se o campo ainda tem foco. */
  function flushCardEdits(): boolean {
    flushTrackOrderFromPreview()
    if (selectedView === null) return true
    const labelIn = document.getElementById('dock-label') as HTMLInputElement | null
    const tagIn = document.getElementById('dock-tag') as HTMLInputElement | null
    if (!labelIn || !tagIn) return true
    const vp = vpFor(selectedView)
    if (!vp) return true
    const label = labelIn.value.trim()
    if (!label) {
      deps.showToast('O nome do botão não pode ficar vazio')
      labelIn.focus()
      return false
    }
    const next = deps.getState()
    if (!next.viewpoints[selectedView]) {
      next.viewpoints[selectedView] = defaultViewpointPatch(selectedView)
    }
    const tag = tagIn.value.trim() || vp.tag
    const patch = next.viewpoints[selectedView]!
    if (patch.label === label && patch.tag === tag) return true
    patch.label = label
    patch.tag = tag
    deps.setState(next)
    notifyDirty()
    return true
  }

  return {
    renderAll,
    refreshMediaCard,
    selectDockTab,
    clearDockSelection,
    flushCardEdits,
    flushTrackOrderFromPreview,
    getSelectedView: () => selectedView,
  }
}
