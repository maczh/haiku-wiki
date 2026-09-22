// 浏览器端导出编排（B2 / B3）。
//
// 设计要点：
//  · 服务端仍是「能服务端做就服务端做」的主力（md/xlsx/csv/km/…），本模块只补上
//    服务端做不了或做不好的：Word（.docx）、演示（.pptx/.ppts）、PDF；
//  · 所有分支都必须产出 Blob 或明确抛出可读错误，绝不给用户一个打不开的文件；
//  · .ppts 明确为「.pptx 内容 + .ppts 扩展名」的兼容降级，UI 会如实说明。

import type { DocType } from '../../types'
import { contentToBlocks } from './blocks'
import { buildDocx } from './docx'
import { buildPptx, pptxAttachmentToPdf } from './pptx'
import { htmlToPdf, printHtml } from './pdf'
import { contentToHtml, docxUrlToHtml } from './html'

/** 浏览器端可生成的格式 */
export type ClientFormat = 'docx' | 'pptx' | 'ppts' | 'pdf' | 'png'

export interface ClientExportInput {
  docType: DocType
  content: string
  title: string
  /** 附件型文档：原始文件 URL（docx 附件转 PDF 时需要） */
  fileUrl?: string
  /** 附件型文档：原始文件扩展名 */
  fileExt?: string
}

export interface ClientExportResult {
  blob: Blob
  ext: string
  /** 附加说明（如 .ppts 的兼容说明、降级说明），为空表示无 */
  note?: string
}

/** 格式 → 默认扩展名 */
export const CLIENT_FORMAT_EXT: Record<ClientFormat, string> = {
  docx: 'docx',
  pptx: 'pptx',
  ppts: 'ppts',
  pdf: 'pdf',
  png: 'png',
}

/** 文件名（去掉非法字符） */
export function safeFilename(title: string, ext: string): string {
  const cleaned = (title || '未命名文档').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim()
  const base = (cleaned || '未命名文档').replace(new RegExp(`\\.${ext}$`, 'i'), '')
  return `${base || '未命名文档'}.${ext}`
}

/**
 * 执行浏览器端导出。
 * 抛出的错误会由调用方（ExportDialog）直接展示，因此错误信息要能照着做。
 */
export async function exportClientDoc(format: ClientFormat, input: ClientExportInput): Promise<ClientExportResult> {
  const blocks = contentToBlocks(input.docType, input.content ?? '')

  switch (format) {
    case 'docx': {
      // 附件本身就是 .docx：直接回传原文件（内容完全一致，比二次生成更保险）
      if (input.docType === 'file' && input.fileExt === 'docx' && input.fileUrl) {
        const blob = await fetchBlob(input.fileUrl)
        return { blob, ext: 'docx' }
      }
      const blob = await buildDocx(blocks, input.title)
      return { blob, ext: 'docx' }
    }
    case 'pptx':
    case 'ppts': {
      // 附件本身就是 .pptx：原文件另存（生成不出比原稿更还原的演示文稿）
      if (input.docType === 'file' && input.fileExt === 'pptx' && input.fileUrl) {
        const blob = await fetchBlob(input.fileUrl)
        return {
          blob,
          ext: format,
          note:
            format === 'ppts'
              ? '已按 WPS 演示的 .ppts 扩展名保存（内容仍为标准 .pptx），WPS 可直接打开。'
              : undefined,
        }
      }
      const blob = await buildPptx(blocks, input.title)
      return {
        blob,
        ext: format,
        note:
          format === 'ppts'
            ? '.ppts 是 WPS 演示的自有封装，开源库无法生成真正的 .ppts 二进制；这里以「标准 .pptx 内容 + .ppts 扩展名」保存，WPS 可直接打开，PowerPoint 请把扩展名改回 .pptx。'
            : undefined,
      }
    }
    case 'pdf': {
      // PPTX 附件：用阅读页同一套幻灯片渲染器逐页位图化，版面与原稿一致
      if (input.docType === 'file' && input.fileExt === 'pptx' && input.fileUrl) {
        return { blob: await pptxAttachmentToPdf(input.fileUrl, input.title), ext: 'pdf' }
      }
      // 白板：PDF = 场景位图落 A4 横向（走 Excalidraw 导出器，不走正文 HTML 化）
      if (input.docType === 'whiteboard') {
        return { blob: await whiteboardPdfBlob(input.content), ext: 'pdf' }
      }
      const html = await htmlOf(input)
      return { blob: await htmlToPdf(html, input.title), ext: 'pdf' }
    }
    case 'png': {
      // 目前仅白板提供浏览器端 PNG（场景 → 位图，与编辑器内导出同一套实现）
      if (input.docType === 'whiteboard') {
        return { blob: await whiteboardPngBlob(input.content), ext: 'png' }
      }
      throw new Error('该文档类型暂不支持浏览器端导出 PNG')
    }
    default:
      throw new Error(`不支持的浏览器端导出格式：${format}`)
  }
}

