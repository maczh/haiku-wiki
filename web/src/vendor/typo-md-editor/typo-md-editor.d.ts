// 类型垫片：为 vendored 的 typo-md-editor（v1-react 分支，React 组件）提供最小类型面。
//
// 该 bundle 是 self-contained（内部打包了 Milkdown / Crepe / Mermaid / KaTeX，React 作为对等依赖
// externalize，由宿主提供；Vue 已随 Crepe 打包进 bundle，不再需要宿主安装 vue）。
// 项目只用到其中导出的 React 组件 MdEditor 与纯函数 toHtml，其余以 any/最小类型兜底，
// 避免引入 vue 类型依赖。
//
// 公开 API 以「命名导出」暴露（见 typo-md-editor 源码 src/index.ts）：
//   `export { default as MdEditor, type EditorApi, type MdEditorProps } from './components/MdEditor'`
//   `export { toHtml, toMarkdown, toPdf, exportDocument, downloadBlob } from './utils/exporter'`
//   `export { fileToDataUrl, rewriteImageSrcs } from './utils/images'`
// 因此宿主写：
//   `import { MdEditor, type EditorApi, type ImageUploader } from '.../typo-md-editor.js'`

import type { ForwardRefExoticComponent, ReactElement, RefAttributes } from 'react'

/** MdEditor `ready` 事件暴露的稳定门面（来自 typo-md-editor 的 EditorApi）。 */
export interface EditorApi {
  getMarkdown: () => Promise<string>
  getHTML: () => string
  loadMarkdown: (md: string) => void
  insert: (md: string) => void
  focus: () => void
  destroy: () => void
  getEditor: () => unknown
  setReadonly: (v: boolean) => void
  exportMarkdown: (filename?: string) => void
  exportHtml: (filename?: string) => Promise<void>
  print: () => Promise<void>
  openSettings: () => void
  openFind: () => void
}

export interface MdEditorProps {
  /** v-model：Markdown 双向绑定（编辑器真相源）。 */
  modelValue?: string
  /** 主题 id（github/gothic/newsprint/night/pixyll/whitey）。 */
  theme?: string
  language?: string
  readonly?: boolean
  showToolbar?: boolean
  showTableToolbar?: boolean
  showContextMenu?: boolean
  hotkeys?: boolean
  /** WYSIWYG 内容列宽度，占编辑器面板的百分比（默认 80）。 */
  contentWidth?: number
  fontSize?: number
  lineHeight?: number
  fontFamily?: string
  customCss?: string
  /** 图片上传回调（粘贴/拖拽/选择文件/image-block 统一走它）。 */
  onUpload?: ImageUploader
  /** 本地图片 src 显示解析（默认恒等）。 */
  resolveImageSrc?: (src: string) => string
  onUpdateModelValue?: (v: string) => void
  onSave?: () => void
  onReady?: (api: EditorApi) => void
}

export type ImageUploader = (file: File) => Promise<string>

/** 包内唯一公共组件（React forwardRef）：md 文档编辑器门面。 */
export const MdEditor: ForwardRefExoticComponent<MdEditorProps & RefAttributes<EditorApi>>

/** 右侧大纲面板（无 props，内部读取共享 editor store 的 outline）。 */
export const OutlinePanel: () => ReactElement

/** 编辑器共享 store 的 React hook（OutlinePanel 与 MdEditor 同源单例）。 */
export function useEditorStore(): {
  doc: { name: string; content: string; dirty: boolean }
  outline: Array<{ id: string; text: string; level: number; children?: unknown[] }>
  cursor: { line: number; col: number }
  wordCount: number
}

/** Markdown → 自包含 HTML 文档（remark→rehype→highlight→KaTeX 预渲染）。 */
export function toHtml(markdown: string, title?: string): Promise<string>
export function toMarkdown(markdown: string): string
export function rewriteImageSrcs(html: string, resolver: (src: string) => string): string
export function downloadBlob(blob: Blob, filename: string): void
export function toPdf(html: string): Promise<void>
export function exportDocument(markdown: string, format: string, baseName?: string): Promise<void>
