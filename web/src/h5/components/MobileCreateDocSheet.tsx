import { useEffect, useState } from 'react'
import { Button, Drawer, Input, Select, message } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { createDoc } from '../../api/docs'
import { buildDirOptions, withRootDir, ROOT_DIR_VALUE } from '../../lib/dirOptions'
import { iconForDocType } from '../../lib/fileIcon'
import { DOC_TYPE_LABEL } from '../../types'
import type { DocNode, DocType } from '../../types'

/**
 * H5 新建文档 / 子目录 菜单 + 表单。
 *
 * 交互：
 *   1) 选类型（底部 Drawer 网格：白板 / 待办清单 / 工作日历 / 图片库 / 子目录），
 *      由 `defaultParentId` 决定默认存放位置（文库根 = 0，或某个目录 id）；
 *   2) 填名称；非目录类还可改「存放位置」（复用桌面 `buildDirOptions` + `withRootDir`）；
 *   3) 创建 → `createDoc(bookId, parentId, title, docType)`，成功后回调 `onCreated`。
 *
 * 调用方（MBookshelf）负责：刷新文档树 + 文档类导航进 `/m/doc/:id`（自动进编辑态），
 * 目录类留在树中展示。
 */
const CREATE_ITEMS: { type: DocType; label: string }[] = [
  { type: 'whiteboard', label: DOC_TYPE_LABEL.whiteboard },
  { type: 'todo', label: DOC_TYPE_LABEL.todo },
  { type: 'calendar', label: DOC_TYPE_LABEL.calendar },
  { type: 'gallery', label: DOC_TYPE_LABEL.gallery },
  { type: 'folder', label: '子目录' },
]

interface Props {
  open: boolean
  bookId: number
  /** 默认存放位置：0 = 文库根，或某目录 id（从目录「+」进入时带入） */
  defaultParentId?: number
  /** 文档树（用于「存放位置」下拉） */
  nodes?: DocNode[]
  onClose: () => void
  onCreated: (docId: number, docType: DocType) => void
}

export default function MobileCreateDocSheet({
  open,
  bookId,
  defaultParentId = ROOT_DIR_VALUE,
  nodes = [],
  onClose,
  onCreated,
}: Props) {
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [docType, setDocType] = useState<DocType | null>(null)
  const [title, setTitle] = useState('')
  const [parentId, setParentId] = useState<number>(defaultParentId)
  const [submitting, setSubmitting] = useState(false)

  // 每次打开重置
  useEffect(() => {
    if (open) {
      setStep('pick')
      setDocType(null)
      setTitle('')
      setParentId(defaultParentId)
    }
  }, [open, defaultParentId])

  function pick(t: DocType) {
    setDocType(t)
    setParentId(defaultParentId) // 目录直接建在触发位置，文档默认定位到触发位置（可改）
    setStep('form')
  }

  async function handleCreate() {
    if (!docType) return
    const name = title.trim()
    if (!name) {
      message.warning('请输入名称')
      return
    }
    setSubmitting(true)
    try {
      const d = await createDoc(bookId, parentId, name, docType, undefined)
      onCreated(d.id, docType)
    } catch {
      /* 拦截器已提示 */
    } finally {
      setSubmitting(false)
    }
  }

  const dirOptions = withRootDir(buildDirOptions(nodes))
  const labelOf = (t: DocType) => CREATE_ITEMS.find((i) => i.type === t)?.label ?? ''

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      height={step === 'pick' ? 320 : 300}
      title={step === 'pick' ? '新建' : `新建${docType === 'folder' ? '子目录' : labelOf(docType as DocType)}`}
      rootClassName="h5-create-drawer"
      destroyOnClose
    >
      {step === 'pick' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, padding: '12px 4px' }}>
          {CREATE_ITEMS.map((it) => {
            const isFolder = it.type === 'folder'
            const spec = isFolder ? null : iconForDocType(it.type)
            return (
              <button
                key={it.type}
                type="button"
                onClick={() => pick(it.type)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 8,
                }}
              >
                <span
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 12,
                    background: '#f2f3f5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color: isFolder ? '#faad14' : spec?.color ?? '#2f54eb',
                  }}
                >
                  {isFolder ? <FolderOutlined /> : spec?.icon}
                </span>
                <span style={{ fontSize: 13, color: '#1f2329' }}>{it.label}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setStep('pick')}
              style={{ border: 'none', background: 'transparent', color: '#2f54eb', fontSize: 13, cursor: 'pointer', padding: 0 }}
            >
              ← 类型
            </button>
            <span style={{ fontSize: 13, color: '#8a919f' }}>{docType === 'folder' ? '子目录' : labelOf(docType as DocType)}</span>
          </div>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={() => void handleCreate()}
            placeholder={docType === 'folder' ? '目录名称' : '文档名称'}
            maxLength={80}
          />
          {docType !== 'folder' && (
            <div>
              <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 6 }}>存放位置</div>
              <Select style={{ width: '100%' }} value={parentId} onChange={(v) => setParentId(v)} options={dirOptions} />
            </div>
          )}
          <Button type="primary" block loading={submitting} onClick={() => void handleCreate()}>
            创建{docType === 'folder' ? '子目录' : ''}
          </Button>
        </div>
      )}
    </Drawer>
  )
}
