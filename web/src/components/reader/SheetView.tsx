import { useEffect, useRef, useState } from 'react'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, message } from 'antd'
import { parseSheetJSON, sheetsToLuckysheet } from '../../lib/sheet'
import type { SheetJSON } from '../../lib/sheet'

interface Props {
  /** docs.content（SheetJSON 字符串） */
  content: string
}

/** Luckysheet 只暴露给本文件用到的 API（包内无 TS 类型） */
interface LuckysheetApi {
  create(options: Record<string, unknown>): void
  destroy(): void
  [key: string]: unknown
}

let seq = 0

/** 只读视图的最小估算行数 */
const DEFAULT_ROW_COUNT = 20

/** 解析一次并缓存（content 未变时不重复解析） */
function useParsed(content: string): { data: SheetJSON; reset: boolean; migrated: boolean } {
  const [state, setState] = useState(() => parseSheetJSON(content))
  useEffect(() => {
    setState(parseSheetJSON(content))
  }, [content])
  return state
}

/**
 * 只读表格渲染（Luckysheet 只读模式，与编辑器同一内核与同一份隔离层，
 * 保证「编辑态所见即阅读态所得」）。
 */
export default function SheetView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const [reset, setReset] = useState(false)
  const parsed = useParsed(content)

  useEffect(() => {
    if (parsed.reset) setReset(true)
    const host = elRef.current
    if (!host) return
    host.innerHTML = ''
    const containerId = `hk-luckysheet-view-${++seq}`
    const box = document.createElement('div')
    box.id = containerId
    box.style.width = '100%'
    // Luckysheet 需要确定高度：按首表行数估算，落在 360~1400px 之间，
    // 超高时靠 Luckysheet 自身滚动，不撑爆外层阅读容器。
    const first = parsed.data.sheets?.[0]
    const rows = Math.max(DEFAULT_ROW_COUNT, ...(parsed.data.sheets ?? []).map((s) => s.row ?? 0))
    box.style.height = `${Math.min(1400, Math.max(360, (first?.celldata?.length ? rows : 20) * 24 + 120))}px`
    host.appendChild(box)

    const api = luckysheet as unknown as LuckysheetApi
    ;(window as unknown as { luckysheet?: unknown }).luckysheet = api
    try {
      api.create({
        container: containerId,
        lang: 'zh',
        title: '',
        showinfobar: false,
        showtoolbar: false,
        showsheetbar: true, // 多工作表时仍可切换查看
        showsheetbarConfig: { add: false, menu: false, sheet: true },
        showstatisticBar: false,
        sheetFormulaBar: false,
        allowEdit: false,
        allowCopy: true,
        enableAddRow: false,
        enableAddBackTop: false,
        defaultColWidth: 100,
        defaultRowHeight: 24,
        data: sheetsToLuckysheet(parsed.data),
      })
    } catch (e) {
      message.error(`表格渲染失败：${(e as Error)?.message || '未知错误'}`)
    }
    return () => {
      try {
        api.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  return (
    <div>
      {reset && (
        <Alert
          type="warning"
          showIcon
          message="内容格式异常，已重置为空表格"
          style={{ margin: 12 }}
          closable
          onClose={() => {
            setReset(false)
            message.info('提示已关闭')
          }}
        />
      )}
      <div ref={elRef} style={{ width: '100%', minHeight: 360 }} />
    </div>
  )
}
