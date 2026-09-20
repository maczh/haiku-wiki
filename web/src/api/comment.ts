import request from './request'
import type { DocShareMeta, DocShareContent } from '../types'

// 文档点评 / 讨论区 API（III）。
// 登录用户走 /api/docs/:id/comments；分享访客（免 JWT）走 /public/doc-comments，靠 slug 定位文档。

export interface CommentNode {
  id: number
  parent_id: number
  author_uid: number
  guest_name?: string
  author_name?: string
  body: string
  status: string
  created_at: string
  children?: CommentNode[]
}

export interface CommentListResp {
  comments: CommentNode[]
  can_moderate: boolean
  allow_view: string
  allow_post: string
  locked: boolean
}

export interface CommentSetting {
  doc_id: number
  allow_view: string
  allow_post: string
  locked: boolean
  banned_uids?: number[]
}

export type CommentScope = 'owner' | 'team' | 'login' | 'all'

// ---------- 登录用户 ----------

export function listComments(docId: number): Promise<CommentListResp> {
  return request.get(`/docs/${docId}/comments`) as Promise<CommentListResp>
}

export function createComment(docId: number, body: string, parentId = 0, guestName?: string): Promise<CommentNode> {
  return request.post(`/docs/${docId}/comments`, { body, parent_id: parentId, guest_name: guestName }) as Promise<CommentNode>
}

export function getCommentSettings(docId: number): Promise<CommentSetting> {
  return request.get(`/docs/${docId}/comment-settings`) as Promise<CommentSetting>
}

export function updateCommentSettings(
  docId: number,
  patch: Partial<{ allow_view: CommentScope; allow_post: CommentScope; locked: boolean; banned_uids: number[] }>,
): Promise<CommentSetting> {
  return request.put(`/docs/${docId}/comment-settings`, patch) as Promise<CommentSetting>
}

export function deleteComment(docId: number, cid: number): Promise<{ ok: boolean }> {
  return request.delete(`/docs/${docId}/comments/${cid}`) as Promise<{ ok: boolean }>
}

export function clearComments(docId: number): Promise<{ ok: boolean }> {
  return request.delete(`/docs/${docId}/comments/all`) as Promise<{ ok: boolean }>
}

export function banAuthor(docId: number, cid: number): Promise<{ ok: boolean }> {
  return request.post(`/docs/${docId}/comments/${cid}/ban`, {}) as Promise<{ ok: boolean }>
}

// ---------- 分享访客（免 JWT） ----------

export function listCommentsAnon(slug: string, docId: number, password?: string): Promise<CommentListResp> {
  const qs = new URLSearchParams({ slug: slug, doc_id: String(docId) })
  if (password) qs.set('password', password)
  return request.get(`/public/doc-comments?${qs.toString()}`) as Promise<CommentListResp>
}

export function createCommentAnon(
  slug: string,
  docId: number,
  body: string,
  parentId = 0,
  guestName?: string,
  password?: string,
): Promise<CommentNode> {
  return request.post(`/public/doc-comments`, { slug, doc_id: docId, parent_id: parentId, body, guest_name: guestName, password }) as Promise<CommentNode>
}

export function uploadCommentImageAnon(slug: string, docId: number, file: File, password?: string): Promise<{ url: string; filename: string }> {
  const form = new FormData()
  form.append('slug', slug)
  form.append('doc_id', String(docId))
  if (password) form.append('password', password)
  form.append('file', file)
  return request.post(`/public/doc-comments/upload`, form) as Promise<{ url: string; filename: string }>
}

// 复用分享元信息（补 doc_id，供匿名点评定位）—— 仅类型再导出，调用方从 share.ts 取数据
export type { DocShareMeta, DocShareContent }
