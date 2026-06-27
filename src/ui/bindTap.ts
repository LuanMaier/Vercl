/** Clique/toque unificado — evita double-fire touchstart + click no mobile. */
export function bindTap(
  el: HTMLElement,
  handler: (e: Event) => void,
  opts?: { stopPropagation?: boolean },
) {
  let lastAt = 0

  el.addEventListener('click', (e) => {
    const now = Date.now()
    if (now - lastAt < 450) return
    lastAt = now
    if (opts?.stopPropagation) e.stopPropagation()
    handler(e)
  })
}
