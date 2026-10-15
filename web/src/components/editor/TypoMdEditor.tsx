import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { getToken } from '../../api/request'
import {
  MdEditor as TypoMd,
  type EditorApi,
  type ImageUploader,
} from '../../vendor/typo-md-editor/typo-md-editor.js'
// 大纲侧栏用宿主自托管版（vendored 包内的 OutlinePanel 在打包时被 tree-shake 掉，
// 渲染即抛错卸载整棵编辑树，是「编辑态大纲丢失」根因；见 components/OutlinePanel.tsx）。
import OutlinePanel from '../OutlinePanel'
// CSS 顺序铁律（与库 demo/main.tsx 一致）：Crepe 主题基底（prosemirror/reset/block-edit/
// toolbar/table/code-mirror 等 + nord 变量）必须在 vendor style.css（app/mermaid/typora/
// components）之前，typora 才能靠顺序覆盖 Crepe。缺失 Crepe 基底会导致：
// 行首 +/:: 手柄裸按钮化、表格丢边框与行列手柄、代码块语言选择/复制浮钮失样式、
// 「/」新行菜单裸列表（见 2026-10-14 修复记录）。
import '../../vendor/typo-md-editor/crepe-theme.css'
import '../../vendor/typo-md-editor/style.css'
import './typo-md-editor-overrides.css'

// typo-md-editor（v1-react 分支，基于 @milkdown/react + @milkdown/crepe 的 React 组件）。
// 直接作为 React 组件渲染，React 由宿主提供（已 externalize），Vue 随 Crepe 打包进 bundle。
// 组件自身管理 Milkdown 实例生命周期，docId 变化由 BookPage 的 key={doc.id} 触发重挂，
// 与旧 Vue 单例约束无关，每个文档只存在一个 React 实例。

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（架构文档 §五.1）

/**
 * Markdown 编辑器（typo-md-editor React 门面）：
 *  - 图片/附件上传钩子 → POST /api/uploads
 *  - 3s 防抖自动保存（source=auto），内容无变化不请求
 *  - 手动保存（source=manual）/ 历史版本抽屉
 *  - 编辑器外壳占满可用宽度；正文初始 80%，由组件原生手柄调整
 * 编辑交互（工具栏 / 右键菜单 / 图片块 / 代码块「复制」按钮）由 typo-md-editor 原生提供。
 */
export default function TypoMdEditor({ docId, initialContent, title }: Props) {
  const apiRef = useRef<EditorApi | null>(null)
  const latestRef = useRef(initialContent)
  const lastSavedRef = useRef(initialContent)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  // 实时 Markdown（驱动大纲侧栏）；初始播种为 initialContent，每次 onUpdateModelValue 回灌。
  const [markdown, setMarkdown] = useState(initialContent)
  const editorWrapRef = useRef<HTMLDivElement>(null)

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

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (latestRef.current === lastSavedRef.current && source === 'auto') return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: latestRef.current, source })
      lastSavedRef.current = latestRef.current
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      )
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  // docId 变化（BookPage key 重挂）时重置状态。组件本身随 key 重挂，
  // 这里仅在首次挂载时同步初始内容到 ref。
  useEffect(() => {
    latestRef.current = initialContent
    lastSavedRef.current = initialContent
    dirtyRef.current = false
    disposedRef.current = false
    setStatus('editing')
    setSavedAt(null)
    setMarkdown(initialContent)
    return () => {
      disposedRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换/卸载前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current !== lastSavedRef.current) {
        void patchDoc(docId, { content: latestRef.current, source: 'auto' }).catch(() => undefined)
      }
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const handleUpdate = (v: string) => {
    setMarkdown(v)
    latestRef.current = v
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
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

      {/* 编辑器外壳固定 100%，正文宽度由 typo-md-editor 内部调节（初始 80%），
          右侧大纲边栏（OutlinePanel 读取编辑器共享 store 的 outline，点击滚动定位） */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', background: '#fff' }}>
        <div className="hk-typo-editor-host" ref={editorWrapRef} style={{ flex: 1, minWidth: 0, display: 'flex', position: 'relative' }}>
            <TypoMd
              ref={apiRef}
              modelValue={initialContent}
              readonly={false}
              theme="github"
              language="zh-CN"
              contentWidth={80}
              onUpload={uploader}
              onUpdateModelValue={handleUpdate}
              onSave={() => {
                if (timerRef.current) clearTimeout(timerRef.current)
                void doSave('manual')
              }}
              onReady={(api: EditorApi) => {
                apiRef.current = api
              }}
            />
        </div>
        <aside
          style={{
            flexShrink: 0,
            width: 240,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: '#fafbfd',
            borderLeft: '1px solid #ebedf0',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: '10px 12px',
              fontSize: 13,
              fontWeight: 600,
              color: '#8a919f',
              borderBottom: '1px solid #ebedf0',
            }}
          >
            大纲
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
            <OutlinePanel
              markdown={markdown}
              getContainer={() => editorWrapRef.current?.querySelector('.milkdown') ?? null}
            />
          </div>
        </aside>
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
