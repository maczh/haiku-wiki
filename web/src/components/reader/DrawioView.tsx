import { Alert, Button } from 'antd'
import DrawioSvgView from './DrawioSvgView'
import { isUsableSvg, parseDrawioContent } from '../../lib/drawioDoc'

interface Props {
  /** 绘图文档正文：新格式为 {version, xml, svg} JSON，历史文档为纯 XML */
  content: string
  /** 是否显示「在编辑器中打开」提示（书级分享页等只读场景隐藏） */
  showEditHint?: boolean
}

/**
 * 绘图文档只读预览（doc_type=drawing）。
 *
 * 第六轮起**不再加载 draw.io 组件**：正文里同时保存了 SVG（见 lib/drawioDoc.ts），
 * 阅读页直接渲染这份矢量图 ——
 *   · 阅读/分享无需下载 37MB 静态资源，首屏只有一次文档请求；
 *   · 分享页访客也能正常看图（原先必须等 draw.io 资源就位，缺资源时直接白屏）；
 *   · 缩放由本组件提供（放大/缩小/适应宽度/原始尺寸），矢量放大不失真。
 *
 * 兼容历史文档：正文只有 XML 时 svg 为空，这里给出「请在编辑态打开一次」的引导，
 * 编辑页（DrawioEditor）打开时会自动补生成并回写 SVG。
 */
export default function DrawioView({ content, showEditHint = true }: Props) {
  const { xml, svg } = parseDrawioContent(content)

  if (!content || !content.trim() || !xml.trim()) {
    return (
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
        <Alert type="info" showIcon message="绘图内容为空" description="切换到「编辑」模式即可开始绘制。" />
      </div>
    )
  }

  if (!isUsableSvg(svg)) {
    return (
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
        <Alert
          type="info"
          showIcon
          message="该绘图文档尚未生成矢量预览"
          description={
            <>
              <div style={{ marginBottom: 8 }}>
                这份文档是早期保存的（正文只含绘图 XML）。阅读页与分享页一律渲染矢量图（SVG），不再加载绘图组件，
                因此需要先生成一次。
              </div>
              {showEditHint && <div>请在知识库中打开该文档的「编辑」模式，系统会自动补生成并保存，之后即可正常预览与分享。</div>}
            </>
          }
          action={
            showEditHint ? (
              <Button size="small" onClick={() => window.location.reload()}>
                刷新查看
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <div
      style={{
        height: 'min(78vh, 820px)',
        minHeight: 420,
        margin: '0 24px 40px',
        border: '1px solid #ebedf0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <DrawioSvgView svg={svg} xml={xml} />
    </div>
  )
}
