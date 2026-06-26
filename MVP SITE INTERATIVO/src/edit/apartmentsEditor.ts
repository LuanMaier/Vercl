import {
  APT_MAIN_PAGE_ID,
  apartmentMediaKey,
  type ApartmentItem,
  type ApartmentPage,
  type ApartmentPageType,
} from '../config/apartments'
import {
  ensureAptMainPage,
  resolveApartmentPageMediaPath,
  withAptMainPageOnly,
} from '../config/apartmentPages'
import { getProjectApartmentLoopVideoPath } from '../config/projectMedia'
import {
  isProjectSaveAvailable,
  removeMediaFromProject,
  saveApartmentsToProject,
  saveMediaToProject,
} from '../admin/projectSave'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { captureVideoPosterObjectUrl } from '../core/apartmentFaceMedia'
import { resolveMediaPath } from '../core/paths'
import { attachDockDragSort } from '../ui/dockDragSort'
import { syncDockTabsLayout } from '../ui/dockLayout'

export type ApartmentsEditorState = ApartmentItem[]

const MAX_UNITS = 8
const MAX_VIDEO_MB = 120

type PendingFile = { file: File; previewUrl: string }
const pendingApartmentPoster: Record<string, PendingFile> = {}
const pendingApartmentVideo: Record<string, PendingFile> = {}
const pendingApartmentLoop: Record<string, PendingFile> = {}
const MEDIA_ICON = `<span class="dock-tab-video-icon dock-tab-video-icon--media" title="Mídia salva ou na prévia" aria-hidden="true">▶</span>`

type ShowToast = (msg: string) => void

export function hasPendingApartmentMedia(): boolean {
  return (
    Object.keys(pendingApartmentPoster).length > 0 ||
    Object.keys(pendingApartmentVideo).length > 0 ||
    Object.keys(pendingApartmentLoop).length > 0
  )
}

function aptMainPage(type: ApartmentPageType, label: string): ApartmentPage {
  return { id: APT_MAIN_PAGE_ID, type, label }
}

function resolveApartmentMediaMode(page: ReturnType<typeof ensureAptMainPage>): 'image' | 'video' | 'loop' {
  if (page.type === 'loop') return 'loop'
  if (page.type === 'video') return 'video'
  return 'image'
}

function unitHasMedia(item: ApartmentItem): boolean {
  if (pendingApartmentPoster[item.id] || pendingApartmentVideo[item.id] || pendingApartmentLoop[item.id]) {
    return true
  }
  const page = ensureAptMainPage(withAptMainPageOnly(item))
  return Boolean(
    resolveApartmentPageMediaPath(item.id, page) ||
      getProjectApartmentLoopVideoPath(apartmentMediaKey(item.id, page.id)),
  )
}

function clearPendingApartmentPoster(itemId: string) {
  const p = pendingApartmentPoster[itemId]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingApartmentPoster[itemId]
}

function clearPendingApartmentVideo(itemId: string) {
  const p = pendingApartmentVideo[itemId]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingApartmentVideo[itemId]
}

function clearPendingApartmentLoop(itemId: string) {
  const p = pendingApartmentLoop[itemId]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingApartmentLoop[itemId]
}

function clearAllPendingApartmentMedia(itemId: string) {
  clearPendingApartmentPoster(itemId)
  clearPendingApartmentVideo(itemId)
  clearPendingApartmentLoop(itemId)
}

function slugApartmentId(label: string, existing: Set<string>) {
  const base =
    'apt-' +
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
  let id = base || 'apt-novo'
  let n = 2
  while (existing.has(id)) {
    id = `${base}-${n++}`
  }
  return id
}

export function getPendingApartmentPreviewUrl(itemId: string): string | null {
  return (
    pendingApartmentPoster[itemId]?.previewUrl ??
    pendingApartmentVideo[itemId]?.previewUrl ??
    pendingApartmentLoop[itemId]?.previewUrl ??
    null
  )
}

