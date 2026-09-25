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
  /** 公司知识库标记：系统自动创建，全员只读，管理员可授权写权限 */
  is_company_kb?: boolean
  /** 当前用户是否可写（后端按权限实时计算，含公司知识库授权） */
  can_write?: boolean
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
  /**
   * 公司文库「所有人可编辑」标记：开启后任何登录用户都能直接改这篇文档，
   * 用于收集员工的建议、意见与 bug 报告。仅在公司知识库生效。
   */
  public_edit?: boolean
  /** 前端组树后的子节点（后端返回平铺列表，由前端递归组装） */
  children?: DocNode[]
}

export interface DocDetail extends DocNode {
  content: string
  created_by: number
}

export interface DocWithBook {
  doc: DocDetail
  book: { id: number; name: string; visibility: Visibility; owner_id: number }
  /**
   * 文档级写权限：库级权限 + 协作者 + 「所有人可编辑」标记的合成结果。
   * 公司文库里它与 book 级权限会不一致（库只读 + 文档可编辑），前端必须以它为准。
   */
  can_write?: boolean
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
  doc_type?: string
  snippet: string
  updated_at: string
}

export interface UploadResult {
  url: string
  filename: string
  size: number
  /** 内容摘要（32 位小写 hex）。老后端不返回该字段 */
  md5?: string
  /** true = 服务端复查命中已有内容，本次**未写盘**（仅新增一条引用） */
  dedup?: boolean
}

/**
 * 秒传预检（单条形态）响应。
 *
 * ⚠️ 后端**刻意不返回 url**（架构 §12.0 修订）：预检只回答"是否命中"，
 * URL 一律由入库接口（/uploads/instant、图片库、原型）返回。
 */
export interface PrecheckResult {
  hit: boolean
  md5: string
  size: number
}

/** 秒传预检（批量形态）的单项结果：`index` 是**请求下标**，用于把结果对回入参 */
export interface PrecheckBatchItem {
  index: number
  hit: boolean
  md5: string
  size: number
}

export interface PrecheckBatchResult {
  results: PrecheckBatchItem[]
}

/** 秒传落 meta 的响应：与普通上传同构 */
export type InstantResult = UploadResult

/**
 * 批量入口（图片库 / 原型）的 manifest 条目 —— 两阶段协议的**唯一真源**。
 *  - `ref`：内容已存在，服务端只建 meta、**不传字节**（md5 必填）
 *  - `file`：需要传输的字节，取 `files` 中第 k 个 `kind=file`（k = 该条之前 file 的累计数）
 */
export interface BatchManifestEntry {
  kind: 'ref' | 'file'
  md5?: string
  name: string
  size: number
}

/** 批量提交的模式：`manifest` = 两阶段（含秒传）；`bytes` = 旧契约（全部走字节） */
export type BatchUploadMode = 'manifest' | 'bytes'

/** 批量提交的结果概览（后端 `handler.BatchSummary` 对应）。老后端不返回该字段 */
export interface BatchSummary {
  /** 条目总数 */
  total: number
  /** 未传字节的条目数（预检命中） */
  ref: number
  /** 传了字节的条目数 */
  file: number
  /** 最终**没有写盘**的条目数（引用式 + CAS 复用） */
  dedup: number
  /** 被拒收的条目数 */
  rejected: number
}

