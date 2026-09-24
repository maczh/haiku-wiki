// 导入解析器注册表（I09/I12）：按扩展名分派，P1 解析器即插即用。
// 解析产物统一为 {ok, title, docType, content, children?, attachment?}，失败不产生损坏文档。
//
// 导入约定（本轮）：
//   - .docx / .doc / .pdf / .pptx / .vsd / .vsdx / .dwg / .dxf → 按原文件保存（docType=file，
//     content 为上传后回填的附件引用 JSON），不可编辑，阅读时由 FileView 分派渲染：
//       .docx → mammoth，.pdf → pdf.js，.pptx → pptx-preview（可播放），
//       .dwg/.dxf → 后端派生的 SVG/PNG（可缩放拖动），.vsd/.vsdx → 内嵌 draw.io 转换预览；
//     其中 .dwg/.dxf 上传后还需调 /api/attachments/prepare 触发后端转换并回填 derived；
//   - .drawio → 「绘图」文档，正文即 .drawio 的 XML 原文，由内嵌 draw.io 组件直接编辑保存；
//   - .xlsx / .xls / .csv / .et → 转为「表格」：每个有内容的工作表落为一个「表格」文档，
//     多表时以文件名建父「表格」，各工作表作为其子文档；单表时直接落为单文档；
//   - .smm / .km / .xmind / .mm → 思维导图：交给后端 /api/mindmap/parse 统一解析成
//     内置 .smm 正文（.xmind 是 zip 包，解压与新旧结构兼容都放服务端）；
//   - 其余文本类格式（md/txt/html）解析为对应类型的正文。

import TurndownService from 'turndown'
import * as XLSX from 'xlsx'
import DOMPurify from 'dompurify'
import type { DocType, FileAttachment } from '../../types'
import { IMPORT_EXTENSIONS, extOfName, unsupportedImportReason } from './formats'
import { collectStyleText, fixLazyImages, hiddenSelectors, pruneInvisible, stripNonContent } from './htmlClean'
import {
  DEFAULT_COL,
  DEFAULT_ROW,
  SHEET_VERSION,
  emptySheet,
  stringifySheet,
  type LuckysheetCellData,
  type LuckysheetSheet,
} from '../sheet'
import { parseMindmapFile as parseMindmapFileApi } from '../../api/mindmap'
import { excalidrawFileToContent } from '../whiteboardDoc'

/** 子文档（多文档导入产物，如 xlsx 的多工作表） */
export interface ImportChild {
  title: string
  docType: DocType
  content: string
}

export interface ParseResult {
  ok: boolean
  /** 文档标题（H1 优先，降级文件名去扩展名） */
  title: string
  docType: DocType
  content: string
  /** 失败原因（ok=false 时） */
  reason?: string
  /** 内容较大提示（>2MB 文本，不阻断） */
  large?: boolean
  /** 需在父文档创建后挂到其下的子文档 */
  children?: ImportChild[]
  /** 附件型导入：调用方需先上传原文件，再把返回的 url 回填进 content */
  attachment?: Omit<FileAttachment, 'url'>
  /** 附件型导入后是否还需调 /api/attachments/prepare 触发后端转换（CAD 类） */
  needsPrepare?: boolean
}

type Parser = (file: File) => Promise<ParseResult>

const LARGE_TEXT_BYTES = 2 * 1024 * 1024

/** 单元格/行数上限（防超大表撑爆正文与渲染） */
const MAX_SHEET_ROWS = 500
const MAX_SHEET_COLS = 50

function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** 取文件扩展名（委托 formats.ts，保证与 accept 过滤同一套规则） */
function extOf(name: string): string {
  return extOfName(name)
}

/** 文本解析结果统一包装（H1 提取标题 + 大小提示） */
function wrapText(raw: string, fallbackTitle: string, docType: DocType): ParseResult {
  const bytes = new TextEncoder().encode(raw).length
  let title = fallbackTitle
  const m = /^#\s+(.+)$/m.exec(raw)
  if (m && m[1].trim()) title = m[1].trim()
  return { ok: true, title: title.slice(0, 256), docType, content: raw, large: bytes > LARGE_TEXT_BYTES }
}

