// 共享导入核心：把「解析 → 上传/建文档」链路抽出来，桌面 ImportDialog 与 H5 导入页共用，
// 避免两处各写一份导致行为漂移。进度通过 onItem 回调上报，便于不同 UI 渲染。
import { createDoc } from '../../api/docs'
import { uploadWithDedup } from '../uploadFlow'
import { prepareAttachment } from '../../api/attachments'
import { parseFile } from './parse'
import { extOfName, isSupportedImportExt, unsupportedImportReason } from './formats'
import type { FileAttachment } from '../../types'

export type ImportItemStatus = 'waiting' | 'parsing' | 'success' | 'error'

export interface ImportProgressItem {
  uid: string
  name: string
  status: ImportItemStatus
  message: string
  docId?: number
  dedup?: boolean
}

export interface RunImportOpts {
  bookId: number
  parentId?: number
  /** 每处理一个文件（开始/成功/失败）回调一次，UI 据此刷新列表 */
  onItem: (item: ImportProgressItem) => void
  /** 全部文件处理完后回调（成功/失败都算结束） */
  onDone?: (summary: { ok: number; err: number; dedup: number }) => void
}

function fileKey(f: File): string {
  return `${f.name}::${f.size}`
}

/**
 * 顺序导入一批文件（串行，避免并发导致状态互相覆盖）。
 * 失败的文件不会产生损坏文档；函数本身不抛异常（错误已落到 item.message）。
 */
export async function runImport(files: File[], opts: RunImportOpts): Promise<void> {
  const { bookId, parentId = 0, onItem, onDone } = opts
  const handled = new Set<string>()
  const queue = files.filter((f) => {
    const k = fileKey(f)
    if (handled.has(k)) return false
    handled.add(k)
    return true
  })

  let ok = 0
  let err = 0
  let dedup = 0
  let seq = 0

  for (const file of queue) {
    const uid = `imp-${Date.now()}-${seq++}`
    const item: ImportProgressItem = { uid, name: file.name, status: 'waiting', message: '等待导入' }
    onItem(item)

    const ext = extOfName(file.name)
    if (!isSupportedImportExt(ext)) {
      onItem({ ...item, status: 'error', message: unsupportedImportReason(file.name) })
      err++
      continue
    }

    onItem({ ...item, status: 'parsing', message: '解析中…' })
    const res = await parseFile(file)
    if (!res.ok) {
      onItem({ ...item, status: 'error', message: res.reason || unsupportedImportReason(file.name) })
      err++
      continue
    }

    try {
      if (res.attachment) {
        const up = await uploadWithDedup(file)
        const ref: FileAttachment = {
          url: up.url,
          filename: up.filename || res.attachment.filename,
          size: up.size || res.attachment.size,
          ext: res.attachment.ext,
        }
        let note = ''
        if (res.needsPrepare) {
          onItem({ ...item, status: 'parsing', message: '正在生成预览…' })
          try {
            const prep = await prepareAttachment({ url: ref.url, filename: ref.filename, size: ref.size })
            Object.assign(ref, prep.ref)
            note = prep.warning || (ref.degraded ? (ref as unknown as { note?: string }).note || '图纸预览为降级结果' : '')
            if (!(ref as unknown as { derived?: { svg?: string; png?: string } }).derived?.svg &&
              !(ref as unknown as { derived?: { svg?: string; png?: string } }).derived?.png) {
              note = '暂不支持该格式在线预览，已按原文件保存（可下载后用专业软件打开）'
            }
          } catch {
            note = '预览转换失败，已按原文件保存（可下载后用专业软件打开）'
          }
        }
        const doc = await createDoc(bookId, parentId, res.title, 'file', JSON.stringify(ref))
        if (note) item.message = note
        onItem({ ...item, status: 'success', message: note ? '导入成功（无在线预览）' : '导入成功（按原文件保存）', docId: doc.id, dedup: up.dedup })
        if (up.dedup) dedup++
        ok++
        continue
      }

      const doc = await createDoc(bookId, parentId, res.title, res.docType, res.content)
      const children = res.children ?? []
      let childFailed = 0
      for (const c of children) {
        try {
          await createDoc(bookId, doc.id, c.title, c.docType, c.content)
        } catch {
          childFailed++
        }
      }
      onItem({
        ...item,
        status: childFailed > 0 && childFailed === children.length ? 'error' : 'success',
        message:
          children.length > 0
            ? `导入成功：${children.length - childFailed} 个子文档${childFailed > 0 ? `，${childFailed} 个失败` : ''}`
            : res.large
              ? '导入成功（内容较大，打开可能较慢）'
              : '导入成功',
        docId: doc.id,
      })
      ok++
    } catch (e) {
      onItem({ ...item, status: 'error', message: (e as Error)?.message || '创建文档失败' })
      err++
    }
  }

  onDone?.({ ok, err, dedup })
}
