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
// 同时捕获默认导出（spectrum 插件函数）作为兜底，确保 window.$ 实例一定拥有 $.fn.spectrum。
import spectrum from 'spectrum-colorpicker'
import 'spectrum-colorpicker/spectrum.css'
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

// 兜底：确保 spectrum 取色器已挂到当前 window.$ 实例。
// 正常情况 import 'spectrum-colorpicker' 已把 $.fn.spectrum 挂到同一 jQuery 实例；
// 若因打包路径导致 require('jquery') 与 import jquery 不是同一实例（极端情况），
// 这里用 window.$ 显式注册捕获到的 spectrum 插件函数，保证 Luckysheet 下拉可用（Bug A 修复关键）。
const jqAny = jquery as unknown as { fn?: Record<string, unknown> }
if (jqAny.fn && typeof jqAny.fn.spectrum !== 'function') {
  jqAny.fn.spectrum = spectrum as unknown
}

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
