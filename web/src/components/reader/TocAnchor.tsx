import { useEffect, useState } from 'react'
import { Typography } from 'antd'

interface TocItem {
  id: string
  text: string
  level: number
}

/** 右侧大纲锚点：从渲染容器提取 h1~h4，点击平滑滚动。
 *  onItemsChange 向上报告条目数，供父组件决定是否展示浮动层。 */
export default function TocAnchor({
  container,
  onItemsChange,
}: {
  container: HTMLElement | null
  onItemsChange?: (count: number) => void
}) {
  const [items, setItems] = useState<TocItem[]>([])
  const [active, setActive] = useState('')

  useEffect(() => {
    if (!container) {
      setItems([])
      onItemsChange?.(0)
      return
    }
    const heads = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4'))
    const list = heads.map((h, i) => {
      const id = `hk-heading-${i}`
      h.id = id
      return { id, text: h.textContent || '', level: Number(h.tagName[1]) }
    })
    setItems(list)
    onItemsChange?.(list.length)
  }, [container, onItemsChange])

  // 滚动高亮当前小节
  useEffect(() => {
    if (!container || items.length === 0) return
    const onScroll = () => {
      const root = container.closest('.toc-scroll-root') as HTMLElement | null
      const scroller = root ?? container
      const top = scroller.getBoundingClientRect().top
      let cur = ''
      for (const it of items) {
        const el = document.getElementById(it.id)
        if (el && el.getBoundingClientRect().top - top < 80) cur = it.id
      }
      setActive(cur)
    }
    const scroller = (container.closest('.toc-scroll-root') as HTMLElement) ?? container
    scroller.addEventListener('scroll', onScroll)
    onScroll()
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [container, items])

  if (items.length === 0) return null

  return (
    <nav style={{ fontSize: 13, padding: '24px 12px 24px 0' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 12 }}>
        大纲
      </Typography.Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((it) => (
          <a
            key={it.id}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            style={{
              display: 'block',
              paddingLeft: 12 + (it.level - 1) * 12,
              lineHeight: '24px',
              color: active === it.id ? '#2f54eb' : '#5f6672',
              fontWeight: active === it.id ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {it.text}
          </a>
        ))}
      </div>
    </nav>
  )
}
