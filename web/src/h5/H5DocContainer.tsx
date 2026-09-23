import type { ReactNode } from 'react'
import { Alert } from 'antd'
import H5ZoomStage from './H5ZoomStage'

interface Props {
  /** 文档内容 */
  children: ReactNode
  /** 是否为编辑态：编辑态占满高度并隐藏内层滚动（白板/待办/日历需要确定高度） */
  editing?: boolean
  /** 体验降级提示文案（白板 / 表格等复杂画布在移动端受限时给出） */
  degradedHint?: string
  /**
   * 画布型预览（思维导图 / PDF / DOCX 等）：外层套手势层，
   * 支持双指缩放 + 单指拖动，且不破坏默认划屏滚动。见 H5ZoomStage。
   */
  zoomable?: boolean
  /**
   * 让内容自己占满高度（如甘特图自带内部滚动）：内层不再滚动，子内容得到确定高度。
   * 未开启时内层 overflow:auto，长文档（Markdown 等）在容器内滚动。
   */
  fill?: boolean
}

/**
 * H5 文档内容容器：固定宽度、可滚动、触控友好，并用 100dvh 系列高度规避移动端地址栏抖动。
 *
 *   · 阅读态（editing=false）：内层 overflow:auto，长文（Markdown 等）在容器内滚动；
 *   · 编辑态（editing=true）：内层 overflow:hidden，由编辑器自身管理滚动与确定高度
 *     （如 WhiteboardEditor 的 height:100% 需要父级有确定高度）。
 *   · `fill`：把内层滚动交给内容自身（甘特等），子内容按 height:100% 铺满。
 *   · `zoomable`：包一层 H5ZoomStage，提供双指缩放 / 单指拖动手势。
 *   · 可选 `degradedHint`：在顶部展示一条信息提示（白板 / 表格等移动端体验降级）。
 */
export default function H5DocContainer({
  children,
  editing = false,
  degradedHint,
  zoomable = false,
  fill = false,
}: Props) {
  // ⚠️ 手势层必须拿到确定高度（height:100%）而不是 minHeight：
  // 它在内部自建滚动视口（见 H5ZoomStage），高度不确定时滚动容器会退化到祖先，
  // iOS 上就会出现「默认大小划不动、放大后反而能拖」。
  const inner = zoomable ? <H5ZoomStage style={{ height: '100%' }}>{children}</H5ZoomStage> : children
  return (
    <div
      data-h5-doc="1"
      data-h5-zoomable={zoomable ? '1' : '0'}
      data-h5-fill={fill ? '1' : '0'}
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
          overflow: editing || fill ? 'hidden' : 'auto',
          WebkitOverflowScrolling: 'touch',
          // 触控友好：禁用双击缩放 / 长按选择文本，避免编辑时误触。
          // 阅读态用 pan-y：显式允许纵向拖拽滚动（横向不滚），避免个别移动内核把
          // 容器当成不可滚动而吞掉上下划屏手势（配合 index.css 的 overflow-x:clip 修复）。
          // 注意：zoomable 时纵向滚动的放行交给 H5ZoomStage 自行切换，此处不写死 pan-y，
          // 否则放大后的单指拖动会被原生滚动抢走。
          touchAction: editing ? 'none' : zoomable ? undefined : 'pan-y',
        }}
      >
        {fill ? <div style={{ height: '100%', minHeight: 0 }}>{inner}</div> : inner}
      </div>
    </div>
  )
}
