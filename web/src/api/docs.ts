import request from './request'
import { getToken } from './request'
import type {
  DocCollaborator,
  DocDetail,
  DocExportFormats,
  DocNode,
  DocShareView,
  DocType,
  DocWithBook,
  ImportUrlResult,
  VersionMeta,
  DocVersion,
} from '../types'

/** 目录树平铺列表（按 pos 升序） */
export async function getTree(bookId: number): Promise<DocNode[]> {
  return request.get(`/books/${bookId}/docs`) as Promise<DocNode[]>
}

/** 新建文档（content 可选：导入附件型文档时一次性写入附件引用） */
export async function createDoc(
  bookId: number,
  parentId: number,
  title?: string,
  docType?: DocType,
  content?: string,
): Promise<DocDetail> {
  return request.post(`/books/${bookId}/docs`, {
    parent_id: parentId,
    title,
    doc_type: docType,
    content,
  }) as Promise<DocDetail>
}

export async function getDoc(docId: number): Promise<DocWithBook> {
  return request.get(`/docs/${docId}`) as Promise<DocWithBook>
}

export async function patchDoc(
  docId: number,
  payload: { title?: string; content?: string; source?: 'auto' | 'manual' },
): Promise<{ doc: DocDetail; changed: boolean }> {
  return request.patch(`/docs/${docId}`, payload) as Promise<{ doc: DocDetail; changed: boolean }>
}

// ---------- 增量：文档级分享管理 ----------

/** 分享回显（未创建过分享返回 null） */
export async function getDocShare(docId: number): Promise<DocShareView | null> {
  return request.get(`/docs/${docId}/share`) as Promise<DocShareView | null>
}

/** 创建/更新二合一（upsert）：重复调用刷新 slug、覆盖密码/有效期/启停 */
export async function updateDocShare(
  docId: number,
  payload: { password?: string; expires_at?: string | null; enabled?: boolean },
): Promise<DocShareView> {
  return request.put(`/docs/${docId}/share`, payload) as Promise<DocShareView>
}

/** 撤销分享（物理删除，链接立即失效） */
export async function revokeDocShare(docId: number): Promise<{ revoked: boolean }> {
  return request.delete(`/docs/${docId}/share`) as Promise<{ revoked: boolean }>
}

// ---------- 增量：网页标题代理（粘贴 URL 转链接用） ----------

/** 后端代理拉取网页标题（JWT；SSRF 防护在服务端） */
export async function fetchTitle(url: string): Promise<string> {
  const res = await request.get('/fetch-title', { params: { url } }) as { title: string }
  return res.title
}

// ---------- 增量 R5：文档协作邀请 ----------

/** 邀请协作者：identifier 可为用户名 / 手机号 / 姓名 / 邮箱（需文档编辑权限） */
export async function addCollaborator(docId: number, identifier: string): Promise<DocCollaborator> {
  return request.post(`/docs/${docId}/collaborators`, { identifier }) as Promise<DocCollaborator>
}

/** 协作者列表（含用户名/姓名/邮箱，供界面直接渲染） */
export async function listCollaborators(docId: number): Promise<DocCollaborator[]> {
  return request.get(`/docs/${docId}/collaborators`) as Promise<DocCollaborator[]>
}

/** 移除协作者 */
export async function removeCollaborator(docId: number, uid: number): Promise<{ removed: boolean }> {
  return request.delete(`/docs/${docId}/collaborators/${uid}`) as Promise<{ removed: boolean }>
}

/** 网页抓取导入：把 URL 页面转 Markdown 落入目标知识库的指定目录（服务端做 SSRF 防护与图片本地化） */
export async function importUrl(url: string, bookId: number, parentId = 0): Promise<ImportUrlResult> {
  return request.post('/import/url', { url, book_id: bookId, parent_id: parentId }) as Promise<ImportUrlResult>
}

export async function moveDoc(
  docId: number,
  payload: { parent_id: number; prev_pos?: string; next_pos?: string },
): Promise<DocDetail> {
  return request.put(`/docs/${docId}/move`, payload) as Promise<DocDetail>
}

// ---------- 增量（第四轮）：复制 / 跨库移动 / 置顶 ----------

