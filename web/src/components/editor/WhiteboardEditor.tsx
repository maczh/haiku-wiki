import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Popconfirm, Space, Tooltip, Typography, message } from 'antd'
import {
  ClearOutlined,
  DownloadOutlined,
  FileAddOutlined,
  HistoryOutlined,
  SaveOutlined,
  AppstoreAddOutlined,
} from '@ant-design/icons'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { Excalidraw } from '@excalidraw/excalidraw'
// Excalidraw 的 UI/画布样式必须显式引入（包内不自动注入），
// 缺了它 .excalidraw 根容器没有 height:100%/display:flex，画布会撑到 2^25px 高。
import '@excalidraw/excalidraw/index.css'
import { patchDoc, saveBlob } from '../../api/docs'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import {
  parseWhiteboardContent,
  stringifyWhiteboardContent,
  excalidrawFileToContent,
} from '../../lib/whiteboardDoc'
import {
  buildExcalidrawFile,
  exportWhiteboardPdfBlob,
  exportWhiteboardPngBlob,
  exportWhiteboardSvg,
  pickPersistentAppState,
  stripDeletedElements,
} from '../../lib/whiteboardExport'

interface Props {
  docId: number
  initialContent: string
  title: string
}

/** 自动保存防抖（与文档编辑器一致的 3s） */
const AUTOSAVE_DEBOUNCE_MS = 3000
/** 自动保存时重新导出 SVG 的最小间隔（生成 SVG 需要加载字体，不能每次 autosave 都做） */
const SVG_MIN_INTERVAL_MS = 6000

/** 工具条导出项（与导出对话框、后端 formats 清单保持同构） */
const EXPORT_ITEMS: { key: 'excalidraw' | 'svg' | 'png' | 'pdf'; label: string; desc: string }[] = [
  { key: 'excalidraw', label: 'Excalidraw 白板（.excalidraw）', desc: '原生场景文件，可再次导入编辑' },
  { key: 'svg', label: '矢量图（.svg）', desc: '可无损缩放的静态图形' },
  { key: 'png', label: '位图（.png）', desc: '通用图片格式' },
  { key: 'pdf', label: 'PDF 文档（.pdf）', desc: 'A4 横向，等比容纳白板内容' },
]

/**
 * 白板文档编辑器（doc_type=whiteboard，内嵌 Excalidraw）。
 *
 * 组件本身自带完整顶部工具条（选择/图形/画框/素材库入口等，见官方 UI）与
 * 素材库面板（含「浏览素材库」）；宿主工具条补齐文档能力：
 *   · 导入 .excalidraw 场景文件、导入 .excalidrawlib 素材库；
 *   · 导出 .excalidraw / .svg / .png / .pdf；
 *   · 清除画布（画布内右上角也有同一入口的图标）；
 *   · 保存 / 历史 —— 落库正文为 {version, elements, appState, files, svg}，
 *     其中 svg 是保存时由浏览器侧 exportToSvg 生成的预览，
 *     阅读/分享页只渲染这份 SVG，不加载 Excalidraw 组件。
 */
