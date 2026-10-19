import { useCallback, useEffect, useRef, useState } from 'react'

// FortuneSheet can emit onOp inside its state reducer. Never update its parent
// synchronously from that callback; coalesce status updates into the next frame.
export function useSheetDirty(readOnly: boolean) {
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const frame = useRef<number | null>(null)

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  useEffect(() => cancelFrame, [cancelFrame])

  const markDirty = useCallback(() => {
    if (readOnly || dirtyRef.current) return
    dirtyRef.current = true
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      setDirty(true)
    })
  }, [readOnly])

  const clearDirty = useCallback(() => {
    cancelFrame()
    dirtyRef.current = false
    setDirty(false)
  }, [cancelFrame])

  return { dirty, markDirty, clearDirty }
}
