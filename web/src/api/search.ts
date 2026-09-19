import request from './request'
import type { SearchHit } from '../types'

/**
 * 标题 + 正文搜索。bookId 传入时限定单个知识库（文库工作台用），不传为全局。
 */
export async function search(q: string, bookId?: number): Promise<SearchHit[]> {
  return request.get('/search', {
    params: { q, ...(bookId ? { book_id: bookId } : {}) },
  }) as Promise<SearchHit[]>
}
