/**
 * 「我的网盘」接口层。
 *
 * 路径与 `server/internal/router/router.go` 的 `/api/netdisks`、`/api/netdisk-tasks`
 * 分组一一对应；请求统一走 `api/request.ts`（拦截器已剥掉 `{code,message,data}` 外壳）。
 *
 * ⚠️ 这里**不出现**任何凭据字段：密码只在「保存/编辑」的入参里出现一次，
 * 出参一律由后端 `has_password` / `has_token` 布尔位表达。
 */

import request from './request'
import type {
  NetdiskConnection,
  NetdiskConnectionInput,
  NetdiskDirList,
  NetdiskProvider,
  NetdiskTask,
  NetdiskTaskList,
  NetdiskTestResult,
  SMBShareInfo,
} from '../types'

// ---------- 能力清单与连接 CRUD ----------

/** 各网盘类型的可用状态（夸克的置灰说明也由它下发） */
export function listProviders() {
  return request.get<unknown, NetdiskProvider[]>('/netdisks/providers')
}

/** 当前用户的全部连接 */
export function listConnections() {
  return request.get<unknown, NetdiskConnection[]>('/netdisks')
}

/** 新建连接 */
export function createConnection(input: NetdiskConnectionInput) {
  return request.post<unknown, NetdiskConnection>('/netdisks', input)
}

/**
 * 保存前测试（UI 强制先测后存）。
 * 入参与新建相同 —— 测试的就是「即将保存的这套配置」。
 */
export function testUnsaved(input: NetdiskConnectionInput) {
  return request.post<unknown, NetdiskTestResult>('/netdisks/test', input)
}

/** 单个连接详情 */
export function getConnection(id: number) {
  return request.get<unknown, NetdiskConnection>(`/netdisks/${id}`)
}

/** 编辑连接 */
export function updateConnection(id: number, input: NetdiskConnectionInput) {
  return request.put<unknown, NetdiskConnection>(`/netdisks/${id}`, input)
}

/** 删除连接（软删除） */
export function deleteConnection(id: number) {
  return request.delete<unknown, { deleted: boolean }>(`/netdisks/${id}`)
}

/** 测试已保存的连接并回写状态 */
export function testSaved(id: number) {
  return request.post<unknown, NetdiskTestResult>(`/netdisks/${id}/test`)
}

/** SMB 列举共享的入参（第 1 步填的 IP / 账号，不含共享名） */
export interface SMBSharesInput {
  host: string
  port?: number
  username?: string
  password?: string
  domain?: string
}

/** 列举出的 SMB 共享及其权限探测结果 */
export type { SMBShareInfo }

/**
 * 列举 SMB 服务器上的全部共享并探测可读 / 可写（两步添加流程第 1→2 步）。
 * 需要登录态（后端会拒绝匿名请求，避免被当内网探测跳板）。
 */
export function listSMBShares(input: SMBSharesInput) {
  return request.post<unknown, { shares: SMBShareInfo[] }>('/netdisks/smb/shares', input)
}

/** 重新探测状态（OAuth 重新授权后也走它） */
export function refreshConnection(id: number) {
  return request.post<unknown, NetdiskConnection>(`/netdisks/${id}/refresh`)
}

// ---------- 目录与文件操作 ----------

/** 列目录（懒加载）；force=1 跳过服务端短缓存 */
export function listDir(id: number, path: string, force = false) {
  return request.get<unknown, NetdiskDirList>(`/netdisks/${id}/dirs`, {
    params: { path, force: force ? 1 : undefined },
  })
}

/** 在 path 下新建 name 目录 */
export function createDir(id: number, path: string, name: string) {
  return request.post<unknown, { created: boolean }>(`/netdisks/${id}/dirs`, { path, name })
}

/** 改名（newName 不含路径） */
export function renameItem(id: number, path: string, name: string) {
  return request.post<unknown, { renamed: boolean }>(`/netdisks/${id}/rename`, { path, name })
}

/** 移动到 targetDir 下 */
export function moveItem(id: number, path: string, targetDir: string) {
  return request.post<unknown, { moved: boolean }>(`/netdisks/${id}/move`, { path, target_dir: targetDir })
}

/** 删除（recursive=true 删非空目录） */
export function deleteItem(id: number, path: string, recursive = false) {
  return request.delete<unknown, { deleted: boolean }>(`/netdisks/${id}/items`, {
    params: { path, recursive: recursive ? 1 : undefined },
  })
}

