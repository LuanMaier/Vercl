import { bumpMediaVersion } from './poiMediaStore'

export const SCENE_MEDIA_PREFIX = 'scene-media://'

const DB_NAME = 'explorer-poi-media'
const STORE = 'files'

function viewHeroKey(viewIndex: number) {
  return `view-${viewIndex}:hero`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}

export function isSceneMediaRef(path: string | undefined): path is string {
  return Boolean(path?.startsWith(SCENE_MEDIA_PREFIX))
}

export function makeSceneHeroRef(viewIndex: number) {
  return `${SCENE_MEDIA_PREFIX}${viewIndex}/hero`
}

export function parseSceneHeroRef(ref: string): { viewIndex: number } | null {
  if (!isSceneMediaRef(ref)) return null
  const rest = ref.slice(SCENE_MEDIA_PREFIX.length)
  const [viewStr, kind] = rest.split('/')
  if (kind !== 'hero') return null
  const viewIndex = Number(viewStr)
  if (Number.isNaN(viewIndex)) return null
  return { viewIndex }
}

export async function saveViewHero(viewIndex: number, file: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(file, viewHeroKey(viewIndex))
  })
  db.close()
  bumpMediaVersion()
}

export async function getViewHeroBlob(viewIndex: number): Promise<Blob | null> {
  const db = await openDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(viewHeroKey(viewIndex))
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return blob
}

export async function deleteViewHero(viewIndex: number): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(viewHeroKey(viewIndex))
  })
  db.close()
  bumpMediaVersion()
}
