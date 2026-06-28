/** Toque/clique unificado — resposta imediata no mobile sem double-fire. */
export function bindTap(
  el: HTMLElement,
  handler: (e: Event) => void,
  opts?: { stopPropagation?: boolean },
) {
  let lastFireAt = 0
  const GAP_MS = 400

  const run = (e: Event) => {
    const now = Date.now()
    if (now - lastFireAt < GAP_MS) return
    lastFireAt = now
    if (opts?.stopPropagation) e.stopPropagation()
    handler(e)
  }

  el.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType === 'mouse') return
      if (e.button !== 0) return
      run(e)
    },
    { passive: true },
  )

  el.addEventListener('click', (e) => {
    if (Date.now() - lastFireAt < GAP_MS) {
      e.preventDefault()
      if (opts?.stopPropagation) e.stopPropagation()
      return
    }
    run(e)
  })
}
