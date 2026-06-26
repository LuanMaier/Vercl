import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncCrmFromExcel } from './crmExcelSync.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const result = await syncCrmFromExcel(root)
console.log(`CRM sincronizado: ${Object.keys(result.units).length} unidades`)
for (const u of Object.values(result.units)) {
  console.log(`  ${u.label} → ${u.status}`)
}
