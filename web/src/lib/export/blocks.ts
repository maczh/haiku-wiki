// 文档正文 → 结构化块（Blocks）：浏览器端导出（docx / pptx）的统一中间表示。
//
// 为什么要这层：docx 库、pptxgenjs、PDF（HTML 渲染）三者的输入各不相同，
// 若各自解析 Markdown/表格/待办等内容，同一份文档在三种格式里会长得不一样。
// 先归一成 Blocks，再由各格式各自排版，既保证一致性，也让「旧格式兼容」只做一次。

import type { DocType } from '../../types'
import { flattenSheets, parseSheetJSON } from '../sheet'
import { parseMindmapJSON } from '../mindmap'
import { parseGanttJSON, GANTT_STATUS_META, taskStatus } from '../gantt'
import type { GanttId } from '../gantt'

/** 行内片段：导出时映射为加粗/斜体/等宽/超链接 */
export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list'; ordered: boolean; items: InlineRun[][] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'quote'; runs: InlineRun[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; url: string; alt: string }
  | { type: 'divider' }

/** 纯文本包装成单段 runs */
export function runs(text: string): InlineRun[] {
  return text === '' ? [] : [{ text }]
}

/**
 * 极简行内解析：只处理 **粗体** / *斜体* / `代码` / [文字](链接)。
 * 不做完整 CommonMark：导出要的是「读起来对」，而不是解析器一致性。
 */
export function parseInline(text: string): InlineRun[] {
  const out: InlineRun[] = []
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[2] != null) out.push({ text: m[2], bold: true })
    else if (m[4] != null) out.push({ text: m[4], italic: true })
    else if (m[5] != null) out.push({ text: m[5], code: true })
    else if (m[7] != null) out.push({ text: m[6] || m[7], link: m[7] })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.filter((r) => r.text !== '')
}

/** 去掉 Markdown 标记，得到纯文本（PPT/表格单元格等场景用） */
export function plainOf(runsList: InlineRun[]): string {
  return runsList.map((r) => r.text).join('')
}

/** 单个表格单元格文本（去管道、去首尾空格） */
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())
}

/**
 * Markdown → Blocks。
 * 覆盖：ATX 标题、围栏代码块、引用、无序/有序列表、GFM 表格、分隔线、独立图片行、段落。
 */
