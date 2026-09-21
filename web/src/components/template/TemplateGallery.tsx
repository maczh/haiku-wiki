import { useEffect, useMemo, useState } from 'react'
import { Empty, Input, Spin, Tag, Tooltip } from 'antd'
import { FileAddOutlined, SearchOutlined } from '@ant-design/icons'
import {
  listTemplates,
  listTemplateCategories,
  type DocTemplate,
  type TemplateCategory,
} from '../../api/templates'
import { DOC_TYPE_LABEL, type DocType } from '../../types'
import { iconForDocType } from '../../lib/fileIcon'

interface Props {
  /** 初次进入时预选的文档类型（来自「新建文档」下拉所选的类型） */
  initialDocType?: DocType
  /** 选中某个模板（使用该模板创建文档） */
  onSelect: (t: DocTemplate) => void
  /** 选中「空白文档」入口（仅在 showBlank 时渲染，且 gallery 内嵌在弹窗时由调用方决定） */
  onSelectBlank?: (docType: DocType) => void
  /** 是否在卡片网格顶部展示「空白文档」入口（页面态默认展示） */
  showBlank?: boolean
}

const ALL = 'all'

/**
 * 文档模板画廊（仿语雀 / WPS）。
 *
 * 设计上是一个「内容体」组件：不自带 Modal 外壳，调用方既可把它放进
 * `<Modal>`（新建文档流程），也可直接作为整页渲染（模板中心）。
 * 左侧分类导航 + 顶部类型筛选 + 关键字搜索 + 卡片网格。
 */
export default function TemplateGallery({
  initialDocType,
  onSelect,
  onSelectBlank,
  showBlank = true,
}: Props) {
  const [cats, setCats] = useState<TemplateCategory[]>([])
  const [catLoading, setCatLoading] = useState(true)
  const [activeCat, setActiveCat] = useState<string>(ALL)
  const [docType, setDocType] = useState<DocType | typeof ALL>(initialDocType ?? ALL)
  const [keyword, setKeyword] = useState('')
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [tplLoading, setTplLoading] = useState(true)

  // 分类聚合（左侧导航），与类型筛选相互独立
  useEffect(() => {
    listTemplateCategories()
      .then(setCats)
      .catch(() => setCats([]))
      .finally(() => setCatLoading(false))
  }, [])

  // 模板列表：随「分类」「类型」变化重新拉取（关键字只在本地过滤）
  useEffect(() => {
    setTplLoading(true)
    const q: { category?: string; doc_type?: DocType } = {}
    if (activeCat !== ALL) q.category = activeCat
    if (docType !== ALL) q.doc_type = docType
    listTemplates(q)
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setTplLoading(false))
  }, [activeCat, docType])

  // 类型筛选项：取自当前分类（或全部分类）在 categories 聚合里的 doc_types。
  // 这样类型下拉不会随「已选类型」收窄而自相矛盾。
  const typeOptions: DocType[] = useMemo(() => {
    const pool = activeCat === ALL ? cats : cats.filter((c) => c.category === activeCat)
    const set = new Set<DocType>()
    pool.forEach((c) => c.doc_types.forEach((d) => set.add(d)))
    return Array.from(set)
  }, [cats, activeCat])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return templates
    return templates.filter(
      (t) => t.name.toLowerCase().includes(k) || t.title.toLowerCase().includes(k),
    )
  }, [templates, keyword])

  function pickCat(cat: string) {
    setActiveCat(cat)
    // 切换分类后，当前类型可能不在新分类里 —— 重置为「全部类型」
    setDocType(ALL)
  }

  function blankType(): DocType {
    return docType === ALL ? 'markdown' : (docType as DocType)
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 360 }}>
      {/* 左侧分类导航 */}
      <div
        style={{
          width: 168,
          flexShrink: 0,
          borderRight: '1px solid #ebedf0',
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        <CatItem
          label="全部模板"
          count={cats.reduce((s, c) => s + c.count, 0)}
          active={activeCat === ALL}
          loading={catLoading}
          onClick={() => pickCat(ALL)}
        />
        {cats.map((c) => (
          <CatItem
            key={c.category}
            label={c.category}
            count={c.count}
            active={activeCat === c.category}
            loading={catLoading}
            onClick={() => pickCat(c.category)}
          />
        ))}
      </div>

      {/* 右侧内容 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '8px 12px' }}>
        {/* 顶部工具条：类型筛选 + 搜索 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <TypeChip label="全部类型" active={docType === ALL} onClick={() => setDocType(ALL)} />
            {typeOptions.map((t) => (
              <TypeChip
                key={t}
                label={DOC_TYPE_LABEL[t]}
                active={docType === t}
                onClick={() => setDocType(t)}
              />
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <Input
              allowClear
              size="small"
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder="搜索模板名称…"
              style={{ maxWidth: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>

        {/* 卡片网格 */}
        {tplLoading ? (
          <Spin style={{ display: 'block', margin: '48px auto' }} />
        ) : (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {showBlank && onSelectBlank && (
              <button
                type="button"
                onClick={() => onSelectBlank(blankType())}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  height: 96,
                  border: '1px dashed #d9d9d9',
                  borderRadius: 8,
                  background: '#fafafa',
                  cursor: 'pointer',
                  color: '#8a919f',
                }}
              >
                <FileAddOutlined style={{ fontSize: 22 }} />
                <span style={{ fontSize: 13 }}>空白文档</span>
              </button>
            )}
            {filtered.map((t) => {
              const spec = iconForDocType(t.doc_type, t.title)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelect(t)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 96,
                    padding: '0 14px',
                    border: '1px solid #ebedf0',
                    borderRadius: 8,
                    background: '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#2f54eb')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#ebedf0')}
                >
                  <span style={{ fontSize: 26, color: spec.color, flexShrink: 0 }}>{spec.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <Tooltip title={t.name}>
                      <span
                        style={{
                          display: 'block',
                          fontWeight: 600,
                          fontSize: 14,
                          color: '#1f2329',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.name}
                      </span>
                    </Tooltip>
                    <span style={{ display: 'block', marginTop: 6 }}>
                      <Tag color="default" style={{ margin: 0, fontSize: 12 }}>
                        {DOC_TYPE_LABEL[t.doc_type]}
                      </Tag>
                    </span>
                  </span>
                </button>
              )
            })}
            {!showBlank && filtered.length === 0 && (
              <Empty description="该分类下暂无模板" style={{ gridColumn: '1 / -1', marginTop: 40 }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CatItem({
  label,
  count,
  active,
  loading,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  loading: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={loading ? undefined : onClick}
      style={{
        padding: '8px 16px',
        cursor: loading ? 'default' : 'pointer',
        fontSize: 13,
        color: active ? '#2f54eb' : '#5f6672',
        background: active ? '#eef2ff' : 'transparent',
        borderLeft: active ? '2px solid #2f54eb' : '2px solid transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count !== undefined && (
        <span style={{ color: '#b4b9c1', fontSize: 12, marginLeft: 8 }}>{count}</span>
      )}
    </div>
  )
}

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 12px',
        borderRadius: 14,
        border: active ? '1px solid #2f54eb' : '1px solid #ebedf0',
        background: active ? '#2f54eb' : '#fff',
        color: active ? '#fff' : '#5f6672',
        cursor: 'pointer',
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}
