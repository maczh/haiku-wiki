/**
 * 预览弹窗：文库可渲染类型（pdf/docx/xlsx/pptx/vsd/vsdx/md/html/txt/drawio/
 * excalidraw/km/mm/xmind 等）。
 *
 * 分发：
 *   - 'file'（pdf/docx/xlsx/pptx/vsd/vsdx）→ 文库 FileView，content 为标准
 *     FileAttachment JSON（FileView 自己 fetch URL）。
 *   - 'mindmap'（km/mm/xmind）→ 先取字节，经后端 /api/mindmap/parse 转成内置
 *     smm，再交给 DocContent 的思维导图画布。
 *   - 文本型（md/html/txt/drawio/excalidraw）→ 取回正文后交给对应渲染器。
 *
 * ⚠️ 本组件会被 `React.lazy` 包裹后才进弹窗，因此这里 import DocContent /
 * parseMindmapFile 不会拖大入口 chunk。
 *
 * 健壮性（针对「白屏菊花无限转」）：
 *   - ErrorBoundary 捕获子渲染器（pdf.js / Office / 思维导图）运行期异常；
 *   - 加载看门狗：超过 READER_STALL_MS 仍未就绪 → 明确的「超时」提示 + 重试 / 下载；
 *   - 重试会重置错误边界与重新拉取（nonce 自增），避免一次失败永久白屏。
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import DocContent from '../reader/DocContent'
import ErrorBoundary from '../common/ErrorBoundary'
import {
  fetchNetdiskBlob,
  fetchNetdiskText,
  makePreviewToken,
  readerPreviewUrl,
  downloadUrl,
} from '../../api/netdisk'
import { parseMindmapFile } from '../../api/mindmap'
import { readXlsx } from '../../lib/office/fortune'
import { netdiskPreviewDocType } from '../../lib/netdisk/preview'
import type { NetdiskEntry } from '../../types'
import NetdiskMarkdownView from './NetdiskMarkdownView'
import NetdiskDocxView from './NetdiskDocxView'
import MarkdownView from '../reader/MarkdownView'

/** 加载超过该时长（ms）仍未就绪，给出超时提示（而非无限菊花） */
const READER_STALL_MS = 60_000

interface Props {
  connId: number
  entry: NetdiskEntry
}

export default function NetdiskReaderView({ connId, entry }: Props) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [stalled, setStalled] = useState(false)
  // 自增以强制重新拉取 + 重新挂载错误边界（重试用）
  const [nonce, setNonce] = useState(0)
  const docType = netdiskPreviewDocType(entry.name)
  const isMarkdown = /\.(md|markdown)$/i.test(entry.name)
  const isDocx = /\.docx$/i.test(entry.name)

  // 拉取正文 / 附件引用
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setStalled(false)
    setContent('')
    ;(async () => {
      try {
        if (docType === 'file') {
          const ext = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
          if (ext === 'docx') {
            if (alive) setContent('docx')
          } else if (ext === 'xls') {
            // 旧版 Excel 是 BIFF 二进制格式，先用轻量 XLS/XLSX 读取层转换为
            // 文库统一的 Fortune Sheet JSON，再复用现有表格预览器。
            const blob = await fetchNetdiskBlob(connId, entry.path)
            const workbook = await readXlsx(await blob.arrayBuffer())
            if (alive) setContent(JSON.stringify({ schema: 'haiku.sheet/1', workbook }))
          } else {
            const ref = await readerPreviewUrl(connId, entry)
            if (alive) setContent(JSON.stringify(ref))
          }
        } else if (docType === 'mindmap') {
          // 思维导图：先拿到原始字节，交给后端统一解析成内置 smm
          const blob = await fetchNetdiskBlob(connId, entry.path)
          const file = new File([blob], entry.name, { type: blob.type || 'application/octet-stream' })
          const res = await parseMindmapFile(file)
          if (alive) setContent(res.content)
        } else if (docType) {
          const text = await fetchNetdiskText(connId, entry.path)
          if (alive) setContent(text)
        } else {
          setError('该类型暂不支持预览')
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '预览加载失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, entry.path, docType, nonce])

  // 加载看门狗：超过 READER_STALL_MS 仍 loading → 标记 stalled（渲染明确的超时提示）
  useEffect(() => {
    if (!loading) {
      setStalled(false)
      return
    }
    const t = setTimeout(() => setStalled(true), READER_STALL_MS)
    return () => clearTimeout(t)
  }, [loading, nonce])

  const reload = () => {
    setError('')
    setStalled(false)
    setNonce((n) => n + 1)
  }

  const downloadOriginal = async () => {
    try {
      const { token } = await makePreviewToken(connId, entry.path)
      const url = downloadUrl(connId, entry.path, token)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    } catch {
      // 忽略：下载失败由浏览器自身表现
    }
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="预览加载失败"
        description={error}
        action={
          <Button size="small" onClick={reload}>
            重试
          </Button>
        }
        style={{ margin: 24 }}
      />
    )
  }

  if (stalled && loading) {
    return (
      <Alert
        type="warning"
        showIcon
        message="预览加载较慢或已超时"
        description="若长时间无反应，可重试或下载原文件后用本地软件打开。"
        action={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button size="small" onClick={reload}>
              重试
            </Button>
            <Button size="small" onClick={() => void downloadOriginal()}>
              下载原文件
            </Button>
          </span>
        }
        style={{ margin: 24 }}
      />
    )
  }

  if (!docType) {
    return <Alert type="warning" showIcon message="该类型暂不支持预览" style={{ margin: 24 }} />
  }

  return (
    <Spin spinning={loading}>
      <div style={{ minHeight: 240 }}>
        {isDocx ? (
          <NetdiskDocxView connId={connId} entry={entry} />
        ) : content ? isMarkdown ? (
          /```(?:mermaid|erdiagram|flowchart|sequenceDiagram|classDiagram|stateDiagram)/i.test(content)
            ? <MarkdownView content={content} />
            : <NetdiskMarkdownView content={content} />
        ) : (
          <ErrorBoundary
            key={nonce}
            fallback={(err, reset) => (
              <Alert
                type="error"
                showIcon
                message="内容渲染失败"
                description={err.message || '解析或渲染过程中出错'}
                action={
                  <span style={{ display: 'inline-flex', gap: 8 }}>
                    <Button size="small" onClick={reset}>
                      重试
                    </Button>
                    <Button size="small" onClick={() => void downloadOriginal()}>
                      下载原文件
                    </Button>
                  </span>
                }
                style={{ margin: 24 }}
              />
            )}
          >
            <DocContent docType={docType} content={content} widthEditable={false} />
          </ErrorBoundary>
        ) : (
          !loading && <Alert type="info" showIcon message="文件内容为空" style={{ margin: 24 }} />
        )}
      </div>
    </Spin>
  )
}
