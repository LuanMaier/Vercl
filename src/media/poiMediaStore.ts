export const POI_MEDIA_PREFIX = 'poi-media://'
export const POI_MEDIA_VERSION_KEY = 'explorer-poi-media-version'

export type PoiMediaKind = 'img' | 'video'

const DB_NAME = 'explorer-poi-media'
const DB_VERSION = 1
const STORE = 'files'

function mediaKey(poiId: string, kind: PoiMediaKind) {
  return `${poiId}:${kind}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

export function isPoiMediaRef(path: string | undefined): path is string {
  return Boolean(path?.startsWith(POI_MEDIA_PREFIX))
}

export function makePoiMediaRef(poiId: string, kind: PoiMediaKind) {
  return `${POI_MEDIA_PREFIX}${poiId}/${kind}`
}

export function parsePoiMediaRef(ref: string): { poiId: string; kind: PoiMediaKind } | null {
  if (!isPoiMediaRef(ref)) return null
  const rest = ref.slice(POI_MEDIA_PREFIX.length)
  const slash = rest.lastIndexOf('/')
  if (slash < 0) return null
  const poiId = rest.slice(0, slash)
  const kind = rest.slice(slash + 1) as PoiMediaKind
  if (kind !== 'img' && kind !== 'video') return null
  return { poiId, kind }
}

export async function savePoiMedia(poiId: string, kind: PoiMediaKind, file: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(file, mediaKey(poiId, kind))
  })
  db.close()
  bumpMediaVersion()
}

export async function getPoiMediaBlob(poiId: string, kind: PoiMediaKind): Promise<Blob | null> {
  const db = await openDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(mediaKey(poiId, kind))
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return blob
}

export async function deletePoiMedia(poiId: string, kind?: PoiMediaKind): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    if (kind) {
      store.delete(mediaKey(poiId, kind))
    } else {
      store.delete(mediaKey(poiId, 'img'))
      store.delete(mediaKey(poiId, 'video'))
    }
  })
  db.close()
  bumpMediaVersion()
}

export async function clearAllPoiMedia(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).clear()
  })
  db.close()
  bumpMediaVersion()
}

export function bumpMediaVersion() {
  localStorage.setItem(POI_MEDIA_VERSION_KEY, String(Date.now()))
}
