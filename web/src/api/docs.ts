import request from './request'
import { getToken } from './request'
import type { DocDetail, DocNode, DocShareView, DocType, DocWithBook, VersionMeta, DocVersion } from '../types'

/** 目录树平铺列表（按 pos 升序） */
export async function getTree(bookId: number): Promise<DocNode[]> {
  return request.get(`/books/${bookId}/docs`) as Promise<DocNode[]>
}

export async function createDoc(bookId: number, parentId: number, title?: string, docType?: DocType): Promise<DocDetail> {
  return request.post(`/books/${bookId}/docs`, { parent_id: parentId, title, doc_type: docType }) as Promise<DocDetail>
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

export async function moveDoc(
  docId: number,
  payload: { parent_id: number; prev_pos?: string; next_pos?: string },
): Promise<DocDetail> {
  return request.put(`/docs/${docId}/move`, payload) as Promise<DocDetail>
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

// ---------- 导出（P1）：blob 下载走 fetch，避免 axios JSON 拦截器 ----------

async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const token = getToken()
  const resp = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!resp.ok) throw new Error('下载失败')
  const blob = await resp.blob()
  const dispo = resp.headers.get('Content-Disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/.exec(dispo) || /filename="?([^";]+)"?/.exec(dispo)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

export async function exportDoc(docId: number, title: string): Promise<void> {
  await downloadFile(`/api/export/docs/${docId}`, `${title}.md`)
}

export async function exportBook(bookId: number, name: string): Promise<void> {
  await downloadFile(`/api/export/books/${bookId}`, `${name}.md.zip`)
}
