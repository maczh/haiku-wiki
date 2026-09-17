import { Alert } from 'antd'
import DrawioEditor from '../editor/DrawioEditor'

interface Props {
  /** 绘图文档正文（.drawio 的 mxGraphModel XML 原文） */
  content: string
}

/**
 * 绘图文档只读预览（doc_type=drawing）。
 *
 * 复用编辑器组件并切换到只读参数（draw.io embed 的 noSaveBtn/noExitBtn/saveAndExit=0），
 * 而不是另写一套 SVG 渲染：
 *   · 所见即所得——预览与编辑使用完全相同的渲染内核，不会出现「编辑好看、阅读走样」；
 *   · 阅读态仍保留缩放、平移、图层/页面切换等查看能力；
 *   · 顶部保留「导出」，方便直接下载 .drawio/.svg/.png。
 */
export default function DrawioView({ content }: Props) {
  if (!content || !content.trim()) {
    return (
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 24px 40px' }}>
        <Alert type="info" showIcon message="绘图内容为空" description="切换到「编辑」模式即可开始绘制。" />
      </div>
    )
  }
  // height:100% 依赖父级链路（BookPage 的滚动容器给了确定高度）；阅读页外层有 padding，
  // 这里用固定视口高度兜底，避免 iframe 高度塌陷。
  return (
    <div style={{ height: 'min(78vh, 820px)', minHeight: 420, margin: '0 24px 40px', border: '1px solid #ebedf0', borderRadius: 8, overflow: 'hidden' }}>
      <DrawioEditor docId={0} initialContent={content} title="绘图预览" mode="view" />
    </div>
  )
}
