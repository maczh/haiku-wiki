// draw.io（diagrams.net）嵌入模式通信层。
//
// 协议要点（依据官方 embed-mode 文档核实）：
//   · iframe URL 带 `embed=1&proto=json` 即启用 postMessage JSON 协议；
//   · 编辑器就绪后发 `{event:'init'}`，宿主必须回一条 load action 才会渲染图表；
//   · 保存走 `{event:'save', xml}`，自动保存走 `{event:'autosave', xml}`；
//   · 导出由宿主发 `{action:'export', format}`，编辑器回 `{event:'export', data, format}`；
//   · 关闭/退出为 `{event:'exit'}`。
//
// 支持的导出格式（逐字来自官方文档）：xml / json / svg / xmlsvg / png / xmlpng / html / html2。
// **.vsdx 只能导入、不能导出**，原因是**组件实现缺失**而非协议未定义：
//   · `EditorUi.prototype.vsdxExportEnabled(){ return "atlassian" == this.getServiceName() }`
//     而开源版 `getServiceName()` 恒为 `"draw.io"` → 导出菜单项 `exportVsdx` 永不加入；
//   · 导出类 `VsdxExport` 只在 app.min.js 里被调用，**全包无定义**；
//     包里与 vsdx 有关的只有 `mxgraph.io.vsdx.*` 这套**导入**解析器。
// 即 vsdx 导出是 Atlassian 版专属能力。界面上必须如实说明该限制，
// 因此本项目对 .vsdx 的处理是：导入支持，导出仅 .drawio / .svg / .png。

/** 自托管 drawio 静态资源根路径（由 scripts/copy-drawio-assets.mjs 就位） */
export const DRAWIO_BASE = '/drawio'

/** 探测入口文件：存在即认为绘图组件已部署 */
export const DRAWIO_ENTRY = `${DRAWIO_BASE}/index.html`

/** 界面主题（对应 drawio 的 ui 参数） */
export type DrawioUi = 'kennedy' | 'atlas' | 'min' | 'dark'

export interface EmbedUrlOptions {
  /** 界面主题，默认 kennedy（最贴近经典 draw.io） */
  ui?: DrawioUi
  /** 启用左侧形状库面板（“导入素材组件”依赖它） */
  libraries?: boolean
  /** 语言，默认 zh */
  lang?: string
  /** 只读查看模式：隐藏工具栏/菜单，仅允许缩放平移 */
  readonly?: boolean
  /** 无保存按钮（只读时用） */
  noSaveBtn?: boolean
  /** 主题跟随深色 */
  dark?: boolean
}

/** 构造 iframe 的 src（自托管形态，路径即静态资源根） */
export function buildEmbedUrl(o: EmbedUrlOptions = {}): string {
  const p = new URLSearchParams()
  p.set('embed', '1')
  p.set('proto', 'json')
  p.set('spin', '1')
  p.set('lang', o.lang ?? 'zh')
  p.set('ui', o.ui ?? 'kennedy')
  // 形状库：需求「导入素材组件」即 drawio 内置的 shapes/stencils 素材，需开启左面板
  p.set('libraries', o.libraries === false ? '0' : '1')
  // 只读：隐藏保存/退出，界面留给缩放与平移
  if (o.readonly) {
    p.set('noSaveBtn', '1')
    p.set('noExitBtn', '1')
    p.set('saveAndExit', '0')
  } else {
    // 编辑态：保留 Save 按钮（走 save 事件落库），另给 Save and Exit
    p.set('saveAndExit', '1')
  }
  if (o.dark) p.set('dark', '1')
  return `${DRAWIO_ENTRY}?${p.toString()}`
}

// ---------- 编辑器 → 宿主 ----------

export interface DrawioEditorMessage {
  event: string
  /** 图表 XML（init/save/autosave 等事件携带） */
  xml?: string
  /** 导出的数据：xml/svg 为原文，png 等二进制为 data URI */
  data?: string
  /** 导出格式 */
  format?: string
  /** saveAndExit 时 exit=true */
  exit?: boolean
  /** exit 事件：是否有未保存改动 */
  modified?: boolean
  /** 出错信息（如 unknownMessage） */
  error?: string
  /** 导出文件名（UI 触发的导出会带） */
  filename?: string
}

