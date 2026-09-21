import { Button, Modal, Space, Tag, Typography } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import DocContent from '../reader/DocContent'
import type { DocTemplate } from '../../api/templates'
import { DOC_TYPE_LABEL } from '../../types'
import { iconForDocType } from '../../lib/fileIcon'

interface Props {
  /** 当前预览的模板；null 时不渲染（由调用方控制开关） */
  tpl: DocTemplate | null
  /** 点「使用此模板」：真正套用模板创建文档 */
  onUse: (t: DocTemplate) => void
  /** 点「换一个」：关闭预览回到画廊继续挑 */
  onCancel: () => void
}

/**
 * 模板预览弹窗（仿语雀 / WPS 的「模板详情」）。
 *
 * 选模板不再「点了就直接建文档」——先在这里看清楚正文长什么样：
 *   - 满意 → 「使用此模板」交给调用方去走新建流程；
 *   - 不满意 → 「换一个」关掉预览回到画廊，画廊的筛选状态保持不变。
 *
 * 正文渲染复用阅读分发组件 DocContent：markdown 走 MarkdownView，
 * 表格 / 脑图 / 流程图 / 甘特图 各自按需加载渲染器（内部全是 lazy 动态导入，
 * 不会把重型库拖进首屏 chunk）。预览是只读的，不传 docId，避免任何写回。
 */
export default function TemplatePreview({ tpl, onUse, onCancel }: Props) {
  const spec = tpl ? iconForDocType(tpl.doc_type, tpl.title) : null
  return (
    <Modal
      open={tpl != null}
      onCancel={onCancel}
      width={900}
      style={{ top: 40 }}
      bodyStyle={{ height: 560, overflow: 'auto', padding: '8px 16px', background: '#fff' }}
      destroyOnClose
      title={
        tpl ? (
          <Space size={8}>
            {spec && <span style={{ color: spec.color, fontSize: 16 }}>{spec.icon}</span>}
            <span style={{ fontWeight: 600 }}>{tpl.name}</span>
            <Tag bordered={false} color="blue">
              {DOC_TYPE_LABEL[tpl.doc_type] ?? tpl.doc_type}
            </Tag>
            <span style={{ fontSize: 12, color: '#8a919f', fontWeight: 400 }}>{tpl.category}</span>
          </Space>
        ) : (
          '模板预览'
        )
      }
      footer={
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>
            默认标题：{tpl?.title || '—'}
          </Typography.Text>
          <Button onClick={onCancel}>换一个</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={() => tpl && onUse(tpl)}>
            使用此模板
          </Button>
        </Space>
      }
    >
      {/* 用 key 强制在切换模板时重建渲染器实例，避免上一个模板的画布状态残留 */}
      <div key={tpl?.id ?? 0} style={{ minHeight: 480 }}>
        <DocContent docType={tpl?.doc_type ?? 'markdown'} content={tpl?.content ?? ''} widthEditable={false} />
      </div>
    </Modal>
  )
}
