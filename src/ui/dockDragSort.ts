/**
 * Reordena botões dentro de uma faixa .dock-tabs (arrastar no retângulo).
 */
export type DockDragSortOptions<T extends string | number> = {
  itemSelector?: string
  /** Atributo data-* com o id do item (ex.: data-i, data-id) */
  keyAttr: string
  parseKey: (raw: string) => T
  onOrderChange: (order: T[]) => void
  /** Itens fixos no início, nesta ordem (ex.: panorâmica, interiores) */
  pinFirst?: T[]
  /** Itens fixos no fim, nesta ordem (ex.: Gaussian / Interativo) */
  pinLast?: T[]
  /** Itens que não podem ser arrastados */
  isDraggable?: (key: T) => boolean
}

export function attachDockDragSort<T extends string | number>(
  container: HTMLElement,
  options: DockDragSortOptions<T>,
): () => void {
  const itemSelector = options.itemSelector ?? '.dock-tab'
  let didDrag = false
  let handledDrop = false
  let orderAtDragStart: T[] | null = null

  const readDomOrder = (): T[] => {
    const keys: T[] = []
    container.querySelectorAll<HTMLElement>(itemSelector).forEach((el) => {
      const raw = el.getAttribute(options.keyAttr)
      if (raw == null) return
      keys.push(options.parseKey(raw))
    })
    return keys
  }

  const applyPinned = (domOrder: T[]): T[] => {
    const pinFirst = options.pinFirst ?? []
    const pinLast = options.pinLast ?? []
    const pinSet = new Set([...pinFirst, ...pinLast])
    const pinnedFirst = pinFirst.filter((p) => domOrder.includes(p))
    const pinnedLast = pinLast.filter((p) => domOrder.includes(p))
    const rest = domOrder.filter((k) => !pinSet.has(k))
    return [...pinnedFirst, ...rest, ...pinnedLast]
  }

  const orderKey = (order: T[]) => applyPinned(order).join(',')

  const commit = () => {
    options.onOrderChange(applyPinned(readDomOrder()))
  }

  const getTabAfter = (x: number): HTMLElement | null => {
    const tabs = [...container.querySelectorAll<HTMLElement>(itemSelector)].filter(
      (el) => el !== draggedEl(),
    )
    let closest: { el: HTMLElement; offset: number } | null = null
    for (const tab of tabs) {
      const box = tab.getBoundingClientRect()
      const center = box.left + box.width / 2
      const offset = x - center
      if (offset < 0 && (!closest || offset > closest.offset)) {
        closest = { el: tab, offset }
      }
    }
    return closest?.el ?? null
  }

  let dragEl: HTMLElement | null = null
  const draggedEl = () => dragEl

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const after = getTabAfter(e.clientX)
    container.querySelectorAll(itemSelector).forEach((el) => {
      el.classList.toggle('dock-tab--drop-before', el === after)
    })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (handledDrop) return
    const el = dragEl
    if (!el) return
    handledDrop = true
    const after = getTabAfter(e.clientX)
    if (after) container.insertBefore(el, after)
    else container.appendChild(el)
    clearDropHints()
    commit()
    didDrag = true
  }

  const clearDropHints = () => {
    container.querySelectorAll(itemSelector).forEach((el) => {
      el.classList.remove('dock-tab--drop-before', 'is-dragging')
    })
  }

  const tabListeners: Array<{ tab: HTMLElement; type: string; fn: EventListener }> = []

  const bindTab = (tab: HTMLElement) => {
    const raw = tab.getAttribute(options.keyAttr)
    if (raw == null) return
    const key = options.parseKey(raw)
    const canDrag = options.isDraggable ? options.isDraggable(key) : true
    tab.draggable = canDrag
    tab.classList.toggle('dock-tab--sortable', canDrag)

    const onDragStart = (e: DragEvent) => {
      if (!canDrag) {
        e.preventDefault()
        return
      }
      dragEl = tab
      didDrag = false
      handledDrop = false
      orderAtDragStart = readDomOrder()
      tab.classList.add('is-dragging')
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(key))
      }
    }

    const onDragEnd = () => {
      const el = dragEl
      dragEl = null
      clearDropHints()
      if (!handledDrop && el && orderAtDragStart) {
        const now = readDomOrder()
        if (orderKey(now) !== orderKey(orderAtDragStart)) {
          commit()
          didDrag = true
        }
      }
      orderAtDragStart = null
    }

    const onClick = (e: Event) => {
      if (didDrag) {
        e.preventDefault()
        e.stopPropagation()
        didDrag = false
      }
    }

    tab.addEventListener('dragstart', onDragStart)
    tab.addEventListener('dragend', onDragEnd)
    tab.addEventListener('click', onClick)
    tab.addEventListener('dragover', onDragOver)
    tab.addEventListener('drop', onDrop)
    tabListeners.push(
      { tab, type: 'dragstart', fn: onDragStart as EventListener },
      { tab, type: 'dragend', fn: onDragEnd as EventListener },
      { tab, type: 'click', fn: onClick },
      { tab, type: 'dragover', fn: onDragOver as EventListener },
      { tab, type: 'drop', fn: onDrop as EventListener },
    )
  }

  // Capture: drop does not bubble — drops on .dock-tab children must be handled here.
  container.addEventListener('dragover', onDragOver, true)
  container.addEventListener('drop', onDrop, true)
  container.addEventListener('dragleave', (e) => {
    if (e.target === container) clearDropHints()
  })

  const refresh = () => {
    container.querySelectorAll<HTMLElement>(itemSelector).forEach(bindTab)
  }

  refresh()

  return () => {
    container.removeEventListener('dragover', onDragOver, true)
    container.removeEventListener('drop', onDrop, true)
    for (const { tab, type, fn } of tabListeners) {
      tab.removeEventListener(type, fn)
    }
  }
}

/** Lê ordem atual dos tabs no DOM com pinFirst/pinLast aplicados (para flush antes de salvar). */
export function readDockSortOrder<T extends string | number>(
  container: HTMLElement,
  options: Pick<
    DockDragSortOptions<T>,
    'itemSelector' | 'keyAttr' | 'parseKey' | 'pinFirst' | 'pinLast'
  >,
): T[] {
  const itemSelector = options.itemSelector ?? '.dock-tab'
  const keys: T[] = []
  container.querySelectorAll<HTMLElement>(itemSelector).forEach((el) => {
    const raw = el.getAttribute(options.keyAttr)
    if (raw == null) return
    keys.push(options.parseKey(raw))
  })
  const pinFirst = options.pinFirst ?? []
  const pinLast = options.pinLast ?? []
  const pinSet = new Set([...pinFirst, ...pinLast])
  const pinnedFirst = pinFirst.filter((p) => keys.includes(p))
  const pinnedLast = pinLast.filter((p) => keys.includes(p))
  const rest = keys.filter((k) => !pinSet.has(k))
  return [...pinnedFirst, ...rest, ...pinnedLast]
}
