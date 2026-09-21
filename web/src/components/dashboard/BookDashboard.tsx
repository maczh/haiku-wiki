import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Empty, Input, Row, Col, Spin, Tag, Tooltip } from 'antd'
import {
  CalendarOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  ImportOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import { getWorkbench } from '../../api/workbench'
import { search } from '../../api/search'
// 文库工作台样式随组件走：BookPage 与 DashboardPage 是两个路由 chunk，
// 在页面里导 CSS 会让「样式加载与否」取决于用户先访问了哪一页
import './dashboard.css'
import { CalendarWorkbenchCard, GanttWorkbenchCard, TodoWorkbenchCard } from './WorkbenchCards'
import TemplateQuickPanel from './TemplateQuickPanel'
import type { DocTemplate } from '../../api/templates'
import { DOC_TYPE_LABEL, type DocNode, type DocType, type SearchHit, type WorkbenchDoc } from '../../types'
import { hasWorkbench, pickWorkbenchDocs } from '../../lib/workbench'
import { relativeTime } from '../../lib/dashboard'

/**
 * BookDashboard —— 知识库页右侧**未选中文档时**的「文库工作台」。
 *
 * 背景：此前这里只显示一句「从左侧选择一篇文档」，对 30+ 篇文档的文库是巨大的空间浪费。
 * 用户诉求：「设计功能丰富的组件方便用户快速操作，协助用户办公」。
 *
 * 信息架构沿用全局首页 Dashboard 的优先级，但范围严格限定在**单个知识库**：
 *   1. 概览条：文库统计 + 快捷操作（新建文档 / 新建目录 / 导入，仅可写时展示）
 *   2. 工作台三卡：待办 / 甘特图 / 日历（本书内有这类文档才显示，无则整块隐藏）
 *   3. 文库内搜索（标题 + markdown 正文，走后端 /search?book_id= —— 不是本地假搜索，
 *      与全局搜索同一套可见性口径，只是范围收窄）
 *   4. 最近更新（从树数据派生，零额外请求）
 */

interface BookDashboardProps {
  bookId: number
  bookName: string
  /** 本书全部文档（树接口的扁平结果），用于统计与「最近更新」 */
  docs: DocNode[]
  canWrite: boolean
  /** 打开一篇文档（BookPage 里等价于把 docId 写进 URL 参数） */
  onOpenDoc: (docId: number) => void
  onNewDoc: () => void
  onNewFolder: () => void
  onImport: () => void
  /** 常用模板板块：选中模板后按它在本库内创建文档（跳过模板画廊，仍可改存放位置） */
  onCreateFromTemplate?: (t: DocTemplate) => void
}

/** 搜索防抖间隔（ms）：比打字慢一点点，比请求快很多 */
const SEARCH_DEBOUNCE = 300
/** 最近更新条数：一眼能扫完，再多就该用搜索了 */
const RECENT_LIMIT = 8

export default function BookDashboard({
  bookId,
  bookName,
  docs,
  canWrite,
  onOpenDoc,
  onNewDoc,
  onNewFolder,
  onImport,
  onCreateFromTemplate,
}: BookDashboardProps) {
  const [wb, setWb] = useState<{ items: WorkbenchDoc[]; counts: Record<string, number> } | null>(null)
  const [wbLoading, setWbLoading] = useState(true)
  const [kw, setKw] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 本书工作台数据：book_id 限定，后端返回带正文的最近条目供聚合 */
  useEffect(() => {
    let alive = true
    setWbLoading(true)
    getWorkbench(8, bookId)
      .then((v) => {
        if (alive) setWb(v)
      })
      .catch(() => {
        // 工作台失败不该拖垮整个面板：三卡直接按「无」处理
        if (alive) setWb({ items: [], counts: {} })
      })
      .finally(() => {
        if (alive) setWbLoading(false)
      })
    return () => {
      alive = false
    }
  }, [bookId])

  const todoDocs = useMemo(() => (wb ? pickWorkbenchDocs(wb.items, 'todo') : []), [wb])
  const ganttDocs = useMemo(() => (wb ? pickWorkbenchDocs(wb.items, 'gantt') : []), [wb])
  const calendarDocs = useMemo(() => (wb ? pickWorkbenchDocs(wb.items, 'calendar') : []), [wb])
  const showWorkbench = useMemo(() => (wb ? hasWorkbench(wb.items) : false), [wb])
  /** 实际要渲染的卡数：决定单卡时占满整行、双卡时各半 */
  const showWorkbenchCardCount = useMemo(
    () => [todoDocs, ganttDocs, calendarDocs].filter((a) => a.length > 0).length,
    [todoDocs, ganttDocs, calendarDocs],
  )

  /** 最近更新：树是扁平的，直接排序即可；目录不承载正文，不进这个列表 */
  const recent = useMemo(
    () =>
      [...docs]
        .filter((d) => d.doc_type !== 'folder')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, RECENT_LIMIT),
    [docs],
  )

  const folderCount = useMemo(() => docs.filter((d) => d.doc_type === 'folder').length, [docs])
  /** 结构化文档（待办/甘特/日历）是「办公」的主要载体，单独计数并在概览里点名 */
  const structuredCount = useMemo(
    () => docs.filter((d) => ['todo', 'gantt', 'calendar'].includes(d.doc_type)).length,
    [docs],
  )
  const lastUpdated = useMemo(() => {
    // 不用 Array.prototype.at：项目 tsconfig 的 lib 目标低于 es2022
    const sorted = docs.map((d) => d.updated_at).sort()
    return docs.length > 0 ? sorted[sorted.length - 1] : undefined
  }, [docs])

  const doSearch = useCallback(
    (q: string) => {
      const query = q.trim()
      if (!query) {
        setHits(null)
        return
      }
      setSearching(true)
      search(query, bookId)
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    },
    [bookId],
  )

  const onSearchChange = useCallback(
    (q: string) => {
      setKw(q)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => doSearch(q), SEARCH_DEBOUNCE)
    },
    [doSearch],
  )

  // 卸载时清掉挂着的防抖定时器，避免打完字离开页面后还发请求
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const openHit = useCallback(
    (docId: number) => {
      setKw('')
      setHits(null)
      onOpenDoc(docId)
    },
    [onOpenDoc],
  )

  return (
    <div className="hk-bdash" data-testid="hk-book-dashboard">
      {/* ---------- 概览条：统计 + 快捷操作 ---------- */}
      <div className="hk-bdash-hero">
        <div className="hk-bdash-hero-main">
          <h2 className="hk-bdash-title">{bookName}</h2>
          <div className="hk-bdash-meta">
            <span>{docs.length} 篇文档</span>
            <span className="hk-bdash-dot">·</span>
            <span>{folderCount} 个目录</span>
            {structuredCount > 0 && (
              <>
                <span className="hk-bdash-dot">·</span>
                <span>{structuredCount} 篇办公文档（待办 / 甘特 / 日历）</span>
              </>
            )}
            {lastUpdated && (
              <>
                <span className="hk-bdash-dot">·</span>
                <span>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  最近更新 {relativeTime(lastUpdated)}
                </span>
              </>
            )}
          </div>
        </div>
        {canWrite && (
          <div className="hk-bdash-actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={onNewDoc}>
              新建文档
            </Button>
            <Button icon={<FolderAddOutlined />} onClick={onNewFolder}>
              新建目录
            </Button>
            <Tooltip title="导入 Markdown / Word / Excel 等文件">
              <Button icon={<ImportOutlined />} onClick={onImport}>
                导入
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* ---------- 工作台卡：本书内的待办 / 甘特 / 日历 ----------
          需求原文「若有这些文档的话，无则不显示」按**卡粒度**执行：
          本书没有某类文档就不渲染该卡，而不是渲染一张全 0 的空卡占位；
          三类都没有时整段隐藏（showWorkbench）。 */}
      {showWorkbench && (
        <Row gutter={[16, 16]} className="hk-bdash-section" data-testid="hk-book-workbench">
          {todoDocs.length > 0 && (
            <Col xs={24} lg={showWorkbenchCardCount === 1 ? 24 : 12}>
              <TodoWorkbenchCard
                docs={todoDocs}
                total={wb?.counts.todo}
                onOpenDoc={(_bookId, docId) => onOpenDoc(docId)}
              />
            </Col>
          )}
          {ganttDocs.length > 0 && (
            <Col xs={24} lg={showWorkbenchCardCount === 1 ? 24 : 12}>
              <GanttWorkbenchCard
                docs={ganttDocs}
                total={wb?.counts.gantt}
                onOpenDoc={(_bookId, docId) => onOpenDoc(docId)}
              />
            </Col>
          )}
          {calendarDocs.length > 0 && (
            <Col xs={24} lg={showWorkbenchCardCount === 1 ? 24 : 12}>
              <CalendarWorkbenchCard
                docs={calendarDocs}
                total={wb?.counts.calendar}
                onOpenDoc={(_bookId, docId) => onOpenDoc(docId)}
              />
            </Col>
          )}
        </Row>
      )}
      {wbLoading && (
        <div className="hk-bdash-loading">
          <Spin size="small" />
        </div>
      )}

      {/* ---------- 常用模板：在本库内一键按模板建文档 ----------
          仅可写时展示（只读库里建不了文档）；放在工作台之后、搜索/最近更新之前。 */}
      {canWrite && onCreateFromTemplate && (
        <div className="hk-bdash-section" data-testid="hk-book-template-quick">
          <TemplateQuickPanel
            compact
            limit={8}
            onPickTemplate={onCreateFromTemplate}
            onMore={() => window.open('/templates', '_blank')}
          />
        </div>
      )}

      {/* ---------- 文库内搜索 | 最近更新 ---------- */}
      <Row gutter={[16, 16]} className="hk-bdash-section" align="top">
        <Col xs={24} lg={14}>
          <Card
            size="small"
            data-testid="hk-book-search"
            title={
              <span>
                <SearchOutlined style={{ color: '#1d39c4', marginRight: 6 }} />
                文库内搜索
              </span>
            }
          >
            <Input
              allowClear
              placeholder="搜索本书标题与正文（markdown）…"
              value={kw}
              onChange={(e) => onSearchChange(e.target.value)}
              data-testid="hk-book-search-input"
            />
            {searching && (
              <div className="hk-bdash-loading">
                <Spin size="small" />
              </div>
            )}
            {hits !== null && !searching && (
              <div className="hk-bdash-hits">
                {hits.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`本书内没有匹配「${kw.trim()}」的文档`}
                    style={{ margin: '16px 0' }}
                  />
                ) : (
                  hits.map((h) => (
                    <div
                      key={h.doc_id}
                      className="hk-bdash-hit"
                      onClick={() => openHit(h.doc_id)}
                      data-testid="hk-book-search-hit"
                    >
                      <div className="hk-bdash-hit-title">
                        {h.title}
                        {h.doc_type && (
                          <Tag className="hk-bdash-hit-tag">{DOC_TYPE_LABEL[h.doc_type as DocType] ?? '文档'}</Tag>
                        )}
                      </div>
                      {h.snippet && <div className="hk-bdash-hit-snippet">{h.snippet}</div>}
                    </div>
                  ))
                )}
              </div>
            )}
            {hits === null && (
              <div className="hk-bdash-search-hint">输入关键词即时搜索本书；全局全文搜索请用顶部搜索框。</div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            size="small"
            data-testid="hk-book-recent"
            title={
              <span>
                <UnorderedListOutlined style={{ color: '#1d39c4', marginRight: 6 }} />
                最近更新
              </span>
            }
            extra={<span style={{ fontSize: 12, color: '#8a919f' }}>最近 {RECENT_LIMIT} 篇</span>}
          >
            {recent.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本书还没有文档" style={{ margin: '16px 0' }} />
            ) : (
              <div className="hk-bdash-recent">
                {recent.map((d) => (
                  <div key={d.id} className="hk-bdash-recent-row" onClick={() => onOpenDoc(d.id)}>
                    <FileTextOutlined className="hk-bdash-recent-icon" />
                    <span className="hk-bdash-recent-title">{d.title}</span>
                    <span className="hk-bdash-recent-time">{relativeTime(d.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