/** 批量上传响应里与具体条目类型无关的那部分（图片库 / 原型同构） */
export interface BatchAddMeta {
  /** 逐条拒收原因（不中断整批） */
  rejected: { name: string; reason: string }[]
  /** 老后端不返回；据此判断服务端是否理解两阶段协议 */
  mode?: BatchUploadMode
  summary?: BatchSummary
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

export type DocType =
  | 'markdown'
  | 'sheet'
  | 'mindmap'
  | 'flowchart'
  | 'drawing'
  | 'whiteboard'
  | 'todo'
  | 'calendar'
  | 'gantt'
  | 'api'
  | 'file'
  | 'folder'
  | 'web'
  | 'gallery'
  | 'prototype'
  // OnlyOffice Web Comp 编辑型办公文档（Excel 复用 sheet，已改名「Excel文件」）
  | 'word'
  | 'ppt'

/** 全部可新建类型（顺序即新建弹窗展示顺序；数据表已下线，与表格同为 sheet）。
 *  file（导入的 docx/pdf/pptx/dwg 等附件）由导入流程产生，不提供手工新建入口。
 *  folder（目录）由「新建目录」入口产生，不参与「新建文档」的类型选择。 */
export const DOC_TYPES: DocType[] = [
  'markdown',
  'sheet',
  'word',
  'ppt',
  'mindmap',
  'flowchart',
  'drawing',
  'whiteboard',
  'todo',
  'calendar',
  'gantt',
  'api',
  'gallery',
  'prototype',
]

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  markdown: '文档',
  sheet: 'Excel文件',
  mindmap: '思维导图',
  flowchart: '流程图',
  drawing: '绘图',
  whiteboard: '白板',
  todo: '待办清单',
  calendar: '工作日历',
  gantt: '甘特图',
  api: '接口',
  file: '附件',
  folder: '目录',
  web: '网页',
  gallery: '图片库',
  prototype: '需求原型',
  word: 'Word文件',
  ppt: 'PPT文件',
}

/**
 * 网页型文档（doc_type=web）content 结构，与后端 service.WebRef 对应。
 *
 * kind=url ：只保存原始网址，服务端不抓取（旧实现会把网页转成 Markdown 抄一份进本站，
 *            既慢又有版权与一致性问题），阅读页用 iframe 直接加载原站。
 * kind=html：导入的 HTML 页面 / zip 包 / 网页目录，原样保存不做转换，iframe 加载入口文件。
 */
export interface WebRef {
  kind: 'url' | 'html'
  /** kind=url 时的原始网址 */
  url?: string
  /** kind=html 时的入口文件访问路径 */
  entry?: string
  title?: string
  note?: string
}

/**
 * 图片库（doc_type=gallery）里的一张图，与后端 service.GalleryImage 对应。
 *
 * 三份文件：原件（url，永远保留、可下载）+ 预览图（preview，灯箱用，最长边 1600）
 * + 缩略图（thumb，网格用，最长边 400）。SVG 是矢量，preview/thumb 直接等于 url
 * ——浏览器按容器缩放，既省一次栅格化又不失真。
 */
export interface GalleryImage {
  id: string
  name: string
  url: string
  preview: string
  thumb: string
  /** 原尺寸（图片格式=原图 url，即全分辨率） */
  original: string
  size: number
  width: number
  height: number
  ext: string
  /** 没能生成预览图（如缺外部转换器），只能展示占位卡 + 下载原件 */
  degraded: boolean
  note: string
  added_at: string
  /** true = 本次采用引用式入库 / CAS 复用，**未写盘**（前端打「秒传」标） */
  dedup?: boolean
}

/** 图片库正文，与后端 service.GalleryContent 对应 */
export interface GalleryContent {
  version: number
  images: GalleryImage[]
}

/**
 * 需求原型（doc_type=prototype）里的一条，与后端 service.PrototypeItem 对应。
 * kind=html 的原型直接嵌入展示（Axure/Mockplus 导出的网页包），其余生成三档预览图（屏宽/缩略图/原尺寸）+ 原件下载。
 * 三档尺寸：屏宽（preview，最长边 1920）/ 缩略图（thumb，最长边 400）/ 原尺寸（original）。
 */
export interface PrototypeItem {
  id: string
  /** 原型标题（上传时必填） */
  title: string
  /** 需求描述（上传时填写，说明这块原型要做什么） */
  desc: string
  kind: 'html' | 'image' | 'other'
  /** 原件下载地址 */
  url: string
  filename: string
  size: number
  ext: string
  /** kind=html 时：入口页面访问路径（iframe src） */
  entry?: string
  preview?: string
  thumb?: string
  /** 原尺寸（图片格式=原图 url；非图片格式=全分辨率派生图 url） */
  original?: string
  degraded: boolean
  note: string
  added_at: string
  /** true = 本次采用引用式入库 / CAS 复用，**未写盘**（前端打「秒传」标） */
  dedup?: boolean
}

