import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Col, Empty, Row, Tag, message } from 'antd'
import {
  PlayCircleOutlined,
  QuestionCircleOutlined,
  TeamOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { listRecentDocs } from '../api/recent'
import { getWorkbench } from '../api/workbench'
import { useAuthStore } from '../stores/authStore'
import BookshelfSection from '../components/book/BookshelfSection'
// 样式随页面 chunk 一起加载：入口 CSS 保持极简（与 Vditor / 甘特图同样处理）
import '../components/dashboard/dashboard.css'
import QuickActions from '../components/dashboard/QuickActions'
import QuickStartModal, { type QuickStartMode } from '../components/dashboard/QuickStartModal'
import OnboardingGuide from '../components/dashboard/OnboardingGuide'
import IntroVideo, { type VideoChapter } from '../components/dashboard/IntroVideo'
import RecentDocsCard from '../components/dashboard/RecentDocsCard'
import {
  CalendarWorkbenchCard,
  GanttWorkbenchCard,
  LibrarySearchCard,
  TodoWorkbenchCard,
} from '../components/dashboard/WorkbenchCards'
import { hasWorkbench, pickWorkbenchDocs } from '../lib/workbench'
import {
  INTRO_DISMISS_KEY,
  ONBOARD_DISMISS_KEY,
  browserStorage,
  dashboardStats,
  greetingOf,
  readFlag,
  sortRecentDocs,
  writeFlag,
} from '../lib/dashboard'
import type { Bookshelf, RecentDocItem, WorkbenchView } from '../types'

/** 演示视频与封面（随前端静态资源分发，离线可用） */
const INTRO_SRC = '/onboarding/haiku-wiki-guide.mp4'
const INTRO_POSTER = '/onboarding/haiku-wiki-guide-poster.jpg'

/**
 * 视频章节：点标题即跳到对应时间点。
 * 时间点为 `tools/video` 流水线产出的真实段落边界，改动视频后需要同步更新。
 */
const INTRO_CHAPTERS: VideoChapter[] = [
  { label: '登录与首页', at: 0 },
  { label: '新建知识库', at: 29 },
  { label: '新建与编辑文档', at: 44 },
  { label: '九种文档类型', at: 87 },
  { label: '搜索与分享', at: 122 },
  { label: '导出与总结', at: 147 },
]

/** 视频总时长（秒），用于「约 N 分钟」的说明文案 */
const INTRO_SECONDS = 167

/**
 * 首页 Dashboard。
 *
 * 区块优先级（自上而下，一屏内先看到「手头有什么活」再看到「去哪」）：
 *   欢迎条（问候 + 统计 + 向导/视频开关）
 *   **工作台**：待办 | 甘特图进度 | 工作日历（三类文档都没有时整段不渲染）
 *   最近更新 | 文库内搜索
 *   快捷操作 | 团队速览
 *   书架（我的 / 团队 / 公司）
 *   新手向导 | 视频介绍（各自可关闭，关闭状态本地记忆）
 *
 * 拆成「区块组合」而不是把一切塞进一个组件：工作台三卡、向导、视频、最近更新、
 * 快捷操作各自独立成组件，任一区块加载失败或关闭都不影响其余部分。
 *
 * 数据侧两条独立请求：/recent-docs（元数据）与 /workbench（含正文，供算进度）。
 * 后者失败时只有工作台消失，首页其余部分照常可用。
 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [shelf, setShelf] = useState<Bookshelf | null>(null)
  const [recent, setRecent] = useState<RecentDocItem[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [quickModal, setQuickModal] = useState<QuickStartMode | null>(null)

  // 工作台：待办 / 甘特图 / 工作日历（后端只给每类最近 8 篇，故卡片会标注口径）
  const [workbench, setWorkbench] = useState<WorkbenchView>({ items: [], counts: {} })
  const [wbLoading, setWbLoading] = useState(true)

  // 关闭状态第一次渲染就确定（避免先显示再消失的闪烁）
  const [showOnboard, setShowOnboard] = useState(() => !readFlag(ONBOARD_DISMISS_KEY, browserStorage()))
  const [showIntro, setShowIntro] = useState(() => !readFlag(INTRO_DISMISS_KEY, browserStorage()))
  const [createBookSignal, setCreateBookSignal] = useState(0)

  useEffect(() => {
    let alive = true
    setRecentLoading(true)
    listRecentDocs(10)
      .then((items) => {
        if (alive) setRecent(sortRecentDocs(items))
      })
      .catch(() => {
        /* 401 已由拦截器处理；其余错误不阻塞首页其它区块 */
      })
      .finally(() => {
        if (alive) setRecentLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setWbLoading(true)
    getWorkbench(8)
      .then((view) => {
        if (alive) setWorkbench(view)
      })
      .catch(() => {
        /* 工作台是增强区块：失败就不显示，不影响最近更新与书架 */
      })
      .finally(() => {
        if (alive) setWbLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  /** 可写库排前，供快捷新建/导入选择目标 */
  const allBooks = useMemo(() => {
    if (!shelf) return []
    const list = [...shelf.mine, ...shelf.teams, ...shelf.visible]
    return [...list.filter((b) => b.can_write), ...list.filter((b) => !b.can_write)]
  }, [shelf])

  const stats = dashboardStats({
    mine: shelf?.mine,
    visible: shelf?.visible,
    teams: shelf?.teams,
    recent,
  })

  // 工作台三卡的数据切片 + 是否渲染。三类文档一篇都没有时整段隐藏（需求原文：「无则不显示」）
  const showWorkbench = !wbLoading && hasWorkbench(workbench.items)
  const todoDocs = useMemo(() => pickWorkbenchDocs(workbench.items, 'todo'), [workbench.items])
  const ganttDocs = useMemo(() => pickWorkbenchDocs(workbench.items, 'gantt'), [workbench.items])
  const calendarDocs = useMemo(() => pickWorkbenchDocs(workbench.items, 'calendar'), [workbench.items])

  function dismissOnboard() {
    setShowOnboard(false)
    writeFlag(ONBOARD_DISMISS_KEY, true, browserStorage())
  }
  function dismissIntro() {
    setShowIntro(false)
    writeFlag(INTRO_DISMISS_KEY, true, browserStorage())
  }
  /** 重新打开：同时清掉本地记忆，刷新后依然可见 */
  function reopenOnboard() {
    setShowOnboard(true)
    writeFlag(ONBOARD_DISMISS_KEY, false, browserStorage())
  }
  function reopenIntro() {
    setShowIntro(true)
    writeFlag(INTRO_DISMISS_KEY, false, browserStorage())
  }

  function openRecent(item: RecentDocItem) {
    navigate(`/books/${item.book_id}?docId=${item.id}&tab=read`)
  }

  /** 工作台里点开某篇文档（阅读态） */
  function openWorkbenchDoc(bookId: number, docId: number) {
    navigate(`/books/${bookId}?docId=${docId}&tab=read`)
  }

  /** 文库内搜索：交给搜索页（后端按标题+正文检索） */
  function runSearch(q: string) {
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  /** 需要至少一个知识库才能继续的动作：没有就先引导建库 */
  function requireBook(kind: 'doc' | 'import-file' | 'import-url'): boolean {
    if (allBooks.length === 0) {
      message.info('先创建一个知识库，再新建或导入文档')
      setCreateBookSignal((n) => n + 1)
      return false
    }
    setQuickModal(kind)
    return true
  }

  return (
    <div className="hk-dash">
      <div className="hk-dash-inner">
        {/* ---------- 欢迎条 ---------- */}
        <div className="hk-dash-hero" data-testid="hk-dashboard-hero">
          <h2 className="hk-dash-hero-title">
            {greetingOf()}，{user?.nickname || user?.username || '欢迎回来'}
          </h2>
          <p className="hk-dash-hero-sub">寄海文库 · 一站式企业知识库：知识库、文档、协作、分享与导出都在这里。</p>

          <div className="hk-dash-hero-stats">
            <div className="hk-dash-stat">
              <div className="hk-dash-stat-num">{stats.books}</div>
              <div className="hk-dash-stat-label">可见知识库</div>
            </div>
            <div className="hk-dash-stat">
              <div className="hk-dash-stat-num">{stats.teams}</div>
              <div className="hk-dash-stat-label">团队文库</div>
            </div>
            <div className="hk-dash-stat">
              <div className="hk-dash-stat-num">{recentLoading ? '—' : stats.recent}</div>
              <div className="hk-dash-stat-label">最近更新</div>
            </div>
          </div>

          <div className="hk-dash-hero-actions">
            <Button
              size="small"
              icon={<QuestionCircleOutlined />}
              data-testid="hk-toggle-onboard"
              onClick={() => (showOnboard ? dismissOnboard() : reopenOnboard())}
            >
              {showOnboard ? '收起新手向导' : '新手向导'}
            </Button>
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              data-testid="hk-toggle-intro"
              onClick={() => (showIntro ? dismissIntro() : reopenIntro())}
            >
              {showIntro ? '收起视频介绍' : '视频介绍'}
            </Button>
          </div>
        </div>

        {/* ---------- 工作台（最高优先级：先看「手头有什么活」） ----------
            三类文档都没有时整段不渲染（showWorkbench 已合并 loading 与空判断）。 */}
        {showWorkbench && (
          <div className="hk-dash-section" data-testid="hk-workbench">
            <div className="hk-dash-section-head">
              <h3 className="hk-dash-section-title">工作台</h3>
              <span className="hk-dash-section-extra">待办、排期与日程一屏汇总</span>
            </div>
            <Row gutter={[16, 16]} align="top">
              {todoDocs.length > 0 && (
                <Col xs={24} lg={8}>
                  <TodoWorkbenchCard docs={todoDocs} total={workbench.counts.todo} onOpenDoc={openWorkbenchDoc} />
                </Col>
              )}
              {ganttDocs.length > 0 && (
                <Col xs={24} lg={8}>
                  <GanttWorkbenchCard docs={ganttDocs} total={workbench.counts.gantt} onOpenDoc={openWorkbenchDoc} />
                </Col>
              )}
              {calendarDocs.length > 0 && (
                <Col xs={24} lg={8}>
                  <CalendarWorkbenchCard docs={calendarDocs} total={workbench.counts.calendar} onOpenDoc={openWorkbenchDoc} />
                </Col>
              )}
            </Row>
          </div>
        )}

        {/* ---------- 最近更新 | 文库内搜索 ---------- */}
        <Row gutter={[16, 16]} className="hk-dash-section" align="top">
          <Col xs={24} lg={16}>
            <RecentDocsCard
              items={recent}
              loading={recentLoading}
              onOpen={openRecent}
              onCreateDoc={() => void requireBook('doc')}
              extra={
                <a style={{ fontSize: 12 }} onClick={() => navigate('/search')}>
                  去搜索
                </a>
              }
            />
          </Col>
          <Col xs={24} lg={8}>
            <LibrarySearchCard onSearch={runSearch} />
          </Col>
        </Row>

        {/* ---------- 快捷操作 | 团队速览 ---------- */}
        <Row gutter={[16, 16]} className="hk-dash-section" align="top">
          <Col xs={24} lg={16}>
            <div className="hk-dash-section-head">
              <h3 className="hk-dash-section-title">快捷操作</h3>
              <span className="hk-dash-section-extra">常用入口一屏直达</span>
            </div>
            <QuickActions
              onCreateBook={() => setCreateBookSignal((n) => n + 1)}
              onCreateDoc={() => void requireBook('doc')}
              onImportFile={() => void requireBook('import-file')}
              onImportUrl={() => void requireBook('import-url')}
              onSearch={() => navigate('/search')}
              onTeams={() => navigate('/teams')}
              onTrash={() => navigate('/trash')}
              onSettings={() => navigate('/settings')}
            />
          </Col>
          <Col xs={24} lg={8}>
            <Card
              size="small"
              data-testid="hk-team-glance"
              style={{ height: '100%' }}
              title={
                <span style={{ fontSize: 14 }}>
                  <TeamOutlined style={{ marginRight: 6, color: '#1677ff' }} />
                  团队速览
                </span>
              }
              extra={
                <a style={{ fontSize: 12 }} onClick={() => navigate('/teams')}>
                  管理 <RightOutlined style={{ fontSize: 10 }} />
                </a>
              }
            >
              {shelf && shelf.teams.length > 0 ? (
                <div>
                  {shelf.teams.slice(0, 5).map((b) => (
                    <div
                      key={b.id}
                      className="hk-dash-recent-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/books/${b.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') navigate(`/books/${b.id}`)
                      }}
                    >
                      <div className="hk-dash-recent-main">
                        <div className="hk-dash-recent-title">{b.name}</div>
                        <div className="hk-dash-recent-meta">
                          <Tag
                            bordered={false}
                            style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', background: '#eef2ff', color: '#2f54eb' }}
                          >
                            {b.doc_count} 篇文档
                          </Tag>
                        </div>
                      </div>
                      <RightOutlined style={{ fontSize: 11, color: '#c3c8d4' }} />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ fontSize: 12, color: '#8a919f' }}>还没有加入团队</span>}
                  style={{ margin: '10px 0' }}
                >
                  <a onClick={() => navigate('/teams')}>去创建或加入团队</a>
                </Empty>
              )}
            </Card>
          </Col>
        </Row>

        {/* ---------- 书架 ---------- */}
        <div className="hk-dash-section">
          <BookshelfSection onLoaded={setShelf} createSignal={createBookSignal} />
        </div>

        {/* ---------- 新手向导 / 视频介绍 ----------
            刻意放在最后：这两块是「一次性上手材料」，老用户会关掉、关闭状态本地记忆；
            放在工作台之前会挤掉每天真正要看的内容。 */}
        {(showOnboard || showIntro) && (
          <Row gutter={[16, 16]} className="hk-dash-section" align="top">
            {showOnboard && (
              <Col xs={24} lg={showIntro ? 15 : 24}>
                <OnboardingGuide
                  onCreateBook={() => setCreateBookSignal((n) => n + 1)}
                  onCreateDoc={() => void requireBook('doc')}
                  onShare={() =>
                    allBooks.length > 0 ? navigate(`/books/${allBooks[0].id}`) : setCreateBookSignal((n) => n + 1)
                  }
                  onClose={dismissOnboard}
                />
              </Col>
            )}
            {showIntro && (
              <Col xs={24} lg={showOnboard ? 9 : 24}>
                <IntroVideo
                  src={INTRO_SRC}
                  poster={INTRO_POSTER}
                  chapters={INTRO_CHAPTERS}
                  seconds={INTRO_SECONDS}
                  onClose={dismissIntro}
                  onDismissForever={dismissIntro}
                />
              </Col>
            )}
          </Row>
        )}
      </div>

      {/* ---------- 快捷新建 / 选择导入目标 ---------- */}
      {quickModal && (
        <QuickStartModal
          open
          mode={quickModal}
          books={allBooks}
          onClose={() => setQuickModal(null)}
          onCreated={(bookId, docId) => navigate(`/books/${bookId}?docId=${docId}&tab=edit`)}
          onPickBook={(bookId, parentId) =>
            // 目录层级经 URL 传给知识库页，由它打开导入对话框时作为初始存放位置
            navigate(`/books/${bookId}?import=${quickModal === 'import-url' ? 'url' : 'file'}${parentId ? `&parent=${parentId}` : ''}`)
          }
        />
      )}
    </div>
  )
}
