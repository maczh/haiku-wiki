import { useEffect, useRef, useState } from 'react'
import Vditor from 'vditor'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { Button, Space, Tooltip } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { fetchTitle, patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'

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

    return () => {
      disposed = true
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
    </div>
  )
}