/** URL de imagem para a fachada no editor (highlights) — inclui poster do 1º frame de vídeo. */
export async function resolveApartmentFacadePreviewSrc(item: ApartmentItem): Promise<string | null> {
  const itemId = item.id
  const pendingPoster = pendingApartmentPoster[itemId]?.previewUrl
  if (pendingPoster) return pendingPoster

  const apt = withAptMainPageOnly(item)
  const page = ensureAptMainPage(apt)

  const pendingVideo = pendingApartmentVideo[itemId]?.previewUrl
  if (pendingVideo) return captureVideoPosterObjectUrl(pendingVideo)

  const pendingLoop = pendingApartmentLoop[itemId]?.previewUrl
  if (pendingLoop) return captureVideoPosterObjectUrl(pendingLoop)

  if (page.type === 'video') {
    const mediaRef = resolveApartmentPageMediaPath(itemId, page)
    if (!mediaRef) return null
    const src = (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)
    if (!src) return null
    return captureVideoPosterObjectUrl(src)
  }

  if (page.type === 'loop') {
    const posterRef = resolveApartmentPageMediaPath(itemId, page)
    if (posterRef) {
      const src = (await resolveMediaSrc(posterRef)) ?? resolveMediaPath(posterRef)
      if (src) return src
    }
    const loopPath = getProjectApartmentLoopVideoPath(apartmentMediaKey(itemId, page.id))
    if (loopPath) {
      const loopSrc = (await resolveMediaSrc(loopPath)) ?? resolveMediaPath(loopPath)
      if (loopSrc) return captureVideoPosterObjectUrl(loopSrc)
    }
    return null
  }

  const mediaRef = resolveApartmentPageMediaPath(itemId, page)
  if (!mediaRef) return null
  return (await resolveMediaSrc(mediaRef)) ?? resolveMediaPath(mediaRef)
}