/** 取 PDF 用的 HTML：docx 附件走 mammoth，其余走 contentToHtml */
async function htmlOf(input: ClientExportInput): Promise<string> {
  if (input.docType === 'file' && input.fileExt === 'docx' && input.fileUrl) {
    try {
      return await docxUrlToHtml(input.fileUrl)
    } catch {
      // 附件读取/转换失败：退化为一页说明，仍然可打印
      return `<h1>${input.title}</h1><p>（docx 附件内容无法在浏览器内转换，可在 WPS / Word 中打开后导出 PDF）</p>`
    }
  }
  return await contentToHtml(input.docType, input.content ?? '', input.title)
}

/** 打开打印视图兜底（html2canvas 失败或目标无法位图化时使用） */
export async function printClientDoc(input: ClientExportInput): Promise<void> {
  const html = await htmlOf(input)
  printHtml(html, input.title)
}

async function fetchBlob(url: string): Promise<Blob> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`无法读取原文件（HTTP ${resp.status}）`)
  return await resp.blob()
}

/** 白板正文 → 场景三件套（导出 png/pdf 前置）；空场景给出可读错误 */
async function whiteboardSceneOf(content: string): Promise<{
  elements: unknown[]
  appState: Record<string, unknown> | null
  files: Record<string, unknown>
}> {
  const { parseWhiteboardContent } = await import('../whiteboardDoc')
  const s = parseWhiteboardContent(content ?? '')
  if (s.elements.length === 0) throw new Error('白板内容为空，无法导出')
  return s
}

async function whiteboardPngBlob(content: string): Promise<Blob> {
  const s = await whiteboardSceneOf(content)
  const { exportWhiteboardPngBlob } = await import('../whiteboardExport')
  return exportWhiteboardPngBlob(s.elements, s.appState, s.files)
}

async function whiteboardPdfBlob(content: string): Promise<Blob> {
  const s = await whiteboardSceneOf(content)
  const { exportWhiteboardPdfBlob } = await import('../whiteboardExport')
  return exportWhiteboardPdfBlob(s.elements, s.appState, s.files)
}

/** 该文档类型在浏览器端额外提供的格式（与服务端格式清单合并展示） */
export function clientFormatsFor(docType: DocType, fileExt?: string): { value: ClientFormat; label: string }[] {
  if (docType === 'file') {
    const ext = (fileExt ?? '').toLowerCase()
    if (ext === 'docx') {
      return [
        { value: 'docx', label: 'Word 文档（.docx）· 原文件' },
        { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
      ]
    }
    if (ext === 'pptx') {
      return [
        { value: 'pptx', label: 'PowerPoint（.pptx）· 原文件' },
        { value: 'ppts', label: 'WPS 演示（.ppts）· 兼容扩展名' },
        { value: 'pdf', label: 'PDF 文档（.pdf）· 按幻灯片渲染' },
      ]
    }
    return []
  }
  if (docType === 'drawing') return [] // 绘图由编辑器内 draw.io 导出
  if (docType === 'whiteboard') {
    // 白板：excalidraw/svg 由服务端转换（正文自带场景与 SVG 预览）；
    // png/pdf 需要 Excalidraw 渲染器（仅存在于浏览器侧），在此提供
    return [
      { value: 'png', label: '图片（.png）· 浏览器生成' },
      { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
    ]
  }
  return [
    { value: 'docx', label: 'Word 文档（.docx）· 浏览器生成' },
    { value: 'pptx', label: 'PowerPoint（.pptx）· 浏览器生成' },
    { value: 'ppts', label: 'WPS 演示（.ppts）· 兼容扩展名' },
    { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
  ]
}