// ---------- Markdown ----------

const parseMd: Parser = async (file) => {
  const raw = await file.text()
  return wrapText(raw, baseName(file.name), 'markdown')
}

// ---------- 思维导图（.smm / .km / .xmind / .mm → 内置 smm） ----------

const parseMindmapFile: Parser = async (file) => {
  const title = baseName(file.name)
  try {
    const res = await parseMindmapFileApi(file)
    if (!res.content || !res.content.trim()) {
      return { ok: false, title, docType: 'mindmap', content: '', reason: '文件中没有解析出思维导图节点' }
    }
    return { ok: true, title: (res.title || title).slice(0, 256), docType: 'mindmap', content: res.content }
  } catch (e) {
    // 后端会把具体原因（例如「未找到 content.json」）放在错误消息里，直接透出更有用
    const msg = (e as { message?: string })?.message || '思维导图解析失败'
    return { ok: false, title, docType: 'mindmap', content: '', reason: msg }
  }
}

// ---------- 附件型（原样保存，不解析正文） ----------

/** 按原文件保存的附件型扩展名 */
const ATTACHMENT_EXTS = ['docx', 'doc', 'pdf', 'pptx', 'vsd', 'vsdx', 'dwg', 'dxf']

/** 需要后端转换派生产物的附件（DWG/DXF → SVG/PNG） */
export const CAD_IMPORT_EXTS = ['dwg', 'dxf']

const parseAttachment: Parser = async (file) => {
  const ext = extOf(file.name)
  return {
    ok: true,
    title: baseName(file.name),
    docType: 'file',
    content: '', // 真实 content 由导入流程上传原文件后写入
    attachment: { filename: file.name, size: file.size, ext },
    needsPrepare: CAD_IMPORT_EXTS.includes(ext),
  }
}

// ---------- drawio（绘图文档：正文即 XML 原文） ----------

const parseDrawio: Parser = async (file) => {
  const raw = await file.text()
  if (!raw.trim()) {
    return { ok: false, title: baseName(file.name), docType: 'drawing', content: '', reason: '绘图文件为空' }
  }
  // 轻量校验：drawio 文件应为 XML（可能是 <mxfile> 或 <mxGraphModel>）
  if (!/<(mxfile|mxGraphModel|mxGraphModel\s)/i.test(raw) && !raw.trimStart().startsWith('<')) {
    return {
      ok: false,
      title: baseName(file.name),
      docType: 'drawing',
      content: '',
      reason: '不是有效的 .drawio 文件（应为 XML 格式）',
    }
  }
  return { ok: true, title: baseName(file.name), docType: 'drawing', content: raw }
}

// ---------- excalidraw（白板文档：剥壳存场景 JSON） ----------

const parseExcalidraw: Parser = async (file) => {
  const raw = await file.text()
  const title = baseName(file.name)
  if (!raw.trim()) {
    return { ok: false, title, docType: 'whiteboard', content: '', reason: '白板文件为空' }
  }
  const content = excalidrawFileToContent(raw)
  if (!content) {
    return {
      ok: false,
      title,
      docType: 'whiteboard',
      content: '',
      reason: '不是有效的 .excalidraw 文件（应为 Excalidraw 场景 JSON）',
    }
  }
  return { ok: true, title, docType: 'whiteboard', content }
}

// ---------- xlsx / xls / csv / et：每个有内容的工作表 → 一个「表格」 ----------

/**
 * 单个工作表 → 表格内容字符串（v3：Luckysheet 的 celldata）；无内容返回 null。
 * 数值/布尔按「原样入格 + 文本回显」保存（Luckysheet 会按 ct 判定类型），
 * 其余一律按文本保存，避免把 "1-2" 之类的字符串误解析成公式或日期。
 */
