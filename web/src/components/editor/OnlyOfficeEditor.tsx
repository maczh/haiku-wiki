import { useCallback, useEffect, useRef, useState } from 'react'
import {
  OnlyOfficeManager,
  ONLYOFFICE_ID,
  ONLYOFFICE_CONTAINER_CONFIG,
  FILE_TYPE,
} from '../onlyoffice-web-comp'
import { Alert, Button, Space, Spin, Tooltip, message } from 'antd'
import { HistoryOutlined, SaveOutlined } from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import { patchDoc } from '../../api/docs'
import { uploadFile } from '../../api/uploads'
import {
  extForDocType,
  fileTypeForDocType,
  isLegacySheetContent,
  officeRefFromUpload,
  parseOfficeRef,
} from '../../lib/officeDoc'
import type { OfficeDocType } from '../../lib/officeDoc'

interface Props {
  docId: number
  docType: OfficeDocType
  initialContent: string
  title: string
  canWrite: boolean
}

/**
 * 把旧版 luckysheet「表格」正文（{version,sheets:[{name,celldata}]}）就地转成 xlsx Blob，
 * 让 OnlyOffice 能加载编辑，避免切到 OnlyOffice 后旧数据丢失。
 * 仅取单元格值（v 优先，缺失回退 m 显示串），不还原样式/合并等富格式——以数据可延续为首要目标。
 */
