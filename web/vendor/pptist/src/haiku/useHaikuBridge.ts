import { onMounted, onUnmounted, shallowRef } from 'vue'
import { useSlidesStore, useSnapshotStore } from '@/store'
import useImport from '@/hooks/useImport'
import useExport from '@/hooks/useExport'
import type { Slide, SlideTheme } from '@/types/slides'

interface Snapshot { slides: Slide[]; theme: SlideTheme; viewportSize: number; viewportRatio: number }

// pptxtojson returns temporary object URLs for media. Persist their bytes before the
// frame disappears, otherwise saved slides retain dead blob: references after reload.
async function persistMedia(value: unknown): Promise<unknown> {
  if (typeof value === 'string' && value.startsWith('blob:')) {
    const response = await fetch(value)
    if (!response.ok) throw new Error('嵌入媒体读取失败')
    const blob = await response.blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('嵌入媒体读取失败'))
      reader.readAsDataURL(blob)
    })
  }
  if (Array.isArray(value)) return Promise.all(value.map(persistMedia))
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await persistMedia(item)]))
    return Object.fromEntries(entries)
  }
  return value
}

export function useHaikuBridge() {
  const ready = shallowRef(false)
  const readOnly = shallowRef(true)
  const error = shallowRef('')
  const slides = useSlidesStore()
  const history = useSnapshotStore()
  const { importPPTXFile } = useImport()
  const { exportPPTX } = useExport()
  const send = (type: string, data: Record<string, unknown> = {}) => window.parent.postMessage({ channel: 'haiku-pptist', type, ...data }, window.location.origin)
  let loading = false

  async function receive(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.channel !== 'haiku-pptist') return
    const { type, requestId } = event.data
    try {
      if (type === 'load' && !loading && !ready.value) {
        loading = true
        readOnly.value = event.data.readOnly !== false
        slides.setTitle(event.data.title || '演示文稿')
        const snapshot = event.data.snapshot as Snapshot | undefined
        if (snapshot) {
          if (!Array.isArray(snapshot.slides) || !snapshot.slides.length) throw new Error('演示文稿快照无效')
          slides.$patch(snapshot)
        }
        else if (event.data.bytes instanceof ArrayBuffer) {
          await importPPTXFile([new File([event.data.bytes], 'presentation.pptx')], { cover: true })
          if (!slides.slides.length) throw new Error('PPTX 中没有可读取的幻灯片')
          slides.setSlides(await persistMedia(slides.slides) as Slide[])
        }
        else slides.setSlides([{ id: 'blank-slide', elements: [], background: { type: 'solid', color: '#ffffff' } }])
        slides.updateSlideIndex(0)
        await history.initSnapshotDatabase()
        ready.value = true
        send('loaded', { slideCount: slides.slides.length })
      }
      else if (type === 'snapshot' && ready.value && !readOnly.value) {
        const snapshot = await persistMedia(JSON.parse(JSON.stringify({ slides: slides.slides, theme: slides.theme, viewportSize: slides.viewportSize, viewportRatio: slides.viewportRatio })))
        const blob = await exportPPTX(slides.slides, false, false, true)
        if (!(blob instanceof Blob)) throw new Error('PPTX 导出失败')
        send('snapshot', { requestId, snapshot, blob })
      }
      else if (type === 'export' && ready.value) await exportPPTX(slides.slides, false, false)
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '演示文稿处理失败'
      if (!ready.value) error.value = message
      send('error', { requestId, message })
    }
  }

  onMounted(() => { window.addEventListener('message', receive); send('ready') })
  onUnmounted(() => window.removeEventListener('message', receive))
  return { ready, readOnly, error }
}
