import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ConfigProvider, Spin } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { RequireAuth } from '../App'
import MobileLayout from './MobileLayout'

/**
 * H5（手机版）路由表。
 *
 * 布局：
 *   · 最外层包一层 antd ConfigProvider，覆盖移动端 token（圆角 / 控件高度 / 字号），
 *     不影响桌面版（桌面版在 main.tsx 另有自己的 ConfigProvider）。
 *   · Suspense 兜底 React.lazy 加载（各 H5 页面均按需懒加载）。
 *   · 非 /m 开头的路径统一重定向到 /m（手机版根）。
 *   · 受保护路由 /m 套 RequireAuth，未登录重定向 /m/login。
 *   · /m/login、/m/register 为全屏页面（不套 MobileLayout，故无底部 Tab）。
 */

// H5 页面（全部 React.lazy 按需加载，见任务规范 T3）
const MHome = lazy(() => import('./pages/MHome'))
const MBookshelf = lazy(() => import('./pages/MBookshelf'))
const MSearch = lazy(() => import('./pages/MSearch'))
const MMine = lazy(() => import('./pages/MMine'))
const MDoc = lazy(() => import('./pages/MDoc'))

// 登录 / 注册复用桌面版页面（全屏，无导航壳）
const LoginPage = lazy(() => import('../pages/LoginPage'))
const RegisterPage = lazy(() => import('../pages/RegisterPage'))

/** 懒加载占位：居中旋转 */
function H5Loading() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100dvh',
      }}
    >
      <Spin size="large" />
    </div>
  )
}

/** 移动端主题 token（仅作用于 /m 子树） */
const H5_THEME = {
  token: {
    colorPrimary: '#2f54eb',
    borderRadius: 8,
    controlHeight: 40,
    fontSize: 14,
  },
}

export default function H5Router() {
  const location = useLocation()

  // 任何非 /m 开头的路径都视为桌面版/未知入口，统一收口到手机版根
  if (!location.pathname.startsWith('/m')) {
    return <Navigate to="/m" replace />
  }

  return (
    <ConfigProvider locale={zhCN} theme={H5_THEME}>
      <Suspense fallback={<H5Loading />}>
        <Routes>
          {/* 受保护的手机版主框架 */}
          <Route
            path="/m"
            element={
              <RequireAuth redirectTo="/m/login">
                <MobileLayout />
              </RequireAuth>
            }
          >
            <Route index element={<MHome />} />
            <Route path="books" element={<MBookshelf />} />
            <Route path="books/:bookId" element={<MBookshelf />} />
            <Route path="search" element={<MSearch />} />
            <Route path="mine" element={<MMine />} />
            <Route path="doc/:docId" element={<MDoc />} />
          </Route>

          {/* 全屏登录 / 注册（不受 MobileLayout 包裹 → 无底部 Tab） */}
          <Route path="/m/login" element={<LoginPage />} />
          <Route path="/m/register" element={<RegisterPage />} />

          {/* 兜底：未知 /m 子路径回到手机版首页 */}
          <Route path="*" element={<Navigate to="/m" replace />} />
        </Routes>
      </Suspense>
    </ConfigProvider>
  )
}
