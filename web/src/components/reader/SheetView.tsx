import { useEffect, useRef, useState } from 'react'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, Modal, Input, Button, message } from 'antd'
import { parseSheetJSON, sheetsToLuckysheet, textOfValue } from '../../lib/sheet'
import type { SheetJSON } from '../../lib/sheet'

interface Props {
  /** docs.content（SheetJSON 字符串） */
  content: string
}

/** Luckysheet 只暴露给本文件用到的 API（包内无 TS 类型） */
interface LuckysheetApi {
  create(options: Record<string, unknown>): void
  destroy(): void
  /** 重算网格几何（点击命中的行/列映射依赖它）；滚动/缩放后重新测量以修正错位 */
  refresh(): void
  /** 当前选区（阅读态亦会跟踪）；返回 [{row:[r1,r2], column:[c1,c2], sheetIndex?}, …] */
  getluckysheet_select_save?: () => unknown
  [key: string]: unknown
}

let seq = 0

/** 只读视图的最小估算行数 */
const DEFAULT_ROW_COUNT = 20

/** 列号 0 基 → 字母（0→A, 25→Z, 26→AA） */
function colLabel(c: number): string {
  let s = ''
  let n = c
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** 0 基行列 → 单元格坐标展示，如 (9,0) → "A10" */
function cellRef(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`
}

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
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [reset, setReset] = useState(false)
  const [copyCell, setCopyCell] = useState<{ row: number; col: number; text: string } | null>(null)
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

    // 阅读/分享态双击单元格：打开只读「内容编辑」浮层，可选取部分文字复制为纯文本，
    // 但绝不会写回单元格（allowEdit:false 已禁止落库，这里也只读数）。
    const onCellDblClick = () => {
      const ranges = api.getluckysheet_select_save?.() as
        | Array<{ row: number[]; column: number[]; sheetIndex?: number }>
        | undefined
      if (!ranges || ranges.length === 0) return
      const r0 = ranges[0]
      const row = r0.row?.[0]
      const col = r0.column?.[0]
      if (typeof row !== 'number' || typeof col !== 'number') return
      const sheetIdx = typeof r0.sheetIndex === 'number' ? r0.sheetIndex : 0
      const sheet = parsed.data.sheets?.[sheetIdx] ?? parsed.data.sheets?.[0]
      if (!sheet) return
      const text = textOfValue(sheet.celldata?.find((it) => it.r === row && it.c === col)?.v)
      setCopyCell({ row, col, text })
    }
    box.addEventListener('dblclick', onCellDblClick, true)

    let raf = 0
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    let created = false
    // SPA 内「window load」早已触发，靠它不可靠；用字体就绪 + 尺寸观察 + 两次延时兜底
    // 吸收打开表格文档后上方内容的迟滞回流（字体 / 图片 / 异步渲染），避免双击错位。
    const settleTimers: ReturnType<typeof setTimeout>[] = []
    // 阅读态表格嵌在会纵向滚动的文档流里，且上方常有标题 / 宽度调节器 / 异步渲染的
    // 正文；布局稳定前 Luckysheet 已在 create 时缓存了网格几何（含容器相对文档的纵向偏移）。
    // 之后页面滚动，或上方内容回流（字体加载、图片加载、Markdown 异步渲染、宽度调节器布局），
    // 都会使缓存偏移与实际错位 —— 此刻双击命中整行下移（编辑态网格被固定容器钉住，故无此问题，
    // 双击常偏下约 6 行）。故在「滚动 / 窗口缩放 / 字体就绪 / 页面 load / 容器尺寸变化」等
    // 一切可能改变容器纵向位置的时机，停止变动后 refresh 重新测量，修正点击命中错位。
    const scheduleRefresh = () => {
      if (!created) return
      if (scrollTimer !== null) clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        scrollTimer = null
        try {
          api.refresh()
        } catch {
          /* 个别版本无 refresh，忽略 */
        }
      }, 200)
    }

    raf = requestAnimationFrame(() => {
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
        created = true
        // 创建后立刻再测一次，吸收创建那一帧的布局抖动
        scheduleRefresh()
        // 两次延时兜底：打开文档后上方内容（字体 / 图片 / 异步正文）可能迟滞回流，
        // 使缓存纵向偏移再度错位；停止变动后 refresh 重测，确保双击命中不偏行。
        settleTimers.push(setTimeout(scheduleRefresh, 400))
        settleTimers.push(setTimeout(scheduleRefresh, 1200))
      } catch (e) {
        message.error(`表格渲染失败：${(e as Error)?.message || '未知错误'}`)
      }
    })

    // 监听一切会改变容器纵向偏移的时机
    window.addEventListener('scroll', scheduleRefresh, true)
    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('load', scheduleRefresh) // 图片/字体加载完、上方回流稳定后校正
    // 容器自身尺寸变化（如上方内容回流挤动）即重测
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleRefresh()) : null
    ro?.observe(host)
    // 字体异步加载是上方回流的主因，字体就绪后追加校正
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => scheduleRefresh()).catch(() => undefined)
    }

    return () => {
      cancelAnimationFrame(raf)
      if (scrollTimer !== null) clearTimeout(scrollTimer)
      settleTimers.forEach((t) => clearTimeout(t))
      window.removeEventListener('scroll', scheduleRefresh, true)
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('load', scheduleRefresh)
      ro?.disconnect()
      box.removeEventListener('dblclick', onCellDblClick, true)
      try {
        api.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  /** 复制所选（无选区则复制全部）；纯文本，不回写单元格 */
  const copySelected = () => {
    if (!taRef.current || !copyCell) return
    const ta = taRef.current
    const text =
      ta.selectionStart !== ta.selectionEnd
        ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : ta.value
    if (!text) {
      message.warning('没有可复制的内容')
      return
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => message.success('已复制纯文本到剪贴板'))
        .catch(() => legacyCopy(text))
    } else {
      legacyCopy(text)
    }
  }

  /** 不支持 Clipboard API 时的回退（execCommand） */
  const legacyCopy = (text: string) => {
    try {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.select()
      document.execCommand('copy')
      message.success('已复制纯文本到剪贴板')
    } catch {
      message.warning('复制失败，请手动选择复制')
    }
  }

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

      {copyCell && (
        <Modal
          title={`单元格 ${cellRef(copyCell.row, copyCell.col)} · 复制内容（只读）`}
          open
          onCancel={() => setCopyCell(null)}
          footer={[
            <Button key="copy" type="primary" onClick={copySelected}>
              复制所选
            </Button>,
            <Button key="close" onClick={() => setCopyCell(null)}>
              关闭
            </Button>,
          ]}
        >
          <Input.TextArea
            ref={taRef}
            readOnly
            value={copyCell.text}
            autoSize={{ minRows: 3, maxRows: 14 }}
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace', fontSize: 13 }}
          />
          <div style={{ marginTop: 8, color: '#8a919f', fontSize: 12, lineHeight: 1.7 }}>
            只读模式：可拖动选中其中任意部分文字后点「复制所选」，复制到剪贴板的内容为纯文本（不含表格样式），且不会修改原单元格内容。
          </div>
        </Modal>
      )}
    </div>
  )
}
