import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, Button, Empty, Input, Modal, Popconfirm, Segmented, Space, Spin, Switch, Tag, Tooltip, message } from 'antd'
import {
  CloseOutlined,
  DeleteOutlined,
  EyeOutlined,
  MessageOutlined,
  PictureOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useCommentPanel } from '../../lib/commentPanel'
import * as api from '../../api/comment'
import type { CommentNode, CommentScope } from '../../api/comment'
import request from '../../api/request'

const MarkdownView = lazy(() => import('./MarkdownView'))

const SCOPE_OPTIONS = [
  { label: '所有者', value: 'owner' },
  { label: '团队成员', value: 'team' },
  { label: '登录用户', value: 'login' },
  { label: '所有人', value: 'all' },
]

interface Props {
  docId?: number
  slug?: string
  /** 是否为分享访客（免登录）场景 */
  anon?: boolean
  /** 文档级分享密码（仅 DocSharePage 有，书级分享无） */
  password?: string
}

export default function CommentPanel({ docId, slug, anon, password }: Props) {
  const { open, width, toggle, setWidth } = useCommentPanel()
  const [comments, setComments] = useState<CommentNode[]>([])
  const [canModerate, setCanModerate] = useState(false)
  const [allowPost, setAllowPost] = useState<CommentScope>('all')
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [guestName, setGuestName] = useState('')
  const [preview, setPreview] = useState(false)
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<{ allow_view: CommentScope; allow_post: CommentScope; locked: boolean; banned_uids: number[] }>({
    allow_view: 'all',
    allow_post: 'all',
    locked: false,
    banned_uids: [],
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const validDoc = !!docId && docId > 0
  const canPost = !locked && (anon ? allowPost === 'all' : true)

  const load = useCallback(async () => {
    if (!validDoc) {
      setComments([])
      return
    }
    setLoading(true)
    try {
      const res = anon && slug ? await api.listCommentsAnon(slug, docId!, password) : await api.listComments(docId!)
      setComments(res.comments)
      setCanModerate(res.can_moderate)
      setAllowPost(res.allow_post as CommentScope)
      setLocked(res.locked)
    } catch {
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [validDoc, anon, slug, docId, password])

  useEffect(() => {
    if (open && validDoc) void load()
  }, [open, validDoc, load])

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startX - ev.clientX // 向左拖 → 变宽
      setWidth(dragRef.current.startW + delta)
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const uploadAuthed = async (file: File): Promise<{ url: string }> => {
    const form = new FormData()
    form.append('file', file)
    return request.post('/uploads', form) as Promise<{ url: string }>
  }

  const uploadImage = async (file: File) => {
    try {
      const res = anon && slug ? await api.uploadCommentImageAnon(slug, docId!, file, password) : await uploadAuthed(file)
      setDraft((d) => `${d}\n![](${res.url})\n`)
      message.success('图片已插入')
    } catch (e: any) {
      message.error(e?.message || '上传失败')
    }
  }

  const send = async () => {
    const body = draft.trim()
    if (!body) {
      message.warning('内容不能为空')
      return
    }
    setPosting(true)
    try {
      if (anon && slug) await api.createCommentAnon(slug, docId!, body, replyTo?.id ?? 0, guestName.trim() || undefined, password)
      else await api.createComment(docId!, body, replyTo?.id ?? 0, anon ? guestName.trim() || undefined : undefined)
      setDraft('')
      setReplyTo(null)
      setPreview(false)
      await load()
    } catch (e: any) {
      message.error(e?.message || '发送失败')
    } finally {
      setPosting(false)
    }
  }

  const onDelete = async (cid: number) => {
    try {
      await api.deleteComment(docId!, cid)
      message.success('已删除')
      await load()
    } catch (e: any) {
      message.error(e?.message || '删除失败')
    }
  }

  const onBan = async (cid: number) => {
    try {
      await api.banAuthor(docId!, cid)
      message.success('已禁言该用户')
      await load()
    } catch (e: any) {
      message.error(e?.message || '操作失败')
    }
  }

  const openSettings = async () => {
    try {
      const s = await api.getCommentSettings(docId!)
      setSettings({ allow_view: s.allow_view as CommentScope, allow_post: s.allow_post as CommentScope, locked: s.locked, banned_uids: s.banned_uids ?? [] })
      setSettingsOpen(true)
    } catch (e: any) {
      message.error(e?.message || '无法读取设置')
    }
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      await api.updateCommentSettings(docId!, settings)
      setSettingsOpen(false)
      message.success('已保存')
      await load()
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSavingSettings(false)
    }
  }

  const panelWidth = open ? width : 36

  // 收起态：右侧细条，点击展开
  if (!open) {
    return (
      <aside style={{ width: panelWidth, flexShrink: 0, borderLeft: '1px solid #ebedf0', background: '#fafbfc', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', height: '100%' }}>
        <button
          onClick={toggle}
          title="展开点评讨论区"
          style={{ marginTop: 80, background: '#fff', border: '1px solid #ebedf0', borderRadius: 6, padding: '10px 4px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#5f6672' }}
        >
          <MessageOutlined />
          <span style={{ writingMode: 'vertical-rl', letterSpacing: 2 }}>点评</span>
        </button>
      </aside>
    )
  }

  const canReply = canPost

  const renderNode = (node: CommentNode, depth: number): React.ReactNode => {
    const isDeleted = node.status === 'deleted'
    const name = isDeleted ? '已删除' : node.author_name || node.guest_name || '匿名访客'
    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? 14 : 0, borderLeft: depth > 0 ? '2px solid #f0f2f5' : 'none', paddingLeft: depth > 0 ? 8 : 0, marginTop: depth > 0 ? 8 : 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Avatar size={28} style={{ flexShrink: 0, background: isDeleted ? '#bfbfbf' : '#2f54eb' }}>
            {(name || '匿').slice(0, 1)}
          </Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#8a919f' }}>
              {name}
              {node.author_uid > 0 && !isDeleted && (
                <Tag bordered={false} color="blue" style={{ marginLeft: 6 }}>
                  用户
                </Tag>
              )}
            </div>
            {isDeleted ? (
              <div style={{ color: '#bfbfbf', fontSize: 13, padding: '4px 0' }}>[该帖已被删除]</div>
            ) : (
              <>
                <div style={{ fontSize: 14, marginTop: 2, wordBreak: 'break-word' }}>
                  <Suspense fallback={<span />}>
                    <MarkdownView content={node.body} />
                  </Suspense>
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#bfbfbf' }}>{new Date(node.created_at).toLocaleString('zh-CN')}</span>
                  {canReply && (
                    <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setReplyTo({ id: node.id, name })}>
                      回复
                    </Button>
                  )}
                  {canModerate && (
                    <>
                      <Popconfirm title="删除该帖？" onConfirm={() => onDelete(node.id)}>
                        <Button type="link" size="small" danger style={{ padding: 0, height: 'auto' }} icon={<DeleteOutlined />}>
                          删帖
                        </Button>
                      </Popconfirm>
                      {node.author_uid > 0 && (
                        <Popconfirm title={`禁言用户 #${node.author_uid}？`} onConfirm={() => onBan(node.id)}>
                          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} icon={<StopOutlined />}>
                            禁言
                          </Button>
                        </Popconfirm>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {node.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <aside
      style={{
        width: panelWidth,
        flexShrink: 0,
        borderLeft: '1px solid #ebedf0',
        background: '#fafbfc',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={onResizeStart}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 5, background: 'transparent' }}
        title="拖拽调整宽度"
      />
      {/* 头部 */}
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 8px 0 14px', borderBottom: '1px solid #ebedf0', gap: 6 }}>
        <MessageOutlined />
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>点评讨论区</span>
        {canModerate && (
          <Tooltip title="设置">
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={openSettings} />
          </Tooltip>
        )}
        <Tooltip title="收起">
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={toggle} />
        </Tooltip>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {!validDoc && <Empty description="请选择文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {validDoc && loading && (
          <div style={{ textAlign: 'center', marginTop: 40 }}>
            <Spin />
          </div>
        )}
        {validDoc && !loading && comments.length === 0 && <Empty description="暂无点评" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {validDoc && !loading && comments.map((n) => renderNode(n, 0))}
      </div>

      {/* 发帖区 */}
      {validDoc && (
        <div style={{ borderTop: '1px solid #ebedf0', padding: 8, flexShrink: 0 }}>
          {replyTo && (
            <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 4 }}>
              回复 {replyTo.name}{' '}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setReplyTo(null)}>
                取消
              </Button>
            </div>
          )}
          {anon && (
            <Input
              size="small"
              placeholder="昵称（留空为「匿名访客」）"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              style={{ marginBottom: 6 }}
            />
          )}
          {preview ? (
            <div style={{ minHeight: 48, border: '1px solid #ebedf0', borderRadius: 6, padding: 8, background: '#fff', marginBottom: 6, maxHeight: 220, overflow: 'auto' }}>
              <Suspense fallback={<span />}>
                <MarkdownView content={draft} />
              </Suspense>
            </div>
          ) : (
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={canPost ? '支持 Markdown，可插入图片' : '当前不可发帖'}
              disabled={!canPost}
              style={{ marginBottom: 6 }}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadImage(f)
                e.target.value = ''
              }}
            />
            <Button size="small" icon={<PictureOutlined />} onClick={() => fileRef.current?.click()} disabled={!canPost}>
              图片
            </Button>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setPreview((p) => !p)}>
              预览
            </Button>
            <div style={{ flex: 1 }} />
            <Button size="small" type="primary" icon={<SendOutlined />} loading={posting} onClick={send} disabled={!canPost}>
              发送
            </Button>
          </div>
          {!canPost && locked && <div style={{ fontSize: 12, color: '#faad14', marginTop: 4 }}>本文点评区已禁言</div>}
          {anon && allowPost !== 'all' && <div style={{ fontSize: 12, color: '#faad14', marginTop: 4 }}>该文档不允许匿名访客发帖</div>}
        </div>
      )}

      {/* 设置弹窗（管理者） */}
      <Modal title="点评区设置" open={settingsOpen} onCancel={() => setSettingsOpen(false)} onOk={saveSettings} confirmLoading={savingSettings} destroyOnClose>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>谁可以看帖</div>
          <Segmented
            options={SCOPE_OPTIONS}
            value={settings.allow_view}
            onChange={(v) => setSettings({ ...settings, allow_view: v as CommentScope })}
            block
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>谁可以发帖</div>
          <Segmented
            options={SCOPE_OPTIONS}
            value={settings.allow_post}
            onChange={(v) => setSettings({ ...settings, allow_post: v as CommentScope })}
            block
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Switch checked={settings.locked} onChange={(v) => setSettings({ ...settings, locked: v })} />
          <span>全局禁言（禁止发新帖）</span>
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>已禁言用户</div>
          <Space wrap>
            {settings.banned_uids.length === 0 && <span style={{ color: '#bfbfbf' }}>无</span>}
            {settings.banned_uids.map((id) => (
              <Tag
                key={id}
                closable
                onClose={() => setSettings({ ...settings, banned_uids: settings.banned_uids.filter((x) => x !== id) })}
              >
                #{id}
              </Tag>
            ))}
          </Space>
        </div>
      </Modal>
    </aside>
  )
}
