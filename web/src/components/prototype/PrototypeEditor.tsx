import { useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Modal, Spin, Tag, Upload, message } from 'antd'
import { DeleteOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import type { PrototypeItem } from '../../types'
import { addPrototypeItems, removePrototypeItem, updatePrototypeItem } from '../../api/prototype'
import { parsePrototype } from './PrototypeView'
import './prototype.css'

interface Props {
  docId: number
  content: string
  /** 原型增删改后通知外层刷新 */
  onChanged?: () => void
}

/**
 * 需求原型编辑态：批量上传，但「每个原型都必须有标题、最好有需求描述」。
 *
 * 与图片库的差异就在这里——图片是「看图」，原型是「看需求」：
 * 一张没有说明的原型，两周后没人知道它在表达什么。所以上传后标题默认取文件名，
 * 描述可空但会给提示；能渲染的格式（html/图片）就地展示，专有工程文件保原件下载。
 */
export default function PrototypeEditor({ docId, content, onChanged }: Props) {
  const items: PrototypeItem[] = parsePrototype(content).items
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<PrototypeItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const filesRef = useRef<File[]>([])
  filesRef.current = fileList.map((f) => f.originFileObj as unknown as File).filter(Boolean)

  async function doUpload() {
    const files = filesRef.current
    if (files.length === 0) return
    const titles = files.map((f) => f.name.replace(/\.[^.]+$/, ''))
    const descs = files.map(() => '')
    setUploading(true)
    try {
      const res = await addPrototypeItems(docId, files, titles, descs)
      if (res.rejected?.length) {
        message.warning(
          `${res.rejected.length} 个文件未入库：${res.rejected.map((r) => `${r.name}（${r.reason}）`).join('、')}`,
        )
      }
      if (res.items?.length) {
        message.success(`已添加 ${res.items.length} 个原型（标题默认取文件名，可在列表中修改）`)
      }
      setFileList([])
      onChanged?.()
    } catch {
      /* 拦截器已提示 */
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(it: PrototypeItem) {
    Modal.confirm({
      title: `删除「${it.title}」？`,
      content: '原件与生成的预览图会一并删除，且不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await removePrototypeItem(docId, it.id)
          message.success('已删除')
          onChanged?.()
        } catch {
          /* 拦截器已提示 */
        }
      },
    })
  }

  async function submitEdit() {
    if (!editing) return
    const title = editTitle.trim()
    if (!title) {
      message.warning('标题不能为空')
      return
    }
    try {
      await updatePrototypeItem(docId, editing.id, title, editDesc)
      setEditing(null)
      onChanged?.()
    } catch {
      /* 拦截器已提示 */
    }
  }

  const picked = filesRef.current.length

  return (
    <div className="hk-proto">
      <Upload.Dragger
        multiple
        accept=".rp,.mp,.sketch,.html,.htm,.zip,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp"
        fileList={fileList}
        beforeUpload={() => false}
        onChange={({ fileList: list }) => setFileList(list)}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或把原型文件拖到这里（支持批量）</p>
        <p className="ant-upload-hint">
          支持 Axure（含导出网页包）/ Mockplus(.mp) / Sketch(.sketch) / 单页或打包 HTML / 图片；
          每个原型需填写标题与需求描述
        </p>
      </Upload.Dragger>

      <div className="hk-proto-bar">
        <Button
          type="primary"
          disabled={picked === 0 || uploading}
          loading={uploading}
          onClick={() => void doUpload()}
        >
          {picked > 0 ? `上传 ${picked} 个原型` : '上传'}
        </Button>
        {picked > 0 && (
          <Button onClick={() => setFileList([])} disabled={uploading}>
            清空选择
          </Button>
        )}
        <span className="hk-proto-count">已收录 {items.length} 个原型</span>
        <Alert
          type="info"
          showIcon
          style={{ marginLeft: 'auto', maxWidth: 360 }}
          message="上传后标题默认取文件名，可在列表中随时修改；需求描述请尽快补全。"
        />
      </div>

      {uploading && <Spin style={{ display: 'block', margin: '24px auto' }} tip="正在处理…" />}

      {items.length === 0 && !uploading ? (
        <Empty description="还没有原型，先上传一批吧" style={{ marginTop: 24 }} />
      ) : (
        <div className="hk-proto-list">
          {items.map((it) => (
            <Card key={it.id} size="small" className="hk-proto-row" bordered>
              <Tag color={it.kind === 'html' ? 'blue' : it.kind === 'image' ? 'green' : 'default'}>
                {it.kind === 'html' ? '网页' : it.kind === 'image' ? '图片' : '工程文件'}
              </Tag>
              <div className="hk-proto-row-main">
                <div className="hk-proto-title">
                  {it.title} {it.degraded && <Tag color="orange">仅原件</Tag>}
                </div>
                <div className="hk-proto-desc">{it.desc || '（未填写需求描述）'}</div>
                <div className="hk-proto-sub">
                  {it.filename || it.ext} {it.size > 0 && `· ${it.size} B`}
                </div>
              </div>
              <div className="hk-proto-row-actions">
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(it)
                    setEditTitle(it.title)
                    setEditDesc(it.desc)
                  }}
                >
                  编辑说明
                </Button>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => void handleRemove(it)}>
                  删除
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="编辑需求说明"
        open={!!editing}
        onOk={() => void submitEdit()}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>标题（必填）</div>
          <Input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="原型标题"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, color: '#5f6672' }}>需求描述</div>
          <Input.TextArea
            rows={4}
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="这块原型要表达什么需求？"
          />
        </div>
      </Modal>
    </div>
  )
}
