// 第三方库类型补充：mammoth 无官方/社区类型，本地声明 shim。
// luckysheet 随包的 dist 不含 .d.ts（package.json 也没有 types 字段），同样声明最小 API 面。
// 注：思维导图已换成 vendored 的 mindmap-vite（自带类型），无需 simple-mind-map 的 shim。

declare module 'mammoth' {
  export interface ImageConverterResult {
    src: string
  }
  export interface ImageInput {
    read(encoding: string): Promise<string>
    contentType: string
  }
  export interface ConvertOptions {
    convertImage?: (image: ImageInput) => Promise<ImageConverterResult>
    styleMap?: string[]
  }
  export interface ConvertResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }
  export const images: {
    imgElement(func: (image: ImageInput) => Promise<ImageConverterResult>): ConvertOptions['convertImage']
  }
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: ConvertOptions): Promise<ConvertResult>
}


declare module 'jquery-mousewheel' {
  const install: (jquery: typeof import('jquery')) => void
  export default install
}

/**
 * spectrum-colorpicker（v1.8.1）：UMD 包，无官方 TS 类型。
 * 它会在加载时把 `$.fn.spectrum` 挂到 require('jquery') 返回的同一个 jQuery 实例上，
 * 而本项目的 window.$ / window.jQuery 正是该实例，因此 Luckysheet 内部
 * `$(".luckysheet-color-selected").spectrum(...)` 可以正常调用（修复 Bug A）。
 */
declare module 'spectrum-colorpicker' {
  const spectrum: unknown
  export default spectrum
}

/** spectrum 自带样式（取色面板必备，否则面板无样式/不可交互） */
declare module 'spectrum-colorpicker/spectrum.css'

/**
 * luckysheet（v2.1.13）：dist 只有 UMD/ESM 产物，没有类型声明。
 * 这里只声明项目真正用到的入口（create / destroy / getAllSheets），
 * 其余大量导出（getSheetData、setCellValue…）保持 unknown，避免在 shim 里复刻整套 API。
 */
declare module 'luckysheet' {
  export interface LuckysheetHook {
    [hookName: string]: ((...args: unknown[]) => void) | undefined
  }
  export interface LuckysheetCreateOptions {
    /** 容器元素 id（Luckysheet 按 id 取 DOM，不接受元素本身） */
    container: string
    lang?: string
    title?: string
    data?: unknown
    allowEdit?: boolean
    allowCopy?: boolean
    showinfobar?: boolean
    showtoolbar?: boolean
    showtoolbarConfig?: Record<string, boolean>
    showsheetbar?: boolean
    showsheetbarConfig?: Record<string, boolean>
    showstatisticBar?: boolean
    showstatisticBarConfig?: Record<string, boolean>
    sheetFormulaBar?: boolean
    enableAddRow?: boolean
    enableAddBackTop?: boolean
    defaultColWidth?: number
    defaultRowHeight?: number
    hook?: LuckysheetHook
    [key: string]: unknown
  }
  const luckysheet: {
    create(options: LuckysheetCreateOptions): void
    destroy(): void
    getAllSheets(): unknown
    [key: string]: unknown
  }
  export default luckysheet
}
