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

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type WheelEvent } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import { DownloadOutlined, ImportOutlined } from '@ant-design/icons'
import LazyBoundary from '../common/LazyBoundary'
import ErrorBoundary from '../common/ErrorBoundary'
import { isPreviewSupported, netdiskPreviewKind, previewUnsupportedReason } from '../../lib/netdisk/preview'
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
  entries?: NetdiskEntry[]
  onClose: () => void
  onNavigate?: (entry: NetdiskEntry) => void
  onDownload: (entry: NetdiskEntry) => void
  onImport: (entry: NetdiskEntry) => void
}

export default function NetdiskPreviewModal({ open, connId, entry, entries = [], onClose, onNavigate, onDownload, onImport }: Props) {
  const kind = useMemo(() => (entry ? netdiskPreviewKind(entry.name) : 'unsupported'), [entry])
  const importable = useMemo(
    () => (entry ? isNetdiskImportable(entry.name) : false),
    [entry],
  )
  const [imgSrc, setImgSrc] = useState('')
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    if (open) setZoom(1)
  }, [open, entry?.path])

  function handlePreviewWheel(e: WheelEvent<HTMLDivElement>) {
    if (!e.altKey) return
    e.preventDefault()
    setZoom((value) => Math.min(2.5, Math.max(0.5, value - e.deltaY * 0.002)))
  }

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

  useEffect(() => {
    if (!open) {
      const cleanup = window.requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>('body > .docx-editor, body > [data-docx-dialog]').forEach((node) => {
          if (!node.closest('.hk-nd-preview-modal')) node.remove()
        })
      })
      return () => window.cancelAnimationFrame(cleanup)
    }
  }, [open])

  useEffect(() => {
    if (!open || !entry || entries.length < 2) return
    const currentEntry = entry
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      const candidates = entries.filter((item) => !item.is_dir && isPreviewSupported(item.name))
      const index = candidates.findIndex((item) => item.path === currentEntry.path)
      if (index < 0 || candidates.length < 2) return
      e.preventDefault()
      const next = e.key === 'ArrowRight'
        ? candidates[(index + 1) % candidates.length]
        : candidates[(index - 1 + candidates.length) % candidates.length]
      onNavigate?.(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, entry, entries, onNavigate])

  if (!entry) return null

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12, fontWeight: 400, whiteSpace: 'nowrap' }}>
            (ALT+滚轮缩放)
          </span>
        </span>
      }
      onCancel={onClose}
      width="80vw"
      style={{ top: 24 }}
      className="hk-nd-preview-modal"
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
      destroyOnHidden
    >
      <ErrorBoundary
        fallback={(error, reset) => (
          <Alert
            type="error"
            showIcon
            message="文件预览失败"
            description={error.message || '渲染器发生异常'}
            action={<Button size="small" onClick={reset}>重试</Button>}
          />
        )}
      >
        <div
          className="hk-nd-preview-body"
          onWheel={handlePreviewWheel}
          style={{ '--hk-nd-preview-zoom': zoom } as CSSProperties}
        >
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
            <NetdiskVideoView connId={connId} entry={entry} mode={kind} />
          </LazyBoundary>
        )}
        {kind === 'text' && (
          <LazyBoundary tip="正在读取文件…" fill>
            <NetdiskTextView connId={connId} entry={entry} />
          </LazyBoundary>
        )}
        {kind === 'unsupported' && <Alert type="warning" showIcon message={previewUnsupportedReason(entry.name)} />}
        </div>
      </ErrorBoundary>
    </Modal>
  )
}
