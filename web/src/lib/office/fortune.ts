import type { Sheet } from '@fortune-sheet/core'
import type ExcelJS from 'exceljs'
import { luckysheetToSheetJSON, parseSheetJSON, type SheetJSON } from '../sheet'

type Value = Record<string, any>
const rgb = (color?: Partial<ExcelJS.Color>) => color?.argb ? `#${color.argb.slice(-6)}` : undefined
const argb = (color: unknown) => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color) ? { argb: `FF${color.slice(1)}` } : undefined
const borderStyles = ['thin', 'hair', 'dotted', 'dashDot', 'dashDotDot', 'dashed', 'double', 'medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot', 'slantDashDot', 'thick'] as const

export function toFortune(data: SheetJSON): Sheet[] {
  const ids = new Map(data.sheets.map((sheet, i) => [String(sheet.index ?? i), String(sheet.id ?? `sheet-${i}`)]))
  let active = false
  return data.sheets.map((sheet, i) => {
    const next = JSON.parse(JSON.stringify(sheet)) as Value
    next.id = ids.get(String(sheet.index ?? i))
    delete next.index
    delete next.data
    next.order = sheet.order ?? i
    next.status = !active && !sheet.hide && sheet.status === 1 ? 1 : 0
    if (next.status) active = true
    if (Array.isArray(next.calcChain)) next.calcChain = next.calcChain.map((item: Value) => ({ ...item, id: item.id ?? ids.get(String(item.index)) ?? next.id }))
    return next as Sheet
  }).map((sheet, i) => (!active && i === 0 ? { ...sheet, status: 1 } : sheet))
}

export function fromFortune(sheets: Sheet[]): SheetJSON {
  // Fortune's data matrix contains current edits; celldata is initialization data.
  return luckysheetToSheetJSON(sheets.map((sheet, i) => {
    const next = { ...sheet, index: i } as Value
    if (Array.isArray(next.data)) delete next.celldata
    return next
  }))
}

export function parseFortuneContent(content: string): SheetJSON {
  let body = content
  try {
    const value = JSON.parse(content)
    if (value.schema === 'haiku.sheet/1' && value.workbook) body = JSON.stringify(value.workbook)
  } catch { /* normal validation below */ }
  const parsed = parseSheetJSON(body)
  if (parsed.reset) throw new Error('工作簿内容无法识别，请恢复历史版本或重新导入文件')
  return parsed.data
}

