type EditErrorBoundaryOptions = {
  onRecover?: () => void
}

let installed = false
let lastError: string | null = null

function showErrorOverlay(message: string) {
  let overlay = document.getElementById('edit-error-boundary')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'edit-error-boundary'
    overlay.className = 'edit-error-boundary'
    overlay.innerHTML = `
      <div class="edit-error-boundary-card">
        <h2>Algo deu errado no editor</h2>
        <p class="edit-error-boundary-msg"></p>
        <div class="edit-error-boundary-actions">
          <button type="button" class="edit-btn edit-btn--primary" data-action="reload">Recarregar página</button>
          <button type="button" class="edit-btn edit-btn--ghost" data-action="dismiss">Continuar mesmo assim</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    overlay.querySelector('[data-action="reload"]')?.addEventListener('click', () => {
      location.reload()
    })
    overlay.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
      overlay?.classList.remove('visible')
    })
  }
  const msgEl = overlay.querySelector('.edit-error-boundary-msg')
  if (msgEl) msgEl.textContent = message
  overlay.classList.add('visible')
}

export function installEditErrorBoundary(opts: EditErrorBoundaryOptions = {}) {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    lastError = event.message || 'Erro desconhecido'
    showErrorOverlay(lastError)
    opts.onRecover?.()
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    lastError =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Promise rejeitada sem tratamento'
    showErrorOverlay(lastError)
    opts.onRecover?.()
  })
}

export function getLastEditError(): string | null {
  return lastError
}
