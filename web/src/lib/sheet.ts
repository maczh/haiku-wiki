// 表格文档内容契约（架构文档 §5.2）——SheetEditor / SheetView 与存储层之间唯一对接层。
//
// 存储格式（本轮起，v3）：Luckysheet 原生多工作表数据
//   {"version":3,"sheets":[ {name,index,order,status,row,column,celldata:[{r,c,v}],config,…}, … ]}
// 即 luckysheet.getAllSheets() 的输出（去掉可由 celldata 推导出的 data 矩阵，减小体积）。
//
// 旧格式（x-data-spreadsheet 时代）自动迁移，读一次即转成 v3：
//   v2：{"version":2,"cells":{"r-c":{"text":"…"}},"colLen":n,"rowLen":n,"raw":{…}}
//   v1：{"version":1,"cells":{"r-c":{"text":"…"}},"colLen":n,"rowLen":n}
// 迁移优先级：raw（x-data-spreadsheet 整段，含行高/列宽/合并）→ cells 扁平映射。
// 不识别 / 解析失败 → 回退默认空表并置 reset=true（由组件提示用户）。

/** 当前存储契约版本 */
export const SHEET_VERSION = 3

/** 单元格值：Luckysheet 的 v 可以是标量，也可以是 {v,m,ct,…} 富值对象 */
export type LuckysheetCellValue = unknown

export interface LuckysheetCellData {
  r: number
  c: number
  v: LuckysheetCellValue
}

export interface LuckysheetSheet {
  name: string
  index?: number
  order?: number
  status?: number
  row?: number
  column?: number
  /** 权威数据源：稀疏单元格数组。加载时 Luckysheet 由它推导出 data 矩阵 */
  celldata?: LuckysheetCellData[]
  /** getAllSheets() 会带上 data 矩阵；它与 celldata 同源，保存时剔除 */
  data?: unknown[][]
  config?: Record<string, unknown>
  [key: string]: unknown
}

export interface SheetJSON {
  version: number
  sheets: LuckysheetSheet[]
}

/** x-data-spreadsheet 单表原始结构（旧格式迁移用，只声明用到的部分） */
export interface XSheetRaw {
  name?: string
  rows?: Record<string, { cells?: Record<string, { text?: string }>; height?: number }>
  cols?: Record<string, unknown> & { len?: number }
  [key: string]: unknown
}

/** 旧格式（v1/v2）正文 */
export interface LegacySheetJSON {
  version?: number
  cells?: Record<string, { text?: string }>
  colLen?: number
  rowLen?: number
  raw?: XSheetRaw
}

export const DEFAULT_ROW = 100
export const DEFAULT_COL = 26

/** 构造一个空工作表（Luckysheet 所需的最小字段集） */
export function emptySheet(name = 'Sheet1', index = 0): LuckysheetSheet {
  return {
    name,
    index,
    order: index,
    status: 1,
    row: DEFAULT_ROW,
    column: DEFAULT_COL,
    celldata: [],
    config: {},
  }
}

/** 空文档默认值 */
export const DEFAULT_SHEET: SheetJSON = { version: SHEET_VERSION, sheets: [emptySheet()] }

/** 单元格富值里取可展示的文本（m 优先，其次 v，再退字符串化） */
function textOfValue(v: LuckysheetCellValue): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as { m?: unknown; v?: unknown }
    if (typeof o.m === 'string') return o.m
    if (typeof o.v === 'string') return o.v
    if (typeof o.v === 'number' || typeof o.v === 'boolean') return String(o.v)
    return ''
  }
  return String(v)
}

/** 取单元格富值对象（非对象时包一层，保证 Luckysheet 能识别） */
function cellValueOf(v: LuckysheetCellValue): LuckysheetCellValue {
  if (v != null && typeof v === 'object') return v
  // 纯标量按「文本」存，避免 Luckysheet 把数字串当公式/日期解析
  return { v, m: v == null ? '' : String(v), ct: { fa: 'General', t: 's' } }
}

/**
 * 规范化工作表：补齐 Luckysheet 需要的字段，并保证 celldata 存在。
 * data 矩阵不保留（由 celldata 推导），旧数据里只有 data 时也反推出 celldata。
 */
