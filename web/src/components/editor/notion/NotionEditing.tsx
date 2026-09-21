import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  BgColorsOutlined,
  BoldOutlined,
  CodeOutlined,
  DeleteOutlined,
  FontSizeOutlined,
  FormOutlined,
  FunctionOutlined,
  HolderOutlined,
  ItalicOutlined,
  LinkOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import {
  CONVERT_TARGETS,
  HOST_INSERT_ITEMS,
  INLINE_STYLES,
  INSERT_TEMPLATES,
  applyInlineStyle,
  convertBlock,
  convertLine,
  copyBlock,
  deleteBlock,
  detectBlockRange,
  formatDate,
  formatDateTime,
  indentBlock,
  insertAfterLine,
  replaceLine,
  type BlockKind,
  type BlockRange,
  type InlineStyle,
} from '../../../lib/notionBlocks'
import { internalLink } from '../../../lib/internalLink'
import { blockIndexAtPoint, irBlocks, irReset } from '../../../lib/irDom'

export interface NotionEditingProps {
  /** Vditor 挂载的外层元素（滚动容器），用来定位手柄与监听事件 */
  hostRef: React.RefObject<HTMLDivElement | null>
  /** 取当前 Markdown 全文 */
  getValue: () => string
  /** 写回 Markdown；caretBlock 指定写回后光标落到哪个块 */
  writeValue: (md: string, caretBlock?: number) => void
  /**
   * 图片/链接/附件这类需要弹窗或上传的动作，交回宿主实现。
   * 宿主完成上传后调用 `replace(lines, caretBlock)` 把结果写回该行。
   */
  onHostInsert: (
    key: 'image' | 'link' | 'attachment',
    ctx: { line: number; stripped: string; replace: (replacement: string[], caretBlock: number) => void },
  ) => void
  /** 编辑器是否已就绪 */
  ready: boolean
}

/** 手柄距块左边缘的横向偏移（仅用于手柄定位） */
const HANDLE_OFFSET = 26
/** 块左侧「触发带」宽度：鼠标在块左缘向左此范围内即视为命中该块，
 *  避免移向手柄时（左缘到手柄之间为空白留白带）手柄立刻消失（BUG 1）。 */
const HANDLE_GUTTER = 50

/** 合法的「转换为」叶子类型：用于拦截「标题 / 列表」这类仅有子菜单的父级 key，
 *  避免其被当成真实转换而误清整块前缀。 */
const CONVERT_KINDS = new Set<BlockKind>([
  'paragraph',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'task',
  'quote',
  'code',
  'hr',
  'table',
  'callout',
  'details',
])

const CONVERT_ICON: Partial<Record<BlockKind, React.ReactNode>> = {
  paragraph: <FormOutlined />,
  h1: <FontSizeOutlined />,
  h2: <FontSizeOutlined />,
  h3: <FontSizeOutlined />,
  ul: <UnorderedListOutlined />,
  ol: <OrderedListOutlined />,
  quote: <FormOutlined />,
  code: <CodeOutlined />,
  hr: <MinusOutlined />,
}

const INSERT_ICON: Record<string, React.ReactNode> = {
  table: <FormOutlined />,
  code: <CodeOutlined />,
  quote: <FormOutlined />,
  todo: <UnorderedListOutlined />,
  divider: <MinusOutlined />,
  math: <FunctionOutlined />,
  date: <FormOutlined />,
  datetime: <FormOutlined />,
  image: <PictureOutlined />,
  link: <LinkOutlined />,
  attachment: <PaperClipOutlined />,
}

const INLINE_ICON: Record<InlineStyle, React.ReactNode> = {
  bold: <BoldOutlined />,
  italic: <ItalicOutlined />,
  strike: <DeleteOutlined />,
  code: <CodeOutlined />,
  mark: <BgColorsOutlined />,
}

/**
 * 仿 Notion 的两处编辑入口：
 *
 *   1. **行左侧手柄**：鼠标移到任意一段的左侧留白处，出现 ⋮⋮ 手柄，点开即可
 *      改变该段落的块类型（正文/标题/列表/引用/代码/分割线）、插入各类内容，
 *      以及给该行文字加行内样式。
 *   2. **行首 `/` 快捷菜单**：在空行输入 `/` 会弹出带搜索框的格式面板，
 *      输入关键词（中英皆可）回车即套用，Esc 关闭。
 *
 * 实现约定：所有改动都落到 Markdown 源文本上（见 lib/notionBlocks.ts 的说明），
 * 再整篇写回 Vditor。块定位用「IR 顶层块在文档序中的位置」作锚点（见 lib/irDom.ts）。
 */
