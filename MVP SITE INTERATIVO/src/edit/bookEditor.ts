import { BOOK_MAIN_PAGE_ID, type InteriorItem } from '../config/interiors'
import {
  ensureBookMainPage,
  resolveInteriorPageMediaPath,
  withBookMainPageOnly,
} from '../config/interiorPages'
import {
  isProjectSaveAvailable,
  removeMediaFromProject,
  saveInteriorsToProject,
  saveMediaToProject,
} from '../admin/projectSave'
import { resolveMediaSrc } from '../media/resolvePoiMedia'
import { attachDockDragSort } from '../ui/dockDragSort'
import { syncDockTabsLayout } from '../ui/dockLayout'

export type BookEditorState = InteriorItem[]

type PendingMedia = { file: File; previewUrl: string; type: 'video' | 'image' }
type ShowToast = (msg: string) => void

const MAX_VIDEO_MB = 120
const pendingBookMedia: Record<string, PendingMedia> = {}
const MEDIA_ICON = `<span class="dock-tab-video-icon dock-tab-video-icon--media" title="Mídia salva ou na prévia" aria-hidden="true">▶</span>`

export function hasPendingBookMedia(): boolean {
  return Object.keys(pendingBookMedia).length > 0
}

function ambienteHasMedia(item: InteriorItem): boolean {
  if (pendingBookMedia[item.id]) return true
  const page = ensureBookMainPage(withBookMainPageOnly(item))
  return Boolean(resolveInteriorPageMediaPath(item.id, page))
}

function pendingKey(itemId: string) {
  return itemId
}

function clearPendingItemMedia(itemId: string) {
  const p = pendingBookMedia[itemId]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingBookMedia[itemId]
}

function slugInteriorId(label: string, existing: Set<string>) {
  const base =
    'int-' +
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
  let id = base || 'int-novo'
  let n = 2
  while (existing.has(id)) {
    id = `${base}-${n++}`
  }
  return id
}

