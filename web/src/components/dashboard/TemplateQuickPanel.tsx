import { useEffect, useMemo, useState } from 'react'
import { Card, Skeleton, Tooltip } from 'antd'
import { AppstoreOutlined, RightOutlined } from '@ant-design/icons'
import { listTemplates, pickCommonTemplates, type DocTemplate } from '../../api/templates'
import { iconForDocType } from '../../lib/fileIcon'
import { DOC_TYPE_LABEL } from '../../types'

interface Props {
  /** 选中模板后的动作：首页要再选知识库，文库页直接用当前库，差异交给父组件 */
  onPickTemplate: (t: DocTemplate) => void
  /** 「更多模板」入口（跳模板中心）；不传则不显示 */
  onMore?: () => void
  /** 展示条数 */
  limit?: number
  /** 文库页右侧宽度有限，紧凑模式下每行卡片更窄 */
  compact?: boolean
}

/**
 * 「常用模板」快捷创建板块（首页 Dashboard 与文库 Dashboard 共用）。
 *
 * 数据侧只有一次请求：拉全量模板后在前端按分类轮转抽样（pickCommonTemplates），
 * 保证各业务分类都能露脸，而不是被排序靠前的某一类占满。
 * 点击模板走创建流程，正文即模板正文 —— 与模板中心、新建文档里的画廊是同一套数据。
 */
export default function TemplateQuickPanel({ onPickTemplate, onMore, limit = 12, compact }: Props) {
  const [list, setList] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listTemplates()
      .then((r) => {
        if (alive) setList(r)
      })
      .catch(() => {
        /* 模板是增强区块：失败就不显示，不影响面板其它部分 */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const items = useMemo(() => pickCommonTemplates(list, limit), [list, limit])

  if (loading) {
    return (
      <Card size="small" title="常用模板" className="hk-tplq-card">
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    )
  }
  if (items.length === 0) return null

  return (
    <Card
      size="small"
      className="hk-tplq-card"
      data-testid="hk-template-quick"
      title={
        <span style={{ fontSize: 14 }}>
          <AppstoreOutlined style={{ marginRight: 6, color: '#2f54eb' }} />
          常用模板
        </span>
      }
      extra={
        onMore ? (
          <a style={{ fontSize: 12 }} onClick={onMore} data-testid="hk-template-quick-more">
            模板中心 <RightOutlined style={{ fontSize: 10 }} />
          </a>
        ) : (
          <span style={{ fontSize: 12, color: '#8a919f' }}>点击即可创建</span>
        )
      }
    >
      <div className={compact ? 'hk-tplq-grid hk-tplq-grid-compact' : 'hk-tplq-grid'}>
        {items.map((t) => (
          <Tooltip key={t.id} title={`${t.category} · ${DOC_TYPE_LABEL[t.doc_type] ?? t.doc_type}`}>
            <div
              className="hk-tplq-item"
              role="button"
              tabIndex={0}
              data-testid="hk-template-quick-item"
              onClick={() => onPickTemplate(t)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onPickTemplate(t)
              }}
            >
              <div className="hk-tplq-icon" style={{ color: iconForDocType(t.doc_type).color }}>
                {iconForDocType(t.doc_type).icon}
              </div>
              <div className="hk-tplq-name">{t.name}</div>
            </div>
          </Tooltip>
        ))}
      </div>
    </Card>
  )
}
