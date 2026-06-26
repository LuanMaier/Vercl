/** Ajusta faixa do dock: encolhe com poucos botões; rola se passar da largura. */
export function syncDockTabsLayout(tabsEl: HTMLElement | null) {
  if (!tabsEl) return

  const count = tabsEl.querySelectorAll('.dock-tab').length
  tabsEl.dataset.count = String(count)

  tabsEl.classList.remove('is-scroll')
  const parent = tabsEl.parentElement
  parent?.classList.toggle('is-empty', count === 0)

  requestAnimationFrame(() => {
    const overflow = tabsEl.scrollWidth > tabsEl.clientWidth + 2
    tabsEl.classList.toggle('is-scroll', overflow)
  })
}

export function observeDockTabsLayout(tabsEl: HTMLElement | null) {
  if (!tabsEl || typeof ResizeObserver === 'undefined') {
    syncDockTabsLayout(tabsEl)
    return () => {}
  }
  const ro = new ResizeObserver(() => syncDockTabsLayout(tabsEl))
  ro.observe(tabsEl)
  tabsEl.querySelectorAll('.dock-tab').forEach((el) => ro.observe(el))
  syncDockTabsLayout(tabsEl)
  return () => ro.disconnect()
}