/** 「在下方添加」各块的插入模板（图片走宿主上传，单独处理） */
const ADD_TEMPLATES: Record<string, string[]> = {
  table: ['| 列 1 | 列 2 |', '| --- | --- |', '|  |  |'],
  code: ['```', '', '```'],
  quote: ['> 引用内容'],
  callout: ['> 💡 提示内容'],
  math: ['$$', '', '$$'],
  h1: ['# 标题'],
  h2: ['## 标题'],
  h3: ['### 标题'],
  h4: ['#### 标题'],
  h5: ['##### 标题'],
  h6: ['###### 标题'],
  ul: ['- 列表项'],
  ol: ['1. 列表项'],
  mindmap: ['```mermaid', 'mindmap', '  root((中心主题))', '    - 分支一', '    - 分支二', '```'],
  flowchart: [
    '```mermaid',
    'flowchart TD',
    '  A[开始] --> B{判断}',
    '  B -->|是| C[执行]',
    '  B -->|否| D[结束]',
    '```',
  ],
}

/** 复制文本到剪贴板（失败静默） */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    /* 忽略 */
  }
}

/** 当前文档的语雀风格深链（块手柄「复制链接」语义 = 文档级深链） */
function currentDocLink(): string {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('tab')
    const m = url.pathname.match(/\/books\/(\d+)/)
    const bookId = m ? Number(m[1]) : 0
    const docIdRaw = url.searchParams.get('docId')
    const docId = docIdRaw ? Number(docIdRaw) : 0
    if (bookId > 0) return internalLink(bookId, docId > 0 ? docId : undefined)
  } catch {
    /* 回退到当前 URL */
  }
  return window.location.href
}

