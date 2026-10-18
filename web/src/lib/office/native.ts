import type { Presentation } from '@eflink-tech/pptx'
import { parseAttachment } from '../attachment'
import type { FileAttachment } from '../../types'

export interface NativeOfficeAttachment extends FileAttachment {
  edited_url?: string
}

export interface PptxDocument extends Partial<NativeOfficeAttachment> {
  schema: 'haiku.pptx/1'
  presentation: Presentation
}

export function parseNativeAttachment(content: string): NativeOfficeAttachment | null {
  const ref = parseAttachment(content)
  if (!ref) return null
  let editedUrl: string | undefined
  try {
    const value = JSON.parse(content) as { edited_url?: unknown }
    if (typeof value.edited_url === 'string' && value.edited_url.trim()) editedUrl = value.edited_url.trim()
  } catch {
    // parseAttachment already validated the JSON; keep the original URL.
  }
  return { ...ref, ...(editedUrl ? { edited_url: editedUrl } : {}) }
}

export function parsePptxDocument(content: string): PptxDocument | null {
  try {
    const value = JSON.parse(content) as PptxDocument
    if (value?.schema === 'haiku.pptx/1' && Array.isArray(value.presentation?.slides)) return value
  } catch {
    // Imported PPTX attachments are handled by the caller.
  }
  return null
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

