// 类型垫片：为 vendored 的 typo-md-editor ESM bundle 提供最小类型面。
//
// 该 bundle 是 self-contained（内部打包了 Vue / Milkdown / Mermaid），haiku 是 React 项目、
// 没有 `vue` 依赖，因此不引用 dist 自带的 index.d.ts（其 re-export 了 .vue 模块，无法解析）。
// 这里只声明本项目实际用到的导出；其余以 any 兜底，避免引入 vue 类型依赖。
//
// 注意：库的公开 API 以「命名导出」暴露（见 typo-md-editor 源码 src/index.ts：
//   `export { default as MdEditor } from './components/MdEditor.vue'`），**没有 default 导出**。
// 因此宿主必须写 `import { MdEditor as TypoMd, createApp, ... } from '.../typo-md-editor.js'`。
//
// 导入路径形如：`import { MdEditor as TypoMd, createApp, ensurePinia, typoPlugin, toHtml } from
//   '@/vendor/typo-md-editor/typo-md-editor.js'`（本文件与其同名 .js 相邻，TS 自动配对）。

export const MdEditor: any

export const typoPlugin: { install(app: any): void }
export function ensurePinia(): void
export function createApp(rootComponent: any, rootProps?: Record<string, any>): any
export function h(...args: any[]): any

export function toHtml(markdown: string, title?: string): Promise<string>
export function toMarkdown(markdown: string): string
export function rewriteImageSrcs(html: string, resolver: (src: string) => string): string

export type ImageUploader = (file: File) => Promise<string>

/** MdEditor `ready` 事件暴露的稳定门面（来自 typo-md-editor 的 EditorApi）。 */
export type EditorApi = {
  getMarkdown: () => Promise<string>
  getHTML: () => string
  loadMarkdown: (md: string) => void
  insert: (md: string) => void
  focus: () => void
  destroy: () => void
  getEditor: () => any
  setReadonly: (v: boolean) => void
  exportMarkdown: (filename?: string) => void
  exportHtml: (filename?: string) => Promise<void>
  print: () => Promise<void>
  openSettings: () => void
  openFind: () => void
}
