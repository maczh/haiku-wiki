/**
 * 读取 SVG 的固有尺寸（优先 width/height，缺失/百分比时取 viewBox）。
 * 供 DrawioSvgView（绘图/白板预览）与 FlowchartView（mermaid 预览）共用 ——
 * mermaid 输出的 svg width="100%"、真实尺寸在 style max-width 与 viewBox 里。
 */
export function readSvgSize(svg: string): { w: number; h: number } {
  const fallback = { w: 800, h: 600 }
  if (!svg) return fallback
  try {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.nodeName === 'parsererror' || root.nodeName.toLowerCase() !== 'svg') return fallback
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    let w = parseFloat(root.getAttribute('width') || '')
    let h = parseFloat(root.getAttribute('height') || '')
    // width="100%" 这类百分比不是固有尺寸，回落到 viewBox
    if (!Number.isFinite(w) || w <= 0) w = vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : fallback.w
    if (!Number.isFinite(h) || h <= 0) h = vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : fallback.h
    return { w: Math.max(1, w), h: Math.max(1, h) }
  } catch {
    return fallback
  }
}
