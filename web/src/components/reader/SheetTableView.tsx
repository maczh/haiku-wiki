import { useMemo, useState } from 'react'
import { parseSheetJSON, textOfValue } from '../../lib/sheet'
import type { LuckysheetSheet } from '../../lib/sheet'

/**
 * 轻量级只读表格阅读组件（H5 阅读 / 分享态专用）。
 *
 * 取代笨重的 luckysheet {@link SheetView}：后者为渲染一张只读表要拉起整个 luckysheet
 * 内核（含全局 touch 劫持 shim、localforage 兜底、命中重测等 ~400 行 workaround），
 * 在移动端首屏成本与触摸划屏风险都高。本组件只用原生 <table> 渲染 SheetJSON，
 * 零第三方表格依赖、无副作用、可随页面自由滚动 —— 正是「轻量级表格组件」的目标。
 *
 * 能力覆盖阅读态所需：多工作表切换、合并单元格、单元格文本（富值 m 优先）、
 * 基础网格样式；不提供编辑、不缓存、不写回。
 */

interface Props {
  /** docs.content（SheetJSON 字符串；office 引用正文会被 pickReader 提前降级为 FileView） */
  content: string
}

interface MergeInfo {
  rs: number
  cs: number
}

const EMPTY = '\u00a0'

function buildGrid(sheet: LuckysheetSheet): {
  rows: (string | null)[][]
  rowCount: number
  colCount: number
  /** key "r_c" → 该单元格作为合并左上角时的跨行跨列；普通单元格不在表内 */
  merges: Record<string, MergeInfo>
  /** 被合并覆盖、渲染时须跳过的单元格 "r_c" 集合 */
  covered: Set<string>
} {
  const celldata = Array.isArray(sheet?.celldata) ? sheet.celldata : []
  let maxR = 0
  let maxC = 0
  for (const it of celldata) {
    if (typeof it?.r === 'number' && it.r > maxR) maxR = it.r
    if (typeof it?.c === 'number' && it.c > maxC) maxC = it.c
  }
  const declaredRow = typeof sheet?.row === 'number' && sheet.row > 0 ? sheet.row : 20
  const declaredCol = typeof sheet?.column === 'number' && sheet.column > 0 ? sheet.column : 8
  // 只在「数据范围 + 少量留白」内渲染，避免默认值(100×26)撑出大片空白表
  const rowCount = Math.max(6, Math.min(maxR + 4, declaredRow))
  const colCount = Math.max(4, Math.min(maxC + 2, declaredCol))

  const grid: (string | null)[][] = Array.from({ length: rowCount }, () =>
    new Array<string | null>(colCount).fill(null)
  )
  for (const it of celldata) {
    const r = Number(it?.r)
    const c = Number(it?.c)
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue
    const text = textOfValue(it?.v)
    grid[r][c] = text === '' ? '' : text
  }

  // 合并单元格：luckysheet 存于 config.merge，格式 { "r_c": { r, c, rs, cs } }
  const merges: Record<string, MergeInfo> = {}
  const covered = new Set<string>()
  const mergeRaw = (sheet?.config as { merge?: Record<string, MergeInfo> } | undefined)?.merge
  if (mergeRaw && typeof mergeRaw === 'object') {
    for (const [key, m] of Object.entries(mergeRaw)) {
      const rs = Number(m?.rs)
      const cs = Number(m?.cs)
      if (!Number.isFinite(rs) || !Number.isFinite(cs) || rs < 1 || cs < 1) continue
      merges[key] = { rs, cs }
      const [mr, mc] = key.split('_').map(Number)
      for (let rr = mr; rr < mr + rs; rr++) {
        for (let cc = mc; cc < mc + cs; cc++) {
          if (rr === mr && cc === mc) continue
          covered.add(`${rr}_${cc}`)
        }
      }
    }
  }

  return { rows: grid, rowCount, colCount, merges, covered }
}

export default function SheetTableView({ content }: Props) {
  const parsed = useMemo(() => parseSheetJSON(content), [content])
  const sheets = parsed.data?.sheets ?? []
  const [active, setActive] = useState(0)

  if (parsed.reset || sheets.length === 0) {
    return (
      <div
        style={{
          padding: '28px 16px',
          textAlign: 'center',
          color: '#8a8f99',
          fontSize: 13,
        }}
      >
        表格内容为空或格式无法解析
      </div>
    )
  }

  const idx = active >= 0 && active < sheets.length ? active : 0
  const sheet = sheets[idx]
  const { rows, rowCount, colCount, merges, covered } = useMemo(() => buildGrid(sheet), [sheet])

  return (
    <div style={{ width: '100%', padding: '8px 0' }}>
      {sheets.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            padding: '0 12px 8px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              style={{
                flex: '0 0 auto',
                padding: '5px 12px',
                borderRadius: 14,
                border: '1px solid #e3e6eb',
                background: i === idx ? '#2f6bff' : '#fff',
                color: i === idx ? '#fff' : '#3b3f47',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {typeof s?.name === 'string' && s.name.trim() !== '' ? s.name : `Sheet${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 12px' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: 'max-content',
            minWidth: '100%',
            fontSize: 13,
            color: '#1f2329',
            tableLayout: 'auto',
          }}
        >
          <tbody>
            {Array.from({ length: rowCount }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: colCount }).map((__, c) => {
                  const key = `${r}_${c}`
                  if (covered.has(key)) return null
                  const merge = merges[key]
                  const cell = rows[r][c]
                  return (
                    <td
                      key={c}
                      rowSpan={merge?.rs && merge.rs > 1 ? merge.rs : undefined}
                      colSpan={merge?.cs && merge.cs > 1 ? merge.cs : undefined}
                      style={{
                        border: '1px solid #e3e6eb',
                        padding: '5px 8px',
                        minWidth: 64,
                        maxWidth: 320,
                        height: 26,
                        verticalAlign: 'top',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        background: cell && cell !== '' ? '#fff' : '#fafbfc',
                      }}
                    >
                      {cell && cell !== '' ? cell : EMPTY}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
