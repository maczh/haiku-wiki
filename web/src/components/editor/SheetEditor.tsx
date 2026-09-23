import { useCallback, useEffect, useRef, useState } from 'react'
// ⚠️ 必须排在 `import luckysheet` **之前**（ESM 按声明顺序求值）：拦下 luckysheet 那条
// 「无条件 preventDefault touchmove」的 document 级注册，否则手机上开过一次表格，
// 整个会话其它页面都划不动。见 lib/luckysheetTouchShim.ts。
import '../../lib/luckysheetTouchShim'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, Button, Popover, Space, Tooltip, message } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { luckysheetToSheetJSON, parseSheetJSON, sheetsToLuckysheet, stringifySheet } from '../../lib/sheet'
import type { SheetJSON } from '../../lib/sheet'

interface Props {
  docId: number
  initialContent: string
  title: string
  docType: 'sheet'
}

const SAVE_DEBOUNCE_MS = 3000 // 3s 防抖自动保存（与其余编辑器一致）

/** Luckysheet 容器 id 的自增序列（同一页面可能先后挂载多个实例） */
let seq = 0

/** 类型补全：Luckysheet 未随包提供 TS 类型，这里只声明用到的 API 面 */
interface LuckysheetApi {
  create(options: Record<string, unknown>): void
  destroy(): void
  getAllSheets(): unknown
  [key: string]: unknown
}

/**
 * Luckysheet 表格编辑器（替换原 x-data-spreadsheet，界面与操作仿 Excel）。
 *
 * 隔离层约定（架构文档 I05）：
 *  - 加载/保存各一个转换函数（lib/sheet.ts），对外只暴露稳定 JSON schema；
 *  - 3s 防抖 patchDoc 自动保存 + 手动保存 + SaveIndicator + 版本快照链路；
 *  - 日后更换表格内核只需改本文件与 lib/sheet.ts，不动存储契约。
 *
 * Vite 下的两个注意点：
 *  - luckysheet 的 ESM 产物内部会读 window（含部分依赖全局 `luckysheet` 的分支），
 *    因此创建前把实例挂到 window，保证其内部自引用可用；
 *  - 只引入本地 CSS（核心样式 + iconfont 图标字体）。官方 pluginsCss 里有
 *    //at.alicdn.com 的协议相对外链，离线环境会因字体 404 拖慢首屏，故不引入。
 */
