/**
 * Cria public/crm/unidades.xlsx de exemplo para teste local.
 * Colunas: unidade | status | quartos | valor
 */
import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'public', 'crm')
const outFile = path.join(outDir, 'unidades.xlsx')

fs.mkdirSync(outDir, { recursive: true })

const wb = new ExcelJS.Workbook()
const sheet = wb.addWorksheet('Unidades')

sheet.columns = [
  { header: 'unidade', key: 'unidade', width: 14 },
  { header: 'status', key: 'status', width: 16 },
  { header: 'quartos', key: 'quartos', width: 10 },
  { header: 'valor', key: 'valor', width: 16 },
]

const rows = [
  { unidade: '1102', status: 'vendido', quartos: 3, valor: 850000, fill: 'FFFF0000' },
  { unidade: '1103', status: 'reservado', quartos: 2, valor: 620000, fill: 'FFFFFF00' },
  { unidade: '1104', status: 'disponivel', quartos: 3, valor: 780000, fill: null },
  { unidade: '1105', status: 'disponivel', quartos: 2, valor: 550000, fill: null },
  { unidade: '1106', status: 'disponivel', quartos: 4, valor: 1200000, fill: null },
]

sheet.getRow(1).font = { bold: true }

for (const row of rows) {
  const r = sheet.addRow({
    unidade: row.unidade,
    status: row.status,
    quartos: row.quartos,
    valor: row.valor,
  })
  const unitCell = r.getCell('unidade')
  if (row.fill) {
    unitCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: row.fill },
    }
    unitCell.font = {
      color: { argb: row.fill === 'FFFFFF00' ? 'FF000000' : 'FFFFFFFF' },
      bold: true,
    }
  } else {
    unitCell.font = { color: { argb: 'FF000000' } }
  }
}

await wb.xlsx.writeFile(outFile)
console.log('CRM Excel criado:', outFile)

const { syncCrmFromExcel } = await import('./crmExcelSync.mjs')
await syncCrmFromExcel(root)
console.log('JSON CRM gerado em public/config/crmUnits.json')
