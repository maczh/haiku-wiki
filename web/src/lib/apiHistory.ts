// 接口文档「调试历史」持久化。
//
// 写入策略：优先调用后端接口保存（按用户隔离，支持多端同步）；后端失败时回退到 localStorage。
// 读取策略：优先从后端读取；后端不可用/无网络时回退 localStorage。
// 每个接口（docId + endpointId）独立保存，仅保留最近的 10 条调试记录。
// 记录内容：调用时间、接口（method + uri）、请求头、请求参数、请求体、可选响应摘要。

import request from '../api/request'
import type { ApiEndpoint, ApiKeyValue } from './apiDoc'

export interface DebugHistoryRecord {
  /** 调用时间（epoch 毫秒） */
  time: number
  method: string
  uri: string
  base_host?: string
  headers: ApiKeyValue[]
  params: ApiKeyValue[]
  body_type: ApiEndpoint['body_type']
  body: string
  response?: DebugHistoryResponse
}

export interface DebugHistoryResponse {
  status: number
  status_text: string
  duration_ms: number
  headers: Record<string, string>
  body: string
}

const localKeyOf = (docId: number | undefined, epId: string): string =>
  `apidoc_history_${docId ?? 'local'}_${epId}`

/** 读取某接口的全部历史记录（新的在前）。 */
export async function loadHistory(
  docId: number | undefined,
  epId: string,
): Promise<DebugHistoryRecord[]> {
  if (docId) {
    try {
      const data = (await request.get('/docs/' + docId + '/api-debug-history', {
        params: { endpoint_id: epId },
      })) as { records: DebugHistoryRecord[] }
      if (Array.isArray(data?.records)) return data.records
    } catch {
      /* 后端失败则降级本地 */
    }
  }
  try {
    const raw = localStorage.getItem(localKeyOf(docId, epId))
    if (!raw) return []
    const arr = JSON.parse(raw) as DebugHistoryRecord[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** 追加一条记录并持久化，返回最新列表（最多 10 条，最近在前）。 */
export async function saveHistory(
  docId: number | undefined,
  epId: string,
  rec: DebugHistoryRecord,
): Promise<DebugHistoryRecord[]> {
  const arr = await loadHistory(docId, epId)
  arr.unshift(rec)
  const trimmed = arr.slice(0, 10)
  if (docId) {
    try {
      await request.post('/docs/' + docId + '/api-debug-history', {
        endpoint_id: epId,
        record: rec,
      })
    } catch {
      /* 后端失败继续写本地 */
    }
  }
  try {
    localStorage.setItem(localKeyOf(docId, epId), JSON.stringify(trimmed))
  } catch {
    /* 忽略存储异常（如隐私模式） */
  }
  return trimmed
}

/** 按索引删除一条历史记录，返回最新列表。 */
export async function deleteHistoryByIndex(
  docId: number | undefined,
  epId: string,
  index: number,
): Promise<DebugHistoryRecord[]> {
  const arr = await loadHistory(docId, epId)
  if (index < 0 || index >= arr.length) return arr
  arr.splice(index, 1)
  if (docId) {
    try {
      await request.delete('/docs/' + docId + '/api-debug-history', {
        params: { endpoint_id: epId, index },
      })
    } catch {
      /* 后端失败继续写本地 */
    }
  }
  try {
    localStorage.setItem(localKeyOf(docId, epId), JSON.stringify(arr))
  } catch {
    /* 忽略 */
  }
  return arr
}
