import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

// 注意：`vditor/dist/index.css` 不在此处引入 —— 只有 MarkdownView / VditorEditor 需要它，
// 二者已按需加载，样式随之进入各自的懒加载 CSS chunk，不再阻塞首屏（见 MarkdownView.tsx）。
//

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          // 主色接近语雀蓝
          colorPrimary: '#2f54eb',
          borderRadius: 6,
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