/** 宽松解析 postMessage 负载；非 drawio 消息返回 null */
export function parseEditorMessage(raw: unknown): DrawioEditorMessage | null {
  if (typeof raw === 'string') {
    // 老式非 JSON 协议会直接发字符串（如 'ready'/'save'），本处不处理
    try {
      const o = JSON.parse(raw) as DrawioEditorMessage
      return o && typeof o.event === 'string' ? o : null
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as DrawioEditorMessage
    return typeof o.event === 'string' ? o : null
  }
  return null
}

// ---------- 宿主 → 编辑器 ----------

export type DrawioAction =
  | { action: 'load'; xml: string; title?: string; autosave?: 1; modified?: string; exportProtocol?: boolean }
  | { action: 'export'; format: DrawioExportFormat; spinKey?: string }
  | { action: 'autosave'; xml: string }
  | { action: 'spinner'; message?: string; show: boolean }
  | { action: 'status'; message: string; modified?: boolean }
  | { action: 'fit'; border?: number; maxScale?: number }
  | { action: 'configure'; config: Record<string, unknown> }
  /** 调用编辑器内置命名动作；`shapes` 即 draw.io 原生的「更多形状」（素材库）对话框 */
  | { action: 'invokeAction'; actionName: 'shapes' | 'findReplace' | 'zoomIn' | 'zoomOut' | 'resetView' | string }

export type DrawioExportFormat = 'xml' | 'svg' | 'xmlsvg' | 'png' | 'xmlpng' | 'json'

/** 向 iframe 发送动作（必须等 iframe 内文档就绪后再发） */
export function postAction(frame: HTMLIFrameElement | null, action: DrawioAction) {
  frame?.contentWindow?.postMessage(JSON.stringify(action), '*')
}

// ---------- 导入源的编码 ----------

/** Visio（.vsd/.vsdx）在 load action 中以 data URI 形式传入 */
export const VISIO_MIME = 'data:application/vnd.visio;base64,'

/** blob → base64（分块避免大文件时参数溢出） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/**
 * 读取远程文件并编码为 load action 可用的 `xml` 值。
 *   · .drawio / .xml → 直接返回文件文本
 *   · .vsd / .vsdx   → `data:application/vnd.visio;base64,...`
 */
export async function fetchAsLoadXml(url: string, ext: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`无法读取文件（HTTP ${resp.status}）`)
  const e = ext.replace(/^\./, '').toLowerCase()
  if (e === 'vsd' || e === 'vsdx') {
    return VISIO_MIME + (await blobToBase64(await resp.blob()))
  }
  const text = await resp.text()
  // 兜底：误判为 XML 的二进制（含 NUL）直接报错，避免把乱码喂给编辑器
  if (e !== 'drawio' && text.includes('\u0000')) throw new Error('文件不是文本格式的绘图文件')
  return text
}

// ---------- 导出的落盘 ----------

/** 触发浏览器下载；data URI 与文本都能处理 */
export function downloadExport(data: string, format: string, baseName: string) {
  const { blob, mime } = toBlob(data, format)
  const ext = format === 'xml' ? 'drawio' : format === 'svg' || format === 'xmlsvg' ? 'svg' : 'png'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 交回浏览器释放（立刻 revoke 在部分浏览器会打断下载）
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  void mime
}

/** export 事件返回的 data → Blob（xml/svg 为原文，png 为 data URI） */
export function toBlob(data: string, format: string): { blob: Blob; mime: string } {
  if (data.startsWith('data:')) {
    const comma = data.indexOf(',')
    const meta = data.slice(5, comma)
    const payload = data.slice(comma + 1)
    const mime = meta.split(';')[0] || 'application/octet-stream'
    const bin = meta.includes('base64') ? atob(payload) : decodeURIComponent(payload)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { blob: new Blob([bytes], { type: mime }), mime }
  }
  const mime = format === 'svg' || format === 'xmlsvg' ? 'image/svg+xml' : 'application/xml'
  return { blob: new Blob([data], { type: `${mime};charset=utf-8` }), mime }
}

// ---------- 可用性探测 ----------

/**
 * 探测自托管 drawio 资源是否就位。
 * 用 GET 而非 HEAD：部分静态服务对 HEAD 返回 405。
 * 结果按会话缓存，避免每次打开绘图文档都发一次请求。
 *
 * 注意不要用 `Range: bytes=0-64` 之类的窄窗口做探测：drawio 的 index.html 前
 * 65 字节是 `<!DOCTYPE html><html><head><title>Flowchart Maker…`，指纹串
 * （drawio / mxgraph）落在窗口之外，而严格实现 Range 的静态服务器只会返回
 * 请求的那几十字节 —— 会把「资源已就位」误判成「组件未部署」。
 * 该文件仅约 3KB，整取后再校验即可。
 */
let assetsProbe: Promise<boolean> | null = null

/** drawio 页面前 4KB 内必现的指纹；SPA 兜底页不含这些串 */
const DRAWIO_FINGERPRINT = /drawio|mxgraph|geInfo|bootstrap\.js/i

export function drawioAssetsReady(): Promise<boolean> {
  assetsProbe ??= (async () => {
    try {
      const resp = await fetch(DRAWIO_ENTRY, { method: 'GET' })
      if (!resp.ok) return false
      const text = await resp.text()
      // 兜底校验：确认拿到的是 drawio 页面，而不是 SPA 的 index.html 路由兜底页
      return DRAWIO_FINGERPRINT.test(text.slice(0, 4096))
    } catch {
      return false
    }
  })()
  return assetsProbe
}

/** 资源缺失时给出的构建指引（开发/部署两种场景） */
export const DRAWIO_SETUP_HINT =
  '绘图组件未部署。请在 web 目录执行 `npm run fetch:drawio` 拉取 draw.io 静态资源后重新构建。'