export default function NotionEditing({ hostRef, getValue, writeValue, onHostInsert, ready }: NotionEditingProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ el: HTMLElement; block: number; top: number; left: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** 行首 `/` 快捷菜单 */
  const [slash, setSlash] = useState<{ block: number; query: string; top: number; left: number } | null>(null)
  const [slashActive, setSlashActive] = useState(0)
  const hoverRef = useRef<typeof hover>(null)
  const rafRef = useRef(0)
  /** 鼠标是否正停留在手柄之上：停留时冻结悬停逻辑，只响应单击（避免光标形状变化引发闪烁） */
  const overHandleRef = useRef(false)

  useEffect(() => {
    hoverRef.current = hover
  }, [hover])

  // 手柄卸载（hover 清空）时 mouseleave 不会再触发，必须主动复位冻结闩，
  // 否则 overHandleRef 卡死为 true，手柄从此永远不再出现（「功能丢失」的根因）
  useEffect(() => {
    if (!hover) overHandleRef.current = false
  }, [hover])

  /** 根据元素位置算出叠加层坐标（相对 host 的 padding box） */
  const place = useCallback(
    (el: HTMLElement) => {
      const host = hostRef.current
      if (!host) return null
      const hr = host.getBoundingClientRect()
      const br = el.getBoundingClientRect()
      // 滚出可视区就收起
      if (br.bottom < hr.top || br.top > hr.bottom) return null
      return {
        top: br.top - hr.top,
        left: Math.max(2, br.left - hr.left - HANDLE_OFFSET),
      }
    },
    [hostRef],
  )

  /**
   * 由任意 DOM 元素解析其所在的「顶层块」与文档序索引（= Markdown 源行锚点）。
   * 实测铁律（见 lib/irDom.ts）：Vditor 为所有模式各建一个 `.vditor-reset`，必须限定
   * `.vditor-ir` 内的那个；`data-block` 是静态占位 "0"，只有文档序位置有意义。
   */
  const resolveBlock = useCallback(
    (el: HTMLElement): { el: HTMLElement; block: number } | null => {
      const host = hostRef.current
      if (!host || !host.contains(el)) return null
      const reset = irReset(host)
      if (!reset || !reset.contains(el)) return null
      let node: HTMLElement | null = el
      let top: HTMLElement | null = null
      while (node && node !== reset) {
        if (node.hasAttribute('data-block')) top = node
        node = node.parentElement
      }
      if (!top) return null
      const block = irBlocks(host).indexOf(top)
      return block < 0 ? null : { el: top, block }
    },
    [hostRef],
  )

  /**
   * 取鼠标下的「顶层块」与其对应的源行号（文档序索引）。
   *
   * 关键修正（BUG 1 / BUG 2）：不再依赖 `elementFromPoint` 命中块元素本身，而是用
   * `blockIndexAtPoint` 以**纵向坐标**锁定光标所在顶层块、再判断横向是否在块内或其左侧
   * 触发带（HANDLE_GUTTER）内。这样左侧留白带里命中容器元素也不会解析失败、手柄消失，
   * 且命中的块索引一定是光标所在行的顶层块。
   */
  const blockAtPoint = useCallback(
    (x: number, y: number): { el: HTMLElement; block: number } | null => {
      const host = hostRef.current
      if (!host) return null
      const reset = irReset(host)
      if (!reset) return null
      const blocks = irBlocks(host)
      if (blocks.length === 0) return null
      const idx = blockIndexAtPoint(blocks, x, y, HANDLE_GUTTER)
      if (idx < 0) return null
      return { el: blocks[idx], block: idx }
    },
    [hostRef],
  )

  // 悬停手柄
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ready) return
    const onMove = (e: MouseEvent) => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const layer = layerRef.current
        const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        const overLayer = !!(layer && under && layer.contains(under))
        if (overHandleRef.current) {
          if (overLayer) return // 鼠标停在手柄上：冻结，只等单击弹出菜单
          overHandleRef.current = false // 自愈：闩卡死时（如手柄被卸载）能自动恢复悬停
        }
        // 鼠标移到叠加层（手柄/菜单浮层）上时保持现状，否则手柄会在指针移过去的一瞬间消失
        if (overLayer) return

        const hit = blockAtPoint(e.clientX, e.clientY)
        if (!hit) {
          if (!menuOpen) setHover(null)
          return
        }
        const pos = place(hit.el)
        if (!pos) {
          if (!menuOpen) setHover(null)
          return
        }
        setHover((prev) =>
          prev && prev.el === hit.el && prev.top === pos.top && prev.left === pos.left
            ? prev
            : { el: hit.el, block: hit.block, ...pos },
        )
      })
    }
    const onLeave = (e: MouseEvent) => {
      // 指针移到自家叠加层（手柄/浮层）上不算离开：叠加层是 host 的兄弟节点，
      // 移过去会触发 host 的 mouseleave，若此时清空 hover 就会造成「闪烁/点不到」
      const layer = layerRef.current
      if (layer && e.relatedTarget instanceof Node && layer.contains(e.relatedTarget)) return
      if (!menuOpen) setHover(null)
    }
    // 滚动时按元素实时位置重算（叠加层不在滚动容器内，不会自己跟着走）
    const onScroll = () => {
      const cur = hoverRef.current
      if (!cur) return
      const pos = place(cur.el)
      if (!pos) setHover(null)
      else setHover({ ...cur, ...pos })
    }
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', onLeave)
    host.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mouseleave', onLeave)
      host.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [hostRef, ready, blockAtPoint, place, menuOpen])

  // 行首 `/`：监听输入，判断当前块是否只剩一个斜杠命令
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ready) return
    const onInput = () => {
      const sel = window.getSelection()
      let node: Node | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
      let blockEl: HTMLElement | null = null
      while (node && node !== host) {
        if (node instanceof HTMLElement && node.hasAttribute('data-block')) {
          blockEl = node
          break
        }
        node = node.parentNode
      }
      if (!blockEl) {
        setSlash(null)
        return
      }
      // 只认「整块内容就是一个斜杠命令」的情况：块中间打 / 不该弹菜单
      const text = (blockEl.textContent ?? '').trim()
      const m = /^\/([^\s/]{0,16})$/.exec(text)
      if (!m) {
        setSlash(null)
        return
      }
      const resolved = resolveBlock(blockEl)
      if (!resolved) {
        setSlash(null)
        return
      }
      const pos = place(resolved.el)
      if (!pos) {
        setSlash(null)
        return
      }
      setSlashActive(0)
      setSlash({
        block: resolved.block,
        query: m[1],
        top: pos.top,
        left: pos.left + HANDLE_OFFSET,
      })
    }
    const onBlur = () => window.setTimeout(() => setSlash(null), 120)
    host.addEventListener('input', onInput)
    host.addEventListener('focusout', onBlur)
    return () => {
      host.removeEventListener('input', onInput)
      host.removeEventListener('focusout', onBlur)
    }
  }, [hostRef, ready, place, resolveBlock])

  /** 把当前行替换成 `replacement`（可多行）后写回 */
  const applyLines = useCallback(
    (lineIndex: number, replacement: string[], caretBlock: number) => {
      const lines = getValue().split('\n')
      writeValue(replaceLine(lines, lineIndex, replacement).join('\n'), caretBlock)
    },
    [getValue, writeValue],
  )

  /** 读取某一行并去掉行尾的 `/命令` 残留 */
  const readStripped = useCallback(
    (lineIndex: number): string => {
      const lines = getValue().split('\n')
      const cur = lines[lineIndex] ?? ''
      return cur.replace(/(^|\s)\/[^\s/]*$/, '$1')
    },
    [getValue],
  )

  /** 「在下方添加」某块：图片走宿主上传，其余直接插模板并写回 */
  const handleAdd = useCallback(
    (sub: string, lines: string[], range: BlockRange) => {
      const prevLine = range.end >= 0 ? (lines[range.end] ?? '') : ''
      const needGap = range.end + 1 > 0 && prevLine.trim() !== ''
      if (sub === 'image') {
        const insertAt = range.end + 1
        const next = [...lines.slice(0, insertAt), '', ...lines.slice(insertAt)]
        writeValue(next.join('\n'), insertAt)
        onHostInsert('image', {
          line: insertAt,
          stripped: '',
          replace: (replacement, caretBlock) => applyLines(insertAt, replacement, caretBlock),
        })
        return
      }
      const tpl = ADD_TEMPLATES[sub]
      if (!tpl) return
      const insertAt = range.end + 1
      const addition = needGap ? ['', ...tpl] : tpl
      const next = [...lines.slice(0, insertAt), ...addition, ...lines.slice(insertAt)]
      writeValue(next.join('\n'), insertAt + (needGap ? 1 : 0))
    },
    [applyLines, writeValue, onHostInsert],
  )

  /** 菜单动作：语雀块菜单（删除/复制/剪切/缩进/复制链接/转化为/在下方添加）+ 保留 / 快捷菜单 */
  const runAction = useCallback(
    (block: number, key: string) => {
      if (block < 0) return
      const lines = getValue().split('\n')
      const range = detectBlockRange(lines, block)

      // —— 语雀块菜单 ——
      if (key === 'delete') {
        const next = deleteBlock(lines, range)
        writeValue(next.join('\n'), Math.min(range.start, next.length - 1))
        return
      }
      if (key === 'copy') {
        void copyToClipboard(copyBlock(lines, range))
        message.success('已复制块')
        return
      }
      if (key === 'cut') {
        void copyToClipboard(copyBlock(lines, range))
        const next = deleteBlock(lines, range)
        writeValue(next.join('\n'), Math.min(range.start, next.length - 1))
        return
      }
      if (key === 'indent:right') {
        writeValue(indentBlock(lines, range, 2).join('\n'), block)
        return
      }
      if (key === 'indent:left') {
        writeValue(indentBlock(lines, range, -2).join('\n'), block)
        return
      }
      if (key === 'copyLink') {
        void copyToClipboard(currentDocLink())
        message.success('链接已复制')
        return
      }
      if (key.startsWith('convert:')) {
        const kind = key.slice('convert:'.length) as BlockKind
        // 拦截「标题 / 列表」等仅有子菜单的父级 key（如 convert:h / convert:list），
        // 否则会落到 default 分支把整块前缀清掉
        if (!CONVERT_KINDS.has(kind)) return
        const converted = convertBlock(lines, range, kind)
        const next = [...lines.slice(0, range.start), ...converted, ...lines.slice(range.end + 1)]
        writeValue(next.join('\n'), range.start)
        return
      }
      if (key.startsWith('add:')) {
        handleAdd(key.slice('add:'.length), lines, range)
        return
      }

      // —— 保留原 `/` 快捷菜单动作（向后兼容）——
      const kindTarget = CONVERT_TARGETS.find((c) => `convert:${c.kind}` === key)
      if (kindTarget) {
        applyLines(block, convertLine(readStripped(block), kindTarget.kind).split('\n'), block)
        return
      }
      const inline = INLINE_STYLES.find((s) => `inline:${s.style}` === key)
      if (inline) {
        applyLines(block, [applyInlineStyle(readStripped(block), inline.style)], block)
        return
      }
      const tpl = [...INSERT_TEMPLATES, ...HOST_INSERT_ITEMS].find((t) => `insert:${t.key}` === key)
      if (!tpl) return
      const stripped = readStripped(block)
      if (tpl.key === 'image' || tpl.key === 'link' || tpl.key === 'attachment') {
        // 交给宿主：上传/弹窗完成后由宿主调用 replace 写回
        onHostInsert(tpl.key, {
          line: block,
          stripped,
          replace: (replacement, caretBlock) => applyLines(block, replacement, caretBlock),
        })
        return
      }
      let body = tpl.lines
      if (tpl.key === 'date') body = [formatDate()]
      if (tpl.key === 'datetime') body = [formatDateTime()]
      // 原行还有内容就保留它，空行则被插入内容顶替（否则会留下一个空段落）
      const keep = stripped.trim() ? [stripped] : []
      applyLines(block, [...keep, ...body], block + keep.length)
    },
    [applyLines, readStripped, handleAdd, onHostInsert, getValue, writeValue],
  )

  // 悬停手柄点击后的菜单（语雀结构）：转化为 / 删除 / 复制 / 剪切 / 缩进 / 复制链接 / 在下方添加
  const menu: MenuProps = useMemo(() => {
    const block = hover?.block ?? -1

    // 转化为：标题(H1-H6) / 段落 / 引用 / 高亮块 / 列表(无序/有序) / 待办 / 代码块
    const convertChildren: NonNullable<MenuProps['items']> = [
      {
        key: 'convert:h',
        label: '标题',
        children: (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as BlockKind[]).map((k) => ({
          key: `convert:${k}`,
          label: `标题 ${k.slice(1)}`,
        })),
      },
      { key: 'convert:paragraph', label: '正文' },
      { key: 'convert:quote', label: '引用' },
      { key: 'convert:callout', label: '高亮块' },
      {
        key: 'convert:list',
        label: '列表',
        children: [
          { key: 'convert:ul', label: '无序列表' },
          { key: 'convert:ol', label: '有序列表' },
        ],
      },
      { key: 'convert:task', label: '待办清单' },
      { key: 'convert:code', label: '代码块' },
    ]

    // 在下方添加：图片/表格/代码块/引用/高亮块/标题(H1-H6)/列表(无序/有序)/思维导图/流程图/公式
    const addChildren: NonNullable<MenuProps['items']> = [
      { key: 'add:image', label: '图片' },
      { key: 'add:table', label: '表格' },
      { key: 'add:code', label: '代码块' },
      { key: 'add:quote', label: '引用' },
      { key: 'add:callout', label: '高亮块' },
      {
        key: 'add:h',
        label: '标题',
        children: (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as BlockKind[]).map((k) => ({
          key: `add:${k}`,
          label: `标题 ${k.slice(1)}`,
        })),
      },
      {
        key: 'add:list',
        label: '列表',
        children: [
          { key: 'add:ul', label: '无序列表' },
          { key: 'add:ol', label: '有序列表' },
        ],
      },
      { key: 'add:mindmap', label: '思维导图' },
      { key: 'add:flowchart', label: '流程图' },
      { key: 'add:math', label: '数学公式' },
    ]

    // 缩进：向右 / 向左
    const indentChildren: NonNullable<MenuProps['items']> = [
      { key: 'indent:right', label: '向右缩进' },
      { key: 'indent:left', label: '向左缩进' },
    ]

      return {
        items: [
          { key: 'convert', label: '样式', children: convertChildren },
        { type: 'divider' as const },
        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
        { key: 'copy', label: '复制' },
        { key: 'cut', label: '剪切' },
        { key: 'indent', label: '缩进', children: indentChildren },
        { key: 'copyLink', label: '复制链接' },
        { key: 'add', label: '在下方添加', children: addChildren },
      ],
      onClick: ({ key }) => {
        setMenuOpen(false)
        setHover(null)
        runAction(block, key)
      },
    }
  }, [hover, runAction])

  // `/` 菜单的候选项（转换 + 插入，搜索过滤）
  const slashItems = useMemo(() => {
    const convert = CONVERT_TARGETS.map((c) => ({
      key: `convert:${c.kind}`,
      label: c.label,
      group: '转换为',
      keywords: `${c.label} ${c.kind}`,
      icon: CONVERT_ICON[c.kind] ?? <FormOutlined />,
    }))
    const insert = [...INSERT_TEMPLATES, ...HOST_INSERT_ITEMS].map((t) => ({
      key: `insert:${t.key}`,
      label: t.label,
      group: '插入',
      keywords: t.keywords,
      icon: INSERT_ICON[t.key] ?? <PlusOutlined />,
    }))
    const inline = INLINE_STYLES.map((s) => ({
      key: `inline:${s.style}`,
      label: s.label,
      group: '行内样式',
      keywords: s.keywords,
      icon: INLINE_ICON[s.style],
    }))
    return [...convert, ...insert, ...inline]
  }, [])

  const slashFiltered = useMemo(() => {
    const q = (slash?.query ?? '').trim().toLowerCase()
    if (!q) return slashItems
    return slashItems.filter((it) => `${it.label} ${it.keywords}`.toLowerCase().includes(q))
  }, [slash?.query, slashItems])

  // Esc / 方向键 / 回车
  useEffect(() => {
    if (!slash) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSlash(null)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashActive((i) => Math.min(i + 1, slashFiltered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashActive((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const hit = slashFiltered[slashActive]
        if (!hit) return
        e.preventDefault()
        e.stopPropagation()
        const block = slash.block
        setSlash(null)
        runAction(block, hit.key)
      }
    }
    // 捕获阶段：抢在 Vditor 自己的按键处理之前
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [slash, slashFiltered, slashActive, runAction])

  const handle = hover ? (
    <div
      style={{
        position: 'absolute',
        top: hover.top,
        left: hover.left,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'flex-start',
        // 手柄纵向堆叠：整体宽度只有 22px，整段落在块左侧留白带内，
        // 不再向右伸到块正文，避免压住 Vditor IR 标题自带的 H1–H5 徽标导致点不到
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => {
        overHandleRef.current = true
      }}
      onMouseLeave={() => {
        overHandleRef.current = false
      }}
    >
      <Dropdown
        open={menuOpen}
        onOpenChange={(v) => setMenuOpen(v)}
        trigger={['click']}
        placement="bottomLeft"
        menu={menu}
        overlayStyle={{ maxHeight: 520, overflowY: 'auto' }}
      >
        <Tooltip title="修改样式 / 插入内容" placement="right">
          <span
            role="button"
            aria-label="段落操作菜单"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 4,
              color: '#8a919f',
              // 光标保持默认箭头：指针形状变化会引起「手柄闪烁」的观感，单击即可弹菜单
              cursor: 'default',
              background: menuOpen ? '#eef1f6' : 'transparent',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = '#eef1f6'
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
            onClick={() => setMenuOpen(true)}
          >
            <HolderOutlined style={{ fontSize: 13 }} />
          </span>
        </Tooltip>
      </Dropdown>
      <Tooltip title="在下方插入" placement="right">
        <span
          role="button"
          aria-label="插入内容"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 4,
            color: '#bfc4cc',
            cursor: 'default',
          }}
          onClick={() => setMenuOpen(true)}
        >
          <PlusOutlined style={{ fontSize: 12 }} />
        </span>
      </Tooltip>
    </div>
  ) : null

  const slashPanel = slash && slashFiltered.length > 0 && (
    <div
      style={{
        position: 'absolute',
        top: slash.top + 26,
        left: slash.left,
        zIndex: 30,
        width: 264,
        maxHeight: 320,
        overflow: 'auto',
        background: '#fff',
        border: '1px solid #e3e6eb',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,.12)',
        padding: 4,
        pointerEvents: 'auto',
      }}
      // 面板本身不该抢走编辑器焦点，否则 Vditor 会以为输入结束
      onMouseDown={(e) => e.preventDefault()}
    >
      <div style={{ padding: '6px 8px', fontSize: 12, color: '#8a919f' }}>
        快捷格式{slash.query ? `：${slash.query}` : '（输入关键词筛选）'}
      </div>
      {slashFiltered.map((it, i) => (
        <div
          key={it.key}
          onMouseEnter={() => setSlashActive(i)}
          onClick={() => {
            const block = slash.block
            setSlash(null)
            runAction(block, it.key)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            background: i === slashActive ? '#f2f5fa' : 'transparent',
          }}
        >
          <span style={{ color: '#6b7280', width: 16, display: 'inline-flex', justifyContent: 'center' }}>
            {it.icon}
          </span>
          <span style={{ flex: 1 }}>{it.label}</span>
          <span style={{ fontSize: 11, color: '#b9bfc9' }}>{it.group}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {handle}
      {slashPanel}
    </div>
  )
}
