import type { DocType } from '../../types'

export type ClientFormat = 'docx' | 'pptx' | 'ppts' | 'pdf' | 'png'

export const CLIENT_FORMAT_EXT: Record<ClientFormat, string> = {
  docx: 'docx',
  pptx: 'pptx',
  ppts: 'ppts',
  pdf: 'pdf',
  png: 'png',
}

export function safeFilename(title: string, ext: string): string {
  const cleaned = (title || '未命名文档').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim()
  const base = (cleaned || '未命名文档').replace(new RegExp(`\\.${ext}$`, 'i'), '')
  return `${base || '未命名文档'}.${ext}`
}

export function clientFormatsFor(docType: DocType, fileExt?: string): { value: ClientFormat; label: string }[] {
  // PPTist stores its own slide model; generic text-based exporters cannot render it.
  if (docType === 'powerpoint' || docType === 'excel') return []
  if (docType === 'file') {
    const ext = (fileExt ?? '').toLowerCase()
    if (ext === 'docx') return [
      { value: 'docx', label: 'Word 文档（.docx）· 原文件' },
      { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
    ]
    if (ext === 'pptx') return [
      { value: 'pptx', label: 'PowerPoint（.pptx）· 原文件' },
      { value: 'ppts', label: 'WPS 演示（.ppts）· 兼容扩展名' },
      { value: 'pdf', label: 'PDF 文档（.pdf）· 按幻灯片渲染' },
    ]
    return []
  }
  if (docType === 'drawing' || docType === 'api') return []
  if (docType === 'whiteboard') return [
    { value: 'png', label: '图片（.png）· 浏览器生成' },
    { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
  ]
  return [
    { value: 'docx', label: 'Word 文档（.docx）· 浏览器生成' },
    { value: 'pptx', label: 'PowerPoint（.pptx）· 浏览器生成' },
    { value: 'ppts', label: 'WPS 演示（.ppts）· 兼容扩展名' },
    { value: 'pdf', label: 'PDF 文档（.pdf）· 浏览器生成' },
  ]
}
