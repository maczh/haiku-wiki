import { useMemo } from 'react'
import { Alert, Button, Empty } from 'antd'
import { ExportOutlined, GlobalOutlined } from '@ant-design/icons'
import type { WebRef } from '../../types'
// 样式随组件懒加载，不进主包（与项目「入口 CSS 要小」的约束一致）
import './webview.css'

/**
 * 网页型文档（doc_type=web）阅读器：把原网址或导入的 HTML 包用 iframe 嵌入展示。
 *
 * 刻意**不提供编辑模式**——内容是外部站点或导入的整包静态资源，改一个字就得反哺原文，
 * 提供编辑器只会让人误以为改得动。要看原文请用「在新窗口打开」。
 *
 * 安全边界：iframe 的 sandbox 只给 allow-scripts（**不给** allow-same-origin）。
 * 少了它，页面里的脚本无法访问本站的 Cookie / localStorage / 父文档，
 * 即便导入的包里被人塞了恶意脚本，也拿不到登录态。
 */
export default function WebView({ content }: { content: string }) {
  const ref = useMemo<WebRef | null>(() => {
    try {
      const p = JSON.parse(content || '{}') as WebRef
      const src = p.kind === 'url' ? p.url : p.entry
      return src ? p : null
    } catch {
      return null
    }
  }, [content])

  if (!ref) {
    return (
      <div style={{ padding: '80px 24px' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="网页地址无效或缺失" />
      </div>
    )
  }

  const src = (ref.kind === 'url' ? ref.url : ref.entry) as string
  const external = ref.kind === 'url'

  return (
    <div className="hk-webview">
      <div className="hk-webview-bar">
        <GlobalOutlined className="hk-webview-icon" />
        <span className="hk-webview-src" title={src}>
          {src}
        </span>
        <Button
          size="small"
          type="text"
          icon={<ExportOutlined />}
          href={src}
          target="_blank"
          rel="noreferrer"
        >
          在新窗口打开
        </Button>
      </div>
      {external && (
        <Alert
          type="info"
          showIcon
          banner
          message="这是外部站点，内容由对方提供。若下方为空白，说明该站点设置了 X-Frame-Options 禁止被嵌入，请改用「在新窗口打开」。"
        />
      )}
      <iframe
        className="hk-webview-frame"
        src={src}
        title={ref.title || '网页'}
        // 不给 allow-same-origin：页面脚本不得触碰本站登录态
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
