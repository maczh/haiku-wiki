import { useCallback, useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { Button, Form, Input, Modal, Space, Tooltip, Upload, message } from 'antd'
import { HistoryOutlined, InboxOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import NotionEditing, { type NotionEditingProps } from './notion/NotionEditing'
import FormatToolbar from './notion/FormatToolbar'
import { irBlocks } from '../../lib/irDom'
import { fetchTitle, patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'
import { uploadWithDedup } from '../../lib/uploadFlow'

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
 */
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
  const [ready, setReady] = useState(false)

  // ---------- Notion 风格行菜单：宿主侧需要实现的三个动作 ----------
  const pickerRef = useRef<HTMLInputElement | null>(null)
  /** 等待文件选择完成的插入请求 */
  const pendingPickRef = useRef<{
    kind: 'image' | 'attachment'
    line: number
    stripped: string
    replace: (replacement: string[], caretBlock: number) => void
  } | null>(null)
  /** 链接插入：需要用户先填 URL 与文字 */
  const [linkCtx, setLinkCtx] = useState<{
    line: number
    stripped: string
    replace: (replacement: string[], caretBlock: number) => void
  } | null>(null)
  const [linkForm] = Form.useForm<{ url: string; text: string }>()

  /** 读取 Markdown 全文（经 ref，引用稳定） */
  const getValue = useCallback((): string => vdRef.current?.getValue() ?? latestRef.current, [])

  /** 把光标放到第 block 个块的末尾（配合整篇写回后继续输入） */
  const focusBlock = useCallback((block: number) => {
    const host = elRef.current
    const vd = vdRef.current
    if (!host || !vd) return
    // data-block 的值是静态占位 "0"（见 lib/irDom.ts），按值查询只会命中第一个块，必须按文档序取
    const el = irBlocks(host)[block]
    if (!el) return
    vd.focus()
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [])

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
          setReady(true)
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

    return () => {
      disposed = true
      setReady(false)
      elRef.current?.removeEventListener('paste', onPaste)
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

  /** 整篇写回 Markdown，并（可选）把光标落到第 caretBlock 个块 */
  const writeValue = useCallback(
    (md: string, caretBlock?: number) => {
      const vd = vdRef.current
      if (!vd) return
      vd.setValue(md)
      latestRef.current = md
      dirtyRef.current = true
      setStatus('editing')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      if (typeof caretBlock === 'number') {
        window.setTimeout(() => focusBlock(caretBlock), 0)
      }
    },
    [focusBlock, doSave],
  )

  // ---------- Notion 风格：图片 / 附件 / 链接 三个需要宿主处理的插入 ----------
  const onHostInsert = useCallback<NotionEditingProps['onHostInsert']>(
    (key, ctx) => {
      if (key === 'link') {
        linkForm.setFieldsValue({ url: '', text: ctx.stripped || '' })
        setLinkCtx({ line: ctx.line, stripped: ctx.stripped, replace: ctx.replace })
        return
      }
      // image / attachment：触发隐藏文件选择框
      pendingPickRef.current = { kind: key, line: ctx.line, stripped: ctx.stripped, replace: ctx.replace }
      pickerRef.current?.click()
    },
    [linkForm],
  )

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一文件
    const ctx = pendingPickRef.current
    pendingPickRef.current = null
    if (!file || !ctx) return
    try {
      // 走秒传链路：内容已存在时不重复传输字节，直接拿 URL 插入（降级由 uploadFlow 内部保证）
      const res = await uploadWithDedup(file)
      const url = (res as { url?: string }).url ?? ''
      if (!url) throw new Error('no url')
      const label = ctx.stripped.trim() || file.name
      const replacement = ctx.kind === 'image' ? `![${label}](${url})` : `[${label}](${url})`
      ctx.replace([replacement], ctx.line)
    } catch {
      message.error('上传失败，请重试')
    }
  }, [])

  const onLinkOk = useCallback(async () => {
    const v = await linkForm.validateFields()
    const ctx = linkCtx
    if (!ctx) return
    const text = (v.text || '').trim() || v.url
    ctx.replace([`[${text}](${v.url})`], ctx.line)
    setLinkCtx(null)
  }, [linkForm, linkCtx])

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

      {/* 编辑区：相对定位容器（不滚动），让 Notion 手柄/菜单叠加层覆盖可见区域而不随内容滚动 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        <div style={{ height: '100%', overflow: 'auto' }} ref={elRef} />
        <NotionEditing
          hostRef={elRef}
          getValue={getValue}
          writeValue={writeValue}
          onHostInsert={onHostInsert}
          ready={ready}
        />
        <FormatToolbar hostRef={elRef} getValue={getValue} writeValue={writeValue} ready={ready} />
      </div>

      {/* 隐藏文件选择框：图片 / 附件插入 */}
      <input
        ref={pickerRef}
        type="file"
        style={{ display: 'none' }}
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt"
        onChange={onPickFile}
      />

      {/* 链接插入弹窗 */}
      <Modal
        open={!!linkCtx}
        title="插入链接"
        okText="插入"
        cancelText="取消"
        onOk={onLinkOk}
        onCancel={() => setLinkCtx(null)}
        destroyOnClose
      >
        <Form form={linkForm} layout="vertical" initialValues={{ url: '', text: '' }}>
          <Form.Item
            name="url"
            label="链接地址"
            rules={[{ required: true, message: '请输入链接地址' }, { type: 'url', message: '链接格式不正确' }]}
          >
            <Input placeholder="https://" />
          </Form.Item>
          <Form.Item name="text" label="显示文字（留空则用地址）">
            <Input placeholder="显示文字" />
          </Form.Item>
        </Form>
      </Modal>

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
    </div>
  )
}
