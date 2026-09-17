import request from './request'
import type { ShareInfo, DocDetail, DocShareContent, DocShareMeta } from '../types'

export async function getShare(slug: string): Promise<ShareInfo> {
  return request.get(`/public/share/${slug}`) as Promise<ShareInfo>
}

export async function getShareDoc(slug: string, docId: number): Promise<DocDetail> {
  return request.get(`/public/share/${slug}/docs/${docId}`) as Promise<DocDetail>
}

// ---------- 增量：文档级分享（公开访问，免 JWT） ----------

/** 公开元信息：不存在或停用 → 40401；已过期 → expired=true */
export async function getDocShareMeta(slug: string): Promise<DocShareMeta> {
  return request.get(`/public/doc-share/${slug}`) as Promise<DocShareMeta>
}

/** 密码校验：成功直接返回文档内容；密码错误 40301；限频 42901 */
export async function verifyDocShare(slug: string, password?: string): Promise<DocShareContent> {
  return request.post(`/public/doc-share/${slug}/verify`, { password: password ?? '' }) as Promise<DocShareContent>
}
