import * as THREE from 'three'

export class Panorama360 {
  private renderer: THREE.WebGLRenderer | null = null
  private frame: number | null = null
  private geo: THREE.SphereGeometry | null = null
  private mesh: THREE.Mesh | null = null

  constructor(
    private modal: HTMLElement,
    private canvas: HTMLCanvasElement,
    private box: HTMLElement,
    private loading: HTMLElement,
  ) {}

  mount() {
    window.addEventListener('explorer:open-pano', (e) => {
      const src = (e as CustomEvent<{ src: string }>).detail.src
      this.open(src)
    })

    this.modal.querySelector('[data-pano-close]')?.addEventListener('click', () => this.close())
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
    })
  }

  open(imageSrc: string) {
    this.loading.classList.remove('hidden')
    this.modal.classList.add('open')
    this.modal.setAttribute('aria-hidden', 'false')

    this.dispose()

    requestAnimationFrame(() => {
      const w = this.box.clientWidth
      const h = this.box.clientHeight

      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      this.renderer = renderer

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 200)
      camera.position.set(0, 0, 0)

      const geo = new THREE.SphereGeometry(100, 64, 32)
      geo.scale(-1, 1, 1)
      this.geo = geo

      let lon = 180
      let lat = 0
      let dragging = false
      let px = 0
      let py = 0
      let velLon = 0
      let velLat = 0

      const onDown = (x: number, y: number) => {
        dragging = true
        px = x
        py = y
        velLon = 0
        velLat = 0
      }
      const onMove = (x: number, y: number) => {
        if (!dragging) return
        velLon = (x - px) * 0.12
        velLat = (py - y) * 0.12
        px = x
        py = y
      }
      const onUp = () => {
        dragging = false
      }

      this.canvas.onmousedown = (e) => onDown(e.clientX, e.clientY)
      window.onmousemove = (e) => onMove(e.clientX, e.clientY)
      window.onmouseup = onUp
      this.canvas.ontouchstart = (e) => {
        e.preventDefault()
        onDown(e.touches[0].clientX, e.touches[0].clientY)
      }
      window.ontouchmove = (e) => {
        if (!dragging) return
        onMove(e.touches[0].clientX, e.touches[0].clientY)
      }
      window.ontouchend = onUp

      new THREE.TextureLoader().load(
        imageSrc,
        (tex) => {
          const mat = new THREE.MeshBasicMaterial({ map: tex })
          const mesh = new THREE.Mesh(geo, mat)
          this.mesh = mesh
          scene.add(mesh)
          this.loading.classList.add('hidden')

          const animate = () => {
            if (!this.modal.classList.contains('open')) return
            if (!dragging) {
              lon += velLon
              lat += velLat
              velLon *= 0.92
              velLat *= 0.92
            } else {
              lon += velLon
              lat += velLat
            }
            lat = Math.max(-85, Math.min(85, lat))
            const phi = THREE.MathUtils.degToRad(90 - lat)
            const theta = THREE.MathUtils.degToRad(lon)
            camera.lookAt(
              Math.sin(phi) * Math.cos(theta),
              Math.cos(phi),
              Math.sin(phi) * Math.sin(theta),
            )
            renderer.render(scene, camera)
            this.frame = requestAnimationFrame(animate)
          }
          animate()
        },
        undefined,
        () => {
          this.loading.innerHTML =
            '<span class="pano-error">Imagem não encontrada</span>'
        },
      )
    })
  }

  close() {
    this.modal.classList.remove('open')
    this.modal.setAttribute('aria-hidden', 'true')
    this.dispose()
  }

  private dispose() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = null
    const mat = this.mesh?.material
    if (mat && !Array.isArray(mat)) mat.dispose()
    if (this.mesh) {
      this.mesh.geometry.dispose()
      this.mesh = null
    }
    this.geo?.dispose()
    this.geo = null
    this.renderer?.dispose()
    this.renderer = null
    this.canvas.onmousedown = null
    window.onmousemove = null
    window.onmouseup = null
    this.canvas.ontouchstart = null
    window.ontouchmove = null
    window.ontouchend = null
  }
}
