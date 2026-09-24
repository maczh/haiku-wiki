// 白板文档（doc_type=whiteboard）正文的编解码。
//
// 与绘图文档（lib/drawioDoc.ts）同一套路：正文里**同时保存**场景数据与 SVG 预览 ——
//
//   content = JSON.stringify({ version, elements, appState, files, svg })
//
//   · elements/appState/files：Excalidraw 场景三件套（编辑态回填、导出 .excalidraw 的来源）；
//   · svg：最近一次保存时由浏览器侧 exportToSvg 生成的矢量预览，阅读/分享页直接渲染，
//     不加载 Excalidraw 组件（重、且需要字体资源）。空串表示尚未生成。
//
// .excalidraw 文件本身是另一种壳：{ type:'excalidraw', version:2, source, elements, appState, files }。
// 导入时剥壳入库，导出时重新装壳（前端 lib/whiteboardExport 与后端 exportx 各有一份实现）。

/** 正文结构：version 便于日后扩展字段时无损升级 */
export interface WhiteboardContent {
  version: number
  /** Excalidraw 场景元素（原样 JSON 数组） */
  elements: unknown[]
  /** 需要持久化的应用状态子集（视图背景色等） */
  appState: Record<string, unknown> | null
  /** 场景内嵌图片资源（id → dataURL），无图时为空对象 */
  files: Record<string, unknown>
  /** 最近一次生成的矢量预览；空串表示尚未生成 */
  svg: string
}

export const WHITEBOARD_CONTENT_VERSION = 1

/** 是否为白板正文 JSON（elements 数组是决定性特征） */
export function isWhiteboardJson(raw: string): boolean {
  const t = (raw || '').trim()
  if (!t.startsWith('{')) return false
  try {
    const o = JSON.parse(t) as { elements?: unknown }
    return Array.isArray(o?.elements)
  } catch {
    return false
  }
}

/** 解析正文 → 场景 + svg；非法正文返回空场景（编辑态可从空白开始） */
export function parseWhiteboardContent(raw: string): {
  elements: unknown[]
  appState: Record<string, unknown> | null
  files: Record<string, unknown>
  svg: string
} {
  if (!isWhiteboardJson(raw || '')) return { elements: [], appState: null, files: {}, svg: '' }
  try {
    const o = JSON.parse(raw) as Partial<WhiteboardContent>
    return {
      elements: Array.isArray(o.elements) ? o.elements : [],
      appState: (o.appState && typeof o.appState === 'object' ? o.appState : null) as Record<
        string,
        unknown
      > | null,
      files: (o.files && typeof o.files === 'object' ? o.files : {}) as Record<string, unknown>,
      svg: typeof o.svg === 'string' ? o.svg : '',
    }
  } catch {
    return { elements: [], appState: null, files: {}, svg: '' }
  }
}

/** 生成正文；svg 为空时仍写新格式（svg 待编辑态首次保存时补上） */
export function stringifyWhiteboardContent(
  elements: unknown[],
  appState: Record<string, unknown> | null,
  files: Record<string, unknown>,
  svg: string,
): string {
  const payload: WhiteboardContent = {
    version: WHITEBOARD_CONTENT_VERSION,
    elements: elements ?? [],
    appState: appState ?? null,
    files: files ?? {},
    svg: svg || '',
  }
  return JSON.stringify(payload)
}

/** SVG 是否为可用的矢量内容 */
export function isUsableWhiteboardSvg(svg: string): boolean {
  const t = (svg || '').trim()
  return t.startsWith('<svg') || (t.startsWith('<?xml') && t.includes('<svg'))
}

/**
 * .excalidraw 文件 → 白板正文。
 * 兼容两种输入：官方壳（type:'excalidraw'）与裸场景（直接是 {elements:[…]}）。
 * 校验失败返回 null（导入方给出可读提示，不产生损坏文档）。
 */
export function excalidrawFileToContent(raw: string): string | null {
  const t = (raw || '').trim()
  if (!t) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(t) as Record<string, unknown>
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null
  // 官方导出的 .excalidraw 带 type==='excalidraw'；其余情况要求直接带 elements 数组
  if (typeof o.type === 'string' && o.type !== 'excalidraw') return null
  if (!Array.isArray(o.elements)) return null
  return stringifyWhiteboardContent(
    o.elements as unknown[],
    (o.appState ?? null) as Record<string, unknown> | null,
    (o.files ?? {}) as Record<string, unknown>,
    '',
  )
}
