// 思维导图内容契约（架构文档 §5.2）——JSON 树 ↔ Markdown 双向序列化（markmap 输入用）。
// 存储格式：{"version":1,"tree":{"text":"中心主题","children":[…]}}

export interface MindNode {
  text: string
  children: MindNode[]
}

export interface MindmapJSON {
  version: number
  tree: MindNode
}

/** 空文档默认值 */
export const DEFAULT_MINDMAP: MindmapJSON = {
  version: 1,
  tree: { text: '中心主题', children: [] },
}

function normalizeNode(n: unknown): MindNode | null {
  if (!n || typeof n !== 'object') return null
  const o = n as Partial<MindNode>
  if (typeof o.text !== 'string') return null
  const children = Array.isArray(o.children) ? o.children.map(normalizeNode).filter((x): x is MindNode => x !== null) : []
  return { text: o.text, children }
}

/** 解析 docs.content：失败或 version 不识别 → 回退默认值并标记 reset（组件负责提示） */
export function parseMindmapJSON(content: string): { data: MindmapJSON; reset: boolean } {
  if (content && content.trim() !== '') {
    try {
      const o = JSON.parse(content) as Partial<MindmapJSON>
      const tree = o && o.version === 1 ? normalizeNode(o.tree) : null
      if (tree) return { data: { version: 1, tree }, reset: false }
    } catch {
      /* fallthrough → 回退默认值 */
    }
  }
  return { data: { version: 1, tree: { text: DEFAULT_MINDMAP.tree.text, children: [] } }, reset: !!content && content.trim() !== '' }
}

/** 树 → Markdown（根 `# `，二级 `## `，更深无序列表缩进），喂给 markmap-lib 渲染 */
export function treeToMarkdown(root: MindNode): string {
  const lines: string[] = [`# ${root.text}`]
  const walk = (children: MindNode[], depth: number) => {
    for (const c of children) {
      if (depth === 1) lines.push('', `## ${c.text}`)
      else lines.push(`${'  '.repeat(depth - 2)}- ${c.text}`)
      walk(c.children, depth + 1)
    }
  }
  walk(root.children, 1)
  return lines.join('\n')
}

/** 深拷贝树（编辑操作在克隆上进行） */
export function cloneTree(n: MindNode): MindNode {
  return { text: n.text, children: n.children.map(cloneTree) }
}

/** 序列化为存储字符串 */
export function stringifyMindmap(tree: MindNode): string {
  return JSON.stringify({ version: 1, tree } satisfies MindmapJSON)
}
