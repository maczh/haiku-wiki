// 白板（Excalidraw）浏览器侧导出与渲染工具。
//
// 使用方：
//   · WhiteboardEditor —— 工具条导出（.excalidraw/.svg/.png/.pdf）与保存时生成 SVG 预览；
//   · WhiteboardView —— 正文没带 svg 时（模板预览/导入后未编辑）现场渲染一次；
//   · lib/export —— 导出对话框的「浏览器端」png/pdf 分支。
//
// 全部经动态 import('@excalidraw/excalidraw') 取导出器，避免把 Excalidraw
// 本体拖进任何静态 chunk；字体/语言包走自托管资源（见 copy-excalidraw-assets.mjs）。

/** 自托管 Excalidraw 资源路径（fonts/locales/data）。必须在字体加载前设置。 */
export const EXCALIDRAW_ASSETS = '/excalidraw/dist/prod/'

if (typeof window !== 'undefined') {
  ;(window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSETS
}

/** 持久化到正文里的 appState 白名单（光标/滚动等瞬时状态不入库） */
export function pickPersistentAppState(appState: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!appState) return null
  const out: Record<string, unknown> = {}
  if (typeof appState.viewBackgroundColor === 'string') out.viewBackgroundColor = appState.viewBackgroundColor
  if (typeof appState.gridSize === 'number') out.gridSize = appState.gridSize
  if (typeof appState.gridModeEnabled === 'boolean') out.gridModeEnabled = appState.gridModeEnabled
  return out
}

/** 过滤掉已删除元素（Excalidraw 的 elements 数组含墓碑元素，不必入库） */
export function stripDeletedElements(elements: readonly unknown[]): unknown[] {
  return (elements as { isDeleted?: boolean }[]).filter((el) => !el?.isDeleted)
}

/** 场景 → .excalidraw 文件文本（type:'excalidraw' 官方壳） */
export async function buildExcalidrawFile(
  elements: readonly unknown[],
  appState: Record<string, unknown> | null,
  files: Record<string, unknown>,
): Promise<string> {
  const excal = await import('@excalidraw/excalidraw')
  return excal.serializeAsJSON(
    stripDeletedElements(elements) as never[],
    (appState ?? {}) as never,
    (files ?? {}) as never,
    'local',
  )
}

/** 场景 → SVG 文本（保存时生成预览 / 只读现场渲染共用） */
export async function exportWhiteboardSvg(
  elements: readonly unknown[],
  appState: Record<string, unknown> | null,
  files: Record<string, unknown>,
  exportPadding = 16,
): Promise<string> {
  const excal = await import('@excalidraw/excalidraw')
  const restored = excal.restoreElements(
    stripDeletedElements(elements) as never[],
    null,
  )
  const svg = await excal.exportToSvg({
    elements: restored as never[],
    appState: {
      exportBackground: true,
      viewBackgroundColor: (appState?.viewBackgroundColor as string | undefined) ?? '#ffffff',
      exportPadding,
    },
    files: (files ?? {}) as never,
  })
  return new XMLSerializer().serializeToString(svg)
}

/** 场景 → PNG Blob */
export async function exportWhiteboardPngBlob(
  elements: readonly unknown[],
  appState: Record<string, unknown> | null,
  files: Record<string, unknown>,
): Promise<Blob> {
  const excal = await import('@excalidraw/excalidraw')
  const restored = excal.restoreElements(
    stripDeletedElements(elements) as never[],
    null,
  )
  const blob = await excal.exportToBlob({
    elements: restored as never[],
    appState: {
      exportBackground: true,
      viewBackgroundColor: (appState?.viewBackgroundColor as string | undefined) ?? '#ffffff',
      exportPadding: 16,
    },
    files: (files ?? {}) as never,
    mimeType: 'image/png',
  })
  return blob
}

/** 场景 → PDF Blob（PNG 落 A4 横向，等比居中） */
export async function exportWhiteboardPdfBlob(
  elements: readonly unknown[],
  appState: Record<string, unknown> | null,
  files: Record<string, unknown>,
): Promise<Blob> {
  const png = await exportWhiteboardPngBlob(elements, appState, files)
  const dataUrl = await blobToDataUrl(png)
  const dims = await readImageDims(dataUrl)
  const { jsPDF } = await import('jspdf')
  // 横向 A4，整页等比容纳白板内容（画板场景横多竖少，横页利用率最高）
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const scale = Math.min(pw / dims.w, ph / dims.h, 1)
  const w = dims.w * scale
  const h = dims.h * scale
  pdf.addImage(dataUrl, 'PNG', (pw - w) / 2, (ph - h) / 2, w, h)
  return pdf.output('blob')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取画布图片失败'))
    r.readAsDataURL(blob)
  })
}

function readImageDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    img.onerror = () => reject(new Error('解析画布图片尺寸失败'))
    img.src = dataUrl
  })
}
