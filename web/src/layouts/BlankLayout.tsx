import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { me } from '../api/auth'

/** 登录/注册壳：未登录直接进入；已登录跳书架 */
export default function BlankLayout() {
  const navigate = useNavigate()
  const { token, user, setUser } = useAuthStore()

  useEffect(() => {
    if (token) {
      // 已登录（含刷新页面后恢复）：拉取用户信息后回首页
      me()
        .then((u) => {
          setUser(u)
          navigate('/', { replace: true })
        })
        .catch(() => {
          /* 拦截器已处理 401 */
        })
    }
  }, [token])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f7' }}>
      <Outlet context={{ user, setUser }} />
    </div>
  )
}
