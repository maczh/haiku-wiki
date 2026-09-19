import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Spin, Upload, message } from 'antd'
import { DeleteOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import type { GalleryImage } from '../../types'
import { addGalleryImages, removeGalleryImage, renameGalleryImage, imageConverter } from '../../api/gallery'
import AlbumCard, { humanSize } from './AlbumCard'
import { parseGallery } from './GalleryView'
import type { ImageConverterInfo } from '../../api/gallery'
import './gallery.css'

interface Props {
  docId: number
  content: string
  /** 图片增删后通知外层（刷新目录/版本快照等） */
  onChanged?: () => void
}

/**
 * 图片库编辑态：批量上传 + 相册管理。
 *
 * 上传即转换（后端立刻生成预览图与缩略图），所以这里不需要自己处理尺寸；
 * 界面上真正要操心的是「失败了怎么告诉用户」——批量上传最怕一张坏了全批作废，
 * 因此失败的逐条列出来，成功的照常入册。
 */
export default function GalleryEditor({ docId, content, onChanged }: Props) {
  const images = parseGallery(content).images
  const [uploading, setUploading] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [conv, setConv] = useState<ImageConverterInfo | null>(null)
  const [renaming, setRenaming] = useState<GalleryImage | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // 拖拽区的值在闭包里容易读到旧值，用 ref 兜一份最新文件列表
  const filesRef = useRef<File[]>([])
  filesRef.current = fileList.map((f) => f.originFileObj as unknown as File).filter(Boolean)

  useEffect(() => {
    imageConverter()
      .then(setConv)
      .catch(() => setConv(null))
  }, [])

  async function doUpload(files: File[]) {
    if (files.length === 0) return
    setUploading(true)
    try {
      const res = await addGalleryImages(docId, files)
      if (res.rejected?.length) {
        message.warning(`${res.rejected.length} 个文件未入库：${res.rejected.map((r) => `${r.name}（${r.reason}）`).join('、')}`)
      }
      if (res.images?.length) {
        message.success(`已添加 ${res.images.length} 张图片`)
      }
      setFileList([])
      onChanged?.()
    } catch {
      /* 拦截器已提示 */
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove(img: GalleryImage) {
    Modal.confirm({
      title: `删除「${img.name}」？`,
      content: '原件与生成的预览图会一并删除，且不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await removeGalleryImage(docId, img.id)
          message.success('已删除')
          onChanged?.()
        } catch {
          /* 拦截器已提示 */
        }
      },
    })
  }

  async function submitRename() {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) {
      setRenaming(null)
      return
    }
    try {
      await renameGalleryImage(docId, renaming.id, name)
      setRenaming(null)
      onChanged?.()
    } catch {
      /* 拦截器已提示 */
    }
  }

  // 本机没装转换器时，提前告诉用户哪些格式会「只存原件、没有预览图」
  const missingExternal = !conv?.converter && (conv?.external_format?.length ?? 0) > 0

  return (
    <div className="hk-album">
      <Upload.Dragger
        multiple
        accept={conv?.allowed_ext?.length ? conv.allowed_ext.map((e) => `.${e}`).join(',') : 'image/*'}
        fileList={fileList}
        beforeUpload={() => false}
        onChange={({ fileList: list }) => setFileList(list)}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或把图片拖到这里（支持批量）</p>
        <p className="ant-upload-hint">
          支持 JPG / PNG / GIF / TIFF / WebP / HEIC / SVG / PSD / CDR / AI，上传后自动生成预览图与缩略图
        </p>
      </Upload.Dragger>

      <div className="hk-album-bar">
        <Button
          type="primary"
          disabled={fileList.length === 0 || uploading}
          loading={uploading}
          onClick={() => void doUpload(filesRef.current)}
        >
          {fileList.length > 0 ? `上传 ${filesRef.current.length} 张` : '上传'}
        </Button>
        {fileList.length > 0 && (
          <Button onClick={() => setFileList([])} disabled={uploading}>
            清空选择
          </Button>
        )}
        <span className="hk-album-count">
          已收录 {images.length} 张
          {fileList.length > 0 && `，待上传 ${fileList.length} 个`}
        </span>
      </div>

      {missingExternal && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="服务端未安装图片转换器"
          description={`${conv?.external_format?.join(' / ') ?? 'HEIC/PSD/CDR/AI'} 等格式仍可上传并下载原件，但不会生成预览图（相册里显示为占位卡）。`}
        />
      )}

      {uploading && <Spin style={{ display: 'block', margin: '24px auto' }} tip="正在转换…" />}

      {images.length === 0 && !uploading ? (
        <Empty description="还没有图片，先上传一批吧" style={{ marginTop: 24 }} />
      ) : (
        <div className="hk-album-grid">
          {images.map((img) => (
            <AlbumCard
              key={img.id}
              image={img}
              preview
              actions={
                <>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setRenaming(img)
                      setRenameValue(img.name)
                    }}
                  >
                    改名
                  </Button>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => void handleRemove(img)}>
                    删除
                  </Button>
                  <span style={{ marginLeft: 'auto', color: '#8a919f', fontSize: 12, paddingRight: 4 }}>
                    {humanSize(img.size)}
                  </span>
                </>
              }
            />
          ))}
        </div>
      )}

      <Modal
        title="重命名图片"
        open={!!renaming}
        onOk={() => void submitRename()}
        onCancel={() => setRenaming(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => void submitRename()}
          placeholder="图片名称"
        />
      </Modal>
    </div>
  )
}