export function markdownToBlocks(md: string): Block[] {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 空行
    if (line.trim() === '') {
      i++
      continue
    }

    // 围栏代码块
    const fence = /^\s*```+\s*([\w-]*)\s*$/.exec(line)
    if (fence) {
      const lang = fence[1] || undefined
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过收尾围栏
      blocks.push({ type: 'code', text: buf.join('\n'), lang })
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() })
      i++
      continue
    }

    // 分隔线
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'divider' })
      i++
      continue
    }

    // GFM 表格（首行 + 对齐行）
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows: string[][] = [splitRow(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', rows })
      continue
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', runs: parseInline(buf.join(' ')) })
      continue
    }

    // 独立图片行（图片不进段落，docx/pptx 各自按图片处理）
    const img = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
    if (img) {
      blocks.push({ type: 'image', url: img[2], alt: img[1] || '' })
      i++
      continue
    }

    // 列表（连续同类项合并为一个块）
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      const isOrdered = !!ordered
      const items: InlineRun[][] = []
      while (i < lines.length) {
        const b = /^\s*[-*+]\s+(.*)$/.exec(lines[i])
        const o = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
        if (isOrdered && o) items.push(parseInline(o[1]))
        else if (!isOrdered && b) items.push(parseInline(b[1]))
        else break
        i++
      }
      blocks.push({ type: 'list', ordered: isOrdered, items })
      continue
    }

    // 段落：连续非空且不属于上述类型的行合并
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    if (buf.length > 0) blocks.push({ type: 'paragraph', runs: parseInline(buf.join(' ')) })
    else i++
  }

  return blocks
}

/** 思维导图 → 缩进大纲块（每个层级一组列表项） */
function mindmapBlocks(content: string): Block[] {
  try {
    const { data } = parseMindmapJSON(content)
    const blocks: Block[] = []
    type Node = { data?: { text?: string }; children?: Node[] }
    const walk = (n: Node, depth: number) => {
      const text = n?.data?.text ?? ''
      if (text.trim() !== '') {
        // 用全角空格表现层级缩进（docx/pptx 都不需要真实嵌套列表结构）
        blocks.push({ type: 'list', ordered: false, items: [parseInline(`${'　'.repeat(depth)}${text}`)] })
      }
      for (const c of n?.children ?? []) walk(c, depth + 1)
    }
    walk(data as unknown as Node, 0)
    return blocks.length > 0 ? blocks : [{ type: 'paragraph', runs: runs('（空导图）') }]
  } catch {
    return [{ type: 'paragraph', runs: runs('（思维导图内容无法解析）') }]
  }
}

/** 表格 → 表格块（首工作表；多工作表时其余表以标题 + 表格追加） */
function sheetBlocks(content: string): Block[] {
  const { data } = parseSheetJSON(content)
  const blocks: Block[] = []
  data.sheets.forEach((sheet, idx) => {
    const { cells } = flattenSheets({ version: data.version, sheets: [sheet] })
    let maxR = 0
    let maxC = 0
    for (const key of Object.keys(cells)) {
      const [r, c] = key.split('-').map(Number)
      if (r > maxR) maxR = r
      if (c > maxC) maxC = c
    }
    const rows: string[][] = []
    for (let r = 0; r <= maxR; r++) {
      const row: string[] = []
      for (let c = 0; c <= maxC; c++) row.push(cells[`${r}-${c}`]?.text ?? '')
      rows.push(row)
    }
    if (data.sheets.length > 1) blocks.push({ type: 'heading', level: 2, text: sheet.name || `工作表${idx + 1}` })
    if (rows.length > 0) blocks.push({ type: 'table', rows })
  })
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', runs: runs('（空表格）') }]
}

/** 待办清单 → 列表块 */
function todoBlocks(content: string): Block[] {
  try {
    const o = JSON.parse(content) as { items?: { text?: string; done?: boolean; due?: string; priority?: string }[] }
    const items = (o.items ?? []).map((it) => runs(`${it.done ? '☑' : '☐'} ${it.text ?? ''}${it.due ? `（截止 ${it.due}）` : ''}`))
    return items.length > 0 ? [{ type: 'list', ordered: false, items }] : [{ type: 'paragraph', runs: runs('（空清单）') }]
  } catch {
    return [{ type: 'paragraph', runs: runs('（待办内容无法解析）') }]
  }
}

/** 工作日历 → 表格块 */
function calendarBlocks(content: string): Block[] {
  try {
    const o = JSON.parse(content) as { tasks?: { title?: string; start?: string; end?: string; done?: boolean }[] }
    const rows: string[][] = [['事项', '开始', '结束', '状态']]
    for (const t of o.tasks ?? []) rows.push([t.title ?? '', t.start ?? '', t.end ?? '', t.done ? '已完成' : '未完成'])
    return rows.length > 1 ? [{ type: 'table', rows }] : [{ type: 'paragraph', runs: runs('（空日历）') }]
  } catch {
    return [{ type: 'paragraph', runs: runs('（日历内容无法解析）') }]
  }
}

/** 甘特图 → 表格块（按层级缩进；列与后端导出一致：任务/负责人/开始/工期/进度/状态/描述） */
function ganttBlocks(content: string): Block[] {
  try {
    const { data } = parseGanttJSON(content)
    if (data.tasks.length === 0) return [{ type: 'paragraph', runs: runs('（空甘特图）') }]
    const rows: string[][] = [['任务', '负责人', '优先级', '开始', '工期(天)', '进度', '状态', '描述']]
    const walk = (parent: GanttId, depth: number) => {
      for (const t of data.tasks.filter((x) => (x.parent ?? 0) === parent)) {
        rows.push([
          `${'　'.repeat(depth)}${t.text}`,
          (t.assignees ?? []).join('、'),
          `P${t.priority ?? 5}`,
          t.type === 'milestone' ? `${t.start}（里程碑）` : t.start,
          t.type === 'milestone' ? '0' : String(t.duration),
          `${Math.round(t.progress)}%`,
          GANTT_STATUS_META[taskStatus(t)].label,
          t.details ?? '',
        ])
        walk(t.id, depth + 1)
      }
    }
    walk(0, 0)
    return rows.length > 1 ? [{ type: 'table', rows }] : [{ type: 'paragraph', runs: runs('（空甘特图）') }]
  } catch {
    return [{ type: 'paragraph', runs: runs('（甘特图内容无法解析）') }]
  }
}

/** 任意文档类型 → Blocks（导出统一入口） */
export function contentToBlocks(docType: DocType, content: string): Block[] {
  switch (docType) {
    case 'sheet':
      return sheetBlocks(content)
    case 'mindmap':
      return mindmapBlocks(content)
    case 'todo':
      return todoBlocks(content)
    case 'calendar':
      return calendarBlocks(content)
    case 'gantt':
      return ganttBlocks(content)
    case 'flowchart':
      return [{ type: 'code', text: content ?? '', lang: 'mermaid' }]
    default:
      return markdownToBlocks(content ?? '')
  }
}
