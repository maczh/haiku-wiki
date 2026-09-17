import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import BlankLayout from './layouts/BlankLayout'
import BookshelfPage from './pages/BookshelfPage'
import BookPage from './pages/BookPage'
import SearchPage from './pages/SearchPage'
import SharePage from './pages/SharePage'
import TrashPage from './pages/TrashPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import { useAuthStore } from './stores/authStore'

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
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* 主应用（需登录） */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<BookshelfPage />} />
        <Route path="/books/:bookId" element={<BookPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* 公开分享（免登录，独立布局） */}
      <Route path="/share/:slug" element={<SharePage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
