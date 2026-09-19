import request from './request'
import type { RecentDocItem } from '../types'

/**
 * 首页「最近更新」：跨知识库聚合当前用户可读的最近更新文档。
 *
 * 权限过滤在服务端完成（自己 / members / public / 公司库 / 团队文库 /
 * 受邀协作的文档），前端不做二次筛选 —— 拿到什么就展示什么。
 */
export async function listRecentDocs(limit = 12): Promise<RecentDocItem[]> {
  const res = (await request.get('/recent-docs', { params: { limit } })) as { items: RecentDocItem[] }
  return res.items || []
}
