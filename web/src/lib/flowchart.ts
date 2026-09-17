// 流程图内容契约（架构文档 §5.2）——content 直接存 mermaid 源码字符串（非 JSON）。
// 渲染前必须 parse 预校验（suppressErrors），语法错误不崩溃、行内提示。

import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict', // mermaid 自带 sanitize，XSS 边界
  theme: 'default',
})

let renderSeq = 0

export interface FlowchartRenderResult {
  svg?: string
  error?: string
}

/** 预校验 + 渲染；错误返回行内提示信息（保留调用方上一次成功结果） */
export async function renderFlowchart(src: string): Promise<FlowchartRenderResult> {
  if (!src || src.trim() === '') {
    return { error: '流程图内容为空' }
  }
  try {
    const parsed = await mermaid.parse(src, { suppressErrors: true })
    if (!parsed) {
      return { error: '流程图语法有误，请检查后重试' }
    }
    const { svg } = await mermaid.render(`hk-mermaid-${++renderSeq}`, src)
    return { svg }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // mermaid 错误信息可能冗长，截取前 200 字符
    return { error: msg.length > 200 ? `${msg.slice(0, 200)}…` : msg }
  }
}

/** 空文档默认值 */
export const DEFAULT_FLOWCHART = 'flowchart TD\n  A[开始] --> B[结束]'
