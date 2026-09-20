import request from './request'
import type { PrecheckBatchResult, PrecheckResult, UploadResult } from '../types'

/**
 * multipart 上传（白名单 + 大小上限由后端校验）。
 *
 * `md5` 是前端算出的摘要，**仅用于后端日志比对与 UI 回显**：服务端一律自己重算，
 * 不一致以服务端为准。客户端可伪造它，信它会让「同内容共享同一物理对象」不变量失效。
 */
export async function uploadFile(file: File, opts?: { md5?: string }): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  if (opts?.md5) form.append('md5', opts.md5)
  return request.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<UploadResult>
}

/**
 * 秒传预检（单条形态）。只回答"是否命中"，**不回 url**。
 *
 * silent：预检是**可降级**的探测请求 —— 老后端没有这个接口、或网络抖动时，
 * 全局错误 toast 会先弹一条红字再继续走普通上传，纯属噪音。失败即降级，不打扰用户。
 */
export async function precheckUpload(md5: string, size: number, filename: string): Promise<PrecheckResult> {
  return request.post('/uploads/precheck', { md5, size, filename }, { silent: true }) as Promise<PrecheckResult>
}

/** 秒传预检（批量形态，单次 ≤100 条；超出需自行分批）。`results[].index` 为**请求下标** */
export async function precheckUploadBatch(
  items: Array<{ md5: string; size: number; filename: string }>,
): Promise<PrecheckBatchResult> {
  return request.post('/uploads/precheck', { items }, { silent: true }) as Promise<PrecheckBatchResult>
}

/**
 * 秒传落 meta（**请求体无文件字节**）。
 *
 * 失败码语义：`40401` 未知 md5（内容已变/被清理）、`40901` size 不符（异常客户端）
 * —— 两者都应让调用方**退化为普通 multipart 上传**，故同样 silent。
 */
export async function instantUpload(input: {
  md5: string
  size: number
  filename: string
  mime?: string
}): Promise<UploadResult> {
  return request.post('/uploads/instant', input, { silent: true }) as Promise<UploadResult>
}