export function normalizeSheet(sheet: LuckysheetSheet, index: number): LuckysheetSheet {
  const out: LuckysheetSheet = {
    ...sheet,
    name: typeof sheet?.name === 'string' && sheet.name.trim() !== '' ? sheet.name : `Sheet${index + 1}`,
    index: typeof sheet?.index === 'number' ? sheet.index : index,
    order: typeof sheet?.order === 'number' ? sheet.order : index,
    status: typeof sheet?.status === 'number' ? sheet.status : 1,
    row: typeof sheet?.row === 'number' && sheet.row > 0 ? sheet.row : DEFAULT_ROW,
    column: typeof sheet?.column === 'number' && sheet.column > 0 ? sheet.column : DEFAULT_COL,
    config: (sheet?.config && typeof sheet.config === 'object' ? sheet.config : {}) as Record<string, unknown>,
  }
  delete out.data

  const celldata: LuckysheetCellData[] = []
  if (Array.isArray(sheet?.celldata)) {
    for (const it of sheet.celldata) {
      if (!it || typeof it !== 'object') continue
      const r = Number(it.r)
      const c = Number(it.c)
      if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) continue
      celldata.push({ r, c, v: cellValueOf(it.v) })
    }
  } else if (Array.isArray(sheet?.data)) {
    // 只有 data 矩阵（旧/外部来源）→ 反推 celldata
    sheet.data.forEach((row, r) => {
      if (!Array.isArray(row)) return
      row.forEach((cell, c) => {
        if (cell == null) return
        const text = textOfValue(cell)
        if (text === '') return
        celldata.push({ r, c, v: cellValueOf(cell) })
      })
    })
  }
  out.celldata = celldata
  return out
}

/** 旧格式 cells 映射（"r-c" → {text}）→ celldata */
function cellsToCelldata(cells: Record<string, { text?: string }>): LuckysheetCellData[] {
  const list: LuckysheetCellData[] = []
  for (const [key, cell] of Object.entries(cells ?? {})) {
    const m = /^(\d+)-(\d+)$/.exec(key)
    if (!m) continue
    const r = Number(m[1])
    const c = Number(m[2])
    const text = String(cell?.text ?? '')
    if (text === '') continue
    list.push({ r, c, v: { v: text, m: text, ct: { fa: 'General', t: 's' } } })
  }
  return list
}

/** x-data-spreadsheet 的 rows 结构 → celldata */
function xRowsToCelldata(raw: XSheetRaw): LuckysheetCellData[] {
  const list: LuckysheetCellData[] = []
  const rows = raw?.rows ?? {}
  for (const [rKey, row] of Object.entries(rows)) {
    if (rKey === 'len' || !row || typeof row !== 'object') continue
    const r = Number(rKey)
    if (!Number.isFinite(r)) continue
    const cells = (row as { cells?: Record<string, { text?: string }> }).cells ?? {}
    for (const [cKey, cell] of Object.entries(cells)) {
      const c = Number(cKey)
      const text = String(cell?.text ?? '')
      if (!Number.isFinite(c) || text === '') continue
      list.push({ r, c, v: { v: text, m: text, ct: { fa: 'General', t: 's' } } })
    }
  }
  return list
}

/** 旧格式（v1/v2）→ v3 */
export function migrateLegacy(o: LegacySheetJSON): { data: SheetJSON; migrated: boolean } {
  const raw = o?.raw
  let celldata: LuckysheetCellData[] | null = null
  let name = 'Sheet1'
  let column = DEFAULT_COL
  let row = DEFAULT_ROW

  if (raw && typeof raw === 'object' && raw.rows && typeof raw.rows === 'object') {
    celldata = xRowsToCelldata(raw)
    if (typeof raw.name === 'string' && raw.name.trim() !== '') name = raw.name
    const len = (raw.cols as { len?: number } | undefined)?.len
    if (typeof len === 'number' && len > 0) column = len
  } else if (o?.cells && typeof o.cells === 'object') {
    celldata = cellsToCelldata(o.cells)
  }
  if (typeof o?.colLen === 'number' && o.colLen > 0) column = o.colLen
  if (typeof o?.rowLen === 'number' && o.rowLen > 0) row = o.rowLen
  if (!celldata) return { data: { ...DEFAULT_SHEET, sheets: [emptySheet()] }, migrated: false }

  let maxR = 0
  let maxC = 0
  for (const it of celldata) {
    if (it.r > maxR) maxR = it.r
    if (it.c > maxC) maxC = it.c
  }
  return {
    data: {
      version: SHEET_VERSION,
      sheets: [
        {
          ...emptySheet(name),
          row: Math.max(row, maxR + 10),
          column: Math.max(column, maxC + 3),
          celldata,
        },
      ],
    },
    migrated: true,
  }
}