function sheetToContent(ws: XLSX.WorkSheet, sheetName?: string): string | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  const celldata: LuckysheetCellData[] = []
  let r = 0
  let maxC = 0
  for (const row of rows.slice(0, MAX_SHEET_ROWS)) {
    let c = 0
    for (const v of row.slice(0, MAX_SHEET_COLS)) {
      const text = String(v ?? '').trim()
      if (text !== '') {
        const numeric = typeof v === 'number' && Number.isFinite(v)
        const bool = typeof v === 'boolean'
        celldata.push({
          r,
          c,
          v: numeric || bool ? { v, m: text, ct: { fa: 'General', t: numeric ? 'n' : 'b' } } : { v: text, m: text, ct: { fa: 'General', t: 's' } },
        })
        if (c > maxC) maxC = c
      }
      c++
    }
    r++
  }
  if (celldata.length === 0) return null
  const sheet: LuckysheetSheet = {
    ...emptySheet(sheetName && sheetName.trim() !== '' ? sheetName : 'Sheet1'),
    row: Math.max(DEFAULT_ROW, r + 10),
    column: Math.max(DEFAULT_COL, maxC + 3),
    celldata,
  }
  return stringifySheet({ version: SHEET_VERSION, sheets: [sheet] })
}

const parseXlsx: Parser = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheets: { name: string; content: string }[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const content = sheetToContent(ws, name)
    if (content) sheets.push({ name, content })
  }
  const title = baseName(file.name)
  if (sheets.length === 0) {
    return { ok: false, title, docType: 'sheet', content: '', reason: '工作簿中没有有内容的工作表' }
  }
  // 单工作表：直接落为单个「表格」文档
  if (sheets.length === 1) {
    return { ok: true, title, docType: 'sheet', content: sheets[0].content }
  }
  // 多工作表：父「表格」代表整个工作簿，每个工作表 → 一个「表格」子文档
  return {
    ok: true,
    title,
    docType: 'sheet',
    content: '',
    children: sheets.map((s) => ({ title: s.name, docType: 'sheet' as DocType, content: s.content })),
  }
}

// ---------- pdf（附件型，不再抽取文本层） ----------

// ---------- html（P3：DOMParser → DOMPurify 清洗 → turndown） ----------

/**
 * HTML → Markdown（CSS + 脚本综合处理）。
 *
 * 处理顺序（每一步都只做一件事，便于定位问题）：
 *   ① 取 <style> 文本，静态解析出「会把元素藏起来」的选择器（display:none 等）；
 *   ② 剔除 <script>/<style>/<template>/<svg>/<iframe> 等不产出正文的节点——
 *      脚本文本绝不进正文；DOMParser 不执行脚本，因此「脚本生成的可见文本」在
 *      本环境里并不存在，保留的就是 DOM 现有的可见文本节点；
 *   ③ 按 ① 的选择器 + inline style + hidden 属性剔除不可见元素，隐藏文案不落正文；
 *   ④ 补懒加载图片的 src（data-src 等），保证图片在 Markdown 里仍是可访问 URL；
 *   ⑤ DOMPurify 清洗（防 XSS 与样式残留）→ turndown 转 Markdown（保留链接与图片）。
 */
