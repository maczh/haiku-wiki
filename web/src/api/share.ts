import request from './request'
import type { ShareInfo, DocDetail } from '../types'

export async function getShare(slug: string): Promise<ShareInfo> {
  return request.get(`/public/share/${slug}`) as Promise<ShareInfo>
}

export async function getShareDoc(slug: string, docId: number): Promise<DocDetail> {
  return request.get(`/public/share/${slug}/docs/${docId}`) as Promise<DocDetail>
}
