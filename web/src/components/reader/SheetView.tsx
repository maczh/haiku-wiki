import x_spreadsheet from 'x-data-spreadsheet'
import 'x-data-spreadsheet/dist/xspreadsheet.css'
import { useEffect, useRef, useState } from 'react'
import { Alert, message } from 'antd'
import { parseSheetJSON, sheetToXData } from '../../lib/sheet'

interface Props {
  /** docs.content（SheetJSON 字符串） */
  content: string
}

/** 只读表格渲染（readonly x-data-spreadsheet，与编辑器同一隔离层） */
export default function SheetView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const [reset, setReset] = useState(false)
  const parsed = parseSheetJSON(content)

  useEffect(() => {
    if (parsed.reset) setReset(true)
    const host = elRef.current
    if (!host) return
    host.innerHTML = ''
    const xs = new x_spreadsheet(host, {
      mode: 'read',
      showToolbar: false,
      showGrid: true,
      showContextmenu: false,
      showBottomBar: false,
      view: {
        height: () => (host.clientHeight || 600) - 4,
        width: () => (host.clientWidth || 900) - 4,
      },
    })
    xs.loadData(sheetToXData(parsed.data))
    return () => {
      try {
        ;(xs as unknown as { destroy?: () => void }).destroy?.()
      } catch {
        /* 部分版本无 destroy，忽略 */
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