export async function readXlsx(bytes: ArrayBuffer): Promise<SheetJSON> {
  const { default: Excel } = await import('exceljs')
  const workbook = new Excel.Workbook()
  await workbook.xlsx.load(bytes)
  const sheets: Value[] = []
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > 100000 || ws.columnCount > 16384 || (ws.rowCount + 20) * (ws.columnCount + 5) > 2000000) throw new Error('工作簿过大，超过在线编辑范围')
    const sheet: Value = { name: ws.name, id: `sheet-${ws.id}`, index: sheets.length, order: sheets.length, status: sheets.length ? 0 : 1, row: Math.max(100, ws.rowCount + 20), column: Math.max(26, ws.columnCount + 5), celldata: [], config: { merge: {}, rowlen: {}, columnlen: {}, rowhidden: {}, colhidden: {}, borderInfo: [] }, calcChain: [] }
    if (ws.state !== 'visible') sheet.hide = 1
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const r = rowNumber - 1
      if (row.height) sheet.config.rowlen[r] = row.height * 96 / 72
      if (row.hidden) sheet.config.rowhidden[r] = 0
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (cell.isMerged && cell.master.address !== cell.address) return
        const c = columnNumber - 1
        const value: Value = { ct: { fa: cell.numFmt || 'General', t: 'g' } }
        const raw = cell.value
        if (raw instanceof Date) { value.v = (raw.getTime() - Date.UTC(1899, 11, 30)) / 86400000; value.ct.t = 'd'; value.ct.fa = cell.numFmt || 'yyyy-mm-dd' }
        else if (raw && typeof raw === 'object') {
          if ('formula' in raw || 'sharedFormula' in raw) {
            value.f = `=${cell.formula}`
            value.v = cell.result instanceof Date ? (cell.result.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : cell.result ?? ''
            sheet.calcChain.push({ r, c, id: sheet.id, index: sheet.index })
          }
          else if ('richText' in raw) value.v = raw.richText.map(run => run.text).join('')
          else if ('hyperlink' in raw) { value.v = raw.text; sheet.hyperlink ??= {}; sheet.hyperlink[`${r}_${c}`] = { linkType: 'webpage', linkAddress: raw.hyperlink, linkTooltip: raw.tooltip || '' } }
          else if ('error' in raw) value.v = raw.error
        }
        else value.v = raw ?? ''
        value.ct.t = value.ct.t === 'd' ? 'd' : typeof value.v === 'number' ? 'n' : typeof value.v === 'boolean' ? 'b' : 's'
        const font = cell.font
        if (font) { value.ff = font.name; value.fs = font.size; value.bl = font.bold ? 1 : 0; value.it = font.italic ? 1 : 0; value.cl = font.strike ? 1 : 0; value.un = font.underline ? 1 : 0; value.fc = rgb(font.color) }
        if (cell.fill?.type === 'pattern') value.bg = rgb(cell.fill.fgColor)
        if (cell.border) {
          const borders: Value = { row_index: r, col_index: c }
          for (const [side, short] of [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b']] as const) {
            const border = cell.border[side]
            if (border?.style) borders[short] = { color: rgb(border.color) || '#000000', style: Math.max(1, borderStyles.indexOf(border.style as typeof borderStyles[number]) + 1) }
          }
          if (Object.keys(borders).length > 2) sheet.config.borderInfo.push({ rangeType: 'cell', value: borders })
        }
        const align = cell.alignment
        if (align) { value.ht = align.horizontal === 'center' ? 0 : align.horizontal === 'right' ? 2 : 1; value.vt = align.vertical === 'top' ? 1 : align.vertical === 'middle' ? 0 : 2; value.tb = align.wrapText ? 2 : 1 }
        // Preserve full source style for properties not represented by the editor.
        value.haikuExcelStyle = cell.style
        sheet.celldata.push({ r, c, v: value })
      })
    })
    ws.columns?.forEach((column, index) => {
      if (column.width) sheet.config.columnlen[index] = column.width * 7 + 5
      if (column.hidden) sheet.config.colhidden[index] = 0
    })
    const merges = ws.model.merges || []
    for (const range of merges) {
      const [start, end] = range.split(':').map(address => ws.getCell(address))
      const r = Number(start.row) - 1, c = Number(start.col) - 1
      const merge = { r, c, rs: Number(end.row) - r, cs: Number(end.col) - c }
      sheet.config.merge[`${r}_${c}`] = merge
      for (let ri = r; ri < r + merge.rs; ri++) for (let ci = c; ci < c + merge.cs; ci++) {
        let cell = sheet.celldata.find((item: Value) => item.r === ri && item.c === ci)
        if (!cell) { cell = { r: ri, c: ci, v: {} }; sheet.celldata.push(cell) }
        cell.v.mc = ri === r && ci === c ? merge : { r, c }
      }
    }
    const frozen = ws.views?.find(view => view.state === 'frozen')
    if (frozen?.state === 'frozen') sheet.frozen = { type: 'rangeBoth', range: { row_focus: (frozen.ySplit || 0) - 1, column_focus: (frozen.xSplit || 0) - 1 } }
    sheets.push(sheet)
  }
  if (!sheets.length) throw new Error('XLSX 中没有可读取的工作表')
  const visible = sheets.find(sheet => !sheet.hide) ?? sheets[0]
  for (const sheet of sheets) sheet.status = sheet === visible ? 1 : 0
  return luckysheetToSheetJSON(sheets)
}

