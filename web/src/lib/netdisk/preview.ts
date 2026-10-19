/**
 * 网盘文件的**预览类型判定**。
 *
 * ⚠️ 这是一个独立函数，**不要**与 `lib/attachment.ts` 的 `attachmentKind()` 合并：
 * 后者只认 pdf/docx/pptx/drawio/image，语义是「文库附件文档」，且不含视频/音频/纯文本。
 * 网盘预览的口径来自 PRD §3.4-D2（文库可渲染类型 + 图片 + 视频 + 音频 + 纯文本）。
 */

export type NetdiskPreviewKind = 'reader' | 'image' | 'video' | 'audio' | 'text' | 'unsupported'

/** 取扩展名（小写，无扩展名返回空串） */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'avif']
const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'flv', 'm3u8']
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']
const TEXT_EXTS = [
  'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'log', 'sql',
  'js', 'jsx', 'ts', 'tsx', 'vue', 'css', 'scss', 'less',
  'go', 'java', 'py', 'rb', 'php', 'c', 'h', 'cpp', 'cs', 'rs', 'sh', 'bat',
]
/** 走文库渲染器（DocContent）的二进制/结构化文件 */
const READER_BINARY_EXTS = ['pdf', 'docx', 'xlsx', 'pptx', 'vsd', 'vsdx']
/** 走文库渲染器的文本型文件 */
const READER_TEXT_EXTS: { ext: string; docType: 'markdown' | 'drawing' | 'whiteboard' }[] = [
  { ext: 'md', docType: 'markdown' },
  { ext: 'markdown', docType: 'markdown' },
  { ext: 'txt', docType: 'markdown' },
  { ext: 'html', docType: 'markdown' },
  { ext: 'htm', docType: 'markdown' },
  { ext: 'drawio', docType: 'drawing' },
  { ext: 'excalidraw', docType: 'whiteboard' },
]

/** 是否可预览 */
export function isPreviewSupported(name: string): boolean {
  return netdiskPreviewKind(name) !== 'unsupported'
}

/** 预览分类 */
export function netdiskPreviewKind(name: string): NetdiskPreviewKind {
  const ext = extOf(name)
  if (!ext) return 'unsupported'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (TEXT_EXTS.includes(ext)) return 'text'
  if (READER_BINARY_EXTS.includes(ext)) return 'reader'
  if (READER_TEXT_EXTS.some((r) => r.ext === ext)) return 'reader'
  return 'unsupported'
}

/**
 * 预览时要用的 doc_type。
 *   - 二进制（pdf/docx/xlsx/pptx/vsd/vsdx）→ 'file'，配合 FileAttachment JSON 交给 FileView
 *   - 文本型 → markdown / drawing / whiteboard
 *   - 其余 → null（调用方走图片/视频/音频/纯文本分支）
 */
export function netdiskPreviewDocType(name: string): 'file' | 'markdown' | 'drawing' | 'whiteboard' | null {
  const ext = extOf(name)
  if (READER_BINARY_EXTS.includes(ext)) return 'file'
  const hit = READER_TEXT_EXTS.find((r) => r.ext === ext)
  return hit ? hit.docType : null
}

/** 是否需要以文本方式取回（markdown/drawing/whiteboard/纯文本） */
export function netdiskPreviewNeedsText(name: string): boolean {
  const kind = netdiskPreviewKind(name)
  return kind === 'reader' || kind === 'text'
}

/** 不可预览时的原因文案（按钮置灰的 Tooltip） */
export function previewUnsupportedReason(name: string): string {
  const ext = extOf(name)
  if (!ext) return '无扩展名的文件暂不支持预览'
  return `暂不支持预览（.${ext}）`
}
