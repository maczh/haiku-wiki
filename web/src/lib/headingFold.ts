/**
 * 阅读视图标题折叠的持久化层。
 *
 * 折叠状态按 docId 隔离，存于 localStorage：
 *   key 形如 `hk.fold.heading:<docId>`，value 为折叠 heading id 集合的 JSON。
 * 这样同一用户看多篇文档时，折叠状态不会串；切换文档后能恢复上次折叠结果。
 *
 * 注意：这里只持久化「折叠了哪些标题」，DOM 的隐藏/显示由 MarkdownView 的
 * HeadingFolder 在渲染后处理时按此集合还原，二者职责分离。
 */

const KEY_PREFIX = 'hk.fold.heading:'

/** 存储 schema（version 便于后续迁移） */
export interface HeadingFoldSchema {
  version: 1
  ids: string[]
}

/** 计算某文档的 localStorage key */
function storageKey(docId: number): string {
  return `${KEY_PREFIX}${docId}`
}

/**
 * 读取某文档的折叠 heading id 集合（无记录 / 解析失败返回空集）。
 */
export function loadFoldState(docId: number): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(docId))
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw) as HeadingFoldSchema
    if (!parsed || !Array.isArray(parsed.ids)) return new Set<string>()
    return new Set<string>(parsed.ids)
  } catch {
    return new Set<string>()
  }
}

/**
 * 保存折叠集合到 localStorage（失败静默降级，折叠仅当前会话有效）。
 */
export function saveFoldState(docId: number, ids: Set<string>): void {
  try {
    const schema: HeadingFoldSchema = { version: 1, ids: Array.from(ids) }
    localStorage.setItem(storageKey(docId), JSON.stringify(schema))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/**
 * 切换某个 heading 的折叠状态，返回切换后的完整集合（便于立即应用）。
 */
export function toggleFoldState(docId: number, headingId: string): Set<string> {
  const set = loadFoldState(docId)
  if (set.has(headingId)) set.delete(headingId)
  else set.add(headingId)
  saveFoldState(docId, set)
  return set
}
