import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'
import {
  MdEditor as TypoMd,
  createApp,
  ensurePinia,
  typoPlugin,
  type EditorApi,
  type ImageUploader,
} from '../../vendor/typo-md-editor/typo-md-editor.js'
import '../../vendor/typo-md-editor/style.css'

// typo-md-editor（Vue3 / Milkdown 内核）作为自包含 ES bundle 引入，宿主用 createApp 挂载。
// 注意：库的 composables 是模块级单例，同一页面只允许存在一个 MdEditor 实例；
// 本项目每个文档路由只渲染一个编辑器（docId 变化即 key 重挂），满足该约束。

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（架构文档 §五.1）

/**
 * Markdown 编辑器（typo-md-editor 门面）：
 *  - 图片/附件上传钩子 → POST /api/uploads
 *  - 3s 防抖自动保存（source=auto），内容无变化不请求
 *  - 手动保存（source=manual）/ 历史版本抽屉
 * 编辑交互（工具栏 / 右键菜单 / 图片块 / 代码块「复制」按钮）由 typo-md-editor 原生提供。
 */
export default function TypoMdEditor({ docId, initialContent, title }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<unknown>(null)
  const apiRef = useRef<EditorApi | null>(null)
  const latestRef = useRef(initialContent)
  const lastSavedRef = useRef(initialContent)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)

  // 图片上传：与旧 Vditor 上传口径一致（multipart + Bearer）
  const uploader = useRef<ImageUploader>(async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      body: form,
    })
    const data = await res.json().catch(() => ({}) as Record<string, unknown>)
    const url = (data as { code?: number; data?: { url?: string } })?.data?.url
    if ((data as { code?: number })?.code === 0 && url) return url
    throw new Error('上传失败')
  }).current

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    latestRef.current = initialContent
    lastSavedRef.current = initialContent
    dirtyRef.current = false
    disposedRef.current = false
    setStatus('editing')
    setSavedAt(null)

    ensurePinia()
    const app = createApp(TypoMd, {
      modelValue: initialContent,
      readonly: false,
      theme: 'github',
      language: 'zh-CN',
      onUpload: uploader,
      'onUpdate:modelValue': (v: string) => {
        latestRef.current = v
        dirtyRef.current = true
        setStatus('editing')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
      },
      onSave: () => {
        if (timerRef.current) clearTimeout(timerRef.current)
        void doSave('manual')
      },
      onReady: (api: EditorApi) => {
        apiRef.current = api
      },
    })
    app.use(typoPlugin)
    app.mount(host)
    appRef.current = app

    return () => {
      disposedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current !== lastSavedRef.current) {
        void patchDoc(docId, { content: latestRef.current, source: 'auto' }).catch(() => undefined)
      }
      try {
        app.unmount()
      } catch {
        /* 已销毁 */
      }
      appRef.current = null
      apiRef.current = null
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

      {/* 编辑区：typo-md-editor 挂载点 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        <div style={{ height: '100%' }} ref={hostRef} />
      </div>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          window.location.reload()
        }}
      />
    </div>
  )
}