/** 需求原型正文，与后端 service.PrototypeContent 对应 */
export interface PrototypeContent {
  version: number
  items: PrototypeItem[]
}

/** 附件型文档（doc_type=file）content 结构，与后端 exportx.FileRef 对应 */
export interface FileAttachment {  url: string
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
  doc_id: number
  title: string
  doc_type: DocType
  has_password: boolean
  expired: boolean
  views?: number
}

/** 密码校验成功返回（POST /api/public/doc-share/:slug/verify） */
export interface DocShareContent {
  doc_id: number
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
  role: 'admin' | 'read_write' | 'read_only' | 'member'
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
  my_role: 'admin' | 'read_write' | 'read_only' | 'member'
}

// ---------- 系统管理（管理员） ----------

/** 文库视图（复用 BookWithCount 形态，供管理员查看用户文库用） */
export interface LibraryView {
  id: number
  owner_id: number
  name: string
  description: string
  visibility: Visibility
  team_id: number | null
  is_company_kb?: boolean
  doc_count: number
}

/** 用户文库集合：私有文库 + 团队文库 */
export interface UserLibraries {
  private: LibraryView[]
  team: LibraryView[]
}

/** 系统配置（镜像后端 EditableConfig 的 JSON 结构） */
export interface SystemConfig {
  server: { port: string; mode: string }
  jwt: { secret: string }
  database: {
    driver: 'sqlite' | 'mysql'
    dsn: string
    host: string
    port: number
    user: string
    password: string
    name: string
  }
  storage: { type: 'local' | 's3'; local_dir: string }
  s3: {
    endpoint: string
    region: string
    bucket: string
    access_key: string
    secret_key: string
    prefix: string
    force_path_style: boolean
    public_read: boolean
    presign_ttl: number
  }
  upload: { max_size_mb: number }
}

/** 迁移任务状态（镜像后端 service.MigrateStatus） */
export interface MigrateStatus {
  type: string
  status: 'idle' | 'running' | 'done' | 'failed'
  total: number
  done: number
  failed: number
  skipped: number
  message: string
  switched: boolean
  need_restart: boolean
  started_at?: string | null
  finished_at?: string | null
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
  /** 手机号（可空，后端 COALESCE 成空串） */
  phone?: string
}

/** 网页导入返回 */
export interface ImportUrlResult {
  doc_id: number
  title: string
}

// ---------- 公司知识库写权限授权 ----------

/** 公司知识库写权限授权用户视图（GET /api/admin/books/:id/writers） */
export interface BookWriterView {
  book_id: number
  user_id: number
  created_at: string
  username: string
  name: string
  email: string
  nickname: string
}

// ---------- 首页 Dashboard ----------

/** 最近更新文档条目（GET /api/recent-docs） */
export interface RecentDocItem {
  id: number
  title: string
  doc_type: DocType
  book_id: number
  book_name: string
  /** RFC3339 时间串 */
  updated_at: string
  can_write: boolean
}

/**
 * 工作台文档条目（GET /api/workbench）。
 *
 * 与 RecentDocItem 的唯一差异是**带正文**：待办完成率、甘特图进度、今日日程
 * 都必须解析 content 才能算出来，所以聚合接口把正文一并返回，避免前端 N+1。
 * doc_type 目前只会是 'todo' | 'gantt' | 'calendar'（仍按 DocType 收窄，便于复用渲染逻辑）。
 */
export interface WorkbenchDoc {
  id: number
  title: string
  doc_type: DocType
  book_id: number
  book_name: string
  /** RFC3339 时间串 */
  updated_at: string
  can_write: boolean
  content: string
}

/** 工作台聚合结果：items 是各类型的最近若干篇，counts 是各类型文档总数 */
export interface WorkbenchView {
  items: WorkbenchDoc[]
  counts: Record<string, number>
}
