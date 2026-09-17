import { Button, Divider, Select, Tooltip } from 'antd'
import {
  AimOutlined,
  CompressOutlined,
  ExpandOutlined,
  MinusOutlined,
  OneToOneOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { MM_FONTS, type MmHandle } from './mmShared'

interface Props {
  handle: MmHandle
  /** 当前缩放比例（1 = 100%） */
  scale: number
  /** 全屏状态 */
  fullscreen: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  /** 复位到 100% */
  onReset: () => void
  /** 适应画布 */
  onFit: () => void
  onCenterRoot: () => void
  onToggleFullscreen: () => void
  /** 全局字体变更回调（作用于画布全部节点） */
  onFontChange: (fontFamily: string) => void
  /** 当前全局字体 */
  fontFamily: string
}

/**
 * 思维导图右下缩放工具条（仿 Simple Mind Map 官方 Demo）：
 *  字体选择 | 缩小 / 缩放比例 / 放大 | 复位 / 适应画布 / 根节点居中 / 全屏
 */
export default function MindmapZoomBar(p: Props) {
  const percent = Math.round(p.scale * 100)

  return (
    <div className="hk-mm-tb hk-mm-zoom">
      <Select
        size="small"
        variant="borderless"
        style={{ width: 110 }}
        value={p.fontFamily}
        options={MM_FONTS.map((f) => ({ value: f.value, label: f.label }))}
        onChange={(v) => p.onFontChange(v)}
      />
      <Divider type="vertical" style={{ margin: '0 2px' }} />
      <Tooltip title="缩小（Ctrl+-）">
        <Button type="text" size="small" icon={<MinusOutlined />} onClick={p.onZoomOut} />
      </Tooltip>
      <Tooltip title="复位到 100%">
        <Button
          type="text"
          size="small"
          onClick={p.onReset}
          style={{ minWidth: 48, fontSize: 12, padding: '0 4px' }}
        >
          {percent}%
        </Button>
      </Tooltip>
      <Tooltip title="放大（Ctrl+=）">
        <Button type="text" size="small" icon={<PlusOutlined />} onClick={p.onZoomIn} />
      </Tooltip>
      <Divider type="vertical" style={{ margin: '0 2px' }} />
      <Tooltip title="适应画布（内容铺满可视区）">
        <Button type="text" size="small" icon={<CompressOutlined />} onClick={p.onFit} />
      </Tooltip>
      <Tooltip title="根节点居中">
        <Button type="text" size="small" icon={<AimOutlined />} onClick={p.onCenterRoot} />
      </Tooltip>
      <Tooltip title="画布复位">
        <Button type="text" size="small" icon={<OneToOneOutlined />} onClick={p.onReset} />
      </Tooltip>
      <Divider type="vertical" style={{ margin: '0 2px' }} />
      <Tooltip title={p.fullscreen ? '退出全屏' : '全屏编辑'}>
        <Button type="text" size="small" icon={<ExpandOutlined />} onClick={p.onToggleFullscreen} />
      </Tooltip>
    </div>
  )
}
