import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons'
import { parseOfficeRef } from '../../lib/officeDoc'
import { formatSize } from '../../lib/attachment'

// luckysheet 只读组件（SheetView）较重（含 luckysheet 内核 + 触摸 shim + 全局兜底），
// 懒加载：仅当真的打开一个 xlsx 时才拉取该 chunk，不拖累 H5 首屏。
const SheetView = lazy(() => import('./SheetView'))

/**
 * 导入的 Excel（.xlsx/.xls/.csv…）在 H5 阅读/分享态的只读渲染。
 *
 * 这类文档正文是「附件引用」{url,filename,size,ext}（非内联 SheetJSON），旧实现直接降级成
 * FileView 的「该格式暂不支持在线预览 + 下载原文件」卡片（见 pickReader 注释）。本组件把它
 * 真正渲染出来：拉取源文件 → SheetJS 解析成 SheetJSON（lib/sheetFromOffice）→ 交给
 * luckysheet **只读**内核（SheetView）查看，与「新建表格」的阅读体验一致。
 *
 * 失败（网络 / 非电子表格 / 解析异常）时不留白：给出原因并提供原文件下载。
 */
interface Props {
  /** docs.content（office 引用 JSON 字符串） */
  content: string
}

export default function SheetOfficeView({ content }: Props) {
  const ref = useMemo(() => parseOfficeRef(content), [content])
  const [json, setJson] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ref) {
      setLoading(false)
      setError('表格文件信息缺失或格式不正确，无法预览')
      return
    }
    let alive = true
    setLoading(true)
    setError('')
    setJson('')
    ;(async () => {
      const { xlsxToSheetJSON } = await import('../../lib/sheetFromOffice')
      const resp = await fetch(ref.url)
      if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
      const buf = await resp.arrayBuffer()
      const data = await xlsxToSheetJSON(buf, ref.ext)
      if (!alive) return
      setJson(JSON.stringify(data))
    })()
      .catch((e) => {
        if (alive) setError((e as Error)?.message || '表格解析失败，请在桌面版查看或下载原文件')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // ref 由 content useMemo 而来，content 不变时稳定；按 url/ext 依赖更稳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.url, ref?.ext])

  const bar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: '#f7f8fa',
        borderBottom: '1px solid #ebedf0',
      }}
    >
      <FileExcelOutlined style={{ color: '#13c2c2', fontSize: 16, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#1f2329',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ref?.filename || 'Excel 文件'}
        </div>
        <div style={{ color: '#8a919f', fontSize: 11 }}>
          {ref?.ext ? ref.ext.toUpperCase() : '表格'}
          {ref?.size ? ` · ${formatSize(ref.size)}` : ''} · 只读预览
        </div>
      </div>
      {ref && (
        <Button size="small" icon={<DownloadOutlined />} href={ref.url} download={ref.filename} target="_blank">
          下载
        </Button>
      )}
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      {bar}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 16px', color: '#8a919f', fontSize: 13 }}>
          <Spin size="small" /> 正在加载表格…
        </div>
      )}
      {!loading && error && (
        <div style={{ padding: 16 }}>
          <Alert type="warning" showIcon message="表格预览失败" description={error} />
        </div>
      )}
      {!loading && !error && json && (
        <Suspense
          fallback={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '24px 16px', color: '#8a919f', fontSize: 13 }}>
              <Spin size="small" /> 正在渲染表格…
            </div>
          }
        >
          <SheetView content={json} />
        </Suspense>
      )}
    </div>
  )
}
