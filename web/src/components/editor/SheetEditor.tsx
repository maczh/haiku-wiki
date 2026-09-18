import { useEffect, useRef, useState } from 'react'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, Button, Space, Tooltip, message } from 'antd'
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
          textColor: true,
          fillColor: true,
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
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

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
