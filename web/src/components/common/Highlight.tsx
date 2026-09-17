import { Fragment } from 'react'

/** 搜索关键词高亮：按关键词切分文本并 <mark> 标记 */
export default function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const kw = keyword.trim()
  if (!kw) return <>{text}</>
  // 大小写不敏感切分
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === kw.toLowerCase() ? (
          <mark key={i} className="hk-hit">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}
