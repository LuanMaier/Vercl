import * as THREE from 'three'
import type { SplatMesh } from '@sparkjsdev/spark'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import type { SplatPinDefinition } from '../config/splatConfig'
import { createEditorSplatPin, createExplorerSplatPin } from './splatPinDom'
import { getPinLocalPosition, hasPinWorldPosition } from './splatDepthPick'

export type SplatPinLayerMode = 'explorer' | 'editor'

export type SplatPinLayerOptions = {
  mode: SplatPinLayerMode
  selectedId?: string | null
  onPinClick?: (pin: SplatPinDefinition) => void
  onPinElement?: (el: HTMLElement, pin: SplatPinDefinition) => void
  getOrbitTarget: () => THREE.Vector3
  getMarkerDistance: () => number
}

type PinEntry = {
  pin: SplatPinDefinition
  object: CSS2DObject
  element: HTMLElement
}

/**
 * Pins HTML via CSS2DRenderer.
 * Filhos da cena (não do SplatMesh) — posição mundial recalculada a cada frame
 * a partir das coords locais gravadas no JSON (Spark não propaga matrixWorld aos filhos).
 */
export class SplatPinLayer3D {
  private readonly renderer: CSS2DRenderer
  private readonly pinRoot = new THREE.Group()
  private splatMesh: SplatMesh | null = null
  private readonly entries = new Map<string, PinEntry>()
  private mode: SplatPinLayerMode = 'explorer'
  private getOrbitTarget: () => THREE.Vector3 = () => new THREE.Vector3()
  private getMarkerDistance: () => number = () => 4
  private localScratch = new THREE.Vector3()
  private worldScratch = new THREE.Vector3()

  constructor(host: HTMLElement) {
    this.renderer = new CSS2DRenderer()
    const dom = this.renderer.domElement
    dom.className = 'splat-css2d-layer'
    dom.style.position = 'absolute'
    dom.style.inset = '0'
    dom.style.pointerEvents = 'none'
    dom.style.zIndex = '3'
    dom.style.overflow = 'visible'
    host.appendChild(dom)
  }

  setSplatMesh(mesh: SplatMesh | null) {
    this.splatMesh = mesh
    this.syncAllPositions()
  }

  attachToScene(scene: THREE.Scene) {
    if (this.pinRoot.parent !== scene) scene.add(this.pinRoot)
  }

  detachFromScene() {
    this.pinRoot.parent?.remove(this.pinRoot)
  }

  dispose() {
    this.clear()
    this.detachFromScene()
    this.renderer.domElement.remove()
    this.splatMesh = null
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height)
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.syncAllPositions()
    this.renderer.render(scene, camera)
  }

  private localToScenePosition(
    local: THREE.Vector3,
    pin: SplatPinDefinition,
    out = this.worldScratch,
  ): THREE.Vector3 {
    if (this.splatMesh && hasPinWorldPosition(pin)) {
      this.splatMesh.updateMatrixWorld(true)
      out.copy(local)
      return this.splatMesh.localToWorld(out)
    }
    return out.copy(local)
  }

  private syncEntryPosition(entry: PinEntry) {
    const target = this.getOrbitTarget()
    const markerDistance = this.getMarkerDistance()
    const local = getPinLocalPosition(entry.pin, target, markerDistance, this.localScratch)
    entry.object.position.copy(this.localToScenePosition(local, entry.pin))
  }

  private syncAllPositions() {
    for (const entry of this.entries.values()) {
      this.syncEntryPosition(entry)
    }
  }

  clear() {
    for (const { object } of this.entries.values()) {
      this.pinRoot.remove(object)
    }
    this.entries.clear()
  }

  setPins(pins: SplatPinDefinition[], options: SplatPinLayerOptions) {
    this.mode = options.mode
    this.getOrbitTarget = options.getOrbitTarget
    this.getMarkerDistance = options.getMarkerDistance
    this.clear()

    const target = this.getOrbitTarget()
    const markerDistance = this.getMarkerDistance()

    pins.forEach((pin, index) => {
      const element =
        options.mode === 'editor'
          ? createEditorSplatPin(pin, pin.id === options.selectedId, () => {
              options.onPinClick?.(pin)
            })
          : createExplorerSplatPin(pin, index, () => {
              options.onPinClick?.(pin)
            })

      element.classList.add('splat-css2d-pin')

      const object = new CSS2DObject(element)
      const local = getPinLocalPosition(pin, target, markerDistance, this.localScratch)
      object.position.copy(this.localToScenePosition(local, pin))
      this.pinRoot.add(object)
      const entry: PinEntry = { pin, object, element }
      this.entries.set(pin.id, entry)
      options.onPinElement?.(element, pin)
    })
  }

  setPinLocalPoint(pinId: string, x: number, y: number, z: number) {
    const entry = this.entries.get(pinId)
    if (!entry) return
    entry.pin = { ...entry.pin, x, y, z }
    this.syncEntryPosition(entry)
  }

  setFocusedExplorerPin(pinId: string | null) {
    if (this.mode !== 'explorer') return
    for (const [id, { element }] of this.entries) {
      element.classList.toggle('is-active', id === pinId)
    }
  }

  setSelected(pinId: string | null) {
    if (this.mode !== 'editor') return
    for (const [id, { element }] of this.entries) {
      element.classList.toggle('selected', id === pinId)
    }
  }

  updatePinLabel(pinId: string, label: string) {
    const entry = this.entries.get(pinId)
    if (!entry) return
    entry.pin = { ...entry.pin, label }
    const labelEl = entry.element.querySelector('.edit-pin-label, .splat-pin-marker__name')
    if (labelEl) labelEl.textContent = label
    const btn = entry.element.querySelector('.splat-pin-marker__btn')
    if (btn) btn.setAttribute('aria-label', label)
  }

  getElement(pinId: string): HTMLElement | null {
    return this.entries.get(pinId)?.element ?? null
  }
}
