import type { FlagStorage } from './dashboard'

/**
 * 文库内搜索的历史词（纯函数 + 可注入存储，便于 node 侧断言）。
 *
 * 只存关键词、只存本地，不上报服务端；容量固定，超出丢弃最旧的。
 */

/** localStorage 键名 */
export const SEARCH_HISTORY_KEY = 'hk_search_history'

/** 最多保留的历史词条数 */
export const SEARCH_HISTORY_MAX = 8

/** 单个关键词长度上限（防止把整段正文粘进搜索框后撑爆存储） */
export const SEARCH_TERM_MAX_LEN = 40

/**
 * 把关键词并入历史：去空白、截断、**去重后置顶**，超出容量丢最旧的。
 * 空白词直接返回原列表（不产生无意义的『空搜索』记录）。
 */
export function pushSearchTerm(list: string[], raw: string, max = SEARCH_HISTORY_MAX): string[] {
  const term = (raw ?? '').trim().slice(0, SEARCH_TERM_MAX_LEN)
  if (!term) return list
  const rest = list.filter((x) => x !== term)
  return [term, ...rest].slice(0, Math.max(1, max))
}

/** 读取历史（存储不可用 / 内容损坏时一律返回空数组，不影响首页渲染） */
export function readSearchHistory(storage?: FlagStorage | null): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(SEARCH_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, SEARCH_HISTORY_MAX)
  } catch {
    return []
  }
}

/** 写入历史（静默失败：隐私模式 / 配额满都不该打断搜索） */
export function writeSearchHistory(list: string[], storage?: FlagStorage | null): void {
  if (!storage) return
  try {
    storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, SEARCH_HISTORY_MAX)))
  } catch {
    /* 忽略 */
  }
}

/** 清空历史 */
export function clearSearchHistory(storage?: FlagStorage | null): void {
  if (!storage) return
  try {
    storage.removeItem?.(SEARCH_HISTORY_KEY)
  } catch {
    /* 忽略 */
  }
}
