// 附件型文档（doc_type=file）前端公共能力：
// 解析 content 中的附件引用、按扩展名判定预览方式、按需加载 pdf.js worker。
// 与后端 exportx.FileRef 结构一致。

import type { FileAttachment } from '../types'

/** 在线预览支持的附件类型 */
export type AttachmentKind = 'pdf' | 'docx' | 'pptx' | 'cad' | 'drawio' | 'image' | 'other'

/** 解析附件引用；非法内容返回 null（阅读界面据此给出友好提示） */
export function parseAttachment(content: string): FileAttachment | null {
  if (!content || !content.trim()) return null
  try {
    const o = JSON.parse(content) as Partial<FileAttachment>
    if (!o || typeof o.url !== 'string' || !o.url.trim()) return null
    const filename = typeof o.filename === 'string' && o.filename ? o.filename : '附件'
    const ext = (typeof o.ext === 'string' && o.ext ? o.ext : extOf(filename)).toLowerCase()
    // 派生产物：仅保留非空的字符串项，避免脏数据传到界面上
    let derived: Record<string, string> | undefined
    if (o.derived && typeof o.derived === 'object') {
      for (const [k, v] of Object.entries(o.derived)) {
        if (typeof v === 'string' && v.trim()) (derived ??= {})[k] = v.trim()
      }
    }
    return {
      url: o.url.trim(),
      filename,
      size: typeof o.size === 'number' && o.size >= 0 ? o.size : 0,
      ext,
      derived,
      degraded: o.degraded === true,
      note: typeof o.note === 'string' ? o.note : undefined,
      pptx_scanned: o.pptx_scanned === true,
    }
  } catch {
    return null
  }
}

/** 扩展名（小写，不含点） */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** CAD 类扩展名（后端可自动派生 svg/png） */
export const CAD_EXTS = ['dwg', 'dxf']

/** draw.io 可打开的绘图扩展名（.vsd/.vsdx 为 Visio，由 draw.io 内部转换导入） */
export const DRAWIO_EXTS = ['drawio', 'vsd', 'vsdx']

/** 图片类扩展名（浏览器原生可显示） */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

/**
 * 预览方式：
 *  pdf → pdf.js 分页；docx → mammoth；pptx → pptx-preview（可播放）；
 *  cad（仅当已有派生 svg/png）→ 矢量预览（缩放/拖动）；image → <img>；其余仅提供下载。
 */
export function attachmentKind(ext: string): AttachmentKind {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (e === 'pdf') return 'pdf'
  if (e === 'docx') return 'docx'
  if (e === 'pptx') return 'pptx'
  if (CAD_EXTS.includes(e)) return 'cad'
  if (DRAWIO_EXTS.includes(e)) return 'drawio'
  if (IMAGE_EXTS.includes(e)) return 'image'
  return 'other'
}

/** 人类可读体积 */
export function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** pdf.js 加载单例（worker 只初始化一次；vite 下经 ?url 生成静态资源地址） */
let pdfModule: typeof import('pdfjs-dist') | null = null
export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfModule) return pdfModule
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  pdfModule = pdfjs
  return pdfjs
}
