// 第三方库类型补充：mammoth 无官方/社区类型，本地声明 shim。
// x-data-spreadsheet 自带 src/index.d.ts（package.json types 字段），无需重复声明。

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
