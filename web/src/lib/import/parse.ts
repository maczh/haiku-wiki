// 导入解析器注册表（I09/I12）：按扩展名分派，P1 解析器即插即用。
// 解析产物统一为 {ok, title, docType, content}，失败不产生损坏文档。

import mammoth from 'mammoth'
import TurndownService from 'turndown'
import * as XLSX from 'xlsx'
import type { DocType } from '../../types'
import { stringifySheet, type SheetJSON } from '../sheet'

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
}

type Parser = (file: File) => Promise<ParseResult>

const LARGE_TEXT_BYTES = 2 * 1024 * 1024

function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
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

// ---------- docx（P1：mammoth → HTML（图片 base64 内联）→ turndown） ----------

const parseDocx: Parser = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => ({
        src: `data:${image.contentType};base64,${await image.read('base64')}`,
      })),
    },
  )
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  const md = turndown.turndown(result.value)
  return wrapText(md, baseName(file.name), 'markdown')
}

// ---------- xlsx / et（P1：SheetJS → SheetJSON，读首个工作表的值） ----------

const parseXlsx: Parser = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { ok: false, title: baseName(file.name), docType: 'sheet', content: '', reason: '工作簿中没有工作表' }
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '' })
  const cells: SheetJSON['cells'] = {}
  let r = 0
  for (const row of rows.slice(0, 200)) {
    let c = 0
    for (const v of row.slice(0, 30)) {
      const text = String(v ?? '').trim()
      if (text !== '') cells[`${r}-${c}`] = { text }
      c++
    }
    r++
  }
  const data: SheetJSON = { version: 1, cells, colLen: 26, rowLen: 100 }
  return {
    ok: true,
    title: baseName(file.name),
    docType: 'sheet',
    content: stringifySheet(data),
    large: false,
  }
}

// ---------- pdf（P1：pdf.js 文本层 → Markdown） ----------

let pdfWorkerReady = false
async function ensurePdfWorker() {
  if (pdfWorkerReady) return
  const pdfjs = await import('pdfjs-dist')
  // Vite 下 worker 引入方式：?url 生成静态资源地址
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  pdfWorkerReady = true
}

const parsePdf: Parser = async (file) => {
  await ensurePdfWorker()
  const pdfjs = await import('pdfjs-dist')
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf }).promise
  const parts: string[] = []
  const maxPages = Math.min(doc.numPages, 100) // 超长 PDF 截断保护
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i)
    const tc = await page.getTextContent()
    const text = tc.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) parts.push(`## 第 ${i} 页\n\n${text}`)
  }
  if (parts.length === 0) {
    return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: 'PDF 中未提取到文本（可能是扫描件）' }
  }
  return wrapText(parts.join('\n\n'), baseName(file.name), 'markdown')
}

// ---------- WPS 兼容格式（.wps/.et/.dps 按容错格式尝试，失败友好提示） ----------

const parseWpsLike = (kind: 'wps' | 'et' | 'dps'): Parser => async (file) => {
  if (kind === 'wps') {
    try {
      return await parseDocx(file) // .wps 新版为 docx 兼容格式
    } catch {
      return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: '格式暂不支持：仅支持新版 WPS 文字（docx 兼容格式）' }
    }
  }
  if (kind === 'et') {
    try {
      return await parseXlsx(file) // .et 新版为 xlsx 兼容格式
    } catch {
      return { ok: false, title: baseName(file.name), docType: 'sheet', content: '', reason: '格式暂不支持：仅支持新版 WPS 表格（xlsx 兼容格式）' }
    }
  }
  return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: '格式暂不支持：演示文稿（.dps）暂无法导入' }
}

// ---------- 注册表 ----------

/** 扩展名 → 解析器（小写扩展名键） */
export const parserRegistry: Record<string, Parser> = {
  md: parseMd,
  markdown: parseMd,
  txt: parseMd,
  docx: parseDocx,
  xlsx: parseXlsx,
  xls: parseXlsx,
  csv: parseXlsx,
  pdf: parsePdf,
  wps: parseWpsLike('wps'),
  et: parseWpsLike('et'),
  dps: parseWpsLike('dps'),
}

export const ACCEPT_EXTENSIONS = Object.keys(parserRegistry)
  .map((k) => `.${k}`)
  .join(',')

/** 按扩展名分派解析器；未知扩展名返回失败结果 */
export async function parseFile(file: File): Promise<ParseResult> {
  const ext = (file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : '').toLowerCase()
  const parser = parserRegistry[ext]
  if (!parser) {
    return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: `暂不支持 .${ext || '未知'} 格式` }
  }
  try {
    return await parser(file)
  } catch {
    return { ok: false, title: baseName(file.name), docType: 'markdown', content: '', reason: '解析失败：文件可能已损坏或格式暂不支持' }
  }
}
