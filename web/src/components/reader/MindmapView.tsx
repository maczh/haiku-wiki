import { parseMindmapJSON, treeToMarkdown } from '../../lib/mindmap'
import MarkmapPreview from './MarkmapPreview'

interface Props {
  content: string
}

/** 思维导图只读渲染（markmap） */
export default function MindmapView({ content }: Props) {
  const { data } = parseMindmapJSON(content)
  return <MarkmapPreview markdown={treeToMarkdown(data.tree)} />
}
