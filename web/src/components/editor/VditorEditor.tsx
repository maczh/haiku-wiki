import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { Button, Space, Tooltip, message } from 'antd'
import {
  HistoryOutlined, SaveOutlined,
  SyncOutlined, DeleteOutlined, CopyOutlined, ScissorOutlined, AlignLeftOutlined, PlusOutlined, RightOutlined,
  BoldOutlined, ItalicOutlined, StrikethroughOutlined, UnderlineOutlined, CodeOutlined, HighlightOutlined,
  PictureOutlined, TableOutlined, FolderOutlined, TagOutlined, LayoutOutlined, ApartmentOutlined,
  DeploymentUnitOutlined, DatabaseOutlined,
  InsertRowAboveOutlined, InsertRowBelowOutlined, InsertRowLeftOutlined, InsertRowRightOutlined,
  DeleteRowOutlined, DeleteColumnOutlined,
  UnorderedListOutlined, OrderedListOutlined, CheckSquareOutlined,
} from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { fetchTitle, patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'
import {
  resolveContext,
  setBlockType,
  deleteLine,
  insertContent,
  blockText,
  indentBlock,
  applySelectionOp,
  applySelectionOpDom,
  tableOp,
  type CtxState,
  type BlockType,
  type SelectionOp,
  type TableOp,
  type InsertKind,
} from '../../lib/vditorCmds'

// Vditor 样式随本组件一起按需加载（与 MarkdownView 共享同一 CSS chunk）。
import 'vditor/dist/index.css'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（架构文档 §五.1）

// Word HTML 特征（class="MsoNormal"、<o:p>、mso- 样式等）
const WORD_HTML_RE = /class=["']?Mso|<o:p[ >]|urn:schemas-microsoft|mso-/i

// 3s 前端超时兜底：拉标题失败降级为纯链接，不阻塞粘贴
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

/**
 * Vditor IR 模式编辑器（Markdown + 富文本混合）：
 *  - 图片/附件上传钩子 → POST /api/uploads
 *  - 3s 防抖自动保存（source=auto），内容无变化不请求
 *  - 手动保存（source=manual）/ 历史版本抽屉
 *  - 右键上下文菜单：行样式/插入/删除行、选区格式化、表格行列增删
 */

/* ---------------- 右键菜单（Notion 风格：图标 + 分组面板） ---------------- */

/** 15px 线性 SVG 图标容器（antd 没有的字形用内联 SVG 补齐，与截图外观一致） */
function G({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}
const IcoT = (
  <G>
    <path d="M3.5 4h9M8 4v8.5" />
  </G>
)
const IcoQuote = (
  <G>
    <path d="M4.5 3v10" />
    <path d="M7.5 4.5h5M7.5 8h5M7.5 11.5h3" />
  </G>
)
const IcoColumns = (
  <G>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M8 3v10" />
  </G>
)
const IcoToggle = (
  <G>
    <path d="M5 5l3 3-3 3" />
    <path d="M10.5 4.5h3M10.5 8h3M10.5 11.5h3" />
  </G>
)
const IcoCodeblock = (
  <G>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 6.5 5 8l1.5 1.5M9.5 6.5 11 8l-1.5 1.5" />
  </G>
)
const IcoIndentIn = (
  <G>
    <path d="M4 4h10M4 8h10M4 12h10" />
    <path d="M8 6l3 2-3 2" />
  </G>
)
const IcoIndentOut = (
  <G>
    <path d="M4 4h10M4 8h10M4 12h10" />
    <path d="M11 6l-3 2 3 2" />
  </G>
)

/** 菜单项模型：panel 非空表示悬停展开对应二级面板 */
interface CtxItem {
  key: string
  label: string
  icon: ReactNode
  desc?: string
  panel?: 'transform' | 'indent' | 'addbelow'
}

/** 行上下文主菜单（对应截图：转化为/删除/复制/剪切/缩进/在下方添加） */
function lineMenuItems(): CtxItem[] {
  return [
    { key: 'transform', label: '转化为', icon: <SyncOutlined />, panel: 'transform' },
    { key: 'delete', label: '删除', icon: <DeleteOutlined /> },
    { key: 'copy', label: '复制', icon: <CopyOutlined /> },
    { key: 'cut', label: '剪切', icon: <ScissorOutlined /> },
    { key: 'indent', label: '缩进', icon: <AlignLeftOutlined />, panel: 'indent' },
    { key: 'addbelow', label: '在下方添加', icon: <PlusOutlined />, panel: 'addbelow' },
  ]
}

/** 选区上下文菜单 */
function selectionMenuItems(): CtxItem[] {
  return [
    { key: 'bold', label: '加粗', icon: <BoldOutlined /> },
    { key: 'italic', label: '斜体', icon: <ItalicOutlined /> },
    { key: 'strike', label: '删除线', icon: <StrikethroughOutlined /> },
    { key: 'underline', label: '下划线', icon: <UnderlineOutlined /> },
    { key: 'code', label: '行内代码', icon: <CodeOutlined /> },
    { key: 'codeblock', label: '代码块', icon: IcoCodeblock },
  ]
}

/** 表格内上下文菜单 */
function tableMenuItems(): CtxItem[] {
  return [
    { key: 'row-up', label: '在上方插入行', icon: <InsertRowAboveOutlined /> },
    { key: 'row-down', label: '在下方插入行', icon: <InsertRowBelowOutlined /> },
    { key: 'col-left', label: '在左侧插入列', icon: <InsertRowLeftOutlined /> },
    { key: 'col-right', label: '在右侧插入列', icon: <InsertRowRightOutlined /> },
    { key: 'row-del', label: '删除本行', icon: <DeleteRowOutlined /> },
    { key: 'col-del', label: '删除本列', icon: <DeleteColumnOutlined /> },
  ]
}

/* ---------------- 二级面板数据 + 渲染（全自定义 React 浮层，不用 antd Menu） ---------------- */

/** 标题徽标（H1~H6 用文字小标，贴近 Notion 外观） */
function hBadge(n: number) {
  return <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, color: '#5b6168' }}>{'H' + n}</span>
}

/** 转化为面板：样式 + 块 */
const TRANSFORM_SECTIONS: { title: string; items: CtxItem[] }[] = [
  {
    title: '样式',
    items: [
      { key: 'h1', label: '标题 1', icon: hBadge(1) },
      { key: 'h2', label: '标题 2', icon: hBadge(2) },
      { key: 'h3', label: '标题 3', icon: hBadge(3) },
      { key: 'h4', label: '标题 4', icon: hBadge(4) },
      { key: 'h5', label: '标题 5', icon: hBadge(5) },
      { key: 'h6', label: '标题 6', icon: hBadge(6) },
      { key: 'p', label: '正文', icon: IcoT },
    ],
  },
  {
    title: '块',
    items: [
      { key: 'ul', label: '无序列表', icon: <UnorderedListOutlined /> },
      { key: 'ol', label: '有序列表', icon: <OrderedListOutlined /> },
      { key: 'todo', label: '待办列表', icon: <CheckSquareOutlined /> },
      { key: 'code', label: '代码块', icon: IcoCodeblock },
      { key: 'callout', label: '高亮块', icon: <HighlightOutlined /> },
      { key: 'quote', label: '引用', icon: IcoQuote },
      { key: 'columns', label: '分栏', icon: IcoColumns },
      { key: 'toggle', label: '折叠块', icon: IcoToggle },
    ],
  },
]

const INDENT_ITEMS: CtxItem[] = [
  { key: 'indent-in', label: '向右缩进', icon: IcoIndentIn },
  { key: 'indent-out', label: '向左缩进', icon: IcoIndentOut },
]

const ADDBELOW_SECTIONS: { title: string; items: CtxItem[] }[] = [
  {
    title: '基础',
    items: [
      { key: 'image', label: '图片', icon: <PictureOutlined /> },
      { key: 'table', label: '表格', icon: <TableOutlined /> },
      { key: 'attach', label: '附件', icon: <FolderOutlined /> },
      { key: 'status', label: '状态', icon: <TagOutlined /> },
    ],
  },
  {
    title: '画板类',
    items: [
      { key: 'board', label: '画板', icon: <LayoutOutlined /> },
      { key: 'mindmap', label: '思维导图', icon: <ApartmentOutlined /> },
      { key: 'flow', label: '流程图', icon: <DeploymentUnitOutlined /> },
    ],
  },
]

const ADDBELOW_ROW: CtxItem = { key: 'datatable', label: '数据表', icon: <DatabaseOutlined />, desc: '插入一个数据表' }

/** 单个菜单项（图标 + 文字，可选说明） */
function ItemRow({
  item, onPick, onEnter, active,
}: {
  item: CtxItem
  onPick?: (k: string) => void
  onEnter?: () => void
  active?: boolean
}) {
  return (
    <div
      data-ctx-key={item.key}
      className="vd-cm-item"
      onMouseEnter={onEnter}
      onClick={(e) => { e.stopPropagation(); onPick?.(item.key) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
        borderRadius: 4, cursor: 'pointer', fontSize: 13, color: '#1f2329',
        whiteSpace: 'nowrap', userSelect: 'none',
        background: active ? '#f2f3f5' : undefined,
      }}
    >
      <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#5b6168', flexShrink: 0 }}>{item.icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
      {item.desc && <span style={{ color: '#9aa0a6', fontSize: 12 }}>{item.desc}</span>}
    </div>
  )
}

/** 分组面板（标题 + 2 列图标网格） */
function PanelSections({
  sections, onPick,
}: {
  sections: { title: string; items: CtxItem[] }[]
  onPick: (k: string) => void
}) {
  return (
    <div className="vd-cm-panel" style={{ borderLeft: '1px solid #f0f0f0', marginLeft: 6, paddingLeft: 6, minWidth: 190 }}>
      {sections.map((s) => (
        <div key={s.title} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: '#9aa0a6', padding: '4px 10px', fontWeight: 600 }}>{s.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2 }}>
            {s.items.map((it) => (
              <ItemRow key={it.key} item={it} onPick={onPick} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function VditorEditor({ docId, initialContent, title }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const vdRef = useRef<Vditor | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef(initialContent)
  const lastSavedRef = useRef(initialContent)
  const dirtyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  /** 右键上下文菜单状态（null 表示关闭） */
  const [ctx, setCtx] = useState<CtxState | null>(null)
  /** 当前展开的二级面板（null 表示未展开） */
  const [activePanel, setActivePanel] = useState<null | 'transform' | 'indent' | 'addbelow'>(null)
  /** 菜单浮层 DOM（解析下一个右键上下文时需临时隐藏，避免坐标命中浮层） */
  const overlayRef = useRef<HTMLDivElement>(null)

  // docId 变化时重建编辑器
  useEffect(() => {
    latestRef.current = initialContent
    lastSavedRef.current = initialContent
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)

    let disposed = false
    const vd = new Vditor(elRef.current!, {
      mode: 'ir',
      // 自托管 Vditor 静态资源（见 web/scripts/copy-vditor-assets.mjs），避免依赖 unpkg.com
      cdn: '/vditor',
      value: initialContent,
      cache: { enable: false },
      counter: { enable: true },
      height: '100%',
      placeholder: '开始写作…（Markdown 与富文本混合，自动保存已开启）',
      // 工具栏含 Vditor 内置 `preview`（一键浮层预览）：IR 模式下 mermaid 代码块以源码显示，
      // 用浮层预览即可看到真实图形（P0-6）。默认仍保持 mode:'ir'，不做编辑器模式改造。
      toolbar: [
        'headings', 'bold', 'italic', 'strike', '|',
        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
        'quote', 'line', 'code', 'inline-code', 'insert-before', 'insert-after', '|',
        'upload', 'link', 'table', '|',
        'undo', 'redo', '|', 'fullscreen', 'preview', 'edit-mode', 'export',
      ],
      upload: {
        url: '/api/uploads',
        fieldName: 'file',
        max: 20 * 1024 * 1024,
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        // 将后端统一响应转换为 Vditor 期望格式
        format(files: File[], responseText: string) {
          try {
            const res = JSON.parse(responseText)
            if (res.code === 0 && res.data?.url) {
              const succMap: Record<string, string> = {}
              for (const f of files) succMap[f.name] = res.data.url
              return JSON.stringify({ msg: '', code: 0, data: { errFiles: [], succMap } })
            }
          } catch {
            /* fallthrough */
          }
          return JSON.stringify({ msg: '上传失败', code: 1, data: { errFiles: files.map((f) => f.name) } })
        },
      },
      input: (value: string) => {
        latestRef.current = value
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      },
      after: () => {
        if (!disposed) {
          vdRef.current = vd
        }
      },
    })

    // ---------- paste 增强（I08） ----------
    // 1. 纯 URL 粘贴 → fetch-title 生成 [title](url)，失败降级纯链接
    // 2. Word HTML 粘贴 → DOMPurify 清洗 + turndown 转 Markdown
    // 3. 图片粘贴 → 交给 Vditor 内置 upload 钩子（upload.url 已配置）
    // 4. 普通 Markdown/文本粘贴 → Vditor 原生处理
    const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData
      const vd = vdRef.current
      if (!cd || !vd) return
      if (cd.files && cd.files.length > 0) return // 图片/文件走 Vditor upload 钩子
      const text = (cd.getData('text/plain') || '').trim()
      const html = cd.getData('text/html') || ''

      // 纯 URL 粘贴
      if (/^https?:\/\/\S+$/.test(text)) {
        e.preventDefault()
        const placeholder = `[${text}](${text})`
        vd.insertValue(placeholder)
        // 同步本地保存状态（insertValue 不触发 input 回调）
        latestRef.current = vd.getValue()
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
        // 拉取网页标题（3s 超时兜底），成功则替换占位链接
        withTimeout(fetchTitle(text), 3000)
          .then((title) => {
            if (!title) return
            const current = vd.getValue()
            const rich = `[${title}](${text})`
            if (current.includes(placeholder)) {
              vd.setValue(current.replace(placeholder, rich))
              latestRef.current = current.replace(placeholder, rich)
            } else {
              vd.insertValue(rich)
              latestRef.current = vd.getValue()
            }
            dirtyRef.current = true
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
          })
          .catch(() => undefined) // 降级保持 [url](url)
        return
      }

      // Word HTML 粘贴：清洗 → Markdown
      if (html && WORD_HTML_RE.test(html)) {
        e.preventDefault()
        const clean = DOMPurify.sanitize(html, {
          FORBID_TAGS: ['script', 'style', 'iframe', 'meta', 'link', 'object', 'embed'],
          FORBID_ATTR: ['class', 'style', 'id'],
        })
        try {
          const md = turndown.turndown(clean)
          if (md.trim()) vd.insertValue(md)
        } catch {
          // 转换失败保持默认行为：插入原始文本
          if (text) vd.insertValue(text)
        }
        latestRef.current = vd.getValue()
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      }
    }
    elRef.current?.addEventListener('paste', onPaste)

    // ---------- 右键上下文菜单（样式/插入/删除行、选区格式化、表格行列增删） ----------
    // 用捕获阶段拦截，确保早于 Vditor 自带 handler；工具栏/计数区放行原生菜单。
    const onCtx = (e: MouseEvent) => {
      const vd = vdRef.current
      if (!vd) return
      const target = document.elementFromPoint(e.clientX, e.clientY)
      if (target && target.closest('.vditor-toolbar, .vditor-counter')) return
      e.preventDefault()
      e.stopPropagation()
      // 菜单浮层是 position:fixed 且正好盖在鼠标处；若上一次的菜单尚未卸载（React 渲染是异步的），
      // elementFromPoint / caretRangeFromPoint 都会命中浮层 → 上下文被解析成菜单自己。
      // 解析期间先把浮层藏掉，解析完立即还原。
      const overlay = overlayRef.current
      const prevDisplay = overlay?.style.display
      if (overlay) overlay.style.display = 'none'
      const next = resolveContext(vd, e.clientX, e.clientY)
      if (overlay) overlay.style.display = prevDisplay ?? ''
      setActivePanel(null)
      setCtx(next)
    }
    // 点击菜单以外区域即关闭；主菜单与所有二级面板都渲染在同一个 [data-vd-cm] 容器内，
    // 因此面板项上的 mousedown 一律放行 —— 这是修复 Bug B（子菜单点击无效）的根因。
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('[data-vd-cm]')) return
      setCtx(null)
    }
    elRef.current?.addEventListener('contextmenu', onCtx, true)
    document.addEventListener('mousedown', onDocDown)

    return () => {
      disposed = true
      elRef.current?.removeEventListener('paste', onPaste)
      elRef.current?.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('mousedown', onDocDown)
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current !== lastSavedRef.current) {
        void patchDoc(docId, { content: latestRef.current, source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      try {
        vd.destroy()
      } catch {
        /* 已销毁 */
      }
      vdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (latestRef.current === lastSavedRef.current && source === 'auto') return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: latestRef.current, source })
      lastSavedRef.current = latestRef.current
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  /** 内容被程序化改写后同步本地副本并触发自动保存（Vditor 的 setValue 不会触发 input 回调） */
  function markChanged(vd: Vditor) {
    latestRef.current = vd.getValue()
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }

  /** 执行右键菜单项 */
  function runAction(key: string, c: CtxState) {
    const vd = vdRef.current
    if (!vd) return
    if (c.kind === 'selection') {
      const next = applySelectionOp(vd, key as SelectionOp, c.selText ?? '', c.blockIndex)
      if (next !== null) {
        vd.setValue(next)
        markChanged(vd)
      } else {
        // markdown 级改写不可用 → 退回 DOM 执行命令（尽力而为）
        applySelectionOpDom(vd, key as SelectionOp)
        markChanged(vd)
      }
      return
    }
    if (c.kind === 'table') {
      if (!c.td) return
      const next = tableOp(vd, c.td, key as TableOp)
      if (next !== null) {
        vd.setValue(next)
        markChanged(vd)
      }
      return
    }
    // line 上下文：目标是右键那一刻记下的 block 序号
    let next: string | null = null
    switch (key) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'p':
      case 'quote':
      case 'ul':
      case 'ol':
      case 'todo':
      case 'code':
      case 'callout':
      case 'columns':
      case 'toggle':
        next = setBlockType(vd, c.blockIndex, key as BlockType)
        break
      case 'delete':
        next = deleteLine(vd, c.blockIndex)
        break
      case 'indent-in':
      case 'indent-out':
        next = indentBlock(vd, c.blockIndex, key === 'indent-in' ? 'in' : 'out')
        break
      case 'copy':
      case 'cut': {
        const text = blockText(vd, c.blockIndex)
        if (key === 'cut') {
          const cut = deleteLine(vd, c.blockIndex)
          if (cut !== null) {
            vd.setValue(cut)
            markChanged(vd)
          }
        }
        if (text != null) {
          try {
            void navigator.clipboard?.writeText(text)
            message.info(key === 'cut' ? '已剪切到剪贴板' : '已复制到剪贴板')
          } catch {
            message.info(key === 'cut' ? '已剪切' : '已复制')
          }
        }
        return
      }
      case 'image':
      case 'link':
      case 'table':
      case 'attach':
      case 'status':
      case 'board':
      case 'mindmap':
      case 'datatable':
      case 'hr':
      case 'seq':
      case 'flow':
        next = insertContent(vd, key as InsertKind, c.blockIndex)
        break
    }
    if (next !== null) {
      vd.setValue(next)
      markChanged(vd)
    } else if (key === 'image' || key === 'link') {
      // 行内插入直接改了 DOM，未触发 input
      markChanged(vd)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部状态条：保存状态 + 手动保存 + 历史版本 */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          borderBottom: '1px solid #ebedf0',
          background: '#fff',
        }}
      >
        <SaveIndicator status={status} savedAt={savedAt} />
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Tooltip title="立即保存（生成手动版本快照）">
            <Button size="small" icon={<SaveOutlined />} onClick={() => void doSave('manual')}>
              保存
            </Button>
          </Tooltip>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            历史版本
          </Button>
        </Space>
      </div>

      {/* 编辑区：滚动容器承载 Vditor 实例 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        <div style={{ height: '100%', overflow: 'auto' }} ref={elRef} />
      </div>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          // 回滚后重新载入内容
          window.location.reload()
        }}
      />

      {/* 右键上下文菜单浮层：fixed 定位在鼠标处，data-vd-cm 标记使其自身点击不触发关闭。
          主菜单 + 二级面板全部渲染在「同一个」浮层内（不再用 antd Menu 弹到 body），
          面板项的 mousedown 始终落在 [data-vd-cm] 内，onDocDown 自然放行、onClick 可正常命中 —— 修复 Bug B。 */}
      {ctx && (
        <div
          ref={overlayRef}
          data-vd-cm="1"
          style={{
            position: 'fixed',
            left: ctx.x,
            top: ctx.y,
            zIndex: 1200,
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 6px 24px rgba(0,0,0,0.16)',
            padding: 6,
            display: 'flex',
            maxHeight: '80vh',
            overflow: 'auto',
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ctx.kind === 'line' && (
            <>
              <div style={{ minWidth: 184 }}>
                {lineMenuItems().map((it) => (
                  <div
                    key={it.key}
                    data-ctx-key={it.key}
                    className="vd-cm-item"
                    onMouseEnter={() => setActivePanel(it.panel ?? null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (it.panel) setActivePanel(it.panel)
                      else {
                        runAction(it.key, ctx)
                        setCtx(null)
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                      borderRadius: 4, cursor: 'pointer', fontSize: 13, color: '#1f2329',
                      whiteSpace: 'nowrap', userSelect: 'none',
                      background: it.panel && activePanel === it.panel ? '#f2f3f5' : undefined,
                    }}
                  >
                    <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#5b6168', flexShrink: 0 }}>{it.icon}</span>
                    <span style={{ flex: 1 }}>{it.label}</span>
                    {it.panel && <RightOutlined style={{ fontSize: 10, color: '#bbb' }} />}
                  </div>
                ))}
              </div>
              {activePanel === 'transform' && (
                <PanelSections sections={TRANSFORM_SECTIONS} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
              )}
              {activePanel === 'indent' && (
                <div className="vd-cm-panel" style={{ borderLeft: '1px solid #f0f0f0', marginLeft: 6, paddingLeft: 6, minWidth: 150 }}>
                  {INDENT_ITEMS.map((it) => (
                    <ItemRow key={it.key} item={it} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
                  ))}
                </div>
              )}
              {activePanel === 'addbelow' && (
                <div className="vd-cm-panel" style={{ borderLeft: '1px solid #f0f0f0', marginLeft: 6, paddingLeft: 6, minWidth: 200 }}>
                  {ADDBELOW_SECTIONS.map((s) => (
                    <div key={s.title} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: '#9aa0a6', padding: '4px 10px', fontWeight: 600 }}>{s.title}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2 }}>
                        {s.items.map((it) => (
                          <ItemRow key={it.key} item={it} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <ItemRow item={ADDBELOW_ROW} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
                </div>
              )}
            </>
          )}
          {ctx.kind === 'selection' && (
            <div style={{ minWidth: 160 }}>
              {selectionMenuItems().map((it) => (
                <ItemRow key={it.key} item={it} onEnter={() => setActivePanel(null)} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
              ))}
            </div>
          )}
          {ctx.kind === 'table' && (
            <div style={{ minWidth: 200 }}>
              {tableMenuItems().map((it) => (
                <ItemRow key={it.key} item={it} onEnter={() => setActivePanel(null)} onPick={(k) => { runAction(k, ctx); setCtx(null) }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
