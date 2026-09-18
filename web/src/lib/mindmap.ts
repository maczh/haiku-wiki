// 思维导图内容契约 v2 —— simple-mind-map 节点树（{data:{text,expand,…},children:[…]}）。
// 存储格式：{"version":2,"root":{"data":{"text":"中心主题","expand":true},"children":[…]}}
// 兼容：v1 旧格式（{"version":1,"tree":{"text":…,"children":[…]}}）读取时递归升级为 v2，
// 旧文档升级后下次保存自然落为 v2。

export interface SmmNodeData {
  text: string
  /** 是否展开子节点（simple-mind-map 节点属性） */
  expand: boolean
  /** 其余 simple-mind-map 节点属性（uid 等）原样透传 */
  [key: string]: unknown
}

export interface SmmNode {
  data: SmmNodeData
  children: SmmNode[]
}

export interface MindmapJSON {
  version: 2
  root: SmmNode
  /** 布局（simple-mind-map 的 layout，v2.2 起持久化；旧文档无此字段） */
  layout?: string
  /** 主题/全局样式（simple-mind-map 的 opt.theme 快照，v2.1 起持久化；旧文档无此字段） */
  theme?: Record<string, unknown>
}

/** v1 旧格式节点（自研树） */
interface V1Node {
  text: string
  children: V1Node[]
}

/** 根节点默认文案（回退默认与空文档共用） */
export const DEFAULT_ROOT_TEXT = '中心主题'

/** 空文档默认根节点 */
export function defaultRoot(): SmmNode {
  return { data: { text: DEFAULT_ROOT_TEXT, expand: true }, children: [] }
}

/** v2 节点树归一化：缺 expand 补 true，children 递归；结构非法返回 null */
function toSmm(n: unknown): SmmNode | null {
  if (!n || typeof n !== 'object') return null
  const d = (n as { data?: unknown }).data
  if (!d || typeof d !== 'object') return null
  const text = (d as { text?: unknown }).text
  if (typeof text !== 'string' || text === '') return null
  const rest = d as Record<string, unknown>
  const expand = typeof rest.expand === 'boolean' ? rest.expand : true
  const rawChildren = (n as { children?: unknown }).children
  const children = Array.isArray(rawChildren)
    ? rawChildren.map(toSmm).filter((x): x is SmmNode => x !== null)
    : []
  return { data: { ...rest, text, expand }, children }
}

/** v1 树 → v2 节点树（文本透传，expand 恒为 true） */
function fromV1(n: unknown): SmmNode | null {
  if (!n || typeof n !== 'object') return null
  const o = n as Partial<V1Node>
  if (typeof o.text !== 'string' || o.text === '') return null
  const children = Array.isArray(o.children)
    ? o.children.map(fromV1).filter((x): x is SmmNode => x !== null)
    : []
  return { data: { text: o.text, expand: true }, children }
}

/**
 * 解析 docs.content：
 *  - version===2 → 归一化后透传
 *  - version===1（旧格式）→ 递归升级为 v2 节点树
 *  - 解析失败 / 不识别 → 回退默认（"中心主题"单节点）并标记 reset（组件负责提示）
 */
export function parseMindmapJSON(content: string): { data: MindmapJSON; reset: boolean } {
  if (content && content.trim() !== '') {
    try {
      const o = JSON.parse(content) as { version?: unknown; root?: unknown; tree?: unknown; theme?: unknown; layout?: unknown }
      if (o && o.version === 2) {
        const root = toSmm(o.root)
        if (root) {
          const theme = o.theme && typeof o.theme === 'object' ? (o.theme as Record<string, unknown>) : undefined
          const layout = typeof o.layout === 'string' && o.layout ? o.layout : undefined
          return { data: { version: 2, root, ...(layout ? { layout } : {}), ...(theme ? { theme } : {}) }, reset: false }
        }
      } else if (o && o.version === 1) {
        const root = fromV1(o.tree)
        if (root) return { data: { version: 2, root }, reset: false }
      }
    } catch {
      /* fallthrough → 回退默认值 */
    }
  }
  return { data: { version: 2, root: defaultRoot() }, reset: !!content && content.trim() !== '' }
}

/** 序列化为存储字符串（v2 契约）；theme/layout 为当前快照（可空，旧文档不写） */
export function stringifyMindmap(root: SmmNode, theme?: Record<string, unknown>, layout?: string): string {
  return JSON.stringify({ version: 2, root, ...(layout ? { layout } : {}), ...(theme ? { theme } : {}) } satisfies MindmapJSON)
}
