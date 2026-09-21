import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Tooltip } from 'antd'
import {
  BoldOutlined,
  CodeOutlined,
  BgColorsOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  CheckSquareOutlined,
  FontSizeOutlined,
  MessageOutlined,
  HighlightOutlined,
} from '@ant-design/icons'
import {
  convertBlock,
  detectBlockRange,
  wrapSelection,
  type BlockKind,
  type InlineStyle,
} from '../../../lib/notionBlocks'
import { irBlockIndex } from '../../../lib/irDom'

export interface FormatToolbarProps {
  /** Vditor 挂载的滚动容器，用来定位浮层与判断选区归属 */
  hostRef: RefObject<HTMLDivElement | null>
  /** 取当前 Markdown 全文 */
  getValue: () => string
  /** 写回 Markdown；caretBlock 指定写回后光标落到哪个块 */
  writeValue: (md: string, caretBlock?: number) => void
  /** 编辑器是否已就绪 */
  ready: boolean
}

interface SelState {
  top: number
  left: number
  sBlock: number
  eBlock: number
  selected: string
}

/**
 * 选中文本时的格式浮层（P1-1）：H1–H6 / 加粗 / 列表 / 待办 / 行内代码 / 高亮 / 引用 / 折叠块。
 *
 * 块级格式（标题/引用/列表/待办/代码/高亮块/折叠块）作用于选区覆盖的所有块；
 * 行内格式（加粗/行内代码/高亮）作用于选区文本本身。
 * 所有改动都落到 Markdown 源串并走 writeValue，触发 3s 自动保存，不破坏 Vditor 状态机。
 */
export default function FormatToolbar({ hostRef, getValue, writeValue, ready }: FormatToolbarProps) {
  const [sel, setSel] = useState<SelState | null>(null)
  const selRef = useRef<SelState | null>(null)
  selRef.current = sel

  /** 计算选区覆盖的块与浮层位置 */
  const compute = useCallback(() => {
    const host = hostRef.current
    if (!host || !ready) {
      setSel(null)
      return
    }
    const s = window.getSelection()
    if (!s || s.isCollapsed || s.rangeCount === 0) {
      setSel(null)
      return
    }
    const range = s.getRangeAt(0)
    if (!host.contains(range.commonAncestorContainer)) {
      setSel(null)
      return
    }
    // data-block 的值是静态占位 "0"（见 lib/irDom.ts），必须用文档序索引而非属性值
    const findBlock = (node: Node | null): number => {
      let cur = node instanceof Node ? node : null
      while (cur && cur !== host) {
        if (cur instanceof HTMLElement && cur.hasAttribute('data-block')) {
          return irBlockIndex(host, cur)
        }
        cur = cur.parentNode
      }
      return -1
    }
    const sBlock = findBlock(range.startContainer)
    const eBlock = findBlock(range.endContainer)
    if (sBlock < 0 || eBlock < 0) {
      setSel(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const hr = host.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setSel(null)
      return
    }
    setSel({
      top: rect.top - hr.top - 46,
      left: rect.left - hr.left + rect.width / 2,
      sBlock: Math.min(sBlock, eBlock),
      eBlock: Math.max(sBlock, eBlock),
      selected: s.toString(),
    })
  }, [hostRef, ready])

  // 监听选区变化与滚动（滚动时坐标失效，直接收起）
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ready) return
    const onSel = () => compute()
    const onScroll = () => setSel(null)
    document.addEventListener('selectionchange', onSel)
    host.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('selectionchange', onSel)
      host.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [hostRef, ready, compute])

  /** 块级格式：对选区覆盖的每个块分别转换 */
  const applyBlock = useCallback(
    (kind: BlockKind) => {
      const cur = selRef.current
      if (!cur) return
      const lines = getValue().split('\n')
      // 选区可能跨多行块：按块起点去重，从高索引向低索引处理，避免下标错位
      const ranges = new Map<number, ReturnType<typeof detectBlockRange>>()
      for (let i = cur.sBlock; i <= cur.eBlock; i++) {
        const r = detectBlockRange(lines, i)
        ranges.set(r.start, r)
      }
      const sorted = [...ranges.values()].sort((a, b) => b.start - a.start)
      let next = lines.slice()
      for (const r of sorted) {
        const converted = convertBlock(next, r, kind)
        next = [...next.slice(0, r.start), ...converted, ...next.slice(r.end + 1)]
      }
      writeValue(next.join('\n'), cur.sBlock)
      setSel(null)
      window.getSelection()?.removeAllRanges()
    },
    [getValue, writeValue],
  )

  /** 行内格式：在起始块行中包裹选区文本 */
  const applyInline = useCallback(
    (style: InlineStyle) => {
      const cur = selRef.current
      if (!cur || !cur.selected) return
      const lines = getValue().split('\n')
      const line = lines[cur.sBlock] ?? ''
      const newline = wrapSelection(line, cur.selected, style)
      if (newline === line) {
        setSel(null)
        return
      }
      const next = [...lines.slice(0, cur.sBlock), newline, ...lines.slice(cur.sBlock + 1)]
      writeValue(next.join('\n'), cur.sBlock)
      setSel(null)
      window.getSelection()?.removeAllRanges()
    },
    [getValue, writeValue],
  )

  if (!sel) return null

  const btn = (label: ReactNode, title: string, onClick: () => void, danger = false): ReactElement => (
    <Tooltip title={title} key={title}>
      <span
        role="button"
        aria-label={title}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick()
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 26,
          height: 26,
          padding: '0 5px',
          borderRadius: 4,
          color: danger ? '#cf1322' : '#5f6672',
          cursor: 'pointer',
          fontSize: 13,
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = '#eef1f6'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        {label}
      </span>
    </Tooltip>
  )

  const sep = <span key={`sep`} style={{ width: 1, height: 16, background: '#ebedf0', margin: '0 2px' }} />

  return (
    <div
      style={{
        position: 'absolute',
        top: Math.max(sel.top, 4),
        left: sel.left,
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '3px 4px',
        background: '#fff',
        border: '1px solid #e3e6eb',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,.12)',
        pointerEvents: 'auto',
        maxWidth: '90%',
        flexWrap: 'wrap',
      }}
      // 浮层自身不要抢走编辑器焦点，否则 Vditor 会以为输入结束
      onMouseDown={(e) => e.preventDefault()}
    >
      {(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as BlockKind[]).map((k) =>
        btn(`H${k.slice(1)}`, `标题 ${k.slice(1)}`, () => applyBlock(k)),
      )}
      {sep}
      {btn(<BoldOutlined />, '加粗', () => applyInline('bold'))}
      {btn(<UnorderedListOutlined />, '无序列表', () => applyBlock('ul'))}
      {btn(<OrderedListOutlined />, '有序列表', () => applyBlock('ol'))}
      {btn(<CheckSquareOutlined />, '待办清单', () => applyBlock('task'))}
      {btn(<CodeOutlined />, '行内代码', () => applyInline('code'))}
      {btn(<HighlightOutlined />, '高亮', () => applyInline('mark'))}
      {btn(<MessageOutlined />, '引用', () => applyBlock('quote'))}
      {btn(<FontSizeOutlined style={{ color: '#fa8c16' }} />, '高亮块', () => applyBlock('callout'))}
      {btn(<BgColorsOutlined />, '折叠块', () => applyBlock('details'))}
    </div>
  )
}
