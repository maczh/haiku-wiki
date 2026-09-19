import request from './request'
import type { WorkbenchView } from '../types'

/**
 * 工作台聚合：一次请求拿到「待办 / 甘特图 / 工作日历」三类文档（含正文）。
 *
 * 为什么不让前端逐篇拉正文：那会是 N+1 次往返（10 篇就是 10 个请求）。
 * perType 是**单类型**条数上限，后端会再钳到 20。
 * bookId 传入时限定单个知识库（文库工作台用），不传为全局。
 */
export async function getWorkbench(perType = 8, bookId?: number): Promise<WorkbenchView> {
  const res = (await request.get('/workbench', {
    params: { per_type: perType, ...(bookId ? { book_id: bookId } : {}) },
  })) as { items: WorkbenchView['items']; counts: WorkbenchView['counts'] }
  return { items: res.items || [], counts: res.counts || {} }
}
