import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import jquery from 'jquery'
import installMousewheel from 'jquery-mousewheel'
// Spectrum 取色器：Luckysheet 内置「字体颜色 / 填充色 / 边框」工具条下拉在点击瞬间会
// 调用 `$(".luckysheet-color-selected").spectrum(...)`（esm bundle 内 35 处 .spectrum 调用）。
// 原项目漏加载官方 plugin.js（内含 Spectrum），导致 window.$ 的 jQuery 实例缺少 $.fn.spectrum，
// 点击即抛 `$(...).spectrum is not a function`、下拉永远不出现（Bug A）。
// 这里以 ESM 形式引入：UMD 内部 require('jquery') 与下方 window.$ 是同一实例，
// 自动把 $.fn.spectrum 挂上去，无需用 script 标签加载 plugin.js（那样会把 jQuery 换成 2.2.4）。
// 工厂函数不返回导出值，必须使用副作用导入，避免 Vite 开发模式读取 undefined.__esModule。
import 'spectrum-colorpicker'
import 'spectrum-colorpicker/spectrum.css'
import App from './App'
import './index.css'

// 注意：Markdown 阅读态样式（reader.css / markdown-body.css）与 KaTeX 样式均由 MarkdownView
// 按需引入，不在此处加载，避免阻塞首屏；编辑态（typo-md-editor）自带 style.css 随组件懒加载。
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
