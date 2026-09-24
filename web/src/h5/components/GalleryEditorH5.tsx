import GalleryEditor from '../../components/gallery/GalleryEditor'

/**
 * H5 图片库编辑适配器。
 *
 * 桌面版 `GalleryEditor` 的 Props 是 `{ docId, content, onChanged? }`，
 * 而 H5 编辑矩阵统一用 `H5EditorProps { docId, initialContent, title }` 驱动，
 * 字段名不一致（content vs initialContent），这里包一层做映射，不动桌面编辑器。
 */
export default function GalleryEditorH5({ docId, initialContent }: { docId: number; initialContent: string; title: string }) {
  return <GalleryEditor docId={docId} content={initialContent} />
}
