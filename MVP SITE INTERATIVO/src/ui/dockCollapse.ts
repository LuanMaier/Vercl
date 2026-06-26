let trackEl: HTMLElement | null = null
let revealBtn: HTMLButtonElement | null = null
let dockExpanded = true
let outsideDismissReady = false

function syncDockCollapseUi() {
  if (!trackEl || !revealBtn) return
  const collapsed = !dockExpanded
  trackEl.classList.toggle('dock-collapsed', collapsed)
  document.body.classList.toggle('dock-menu-collapsed', collapsed)
  revealBtn.hidden = !collapsed
  revealBtn.setAttribute('aria-label', 'Mostrar menu')
  revealBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
}

function installOutsideDismiss() {
  if (outsideDismissReady) return
  outsideDismissReady = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!dockExpanded) return
      const track = trackEl
      if (!track) return
      const target = e.target as Node
      if (track.contains(target)) return
      collapseDockMenu()
    },
    true,
  )
}

export function isDockMenuExpanded() {
  return dockExpanded
}

export function collapseDockMenu() {
  if (!dockExpanded) return
  dockExpanded = false
  syncDockCollapseUi()
}

export function expandDockMenu() {
  if (dockExpanded) return
  dockExpanded = true
  syncDockCollapseUi()
}

export function mountDockCollapse(track: HTMLElement) {
  trackEl = track
  installOutsideDismiss()

  let btn = track.querySelector('#dock-reveal') as HTMLButtonElement | null
  if (!btn) {
    const legacy = track.querySelector('#dock-apartments-reveal')
    if (legacy) {
      legacy.id = 'dock-reveal'
      legacy.classList.remove('dock-apartments-reveal')
      legacy.classList.add('dock-reveal')
      btn = legacy as HTMLButtonElement
    }
  }
  if (!btn) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.id = 'dock-reveal'
    btn.className = 'dock-reveal'
    btn.setAttribute('aria-label', 'Mostrar menu')
    btn.hidden = true
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path fill="currentColor" d="M12 8.5 6.2 14.3h11.6L12 8.5z"/>
      </svg>
    `
    track.appendChild(btn)
  }
  revealBtn = btn

  revealBtn.onclick = (e) => {
    e.stopPropagation()
    expandDockMenu()
  }

  syncDockCollapseUi()
}
