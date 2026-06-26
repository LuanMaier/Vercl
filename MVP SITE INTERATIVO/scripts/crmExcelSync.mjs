import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'

export const CRM_EXCEL_REL = 'public/crm/unidades.xlsx'
const CRM_JSON_GEN = 'src/config/generated/crmUnits.json'
const CRM_JSON_PUBLIC = 'public/config/crmUnits.json'

export function normalizeCrmUnitKey(label) {
  return label.trim().toLowerCase()
}

function parseArgb(argb) {
  if (!argb) return null
  const hex = argb.replace(/^#/, '').replace(/^FF/i, '').slice(-6)
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return null
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

function statusFromFill(cell) {
  const fill = cell.fill
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return null
  const fg = fill.fgColor
  if (!fg) return null

  let rgb = null
  if (fg.argb) rgb = parseArgb(fg.argb)
  if (!rgb && typeof fg.theme === 'number') {
    const themeMap = { 0: 'available', 1: 'available', 2: 'sold', 5: 'reserved', 6: 'reserved', 10: 'sold' }
    return themeMap[fg.theme] ?? null
  }
  if (!rgb) return null

  const { r, g, b } = rgb
  if (r >= 175 && g >= 175 && b < 150) return 'reserved'
  if (r >= 150 && g < 130 && b < 130) return 'sold'
  if (r < 90 && g < 90 && b < 90) return 'available'
  if (r > 235 && g > 235 && b > 235) return 'available'
  return null
}

function statusFromText(raw) {
  const t = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  if (['vendido', 'venda', 'sold'].includes(t)) return 'sold'
  if (['reservado', 'reserva', 'reserved'].includes(t)) return 'reserved'
  if (['disponivel', 'disponível', 'available', 'livre', ''].includes(t)) return 'available'
  return null
}

function parseBedrooms(raw) {
  if (raw == null || raw === '') return null
  const n = parseInt(String(raw).replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsePrice(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw)
  const s = String(raw)
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function writeCrmJson(rootDir, data) {
  const json = JSON.stringify(data, null, 2) + '\n'
  const genPath = path.join(rootDir, CRM_JSON_GEN)
  const pubPath = path.join(rootDir, CRM_JSON_PUBLIC)
  fs.mkdirSync(path.dirname(genPath), { recursive: true })
  fs.mkdirSync(path.dirname(pubPath), { recursive: true })
  fs.writeFileSync(genPath, json, 'utf8')
  fs.writeFileSync(pubPath, json, 'utf8')
}

function emptyCrmFile() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceFile: CRM_EXCEL_REL,
    units: {},
  }
}

export async function syncCrmFromExcel(rootDir) {
  const excelPath = path.join(rootDir, CRM_EXCEL_REL)
  if (!fs.existsSync(excelPath)) {
    const empty = emptyCrmFile()
    writeCrmJson(rootDir, empty)
    return empty
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(excelPath)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('Planilha CRM vazia')

  let headerRow = 1
  let unitCol = 1
  let statusCol = 0
  let bedroomsCol = 0
  let priceCol = 0

  for (let r = 1; r <= 5; r++) {
    const row = sheet.getRow(r)
    let foundHeader = false
    row.eachCell((cell, col) => {
      const v = String(cell.value ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
      if (v === 'unidade' || v === 'unit' || v === 'apartamento') {
        unitCol = col
        foundHeader = true
      }
      if (v === 'status' || v === 'situacao') statusCol = col
      if (v === 'quartos' || v === 'dormitorios' || v === 'dorms' || v === 'bedrooms') bedroomsCol = col
      if (v === 'valor' || v === 'preco' || v === 'price' || v === 'valores') priceCol = col
    })
    if (foundHeader) {
      headerRow = r
      break
    }
  }

  const units = {}
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const unitCell = row.getCell(unitCol)
    const label = String(unitCell.value ?? '').trim()
    if (!label) return

    let status = 'available'
    if (statusCol) {
      const textStatus = statusFromText(String(row.getCell(statusCol).value ?? ''))
      if (textStatus) status = textStatus
      const colorFromStatusCol = statusFromFill(row.getCell(statusCol))
      if (colorFromStatusCol) status = colorFromStatusCol
    }
    const colorFromUnit = statusFromFill(unitCell)
    if (colorFromUnit) status = colorFromUnit

    let bedrooms = null
    if (bedroomsCol) {
      bedrooms = parseBedrooms(row.getCell(bedroomsCol).value)
    }

    let price = null
    if (priceCol) {
      price = parsePrice(row.getCell(priceCol).value)
    }

    const key = normalizeCrmUnitKey(label)
    units[key] = { status, label, bedrooms, price }
  })

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceFile: CRM_EXCEL_REL,
    units,
  }
  writeCrmJson(rootDir, payload)
  return payload
}
