// 绘图文档（doc_type=drawing）正文的编解码。
//
// 背景：早期版本把 draw.io 的 XML 原文直接存进 doc.content，阅读/分享页必须内嵌
// draw.io 组件才能显示（重、慢、且需 37MB 静态资源）。本轮改为**同时保存 SVG**：
//
//   content = JSON.stringify({ version: 1, xml, svg })
//
// 这样阅读页与分享页只渲染已保存的 SVG（矢量、可缩放、零外部依赖）。
// 后端只当普通文本存，无需任何字段改动。
//
// 兼容性：解析时「先按 JSON 试、失败则按纯 XML」——历史文档（只有 XML）读出来
// 仍是合法绘图文档，编辑态打开时会自动补生成并回写一次 SVG。

/** 正文结构：version 便于日后扩展字段时无损升级 */
export interface DrawioContent {
  version: number
  /** draw.io 原生 XML（mxGraphModel），编辑态用 */
  xml: string
  /** 最近一次生成的矢量预览；空串表示尚未生成 */
  svg: string
}

export const DRAWIO_CONTENT_VERSION = 1

/** 是否为「带 SVG 的新格式」正文 */
export function isDrawioJson(raw: string): boolean {
  const t = (raw || '').trim()
  return t.startsWith('{') && t.includes('"xml"')
}

/**
 * 解析正文 → { xml, svg }。
 * 历史纯 XML 文档返回 svg=''（阅读页据此给出「请先在编辑态打开一次」的引导）。
 */
export function parseDrawioContent(raw: string): { xml: string; svg: string } {
  const src = raw || ''
  if (!isDrawioJson(src)) return { xml: src, svg: '' }
  try {
    const o = JSON.parse(src) as Partial<DrawioContent>
    const xml = typeof o.xml === 'string' ? o.xml : ''
    const svg = typeof o.svg === 'string' ? o.svg : ''
    return { xml, svg }
  } catch {
    // 极端情况：看起来像 JSON 但解析失败（手工编辑过）→ 退回按 XML 处理
    return { xml: src, svg: '' }
  }
}

/** 生成正文；svg 为空时仍写新格式（xml 完整、svg 待补） */
export function stringifyDrawioContent(xml: string, svg: string): string {
  const payload: DrawioContent = { version: DRAWIO_CONTENT_VERSION, xml: xml || '', svg: svg || '' }
  return JSON.stringify(payload)
}

/** SVG 是否为可用的矢量内容（draw.io 导出的 SVG 以 <svg 开头） */
export function isUsableSvg(svg: string): boolean {
  const t = (svg || '').trim()
  return t.startsWith('<svg') || (t.startsWith('<?xml') && t.includes('<svg'))
}

/**
 * draw.io 的 export 事件可能返回 data URI（如 data:image/svg+xml;base64,...），
 * 而阅读页需要纯 SVG 文本。这里统一解码为可用 SVG。
 */
export function decodeSvgDataUri(raw: string): string {
  const t = (raw || '').trim()
  if (!t.startsWith('data:')) return t
  const comma = t.indexOf(',')
  if (comma <= 0) return ''
  const meta = t.slice(5, comma)
  const payload = t.slice(comma + 1)
  if (meta.includes('base64')) {
    try {
      return atob(payload)
    } catch {
      return ''
    }
  }
  try {
    return decodeURIComponent(payload)
  } catch {
    return ''
  }
}
