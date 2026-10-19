import '@ant-design/v5-patch-for-react-19'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './index.css'

// 注意：Markdown 阅读态样式（reader.css / markdown-body.css）与 KaTeX 样式均由 MarkdownView
// 按需引入，不在此处加载，避免阻塞首屏；编辑态（typo-md-editor）自带 style.css 随组件懒加载。
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
      {/* 通过 App.useApp() 获取的 message/modal/notification 才能消费主题上下文；
          直接 import 的静态方法不会因为外层有 App 包裹而自动获得上下文。 */}
      <AntdApp>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
