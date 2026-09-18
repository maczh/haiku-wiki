import { Segmented, Slider, Space, Tooltip, Typography } from 'antd'
import { ColumnWidthOutlined } from '@ant-design/icons'
import {
  READER_WIDTH_MAX,
  READER_WIDTH_MIN,
  READER_WIDTH_PRESETS,
  READER_WIDTH_STEP,
  useReaderWidth,
} from '../../lib/readerWidth'

interface Props {
  /** 紧凑模式（放在正文顶部右侧，不额外占位） */
  compact?: boolean
}

/**
 * 正文字号宽度调节器：三档 Segmented（标准 / 宽屏 / 全宽）+ 连续拖动条。
 * 选择写入 localStorage（见 lib/readerWidth.ts），阅读页与分享预览页共用，
 * 分享页访客未登录也生效（纯本地偏好，不上报服务端）。
 */
export default function WidthControl({ compact = false }: Props) {
  const { state, maxWidth, setMode, setWidth } = useReaderWidth()

  // 全宽时没有可拖动的目标值，用上限占位并禁用，避免「拖了没反应」
  const sliderValue = maxWidth ?? READER_WIDTH_MAX
  const segValue = state.mode === 'custom' ? '' : state.mode

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: 8,
        padding: compact ? '0 24px 8px' : '8px 24px',
        flexWrap: 'wrap',
      }}
    >
      <Space size={8} align="center">
        <Tooltip title="正文宽度">
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ColumnWidthOutlined />
            宽度
          </Typography.Text>
        </Tooltip>
        <Segmented
          size="small"
          value={segValue}
          options={READER_WIDTH_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          onChange={(v) => {
            const key = String(v) as 'standard' | 'wide' | 'full'
            setMode(key)
          }}
        />
        <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Slider
            min={READER_WIDTH_MIN}
            max={READER_WIDTH_MAX}
            step={READER_WIDTH_STEP}
            disabled={state.mode === 'full'}
            value={sliderValue}
            onChange={(v) => setWidth(Number(v))}
            tooltip={{ formatter: (v) => `${v}px` }}
            style={{ margin: 0, flex: 1 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12, width: 52, textAlign: 'right', flexShrink: 0 }}>
            {state.mode === 'full' ? '不限' : `${sliderValue}px`}
          </Typography.Text>
        </div>
      </Space>
    </div>
  )
}