/** 复制文档（新标题=原标题+" 副本"，同父级末尾，content/doc_type 原样） */
export async function duplicateDoc(docId: number): Promise<DocDetail> {
  return request.post(`/docs/${docId}/duplicate`) as Promise<DocDetail>
}

/** 跨知识库移动（目标书根目录末尾，子树整体迁移） */
export async function moveDocToBook(docId: number, bookId: number): Promise<DocDetail> {
  return request.post(`/docs/${docId}/move-to-book`, { book_id: bookId }) as Promise<DocDetail>
}

/** 置顶/取消置顶 */
export async function pinDoc(docId: number, pinned: boolean): Promise<DocDetail> {
  return request.patch(`/docs/${docId}/pin`, { pinned }) as Promise<DocDetail>
}

export async function deleteDoc(docId: number): Promise<void> {
  return request.delete(`/docs/${docId}`) as Promise<void>
}

export async function listVersions(docId: number): Promise<VersionMeta[]> {
  return request.get(`/docs/${docId}/versions`) as Promise<VersionMeta[]>
}

export async function getVersion(docId: number, versionId: number): Promise<DocVersion> {
  return request.get(`/docs/${docId}/versions/${versionId}`) as Promise<DocVersion>
}

export async function rollbackVersion(docId: number, versionId: number): Promise<DocDetail> {
  return request.post(`/docs/${docId}/versions/${versionId}/rollback`) as Promise<DocDetail>
}

export async function restoreDoc(docId: number): Promise<void> {
  return request.post(`/docs/${docId}/restore`) as Promise<void>
}

export async function purgeDoc(docId: number): Promise<void> {
  return request.delete(`/docs/${docId}/purge`) as Promise<void>
}

// ---------- 导出（P1 / 第四轮 R6）：blob 获取走 fetch，避免 axios JSON 拦截器 ----------

/** 从导出接口拉取二进制内容（带鉴权），返回 blob 与服务端建议文件名 */
export async function fetchExportBlob(url: string, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const token = getToken()
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!resp.ok) throw new Error('下载失败')
  const blob = await resp.blob()
  const dispo = resp.headers.get('Content-Disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/.exec(dispo) || /filename="?([^";]+)"?/.exec(dispo)
  const filename = m ? decodeURIComponent(m[1]) : fallbackName
  return { blob, filename }
}

/** 将 blob 保存到本地：优先 File System Access API（系统保存对话框），降级浏览器下载 */
export async function saveBlob(blob: Blob, filename: string): Promise<'picker' | 'download'> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<{
      createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>
    }>
  }
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: filename })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'picker'
    } catch (e) {
      // 用户取消保存对话框：静默返回，不降级重复下载
      if ((e as DOMException)?.name === 'AbortError') return 'picker'
      // 其他错误降级为浏览器下载
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
  return 'download'
}

/** 该文档可选的导出格式（服务端为单一事实来源：按 doc_type 返回，附件型 is_file=true） */
export async function getExportFormats(docId: number): Promise<DocExportFormats> {
  return request.get(`/export/docs/${docId}/formats`) as Promise<DocExportFormats>
}

/** 导出单篇文档（服务端完成全部格式转换；format 缺省用该类型默认格式） */
export async function exportDocBlob(
  docId: number,
  title: string,
  format?: string,
): Promise<{ blob: Blob; filename: string }> {
  const qs = format ? `?format=${encodeURIComponent(format)}` : ''
  return fetchExportBlob(`/api/export/docs/${docId}${qs}`, `${title}.md`)
}

/** 导出知识库（.md.zip，按目录结构） */
export async function exportBookBlob(bookId: number, name: string): Promise<{ blob: Blob; filename: string }> {
  return fetchExportBlob(`/api/export/books/${bookId}`, `${name}.md.zip`)
}

/** 兼容旧入口：直接浏览器下载单篇文档 */
export async function exportDoc(docId: number, title: string): Promise<void> {
  const { blob, filename } = await exportDocBlob(docId, title)
  await saveBlob(blob, filename)
}

/** 兼容旧入口：直接浏览器下载整库 zip */
export async function exportBook(bookId: number, name: string): Promise<void> {
  const { blob, filename } = await exportBookBlob(bookId, name)
  await saveBlob(blob, filename)
}
