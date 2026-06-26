import {
  removeMediaFromProject,
  saveMediaToProject,
} from '../admin/projectSave'
import {
  getProjectLightSliderVideoPath,
  getProjectSolarFrameFinal,
  getProjectSolarFrameInitial,
} from '../config/projectMedia'
import { POSTERS } from '../config/posters'
import { resolveMediaPath } from '../core/paths'
import { resolveMediaSrc } from '../media/resolvePoiMedia'

type PendingMedia = { file: File; previewUrl: string }
type ShowToast = (msg: string) => void
type SolarSlot = 'video' | 'frame-initial' | 'frame-final'

const pendingSolar: Record<string, PendingMedia> = {}

function pendingKey(view: number, slot: SolarSlot) {
  return `${view}:${slot}`
}

function clearPending(key: string) {
  const p = pendingSolar[key]
  if (!p) return
  URL.revokeObjectURL(p.previewUrl)
  delete pendingSolar[key]
}

function solarFieldBlock(
  title: string,
  hint: string,
  slot: SolarSlot,
  kindLabel: string,
  accept: string,
  hasPending: boolean,
  hasSaved: boolean,
) {
  return `
    <details class="edit-mood" open>
      <summary class="edit-mood-sum">${title}</summary>
      <div class="edit-mood-body">
        <p class="edit-card-hint">${hint}</p>
        <div class="edit-field">
          <span class="edit-field-label">${kindLabel}</span>
          <span class="edit-badge ${hasPending ? 'is-warn' : hasSaved ? 'is-ok' : ''}">
            ${hasPending ? 'Prévia' : hasSaved ? 'Salvo' : 'Pendente'}
          </span>
          <div class="edit-btn-row">
            <label class="edit-btn edit-btn--ghost">Enviar<input type="file" data-slot="${slot}" accept="${accept}" hidden /></label>
            <button type="button" class="edit-btn edit-btn--gold" data-save="${slot}" ${hasPending ? '' : 'disabled'}>Salvar</button>
            <button type="button" class="edit-btn edit-btn--text" data-clear="${slot}" ${hasSaved || hasPending ? '' : 'disabled'}>Limpar</button>
          </div>
        </div>
      </div>
    </details>
  `
}

export async function resolveSolarFrameInitialSrc(
  viewIndex: number,
): Promise<string | undefined> {
  const ref = getProjectSolarFrameInitial(viewIndex) ?? POSTERS[viewIndex]
  if (!ref) return undefined
  return (await resolveMediaSrc(ref)) ?? resolveMediaPath(ref)
}

