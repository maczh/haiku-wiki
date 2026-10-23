import { FileViewer } from '@open-file-viewer/react'
import {
  archivePlugin,
  assetPlugin,
  audioPlugin,
  cadPlugin,
  drawingPlugin,
  emailPlugin,
  fallbackPlugin,
  gisPlugin,
  imagePlugin,
  model3dPlugin,
  officePlugin,
  pdfPlugin,
  textPlugin,
  videoPlugin,
  xmindPlugin,
} from '@open-file-viewer/core'
import '@open-file-viewer/core/style.css'
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'

export type ReaderMode = 'reader' | 'share' | 'preview' | 'h5'

interface Props {
  url: string
  filename: string
  mode?: ReaderMode
  height?: string
}

// Keep one ordered plugin set for both the knowledge base and netdisk. Office
// precedes text so csv/tsv use the spreadsheet preview when available.
const plugins = [
  officePlugin(),
  pdfPlugin({ workerSrc: pdfWorkerSrc }),
  imagePlugin(),
  videoPlugin(),
  audioPlugin(),
  textPlugin(),
  drawingPlugin(),
  xmindPlugin(),
  archivePlugin(),
  emailPlugin(),
  cadPlugin({
    libreDwg: {
      enabled: true,
      wasmBaseUrl: '/vendor/libredwg-web/wasm',
      // Keep the WASM parser in a worker when the browser supports module workers.
      workerModuleUrl: '/vendor/libredwg-web/dist/libredwg-web.js',
    },
  }),
  model3dPlugin(),
  gisPlugin(),
  assetPlugin(),
  fallbackPlugin(),
]

const toolbarByMode: Record<ReaderMode, boolean> = {
  reader: true,
  share: true,
  preview: true,
  h5: false,
}

/** Unified file preview used by reading, sharing, preview and H5 surfaces. */
export default function OpenFileReader({ url, filename, mode = 'reader', height = 'min(74vh, 860px)' }: Props) {
  return (
    <div className={`hk-open-file-reader hk-open-file-reader--${mode}`}>
      <FileViewer
        file={url}
        fileName={filename}
        width="100%"
        height={height}
        fit="contain"
        theme="auto"
        toolbar={toolbarByMode[mode]}
        fallback="download"
        plugins={plugins}
      />
    </div>
  )
}
