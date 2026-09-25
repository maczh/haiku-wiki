// OnlyOffice Web Comp 编辑型办公文档（Excel/Word/PPT）的前端公共能力。
//
// 这类文档的正文不是内联 JSON，而是「附件引用」：{ url, filename, size, ext }，
// 与 file 型附件的 FileAttachment 同构（见 lib/attachment.ts），因此阅读态可复用 FileView。
// 存储完全复用现有 Go 后端：二进制经 /uploads（含 CAS 秒传）落盘，正文只存引用。

import { FILE_TYPE, type FileType } from '../components/onlyoffice-web-comp'
import type { DocType } from '../types'
import type { UploadResult } from '../types'
import { extOf } from './attachment'

export type OfficeDocType = 'sheet' | 'word' | 'ppt'

/** OnlyOffice 编辑型文档类型（注意：sheet 同时承载旧版 luckysheet，需结合内容判断走哪条编辑器） */
export function isOfficeDocType(docType: DocType): docType is OfficeDocType {
  return docType === 'sheet' || docType === 'word' || docType === 'ppt'
}

/** 文档类型 → OnlyOffice 主格式（FILE_TYPE 为大写：DOCX / XLSX / PPTX） */
export function fileTypeForDocType(docType: OfficeDocType): FileType {
  if (docType === 'word') return FILE_TYPE.DOCX
  if (docType === 'ppt') return FILE_TYPE.PPTX
  return FILE_TYPE.XLSX // sheet → Excel
}

/** 文档类型 → 默认扩展名（小写） */
export function extForDocType(docType: OfficeDocType): string {
  if (docType === 'word') return 'docx'
  if (docType === 'ppt') return 'pptx'
  return 'xlsx'
}

const OFFICE_EXTS = ['xlsx', 'xls', 'csv', 'docx', 'doc', 'pptx', 'ppt', 'ods', 'odt', 'odp']

/**
 * 正文是否为 OnlyOffice 办公文件引用。
 * 旧版「表格」(luckysheet) 正文是 {version,sheets|cells,...}，不含 url；
 * 新版 Excel 文档正文是 {url,filename,size,ext}，含 url 且 ext 为办公格式。
 */
export function isOfficeContent(content: string): boolean {
  if (!content || !content.trim()) return false
  try {
    const o = JSON.parse(content) as { url?: unknown; ext?: unknown; filename?: unknown }
    if (typeof o.url !== 'string' || !o.url.trim()) return false
    const ext = (typeof o.ext === 'string' && o.ext ? o.ext : extOf(String(o.filename ?? ''))).toLowerCase()
    return OFFICE_EXTS.includes(ext)
  } catch {
    return false
  }
}

/**
 * 正文是否为旧版 luckysheet「表格」数据（需走 Luckysheet 编辑器兜底）。
 * 特征：JSON 且带 version + sheets/cells。新版 office 引用不含这些键。
 */
export function isLegacySheetContent(content: string): boolean {
  if (!content || !content.trim()) return false
  try {
    const o = JSON.parse(content) as { version?: unknown; sheets?: unknown; cells?: unknown }
    if (o && typeof o === 'object' && typeof o.version === 'number' && (o.sheets || o.cells)) {
      return true
    }
  } catch {
    /* 非 JSON */
  }
  return false
}

/** 从正文解析办公文件引用；非法返回 null */
export function parseOfficeRef(content: string): { url: string; filename: string; ext: string } | null {
  if (!isOfficeContent(content)) return null
  try {
    const o = JSON.parse(content) as { url: string; filename?: string; ext?: string }
    const ext = (o.ext || extOf(o.filename || '') || '').toLowerCase()
    return { url: o.url, filename: o.filename || `document.${ext}`, ext }
  } catch {
    return null
  }
}

/** 上传结果 → 写入正文的内容引用（与 FileAttachment 同构，阅读态 FileView 可直接复用） */
export function officeRefFromUpload(res: UploadResult, fallbackExt: string, fileName: string) {
  const ext = (res.filename ? extOf(res.filename) : '') || fallbackExt
  return {
    url: res.url,
    filename: res.filename || fileName,
    size: typeof res.size === 'number' ? res.size : 0,
    ext,
  }
}
