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
  payload: { title?: string; content?: string; source?: 'auto' | 'manual'; api_source_url?: string },
): Promise<{ doc: DocDetail; changed: boolean }> {
  return request.patch(`/docs/${docId}`, payload) as Promise<{ doc: DocDetail; changed: boolean }>
}

// ---------- 接口文档 URL 导入来源的刷新（P0-7 / P0-8 / P1-2 / P1-3） ----------

/** 单篇接口文档的导入来源与上次刷新结果（未登记来源时 source 为 null）。 */
export interface ApiRefreshSource {
  doc_id: number
  source_url: string
  imported_at: string
  last_refreshed_at?: string
  refresh_status: string // "" | success | failed
  refresh_error?: string
  last_added: number
  last_updated: number
  last_removed: number
}

/** 最近一次刷新任务的汇总（管理员视角）。 */
export interface ApiRefreshRun {
  id: number
  trigger: string // auto | manual | admin
  started_at: string
  finished_at?: string
  scanned: number
  succeeded: number
  failed: number
  added: number
  updated: number
  removed: number
  failures: string // JSON: [{doc_id,title,error}]
}

/** 当前文档的刷新来源与上次结果（需读权限）。 */
export async function getApiRefreshStatus(docId: number): Promise<{ source: ApiRefreshSource | null }> {
  return request.get(`/docs/${docId}/api-refresh-status`) as Promise<{ source: ApiRefreshSource | null }>
}

/** 手动刷新单篇接口文档（需写权限）：抓取来源 → 原地合并 → 回写。 */
export async function refreshApiDoc(docId: number): Promise<{ added: number; updated: number; removed: number }> {
  return request.post(`/docs/${docId}/refresh`) as Promise<{ added: number; updated: number; removed: number }>
}

/** 管理员：最近一次刷新任务汇总。 */
export async function getApiRefreshLastRun(): Promise<ApiRefreshRun> {
  return request.get('/admin/api-refresh/last') as Promise<ApiRefreshRun>
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

/**
 * 网址导入：只保存原网址作为一篇「网页文档」，服务端**不抓取**页面内容
 * （旧实现会抓取并转成 Markdown 抄一份进本站），阅读页用 iframe 直接加载原站。
 */
export async function importUrl(
  url: string,
  bookId: number,
  parentId = 0,
  title?: string,
): Promise<ImportUrlResult> {
  return request.post('/import/url', {
    url,
    book_id: bookId,
    parent_id: parentId,
    ...(title ? { title } : {}),
  }) as Promise<ImportUrlResult>
}

/**
 * 网页包导入：单个 HTML 页面 / zip 包 / 一个网页目录，原样保存不做转换。
 *
 * files 里的每个文件可带相对路径（目录导入时前端给出 webkitRelativePath），
 * 通过 paths 字段一并提交，服务端按该结构落盘并挑出入口页。
 */
export async function importHtml(params: {
  files: File[]
  paths?: string[]
  bookId: number
  parentId?: number
  title?: string
}): Promise<ImportUrlResult> {
  const form = new FormData()
  form.append('book_id', String(params.bookId))
  form.append('parent_id', String(params.parentId ?? 0))
  if (params.title) form.append('title', params.title)
  if (params.paths?.length) form.append('paths', JSON.stringify(params.paths))
  params.files.forEach((f) => form.append('files', f))
  return request.post('/import/html', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<ImportUrlResult>
}

/** 公司文库「所有人可编辑」开关（管理员 / 库 owner） */
export async function setDocPublicEdit(docId: number, enabled: boolean): Promise<{ public_edit: boolean }> {
  return request.patch(`/docs/${docId}/public-edit`, { enabled }) as Promise<{ public_edit: boolean }>
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

/** 跨知识库移动（子树整体迁移）。parentId 省略/为 0 时落到目标库根目录。 */
export async function moveDocToBook(docId: number, bookId: number, parentId = 0): Promise<DocDetail> {
  return request.post(`/docs/${docId}/move-to-book`, {
    book_id: bookId,
    parent_id: parentId,
  }) as Promise<DocDetail>
}

/**
 * 复制文档到指定知识库 + 目标位置（**递归复制整棵子树**）。
 *
 * 与 `duplicateDoc` 的区别：本接口可跨库、可指定目标父节点，且复制「目录」时
 * 会连同子文档一起复制。标题规则一致（根节点加「 副本」，子节点原样）。
 */
export async function copyDoc(
  docId: number,
  payload: { book_id?: number; parent_id?: number } = {},
): Promise<DocDetail> {
  return request.post(`/docs/${docId}/copy`, payload) as Promise<DocDetail>
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
