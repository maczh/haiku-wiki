// 导入的 Excel（.xlsx/.xls/.csv/…）→ Luckysheet SheetJSON 的转换器。
//
// 背景：导入的办公文档正文是「附件引用」{url,filename,size,ext}（见 lib/officeDoc.ts），
// 桌面端由 OnlyOffice 渲染；而 H5 阅读/分享态需要用 **luckysheet 只读内核**把 xlsx 展示出来。
// luckysheet 只吃 SheetJSON（celldata + config），因此这里用 SheetJS(xlsx) 解析二进制工作簿，
// 映射成项目内的 SheetJSON v3 契约（见 lib/sheet.ts），与「新建表格」正文完全同构 —— 于是
// SheetView 无需任何改动即可只读渲染。
//
// 体积考虑：SheetJS 解析器较重，调用方必须 **动态 import** 本模块（见 SheetOfficeView），
// 避免其进入 H5 主包。

import { emptySheet, type LuckysheetCellData, type SheetJSON } from './sheet'

/** SheetJS 单元格（只声明本项目用到的字段，避免依赖其类型声明的稳定性） */
interface SjsCell {
  /** 原始值（数字 / 字符串 / 布尔 / 日期序列） */
  v?: unknown
  /** 带格式的显示文本 */
  w?: string
  /** 公式（不含前导 =） */
  f?: string
  /** 数字格式串（如 "0.00" / "m/d/yy"） */
  z?: string
  /** 单元格类型：n 数字 / s 文本 / b 布尔 / d 日期 / e 错误 / z 空 */
  t?: string
}
interface SjsMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}
interface SjsCol {
  wpx?: number
  wch?: number
  hidden?: boolean
}
interface SjsRow {
  hpx?: number
  hpt?: number
  hidden?: boolean
}
/** SheetJS 工作表（!ref/!merges/!cols/!rows + 以 A1 地址为键的单元格） */
interface SjsSheet {
  '!ref'?: string
  '!merges'?: SjsMerge[]
  '!cols'?: SjsCol[]
  '!rows'?: SjsRow[]
  [addr: string]: unknown
}

/** 单元格类型：数字 → n，布尔 → b，其余 → s */
function cellType(v: unknown): string {
  if (typeof v === 'number') return 'n'
  if (typeof v === 'boolean') return 'b'
  return 's'
}

/**
 * 二进制/文本工作簿 → SheetJSON。
 *
 * @param buf 文件字节（fetch 得到的 arrayBuffer）
 * @param ext 扩展名（小写，不含点）；csv 走文本解析分支，其余按二进制工作簿解析
 */
export async function xlsxToSheetJSON(buf: ArrayBuffer, ext = ''): Promise<SheetJSON> {
  const XLSX = await import('xlsx')
  // ⚠️ 必须 cellStyles:true —— 否则 SheetJS 不解析列宽/行高（!cols/!rows 恒为 undefined），
  //    预览会丢失列宽行高、表格挤成等宽。代价是解析稍慢，对「只读看一次」可接受。
  // CSV 是纯文本，必须按字符串读入，否则 SheetJS 会把它当二进制包而解析失败。
  const wb =
    ext.replace(/^\./, '').toLowerCase() === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', cellStyles: true })
      : XLSX.read(buf, { type: 'array', cellStyles: true })

  const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : []
  const sheets = names.map((name, index) => {
    const ws = (wb.Sheets?.[name] ?? {}) as SjsSheet
    const celldata: LuckysheetCellData[] = []
    let maxR = 0
    let maxC = 0

    const ref = ws['!ref']
    if (typeof ref === 'string' && ref) {
      const range = XLSX.utils.decode_range(ref)
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as SjsCell | undefined
          if (!cell) continue
          const hasFormula = typeof cell.f === 'string' && cell.f !== ''
          const raw = cell.v
          // 空单元格跳过；但「只有公式、无缓存值」的单元格（部分生成器不写缓存值）要保留，
          // 否则公式列会凭空消失。
          if ((raw == null || raw === '') && !hasFormula) continue
          const t = raw == null ? 's' : cellType(raw)
          // 富值对象：v 存原始值、m 存显示文本（列表/日期等按 m 展示）、ct 存数字格式
          const value: Record<string, unknown> = {
            v: raw == null ? '' : t === 's' ? String(raw) : raw,
            m: cell.w != null ? String(cell.w) : raw == null ? '' : String(raw),
            ct: { fa: typeof cell.z === 'string' && cell.z ? cell.z : 'General', t },
          }
          if (hasFormula) value.f = (cell.f as string).startsWith('=') ? (cell.f as string) : `=${cell.f}`
          celldata.push({ r, c, v: value })
          if (r > maxR) maxR = r
          if (c > maxC) maxC = c
        }
      }
    }

    const config: Record<string, unknown> = {}

    // 合并单元格：{ "r_c": { r, c, rs, cs } }（luckysheet 约定）
    const merges = ws['!merges']
    if (Array.isArray(merges) && merges.length > 0) {
      const merge: Record<string, { r: number; c: number; rs: number; cs: number }> = {}
      for (const m of merges) {
        if (!m?.s || !m?.e) continue
        const rs = m.e.r - m.s.r + 1
        const cs = m.e.c - m.s.c + 1
        if (rs > 1 || cs > 1) merge[`${m.s.r}_${m.s.c}`] = { r: m.s.r, c: m.s.c, rs, cs }
      }
      if (Object.keys(merge).length > 0) config.merge = merge
    }

    // 列宽（px）：优先 wpx，退化用 wch 估算（1 字符 ≈ 7px）
    const cols = ws['!cols']
    if (Array.isArray(cols) && cols.length > 0) {
      const columnlen: Record<number, number> = {}
      cols.forEach((col, c) => {
        if (!col || col.hidden) return
        const w =
          typeof col.wpx === 'number' ? col.wpx : typeof col.wch === 'number' ? Math.round(col.wch * 7 + 5) : undefined
        if (typeof w === 'number' && w > 0) columnlen[c] = Math.round(w)
      })
      if (Object.keys(columnlen).length > 0) config.columnlen = columnlen
    }

    // 行高（px）
    const rows = ws['!rows']
    if (Array.isArray(rows) && rows.length > 0) {
      const rowlen: Record<number, number> = {}
      rows.forEach((row, r) => {
        if (!row || row.hidden) return
        const h =
          typeof row.hpx === 'number' ? row.hpx : typeof row.hpt === 'number' ? Math.round(row.hpt * (96 / 72)) : undefined
        if (typeof h === 'number' && h > 0) rowlen[r] = Math.round(h)
      })
      if (Object.keys(rowlen).length > 0) config.rowlen = rowlen
    }

    return {
      name: typeof name === 'string' && name.trim() !== '' ? name : `Sheet${index + 1}`,
      index,
      order: index,
      status: index === 0 ? 1 : 0, // luckysheet 以 status=1 标记激活工作表
      row: Math.max(maxR + 10, 100),
      column: Math.max(maxC + 3, 26),
      celldata,
      config,
    }
  })

  return { version: 3, sheets: sheets.length > 0 ? sheets : [emptySheet()] }
}
