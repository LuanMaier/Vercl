import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'

type MediaOverrides = {
  version: 1
  heroes: Record<string, string>
  poiImages: Record<string, string>
  poiVideos: Record<string, string>
  poiLoopVideos?: Record<string, string>
  menuVideos?: Record<string, string>
  menuImages?: Record<string, string>
  interiorVideos?: Record<string, string>
  interiorPosters?: Record<string, string>
  interiorMedia?: Record<string, string>
  apartmentMedia?: Record<string, string>
  lightPosters: Record<string, Record<string, string>>
  lightVideos: Record<string, Record<string, string>>
  lightSliderVideos?: Record<string, string>
  solarFrameInitial?: Record<string, string>
  solarFrameFinal?: Record<string, string>
  lightMotionBlur?: Record<string, boolean>
  viewLoopVideos?: Record<string, string>
  viewIdleMode?: Record<string, 'image' | 'loop'>
}

const EMPTY_MEDIA: MediaOverrides = {
  version: 1,
  heroes: {},
  poiImages: {},
  poiVideos: {},
  menuVideos: {},
  menuImages: {},
  interiorVideos: {},
  interiorPosters: {},
  interiorMedia: {},
  apartmentMedia: {},
  lightPosters: {},
  lightVideos: {},
}

function loadMedia(root: string) {
  return readJson<MediaOverrides>(path.join(root, MEDIA_JSON), { ...EMPTY_MEDIA })
}

const CUSTOM_IMG = 'public/images/custom'
const CUSTOM_VID = 'public/media/custom'
const MEDIA_JSON = 'src/config/generated/mediaOverrides.json'
const INTERIORS_JSON = 'src/config/generated/interiorsOverrides.json'
const APARTMENTS_JSON = 'src/config/generated/apartmentsOverrides.json'
const APARTMENT_POIS_JSON = 'src/config/generated/apartmentPoisOverrides.json'
const APARTMENT_POIS_PUBLIC_JSON = 'public/config/apartmentPoisOverrides.json'
const APARTMENT_OUTLINES_JSON = 'src/config/generated/apartmentOutlinesOverrides.json'
const POIS_JSON = 'src/config/generated/poisOverrides.json'
const POIS_PUBLIC_JSON = 'public/config/poisOverrides.json'
const POINTS_JSON = 'src/config/generated/pointsOverrides.json'

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function writeApartmentPoisJson(rootDir: string, data: unknown) {
  writeJson(path.join(rootDir, APARTMENT_POIS_JSON), data)
  writeJson(path.join(rootDir, APARTMENT_POIS_PUBLIC_JSON), data)
}

function writePoisJson(rootDir: string, data: unknown) {
  writeJson(path.join(rootDir, POIS_JSON), data)
  writeJson(path.join(rootDir, POIS_PUBLIC_JSON), data)
}

function syncApartmentPoisMirror(rootDir: string) {
  const src = path.join(rootDir, APARTMENT_POIS_JSON)
  const pub = path.join(rootDir, APARTMENT_POIS_PUBLIC_JSON)
  if (!fs.existsSync(src)) return
  try {
    const data = fs.readFileSync(src, 'utf8')
    fs.mkdirSync(path.dirname(pub), { recursive: true })
    fs.writeFileSync(pub, data, 'utf8')
  } catch {
    /* ignore */
  }
}