export default function WhiteboardEditor({ docId, initialContent, title }: Props) {
  const initial = useMemo(() => parseWhiteboardContent(initialContent), [initialContent])
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  /** 场景三件套的内存副本（onChange 持续刷新，保存/导出都取自这里） */
  const elementsRef = useRef<readonly unknown[]>(initial.elements)
  const appStateRef = useRef<Record<string, unknown> | null>(initial.appState)
  const filesRef = useRef<Record<string, unknown>>(initial.files)
  /** 最近一次保存过的正文（未保存判空 / 卸载补存用） */
  const lastSavedRef = useRef<string>(initialContent || '')
  const svgRef = useRef(initial.svg)
  const lastSvgAtRef = useRef(0)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const libFileRef = useRef<HTMLInputElement>(null)
  const sceneFileRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [busy, setBusy] = useState('')

  const handleInit = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api
    },
    [],
  )

  /**
   * 生成与当前场景匹配的 SVG 预览。
   * 自动保存按最小间隔节流；手动保存 force 直接放行（见 DrawioEditor 同名逻辑）。
   * 失败不抛错：SVG 只是预览副本，缺了下次保存还会再补。
   */
  const ensureSvg = useCallback(async (force = false): Promise<string> => {
    const elements = stripDeletedElements(elementsRef.current)
    if (elements.length === 0) return ''
    if (!force && Date.now() - lastSvgAtRef.current < SVG_MIN_INTERVAL_MS) return svgRef.current
    try {
      lastSvgAtRef.current = Date.now()
      const svg = await exportWhiteboardSvg(
        elementsRef.current,
        appStateRef.current,
        filesRef.current,
      )
      if (svg.startsWith('<svg')) svgRef.current = svg
    } catch {
      /* 字体未就绪/导出异常：保留旧 SVG，正文照常保存 */
    }
    return svgRef.current
  }, [])

  /** 落库：正文 = {version, elements, appState, files, svg} */
  const save = useCallback(
    async (source: 'auto' | 'manual' = 'manual') => {
      const elements = stripDeletedElements(elementsRef.current)
      const payload = stringifyWhiteboardContent(
        elements,
        pickPersistentAppState(appStateRef.current),
        filesRef.current,
        svgRef.current,
      )
      if (payload === lastSavedRef.current && source === 'auto') return
      setStatus('saving')
      try {
        let svg = await ensureSvg(source === 'manual')
        if (source === 'manual' && elements.length > 0 && !svg) {
          svg = await ensureSvg(true)
        }
        svgRef.current = svg
        const content = stringifyWhiteboardContent(
          elements,
          pickPersistentAppState(appStateRef.current),
          filesRef.current,
          svg,
        )
        await patchDoc(docId, { content, source })
        lastSavedRef.current = content
        dirtyRef.current = false
        setStatus('saved')
        setSavedAt(new Date().toLocaleTimeString('zh-CN'))
        if (source === 'manual' && elements.length > 0 && !svg) {
          message.warning('预览图生成失败，阅读/分享页可能暂时无法显示，请稍后再次保存重试')
        }
      } catch {
        // 失败回到「编辑中」：内容仍在编辑器里，可继续手动保存
        setStatus('editing')
      }
    },
    [docId, ensureSvg],
  )

  /** 防抖保存（onChange 触发） */
  const scheduleSave = useCallback(
    () => {
      dirtyRef.current = true
      setStatus('editing')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void save('auto')
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [save],
  )

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      elementsRef.current = elements
      filesRef.current = files || {}
      appStateRef.current = appState
      scheduleSave()
    },
    [scheduleSave],
  )

  // 卸载 / 切换文档：清定时器并把未保存内容补落库，避免丢改动
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current) {
        const payload = stringifyWhiteboardContent(
          stripDeletedElements(elementsRef.current),
          pickPersistentAppState(appStateRef.current),
          filesRef.current,
          svgRef.current,
        )
        void patchDoc(docId, { content: payload, source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId],
  )

  /** 清除画布：清空全部元素（保留视图背景色），随后照常走保存链路 */
  const clearCanvas = useCallback(() => {
    const api = apiRef.current
    if (!api) {
      message.warning('白板组件尚未就绪，请稍候')
      return
    }
    api.updateScene({ elements: [] })
    elementsRef.current = []
    scheduleSave()
    message.success('画布已清空')
  }, [scheduleSave])

  /** 导入 .excalidraw 场景文件：替换当前画布内容 */
  async function importScene(file: File) {
    setBusy('正在导入白板文件…')
    try {
      const raw = await file.text()
      const content = excalidrawFileToContent(raw)
      if (!content) throw new Error('不是有效的 .excalidraw 文件（应为 Excalidraw 场景 JSON）')
      const parsed = parseWhiteboardContent(content)
      if (parsed.elements.length === 0) throw new Error('文件中没有可绘制的白板元素')
      const excal = await import('@excalidraw/excalidraw')
      const restored = excal.restoreElements(parsed.elements as never[], null)
      apiRef.current?.updateScene({ elements: restored as never[] })
      if (Object.keys(parsed.files).length > 0) {
        // updateScene 不覆盖 files：带图片的场景需要补灌（再触发一次 onChange 即可持久化）
        apiRef.current?.addFiles(parsed.files as never)
      }
      elementsRef.current = restored as unknown[]
      filesRef.current = { ...filesRef.current, ...parsed.files }
      scheduleSave()
      message.success(`已导入「${file.name}」`)
    } catch (e) {
      message.error((e as Error)?.message || '导入失败')
    } finally {
      setBusy('')
    }
  }

  /** 导入 .excalidrawlib 素材库：合并进个人素材库并打开面板 */
  async function importLibrary(file: File) {
    setBusy('正在导入素材库…')
    try {
      const excal = await import('@excalidraw/excalidraw')
      const items = await excal.loadLibraryFromBlob(file)
      await apiRef.current?.updateLibrary({ libraryItems: items, merge: true, openLibraryMenu: true })
      message.success(`已导入素材库「${file.name}」`)
    } catch (e) {
      message.error((e as Error)?.message || '素材库导入失败')
    } finally {
      setBusy('')
    }
  }

  /** 工具条导出（导出对话框里同样提供这四种格式） */
  async function doExport(format: 'excalidraw' | 'svg' | 'png' | 'pdf') {
    const api = apiRef.current
    if (!api) {
      message.warning('白板组件尚未就绪，请稍候')
      return
    }
    const elements = api.getSceneElements()
    if (stripDeletedElements(elements).length === 0) {
      message.warning('白板为空，先画点什么吧')
      return
    }
    setBusy('正在导出…')
    try {
      const appState = api.getAppState() as unknown as Record<string, unknown>
      const files = api.getFiles()
      let blob: Blob
      let ext: string
      switch (format) {
        case 'excalidraw':
          blob = new Blob([await buildExcalidrawFile(elements, appState, files)], {
            type: 'application/json',
          })
          ext = 'excalidraw'
          break
        case 'svg':
          blob = new Blob([await exportWhiteboardSvg(elements, appState, files)], {
            type: 'image/svg+xml;charset=utf-8',
          })
          ext = 'svg'
          break
        case 'png':
          blob = await exportWhiteboardPngBlob(elements, appState, files)
          ext = 'png'
          break
        case 'pdf':
          blob = await exportWhiteboardPdfBlob(elements, appState, files)
          ext = 'pdf'
          break
      }
      const base = (title || '白板').replace(/[\\/:*?"<>|\n\r\t]/g, '_')
      await saveBlob(blob, `${base}.${ext}`)
      message.success(`已导出：${base}.${ext}`)
    } catch (e) {
      message.error((e as Error)?.message || '导出失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 宿主工具条：Excalidraw 画布内没有文件级「导入/导出/保存」概念，由宿主补齐 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '1px solid #ebedf0',
          flexWrap: 'wrap',
        }}
      >
        <Tooltip title="导入 .excalidraw 场景文件，替换当前画布">
          <Button
            size="small"
            icon={<FileAddOutlined />}
            onClick={() => sceneFileRef.current?.click()}
            disabled={!!busy}
          >
            导入白板
          </Button>
        </Tooltip>
        <Tooltip title="导入 .excalidrawlib 素材库，合并进个人素材库">
          <Button
            size="small"
            icon={<AppstoreAddOutlined />}
            onClick={() => libFileRef.current?.click()}
            disabled={!!busy}
          >
            导入素材库
          </Button>
        </Tooltip>
        <Popconfirm
          title="清除画布"
          description="将移除画布上的全部元素，确定继续吗？"
          okText="清除"
          cancelText="取消"
          onConfirm={clearCanvas}
        >
          <Tooltip title="清除画布（移除全部元素）">
            <Button size="small" icon={<ClearOutlined />} danger disabled={!!busy}>
              清除画布
            </Button>
          </Tooltip>
        </Popconfirm>
        <Dropdown
          menu={{
            items: EXPORT_ITEMS.map((it) => ({
              key: it.key,
              label: (
                <div>
                  <div>{it.label}</div>
                  <div style={{ color: '#8a919f', fontSize: 12 }}>{it.desc}</div>
                </div>
              ),
            })),
            onClick: ({ key }) => void doExport(key as 'excalidraw' | 'svg' | 'png' | 'pdf'),
          }}
          disabled={!!busy}
        >
          <Button size="small" icon={<DownloadOutlined />}>
            导出
          </Button>
        </Dropdown>
        <Tooltip title="保存当前白板（写入文档历史版本）">
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            disabled={!!busy}
            onClick={() => void save('manual')}
          >
            保存
          </Button>
        </Tooltip>
        <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
          历史
        </Button>
        <div style={{ flex: 1 }} />
        <SaveIndicator status={status} savedAt={savedAt} />
      </div>

      <input
        ref={sceneFileRef}
        type="file"
        accept=".excalidraw"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importScene(f)
        }}
      />
      <input
        ref={libFileRef}
        type="file"
        accept=".excalidrawlib"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importLibrary(f)
        }}
      />

      {/* 画布：height:100% 依赖父级链路上的确定高度（与 DrawioEditor 同） */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#fff' }}>
        {busy && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3,
              background: 'rgba(255,255,255,.94)',
              border: '1px solid #ebedf0',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 12,
              color: '#5f6672',
              boxShadow: '0 2px 8px rgba(0,0,0,.08)',
            }}
          >
            {busy}
          </div>
        )}
        <Excalidraw
          langCode="zh-CN"
          name={title}
          initialData={{
            elements: initial.elements as never,
            appState: (initial.appState ?? {}) as never,
            files: initial.files as never,
          }}
          excalidrawAPI={handleInit}
          onChange={handleChange as never}
          /** 画布右上角常驻「清除画布」图标（需求：顶部工具条额外添加清除画布） */
          renderTopRightUI={() => (
            <Tooltip title="清除画布">
              <button
                className="excalidraw-button"
                type="button"
                aria-label="清除画布"
                onClick={clearCanvas}
                style={{ cursor: 'pointer' }}
              >
                <ClearOutlined />
              </button>
            </Tooltip>
          )}
        />
      </div>

      <VersionDrawer
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        docId={docId}
        title={title}
        docType="whiteboard"
        onRolledBack={() => {
          // 回滚后重新拉取：画布内部状态无法增量回填，整页重载最稳妥
          window.location.reload()
        }}
      />
    </div>
  )
}
