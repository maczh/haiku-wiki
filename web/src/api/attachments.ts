import request from './request'
import type { FileAttachment } from '../types'

/** POST /api/attachments/prepare 的返回：附件引用 + 派生说明 */
export interface PrepareResult {
  /** 后端回填好派生格式（derived）与降级说明的附件引用 */
  ref: FileAttachment
  /** 非致命告警（例：DWG 转换失败但仍保留了原文件） */
  warning?: string
}

/**
 * 附件导入后处理：对 CAD 类附件触发后端转换，把 .dwg/.dxf 转成 .svg/.png 并回填地址。
 *
 * 约定：转换失败**不算导入失败**——原文件已落盘，返回 warning 供界面提示。
 */
export async function prepareAttachment(input: {
  url: string
  filename: string
  size: number
}): Promise<PrepareResult> {
  return request.post('/attachments/prepare', input) as Promise<PrepareResult>
}

/** GET /api/cad/converter：当前后端是否具备 DWG 转换能力（用于界面上的能力提示） */
export async function getCadConverterStatus(): Promise<{ available: boolean; detail: string }> {
  return request.get('/cad/converter') as Promise<{ available: boolean; detail: string }>
}

/** POST /api/attachments/pptx-localize 的结果 */
export interface PptxLocalizeResult {
  /** 压缩包里发现的外链图片数量 */
  external: number
  /** 成功下载并写回压缩包的数量 */
  embedded: number
  /** 文件是否被改写（false 表示无需处理，可直接用现有字节渲染） */
  changed: boolean
  /** 顺带入库的图片 URL */
  assets?: string[]
  /** 下载失败的 URL 与原因 */
  failures?: string[]
  /** 一句话结果描述 */
  note: string
}

/**
 * 把 pptx 里的外链（网络）图片下载后嵌入原文件。
 *
 * 为什么放在服务端：浏览器端要抓跨域图片会受 CORS 限制，而且图片得写回压缩包才算真正
 * 「本地化」——前端无法改源文件。接口幂等，历史文件在首次打开时补做一次即可。
 */
export async function localizePptx(url: string): Promise<PptxLocalizeResult> {
  return request.post('/attachments/pptx-localize', { url }) as Promise<PptxLocalizeResult>
}
