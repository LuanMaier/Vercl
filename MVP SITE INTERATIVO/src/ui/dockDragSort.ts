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
  /** Itens que não podem ser arrastados */
  isDraggable?: (key: T) => boolean
}

export function attachDockDragSort<T extends string | number>(
  container: HTMLElement,
  options: DockDragSortOptions<T>,
): () => void {
  const itemSelector = options.itemSelector ?? '.dock-tab'
  let didDrag = false

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
    const pin = options.pinFirst ?? []
    if (!pin.length) return domOrder
    const pinned = pin.filter((p) => domOrder.includes(p))
    const rest = domOrder.filter((k) => !pin.includes(k))
    return [...pinned, ...rest]
  }

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
    const el = dragEl
    if (!el) return
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

  const bindTab = (tab: HTMLElement) => {
    const raw = tab.getAttribute(options.keyAttr)
    if (raw == null) return
    const key = options.parseKey(raw)
    const canDrag = options.isDraggable ? options.isDraggable(key) : true
    tab.draggable = canDrag
    tab.classList.toggle('dock-tab--sortable', canDrag)

    tab.addEventListener('dragstart', (e) => {
      if (!canDrag) {
        e.preventDefault()
        return
      }
      dragEl = tab
      didDrag = false
      tab.classList.add('is-dragging')
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(key))
      }
    })

    tab.addEventListener('dragend', () => {
      dragEl = null
      clearDropHints()
    })

    tab.addEventListener('click', (e) => {
      if (didDrag) {
        e.preventDefault()
        e.stopPropagation()
        didDrag = false
      }
    })
  }

  container.addEventListener('dragover', onDragOver)
  container.addEventListener('drop', onDrop)
  container.addEventListener('dragleave', (e) => {
    if (e.target === container) clearDropHints()
  })

  const refresh = () => {
    container.querySelectorAll<HTMLElement>(itemSelector).forEach(bindTab)
  }

  refresh()

  return () => {
    container.removeEventListener('dragover', onDragOver)
    container.removeEventListener('drop', onDrop)
  }
}
