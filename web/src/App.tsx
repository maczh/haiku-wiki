import { lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import BlankLayout from './layouts/BlankLayout'
import LazyBoundary from './components/common/LazyBoundary'
import { useAuthStore } from './stores/authStore'

/**
 * 路由级按需加载。
 *
 * 背景：页面（尤以 BookPage 为甚）连同 antd 各组件、@dnd-kit、各自的数据加载
 * 都被静态 import 时会全部进入入口 chunk。改为 lazy 后每个页面独立成 chunk，
 * 只有真正访问到的页面才下载（详见 .workbuddy/memory 与技能 haiku-wiki-build-verify）。
 *
 * 布局（AppLayout / BlankLayout）保持静态：它们是每个路由的外壳，
 * 静态引入可让侧栏/顶栏先出现、内容区再补，避免登录后二次闪白。
 */
const BookshelfPage = lazy(() => import('./pages/BookshelfPage'))
const BookPage = lazy(() => import('./pages/BookPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const SharePage = lazy(() => import('./pages/SharePage'))
const DocSharePage = lazy(() => import('./pages/DocSharePage'))
const TrashPage = lazy(() => import('./pages/TrashPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))

/** 路由守卫：未登录跳 /login */
function RequireAuth({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* 登录 / 注册（无导航壳） */}
      <Route element={<BlankLayout />}>
        <Route
          path="/login"
          element={
            <LazyBoundary fill tip="正在加载登录页…">
              <LoginPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/register"
          element={
            <LazyBoundary fill tip="正在加载注册页…">
              <RegisterPage />
            </LazyBoundary>
          }
        />
      </Route>

      {/* 主应用（需登录） */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          path="/"
          element={
            <LazyBoundary fill tip="正在加载书架…">
              <BookshelfPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/books/:bookId"
          element={
            <LazyBoundary fill tip="正在加载知识库…">
              <BookPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/search"
          element={
            <LazyBoundary fill tip="正在加载搜索页…">
              <SearchPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/trash"
          element={
            <LazyBoundary fill tip="正在加载回收站…">
              <TrashPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/settings"
          element={
            <LazyBoundary fill tip="正在加载设置…">
              <SettingsPage />
            </LazyBoundary>
          }
        />
      </Route>

      {/* 公开分享（免登录，独立布局） */}
      <Route
        path="/share/:slug"
        element={
          <LazyBoundary fill tip="正在加载分享内容…">
            <SharePage />
          </LazyBoundary>
        }
      />
      {/* 文档级分享页（免登录） */}
      <Route
        path="/doc-share/:slug"
        element={
          <LazyBoundary fill tip="正在加载分享内容…">
            <DocSharePage />
          </LazyBoundary>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