export async function renderInsolationPanel(
  container: HTMLElement,
  viewIndex: number,
  showToast: ShowToast,
  onPreviewChange: () => void,
  onDirty?: () => void,
) {
  const notifyDirty = () => onDirty?.()

  const slots: { slot: SolarSlot; saved: boolean; pending: boolean }[] = [
    {
      slot: 'video',
      saved: Boolean(getProjectLightSliderVideoPath(viewIndex)),
      pending: Boolean(pendingSolar[pendingKey(viewIndex, 'video')]),
    },
    {
      slot: 'frame-initial',
      saved: Boolean(getProjectSolarFrameInitial(viewIndex)),
      pending: Boolean(pendingSolar[pendingKey(viewIndex, 'frame-initial')]),
    },
    {
      slot: 'frame-final',
      saved: Boolean(getProjectSolarFrameFinal(viewIndex)),
      pending: Boolean(pendingSolar[pendingKey(viewIndex, 'frame-final')]),
    },
  ]

  container.innerHTML = `
    <p class="edit-card-desc">Slider no site: <strong>esquerda</strong> = frame inicial (dia), <strong>meio</strong> = vídeo, <strong>direita</strong> = frame final (noite em alta).</p>
    ${solarFieldBlock(
      'Posição Solar',
      'Vídeo contínuo dia → noite. O player arrasta o slider para percorrer os frames.',
      'video',
      'Vídeo',
      'video/webm,video/mp4,video/*',
      slots[0].pending,
      slots[0].saved,
    )}
    ${solarFieldBlock(
      'Frame inicial',
      'Imagem do dia (sol). Aparece com o slider na extrema esquerda e ao abrir a panorâmica.',
      'frame-initial',
      'Imagem',
      'image/*',
      slots[1].pending,
      slots[1].saved,
    )}
    ${solarFieldBlock(
      'Frame final',
      'Imagem noturna em alta. Aparece com o slider na extrema direita.',
      'frame-final',
      'Imagem',
      'image/*',
      slots[2].pending,
      slots[2].saved,
    )}
  `

  const saveKind: Record<SolarSlot, 'solar-video' | 'solar-frame-initial' | 'solar-frame-final'> = {
    video: 'solar-video',
    'frame-initial': 'solar-frame-initial',
    'frame-final': 'solar-frame-final',
  }

  container.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      const slot = input.dataset.slot as SolarSlot
      if (!file || !slot) return

      if (slot === 'video') {
        if (!file.type.startsWith('video/')) {
          showToast('Use WebM ou MP4')
          return
        }
        if (file.size > 120 * 1024 * 1024) {
          showToast('Vídeo muito grande (máx. 120 MB)')
          return
        }
      } else if (!file.type.startsWith('image/')) {
        showToast('Use JPG, PNG ou WebP')
        return
      }

      const key = pendingKey(viewIndex, slot)
      clearPending(key)
      pendingSolar[key] = { file, previewUrl: URL.createObjectURL(file) }
      if (slot === 'frame-initial') onPreviewChange()
      notifyDirty()
      void renderInsolationPanel(container, viewIndex, showToast, onPreviewChange, onDirty)
      showToast('Prévia pronta — clique Salvar')
    })
  })

  container.querySelectorAll<HTMLButtonElement>('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slot = btn.dataset.save as SolarSlot
      const key = pendingKey(viewIndex, slot)
      const pending = pendingSolar[key]
      if (!pending) {
        showToast('Envie o arquivo antes')
        return
      }
      try {
        await saveMediaToProject(
          saveKind[slot],
          pending.file,
          { view: String(viewIndex) },
          { reload: false },
        )
        clearPending(key)
        if (slot === 'frame-initial') onPreviewChange()
        notifyDirty()
        void renderInsolationPanel(container, viewIndex, showToast, onPreviewChange, onDirty)
        showToast('Salvo no projeto')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })
  })

  container.querySelectorAll<HTMLButtonElement>('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slot = btn.dataset.clear as SolarSlot
      const key = pendingKey(viewIndex, slot)
      clearPending(key)
      try {
        await removeMediaFromProject(
          saveKind[slot],
          { view: String(viewIndex) },
          { reload: false },
        )
        if (slot === 'frame-initial') onPreviewChange()
        notifyDirty()
        void renderInsolationPanel(container, viewIndex, showToast, onPreviewChange, onDirty)
        showToast('Removido')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Use npm run dev')
      }
    })
  })
}

export async function finishInsolationSettings(viewIndex: number, showToast: ShowToast) {
  await flushAllInsolationPending()
  showToast(`Posição Solar salva (vista ${viewIndex})`)
}

export async function flushAllInsolationPending() {
  const kindMap: Record<SolarSlot, 'solar-video' | 'solar-frame-initial' | 'solar-frame-final'> = {
    video: 'solar-video',
    'frame-initial': 'solar-frame-initial',
    'frame-final': 'solar-frame-final',
  }
  for (const [key, pending] of Object.entries(pendingSolar)) {
    const [view, slot] = key.split(':') as [string, SolarSlot]
    if (!view || !slot) continue
    await saveMediaToProject(kindMap[slot], pending.file, { view }, { reload: false })
    clearPending(key)
  }
}

/** Prévia do frame inicial no editor */
export function getPendingSolarFrameInitialSrc(viewIndex: number): string | undefined {
  return pendingSolar[pendingKey(viewIndex, 'frame-initial')]?.previewUrl
}

export function hasInsolationPending(): boolean {
  return Object.keys(pendingSolar).length > 0
}
