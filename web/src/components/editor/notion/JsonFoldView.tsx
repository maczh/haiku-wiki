import { useEffect, useRef } from 'react'
import { jsonFoldFromText } from '../../../lib/jsonFold'

/**
 * 接口文档里 JSON（返回结果 / 返回结果示例 / 请求体折叠预览）的可折叠展示组件。
 * 纯只读；编辑请在对应的输入框完成。非法 JSON 回退为原文。
 *
 * 高度策略：默认**不限制高度**，容器随内容自动撑开（接口调试返回多长就展示多长），
 * JSON 节点折叠/展开时高度随之自适应；仅当显式传入 maxHeight 时才限高滚动。
 */
export default function JsonFoldView({
  value,
  maxHeight,
  empty,
}: {
  value: string
  maxHeight?: number
  empty?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.innerHTML = ''
    if (!value || !value.trim()) {
      if (empty) c.textContent = empty
      return
    }
    const node = jsonFoldFromText(value)
    if (!node) {
      // 非法 JSON：原样展示，不阻断阅读
      const pre = document.createElement('pre')
      pre.style.margin = '0'
      pre.style.whiteSpace = 'pre-wrap'
      pre.style.wordBreak = 'break-all'
      pre.textContent = value
      c.appendChild(pre)
      return
    }
    c.appendChild(node)
  }, [value, empty])

  return (
    <div
      style={{
        background: '#f7f8fa',
        padding: 12,
        borderRadius: 6,
        fontSize: 13,
        overflow: 'auto',
        // maxHeight 未传时不限高：容器随内容（含折叠/展开）自动伸缩
        ...(maxHeight ? { maxHeight } : {}),
        fontFamily: 'monospace',
      }}
      ref={ref}
    />
  )
}