export function initBookEditor(deps: {
  ambienteListEl: HTMLElement
  ambienteCountEl: HTMLElement
  cardEl: HTMLElement
  newAmbienteInput: HTMLInputElement
  addAmbienteBtn: HTMLButtonElement
  removeAmbienteBtn: HTMLButtonElement
  showToast: ShowToast
  onDirty?: () => void
  getState: () => BookEditorState
  setState: (s: BookEditorState) => void
}) {
  let selectedId: string | null = null
  let teardownBookDrag: (() => void) | null = null

  const notifyDirty = () => deps.onDirty?.()

  async function flushPendingMedia(state: InteriorItem[]): Promise<InteriorItem[]> {
    let next = state.map((i) => withBookMainPageOnly(i))
    for (const itemId of Object.keys(pendingBookMedia)) {
      const pending = pendingBookMedia[itemId]
      if (!pending) continue
      await saveMediaToProject(
        'interior-media',
        pending.file,
        {
          item: itemId,
          page: BOOK_MAIN_PAGE_ID,
          mediaType: pending.type,
        },
        { reload: false },
      )
      clearPendingItemMedia(itemId)
      next = next.map((i) =>
        i.id === itemId
          ? { ...i, pages: [{ id: BOOK_MAIN_PAGE_ID, type: pending.type, label: 'Mídia' }] }
          : i,
      )
    }
    return next
  }

  async function finishBook() {
    if (!(await isProjectSaveAvailable())) {
      deps.showToast('Rode npm run dev para gravar o book no projeto')
      throw new Error('offline')
    }
    const keepSelection = selectedId
    try {
      let normalized = await flushPendingMedia(deps.getState())
      normalized = normalized.map((i) => withBookMainPageOnly(i))
      deps.setState(normalized)
      await saveInteriorsToProject(normalized, { reload: false })
      selectedId = keepSelection
      notifyDirty()
      renderAll()
      deps.showToast('Book salvo no projeto')
    } catch (err) {
      deps.showToast(err instanceof Error ? err.message : 'Falha ao salvar book')
      throw err
    }
  }

  function updateCount() {
    const n = deps.getState().length
    deps.ambienteCountEl.textContent =
      n === 0 ? 'nenhum' : n === 1 ? '1 ambiente' : `${n} ambientes`
  }

  function renderAmbienteList() {
    const items = deps.getState()
    if (!items.length) {
      teardownBookDrag?.()
      teardownBookDrag = null
      deps.ambienteListEl.innerHTML = `<span class="edit-chips-empty">Nenhum ambiente — adicione abaixo.</span>`
      updateCount()
      return
    }

    deps.ambienteListEl.innerHTML = `
      <div class="dock-block">
        <p class="dock-interiors-eyebrow">Ordem no submenu</p>
        <div class="dock-tabs dock-tabs--sortable dock-interiors-tabs" id="edit-book-dock-tabs" role="tablist">
          ${items
            .map((item) => {
              const on = item.id === selectedId ? ' active' : ''
              const hasMedia = ambienteHasMedia(item)
              return `
                <button type="button" class="dock-tab dock-tab--sortable${on}${hasMedia ? ' dock-tab--has-video' : ''}" data-id="${item.id}" draggable="true">
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

    syncDockTabsLayout(deps.ambienteListEl.querySelector('#edit-book-dock-tabs'))

    teardownBookDrag?.()
    const tabs = deps.ambienteListEl.querySelector('#edit-book-dock-tabs') as HTMLElement
    teardownBookDrag = attachDockDragSort(tabs, {
      keyAttr: 'data-id',
      parseKey: (v) => v,
      onOrderChange: (ids) => {
        const byId = new Map(deps.getState().map((i) => [i.id, i]))
        const next = ids.map((id) => byId.get(id)).filter((i): i is InteriorItem => Boolean(i))
        if (next.length === deps.getState().length) {
          deps.setState(next)
          notifyDirty()
          deps.showToast('Ordem atualizada — Finalizar book')
        }
      },
    })

    tabs.querySelectorAll<HTMLButtonElement>('.dock-tab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dock-tab-grip')) return
        selectAmbiente(btn.dataset.id!)
      })
    })
    updateCount()
  }

  async function renderCard() {
    deps.removeAmbienteBtn.disabled = !selectedId

    if (!selectedId) {
      deps.cardEl.innerHTML = `
        <p class="edit-empty-poi">Selecione um ambiente ou crie um novo capítulo do book.</p>
      `
      return
    }

    let item = deps.getState().find((i) => i.id === selectedId)
    if (!item) {
      selectedId = null
      renderAll()
      return
    }

    item = withBookMainPageOnly(item)
    const page = ensureBookMainPage(item)
    const pk = pendingKey(item.id)
    const pending = pendingBookMedia[pk]
    const savedPath = resolveInteriorPageMediaPath(item.id, page)
    const hasPending = Boolean(pending)
    const hasSaved = Boolean(savedPath)
    const mediaType = pending?.type ?? page.type
    const isVideo = mediaType === 'video'

    let status = 'Nenhum arquivo'
    if (hasPending) status = isVideo ? 'Prévia de vídeo — clique Salvar' : 'Prévia de imagem — clique Salvar'
    else if (hasSaved) status = isVideo ? 'Salvo ✓ (vídeo no disco)' : 'Salvo ✓ (imagem no disco)'

    let thumbHtml = ''
    if (!isVideo || pending) {
      const thumbSrc =
        pending?.previewUrl ?? (savedPath && !isVideo ? (await resolveMediaSrc(savedPath)) ?? '' : '')
      if (thumbSrc) {
        thumbHtml = `<img class="edit-preview edit-preview--sm" src="${thumbSrc}" alt="" />`
      }
    }

    deps.cardEl.innerHTML = `
      <div class="edit-field">
        <label class="edit-field-label" for="book-label">Nome no menu</label>
        <input type="text" id="book-label" class="edit-input" maxlength="40" value="${escapeAttr(item.label)}" />
        <p class="edit-card-hint">Texto no botão da segunda faixa (Interiores).</p>
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="book-tag">Tag</label>
        <input type="text" id="book-tag" class="edit-input" maxlength="28" value="${escapeAttr(item.tag)}" />
      </div>
      <div class="edit-field">
        <label class="edit-field-label" for="book-desc">Descrição</label>
        <textarea id="book-desc" class="edit-input edit-textarea" rows="2" maxlength="240">${escapeHtml(item.desc ?? '')}</textarea>
      </div>
      <div class="edit-field">
        <span class="edit-field-label">Mídia do ambiente</span>
        <p class="edit-card-desc">Um vídeo <strong>ou</strong> uma imagem por ambiente. <strong>Salvar</strong> grava o arquivo; <strong>Finalizar book</strong> grava nomes e ordem.</p>
        <span class="edit-badge ${hasPending ? 'is-warn' : hasSaved ? 'is-ok' : ''}">${status}</span>
        ${thumbHtml}
        <div class="edit-btn-row">
          <label class="edit-btn edit-btn--ghost">Enviar<input type="file" id="book-media-file" accept="image/*,video/webm,video/mp4,video/*" hidden /></label>
          <button type="button" class="edit-btn edit-btn--gold" id="book-media-save" ${hasPending ? '' : 'disabled'}>Salvar</button>
          <button type="button" class="edit-btn edit-btn--text" id="book-media-clear" ${hasSaved || hasPending ? '' : 'disabled'}>Limpar</button>
        </div>
      </div>
    `

    bindCardHandlers(item, page)
  }

  function bindCardHandlers(item: InteriorItem, page: ReturnType<typeof ensureBookMainPage>) {
    const labelIn = document.getElementById('book-label') as HTMLInputElement
    const tagIn = document.getElementById('book-tag') as HTMLInputElement
    const descIn = document.getElementById('book-desc') as HTMLTextAreaElement

    const commitMeta = () => {
      const label = labelIn.value.trim()
      if (!label) {
        labelIn.value = item.label
        deps.showToast('O nome não pode ficar vazio')
        return
      }
      const st = deps.getState().map((i) =>
        i.id === item.id
          ? withBookMainPageOnly({
              ...i,
              label,
              tag: tagIn.value.trim() || i.tag,
              desc: descIn.value.trim() || undefined,
            })
          : i,
      )
      deps.setState(st)
      notifyDirty()
      renderAmbienteList()
      deps.showToast('Textos na prévia — Finalizar book')
    }
    labelIn.addEventListener('change', commitMeta)
    tagIn.addEventListener('change', commitMeta)
    descIn.addEventListener('change', commitMeta)

    document.getElementById('book-media-file')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      let type: 'video' | 'image'
      if (file.type.startsWith('image/')) {
        type = 'image'
      } else if (file.type.startsWith('video/')) {
        if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
          deps.showToast(`Vídeo muito grande (máx. ${MAX_VIDEO_MB} MB)`)
          return
        }
        type = 'video'
      } else {
        deps.showToast('Use imagem (JPG, PNG, WebP) ou vídeo (WebM, MP4)')
        return
      }

      clearPendingItemMedia(item.id)
      pendingBookMedia[pendingKey(item.id)] = {
        file,
        previewUrl: URL.createObjectURL(file),
        type,
      }

      const st = deps.getState().map((i) =>
        i.id === item.id
          ? { ...i, pages: [{ id: BOOK_MAIN_PAGE_ID, type, label: 'Mídia' }] }
          : i,
      )
      deps.setState(st)
      notifyDirty()
      void renderCard()
      deps.showToast(
        type === 'video' ? 'Vídeo na prévia — clique Salvar' : 'Imagem na prévia — clique Salvar',
      )
    })

    document.getElementById('book-media-save')!.addEventListener('click', async () => {
      const pending = pendingBookMedia[pendingKey(item.id)]
      if (!pending) {
        deps.showToast('Envie um arquivo antes de salvar')
        return
      }
      try {
        await saveMediaToProject(
          'interior-media',
          pending.file,
          {
            item: item.id,
            page: BOOK_MAIN_PAGE_ID,
            mediaType: pending.type,
          },
          { reload: false },
        )
        clearPendingItemMedia(item.id)
        const st = deps.getState().map((i) =>
          i.id === item.id
            ? {
                ...withBookMainPageOnly(i),
                pages: [{ id: BOOK_MAIN_PAGE_ID, type: pending.type, label: 'Mídia' }],
              }
            : i,
        )
        deps.setState(st)
        notifyDirty()
        void renderCard()
        renderAmbienteList()
        deps.showToast('Mídia no disco — Finalizar book para textos/ordem')
      } catch (err) {
        deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })

    document.getElementById('book-media-clear')!.addEventListener('click', async () => {
      clearPendingItemMedia(item.id)
      const hadSaved = Boolean(resolveInteriorPageMediaPath(item.id, page))
      if (hadSaved) {
        try {
          await removeMediaFromProject(
            'interior-media',
            { item: item.id, page: BOOK_MAIN_PAGE_ID },
            { reload: false },
          ).catch(() => {})
          await removeMediaFromProject('interior-video', { id: item.id }, { reload: false }).catch(
            () => {},
          )
          await removeMediaFromProject('interior-poster', { id: item.id }, { reload: false }).catch(
            () => {},
          )
        } catch (err) {
          deps.showToast(err instanceof Error ? err.message : 'Use npm run dev')
          return
        }
      }
      const st = deps.getState().map((i) =>
        i.id === item.id
          ? { ...i, pages: [{ id: BOOK_MAIN_PAGE_ID, type: 'image' as const }] }
          : i,
      )
      deps.setState(st)
      notifyDirty()
      deps.showToast('Mídia removida — Finalizar book se alterou textos')
      void renderCard()
      renderAmbienteList()
    })
  }

  async function removeAllMediaForItem(itemId: string) {
    const item = deps.getState().find((i) => i.id === itemId)
    if (!item) return
    clearPendingItemMedia(itemId)
    await removeMediaFromProject(
      'interior-media',
      { item: itemId, page: BOOK_MAIN_PAGE_ID },
      { reload: false },
    ).catch(() => {})
    await removeMediaFromProject('interior-video', { id: itemId }, { reload: false }).catch(
      () => {},
    )
    await removeMediaFromProject('interior-poster', { id: itemId }, { reload: false }).catch(
      () => {},
    )
  }

  function selectAmbiente(id: string) {
    selectedId = id
    renderAll()
  }

  function renderAll() {
    renderAmbienteList()
    void renderCard()
  }

  deps.addAmbienteBtn.addEventListener('click', () => {
    const label = deps.newAmbienteInput.value.trim() || 'Novo ambiente'
    const ids = new Set(deps.getState().map((i) => i.id))
    const id = slugInteriorId(label, ids)
    const item: InteriorItem = {
      id,
      label,
      tag: 'Book',
      pages: [],
    }
    deps.setState([...deps.getState(), item])
    deps.newAmbienteInput.value = ''
    notifyDirty()
    selectAmbiente(id)
    deps.showToast('Ambiente criado — Finalizar book')
  })

  deps.removeAmbienteBtn.addEventListener('click', async () => {
    if (!selectedId) return
    const item = deps.getState().find((i) => i.id === selectedId)
    if (!item || !confirm(`Remover "${item.label}" e todas as mídias do book?`)) return
    try {
      await removeAllMediaForItem(item.id)
      deps.setState(deps.getState().filter((i) => i.id !== selectedId))
      selectedId = null
      notifyDirty()
      renderAll()
      deps.showToast('Ambiente removido — Finalizar book')
    } catch (err) {
      deps.showToast(err instanceof Error ? err.message : 'Falha')
    }
  })

  return {
    renderAll,
    selectAmbiente,
    getSelectedAmbienteId: () => selectedId,
    finish: finishBook,
    async persist() {
      await finishBook()
    },
  }
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(s: string) {
  return escapeAttr(s)
}