export function initApartmentsEditor(deps: {
  unitListEl: HTMLElement
  unitCountEl: HTMLElement
  cardEl: HTMLElement
  newUnitInput: HTMLInputElement
  addUnitBtn: HTMLButtonElement
  removeUnitBtn: HTMLButtonElement
  showToast: ShowToast
  onDirty?: () => void
  onUnitSelected?: (id: string | null) => void
  onUnitRemoved?: (id: string) => void
  getState: () => ApartmentsEditorState
  setState: (s: ApartmentsEditorState) => void
}) {
  let selectedId: string | null = null
  let teardownDrag: (() => void) | null = null

  const notifyDirty = () => deps.onDirty?.()

  async function flushPendingMedia(state: ApartmentItem[]): Promise<ApartmentItem[]> {
    let next = state.map((i) => withAptMainPageOnly(i))
    for (const itemId of Object.keys(pendingApartmentPoster)) {
      const pending = pendingApartmentPoster[itemId]
      if (!pending) continue
      await saveMediaToProject(
        'apartment-media',
        pending.file,
        { item: itemId, page: APT_MAIN_PAGE_ID, mediaType: 'image' },
        { reload: false },
      )
      clearPendingApartmentPoster(itemId)
      next = next.map((i) =>
        i.id === itemId
          ? { ...i, pages: [aptMainPage('image', 'Imagem')] }
          : i,
      )
    }
    for (const itemId of Object.keys(pendingApartmentVideo)) {
      const pending = pendingApartmentVideo[itemId]
      if (!pending) continue
      await saveMediaToProject(
        'apartment-media',
        pending.file,
        { item: itemId, page: APT_MAIN_PAGE_ID, mediaType: 'video' },
        { reload: false },
      )
      clearPendingApartmentVideo(itemId)
      next = next.map((i) =>
        i.id === itemId
          ? { ...i, pages: [aptMainPage('video', 'Vídeo')] }
          : i,
      )
    }
    for (const itemId of Object.keys(pendingApartmentLoop)) {
      const pending = pendingApartmentLoop[itemId]
      if (!pending) continue
      await saveMediaToProject(
        'apartment-loop',
        pending.file,
        { item: itemId, page: APT_MAIN_PAGE_ID },
        { reload: false },
      )
      clearPendingApartmentLoop(itemId)
      next = next.map((i) =>
        i.id === itemId
          ? { ...i, pages: [aptMainPage('loop', 'Loop')] }
          : i,
      )
    }
    return next
  }

  async function finishApartments() {
    if (!(await isProjectSaveAvailable())) {
      deps.showToast('Rode npm run dev para gravar apartamentos no projeto')
      throw new Error('offline')
    }
    const keepSelection = selectedId
    try {
      let normalized = await flushPendingMedia(deps.getState())
      normalized = normalized.map((i) => ({
        ...i,
        label: i.label.trim() || i.id,
        tag: i.tag.trim() || 'Unidade',
        desc: i.desc?.trim() || undefined,
      }))
      deps.setState(normalized)
      await saveApartmentsToProject(normalized, { reload: false })
      selectedId = keepSelection
      notifyDirty()
      renderAll()
      deps.showToast('Menu de apartamentos salvo no projeto')
    } catch (err) {
      deps.showToast(err instanceof Error ? err.message : 'Falha ao salvar apartamentos')
      throw err
    }
  }

  function updateCount() {
    const n = deps.getState().length
    deps.unitCountEl.textContent =
      n === 0 ? 'nenhuma' : n === 1 ? '1 unidade' : `${n} unidades`
  }

  function renderUnitList() {
    const items = deps.getState()
    if (!items.length) {
      teardownDrag?.()
      teardownDrag = null
      deps.unitListEl.innerHTML = `<span class="edit-chips-empty">Nenhuma unidade — adicione abaixo.</span>`
      updateCount()
      return
    }

    deps.unitListEl.innerHTML = `
      <div class="dock-block">
        <p class="dock-apartments-eyebrow">Ordem no submenu</p>
        <div class="dock-tabs dock-tabs--sortable dock-apartments-tabs" id="edit-apartments-dock-tabs" role="tablist">
          ${items
            .map((item) => {
              const on = item.id === selectedId ? ' active' : ''
              const hasMedia = unitHasMedia(item)
              return `
                <button type="button" class="dock-tab dock-tab--sortable dock-apartment-tab${on}${hasMedia ? ' dock-tab--has-video' : ''}" data-id="${item.id}" draggable="true">
                  <span class="dock-tab-grip" aria-hidden="true"></span>
                  ${hasMedia ? MEDIA_ICON : ''}
                  <span class="dock-tab-glow" aria-hidden="true"></span>
                  <span class="dock-tab-label">${escapeHtml(item.label)}</span>
                  <span class="dock-tab-tag">${escapeHtml(item.tag)}</span>
                </button>
              `
            })
            .join('')}
        </div>
      </div>
    `

    syncDockTabsLayout(deps.unitListEl.querySelector('#edit-apartments-dock-tabs'))

    teardownDrag?.()
    const tabs = deps.unitListEl.querySelector('#edit-apartments-dock-tabs') as HTMLElement
    teardownDrag = attachDockDragSort(tabs, {
      keyAttr: 'data-id',
      parseKey: (v) => v,
      onOrderChange: (ids) => {
        const byId = new Map(deps.getState().map((i) => [i.id, i]))
        const next = ids.map((id) => byId.get(id)).filter((i): i is ApartmentItem => Boolean(i))
        if (next.length === deps.getState().length) {
          deps.setState(next)
          notifyDirty()
          deps.showToast('Ordem atualizada — Finalizar apartamentos')
        }
      },
    })

    tabs.querySelectorAll<HTMLButtonElement>('.dock-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dock-tab-grip')) return
        selectUnit(btn.dataset.id!)
      })
    })
    updateCount()
  }

  async function renderCard() {
    deps.removeUnitBtn.disabled = !selectedId

    if (!selectedId) {
      deps.cardEl.innerHTML = `
        <p class="edit-empty-poi">Selecione uma unidade ou crie um novo botão no submenu.</p>
      `
      return
    }

    let item = deps.getState().find((i) => i.id === selectedId)
    if (!item) {
      selectedId = null
      deps.onUnitSelected?.(null)
      renderAll()
      return
    }

    item = withAptMainPageOnly(item)
    const page = ensureAptMainPage(item)
    const mediaKey = apartmentMediaKey(item.id, page.id)
    const mediaMode = resolveApartmentMediaMode(page)
    const pendingPoster = pendingApartmentPoster[item.id]
    const pendingVideo = pendingApartmentVideo[item.id]
    const pendingLoop = pendingApartmentLoop[item.id]
    const savedPosterPath = mediaMode !== 'video' ? resolveApartmentPageMediaPath(item.id, page) : undefined
    const savedVideoPath = mediaMode === 'video' ? resolveApartmentPageMediaPath(item.id, page) : undefined
    const savedLoopPath = getProjectApartmentLoopVideoPath(mediaKey)
    const hasPendingPoster = Boolean(pendingPoster)
    const hasSavedPoster = Boolean(savedPosterPath)
    const hasPendingVideo = Boolean(pendingVideo)
    const hasSavedVideo = Boolean(savedVideoPath)
    const hasPendingLoop = Boolean(pendingLoop)
    const hasSavedLoop = Boolean(savedLoopPath)

    let posterStatus = 'Sem imagem de capa'
    if (hasPendingPoster) posterStatus = 'Prévia — clique Salvar'
    else if (hasSavedPoster) posterStatus = 'Salva ✓'

    let videoStatus = 'Sem vídeo'
    if (hasPendingVideo) videoStatus = 'Prévia — clique Salvar'
    else if (hasSavedVideo) videoStatus = 'Salvo ✓ (vídeo no disco)'

    let loopStatus = 'Nenhum loop salvo'
    if (hasPendingLoop) loopStatus = 'Prévia — clique Salvar'
    else if (hasSavedLoop) loopStatus = 'Salvo ✓ (loop no disco)'

    const posterThumbSrc =
      pendingPoster?.previewUrl ??
      (savedPosterPath ? (await resolveMediaSrc(savedPosterPath)) ?? '' : '')
    const loopThumbSrc =
      pendingLoop?.previewUrl ?? (savedLoopPath ? (await resolveMediaSrc(savedLoopPath)) ?? '' : '')

    const modeBlock = `
      <div class="edit-idle-mode-row edit-btn-row">
        <button type="button" class="edit-btn edit-btn--ghost${mediaMode === 'image' ? ' active' : ''}" id="apt-mode-image">Imagem fixa</button>
        <button type="button" class="edit-btn edit-btn--ghost${mediaMode === 'video' ? ' active' : ''}" id="apt-mode-video">Vídeo</button>
        <button type="button" class="edit-btn edit-btn--ghost${mediaMode === 'loop' ? ' active' : ''}" id="apt-mode-loop">Vídeo em loop</button>
      </div>`
    const posterBlock =
      mediaMode === 'image' || mediaMode === 'loop'
        ? `
      <span class="edit-field-label">${mediaMode === 'loop' ? 'Imagem de capa' : 'Imagem da unidade'}</span>
      <span class="edit-badge ${hasPendingPoster ? 'is-warn' : hasSavedPoster ? 'is-ok' : ''}">${posterStatus}</span>
      ${posterThumbSrc ? `<img class="edit-preview edit-preview--sm" src="${posterThumbSrc}" alt="" />` : ''}
      <p class="edit-card-hint">${mediaMode === 'loop' ? 'Poster enquanto o loop carrega.' : 'Exibida ao abrir a unidade.'}</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="apt-poster-file" accept="image/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="apt-poster-save" ${hasPendingPoster ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="apt-poster-clear" ${hasSavedPoster || hasPendingPoster ? '' : 'disabled'}>Limpar</button>
      </div>`
        : ''
    const videoBlock =
      mediaMode === 'video'
        ? `
      <span class="edit-field-label">Vídeo da unidade</span>
      <span class="edit-badge ${hasPendingVideo ? 'is-warn' : hasSavedVideo ? 'is-ok' : ''}">${videoStatus}</span>
      <p class="edit-card-hint">One-shot ao abrir a unidade no submenu.</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="apt-video-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="apt-video-save" ${hasPendingVideo ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="apt-video-clear" ${hasSavedVideo || hasPendingVideo ? '' : 'disabled'}>Limpar</button>
      </div>`
        : ''
    const loopBlock = `
      <span class="edit-field-label">Vídeo em loop</span>
      <span class="edit-badge ${hasPendingLoop ? 'is-warn' : hasSavedLoop ? 'is-ok' : ''}">${loopStatus}</span>
      ${loopThumbSrc ? `<video class="edit-preview edit-preview--video edit-preview--sm" src="${loopThumbSrc}" muted loop autoplay playsinline></video>` : ''}
      <p class="edit-card-hint">Sem áudio, repete na unidade — encaixe <strong>contain</strong> (sem esticar).</p>
      <div class="edit-btn-row">
        <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="apt-loop-file" accept="video/webm,video/mp4,video/*" hidden /></label>
        <button type="button" class="edit-btn edit-btn--gold" id="apt-loop-save" ${hasPendingLoop ? '' : 'disabled'}>Salvar</button>
        <button type="button" class="edit-btn edit-btn--text" id="apt-loop-clear" ${hasSavedLoop || hasPendingLoop ? '' : 'disabled'}>Limpar</button>
      </div>`

    deps.cardEl.innerHTML = `
      <div class="edit-field">
        <label class="edit-field-label" for="apt-label">Nome no menu</label>
        <input type="text" id="apt-label" class="edit-input" maxlength="40" value="${escapeAttr(item.label)}" />
        <p class="edit-card-hint">Texto no botão da segunda faixa (Apartamentos).</p>
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="apt-tag">Tag</label>
        <input type="text" id="apt-tag" class="edit-input" maxlength="28" value="${escapeAttr(item.tag)}" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="apt-desc">Descrição / nota CRM</label>
        <textarea id="apt-desc" class="edit-input edit-textarea" rows="3" maxlength="320">${escapeHtml(item.desc ?? '')}</textarea>
      </div>
      <div class="edit-field">
        <span class="edit-field-label">Mídia da unidade</span>
        <p class="edit-card-desc">Imagem, vídeo one-shot ou loop. <strong>Salvar</strong> grava o arquivo; <strong>Finalizar apartamentos</strong> grava nomes e ordem.</p>
        ${modeBlock}
        ${posterBlock}
        ${videoBlock}
        <div id="apt-loop-section"${mediaMode === 'loop' ? '' : ' hidden'}>${loopBlock}</div>
      </div>
    `

    bindCardHandlers(item, page, mediaMode)
  }

  function bindCardHandlers(
    item: ApartmentItem,
    page: ReturnType<typeof ensureAptMainPage>,
    mediaMode: 'image' | 'video' | 'loop',
  ) {
    const labelIn = document.getElementById('apt-label') as HTMLInputElement
    const tagIn = document.getElementById('apt-tag') as HTMLInputElement
    const descIn = document.getElementById('apt-desc') as HTMLTextAreaElement

    const commitMeta = () => {
      const label = labelIn.value.trim()
      if (!label) {
        labelIn.value = item.label
        deps.showToast('O nome não pode ficar vazio')
        return
      }
      const st = deps.getState().map((i) =>
        i.id === item.id
          ? withAptMainPageOnly({
              ...i,
              label,
              tag: tagIn.value.trim() || i.tag,
              desc: descIn.value.trim() || undefined,
            })
          : i,
      )
      deps.setState(st)
      notifyDirty()
      renderUnitList()
      deps.showToast('Textos na prévia — Finalizar apartamentos')
    }
    labelIn.addEventListener('change', commitMeta)
    tagIn.addEventListener('change', commitMeta)
    descIn.addEventListener('change', commitMeta)

    const bindClick = (id: string, handler: () => void) => {
      document.getElementById(id)?.addEventListener('click', handler)
    }
    const bindChange = (id: string, handler: (e: Event) => void) => {
      document.getElementById(id)?.addEventListener('change', handler)
    }

    const setPageType = (type: ApartmentPageType) => {
      const st = deps.getState().map((i) =>
        i.id === item.id
          ? {
              ...withAptMainPageOnly(i),
              pages: [aptMainPage(type, type === 'loop' ? 'Loop' : type === 'video' ? 'Vídeo' : 'Imagem')],
            }
          : i,
      )
      deps.setState(st)
      notifyDirty()
      void renderCard()
    }

    bindClick('apt-mode-image', () => setPageType('image'))
    bindClick('apt-mode-video', () => {
      setPageType('video')
      if (!pendingApartmentVideo[item.id] && !resolveApartmentPageMediaPath(item.id, page)) {
        deps.showToast('Envie e salve um vídeo')
      }
    })
    bindClick('apt-mode-loop', () => {
      setPageType('loop')
      if (!pendingApartmentLoop[item.id] && !getProjectApartmentLoopVideoPath(apartmentMediaKey(item.id, page.id))) {
        deps.showToast('Envie e salve um loop')
      }
    })

    if (mediaMode === 'image' || mediaMode === 'loop') {
      bindChange('apt-poster-file', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file?.type.startsWith('image/')) {
          deps.showToast('Use JPG, PNG ou WebP')
          return
        }
        clearPendingApartmentPoster(item.id)
        pendingApartmentPoster[item.id] = { file, previewUrl: URL.createObjectURL(file) }
        notifyDirty()
        void renderCard()
        deps.showToast('Imagem na prévia — clique Salvar')
      })

      bindClick('apt-poster-save', async () => {
        const pending = pendingApartmentPoster[item.id]
        if (!pending) {
          deps.showToast('Envie uma imagem antes de salvar')
          return
        }
        try {
          await saveMediaToProject(
            'apartment-media',
            pending.file,
            { item: item.id, page: APT_MAIN_PAGE_ID, mediaType: 'image' },
            { reload: false },
          )
          clearPendingApartmentPoster(item.id)
          const st = deps.getState().map((i) =>
            i.id === item.id
              ? {
                  ...withAptMainPageOnly(i),
                  pages: [aptMainPage(mediaMode === 'loop' ? 'loop' : 'image', 'Imagem')],
                }
              : i,
          )
          deps.setState(st)
          notifyDirty()
          void renderCard()
          renderUnitList()
          deps.showToast('Imagem no disco — Finalizar apartamentos')
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
        }
      })

      bindClick('apt-poster-clear', async () => {
        clearPendingApartmentPoster(item.id)
        try {
          await removeMediaFromProject('apartment-media', { item: item.id, page: APT_MAIN_PAGE_ID }, { reload: false }).catch(() => {})
          notifyDirty()
          void renderCard()
          deps.showToast('Imagem removida')
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
        }
      })
    }

    if (mediaMode === 'video') {
      bindChange('apt-video-file', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file?.type.startsWith('video/')) {
          deps.showToast('Use MP4 ou WebM')
          return
        }
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
          return
        }
        clearPendingApartmentVideo(item.id)
        pendingApartmentVideo[item.id] = { file, previewUrl: URL.createObjectURL(file) }
        setPageType('video')
        deps.showToast('Vídeo na prévia — clique Salvar')
      })

      bindClick('apt-video-save', async () => {
        const pending = pendingApartmentVideo[item.id]
        if (!pending) {
          deps.showToast('Envie um vídeo antes de salvar')
          return
        }
        try {
          await saveMediaToProject(
            'apartment-media',
            pending.file,
            { item: item.id, page: APT_MAIN_PAGE_ID, mediaType: 'video' },
            { reload: false },
          )
          clearPendingApartmentVideo(item.id)
          const st = deps.getState().map((i) =>
            i.id === item.id ? withAptMainPageOnly({ ...i, pages: [aptMainPage('video', 'Vídeo')] }) : i,
          )
          deps.setState(st)
          notifyDirty()
          void renderCard()
          renderUnitList()
          deps.onUnitSelected?.(item.id)
          deps.showToast('Vídeo no disco — Finalizar apartamentos')
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
        }
      })

      bindClick('apt-video-clear', async () => {
        clearPendingApartmentVideo(item.id)
        try {
          await removeMediaFromProject('apartment-media', { item: item.id, page: APT_MAIN_PAGE_ID }, { reload: false }).catch(() => {})
          notifyDirty()
          void renderCard()
          deps.showToast('Vídeo removido')
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
        }
      })
    }

    bindChange('apt-loop-file', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file?.type.startsWith('video/')) {
        deps.showToast('Use MP4 ou WebM')
        return
      }
      if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
        deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
        return
      }
      clearPendingApartmentLoop(item.id)
      pendingApartmentLoop[item.id] = { file, previewUrl: URL.createObjectURL(file) }
      setPageType('loop')
      deps.showToast('Loop na prévia — clique Salvar')
    })

    bindClick('apt-loop-save', async () => {
      const pending = pendingApartmentLoop[item.id]
      if (!pending) {
        deps.showToast('Envie um loop antes de salvar')
        return
      }
      try {
        await saveMediaToProject('apartment-loop', pending.file, { item: item.id, page: APT_MAIN_PAGE_ID }, { reload: false })
        clearPendingApartmentLoop(item.id)
        const st = deps.getState().map((i) =>
          i.id === item.id ? withAptMainPageOnly({ ...i, pages: [aptMainPage('loop', 'Loop')] }) : i,
        )
        deps.setState(st)
        notifyDirty()
        void renderCard()
        renderUnitList()
        deps.showToast('Loop no disco — Finalizar apartamentos')
      } catch (err) {
        deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })

    bindClick('apt-loop-clear', async () => {
      clearPendingApartmentLoop(item.id)
      try {
        await removeMediaFromProject('apartment-loop', { item: item.id, page: APT_MAIN_PAGE_ID }, { reload: false }).catch(() => {})
        const st = deps.getState().map((i) =>
          i.id === item.id ? withAptMainPageOnly({ ...i, pages: [aptMainPage('image', 'Imagem')] }) : i,
        )
        deps.setState(st)
        notifyDirty()
        void renderCard()
        deps.showToast('Loop removido')
      } catch (err) {
        deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })
  }

  async function removeAllMediaForItem(itemId: string) {
    clearAllPendingApartmentMedia(itemId)
    await removeMediaFromProject('apartment-media', { item: itemId, page: APT_MAIN_PAGE_ID }, { reload: false }).catch(() => {})
    await removeMediaFromProject('apartment-loop', { item: itemId, page: APT_MAIN_PAGE_ID }, { reload: false }).catch(() => {})
  }

  function selectUnit(id: string) {
    selectedId = id
    deps.onUnitSelected?.(id)
    renderAll()
  }

  function renderAll() {
    renderUnitList()
    void renderCard()
  }

  deps.addUnitBtn.addEventListener('click', () => {
    const label = deps.newUnitInput.value.trim()
    if (!label) {
      deps.showToast('Digite o nome da unidade')
      return
    }
    if (deps.getState().length >= MAX_UNITS) {
      deps.showToast(`Máximo de ${MAX_UNITS} unidades no submenu`)
      return
    }
    const ids = new Set(deps.getState().map((i) => i.id))
    const id = slugApartmentId(label, ids)
    const next: ApartmentItem = { id, label, tag: 'Unidade', pages: [] }
    deps.setState([...deps.getState(), next])
    deps.newUnitInput.value = ''
    selectedId = id
    notifyDirty()
    renderAll()
    deps.showToast('Unidade criada — Finalizar apartamentos')
  })

  deps.removeUnitBtn.addEventListener('click', () => {
    const item = deps.getState().find((i) => i.id === selectedId)
    if (!item || !confirm(`Remover "${item.label}" e mídia do submenu?`)) return
    void removeAllMediaForItem(item.id).then(() => {
      deps.onUnitRemoved?.(item.id)
      deps.setState(deps.getState().filter((i) => i.id !== selectedId))
      selectedId = null
      deps.onUnitSelected?.(null)
      notifyDirty()
      renderAll()
      deps.showToast('Unidade removida — Finalizar apartamentos')
    })
  })

  return {
    renderAll,
    selectUnit,
    getSelectedUnitId: () => selectedId,
    finish: finishApartments,
    async persist() {
      await finishApartments()
    },
  }
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(s: string) {
  return escapeAttr(s)
}