const parseHtml: Parser = async (file) => {
  const raw = await file.text()
  const dom = new DOMParser().parseFromString(raw, 'text/html')
  // 标题优先取 <title>，否则文件名去扩展名
  const title = (dom.title || '').trim() || baseName(file.name)
  const body = dom.body
  if (!body || !body.innerHTML.trim()) {
    return { ok: false, title, docType: 'markdown', content: '', reason: 'HTML 中没有可见内容' }
  }

  // ① 隐藏类选择器（脚本不执行、无布局，只能静态解析 CSS）
  const hiddenSels = hiddenSelectors(collectStyleText(dom))
  // ② 脚本/样式/嵌入对象：不进正文
  stripNonContent(body)
  // ③ 不可见元素：整棵子树移除，避免隐藏文案污染正文
  pruneInvisible(body, hiddenSels)
  // ④ 懒加载图片补 src（base64 占位图不算可用源）
  fixLazyImages(body)

  if (!body.innerHTML.trim()) {
    return { ok: false, title, docType: 'markdown', content: '', reason: 'HTML 中没有可见内容（全部为脚本或隐藏元素）' }
  }

  // ⑤ 清洗（DOMPurify 默认即拦 script，显式声明以示边界）+ 转 Markdown
  const cleaned = DOMPurify.sanitize(body.innerHTML, {
    FORBID_TAGS: ['style', 'script', 'noscript', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  })
  const text = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(cleaned)
  if (!text.trim()) {
    return { ok: false, title, docType: 'markdown', content: '', reason: 'HTML 转换结果为空' }
  }
  return wrapText(text, title, 'markdown')
}

// ---------- pptx：按原文件保存（阅读时由 pptx-preview 渲染并支持播放） ----------
// 说明：本轮起 .pptx 不再抽取纯文本转成 Markdown，而是保留源文件——
// 需求要求「保留源文件 + 前端预览/播放 + 原文件下载」，只有原文件才谈得上版式还原与下载。

// ---------- WPS 兼容格式（.et 按 xlsx 解析；.wps/.dps 给出明确提示） ----------

const failUnsupported = (kind: 'wps' | 'dps'): Parser => async (file) => ({
  ok: false,
  title: baseName(file.name),
  docType: 'markdown',
  content: '',
  reason:
    kind === 'wps'
      ? '暂不支持直接导入 .wps，请在 WPS 中另存为 .docx 后再导入'
      : '格式暂不支持：演示文稿（.dps）暂无法导入',
})

// ---------- 注册表 ----------

/** 扩展名 → 解析器（小写扩展名键） */
export const parserRegistry: Record<string, Parser> = {
  md: parseMd,
  markdown: parseMd,
  txt: parseMd,
  docx: parseAttachment,
  doc: parseAttachment,
  pdf: parseAttachment,
  pptx: parseAttachment, // 保留源文件，前端 pptx-preview 预览/播放
  vsd: parseAttachment, // Visio：保留源文件，阅读页由 draw.io 转换预览
  vsdx: parseAttachment,
  dwg: parseAttachment, // AutoCAD：保留源文件，后端派生 SVG/PNG
  dxf: parseAttachment,
  drawio: parseDrawio, // 绘图文档：正文即 XML，可直接编辑保存
  excalidraw: parseExcalidraw, // 白板文档：剥壳存场景 JSON，编辑态可继续绘制
  smm: parseMindmapFile, // 思维导图：四种外部格式统一转成内置 smm
  km: parseMindmapFile,
  xmind: parseMindmapFile,
  mm: parseMindmapFile,
  xlsx: parseXlsx,
  xls: parseXlsx,
  csv: parseXlsx,
  html: parseHtml,
  htm: parseHtml,
  wps: failUnsupported('wps'),
  et: parseXlsx,
  dps: failUnsupported('dps'),
}

/**
 * 文件选择框的 accept：由 formats.ts 的映射表生成（而非注册表键），
 * 保证「下拉选中的格式」与「对话框能选到的扩展名」严格一一对应。
 */
export const ACCEPT_EXTENSIONS = IMPORT_EXTENSIONS.map((k) => `.${k}`).join(',')

/** 按扩展名分派解析器；未知扩展名返回失败结果（不产生任何文档） */
export async function parseFile(file: File): Promise<ParseResult> {
  const ext = extOf(file.name)
  const parser = parserRegistry[ext]
  if (!parser) {
    // 统一拒绝文案：导入列表与 toast 共用 formats.ts 的措辞，避免各处不一致
    return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: unsupportedImportReason(file.name) }
  }
  try {
    return await parser(file)
  } catch {
    return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: '解析失败：文件可能已损坏或格式暂不支持' }
  }
}
