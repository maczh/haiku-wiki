// 第三方库类型补充：mammoth 无官方/社区类型，本地声明 shim。
// x-data-spreadsheet 自带 src/index.d.ts（package.json types 字段），无需重复声明。
// simple-mind-map 无官方 TS 类型，本地声明项目用到的最小 API 面。

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

// simple-mind-map（wanglin2）：仅声明本项目用到的 API（v0.14.x）
declare module 'simple-mind-map' {
  /** simple-mind-map 节点数据树（与 docs.content v2 契约同构） */
  export interface SmmDataNode {
    data: { text: string; expand: boolean; uid?: string; [key: string]: unknown }
    children: SmmDataNode[]
  }
  export interface SmmOptions {
    el: HTMLElement
    data?: SmmDataNode
    readonly?: boolean
    layout?: string
    initRootNodePosition?: Array<number | string>
    enableAutoEnterTextEditWhenKeydown?: boolean
    mousewheelAction?: string
    [key: string]: unknown
  }
  export default class MindMap {
    constructor(options: SmmOptions)
    static usePlugin(plugin: unknown, ...args: unknown[]): typeof MindMap
    getData(withOnlySet?: boolean): SmmDataNode
    setData(data?: SmmDataNode | null): void
    execCommand(command: string, ...args: unknown[]): void
    /* eslint-disable @typescript-eslint/no-explicit-any */
    on(event: string, handler: (...args: any[]) => void): void
    off(event: string, handler: (...args: any[]) => void): void
    /* eslint-enable @typescript-eslint/no-explicit-any */
    destroy(): void
    view: { enlarge(): void; narrow(): void; fit(): void; reset(): void }
    renderer: { activeNodeList: unknown[]; setRootNodeCenter(): void }
    export(type: string, isDownload?: boolean, name?: string, ...args: unknown[]): Promise<string | Blob | boolean>
  }
}

declare module 'simple-mind-map/src/plugins/Drag.js' {
  const DragPlugin: unknown
  export default DragPlugin
}

declare module 'simple-mind-map/src/plugins/Export.js' {
  const ExportPlugin: unknown
  export default ExportPlugin
}
