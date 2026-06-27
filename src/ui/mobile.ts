import {
  isCellularConnection,
  isMobileViewport,
  probeMobileAssets,
} from '../core/paths'

let ready = false

function syncViewportClasses() {
  const mobile = isMobileViewport()
  document.body.classList.toggle('is-mobile', mobile)
  document.body.classList.toggle('is-portrait', mobile && window.innerHeight >= window.innerWidth)
  document.body.classList.toggle('is-landscape', mobile && window.innerWidth > window.innerHeight)
  document.body.classList.toggle('is-cellular', isCellularConnection())
}

function mountCellularHint() {
  if (!isCellularConnection() || sessionStorage.getItem('explorer-cellular-hint') === '1') return
  sessionStorage.setItem('explorer-cellular-hint', '1')

  const el = document.createElement('div')
  el.className = 'mobile-cellular-hint'
  el.setAttribute('role', 'status')
  el.innerHTML =
    '<span>Conexão móvel detectada — para melhor qualidade, use Wi‑Fi.</span>'
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('is-visible'))
  window.setTimeout(() => {
    el.classList.remove('is-visible')
    window.setTimeout(() => el.remove(), 450)
  }, 6500)
}

export async function initMobileExperience(): Promise<void> {
  if (ready) {
    syncViewportClasses()
    return
  }
  ready = true

  syncViewportClasses()
  window.addEventListener('resize', syncViewportClasses)
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncViewportClasses, 120)
  })

  const conn = (navigator as Navigator & { connection?: EventTarget }).connection
  conn?.addEventListener?.('change', syncViewportClasses)

  await probeMobileAssets()
  syncViewportClasses()
  mountCellularHint()
}