/** 上传到网盘（任务化，返回任务对象） */
export function uploadFile(id: number, path: string, file: File, onProgress?: (p: number) => void) {
  const form = new FormData()
  form.append('file', file)
  return request.post<unknown, NetdiskTask>(`/netdisks/${id}/upload`, form, {
    params: { path },
    timeout: 0,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
}

/** 导入到文库（任务化：后端只把字节取回临时文件） */
export function importFile(id: number, path: string, bookId: number, parentId: number) {
  return request.post<unknown, NetdiskTask>(`/netdisks/${id}/import`, {
    path,
    book_id: bookId,
    parent_id: parentId,
  })
}

/** 签发预览 / 下载短期 token（2 小时）—— `<video>`/`<img>` 的 src 带不了 Authorization */
export function makePreviewToken(id: number, path: string) {
  return request.get<unknown, { token: string; exp: number }>(`/netdisks/${id}/preview-token`, {
    params: { path },
  })
}

// ---------- 下载 / 预览 URL ----------

/**
 * 下载地址（浏览器直接打开，走 Bearer 或 query token）。
 * inline=false 时后端下 Content-Disposition: attachment。
 */
export function downloadUrl(id: number, path: string, token?: string): string {
  const q = new URLSearchParams({ path })
  if (token) q.set('token', token)
  return `/api/netdisks/${id}/download?${q.toString()}`
}

/** 预览地址（后端下 Content-Disposition: inline，支持 Range） */
export function previewUrl(id: number, path: string, token?: string): string {
  const q = new URLSearchParams({ path })
  if (token) q.set('token', token)
  return `/api/netdisks/${id}/preview?${q.toString()}`
}

/**
 * 文库渲染型文件（pdf/docx/xlsx/pptx/vsd/vsdx）的预览地址。
 * FileView 会自己 fetch 这个 URL，所以必须把 token 拼进去。
 *
 * entry 由调用方从列目录结果里带过来（后端没有单独的 stat 接口，懒加载列表里已有）。
 */
export async function readerPreviewUrl(
  id: number,
  entry: { name: string; path: string; size: number },
): Promise<{ url: string; filename: string; size: number; ext: string }> {
  const { token } = await makePreviewToken(id, entry.path)
  const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
  return {
    url: previewUrl(id, entry.path, token),
    filename: entry.name,
    size: entry.size,
    ext,
  }
}

// ---------- 任务中心 ----------

/** 任务列表；running 是仍在跑的数量（前端据此决定是否继续轮询） */
export function listTasks(params: { connId?: number; status?: string; limit?: number } = {}) {
  return request.get<unknown, NetdiskTaskList>('/netdisk-tasks', {
    params: {
      conn_id: params.connId || undefined,
      status: params.status || undefined,
      limit: params.limit || undefined,
    },
  })
}

/** 单个任务 */
export function getTask(id: number) {
  return request.get<unknown, NetdiskTask>(`/netdisk-tasks/${id}`)
}

/** 重试（仅 failed 且 retries < 3 时可点） */
export function retryTask(id: number) {
  return request.post<unknown, NetdiskTask>(`/netdisk-tasks/${id}/retry`)
}

/** 取消（仅 pending / running 可点） */
export function cancelTask(id: number) {
  return request.delete<unknown, NetdiskTask>(`/netdisk-tasks/${id}`)
}

/**
 * 取导入任务的临时文件字节（任务 success 后才可用）。
 * 走 Bearer 头，所以这里用 fetch 而不是 <a> 直链。
 */
export async function fetchTaskBlob(id: number): Promise<Blob> {
  const token = localStorage.getItem('hk_token')
  const resp = await fetch(`/api/netdisk-tasks/${id}/blob`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!resp.ok) throw new Error('取回网盘文件失败')
  return resp.blob()
}

/**
 * 网盘取回类请求的超时（ms）。后端预览 / 下载走流式代理，若连接挂起，
 * 不中断就会让界面无限「菊花」。这里统一加超时，把挂起变成可重试的明确错误。
 */
const NETDISK_FETCH_TIMEOUT_MS = 30_000

/** 生成一个带超时的 AbortSignal（兼容不支持 AbortSignal.timeout 的环境） */
function timeoutSignal(): AbortSignal {
  const Ctor = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (typeof Ctor === 'function') {
    try {
      return Ctor(NETDISK_FETCH_TIMEOUT_MS)
    } catch {
      // 落到下面的手动实现
    }
  }
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), NETDISK_FETCH_TIMEOUT_MS)
  return ctrl.signal
}

/**
 * 以文本方式取回网盘文件（markdown / html / drawio / 纯文本预览用）。
 * 走 Bearer 头，所以同样是 fetch 而不是 <a> 直链。带 30s 超时。
 */
export async function fetchNetdiskText(connId: number, path: string): Promise<string> {
  const token = localStorage.getItem('hk_token')
  const resp = await fetch(`/api/netdisks/${connId}/download?path=${encodeURIComponent(path)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: timeoutSignal(),
  })
  if (!resp.ok) throw new Error('读取文件失败')
  return resp.text()
}

/**
 * 以字节方式取回网盘文件（思维导图 .km / .mm / .xmind 预览时，需要先拿到字节再交给
 * 后端 /api/mindmap/parse 解析成内置 smm）。走 Bearer 头。带 30s 超时。
 */
export async function fetchNetdiskBlob(connId: number, path: string): Promise<Blob> {
  const token = localStorage.getItem('hk_token')
  const resp = await fetch(`/api/netdisks/${connId}/download?path=${encodeURIComponent(path)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: timeoutSignal(),
  })
  if (!resp.ok) throw new Error('读取文件失败')
  return resp.blob()
}