/**
 * 解析 docs.content。
 * 返回：data（规范的 v3 数据）、reset（内容损坏/无法识别，已回退默认空表）、
 *      migrated（本次从旧格式迁移而来，组件可提示「已升级为新表格」）。
 */
export function parseSheetJSON(content: string): { data: SheetJSON; reset: boolean; migrated: boolean } {
  const empty = { data: { ...DEFAULT_SHEET, sheets: [emptySheet()] }, reset: false, migrated: false }
  if (!content || content.trim() === '') return empty
  let o: unknown
  try {
    o = JSON.parse(content)
  } catch {
    return { ...empty, reset: true }
  }
  if (!o || typeof o !== 'object') return { ...empty, reset: true }

  // 新格式：{version:3, sheets:[…]}
  const sheetsRaw = (o as { sheets?: unknown }).sheets
  if (Array.isArray(sheetsRaw)) {
    const sheets = sheetsRaw
      .filter((s) => s && typeof s === 'object')
      .map((s, i) => normalizeSheet(s as LuckysheetSheet, i))
    if (sheets.length === 0) return { ...empty, reset: true }
    return { data: { version: SHEET_VERSION, sheets }, reset: false, migrated: false }
  }

  // 旧格式（v1/v2）
  const legacy = o as LegacySheetJSON
  if (legacy.version === SHEET_VERSION) return { ...empty, reset: true } // 标了 v3 却没有 sheets → 损坏
  const { data, migrated } = migrateLegacy(legacy)
  if (!migrated) return { ...empty, reset: true }
  return { data, reset: false, migrated: true }
}

/** SheetJSON → Luckysheet create 的 data 入参 */
export function sheetsToLuckysheet(data: SheetJSON): LuckysheetSheet[] {
  const sheets = Array.isArray(data?.sheets) ? data.sheets : []
  const list = sheets.length > 0 ? sheets : [emptySheet()]
  return list.map((s, i) => normalizeSheet(s, i))
}

/** Luckysheet getAllSheets() 输出 → SheetJSON（落库前剥离 data 矩阵） */
export function luckysheetToSheetJSON(allSheets: unknown): SheetJSON {
  const arr = Array.isArray(allSheets) ? allSheets : []
  const sheets = arr
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => normalizeSheet(s as LuckysheetSheet, i))
  return { version: SHEET_VERSION, sheets: sheets.length > 0 ? sheets : [emptySheet()] }
}

/** 序列化为存储字符串 */
export function stringifySheet(s: SheetJSON): string {
  return JSON.stringify({ version: SHEET_VERSION, sheets: s?.sheets?.length ? s.sheets : [emptySheet()] })
}

/**
 * 把工作簿扁平化成 {cells, colLen, rowLen}（"r-c" → {text}）。
 * 用于导出/预览等非 Luckysheet 场景，也便于 node 侧对迁移结果做断言。
 */
export function flattenSheets(data: SheetJSON): {
  cells: Record<string, { text: string }>
  colLen: number
  rowLen: number
} {
  const first = Array.isArray(data?.sheets) && data.sheets.length > 0 ? data.sheets[0] : null
  const cells: Record<string, { text: string }> = {}
  let maxR = 0
  let maxC = 0
  for (const it of first?.celldata ?? []) {
    const text = textOfValue(it?.v)
    if (text === '') continue
    cells[`${it.r}-${it.c}`] = { text }
    if (it.r > maxR) maxR = it.r
    if (it.c > maxC) maxC = it.c
  }
  return {
    cells,
    colLen: Math.max(first?.column ?? DEFAULT_COL, maxC + 3),
    rowLen: Math.max(first?.row ?? DEFAULT_ROW, maxR + 10),
  }
}
