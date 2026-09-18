import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Space, Spin, Tooltip, Typography, message } from 'antd'
import {
  AppstoreAddOutlined,
  DownloadOutlined,
  FileAddOutlined,
  HistoryOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { patchDoc } from '../../api/docs'
import { uploadFile } from '../../api/uploads'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'
import VersionDrawer from './VersionDrawer'
import {
  DRAWIO_SETUP_HINT,
  buildEmbedUrl,
  downloadExport,
  drawioAssetDiagnosis,
  fetchAsLoadXml,
  parseEditorMessage,
  postAction,
  type DrawioEditorMessage,
  type DrawioExportFormat,
} from '../../lib/drawio'
import { isUsableSvg, parseDrawioContent, stringifyDrawioContent } from '../../lib/drawioDoc'
import { DRAWIO_EXTS, extOf } from '../../lib/attachment'

interface Props {
  docId: number
  initialContent: string
  title: string
  /**
   * edit：完整编辑器（默认），保存写回文档；
   * view：只读预览（隐藏保存/导入，仅保留缩放平移与导出）；
   * import：用于把外部文件（.vsd/.vsdx）交给 draw.io 转换后预览，不回写任何文档。
   */
  mode?: 'edit' | 'view' | 'import'
  /** view 模式下隐藏外部工具条（嵌入到阅读页时由页面统筹） */
  compact?: boolean
  /** import 模式：待导入文件的访问地址 */
  sourceUrl?: string
  /** import 模式：待导入文件的扩展名（vsd/vsdx 走 Visio data URI） */
  sourceExt?: string
  /** 供父组件索取当前图表 XML（「另存为绘图文档」用） */
  apiRef?: { current: { requestXml: () => Promise<string> } | null }
}

/** 自动保存节流（draw.io 的 autosave 触发较密） */
const AUTOSAVE_DEBOUNCE_MS = 2000

/**
 * 自动保存时重新导出 SVG 的最小间隔。
 * draw.io 的 export 动作会在编辑器里弹一次 spinner，autosave 又只有 2s 节流，
 * 若每次都导出会让画布反复闪动；手动保存不受此限制（force）。
 */
const SVG_MIN_INTERVAL_MS = 6000

/**
 * 可选导出格式。
 * 注意**没有** .vsdx：draw.io 的 vsdx 导出是 Atlassian 版专属能力 ——
 * `EditorUi.vsdxExportEnabled()` 的判定是 `"atlassian" === getServiceName()`，
 * 而开源版 `getServiceName()` 恒为 `"draw.io"`；且导出类 `VsdxExport` 并未随开源包发布
 * （包里只有 `mxgraph.io.vsdx.*` 这套**导入**解析器）。属实现缺失，不是我们漏做，
 * 故界面上明确说明原因而不是静默少一项。
 */
const EXPORT_ITEMS: { key: DrawioExportFormat; label: string; desc: string }[] = [
  { key: 'xml', label: 'draw.io 文件（.drawio）', desc: '原生 XML，可再次导入编辑' },
  { key: 'svg', label: '矢量图（.svg）', desc: '可无损缩放的静态图形' },
  { key: 'png', label: '位图（.png）', desc: '通用图片格式' },
]

/**
 * 绘图文档编辑器 / 阅读器（内嵌 draw.io 完整绘图组件）。
 *
 * 实现方式：自托管 draw.io 官方 webapp（构建期由 scripts/copy-drawio-assets.mjs 放入
 * public/drawio），以 iframe + postMessage 走官方 embed 协议通信——
 * 见 lib/drawio.ts 顶部的协议说明与限制。
 *
 * 功能对应：
 *   · 导入 .drawio / .vsd / .vsdx —— Visio 走 `data:application/vnd.visio;base64` 前缀；
 *   · 导入素材组件 —— 内置形状库面板常开，并提供「素材库」按钮调起 draw.io 原生
 *     「更多形状」（Actions 里的 `shapes`），可添加 204 个内置库与图标搜索；
 *   · 导出 .drawio / .svg / .png —— 由本组件发起 export 动作后落盘；
 *     **.vsdx 只支持导入**：vsdx 导出是 draw.io Atlassian 版专属能力
 *     （`vsdxExportEnabled()` 要求服务名为 "atlassian"，开源版恒为 "draw.io"，
 *     且 `VsdxExport` 未随包发布），界面上显式说明原因。
 *
 * 保存：编辑器内 Save / 自动保存 → patchDoc 落库。阅读模式复用同一组件（只读参数），
 * 保证「预览效果与编辑效果完全一致」——这是引入完整组件而非另做只读渲染的主要理由。
 */
export default function DrawioEditor({
  docId,
  initialContent,
  title,
  mode = 'edit',
  compact = false,
  sourceUrl,
  sourceExt,
  apiRef,
}: Props) {
  /** 只有 edit 模式会把内容写回文档 */
  const editable = mode === 'edit'
  /** import 模式允许操作画布，但不提供保存 */
  const interactive = mode !== 'view'
  const [ready, setReady] = useState<boolean | null>(null)
  /** 资源诊断结论（缺资源时给出具体是哪个文件、为什么，而不是让浏览器抛语法错误） */
  const [assetIssue, setAssetIssue] = useState('')
  const [booting, setBooting] = useState(true)
  /** 编辑器超过 15s 仍未 init：多半是资源加载失败，给可操作提示 */
  const [slowHint, setSlowHint] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [loadError, setLoadError] = useState('')

  const frameRef = useRef<HTMLIFrameElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** 正文可能是新格式（{version,xml,svg} JSON），也可能是历史的纯 XML */
  const initial = useMemo(() => parseDrawioContent(initialContent), [initialContent])
  /** 最近一次用于 load 的内容：可能是 XML，也可能是 Visio 的 data URI（非 XML） */
  const latestRef = useRef(initial.xml)
  /** 最近一次确认过的图表 XML（只由 save/autosave/export 事件写入，保证是真正的 mxGraphModel） */
  const xmlRef = useRef(initial.xml)
  /** 最近一次导出的 SVG（随保存一起落库，供阅读/分享页免组件渲染） */
  const svgRef = useRef(initial.svg)
  /** svgRef 对应的 XML 快照：用于判断 SVG 是否已过期 */
  const svgForXmlRef = useRef(isUsableSvg(initial.svg) ? initial.xml : '')
  /** 历史文档（只有 XML）的 SVG 补生成只做一次 */
  const backfillRef = useRef(false)
  /** 上次自动导出 SVG 的时间戳（节流用，避免每次 autosave 都在编辑器里闪一次 spinner） */
  const lastSvgAtRef = useRef(0)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 编辑器是否已完成 init（未 init 前发 load/export 都会被丢弃） */
  const initializedRef = useRef(false)
  /** 等待中的导出请求：format → 回调 */
  const pendingExport = useRef<{ format: DrawioExportFormat; resolve: (data: string) => void; reject: (e: Error) => void } | null>(null)
  /** 待补送的 load 内容（init 早于文件读取完成时暂存） */
  const pendingLoadRef = useRef<string | null>(null)

  const embedUrl = useMemo(
    () => buildEmbedUrl({ ui: 'kennedy', libraries: true, lang: 'zh', readonly: mode === 'view' }),
    [mode],
  )

  // 资源体检（入口页指纹 + 关键 JS 子资源的 Content-Type/首字节校验）。
  // 任一项拿到 HTML 都说明被 SPA 兜底接管 —— 这类问题在运行时只表现为
  // `Uncaught SyntaxError: Unexpected token '<'`，这里提前定位到具体文件。
  useEffect(() => {
    let alive = true
    void drawioAssetDiagnosis().then((d) => {
      if (!alive) return
      setReady(d.ok)
      setAssetIssue(d.ok ? '' : d.message)
    })
    return () => {
      alive = false
    }
  }, [])

  // 编辑器长时间未 init：给出可操作提示（而不是无限转圈）
  useEffect(() => {
    if (!booting) {
      setSlowHint(false)
      return
    }
    const t = setTimeout(() => setSlowHint(true), 15_000)
    return () => clearTimeout(t)
  }, [booting])

  // 切换文档 / 正文变化时重建内存副本（含历史纯 XML 文档）
  useEffect(() => {
    const p = parseDrawioContent(initialContent)
    latestRef.current = p.xml
    xmlRef.current = p.xml
    svgRef.current = p.svg
    svgForXmlRef.current = isUsableSvg(p.svg) ? p.xml : ''
    backfillRef.current = false
  }, [docId, initialContent])

  // import 模式：先把外部文件读成 load action 可用的 xml（Visio 走 data URI），
  // 等编辑器 init 后由 onMessage 的 init 分支补送。
  useEffect(() => {
    if (mode !== 'import' || !sourceUrl) return
    let alive = true
    setBusy('正在转换文件…')
    ;(async () => {
      const payload = await fetchAsLoadXml(sourceUrl, sourceExt || '')
      if (!alive) return
      pendingLoadRef.current = payload
      setBusy('')
      // 若 init 已经到达（通常不会，文件读取更慢），立即补送
      if (initializedRef.current) {
        postAction(frameRef.current, { action: 'load', xml: payload, title })
        setBooting(false)
      }
    })().catch((e) => {
      if (alive) setLoadError((e as Error)?.message || '文件转换失败')
      setBusy('')
    })
    return () => {
      alive = false
    }
  }, [mode, sourceUrl, sourceExt, title])

  /**
   * 向编辑器索取一次导出数据（xml / svg / png）。
   * 同一时刻只允许一个在途请求：并发会互相顶掉 pendingExport，导致 resolve 错配。
   */
  const requestExport = useCallback(
    (format: DrawioExportFormat): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (!initializedRef.current) {
          reject(new Error('绘图组件尚未就绪'))
          return
        }
        if (pendingExport.current) {
          reject(new Error('已有导出请求进行中'))
          return
        }
        pendingExport.current = { format, resolve, reject }
        postAction(frameRef.current, { action: 'export', format, spinKey: 'export' })
        setTimeout(() => {
          if (pendingExport.current?.format === format) {
            pendingExport.current = null
            reject(new Error('导出超时，请重试'))
          }
        }, 60_000)
      }),
    [],
  )

  /**
   * 保证有与当前 XML 匹配的 SVG。
   *
   * 节流原因：drawio 的 export 动作会在编辑器里闪一次 spinner，而 autosave 每 2s 一次，
   * 每次都导出会让画布不断闪动。这里限制自动导出的最小间隔（手动保存 force=true
   * 直接放行），既保证预览最终新鲜，又不干扰绘制。
   * 失败一律不抛错：SVG 只是预览副本，缺了下次保存还会再补，不能因此丢掉正文保存。
   */
  const ensureSvg = useCallback(
    async (xml: string, force = false): Promise<string> => {
      if (svgForXmlRef.current === xml && isUsableSvg(svgRef.current)) return svgRef.current
      if (!force && Date.now() - lastSvgAtRef.current < SVG_MIN_INTERVAL_MS) return svgRef.current
      try {
        lastSvgAtRef.current = Date.now()
        const svg = await requestExport('svg')
        if (isUsableSvg(svg)) {
          svgRef.current = svg
          svgForXmlRef.current = xml
        }
      } catch {
        /* 导出被占用/超时/组件未就绪：保留旧 SVG，正文照常保存 */
      }
      return svgRef.current
    },
    [requestExport],
  )

  /** 落库：正文 = {version, xml, svg}（阅读/分享页只渲染 SVG，不再加载 draw.io） */
  const save = useCallback(
    async (xml: string, source: 'auto' | 'manual' = 'manual') => {
      if (!xml || !xml.trim()) return
      xmlRef.current = xml
      setStatus('saving')
      try {
        // 手动保存立即刷新 SVG；自动保存按最小间隔节流（见 SVG_MIN_INTERVAL_MS）
        const svg = await ensureSvg(xml, source === 'manual')
        await patchDoc(docId, { content: stringifyDrawioContent(xml, svg), source })
        dirtyRef.current = false
        setStatus('saved')
        setSavedAt(new Date().toLocaleTimeString('zh-CN'))
      } catch {
        // 失败回到「编辑中」：内容仍在编辑器里，用户可继续手动保存，不静默丢改动
        setStatus('editing')
      }
    },
    [docId, ensureSvg],
  )

  /** 节流保存（autosave 事件触发） */
  const scheduleSave = useCallback(
    (xml: string) => {
      dirtyRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void save(xml, 'auto')
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [save],
  )

  // 卸载 / 切换文档：清定时器并把未保存内容补落库，避免丢改动（只读模式无改动）
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (editable && dirtyRef.current && latestRef.current) {
        // 退出时来不及再导出 SVG：正文按新格式写入，SVG 沿用内存里最近一份
        const payload = stringifyDrawioContent(latestRef.current, svgRef.current)
        void patchDoc(docId, { content: payload, source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, editable],
  )

  // 历史文档（正文只有 XML、没有 SVG）在编辑态打开时补生成一次并静默回写，
  // 之后阅读页/分享页就能免组件渲染。只做一次，失败也不打扰用户（下次保存仍会补）。
  useEffect(() => {
    if (!editable || booting || !initializedRef.current) return
    if (backfillRef.current || isUsableSvg(svgRef.current)) return
    backfillRef.current = true
    const t = setTimeout(() => {
      void (async () => {
        try {
          const xml = xmlRef.current || latestRef.current
          if (!xml) return
          const svg = await requestExport('svg')
          if (!isUsableSvg(svg)) return
          svgRef.current = svg
          svgForXmlRef.current = xml
          await patchDoc(docId, { content: stringifyDrawioContent(xml, svg), source: 'auto' })
        } catch {
          /* 静默：下次保存会再补 */
        }
      })()
    }, 2000)
    return () => clearTimeout(t)
  }, [booting, docId, editable, requestExport])

  // 接收编辑器事件
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      // 只接受来自本 iframe 的消息，避免同页其它 postMessage 干扰
      if (!frameRef.current || ev.source !== frameRef.current.contentWindow) return
      const msg = parseEditorMessage(ev.data) as DrawioEditorMessage | null
      if (!msg) return
      switch (msg.event) {
        case 'init': {
          initializedRef.current = true
          setBooting(false)
          // 回送 load 才会真正渲染图表；只读模式不开 autosave，避免无意义的消息往来
          const xml = pendingLoadRef.current ?? latestRef.current
          pendingLoadRef.current = null
          postAction(frameRef.current, {
            action: 'load',
            xml: xml || '',
            title,
            ...(editable ? { autosave: 1 as const } : {}),
          })
          break
        }
        case 'save':
          if (editable && msg.xml) {
            latestRef.current = msg.xml
            void save(msg.xml, 'manual')
          }
          break
        case 'autosave':
          if (editable && msg.xml) {
            latestRef.current = msg.xml
            scheduleSave(msg.xml)
          }
          break
        case 'export': {
          const p = pendingExport.current
          // xml 格式的返回体放在 `xml` 字段而非 `data`（官方协议：不生成图像）
          const payload = msg.data ?? msg.xml
          if (payload != null) {
            // 缓存真实 XML，供「另存为」与后续导出复用
            if (msg.format === 'xml' || (!msg.format && typeof payload === 'string' && payload.includes('<mxGraphModel'))) {
              xmlRef.current = payload
            }
            if (p) {
              pendingExport.current = null
              p.resolve(payload)
            }
          }
          break
        }
        case 'exit':
          if (editable && msg.modified && latestRef.current) void save(latestRef.current, 'auto')
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [save, scheduleSave, title, editable])

  /** 向编辑器索取图表 XML（编辑/导入模式下用于「另存」与导出） */
  const requestXml = useCallback(async (): Promise<string> => {
    if (xmlRef.current) return xmlRef.current
    // 没有内存副本（如 Visio 刚转换完）时向编辑器要一次
    return await requestExport('xml')
  }, [requestExport])

  // 把 requestXml 暴露给父组件（Visio 附件的「另存为绘图文档」）
  useEffect(() => {
    if (apiRef) apiRef.current = { requestXml }
  }, [apiRef, requestXml])

  /** 导入绘图文件（.drawio / .vsd / .vsdx） */
  async function importDrawing(file: File) {
    const ext = extOf(file.name)
    if (!DRAWIO_EXTS.includes(ext)) {
      message.warning(`请选择 ${DRAWIO_EXTS.map((e) => `.${e}`).join(' / ')} 文件`)
      return
    }
    setBusy(`正在导入 ${file.name}…`)
    try {
      let payload: string
      if (ext === 'vsd' || ext === 'vsdx') {
        // Visio：官方要求 data URI 前缀，交给 draw.io 内部转换；二进制无法内联进文档正文，
        // 因此这类文件必须先落盘再以 URL 读取
        const up = await uploadFile(file)
        payload = await fetchAsLoadXml(up.url, ext)
      } else {
        // .drawio 是文本，无需上传即可直接载入
        payload = await file.text()
      }
      // 记入内存副本，使「保存 / 另存 / 导出」都能拿到转换后的结果
      latestRef.current = payload
      // Visio 的 payload 是 data URI 不是 XML，不能当作正文缓存；.drawio 文本可以直接缓存
      xmlRef.current = ext === 'vsd' || ext === 'vsdx' ? '' : payload
      if (initializedRef.current) {
        postAction(frameRef.current, {
          action: 'load',
          xml: payload,
          title: file.name.replace(/\.[^.]+$/, ''),
          ...(editable ? { autosave: 1 as const } : {}),
        })
        setBooting(false)
      } else {
        // 编辑器尚未 init：暂存，等 init 时补送
        pendingLoadRef.current = payload
        setBooting(true)
      }
      dirtyRef.current = true
      setStatus('editing')
      message.success(
        ext === 'vsd' || ext === 'vsdx'
          ? 'Visio 文件已交给绘图组件转换导入，确认无误后请保存'
          : '绘图文件已载入，确认无误后请保存',
      )
    } catch (e) {
      message.error((e as Error)?.message || '导入失败')
    } finally {
      setBusy('')
    }
  }

  /** 导出（xml / svg / png） */
  async function doExport(format: DrawioExportFormat) {
    if (!initializedRef.current) {
      message.warning('绘图组件尚未就绪，请稍候')
      return
    }
    setBusy('正在导出…')
    try {
      const data = await requestExport(format)
      if (!data || !String(data).trim()) throw new Error('编辑器未返回内容')
      downloadExport(String(data), format, title || '绘图')
      message.success('已开始下载')
    } catch (e) {
      message.error((e as Error)?.message || '导出失败')
    } finally {
      setBusy('')
    }
  }

  if (ready === false) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning"
          showIcon
          message="绘图组件未部署，无法打开绘图文档"
          description={
            <>
              <Typography.Paragraph style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                {assetIssue || DRAWIO_SETUP_HINT}
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                draw.io 静态资源约 37MB，不随代码仓库分发，由构建脚本按白名单拉取官方发行版子集。
              </Typography.Paragraph>
            </>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 外部工具条：draw.io 嵌入模式没有 File 菜单，导入/导出/素材由宿主提供 */}
      {!compact && (
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
          {editable && (
            <>
              <Button size="small" icon={<FileAddOutlined />} onClick={() => fileRef.current?.click()} disabled={!!busy}>
                导入绘图文件
              </Button>
              <Tooltip title="打开 draw.io 原生「更多形状」，可添加内置素材库与搜索图标">
                <Button
                  size="small"
                  icon={<AppstoreAddOutlined />}
                  disabled={booting || !!busy}
                  onClick={() => postAction(frameRef.current, { action: 'invokeAction', actionName: 'shapes' })}
                >
                  素材库
                </Button>
              </Tooltip>
            </>
          )}
          {!editable && interactive && (
            <Tooltip title="打开 draw.io 原生「更多形状」，可添加内置素材库与搜索图标">
              <Button
                size="small"
                icon={<AppstoreAddOutlined />}
                disabled={booting || !!busy}
                onClick={() => postAction(frameRef.current, { action: 'invokeAction', actionName: 'shapes' })}
              >
                素材库
              </Button>
            </Tooltip>
          )}
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
              onClick: ({ key }) => void doExport(key as DrawioExportFormat),
            }}
            disabled={booting || !!busy}
          >
            <Button size="small" icon={<DownloadOutlined />}>
              导出
            </Button>
          </Dropdown>
          {editable && (
            <>
              <Tooltip title="保存当前绘图（写入文档历史版本）">
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  disabled={booting || !!busy}
                  onClick={() => void save(latestRef.current, 'manual')}
                >
                  保存
                </Button>
              </Tooltip>
              <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
                历史
              </Button>
              <div style={{ flex: 1 }} />
              <SaveIndicator status={status} savedAt={savedAt} />
            </>
          )}
          {!editable && <div style={{ flex: 1 }} />}
        </div>
      )}

      {/* 局限说明：Visio 仅支持导入（只读模式下同样如实告知，避免用户反复试错） */}
      {editable && (
        <div
          style={{
            padding: '6px 12px',
            background: '#fffbe6',
            borderBottom: '1px solid #ffe58f',
            fontSize: 12,
            color: '#874d00',
          }}
        >
          可导入 <b>.drawio / .vsd / .vsdx</b>；导出支持 <b>.drawio / .svg / .png</b>。
          <b>.vsdx 导出</b>是 draw.io 企业版（Atlassian）专属能力，开源版未随包提供导出实现，故菜单中无此项；
          如需 Visio 文件，请在 Visio 或转换工具中另存。
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={DRAWIO_EXTS.map((e) => `.${e}`).join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void importDrawing(f)
        }}
      />

      {/* 画布：height:100% 依赖父级链路上的确定高度，见 BookPage.tsx 的注释 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#fff' }}>
        {ready === null && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 2 }}>
            <Space>
              <Spin size="small" /> 正在检查绘图组件…
            </Space>
          </div>
        )}
        {(booting || busy) && ready === true && (
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
            <Space size={6}>
              <Spin size="small" />
              {busy || '正在加载绘图组件…'}
            </Space>
          </div>
        )}
        {loadError && (
          <Alert type="error" showIcon style={{ margin: 12 }} message="绘图组件加载失败" description={loadError} />
        )}
        {/* 超过 15s 仍未 init：多半是某个 JS 子资源被 SPA 兜底成了 HTML
            （表现为控制台 Unexpected token '<'），这里给出可自查的提示而不是无限转圈 */}
        {slowHint && booting && ready === true && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 4, background: '#fff', padding: 24, overflow: 'auto' }}>
            <Alert
              type="warning"
              showIcon
              message="绘图组件长时间未响应"
              description={
                <>
                  <Typography.Paragraph style={{ marginBottom: 8 }}>
                    通常是静态资源路径不正确：某个 <code>.js</code> 请求被应用兜底页接管，返回了 HTML 而不是脚本
                    （控制台会看到 <code>Uncaught SyntaxError: Unexpected token '&lt;'</code>）。
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {DRAWIO_SETUP_HINT}
                  </Typography.Paragraph>
                </>
              }
            />
          </div>
        )}
        {ready === true && (
          <iframe
            ref={frameRef}
            title={`drawio-${docId}`}
            src={embedUrl}
            onError={() => setLoadError('iframe 加载失败，请确认静态资源已正确部署')}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            // 需要剪贴板与文件下载能力；sandbox 不设限以保留完整绘图能力
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>

      <VersionDrawer
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        docId={docId}
        title={title}
        docType="drawing"
        onRolledBack={() => {
          // 回滚后重新拉取：整页重载最稳妥（iframe 内部状态无法增量回填）
          window.location.reload()
        }}
      />
    </div>
  )
}
