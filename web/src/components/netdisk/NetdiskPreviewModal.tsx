/**
 * 网盘文件预览弹窗（PRD §4.6）。
 *
 * 按 `lib/netdisk/preview.ts` 的判定分发：
 *   reader → 文库渲染器（再 lazy 三个子视图，避免 pdf.js 等进网盘页 chunk）
 *   image  → <img>
 *   video / audio → 原生 <video> / <audio>（带 token URL）
 *   text   → <pre>
 *
 * 底部固定「下载」「导入到文库」（后者仅导入白名单内可用）。
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import { DownloadOutlined, ImportOutlined } from '@ant-design/icons'
import LazyBoundary from '../common/LazyBoundary'
import { netdiskPreviewKind, previewUnsupportedReason } from '../../lib/netdisk/preview'
import { isNetdiskImportable, netdiskImportReason } from '../../lib/netdisk/format'
import { extOfName } from '../../lib/import/formats'
import { makePreviewToken, previewUrl } from '../../api/netdisk'
import type { NetdiskEntry } from '../../types'

const NetdiskReaderView = lazy(() => import('./NetdiskReaderView'))
const NetdiskVideoView = lazy(() => import('./NetdiskVideoView'))
const NetdiskTextView = lazy(() => import('./NetdiskTextView'))

interface Props {
  open: boolean
  connId: number
  entry: NetdiskEntry | null
  onClose: () => void
  onDownload: (entry: NetdiskEntry) => void
  onImport: (entry: NetdiskEntry) => void
}

export default function NetdiskPreviewModal({ open, connId, entry, onClose, onDownload, onImport }: Props) {
  const kind = useMemo(() => (entry ? netdiskPreviewKind(entry.name) : 'unsupported'), [entry])
  const importable = useMemo(
    () => (entry ? isNetdiskImportable(entry.name) : false),
    [entry],
  )
  const [imgSrc, setImgSrc] = useState('')

  // 图片也要 token（<img> 同样发不出 Authorization）
  useEffect(() => {
    if (kind !== 'image' || !entry || !open) return
    let alive = true
    void makePreviewToken(connId, entry.path).then(({ token }) => {
      if (alive) setImgSrc(previewUrl(connId, entry.path, token))
    })
    return () => {
      alive = false
    }
  }, [kind, entry, connId, open])

  if (!entry) return null

  return (
    <Modal
      open={open}
      title={entry.name}
      onCancel={onClose}
      width="80vw"
      style={{ top: 24 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span />
          <span style={{ display: 'flex', gap: 8 }}>
            <Button icon={<DownloadOutlined />} onClick={() => onDownload(entry)}>
              下载
            </Button>
            <Button
              type="primary"
              icon={<ImportOutlined />}
              disabled={!importable}
              title={importable ? undefined : netdiskImportReason(entry.name)}
              onClick={() => onImport(entry)}
            >
              导入到文库
            </Button>
          </span>
        </div>
      }
      destroyOnClose
    >
      <div className="hk-nd-preview-body">
        {kind === 'reader' && (
          <LazyBoundary tip="正在加载预览器…" fill>
            <Suspense fallback={<Spin />}>
              <NetdiskReaderView connId={connId} entry={entry} />
            </Suspense>
          </LazyBoundary>
        )}
        {kind === 'image' && (
          <img className="hk-nd-preview-image" src={imgSrc} alt={entry.name} />
        )}
        {(kind === 'video' || kind === 'audio') && (
          <LazyBoundary tip="正在加载播放器…" fill>
            <Suspense fallback={<Spin />}>
              <NetdiskVideoView connId={connId} entry={entry} mode={kind} />
            </Suspense>
          </LazyBoundary>
        )}
        {kind === 'text' && (
          <LazyBoundary tip="正在读取文件…" fill>
            <Suspense fallback={<Spin />}>
              <NetdiskTextView connId={connId} entry={entry} />
            </Suspense>
          </LazyBoundary>
        )}
        {kind === 'unsupported' && <Alert type="warning" showIcon message={previewUnsupportedReason(entry.name)} />}
      </div>
    </Modal>
  )
}
