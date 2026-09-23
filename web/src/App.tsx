import { lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import BlankLayout from './layouts/BlankLayout'
import LazyBoundary from './components/common/LazyBoundary'
import { useAuthStore } from './stores/authStore'
import { useViewMode } from './h5/useViewMode'
import H5Router from './h5/H5Router'

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
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const BookPage = lazy(() => import('./pages/BookPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const SharePage = lazy(() => import('./pages/SharePage'))
const DocSharePage = lazy(() => import('./pages/DocSharePage'))
const TrashPage = lazy(() => import('./pages/TrashPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
// R5：团队（列表 / 详情）与管理员用户管理
const TeamsPage = lazy(() => import('./pages/TeamsPage'))
const TeamDetailPage = lazy(() => import('./pages/TeamDetailPage'))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
// 系统管理
const SystemConfigPage = lazy(() => import('./pages/SystemConfigPage'))
const DatabaseMigrationPage = lazy(() => import('./pages/DatabaseMigrationPage'))
const StorageMigrationPage = lazy(() => import('./pages/StorageMigrationPage'))
// 管理员：文档模板导入（外部模板数据文件 / 模板目录批量导入）
const AdminTemplatesPage = lazy(() => import('./pages/AdminTemplatesPage'))
// 模板中心（仿语雀/WPS 的文档模板画廊）
const TemplateGalleryPage = lazy(() => import('./pages/TemplateGalleryPage'))

/** 路由守卫：未登录跳 redirectTo（桌面版默认 /login，手机版传 /m/login） */
export function RequireAuth({
  children,
  redirectTo = '/login',
}: {
  children: JSX.Element
  /** 未登录时的重定向目标 */
  redirectTo?: string
}) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to={redirectTo} replace />
  return children
}

/** 管理员守卫：已登录但非 admin 时回书架（界面入口同样按角色隐藏，这里是兜底） */
function RequireAdmin({ children }: { children: JSX.Element }) {
  const user = useAuthStore((s) => s.user)
  if (user && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

/** 桌面版路由表（保持原样，手机版由 H5Router 承载） */
export function DesktopRoutes() {
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
            <LazyBoundary fill tip="正在加载首页…">
              <DashboardPage />
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
        <Route
          path="/teams"
          element={
            <LazyBoundary fill tip="正在加载团队…">
              <TeamsPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/teams/:teamId"
          element={
            <LazyBoundary fill tip="正在加载团队详情…">
              <TeamDetailPage />
            </LazyBoundary>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAdmin>
              <LazyBoundary fill tip="正在加载用户管理…">
                <AdminUsersPage />
              </LazyBoundary>
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/system-config"
          element={
            <RequireAdmin>
              <LazyBoundary fill tip="正在加载系统配置…">
                <SystemConfigPage />
              </LazyBoundary>
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/templates"
          element={
            <RequireAdmin>
              <LazyBoundary fill tip="正在加载模板导入…">
                <AdminTemplatesPage />
              </LazyBoundary>
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/migrate/database"
          element={
            <RequireAdmin>
              <LazyBoundary fill tip="正在加载数据库迁移…">
                <DatabaseMigrationPage />
              </LazyBoundary>
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/migrate/storage"
          element={
            <RequireAdmin>
              <LazyBoundary fill tip="正在加载存储迁移…">
                <StorageMigrationPage />
              </LazyBoundary>
            </RequireAdmin>
          }
        />
        <Route
          path="/templates"
          element={
            <LazyBoundary fill tip="正在加载模板中心…">
              <TemplateGalleryPage />
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

/**
 * 顶层：按视图模式选择渲染 H5 还是桌面版。
 *
 * 分享链接（/share/:slug、/doc-share/:slug）在两种模式下走各自路由：
 *   · 桌面版 → DesktopRoutes 命中 SharePage / DocSharePage；
 *   · 手机版 → H5Router 内识别 /share/、/doc-share/ 前缀，命中 MShare / MShareDoc。
 * 因此同一分享 URL 在手机上自动呈现 H5 阅读页，无需为手机单独换路径。
 */
export default function App() {
  const { mode } = useViewMode()
  if (mode === 'h5') return <H5Router />
  return <DesktopRoutes />
}