export async function writeXlsx(data: SheetJSON): Promise<Blob> {
  const { default: Excel } = await import('exceljs')
  const workbook = new Excel.Workbook()
  workbook.calcProperties.fullCalcOnLoad = true
  for (const sheet of data.sheets) {
    const ws = workbook.addWorksheet(sheet.name)
    const config = (sheet.config || {}) as Value
    if (sheet.hide) ws.state = 'hidden'
    for (const item of sheet.celldata || []) {
      const value = (item.v && typeof item.v === 'object' ? item.v : { v: item.v }) as Value
      const cell = ws.getCell(item.r + 1, item.c + 1)
      const raw = value.v ?? ''
      cell.value = typeof value.f === 'string' ? { formula: value.f.replace(/^=/, ''), result: raw === '' ? undefined : raw } : raw
      if (value.haikuExcelStyle) cell.style = JSON.parse(JSON.stringify(value.haikuExcelStyle))
      cell.font = { ...cell.font, name: typeof value.ff === 'string' ? value.ff : cell.font?.name, size: value.fs ?? cell.font?.size, bold: value.bl === 1, italic: value.it === 1, strike: value.cl === 1, underline: value.un === 1, ...(argb(value.fc) ? { color: argb(value.fc) } : {}) }
      if (argb(value.bg)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(value.bg)! }
      else cell.fill = { type: 'pattern', pattern: 'none' }
      cell.alignment = { ...cell.alignment, horizontal: value.ht === 0 ? 'center' : value.ht === 2 ? 'right' : 'left', vertical: value.vt === 1 ? 'top' : value.vt === 0 ? 'middle' : 'bottom', wrapText: value.tb === 2 }
      if (value.ct?.fa) cell.numFmt = value.ct.fa
      const link = (sheet.hyperlink as Value | undefined)?.[`${item.r}_${item.c}`]
      if (link?.linkAddress && !value.f) cell.value = { text: String(raw), hyperlink: link.linkAddress }
    }
    for (const [r, height] of Object.entries(config.rowlen || {})) ws.getRow(Number(r) + 1).height = Number(height) * 72 / 96
    for (const [c, width] of Object.entries(config.columnlen || {})) ws.getColumn(Number(c) + 1).width = Math.max(1, (Number(width) - 5) / 7)
    for (const r of Object.keys(config.rowhidden || {})) ws.getRow(Number(r) + 1).hidden = true
    for (const c of Object.keys(config.colhidden || {})) ws.getColumn(Number(c) + 1).hidden = true
    for (const merge of Object.values(config.merge || {}) as Value[]) ws.mergeCells(merge.r + 1, merge.c + 1, merge.r + merge.rs, merge.c + merge.cs)
    for (const border of config.borderInfo || []) {
      if (border.rangeType === 'cell') {
        const value = border.value
        const cell = ws.getCell(value.row_index + 1, value.col_index + 1)
        for (const [side, short] of [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b']] as const) {
          if (value[short]) cell.border = { ...cell.border, [side]: { style: borderStyles[Number(value[short].style) - 1] || 'thin', color: argb(value[short].color) || { argb: 'FF000000' } } }
        }
      }
      else for (const range of border.range || []) {
        for (let r = range.row[0]; r <= range.row[1]; r++) for (let c = range.column[0]; c <= range.column[1]; c++) {
          const cell = ws.getCell(r + 1, c + 1)
          if (border.borderType === 'border-none') { cell.border = {}; continue }
          const type = border.borderType
          for (const side of ['left', 'right', 'top', 'bottom'] as const) {
            const edge = side === 'left' ? c === range.column[0] : side === 'right' ? c === range.column[1] : side === 'top' ? r === range.row[0] : r === range.row[1]
            if (type === 'border-all' || (type === 'border-outside' && edge) || (type === `border-${side}` && edge) || (type === 'border-inside' && !edge) || (type === 'border-horizontal' && (side === 'top' || side === 'bottom') && !edge) || (type === 'border-vertical' && (side === 'left' || side === 'right') && !edge)) {
              cell.border = { ...cell.border, [side]: { style: borderStyles[Number(border.style) - 1] || 'thin', color: argb(border.color) || { argb: 'FF000000' } } }
            }
          }
        }
      }
    }
    const frozen = sheet.frozen as Value | undefined
    if (frozen?.range) ws.views = [{ state: 'frozen', xSplit: Math.max(0, (frozen.range.column_focus ?? -1) + 1), ySplit: Math.max(0, (frozen.range.row_focus ?? -1) + 1) }]
  }
  return new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