export default function SheetEditor({ docId, initialContent, title, docType }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<LuckysheetApi | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<SheetJSON>(parseSheetJSON(initialContent).data)
  const dirtyRef = useRef(false)
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  // docId 变化时重建表格
  useEffect(() => {
    const { data, reset, migrated } = parseSheetJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置为空表格')
    if (migrated) message.info('表格已升级为新版（Luckysheet），内容与原有数据一致')
    latestRef.current = data
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)
    setInitError(null)

    const host = elRef.current
    if (!host) return
    host.innerHTML = ''
    const containerId = `hk-luckysheet-${docId}-${++seq}`
    const box = document.createElement('div')
    box.id = containerId
    box.style.width = '100%'
    box.style.height = '100%'
    host.appendChild(box)

    const api = luckysheet as unknown as LuckysheetApi
    // 内部若干分支直接引用全局 luckysheet（见文件头说明），先挂上去再 create
    ;(window as unknown as { luckysheet?: unknown }).luckysheet = api
    apiRef.current = api

    /** 内容变更 → 记入内存副本并触发防抖保存 */
    const onChange = () => {
      try {
        latestRef.current = luckysheetToSheetJSON(api.getAllSheets())
      } catch {
        return
      }
      dirtyRef.current = true
      setStatus('editing')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
    }

    try {
      api.create({
        container: containerId,
        lang: 'zh',
        title: '',
        showinfobar: false, // 隐藏顶部标题栏（文档标题由宿主页面管理）
        showtoolbar: true,
        showtoolbarConfig: {
          undoRedo: true,
          paintFormat: true,
          currencyFormat: true,
          percentageFormat: true,
          numberDecrease: true,
          numberIncrease: true,
          moreFormats: true,
          font: true,
          fontSize: true,
          bold: true,
          italic: true,
          strikethrough: true,
          underline: true,
          border: true,
          mergeCell: true,
          horizontalAlignMode: true,
          verticalAlignMode: true,
          textWrapMode: true,
          textRotateMode: true,
          image: true,
          link: true,
          chart: false, // 图表依赖官方 plugins（含外链字体），离线环境不可用
          postil: true,
          pivotTable: false,
          function: true,
          frozenMode: true,
          sortAndFilter: true,
          conditionalFormat: true,
          splitColumn: false,
          screenshot: false,
          findAndReplace: true,
          protection: false,
          print: false,
        },
        showsheetbar: true,
        showsheetbarConfig: {
          add: true,
          menu: true,
          sheet: true,
        },
        showstatisticBar: true,
        showstatisticBarConfig: { count: true, view: true, zoom: true },
        enableAddRow: true,
        enableAddBackTop: true,
        allowEdit: true,
        allowCopy: true,
        sheetFormulaBar: true,
        defaultColWidth: 100,
        defaultRowHeight: 24,
        data: sheetsToLuckysheet(data),
        hook: {
          // 不同版本暴露的钩子略有差异，这里多挂几个：Luckysheet 只调用存在的钩子，
          // 未定义的键会被安全忽略，因此宁可多写也不漏（漏了就丢改动）。
          updated: onChange,
          cellUpdated: onChange,
          rangePasteAfter: onChange,
          sheetAdd: onChange,
          sheetDelete: onChange,
          sheetCopy: onChange,
          sheetMoveAfter: onChange,
          rowInsertAfter: onChange,
          rowDeleteAfter: onChange,
          columnInsertAfter: onChange,
          columnDeleteAfter: onChange,
        },
      })
    } catch (e) {
      const detail = (e as Error)?.message || '未知错误'
      setInitError(detail)
      message.error(`表格组件初始化失败：${detail}`)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current) {
        void patchDoc(docId, { content: stringifySheet(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      try {
        api.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
      apiRef.current = null
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  /**
   * 文字颜色 / 单元格背景色：Luckysheet 自带 textColor/fillColor 下拉在自托管环境（无外链字体、
   * jQuery 菜单样式缺失）下无法弹出取色框，故改为本组件自管取色器。Luckysheet 公共 API
   * setCellFormat(row, column, attr, value) 只写「单个单元格坐标」、不读选区，因此这里遍历
   * 当前选区 luckysheet_select_save 的每一格逐个写入，再 refresh 重绘。
   * attr: 'fc' 字体色 / 'bg' 背景色；color 为空串表示清除。
   */
  const applyCellColor = useCallback((attr: 'fc' | 'bg', color: string) => {
    const api = apiRef.current as (LuckysheetApi & {
      // Luckysheet 真实公共 API：setCellFormat(row, column, attr, value)
      // 操作单个单元格坐标（行、列从 0 起），不读取选区；旧版 (attr,value,op?,sheetIndex?)
      // 的签名在本项目使用的 2.1.13 中并不存在，误用会被内部行/列校验直接早退。
      setCellFormat?: (row: number, column: number, a: string, v: string) => void
      refresh?: () => void
      getluckysheet_select_save?: () => { row: number[]; column: number[] }[]
    }) | null
    if (!api) return
    let ranges: { row: number[]; column: number[] }[] = []
    try {
      ranges = api.getluckysheet_select_save?.() ?? []
    } catch {
      ranges = []
    }
    if (!ranges || ranges.length === 0) {
      message.info('请先选中要设置颜色的单元格')
      return
    }
    // 遍历选区逐格写入：setCellFormat(row, column, attr, value)
    try {
      for (const range of ranges) {
        const [r1, r2] = range.row
        const [c1, c2] = range.column
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            api.setCellFormat?.(r, c, attr, color)
          }
        }
      }
    } catch {
      /* 忽略非法参数 */
    }
    try {
      api.refresh?.()
    } catch {
      /* 忽略 */
    }
    // setCellFormat 不经 Luckysheet 的 updated/cellUpdated 钩子，latestRef 不会自动刷新；
    // 必须在此重新取一次格数据，否则自动保存写回的仍是旧内容（颜色会丢）。
    try {
      latestRef.current = luckysheetToSheetJSON(api.getAllSheets())
    } catch {
      /* 取不到就保留旧副本，至少不崩 */
    }
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }, [])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifySheet(latestRef.current), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部状态条：保存状态 + 手动保存 + 历史版本 */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          borderBottom: '1px solid #ebedf0',
          background: '#fff',
        }}
      >
        <SaveIndicator status={status} savedAt={savedAt} />
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <CellColorButton label="文字颜色" attr="fc" onApply={(c) => applyCellColor('fc', c)} />
          <CellColorButton label="单元格背景色" attr="bg" onApply={(c) => applyCellColor('bg', c)} />
        </Space>
        <Space size={8}>
          <Tooltip title="立即保存（生成手动版本快照）">
            <Button size="small" icon={<SaveOutlined />} onClick={() => void doSave('manual')}>
              保存
            </Button>
          </Tooltip>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            历史版本
          </Button>
        </Space>
      </div>

      {/* Luckysheet 容器：必须给确定高度，否则画布高度为 0 */}
      {initError ? (
        <Alert
          type="error"
          showIcon
          message="表格组件初始化失败"
          description={initError}
          style={{ margin: 24 }}
        />
      ) : (
        <div ref={elRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
      )}

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType={docType}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          // 回滚后重新载入内容
          window.location.reload()
        }}
      />
    </div>
  )
}

/** 取色器预设色板（字体色与背景色共用一套常用色） */
const CELL_SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#b45f06', '#e60000',
  '#ff9900', '#ffff00', '#008a00', '#0066cc', '#9933ff', '#ffffff',
  '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3',
  '#d9d2e9', '#ead1dc', '#ea9999', '#ffd966', '#b6d7a8', '#a2c4c9',
]

/**
 * 单元格颜色按钮：点击弹出取色器（预设色板 + 原生取色器 + 清除），
 * 选中颜色后回调 onApply(color) 写到当前选区。颜色为空串表示清除。
 */
function CellColorButton({
  label,
  attr,
  onApply,
}: {
  label: string
  attr: 'fc' | 'bg'
  onApply: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('#ff0000')
  void attr
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      title={label}
      content={
        <div style={{ width: 232 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {CELL_SWATCHES.map((c) => (
              <div
                key={c}
                title={c}
                onClick={() => {
                  onApply(c)
                  setOpen(false)
                }}
                style={{
                  width: 26,
                  height: 26,
                  background: c,
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: '1px solid #d9d9d9',
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ width: 40, height: 30, padding: 0, border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
            />
            <Button size="small" onClick={() => { onApply(custom); setOpen(false) }}>
              应用
            </Button>
            <Button size="small" type="text" onClick={() => { onApply(''); setOpen(false) }}>
              清除
            </Button>
          </div>
        </div>
      }
    >
      <Button size="small">{label}</Button>
    </Popover>
  )
}
