import { bindTap } from '../ui/bindTap'

export type SplatPinLike = { id: string; label: string }

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Pin visível no explorador / tela principal (Gaussian Splat). */
export function createExplorerSplatPin(
  pin: SplatPinLike,
  index = 0,
  onClick?: () => void,
): HTMLElement {
  const marker = document.createElement('div')
  marker.className = 'splat-pin-marker'
  marker.id = `splat-pin-el-${pin.id}`
  marker.style.setProperty('--poi-delay', `${index * 0.11}s`)
  marker.innerHTML = `
    <div class="splat-pin-marker__actions">
      <span class="poi-ring poi-ring--1" aria-hidden="true"></span>
      <span class="poi-ring poi-ring--2" aria-hidden="true"></span>
      <span class="poi-ring poi-ring--3" aria-hidden="true"></span>
      <span class="poi-glow" aria-hidden="true"></span>
      <span class="poi-stem" aria-hidden="true"></span>
      <button type="button" class="splat-pin-marker__btn poi-btn" aria-label="${escapeAttr(pin.label)}">
        <span class="poi-btn-core" aria-hidden="true"></span>
      </button>
    </div>
    <div class="splat-pin-marker__name poi-name">${escapeHtml(pin.label)}</div>
  `
  if (onClick) {
    const btn = marker.querySelector('.splat-pin-marker__btn') as HTMLElement
    bindTap(btn, (e) => {
      e.stopPropagation()
      onClick()
    }, { stopPropagation: true })
  }
  return marker
}

/** Pin na prévia do editor Gaussian Splat — mesmo DOM que pins de panorâmica. */
export function createEditorSplatPin(
  pin: SplatPinLike,
  selected: boolean,
  onClick?: () => void,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'edit-pin' + (selected ? ' selected' : '')
  el.dataset.id = pin.id
  el.innerHTML = `
    <div class="edit-pin-dot">+</div>
    <div class="edit-pin-label">${escapeHtml(pin.label)}</div>
  `
  if (onClick) {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }
  return el
}
