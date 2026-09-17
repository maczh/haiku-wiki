import request from './request'

/** POST /api/mindmap/parse 的返回：解析好的内置思维导图正文 */
export interface MindmapParseResult {
  /** 建议标题（取根节点文本） */
  title: string
  /** 内置 .smm（v2 契约）正文，可直接落库 */
  content: string
  doc_type: 'mindmap'
}

/**
 * 把外部思维导图文件解析成内置思维导图。
 *
 * 支持 .smm / .km / .xmind / .mm；解析放在服务端的原因：
 * .xmind 是 zip 包（要解压并兼容新旧两种内部结构），浏览器侧得额外引解压库，
 * 而服务端能四种格式共用一套实现与错误提示。
 */
export async function parseMindmapFile(file: File): Promise<MindmapParseResult> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/mindmap/parse', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<MindmapParseResult>
}
