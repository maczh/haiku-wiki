import { Button, Divider, Space, Tooltip } from 'antd'
import {
  BorderOutlined,
  CommentOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FunctionOutlined,
  HistoryOutlined,
  HighlightOutlined,
  LinkOutlined,
  NodeExpandOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  RedoOutlined,
  SaveOutlined,
  SisternodeOutlined,
  TagsOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import SaveIndicator, { type SaveStatus } from '../SaveIndicator'

interface Props {
  status: SaveStatus
  savedAt: string | null
  /** 格式刷激活中 */
  brushing: boolean
  /** 是否有选中节点（决定节点类按钮可用性） */
  hasActive: boolean
  onBack: () => void
  onForward: () => void
  onToggleBrush: () => void
  onAddSibling: () => void
  onAddChild: () => void
  onRemoveNode: () => void
  onPickImage: () => void
  onHyperlink: () => void
  onNote: () => void
  onTag: () => void
  onGeneralization: () => void
  onAssociativeLine: () => void
  onFormula: () => void
  onOuterFrame: () => void
  onSave: () => void
  onOpenVersions: () => void
  onExportPng: () => void
}

/**
 * 思维导图顶部浮动工具条（仿 Simple Mind Map 官方 Demo）：
 *  左：回退/前进/格式刷 | 同级节点/子节点/删除节点 | 图片/超链接/备注/标签/概要/关联线/公式/外框
 *  右：保存状态 + 立即保存 / 历史版本 / 导出 PNG
 * 浮动在画布之上（position:absolute），不占用画布高度。
 */
export default function MindmapTopToolbar(p: Props) {
  return (
    <>
      {/* 左：节点与元素操作 */}
      <div className="hk-mm-tb hk-mm-tb-left">
        <Space size={0} split={false}>
          <IconBtn title="回退（撤销上一步）" icon={<UndoOutlined />} onClick={p.onBack} />
          <IconBtn title="前进（恢复被撤销的操作）" icon={<RedoOutlined />} onClick={p.onForward} />
          <IconBtn
            title="格式刷：先选中源节点，再点击其它节点应用其样式；再次点击退出"
            icon={<HighlightOutlined />}
            onClick={p.onToggleBrush}
            active={p.brushing}
          />
        </Space>
        <Divider type="vertical" style={{ margin: '0 4px' }} />
        <Space size={0} split={false}>
          <IconBtn title="为选中节点添加同级节点" icon={<SisternodeOutlined />} disabled={!p.hasActive} onClick={p.onAddSibling} />
          <IconBtn title="为选中节点添加子节点" icon={<NodeExpandOutlined />} disabled={!p.hasActive} onClick={p.onAddChild} />
          <IconBtn title="删除选中节点及其子树" icon={<DeleteOutlined />} disabled={!p.hasActive} danger onClick={p.onRemoveNode} />
        </Space>
        <Divider type="vertical" style={{ margin: '0 4px' }} />
        <Space size={0} split={false}>
          <IconBtn title="插入图片" icon={<PictureOutlined />} disabled={!p.hasActive} onClick={p.onPickImage} />
          <IconBtn title="设置超链接" icon={<LinkOutlined />} disabled={!p.hasActive} onClick={p.onHyperlink} />
          <IconBtn title="添加备注" icon={<CommentOutlined />} disabled={!p.hasActive} onClick={p.onNote} />
          <IconBtn title="添加标签" icon={<TagsOutlined />} disabled={!p.hasActive} onClick={p.onTag} />
          <IconBtn title="添加概要（作用于选中节点范围）" icon={<NodeIndexOutlined />} disabled={!p.hasActive} onClick={p.onGeneralization} />
          <IconBtn title="添加关联线（依次点击两个节点）" icon={<HighlightOutlined rotate={45} />} disabled={!p.hasActive} onClick={p.onAssociativeLine} />
          <IconBtn title="插入公式" icon={<FunctionOutlined />} disabled={!p.hasActive} onClick={p.onFormula} />
          <IconBtn title="添加外框（框住选中节点）" icon={<BorderOutlined />} disabled={!p.hasActive} onClick={p.onOuterFrame} />
        </Space>
      </div>

      {/* 右：保存与导出 */}
      <div className="hk-mm-tb hk-mm-tb-right">
        <SaveIndicator status={p.status} savedAt={p.savedAt} />
        <Divider type="vertical" style={{ margin: '0 4px' }} />
        <Tooltip title="立即保存（生成手动版本快照）">
          <Button size="small" icon={<SaveOutlined />} onClick={p.onSave}>
            保存
          </Button>
        </Tooltip>
        <Tooltip title="历史版本">
          <Button size="small" icon={<HistoryOutlined />} onClick={p.onOpenVersions} />
        </Tooltip>
        <Tooltip title="导出 PNG 图片">
          <Button size="small" icon={<DownloadOutlined />} onClick={p.onExportPng} />
        </Tooltip>
      </div>
    </>
  )
}

function IconBtn({
  title,
  icon,
  onClick,
  disabled,
  danger,
  active,
}: {
  title: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
}) {
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        icon={icon}
        disabled={disabled}
        danger={danger}
        onClick={onClick}
        style={active ? { background: '#e6f0ff', color: '#2f54eb' } : undefined}
      />
    </Tooltip>
  )
}
