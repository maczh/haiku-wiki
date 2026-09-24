/**
 * 内部深链生成器：用于目录树「复制链接」「在新标签页打开」与编辑器块手柄「复制链接」。
 *
 * 统一生成语雀风格的深链 `/books/:bookId?docId=:id&tab=read|edit`，
 * BookPage 已通过 `searchParams.get('docId')` 与 `bookId` path param 消费该格式，
 * 无需新增任何路由。
 *
 * 例：
 *   internalLink(12)              -> /books/12
 *   internalLink(12, 345)         -> /books/12?docId=345
 *   internalLink(12, 345, 'edit') -> /books/12?docId=345&tab=edit
 */

/**
 * 生成相对深链（推荐，随站点部署域名自适应）。
 * @param bookId 知识库 id（路由 path param）
 * @param docId  文档 id（缺省时只指向知识库根）
 * @param tab    打开态，'read' | 'edit'（缺省时不带 tab）
 */
export function internalLink(
  bookId: number,
  docId?: number,
  tab?: 'read' | 'edit',
): string {
  const params = new URLSearchParams()
  if (docId && docId > 0) params.set('docId', String(docId))
  if (tab) params.set('tab', tab)
  const qs = params.toString()
  return qs ? `/books/${bookId}?${qs}` : `/books/${bookId}`
}
