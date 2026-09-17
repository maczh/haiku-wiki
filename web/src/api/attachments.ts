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