function syncPoisMirror(rootDir: string) {
  const src = path.join(rootDir, POIS_JSON)
  const pub = path.join(rootDir, POIS_PUBLIC_JSON)
  if (!fs.existsSync(src)) return
  try {
    const data = fs.readFileSync(src, 'utf8')
    fs.mkdirSync(path.dirname(pub), { recursive: true })
    fs.writeFileSync(pub, data, 'utf8')
  } catch {
    /* ignore */
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

function parseQuery(url: string) {
  const i = url.indexOf('?')
  return new URLSearchParams(i >= 0 ? url.slice(i + 1) : '')
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex')
}

function verifyAdminPassword(password: string, env: Record<string, string>): boolean {
  const expected = env.VITE_ADMIN_PASSWORD_HASH?.trim().toLowerCase()
  if (!expected) return false
  return hashPassword(password).toLowerCase() === expected
}

export function adminMediaPlugin(): Plugin {
  let root = process.cwd()
  let adminEnv: Record<string, string> = {}
  let crmSyncTimer: ReturnType<typeof setTimeout> | null = null

  async function runCrmSync() {
    const mod = await import(pathToFileURL(path.join(root, 'scripts/crmExcelSync.mjs')).href)
    return mod.syncCrmFromExcel(root) as Promise<{ updatedAt: string; units: Record<string, unknown> }>
  }

  function scheduleCrmSync() {
    if (crmSyncTimer) clearTimeout(crmSyncTimer)
    crmSyncTimer = setTimeout(() => {
      crmSyncTimer = null
      void runCrmSync().catch((e) => {
        console.warn('[crm] falha ao sincronizar Excel:', e instanceof Error ? e.message : e)
      })
    }, 400)
  }

  return {
    name: 'admin-media-api',
    configResolved(config) {
      root = config.root
      adminEnv = loadEnv(config.mode, root, '')
    },
    configureServer(server) {
      syncApartmentPoisMirror(root)
      syncPoisMirror(root)
      void runCrmSync().catch(() => {})

      const crmDir = path.join(root, 'public/crm')
      if (fs.existsSync(crmDir)) {
        fs.watch(crmDir, { persistent: false }, (_evt, filename) => {
          if (filename && /unidades\.xlsx$/i.test(filename)) scheduleCrmSync()
        })
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/admin/')) return next()

        const url = req.url
        const q = parseQuery(url)
        const pathname = url.split('?')[0]

        try {
          if (pathname === '/api/admin/ping' && req.method === 'GET') {
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/sync-crm' && req.method === 'POST') {
            const data = await runCrmSync()
            sendJson(res, 200, { ok: true, updatedAt: data.updatedAt, count: Object.keys(data.units).length })
            return
          }

          if (pathname === '/api/admin/save-media' && req.method === 'POST') {
            const kind = q.get('kind')
            const ext = q.get('ext') || 'jpg'
            const body = await readBody(req)

            const data = loadMedia(root)

            let publicPath = ''
            let diskPath = ''

            if (kind === 'hero') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-hero.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              data.heroes[view] = publicPath
            } else if (kind === 'poi-img') {
              const id = q.get('id')
              if (!id) throw new Error('id obrigatório')
              const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_')
              const filename = `poi-${safe}.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              data.poiImages[id] = publicPath
            } else if (kind === 'poi-video') {
              const id = q.get('id')
              if (!id) throw new Error('id obrigatório')
              const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_')
              const filename = `poi-${safe}-trans.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              data.poiVideos[id] = publicPath
            } else if (kind === 'poi-loop') {
              const id = q.get('id')
              if (!id) throw new Error('id obrigatório')
              const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_')
              const filename = `poi-${safe}-loop.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.poiLoopVideos) data.poiLoopVideos = {}
              data.poiLoopVideos[id] = publicPath
            } else if (kind === 'menu-video') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-menu.trans.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.menuVideos) data.menuVideos = {}
              data.menuVideos[view] = publicPath
            } else if (kind === 'menu-image') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-menu.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              if (!data.menuImages) data.menuImages = {}
              data.menuImages[view] = publicPath
            } else if (kind === 'menu-loop') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-menu-loop.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.menuLoopVideos) data.menuLoopVideos = {}
              data.menuLoopVideos[view] = publicPath
            } else if (kind === 'light-poster') {
              const view = q.get('view') ?? '0'
              const mode = q.get('mode') ?? 'day'
              const filename = `view-${view}-light-${mode}.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              if (!data.lightPosters[view]) data.lightPosters[view] = {}
              data.lightPosters[view][mode] = publicPath
            } else if (kind === 'light-video') {
              const view = q.get('view') ?? '0'
              const mode = q.get('mode') ?? 'day'
              const filename = `view-${view}-light-${mode}.trans.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.lightVideos[view]) data.lightVideos[view] = {}
              data.lightVideos[view][mode] = publicPath
            } else if (kind === 'solar-video') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-solar.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.lightSliderVideos) data.lightSliderVideos = {}
              data.lightSliderVideos[view] = publicPath
            } else if (kind === 'solar-frame-initial') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-solar-initial.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              if (!data.solarFrameInitial) data.solarFrameInitial = {}
              data.solarFrameInitial[view] = publicPath
            } else if (kind === 'solar-frame-final') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-solar-final.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              if (!data.solarFrameFinal) data.solarFrameFinal = {}
              data.solarFrameFinal[view] = publicPath
            } else if (kind === 'view-loop') {
              const view = q.get('view') ?? '0'
              const filename = `view-${view}-loop.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.viewLoopVideos) data.viewLoopVideos = {}
              data.viewLoopVideos[view] = publicPath
              if (!data.viewIdleMode) data.viewIdleMode = {}
              data.viewIdleMode[view] = 'loop'
            } else if (kind === 'interior-video') {
              const id = q.get('id')
              if (!id) throw new Error('id obrigatório')
              const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_')
              const filename = `interior-${safe}.trans.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.interiorVideos) data.interiorVideos = {}
              data.interiorVideos[id] = publicPath
            } else if (kind === 'interior-poster') {
              const id = q.get('id')
              if (!id) throw new Error('id obrigatório')
              const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_')
              const filename = `interior-${safe}-poster.${ext}`
              diskPath = path.join(root, CUSTOM_IMG, filename)
              publicPath = `/images/custom/${filename}`
              if (!data.interiorPosters) data.interiorPosters = {}
              data.interiorPosters[id] = publicPath
            } else if (kind === 'interior-media') {
              const item = q.get('item')
              const page = q.get('page')
              const mediaType = q.get('mediaType') ?? 'image'
              if (!item || !page) throw new Error('item e page obrigatórios')
              const safeItem = item.replace(/[^a-zA-Z0-9-_]/g, '_')
              const safePage = page.replace(/[^a-zA-Z0-9-_]/g, '_')
              const key = `${item}__${page}`
              if (mediaType === 'video') {
                const filename = `book-${safeItem}-${safePage}.${ext}`
                diskPath = path.join(root, CUSTOM_VID, filename)
                publicPath = `/media/custom/${filename}`
              } else {
                const filename = `book-${safeItem}-${safePage}.${ext}`
                diskPath = path.join(root, CUSTOM_IMG, filename)
                publicPath = `/images/custom/${filename}`
              }
              if (!data.interiorMedia) data.interiorMedia = {}
              data.interiorMedia[key] = publicPath
            } else if (kind === 'apartment-loop') {
              const item = q.get('item')
              const page = q.get('page')
              if (!item || !page) throw new Error('item e page obrigatórios')
              const safeItem = item.replace(/[^a-zA-Z0-9-_]/g, '_')
              const safePage = page.replace(/[^a-zA-Z0-9-_]/g, '_')
              const key = `${item}__${page}`
              const filename = `apt-${safeItem}-${safePage}-loop.${ext}`
              diskPath = path.join(root, CUSTOM_VID, filename)
              publicPath = `/media/custom/${filename}`
              if (!data.apartmentLoopVideos) data.apartmentLoopVideos = {}
              data.apartmentLoopVideos[key] = publicPath
            } else if (kind === 'apartment-media') {
              const item = q.get('item')
              const page = q.get('page')
              const mediaType = q.get('mediaType') ?? 'image'
              if (!item || !page) throw new Error('item e page obrigatórios')
              const safeItem = item.replace(/[^a-zA-Z0-9-_]/g, '_')
              const safePage = page.replace(/[^a-zA-Z0-9-_]/g, '_')
              const key = `${item}__${page}`
              if (mediaType === 'video') {
                const filename = `apt-${safeItem}-${safePage}.${ext}`
                diskPath = path.join(root, CUSTOM_VID, filename)
                publicPath = `/media/custom/${filename}`
              } else {
                const filename = `apt-${safeItem}-${safePage}.${ext}`
                diskPath = path.join(root, CUSTOM_IMG, filename)
                publicPath = `/images/custom/${filename}`
              }
              if (!data.apartmentMedia) data.apartmentMedia = {}
              data.apartmentMedia[key] = publicPath
            } else {
              throw new Error('kind inválido')
            }

            fs.mkdirSync(path.dirname(diskPath), { recursive: true })
            fs.writeFileSync(diskPath, body)
            writeJson(path.join(root, MEDIA_JSON), data)
            sendJson(res, 200, { path: publicPath })
            return
          }

          if (pathname === '/api/admin/remove-media' && req.method === 'POST') {
            const kind = q.get('kind')
            const data = loadMedia(root)

            if (kind === 'hero') {
              const view = q.get('view') ?? '0'
              const p = data.heroes[view]
              delete data.heroes[view]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'poi-img') {
              const id = q.get('id')!
              const p = data.poiImages[id]
              delete data.poiImages[id]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'poi-video') {
              const id = q.get('id')!
              const p = data.poiVideos[id]
              delete data.poiVideos[id]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'poi-loop') {
              const id = q.get('id')!
              const p = data.poiLoopVideos?.[id]
              if (data.poiLoopVideos) delete data.poiLoopVideos[id]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'menu-video') {
              const view = q.get('view') ?? '0'
              const p = data.menuVideos?.[view]
              if (data.menuVideos) delete data.menuVideos[view]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'menu-image') {
              const view = q.get('view') ?? '0'
              const p = data.menuImages?.[view]
              if (data.menuImages) delete data.menuImages[view]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'menu-loop') {
              const view = q.get('view') ?? '0'
              const p = data.menuLoopVideos?.[view]
              if (data.menuLoopVideos) delete data.menuLoopVideos[view]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'light-poster') {
              const view = q.get('view') ?? '0'
              const mode = q.get('mode') ?? 'day'
              const p = data.lightPosters[view]?.[mode]
              if (data.lightPosters[view]) delete data.lightPosters[view][mode]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'light-video') {
              const view = q.get('view') ?? '0'
              const mode = q.get('mode') ?? 'day'
              const p = data.lightVideos[view]?.[mode]
              if (data.lightVideos[view]) delete data.lightVideos[view][mode]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'solar-video') {
              const view = q.get('view') ?? '0'
              const p = data.lightSliderVideos?.[view]
              if (data.lightSliderVideos) delete data.lightSliderVideos[view]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'solar-frame-initial') {
              const view = q.get('view') ?? '0'
              const p = data.solarFrameInitial?.[view]
              if (data.solarFrameInitial) delete data.solarFrameInitial[view]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'solar-frame-final') {
              const view = q.get('view') ?? '0'
              const p = data.solarFrameFinal?.[view]
              if (data.solarFrameFinal) delete data.solarFrameFinal[view]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'view-loop') {
              const view = q.get('view') ?? '0'
              const p = data.viewLoopVideos?.[view]
              if (data.viewLoopVideos) delete data.viewLoopVideos[view]
              if (!data.viewIdleMode) data.viewIdleMode = {}
              data.viewIdleMode[view] = 'image'
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'interior-video') {
              const id = q.get('id')!
              const p = data.interiorVideos?.[id]
              if (data.interiorVideos) delete data.interiorVideos[id]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'interior-poster') {
              const id = q.get('id')!
              const p = data.interiorPosters?.[id]
              if (data.interiorPosters) delete data.interiorPosters[id]
              if (p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'interior-media') {
              const item = q.get('item')!
              const page = q.get('page')!
              const key = `${item}__${page}`
              const p = data.interiorMedia?.[key]
              if (data.interiorMedia) delete data.interiorMedia[key]
              if (p?.startsWith('/media/custom/') || p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'apartment-loop') {
              const item = q.get('item')!
              const page = q.get('page')!
              const key = `${item}__${page}`
              const p = data.apartmentLoopVideos?.[key]
              if (data.apartmentLoopVideos) delete data.apartmentLoopVideos[key]
              if (p?.startsWith('/media/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            } else if (kind === 'apartment-media') {
              const item = q.get('item')!
              const page = q.get('page')!
              const key = `${item}__${page}`
              const p = data.apartmentMedia?.[key]
              if (data.apartmentMedia) delete data.apartmentMedia[key]
              if (p?.startsWith('/media/custom/') || p?.startsWith('/images/custom/')) {
                const disk = path.join(root, 'public', p.slice(1))
                if (fs.existsSync(disk)) fs.unlinkSync(disk)
              }
            }

            writeJson(path.join(root, MEDIA_JSON), data)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-view-idle-mode' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as {
              view?: string
              mode?: 'image' | 'loop'
            }
            const view = body.view ?? '0'
            const mode = body.mode === 'loop' ? 'loop' : 'image'
            const data = loadMedia(root)
            if (!data.viewIdleMode) data.viewIdleMode = {}
            data.viewIdleMode[view] = mode
            writeJson(path.join(root, MEDIA_JSON), data)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-light-settings' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8')) as {
              view?: string
              motionBlur?: boolean
            }
            const view = body.view ?? '0'
            const data = loadMedia(root)
            if (!data.lightMotionBlur) data.lightMotionBlur = {}
            if (body.motionBlur) data.lightMotionBlur[view] = true
            else delete data.lightMotionBlur[view]
            writeJson(path.join(root, MEDIA_JSON), data)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-pois' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writePoisJson(root, parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-points' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeJson(path.join(root, POINTS_JSON), parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-interiors' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeJson(path.join(root, INTERIORS_JSON), parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-apartments' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeJson(path.join(root, APARTMENTS_JSON), parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-apartments' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeJson(path.join(root, APARTMENTS_JSON), parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-apartment-pois' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeApartmentPoisJson(root, parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/save-apartment-outlines' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8'))
            writeJson(path.join(root, APARTMENT_OUTLINES_JSON), parsed)
            sendJson(res, 200, { ok: true })
            return
          }

          if (pathname === '/api/admin/reset-project' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8')) as { password?: unknown }
            const password = typeof parsed.password === 'string' ? parsed.password : ''
            if (!verifyAdminPassword(password, adminEnv)) {
              sendJson(res, 403, { error: 'Senha de administrador incorreta' })
              return
            }
            writeJson(path.join(root, MEDIA_JSON), { ...EMPTY_MEDIA })
            writeJson(path.join(root, POIS_JSON), { version: 1, byView: {} })
            writeJson(path.join(root, POIS_PUBLIC_JSON), { version: 1, byView: {} })
            writeJson(path.join(root, POINTS_JSON), { version: 1 })
            writeJson(path.join(root, INTERIORS_JSON), { version: 1 })
            writeJson(path.join(root, APARTMENTS_JSON), { version: 1 })
            writeJson(path.join(root, APARTMENT_POIS_JSON), { version: 1, byApartment: {} })
            writeJson(path.join(root, APARTMENT_POIS_PUBLIC_JSON), { version: 1, byApartment: {} })
            writeJson(path.join(root, APARTMENT_OUTLINES_JSON), {
              version: 1,
              facadeApartmentId: 'apt-1',
              byPin: {},
            })
            const imgDir = path.join(root, CUSTOM_IMG)
            const vidDir = path.join(root, CUSTOM_VID)
            for (const dir of [imgDir, vidDir]) {
              if (fs.existsSync(dir)) {
                for (const f of fs.readdirSync(dir)) {
                  fs.unlinkSync(path.join(dir, f))
                }
              }
            }
            sendJson(res, 200, { ok: true })
            return
          }

          sendJson(res, 404, { error: 'not found' })
        } catch (e) {
          sendJson(res, 500, { error: e instanceof Error ? e.message : 'erro' })
        }
      })
    },
  }
}
