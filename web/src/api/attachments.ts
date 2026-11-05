import request from './request'
import type { FileAttachment } from '../types'

/** POST /api/attachments/prepare 的返回：附件引用 + 派生说明 */
export interface PrepareResult {
  /** 后端回填好派生格式（derived）与降级说明的附件引用 */
  ref: FileAttachment
  /** 非致命告警 */
  warning?: string
}

/** 附件导入后处理。 */
export async function prepareAttachment(input: {
  url: string
  filename: string
  size: number
}): Promise<PrepareResult> {
  return request.post('/attachments/prepare', input) as Promise<PrepareResult>
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
