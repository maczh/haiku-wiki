// 第三方库类型补充：mammoth 无官方/社区类型，本地声明 shim。
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