async function legacySheetToXlsxBlob(content: string): Promise<Blob> {
  const mod = await import('exceljs/dist/exceljs.min')
  const ExcelJS = ((mod as unknown as { default?: unknown }).default ?? mod) as {
    Workbook: new () => {
      addWorksheet: (name: string) => {
        getCell: (r: number, c: number) => { value: unknown }
      }
      xlsx: { writeBuffer: () => Promise<ArrayBuffer> }
    }
  }
  const data = JSON.parse(content) as {
    sheets?: Array<{ name?: string; celldata?: Array<{ r: number; c: number; v?: unknown; m?: string }> }>
  }
  const wb = new ExcelJS.Workbook()
  const sheets = Array.isArray(data.sheets) ? data.sheets : []
  if (sheets.length === 0) wb.addWorksheet('Sheet1')
  for (const sh of sheets) {
    const ws = wb.addWorksheet((sh.name && String(sh.name).trim()) || 'Sheet1')
    const cells = Array.isArray(sh.celldata) ? sh.celldata : []
    for (const cell of cells) {
      const row = (cell.r ?? 0) + 1
      const col = (cell.c ?? 0) + 1
      let val: unknown = cell.v
      // luckysheet 单元格值可能是 {v,m,ct} 对象，取其中原始值 v
      if (val && typeof val === 'object' && 'v' in (val as object)) {
        val = (val as { v?: unknown }).v
      }
      if (val === undefined || val === null || val === '') {
        val = cell.m ?? ''
      }
      if (val !== '' && val !== undefined && val !== null) {
        ws.getCell(row, col).value = val
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const SAVE_DEBOUNCE_MS = 3000 // 与 Vditor / SheetEditor 一致的 3s 防抖自动保存

/**
 * OnlyOffice Web Comp 编辑器（Excel/Word/PPT）。
 *
 * 关键约束（见架构说明）：
 *  - 纯前端编辑，不连接 OnlyOffice Document Server；SDK / x2t 静态资源由本站托管于
 *    web/public/packages（见 const/index.ts 默认地址 /packages/onlyoffice/9.4.0-develop）。
 *  - 存储复用现有 Go 后端：二进制经 /uploads（含 CAS 秒传）落盘，正文只存引用
 *    { url, filename, size, ext }（与 file 型附件同构），因此阅读态可直接复用 FileView。
 *  - 新建空白文档用 OnlyOfficeManager.create；打开已有文档用 createWithFile（fetch 二进制 → File）。
 *  - 自动保存：监听 asc_onDocumentModifiedChanged → 3s 防抖 exportAsBlob → uploadFile → patchDoc。
 */
export default function OnlyOfficeEditor({ docId, docType, initialContent, title, canWrite }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<OnlyOfficeManager | null>(null)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canWriteRef = useRef(canWrite)
  canWriteRef.current = canWrite
  const titleRef = useRef(title)
  titleRef.current = title

  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const doSave = useCallback(
    async (source: 'auto' | 'manual') => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const manager = managerRef.current
      if (!manager || !canWriteRef.current) return
      setStatus('saving')
      try {
        const { blob, fileName: exportedName } = await manager.exportAsBlob()
        // 防御：落库文件名的扩展名必须与 docType 一致。若编辑器内部状态异常
        // （如竞态残留的默认 "New Document.docx"），以 docType 兜底重命名，
        // 否则下次打开 OnlyOffice 会按扩展名选错编辑器并报「内容与扩展名不一致」。
        const ext = extForDocType(docType)
        const safeName = (titleRef.current || '未命名')
          .replace(/[\\/:*?"<>|]/g, '_')
          .slice(0, 80)
        const fileName =
          exportedName && exportedName.toLowerCase().endsWith(`.${ext}`)
            ? exportedName
            : `${safeName}.${ext}`
        const file = new File([blob], fileName, { type: blob.type || undefined })
        const res = await uploadFile(file)
        await patchDoc(docId, {
          content: JSON.stringify(officeRefFromUpload(res, extForDocType(docType), fileName)),
          source,
        })
        dirtyRef.current = false
        const now = new Date()
        setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
        setStatus('saved')
      } catch (e) {
        console.error('[OnlyOffice] save failed', e)
        setStatus('editing')
        message.error('保存失败，请重试')
      }
    },
    [docId, docType],
  )

  const scheduleSave = useCallback(() => {
    if (!canWriteRef.current) return
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }, [doSave])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined
    const ext = extForDocType(docType)
    const fileType = fileTypeForDocType(docType)
    const safe = (title || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
    const defaultFileName = `${safe}.${ext}`

    ;(async () => {
      try {
        // 引用里的文件名扩展名可能与 docType 不一致（历史脏数据 / 异常导出产物）。
        // 一律以 docType 为准，否则 OnlyOffice 按扩展名选错编辑器（Word UI 打开 xlsx）。
        const healName = (name: string) =>
          name && name.toLowerCase().endsWith(`.${ext}`) ? name : defaultFileName

        const mount = async (): Promise<OnlyOfficeManager> => {
          const ref = parseOfficeRef(initialContent)
          if (ref) {
            const resp = await fetch(ref.url)
            if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
            const blob = await resp.blob()
            // 拿到的必须是二进制原文件。若落成 HTML（典型：原文件已被清理，/uploads 404
            // 被兜底成 index.html）或空文件，x2t 转换只会报「Unexpected token / 文件损坏」
            // 这种看不出原因的错，这里提前给出可行动的提示。
            const ct = (resp.headers.get('content-type') || '').toLowerCase()
            if (blob.size === 0 || ct.includes('text/html')) {
              throw new Error('原文件不存在或已被清理（正文里只留了引用），请删除本文档后重新导入')
            }
            const file = new File([blob], healName(ref.filename), { type: blob.type || undefined })
            return OnlyOfficeManager.createWithFile(
              { containerId: ONLYOFFICE_ID, fileType, defaultFileName, readOnly: !canWriteRef.current },
              file,
            )
          }
          if (isLegacySheetContent(initialContent)) {
            // 旧 luckysheet「表格」：先转成 xlsx 再交给 OnlyOffice 加载编辑，避免数据丢失
            const blob = await legacySheetToXlsxBlob(initialContent)
            const file = new File([blob], defaultFileName, {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            })
            return OnlyOfficeManager.createWithFile(
              { containerId: ONLYOFFICE_ID, fileType, defaultFileName, readOnly: !canWriteRef.current },
              file,
            )
          }
          return OnlyOfficeManager.create({
            containerId: ONLYOFFICE_ID,
            fileType,
            defaultFileName,
            readOnly: !canWriteRef.current,
          })
        }

        // 并发挂载/卸载（编辑-阅读快速切换）会让底层单例 EditorManager 被 destroy 重置，
        // 本次 create 可能被静默中止（ready=false 且未真正挂载）。检测到就重试，
        // 绝不能把「没挂载成功」的实例当正常编辑器用。
        let manager: OnlyOfficeManager | null = null
        for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
          manager = await mount()
          if (cancelled) break
          if (manager.isReady()) break
          await new Promise((r) => setTimeout(r, 300))
        }
        if (!manager || cancelled) {
          if (manager && cancelled) manager.destroy()
          return
        }
        if (!manager.isReady()) {
          throw new Error('编辑器被频繁切换打断，请重新进入编辑模式')
        }
        managerRef.current = manager

        // 文档被修改 → 触发 3s 防抖自动保存。
        // ⚠️ 订阅必须在 SDK API（iframe 内 Asc.editor）就绪后才能成功；createWithFile
        // resolve 时 iframe 可能还没挂好，subscribe 会抛「OnlyOffice SDK API is not ready」。
        // 这里改为**失败重试**（1s 间隔、最多 60 次），绝不能静默放弃 —— 否则自动保存
        // 彻底失效，用户看到 OnlyOffice 自己的「所有更改已保存」但刷新后改动全部丢失（实测 bug）。
        let unsubModify: (() => void) | undefined
        let retryTimer: ReturnType<typeof setTimeout> | null = null
        let retries = 0
        const attachModifyListener = () => {
          if (cancelled || unsubModify) return
          try {
            const sub = manager.getEditor().subscribe({
              type: 'asc_onDocumentModifiedChanged',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              fn: (...args: any[]) => {
                if (args[0] === true) scheduleSave()
              },
            })
            void Promise.resolve(sub)
              .then((unsub) => {
                if (cancelled) {
                  try {
                    ;(unsub as (() => void) | undefined)?.()
                  } catch {
                    /* ignore */
                  }
                  return
                }
                unsubModify = (unsub as (() => void) | undefined) ?? undefined
              })
              .catch(() => {
                if (!cancelled && retries++ < 60) retryTimer = setTimeout(attachModifyListener, 1000)
              })
          } catch {
            if (!cancelled && retries++ < 60) retryTimer = setTimeout(attachModifyListener, 1000)
          }
        }
        attachModifyListener()

        const unsubLoading = manager.onLoadingChange(({ loading: l }) => setLoading(l))
        cleanup = () => {
          if (retryTimer) clearTimeout(retryTimer)
          try {
            unsubModify?.()
          } catch {
            /* ignore */
          }
          try {
            unsubLoading?.()
          } catch {
            /* ignore */
          }
          manager.destroy()
          managerRef.current = null
        }
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          const detail = (e as Error)?.message || '未知错误'
          setInitError(detail)
          message.error(`OnlyOffice 组件初始化失败：${detail}`)
        }
      }
    })()

    return () => {
      cancelled = true
      // 卸载前若有未保存改动，立即落盘（fire-and-forget）
      if (dirtyRef.current && canWriteRef.current) void doSave('auto')
      cleanup?.()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // 仅 docId 变化重建编辑器；doSave/scheduleSave 经 canWriteRef 读取最新可写状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  return (
    <div style={{ height: '100%', minHeight: 600, display: 'flex', flexDirection: 'column' }}>
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
            <Button size="small" icon={<SaveOutlined />} onClick={() => void doSave('manual')} disabled={!canWrite}>
              保存
            </Button>
          </Tooltip>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            历史版本
          </Button>
        </Space>
      </div>

      {initError ? (
        <Alert
          type="error"
          showIcon
          message="OnlyOffice 组件初始化失败"
          description={initError}
          style={{ margin: 24 }}
        />
      ) : (
        <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className={ONLYOFFICE_CONTAINER_CONFIG.PARENT_CLASS_NAME} style={{ position: 'absolute', inset: 0 }}>
            <div id={ONLYOFFICE_ID} style={{ position: 'absolute', inset: 0 }} />
          </div>
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
              }}
            >
              <Spin tip="正在加载编辑器…" />
            </div>
          )}
        </div>
      )}

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType={docType}
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => {
          window.location.reload()
        }}
      />
    </div>
  )
}
