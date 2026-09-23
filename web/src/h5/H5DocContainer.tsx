import type { ReactNode } from 'react'
import { Alert } from 'antd'

interface Props {
  /** 文档内容 */
  children: ReactNode
  /** 是否为编辑态：编辑态占满高度并隐藏内层滚动（白板/待办/日历需要确定高度） */
  editing?: boolean
  /** 体验降级提示文案（白板 / 表格等复杂画布在移动端受限时给出） */
  degradedHint?: string
}

/**
 * H5 文档内容容器：固定宽度、可滚动、触控友好，并用 100dvh 系列高度规避移动端地址栏抖动。
 *
 *   · 阅读态（editing=false）：内层 overflow:auto，长文（Markdown 等）在容器内滚动；
 *   · 编辑态（editing=true）：内层 overflow:hidden，由编辑器自身管理滚动与确定高度
 *     （如 WhiteboardEditor 的 height:100% 需要父级有确定高度）。
 *   · 可选 `degradedHint`：在顶部展示一条信息提示（白板 / 表格等移动端体验降级）。
 */
export default function H5DocContainer({ children, editing = false, degradedHint }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#fff',
      }}
    >
      {degradedHint && (
        <Alert
          type="info"
          showIcon
          message={degradedHint}
          style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid #f0f2f5' }}
        />
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: editing ? 'hidden' : 'auto',
          WebkitOverflowScrolling: 'touch',
          // 触控友好：禁用双击缩放 / 长按选择文本，避免编辑时误触
          touchAction: editing ? 'none' : 'manipulation',
        }}
      >
        {children}
      </div>
    </div>
  )
}
