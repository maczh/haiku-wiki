/**
 * 仅类型垫片（ambient module declaration）。
 *
 * OnlyOffice Web Comp 是以源码形式 vendored 进 `src/components/onlyoffice-web-comp`
 * 的第三方库，其自身的 tsconfig 与本项目严格模式并不一致（brotli-dec 等第三方代码
 * 未做完整类型标注，且有 `window.DocsAPI` 之类的环境断言）。因此本仓库的 `tsc --noEmit`
 * 直接把该目录从编译单元中排除（见 tsconfig.json 的 exclude），这里仅声明「本仓库实际
 * 用到的 API 表面」以满足类型检查。
 *
 * ⚠️ 这只是一个编译期声明：Vite/esbuild 在构建时仍按真实源码（`index.ts`）打包，
 * 并不会读取此 .d.ts。运行时行为与上游库完全一致。
 */

// 第三方源码里访问 window.DocsAPI（OnlyOffice SDK 注入的全局），本仓库不对其做类型建模
declare global {
  interface Window {
    DocsAPI?: any
  }
}

// exceljs 以动态 import 形式被 CSV 转换工具使用，其 npm 包未附带类型声明
declare module 'exceljs/dist/exceljs.min'

declare module '../onlyoffice-web-comp' {
  export type FileType = string

  export const FILE_TYPE: {
    DOCX: FileType
    XLSX: FileType
    PPTX: FileType
    [key: string]: FileType
  }

  export const ONLYOFFICE_ID: string
  export const ONLYOFFICE_CONTAINER_CONFIG: { PARENT_CLASS_NAME: string }

  export class OnlyOfficeManager {
    static create(options: {
      containerId: string
      fileType: FileType
      defaultFileName: string
      readOnly?: boolean
      lang?: string
      theme?: string
    }): Promise<OnlyOfficeManager>
    static createWithFile(
      options: { containerId: string; fileType: FileType; defaultFileName: string; readOnly?: boolean },
      file: File,
    ): Promise<OnlyOfficeManager>
    getEditor(): { subscribe(event: { type: string; fn: (...args: any[]) => void }): any }
    exportAsBlob(): Promise<{ blob: Blob; fileName: string }>
    onLoadingChange(cb: (state: { loading: boolean }) => void): (() => void) | undefined
    destroy(): void
  }
}

// 同一物理目录，从 `src/lib/officeDoc.ts` 引用的另一相对写法
declare module '../components/onlyoffice-web-comp' {
  export type FileType = string

  export const FILE_TYPE: {
    DOCX: FileType
    XLSX: FileType
    PPTX: FileType
    [key: string]: FileType
  }

  export const ONLYOFFICE_ID: string
  export const ONLYOFFICE_CONTAINER_CONFIG: { PARENT_CLASS_NAME: string }

  export class OnlyOfficeManager {
    static create(options: any): Promise<OnlyOfficeManager>
    static createWithFile(options: any, file: File): Promise<OnlyOfficeManager>
    getEditor(): { subscribe(event: { type: string; fn: (...args: any[]) => void }): any }
    exportAsBlob(): Promise<{ blob: Blob; fileName: string }>
    onLoadingChange(cb: (state: { loading: boolean }) => void): (() => void) | undefined
    destroy(): void
  }
}
