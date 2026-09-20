import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Image, Modal, Segmented, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { GalleryContent, GalleryImage } from '../../types'
import { regenerateGalleryImage } from '../../api/gallery'
import AlbumCard from './AlbumCard'
import './gallery.css'

interface Props {
  content: string
  /** 文档 id：阅读态「重新生成」需要它来调用后端；分享页等无 docId 时不显示该按钮 */
  docId?: number
}

/** 解析正文；坏 JSON / 空串都当空相册处理，不让一篇坏数据把页面打白 */
export function parseGallery(content: string): GalleryContent {
  if (!content || !content.trim()) return { version: 1, images: [] }
  try {
    const obj = JSON.parse(content) as GalleryContent
    return { version: obj?.version ?? 1, images: Array.isArray(obj?.images) ? obj.images : [] }
  } catch {
    return { version: 1, images: [] }
  }
}

type SizeMode = 'preview' | 'thumb' | 'original'

/**
 * 图片库阅读态：一本电子相册。
 *
 * 网格用缩略图（400），点开自定义灯箱：支持屏宽/缩略图/原尺寸三档切换 + 重新生成。
 * 直接把几十 MB 的原图塞进网格会把浏览器拖死，这是三层尺寸存在的意义。
 */
export default function GalleryView({ content, docId }: Props) {
  const [images, setImages] = useState<GalleryImage[]>(() => parseGallery(content).images)
  useEffect(() => {
    setImages(parseGallery(content).images)
  }, [content])
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null)

  const degraded = images.filter((i) => i.degraded)

  return (
    <div className="hk-album">
      <div className="hk-album-bar">
        <span className="hk-album-count">共 {images.length} 张图片</span>
      </div>
      {degraded.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${degraded.length} 张图片未能生成预览图`}
          description="服务端缺少对应的图片转换器（如 HEIC/PSD/CDR/AI 需要 ImageMagick）。原件已保存，可直接下载查看。"
        />
      )}
      <div className="hk-album-grid">
        {images.map((img) => (
          // 关闭 antd 默认灯箱（preview=false），点击卡片用自定义 GalleryLightbox
          <AlbumCard key={img.id} image={img} preview={false} onClick={() => setLightbox(img)} />
        ))}
      </div>
      {lightbox && (
        <GalleryLightbox
          image={lightbox}
          docId={docId}
          onUpdate={(updated) =>
            setImages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
          }
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

interface LightboxProps {
  image: GalleryImage
  docId?: number
  onUpdate: (img: GalleryImage) => void
  onClose: () => void
}

/** 自定义灯箱：大图 + 三档尺寸切换 + 重新生成。 */
function GalleryLightbox({ image, docId, onUpdate, onClose }: LightboxProps) {
  const [current, setCurrent] = useState<GalleryImage>(image)
  const [sizeMode, setSizeMode] = useState<SizeMode>('preview')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setCurrent(image)
    setSizeMode('preview')
  }, [image])

  const src = useMemo(() => {
    if (sizeMode === 'preview') return current.preview || current.url
    if (sizeMode === 'thumb') return current.thumb || current.preview || current.url
    // 原尺寸：优先 original（图片格式即原图 url），回退到原图 url
    return current.original || current.url
  }, [current, sizeMode])

  async function handleRegenerate() {
    if (!docId) return
    setLoading(true)
    try {
      const { image: updated } = await regenerateGalleryImage(docId, current.id)
      setCurrent(updated)
      onUpdate(updated)
      message.success('已重新生成预览图')
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open title={current.name} footer={null} onCancel={onClose} width="80%" destroyOnClose>
      {current.degraded ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#8a919f' }}>
          该图片未能生成预览图（{current.note || '缺少图片转换器'}），可下载原件查看。
        </div>
      ) : (
        <>
          <Segmented
            options={[
              { label: '屏宽', value: 'preview' },
              { label: '缩略图', value: 'thumb' },
              { label: '原尺寸', value: 'original' },
            ]}
            value={sizeMode}
            onChange={(v) => setSizeMode(v as SizeMode)}
            style={{ marginBottom: 12 }}
          />
          <Image src={src} alt={current.name} style={{ maxWidth: '100%' }} />
        </>
      )}
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {current.note && !current.degraded && (
          <span style={{ color: '#8a919f', fontSize: 12 }}>{current.note}</span>
        )}
        {docId && (
          <Button icon={<ReloadOutlined />} loading={loading} onClick={handleRegenerate}>
            重新生成
          </Button>
        )}
      </div>
    </Modal>
  )
}
