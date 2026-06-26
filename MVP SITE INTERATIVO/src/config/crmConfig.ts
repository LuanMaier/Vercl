import crmUnitsJson from './generated/crmUnits.json'

export type CrmUnitStatus = 'available' | 'reserved' | 'sold'

export type CrmUnitRecord = {
  status: CrmUnitStatus
  label: string
  bedrooms?: number | null
  price?: number | null
}

export type CrmUnitsFile = {
  version: 1
  updatedAt: string
  sourceFile: string
  units: Record<string, CrmUnitRecord>
}

let crmUnits: CrmUnitsFile = { ...(crmUnitsJson as CrmUnitsFile) }

const CRM_RUNTIME_URLS = ['/config/crmUnits.json', '/src/config/generated/crmUnits.json']

export const CRM_UNITS_VERSION_KEY = 'explorer-crm-units-version'

export function normalizeCrmUnitKey(label: string): string {
  return label.trim().toLowerCase()
}

export function getCrmUnitsFile(): CrmUnitsFile {
  return crmUnits
}

export function getCrmStatusForUnit(label: string): CrmUnitStatus {
  const key = normalizeCrmUnitKey(label)
  return crmUnits.units[key]?.status ?? 'available'
}

export function getCrmUnitRecord(label: string): CrmUnitRecord | null {
  const key = normalizeCrmUnitKey(label)
  return crmUnits.units[key] ?? null
}

export function isCrmUnitKnown(label: string): boolean {
  const key = normalizeCrmUnitKey(label)
  return Object.prototype.hasOwnProperty.call(crmUnits.units, key)
}

export function crmStatusClass(status: CrmUnitStatus): string {
  switch (status) {
    case 'reserved':
      return 'crm--reserved'
    case 'sold':
      return 'crm--sold'
    default:
      return 'crm--available'
  }
}

export function getCrmStatusLabel(status: CrmUnitStatus): string {
  switch (status) {
    case 'reserved':
      return 'Reservado'
    case 'sold':
      return 'Vendido'
    default:
      return 'Disponível'
  }
}

export function bumpCrmUnitsVersion() {
  localStorage.setItem(CRM_UNITS_VERSION_KEY, String(Date.now()))
}

export async function reloadCrmUnits(): Promise<boolean> {
  const t = Date.now()
  const prev = crmUnits.updatedAt
  for (const base of CRM_RUNTIME_URLS) {
    try {
      const res = await fetch(`${base}?t=${t}`)
      if (!res.ok) continue
      crmUnits = (await res.json()) as CrmUnitsFile
      break
    } catch {
      /* try next */
    }
  }
  const changed = crmUnits.updatedAt !== prev
  if (changed) bumpCrmUnitsVersion()
  return changed
}
