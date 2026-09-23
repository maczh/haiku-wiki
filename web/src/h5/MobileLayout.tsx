import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeftOutlined } from '@ant-design/icons'
import BottomTabs from './BottomTabs'

/** 顶部栏可自定义的片段 */
export interface H5HeaderState {
  /** 标题文案（缺省按路由推导：首页 / 文库 / 搜索 / 我的） */
  title?: string
  /** 是否显示左侧返回按钮 */
  showBack?: boolean
  /** 返回按钮点击回调（缺省 navigate(-1)） */
  onBack?: () => void
  /** 右侧操作区（按钮 / 图标等） */
  right?: ReactNode
}

/** 页面可调用的布局控制 API */
export interface H5LayoutApi {
  /** 控制底部 Tab 显隐（编辑态隐藏） */
  setTabHidden: (h: boolean) => void
  /** 设置顶部栏片段（传 null 恢复路由默认标题） */
  setHeader: (h: H5HeaderState | null) => void
}

/** 布局控制上下文：页面通过 useH5Layout() 拿到 setTabHidden / setHeader */
export const H5LayoutContext = createContext<H5LayoutApi>({
  setTabHidden: () => {},
  setHeader: () => {},
})

/** 页面获取布局控制 API 的 hook */
export function useH5Layout(): H5LayoutApi {
  return useContext(H5LayoutContext)
}

/** 按路径推导默认标题 */
function defaultTitle(pathname: string): string {
  if (pathname.startsWith('/m/books')) return '文库'
  if (pathname.startsWith('/m/search')) return '搜索'
  if (pathname.startsWith('/m/mine')) return '我的'
  if (pathname.startsWith('/m/doc')) return '文档'
  return '首页'
}

/**
 * H5 主框架：固定顶栏（标题 / 返回 / 右侧操作）+ 内容区（给底部 Tab 留位）+ 底部四 Tab。
 *
 * 内容区高度用 100dvh 减去顶栏与 Tab，规避移动端地址栏导致的高度抖动；
 * 页面通过 useH5Layout() 设置标题、显隐底部 Tab（编辑态隐藏）。
 */
export default function MobileLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [tabHidden, setTabHidden] = useState(false)
  const [header, setHeader] = useState<H5HeaderState | null>(null)

  const api = useMemo<H5LayoutApi>(() => ({ setTabHidden, setHeader }), [])

  const title = header?.title ?? defaultTitle(location.pathname)
  const showBack = header?.showBack ?? false
  const onBack = header?.onBack ?? (() => navigate(-1))

  return (
    <H5LayoutContext.Provider value={api}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100dvh',
          overflow: 'hidden',
          background: '#f5f6f8',
        }}
      >
        {/* 顶部栏 */}
        <header
          style={{
            height: 52,
            flexShrink: 0,
            background: '#fff',
            borderBottom: '1px solid #ebedf0',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 8,
          }}
        >
          {showBack && (
            <ArrowLeftOutlined
              onClick={onBack}
              style={{ fontSize: 18, color: '#1f2329', cursor: 'pointer', flexShrink: 0 }}
            />
          )}
          <div
            style={{
              flex: 1,
              textAlign: showBack ? 'left' : 'center',
              fontWeight: 600,
              fontSize: 16,
              color: '#1f2329',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          <div style={{ flexShrink: 0, minWidth: 24, display: 'flex', justifyContent: 'flex-end' }}>{header?.right}</div>
        </header>

        {/* 内容区：滚动，给底部 Tab 留位（编辑态隐藏 Tab 则不留位） */}
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: tabHidden ? 0 : 56,
          }}
        >
          <Outlet />
        </main>

        {/* 底部四 Tab（编辑态隐藏） */}
        {!tabHidden && <BottomTabs />}
      </div>
    </H5LayoutContext.Provider>
  )
}
