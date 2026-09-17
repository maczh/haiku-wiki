// Sheet/数据表内容契约（架构文档 §5.2）——与 SheetEditor/SheetView 唯一对接层。
// 存储格式：{"version":1,"cells":{"r-c":{"text":"…"}},"colLen":26,"rowLen":100}（键 0 基）

export interface SheetCell {
  text: string
}

export interface SheetJSON {
  version: number
  cells: Record<string, SheetCell>
  colLen: number
  rowLen: number
}

/** 空文档默认值 */
export const DEFAULT_SHEET: SheetJSON = { version: 1, cells: {}, colLen: 26, rowLen: 100 }

/** x-data-spreadsheet loadData 的 rows 结构：{行号: {cells: {列号: {text}}}}（0 基数字键） */
export interface XRow {
  cells: Record<number, { text?: string; style?: number }>
}

export interface XSheetData {
  name?: string
  rows: Record<number, XRow>
  cols?: { len?: number }
}

/** 解析 docs.content：失败或 version 不识别 → 回退默认值并标记 reset（组件负责提示） */
export function parseSheetJSON(content: string): { data: SheetJSON; reset: boolean } {
  if (content && content.trim() !== '') {
    try {
      const o = JSON.parse(content) as Partial<SheetJSON>
      if (o && o.version === 1 && o.cells && typeof o.cells === 'object') {
        const cells: Record<string, SheetCell> = {}
        for (const [k, v] of Object.entries(o.cells)) {
          if (/^\d+-\d+$/.test(k) && v && typeof v === 'object' && 'text' in v) {
            cells[k] = { text: String((v as SheetCell).text ?? '') }
          }
        }
        return {
          data: {
            version: 1,
            cells,
            colLen: typeof o.colLen === 'number' && o.colLen > 0 ? o.colLen : 26,
            rowLen: typeof o.rowLen === 'number' && o.rowLen > 0 ? o.rowLen : 100,
          },
          reset: false,
        }
      }
    } catch {
      /* fallthrough → 回退默认值 */
    }
  }
  return { data: { ...DEFAULT_SHEET, cells: {} }, reset: !!content && content.trim() !== '' }
}

/** SheetJSON → x-data-spreadsheet loadData 数据 */
export function sheetToXData(s: SheetJSON): XSheetData[] {
  const rows: Record<number, XRow> = {}
  for (const [key, cell] of Object.entries(s.cells)) {
    const [r, c] = key.split('-').map(Number)
    if (!rows[r]) rows[r] = { cells: {} }
    rows[r].cells[c] = { text: cell.text }
  }
  return [{ name: 'Sheet1', rows, cols: { len: s.colLen } }]
}

/** x-data-spreadsheet getData()/change 数据 → SheetJSON */
export function xDataToSheet(json: { rows?: Record<number, XRow> }): SheetJSON {
  const cells: Record<string, SheetCell> = {}
  let maxRow = 0
  let maxCol = 0
  for (const [rKey, row] of Object.entries(json.rows ?? {})) {
    if (rKey === 'len' || !row || typeof row.cells !== 'object') continue
    const r = Number(rKey)
    for (const [cKey, cell] of Object.entries(row.cells)) {
      const c = Number(cKey)
      const text = String(cell?.text ?? '')
      if (text === '') continue // 空单元格不落库
      cells[`${r}-${c}`] = { text }
      if (r > maxRow) maxRow = r
      if (c > maxCol) maxCol = c
    }
  }
  // 行列总数 = 默认值与实际内容边界的较大者
  const rowLen = Math.max(DEFAULT_SHEET.rowLen, maxRow + 10)
  const colLen = Math.max(DEFAULT_SHEET.colLen, maxCol + 3)
  return { version: 1, cells, colLen, rowLen }
}

/** 序列化为存储字符串 */
export function stringifySheet(s: SheetJSON): string {
  return JSON.stringify(s)
}
