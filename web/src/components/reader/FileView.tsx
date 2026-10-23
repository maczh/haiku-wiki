import { Alert } from 'antd'
import { parseNativeAttachment } from '../../lib/office/native'
import { useReaderWidth } from '../../lib/readerWidth'
import OpenFileReader from './OpenFileReader'

interface Props {
  content: string
  mode?: 'reader' | 'share' | 'preview' | 'h5'
  bookId?: number
  onDocCreated?: (docId: number) => void
}

/** Unified attachment reader. Supported formats use the original URL directly. */
export default function FileView({ content, mode = 'reader' }: Props) {
  const { maxWidth } = useReaderWidth()
  const ref = parseNativeAttachment(content)
  if (!ref) return <Alert type="warning" showIcon message="附件信息缺失或格式不正确，无法预览" />
  return (
    <div style={{ maxWidth: maxWidth ?? undefined, margin: '0 auto', width: '100%' }}>
      <OpenFileReader url={ref.edited_url || ref.url} filename={ref.filename} mode={mode} />
    </div>
  )
}
