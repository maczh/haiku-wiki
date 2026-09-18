// 与后端 JSON 字段一一对应（snake_case，见架构文档 §四 共享约定）

export interface User {
  id: number
  username: string
  email: string
  nickname: string
  /** 真实姓名（可选） */
  name: string
  /** 部门（可选） */
  department: string
  /** 手机号（可选，唯一） */
  phone: string
  role: 'admin' | 'member'
  /** 1=启用 0=禁用 */
  status: number
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
  /** 团队文库归属（nil=个人库） */
  team_id: number | null
  created_at: string
  updated_at: string
}

export interface BookWithCount extends Book {
  doc_count: number
}

export interface Bookshelf {
  mine: BookWithCount[]
  visible: BookWithCount[]
  /** 我参与的团队文库（任意角色可读写） */
  teams: BookWithCount[]
}

export interface DocNode {
  id: number
  book_id: number
  parent_id: number
  title: string
  doc_type: DocType
  pos: string
  /** 置顶时间（null=未置顶；同级内置顶排最前） */
  pinned_at: string | null
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

// ---------- 增量：多文档类型 ----------

export type DocType = 'markdown' | 'sheet' | 'mindmap' | 'flowchart' | 'drawing' | 'todo' | 'calendar' | 'file'

/** 全部可新建类型（顺序即新建弹窗展示顺序；数据表已下线，与表格同为 sheet）。
 *  file（导入的 docx/pdf/pptx/dwg 等附件）由导入流程产生，不提供手工新建入口。 */
export const DOC_TYPES: DocType[] = ['markdown', 'sheet', 'mindmap', 'flowchart', 'drawing', 'todo', 'calendar']

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  markdown: '文档',
  sheet: '表格',
  mindmap: '思维导图',
  flowchart: '流程图',
  drawing: '绘图',
  todo: '待办清单',
  calendar: '工作日历',
  file: '附件',
}

/** 附件型文档（doc_type=file）content 结构，与后端 exportx.FileRef 对应 */
export interface FileAttachment {
  url: string
  filename: string
  size: number
  ext: string
  /**
   * 后端自动派生的转换产物：键为格式（`svg` / `png`），值为可访问 URL。
   * 目前仅 .dwg / .dxf 导入时回填（导入后由后端转换并落盘）。
   */
  derived?: Record<string, string>
  /** 派生过程降级（例：DWG 无外部转换器时仅能取到文件内嵌预览位图） */
  degraded?: boolean
  /** 降级或失败的原因说明，用于界面提示 */
  note?: string
  /**
   * .pptx 已做过「外链图片本地化」扫描。
   * 新导入的 pptx 恒为 true；历史文件中该字段缺失，阅读页会补做一次（接口幂等）。
   */
  pptx_scanned?: boolean
}

/** 一种可导出的格式（GET /api/export/docs/:id/formats） */
export interface ExportFormatSpec {
  value: string
  label: string
  ext: string
  mime: string
}

/** 导出对话所需格式元信息；附件型 is_file=true，导出项来自 formats */
export interface DocExportFormats {
  doc_type: DocType
  is_file: boolean
  formats: ExportFormatSpec[] | null
  default: string
  filename: string
  /** 附件已由后端派生出的格式 → URL（键为格式名，如 svg/png） */
  derived?: Record<string, string>
  /** 派生降级标记（见 FileAttachment.degraded） */
  degraded?: boolean
  /** 派生说明 */
  note?: string
}

// ---------- 增量：文档级分享 ----------

/** 分享管理视图（GET / PUT /api/docs/:id/share） */
export interface DocShareView {
  slug: string
  has_password: boolean
  expires_at: string | null
  enabled: boolean
  views: number
  updated_at: string
}

/** 分享公开元信息（GET /api/public/doc-share/:slug） */
export interface DocShareMeta {
  title: string
  doc_type: DocType
  has_password: boolean
  expired: boolean
  views?: number
}

/** 密码校验成功返回（POST /api/public/doc-share/:slug/verify） */
export interface DocShareContent {
  title: string
  doc_type: DocType
  content: string
}

// ---------- 增量 R5：后台管理 / 团队 / 协作 ----------

/** 管理员视角的用户列表项（GET /api/admin/users） */
export interface AdminUser {
  id: number
  username: string
  name: string
  email: string
  phone: string
  department: string
  role: 'admin' | 'member'
  status: number
  created_at: string
}

/** 管理员用户列表分页包 */
export interface AdminUserList {
  users: AdminUser[]
  total: number
  page: number
  page_size: number
}

/** 团队 */
export interface Team {
  id: number
  name: string
  description: string
  owner_id: number
  created_at: string
  updated_at: string
}

/** 团队列表项（含文库数） */
export interface TeamWithCount extends Team {
  book_count: number
}

/** 团队成员视图（含用户展示信息） */
export interface TeamMemberView {
  team_id: number
  user_id: number
  role: 'admin' | 'member'
  created_at: string
  username: string
  name: string
  email: string
  nickname: string
  department: string
  is_owner: boolean
}

/** 团队详情返回 */
export interface TeamDetail {
  team: Team
  my_role: 'admin' | 'member'
}

/** 文档协作者（个人库文档邀请协作） */
export interface DocCollaborator {
  doc_id: number
  user_id: number
  created_at: string
  username: string
  name: string
  email: string
  nickname: string
}

/** 网页导入返回 */
export interface ImportUrlResult {
  doc_id: number
  title: string
}
