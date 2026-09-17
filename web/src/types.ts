// 与后端 JSON 字段一一对应（snake_case，见架构文档 §四 共享约定）

export interface User {
  id: number
  email: string
  nickname: string
  role: 'admin' | 'member'
  created_at: string
}

export type Visibility = 'private' | 'members' | 'public'

export interface Book {
  id: number
  owner_id: number
  name: string
  description: string
  cover_color: string
  cover_image: string
  visibility: Visibility
  share_slug: string | null
  created_at: string
  updated_at: string
}

export interface BookWithCount extends Book {
  doc_count: number
}

export interface Bookshelf {
  mine: BookWithCount[]
  visible: BookWithCount[]
}

export interface DocNode {
  id: number
  book_id: number
  parent_id: number
  title: string
  pos: string
  updated_at: string
}

export interface DocDetail extends DocNode {
  content: string
  created_by: number
}

export interface DocWithBook {
  doc: DocDetail
  book: { id: number; name: string; visibility: Visibility; owner_id: number }
}

export interface VersionMeta {
  id: number
  doc_id: number
  title: string
  source: 'auto' | 'manual' | 'rollback'
  size: number
  created_at: string
}

export interface DocVersion {
  id: number
  doc_id: number
  title: string
  content: string
  source: string
  created_at: string
}

export interface SearchHit {
  doc_id: number
  book_id: number
  book_name: string
  title: string
  snippet: string
  updated_at: string
}

export interface UploadResult {
  url: string
  filename: string
  size: number
}

export interface AuthResult {
  token: string
  user: User
}

export interface ShareBookInfo {
  id: number
  name: string
  cover_color: string
  owner_name: string
}

export interface ShareInfo {
  book: ShareBookInfo
  docs: DocNode[]
}

export interface TrashItem {
  doc_id: number
  book_id: number
  parent_id: number
  title: string
  deleted_at: string | null
  book_name: string
}

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: '私有',
  members: '成员可见',
  public: '公开',
}

// 封面色板（语雀风格低饱和色系）
export const COVER_COLORS = [
  '#2f54eb', '#1677ff', '#13c2c2', '#52c41a',
  '#722ed1', '#eb2f96', '#f5222d', '#fa8c16',
  '#faad14', '#4b5959', '#001529', '#6b7f99',
]
