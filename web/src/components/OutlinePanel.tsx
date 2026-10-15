import { useMemo, type CSSProperties } from 'react'

/**
 * 文档大纲侧栏（宿主自托管版）。
 *
 * 取代 vendored typo-md-editor 里未能随包导出的 `OutlinePanel`（其实现在打包产物中
 * 被 tree-shake 掉，渲染即抛 "Element type is invalid" 并连带卸载整棵编辑树，
 * 这正是「编辑模式大纲右边栏丢失」的根因）。本组件不依赖库内部 store / i18n，
 * 直接吃「实时 Markdown 文本」派生大纲，点击滚动定位到对应标题。
 *
 * 设计要点：
 *  - 大纲由 `markdown` prop 解析得到，随编辑实时刷新（宿主在每次 onUpdateModelValue
 *    时把最新文本回灌）；
 *  - 标题解析复用库的语义：仅识别 ATX 标题（#{1,6}），跳过围栏代码块（``` / ~~~）；
 *  - 滚动容器由 `getContainer` 提供（编辑态传 `.milkdown` 所在包裹层），避免多编辑器
 *    实例下命中错误的 `.milkdown`；未传时回退到全局 `document.querySelector('.milkdown')`；
 *  - 通过文本精确匹配 `h1..h6` 的 textContent 定位（与库原实现一致）。
 */

export interface OutlineNode {
  id: string
  level: number
  text: string
  pos: number
  children: OutlineNode[]
}

interface FlatNode {
  node: OutlineNode
  depth: number
}

interface OutlinePanelProps {
  markdown: string
  /** 返回承载已渲染标题的滚动容器；不传则回退到首个 `.milkdown`。 */
  getContainer?: () => Element | null
  className?: string
}

/** 由 Markdown 源解析大纲（ATX 标题，跳过代码围栏）。 */
function parseOutline(markdown: string): OutlineNode[] {
  const lines = (markdown || '').split('\n')
  const flat: OutlineNode[] = []
  let inFence = false
  let index = 0
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) {
      const level = m[1].length
      const text = m[2].trim()
      flat.push({ id: `heading-${index++}`, level, text, pos: -1, children: [] })
    }
  }
  return nest(flat)
}

/** 把扁平标题按层级折成树（level 越小越靠外）。 */
function nest(flat: OutlineNode[]): OutlineNode[] {
  const root: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const item of flat) {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop()
    if (stack.length === 0) root.push(item)
    else stack[stack.length - 1].children.push(item)
    stack.push(item)
  }
  return root
}

function flatten(nodes: OutlineNode[], depth: number, acc: FlatNode[]): void {
  for (const n of nodes) {
    acc.push({ node: n, depth })
    if (n.children?.length) flatten(n.children, depth + 1, acc)
  }
}

const itemBase: CSSProperties = {
  padding: '5px 8px',
  fontSize: 13,
  lineHeight: 1.5,
  color: '#3c4257',
  cursor: 'pointer',
  borderRadius: 4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  userSelect: 'none',
}

export default function OutlinePanel({ markdown, getContainer, className }: OutlinePanelProps) {
  const flat = useMemo<FlatNode[]>(() => {
    const acc: FlatNode[] = []
    flatten(parseOutline(markdown), 0, acc)
    return acc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown])

  function scrollTo(node: OutlineNode): void {
    const root = getContainer ? getContainer() : document.querySelector('.milkdown')
    if (!root) return
    const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
    const target = headings.find((h) => (h.textContent || '').trim() === node.text)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.style.transition = 'background 0.6s ease'
    target.style.background = 'rgba(64,120,242,0.12)'
    window.setTimeout(() => {
      target.style.background = ''
    }, 800)
  }

  if (flat.length === 0) {
    return (
      <div
        className={className}
        style={{ padding: 8, fontSize: 13, color: '#a3a8b3' }}
      >
        暂无标题
      </div>
    )
  }

  return (
    <ul
      className={className}
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      {flat.map((item) => (
        <li
          key={item.node.id}
          className="hk-outline-item"
          title={item.node.text}
          style={{ ...itemBase, paddingLeft: 8 + item.depth * 14 }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(64,120,242,0.08)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = ''
          }}
          onClick={() => scrollTo(item.node)}
        >
          {item.node.text || '·'}
        </li>
      ))}
    </ul>
  )
}
