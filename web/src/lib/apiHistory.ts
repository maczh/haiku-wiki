// 接口文档「调试历史」持久化（localStorage）。
//
// 每个接口（docId + endpointId）独立保存，仅保留最近的 10 条调试记录。
// 记录内容：调用时间、接口（method + uri）、请求头、请求参数、请求体。
// 用户可在「历史」抽屉中选择任意一条，自动回填到当前接口的请求头 / 参数 / 请求体。

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
}

const keyOf = (docId: number | undefined, epId: string): string =>
  `apidoc_history_${docId ?? 'local'}_${epId}`

/** 读取某接口的全部历史记录（新的在前）。 */
export function loadHistory(docId: number | undefined, epId: string): DebugHistoryRecord[] {
  try {
    const raw = localStorage.getItem(keyOf(docId, epId))
    if (!raw) return []
    const arr = JSON.parse(raw) as DebugHistoryRecord[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** 追加一条记录并持久化，返回最新列表（最多 10 条，最近在前）。 */
export function saveHistory(
  docId: number | undefined,
  epId: string,
  rec: DebugHistoryRecord,
): DebugHistoryRecord[] {
  const arr = loadHistory(docId, epId)
  arr.unshift(rec)
  const trimmed = arr.slice(0, 10)
  try {
    localStorage.setItem(keyOf(docId, epId), JSON.stringify(trimmed))
  } catch {
    /* 忽略存储异常（如隐私模式） */
  }
  return trimmed
}

/** 按索引删除一条历史记录，返回最新列表。 */
export function deleteHistoryByIndex(
  docId: number | undefined,
  epId: string,
  index: number,
): DebugHistoryRecord[] {
  const arr = loadHistory(docId, epId)
  if (index < 0 || index >= arr.length) return arr
  arr.splice(index, 1)
  try {
    localStorage.setItem(keyOf(docId, epId), JSON.stringify(arr))
  } catch {
    /* 忽略 */
  }
  return arr
}
