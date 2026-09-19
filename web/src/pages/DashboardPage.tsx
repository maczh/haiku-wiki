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
  INTRO_DISMISS_KEY,
  ONBOARD_DISMISS_KEY,
  browserStorage,
  dashboardStats,
  greetingOf,
  readFlag,
  sortRecentDocs,
  writeFlag,
} from '../lib/dashboard'
import type { Bookshelf, RecentDocItem } from '../types'

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
 * 结构（自上而下，一屏内可读完关键信息）：
 *   欢迎条（问候 + 统计 + 向导/视频开关）
 *   快捷操作（8 个高频入口）
 *   新手向导 | 视频介绍（各自可关闭，关闭状态本地记忆）
 *   最近更新 | 团队速览
 *   书架（我的 / 团队 / 公司）
 *
 * 拆成「区块组合」而不是把一切塞进一个组件：向导、视频、最近更新、快捷操作
 * 各自独立成组件，任一区块关闭或加载失败都不会影响其余部分。
 */
export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [shelf, setShelf] = useState<Bookshelf | null>(null)
  const [recent, setRecent] = useState<RecentDocItem[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [quickModal, setQuickModal] = useState<QuickStartMode | null>(null)

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

        {/* ---------- 快捷操作 ---------- */}
        <div className="hk-dash-section">
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
        </div>

        {/* ---------- 新手向导 / 视频介绍 ---------- */}
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

        {/* ---------- 最近更新 / 团队速览 ---------- */}
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
            <Card
              size="small"
              data-testid="hk-team-glance"
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
      </div>

      {/* ---------- 快捷新建 / 选择导入目标 ---------- */}
      {quickModal && (
        <QuickStartModal
          open
          mode={quickModal}
          books={allBooks}
          onClose={() => setQuickModal(null)}
          onCreated={(bookId, docId) => navigate(`/books/${bookId}?docId=${docId}&tab=edit`)}
          onPickBook={(bookId) =>
            navigate(`/books/${bookId}?import=${quickModal === 'import-url' ? 'url' : 'file'}`)
          }
        />
      )}
    </div>
  )
}
