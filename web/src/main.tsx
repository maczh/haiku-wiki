import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import jquery from 'jquery'
import installMousewheel from 'jquery-mousewheel'
import App from './App'
import './index.css'

// 注意：`vditor/dist/index.css` 不在此处引入 —— 只有 MarkdownView / VditorEditor 需要它，
// 二者已按需加载，样式随之进入各自的懒加载 CSS chunk，不再阻塞首屏（见 MarkdownView.tsx）。
//

// Luckysheet 2.x 的浏览器代码仍直接读取全局 jQuery；必须在表格懒加载前完成挂载。
const browserWindow = window as Window & { $?: typeof jquery; jQuery?: typeof jquery }
browserWindow.$ = jquery
browserWindow.jQuery = jquery
installMousewheel(jquery)

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
