import { useLocation, useNavigate } from 'react-router-dom'
import type { ComponentType, CSSProperties } from 'react'
import { BookOutlined, HomeOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'

interface TabItem {
  key: string
  label: string
  path: string
  icon: ComponentType<{ style?: CSSProperties }>
}

/** 底部四个主入口 */
const TABS: TabItem[] = [
  { key: 'home', label: '首页', path: '/m', icon: HomeOutlined },
  { key: 'books', label: '文库', path: '/m/books', icon: BookOutlined },
  { key: 'search', label: '搜索', path: '/m/search', icon: SearchOutlined },
  { key: 'mine', label: '我的', path: '/m/mine', icon: UserOutlined },
]

/**
 * H5 底部固定 Tab 栏（自绘 flex，不引入 antd-mobile）。
 *
 * 高亮规则：首页仅精确匹配 /m；其余按 path 前缀匹配（/m/books 同时覆盖 /m/books/:id）。
 */
export default function BottomTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const pathname = location.pathname

  return (
    <nav
      style={{
        height: 56,
        flexShrink: 0,
        background: '#fff',
        borderTop: '1px solid #ebedf0',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((t) => {
        const Icon = t.icon
        const isActive = t.key === 'home' ? pathname === '/m' : pathname.startsWith(t.path)
        return (
          <div
            key={t.key}
            role="button"
            aria-label={t.label}
            onClick={() => navigate(t.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              cursor: 'pointer',
              color: isActive ? '#2f54eb' : '#8a919f',
              fontSize: 11,
            }}
          >
            <Icon style={{ fontSize: 20 }} />
            <span>{t.label}</span>
          </div>
        )
      })}
    </nav>
  )
}
