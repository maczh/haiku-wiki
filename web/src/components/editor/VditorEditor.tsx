import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { Button, Menu, Space, Tooltip, message } from 'antd'
import type { MenuProps } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
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

/** 按上下文构造右键菜单项 */
function buildMenuItems(c: CtxState): MenuProps['items'] {
  if (c.kind === 'selection') {
    return [
      { key: 'bold', label: '加粗' },
      { key: 'italic', label: '斜体' },
      { key: 'strike', label: '删除线' },
      { key: 'underline', label: '下划线' },
      { key: 'code', label: '行内代码' },
      { key: 'codeblock', label: '代码块' },
    ]
  }
  if (c.kind === 'table') {
    return [
      { key: 'row-up', label: '在上方插入行' },
      { key: 'row-down', label: '在下方插入行' },
      { key: 'col-left', label: '在左侧插入列' },
      { key: 'col-right', label: '在右侧插入列' },
      { key: 'row-del', label: '删除本行' },
      { key: 'col-del', label: '删除本列' },
    ]
  }
  return [
    {
      key: 'transform',
      label: '转化为',
      children: [
        { key: 'h1', label: '标题 1' },
        { key: 'h2', label: '标题 2' },
        { key: 'h3', label: '标题 3' },
        { key: 'h4', label: '标题 4' },
        { key: 'h5', label: '标题 5' },
        { key: 'h6', label: '标题 6' },
        { key: 'p', label: '正文' },
        { key: 'ul', label: '无序列表' },
        { key: 'ol', label: '有序列表' },
        { key: 'todo', label: '待办' },
        { key: 'code', label: '代码' },
        { key: 'callout', label: '高亮块' },
        { key: 'quote', label: '引用' },
        { key: 'columns', label: '分栏' },
        { key: 'toggle', label: '折叠块' },
      ],
    },
    { key: 'delete', label: '删除' },
    { key: 'copy', label: '复制' },
    { key: 'cut', label: '剪切' },
    {
      key: 'indent',
      label: '缩进',
      children: [
        { key: 'indent-in', label: '增加缩进' },
        { key: 'indent-out', label: '减少缩进' },
      ],
    },
    {
      key: 'addbelow',
      label: '在下方添加',
      children: [
        {
          key: 'add-basic',
          label: '基础',
          children: [
            { key: 'image', label: '图片' },
            { key: 'table', label: '表格' },
            { key: 'attach', label: '附件' },
            { key: 'status', label: '状态' },
          ],
        },
        {
          key: 'add-canvas',
          label: '画板类',
          children: [
            { key: 'board', label: '画板' },
            { key: 'mindmap', label: '思维导图' },
            { key: 'flow', label: '流程图' },
          ],
        },
        { key: 'datatable', label: '数据表' },
      ],
    },
  ]
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
      setCtx(next)
    }
    // 点击菜单以外区域即关闭（菜单自身 mousedown 不关闭，保证 onClick 能命中）。
    // 关键：antd Menu 的子菜单弹层默认渲染到 document.body（.ant-menu-submenu-popup），
    // 不在 data-vd-cm 浮层内 —— 真实用户悬停子菜单、mousedown 先落在 body 弹层上，
    // 若此处直接 setCtx(null) 卸载菜单，click 永远命中不到子菜单项的 onClick（Bug B）。
    // 因此浮层内（data-vd-cm）或子菜单弹层内（.ant-menu-submenu-popup）一律放行；
    // 并配合下方 Menu 的 getPopupContainer 把子菜单弹层渲染进浮层，从根上消除该路径。
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('[data-vd-cm]')) return
      if (t.closest('.ant-menu-submenu-popup')) return
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

      {/* 右键上下文菜单浮层：fixed 定位在鼠标处，data-vd-cm 标记使其自身点击不触发关闭 */}
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
            borderRadius: 6,
            boxShadow: '0 3px 14px rgba(0,0,0,0.18)',
            padding: 4,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Menu
            mode="vertical"
            selectable={false}
            style={{ border: 'none', minWidth: 180 }}
            items={buildMenuItems(ctx)}
            // 子菜单弹层默认渲染到 body，会落到浮层（data-vd-cm）之外；
            // 指定到触发节点的父元素（即浮层内部）后，子菜单项点击的 mousedown 也在浮层内，
            // onDocDown 自然放行，onClick 可正常命中（修复 Bug B 的根因）。
            getPopupContainer={(t) => t.parentElement as HTMLElement}
            onClick={({ key }) => {
              runAction(key, ctx)
              setCtx(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
