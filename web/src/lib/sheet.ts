// Sheet/数据表内容契约（架构文档 §5.2）——与 SheetEditor/SheetView 唯一对接层。
// 存储格式：{"version":1,"cells":{"r-c":{"text":"…"}},"colLen":26,"rowLen":100}（键 0 基）

export interface SheetCell {
  text: string
}

/**
 * x-data-spreadsheet getData() 返回的单表原始结构（含 styles / merges / 行高 / 列宽）。
 * 这里只声明我们用到的部分，其余字段用索引签名保留，避免与库内部格式耦合。
 */
export interface XSheetRaw {
  name?: string
  freeze?: string
  styles?: unknown
  merges?: unknown
  rows?: Record<string, { cells?: Record<string, { text?: string; style?: number }>; height?: number }>
  cols?: Record<string, { width?: number } & Record<string, unknown>> & { len?: number }
  validations?: unknown
  autofilter?: unknown
  [key: string]: unknown
}

export interface SheetJSON {
  version: number
  cells: Record<string, SheetCell>
  colLen: number
  rowLen: number
  /**
   * 表格「样式往返」核心（架构文档 §5.2 修订）：
   * 保存时把 x-data-spreadsheet 的整段 getData() 原样存下来，加载时直接喂回 loadData，
   * 这样字体/字号/加粗/颜色/对齐/行高/列宽/合并单元格等都被完整还原，无需我们手工解析。
   * 旧版（version=1，无 raw）文档走 cells 重建分支，向后兼容。
   * 导出 xlsx 仍用扁平化的 cells，因此 raw 与 cells 并存。
   */
  raw?: XSheetRaw
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
      if (o && typeof o === 'object' && o.cells && typeof o.cells === 'object') {
        const version = o.version === 2 ? 2 : 1
        const cells: Record<string, SheetCell> = {}
        for (const [k, v] of Object.entries(o.cells as Record<string, unknown>)) {
          if (/^\d+-\d+$/.test(k) && v && typeof v === 'object' && 'text' in v) {
            cells[k] = { text: String((v as SheetCell).text ?? '') }
          }
        }
        const raw = (version === 2 && o.raw && typeof o.raw === 'object' ? o.raw : undefined) as
          | XSheetRaw
          | undefined
        return {
          data: {
            version,
            cells,
            colLen: typeof o.colLen === 'number' && o.colLen > 0 ? o.colLen : 26,
            rowLen: typeof o.rowLen === 'number' && o.rowLen > 0 ? o.rowLen : 100,
            raw,
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

/**
 * 从 x-data-spreadsheet 的整段数据里扁平化出 cells（供导出 xlsx 使用）。
 * 同时支持单表对象与「多表数组」。
 */
function flattenCells(raw: XSheetRaw | XSheetRaw[]): { cells: Record<string, SheetCell>; maxRow: number; maxCol: number } {
  const sheet = Array.isArray(raw) ? raw[0] : raw
  const cells: Record<string, SheetCell> = {}
  let maxRow = 0
  let maxCol = 0
  const rows = sheet?.rows ?? {}
  for (const [rKey, row] of Object.entries(rows)) {
    if (rKey === 'len' || !row || typeof row.cells !== 'object') continue
    const r = Number(rKey)
    for (const [cKey, cell] of Object.entries(row.cells ?? {})) {
      const c = Number(cKey)
      const text = String((cell as { text?: string })?.text ?? '')
      if (text === '') continue
      cells[`${r}-${c}`] = { text }
      if (r > maxRow) maxRow = r
      if (c > maxCol) maxCol = c
    }
  }
  return { cells, maxRow, maxCol }
}

/** SheetJSON → x-data-spreadsheet loadData 数据 */
export function sheetToXData(s: SheetJSON): XSheetData[] {
  // 有 raw（version=2）就原样回灌：样式/行高/列宽/合并全部还原
  if (s.raw && typeof s.raw === 'object') {
    return [s.raw as XSheetData]
  }
  const rows: Record<number, XRow> = {}
  for (const [key, cell] of Object.entries(s.cells)) {
    const [r, c] = key.split('-').map(Number)
    if (!rows[r]) rows[r] = { cells: {} }
    rows[r].cells[c] = { text: cell.text }
  }
  return [{ name: 'Sheet1', rows, cols: { len: s.colLen } }]
}

/** x-data-spreadsheet getData()/change 数据 → SheetJSON（保留 raw 用于样式往返） */
export function xDataToSheet(json: XSheetRaw | XSheetRaw[]): SheetJSON {
  const raw = (Array.isArray(json) ? json[0] : json) as XSheetRaw
  const { cells, maxRow, maxCol } = flattenCells(raw)
  const colLen = typeof raw?.cols?.len === 'number' && raw.cols.len > 0 ? raw.cols.len : DEFAULT_SHEET.colLen
  const rowLen = Math.max(DEFAULT_SHEET.rowLen, maxRow + 10)
  const finalColLen = Math.max(colLen, maxCol + 3)
  return { version: 2, cells, colLen: finalColLen, rowLen, raw }
}

/** 序列化为存储字符串 */
export function stringifySheet(s: SheetJSON): string {
  return JSON.stringify(s)
}
