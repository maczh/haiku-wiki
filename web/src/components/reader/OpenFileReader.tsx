import { lazy, Suspense } from 'react'

export type ReaderMode = 'reader' | 'share' | 'preview' | 'h5'

interface Props {
  url: string
  filename: string
  mode?: ReaderMode
  height?: string
}

// Keep one ordered plugin set for both the knowledge base and netdisk. Office
// precedes text so csv/tsv use the spreadsheet preview when available.
const OpenFileReaderRuntime = lazy(() => import('./OpenFileReaderRuntime'))

/** Unified file preview used by reading, sharing, preview and H5 surfaces. */
export default function OpenFileReader(props: Props) {
  return (
    <Suspense fallback={<div style={{ minHeight: 240, display: 'grid', placeItems: 'center', color: '#8c8c8c' }}>正在加载文件预览器…</div>}>
      <OpenFileReaderRuntime {...props} />
    </Suspense>
  )
}
