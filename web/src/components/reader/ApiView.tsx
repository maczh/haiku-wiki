import ApiEditor from '../editor/ApiEditor'

interface Props {
  content: string
  /** 阅读页通常无标题，编辑器顶栏会回退为「接口文档」 */
  title?: string
}

/**
 * 接口文档只读渲染（阅读模式）。
 * 直接复用 ApiEditor 并开启 readOnly：表单禁用、隐藏保存/导入，
 * 但「调试」仍可用（需求：阅读模式可以调试）。调试经服务端 /api/proxy 转发。
 */
export default function ApiView({ content, title }: Props) {
  return <ApiEditor initialContent={content} title={title} readOnly />
}
