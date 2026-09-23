import { useEffect, useRef, useState } from 'react'
import luckysheet from 'luckysheet'
import 'luckysheet/dist/css/luckysheet.css'
import 'luckysheet/dist/assets/iconfont/iconfont.css'
import { Alert, Modal, Input, Button, message } from 'antd'
import { parseSheetJSON, sheetsToLuckysheet, textOfValue } from '../../lib/sheet'
import type { SheetJSON } from '../../lib/sheet'

/**
 * luckysheet 2.x 内部通过全局 `localforage` 做缓存读取，且其 gating 代码
 * `localforage.getItem(cahce_key).then(...)` 丢失了 .catch：一旦底层存储不可用
 * （隐私模式 / 微信 WebView / 存储被禁用 / IndexedDB 异常），该 promise 直接 reject，
 * ini() 永不执行 → 只读表格卡在「渲染中」或显示空白（编辑态常走不同路径故正常）。
 *
 * luckysheet 的 umd 包把 localforage 当作裸全局引用（非模块导入），因此只要在首次
 * 调用 create() 前把 window.localforage 换成「任何读写都 resolve 而非 reject」的兜底，
 * 就能保证 ini() 一定被走到。这里在模块加载时安装一次。
 */
function installLuckysheetLocalforageFallback() {
  const w = window as unknown as { localforage?: unknown; __hk_lf_patched?: boolean }
  if (w.__hk_lf_patched) return
  w.__hk_lf_patched = true
  const real = w.localforage as Record<string, unknown> | undefined
  const memory = new Map<string, unknown>()
  const fallback = (k: string) => (memory.has(k) ? memory.get(k) : null)
  /** 把「真实实现或同步异常」统一收敛为一个永不 reject、且一定是 Promise 的结果 */
  const toPromise = (raw: unknown): Promise<unknown> =>
    raw && typeof (raw as Promise<unknown>).then === 'function' ? (raw as Promise<unknown>).catch(() => undefined) : Promise.resolve()

  // ⚠️ localforage 同时支持 promise 与 callback 两种调用形式，luckysheet 内部两种都在用：
  //   · gating  `localforage.getItem(k).then(...)`            → promise 形式
  //   · 清缓存   `localforage.removeItem(k, function(){ini()})` → **callback 形式**
  // 因此每个方法都必须：既返回 promise，又在传入 callback 时回调它（成功/失败都要回调），
  // 否则 clearcachelocaldata 的 callback 不触发 → ini() 仍不执行 → 依旧白屏。
  const safeGet = (k: string, cb?: (err: unknown, v: unknown) => void) => {
    let p: Promise<unknown>
    try {
      const raw = real && typeof real.getItem === 'function' ? (real.getItem as (kk: string) => unknown)(k) : null
      p =
        raw && typeof (raw as Promise<unknown>).then === 'function'
          ? (raw as Promise<unknown>).then((v) => (v == null ? fallback(k) : v)).catch(() => fallback(k))
          : Promise.resolve(fallback(k))
    } catch {
      p = Promise.resolve(fallback(k))
    }
    if (typeof cb === 'function') p.then((v) => cb(null, v), () => cb(null, fallback(k)))
    return p
  }
  const safeSet = (k: string, v: unknown, cb?: (err: unknown) => void) => {
    memory.set(k, v)
    let p: Promise<unknown> = Promise.resolve()
    try {
      if (real && typeof real.setItem === 'function') p = toPromise((real.setItem as (kk: string, vv: unknown) => unknown)(k, v))
    } catch {
      p = Promise.resolve()
    }
    if (typeof cb === 'function') p.then(() => cb(null), () => cb(null))
    return p
  }
  const safeRemove = (k: string, cb?: (err: unknown, v: unknown) => void) => {
    memory.delete(k)
    let p: Promise<unknown> = Promise.resolve()
    try {
      if (real && typeof real.removeItem === 'function') p = toPromise((real.removeItem as (kk: string) => unknown)(k))
    } catch {
      p = Promise.resolve()
    }
    if (typeof cb === 'function') p.then(() => cb(null, undefined), () => cb(null, undefined))
    return p
  }
  const shim = new Proxy((real as unknown) ?? {}, {
    get(target, prop: string) {
      if (prop === 'getItem') return safeGet
      if (prop === 'setItem') return safeSet
      if (prop === 'removeItem') return safeRemove
      const v = (target as Record<string, unknown>)[prop]
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
  w.localforage = shim
}
installLuckysheetLocalforageFallback()

interface Props {
  /** docs.content（SheetJSON 字符串） */
  content: string
}

/** Luckysheet 只暴露给本文件用到的 API（包内无 TS 类型） */
interface LuckysheetApi {
  create(options: Record<string, unknown>): void
  destroy(): void
  /** 重算网格几何（点击命中的行/列映射依赖它）；滚动/缩放后重新测量以修正错位 */
  refresh(): void
  /** 当前选区（阅读态亦会跟踪）；返回 [{row:[r1,r2], column:[c1,c2], sheetIndex?}, …] */
  getluckysheet_select_save?: () => unknown
  [key: string]: unknown
}

let seq = 0

/** 只读视图的最小估算行数 */
const DEFAULT_ROW_COUNT = 20

/** 列号 0 基 → 字母（0→A, 25→Z, 26→AA） */
function colLabel(c: number): string {
  let s = ''
  let n = c
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** 0 基行列 → 单元格坐标展示，如 (9,0) → "A10" */
function cellRef(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`
}

/** 解析一次并缓存（content 未变时不重复解析） */
function useParsed(content: string): { data: SheetJSON; reset: boolean; migrated: boolean } {
  const [state, setState] = useState(() => parseSheetJSON(content))
  useEffect(() => {
    setState(parseSheetJSON(content))
  }, [content])
  return state
}

/**
 * 只读表格渲染（Luckysheet 只读模式，与编辑器同一内核与同一份隔离层，
 * 保证「编辑态所见即阅读态所得」）。
 */
export default function SheetView({ content }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [reset, setReset] = useState(false)
  const [copyCell, setCopyCell] = useState<{ row: number; col: number; text: string } | null>(null)
  const parsed = useParsed(content)

  useEffect(() => {
    if (parsed.reset) setReset(true)
    const host = elRef.current
    if (!host) return
    host.innerHTML = ''
    const containerId = `hk-luckysheet-view-${++seq}`
    const box = document.createElement('div')
    box.id = containerId
    box.style.width = '100%'
    // ⚠️ 必须 relative：luckysheet 的根 `.luckysheet` 是 `position:absolute`（自带 CSS，无 top/left）。
    // 宿主是 static 时，它的包含块会落到滚动容器之外的某个定位祖先上 —— 于是网格**不随页面滚动**
    // （实测：阅读容器滚 156px，宿主 rect.top 从 260→104，而 `#luckysheet-cell-main` 恒为 280）。
    // 但 luckysheet 计算点击命中行用的是 `$("#"+container).offset().top`（宿主位置），两者脱钩 →
    // 「第一次点击正常，第二次起整行下移约 6 行」。把宿主设为 relative，包含块即宿主本身，
    // 网格随滚动同步移动，宿主偏移量恒等于网格原点，命中即恒正确（含滚动之后）。
    box.style.position = 'relative'
    // Luckysheet 需要确定高度：按首表行数估算，落在 360~1400px 之间，
    // 超高时靠 Luckysheet 自身滚动，不撑爆外层阅读容器。
    const first = parsed.data.sheets?.[0]
    const rows = Math.max(DEFAULT_ROW_COUNT, ...(parsed.data.sheets ?? []).map((s) => s.row ?? 0))
    box.style.height = `${Math.min(1400, Math.max(360, (first?.celldata?.length ? rows : 20) * 24 + 120))}px`
    host.appendChild(box)

    const api = luckysheet as unknown as LuckysheetApi
    ;(window as unknown as { luckysheet?: unknown }).luckysheet = api

    // 阅读/分享态双击单元格：打开只读「内容编辑」浮层，可选取部分文字复制为纯文本，
    // 但绝不会写回单元格（allowEdit:false 已禁止落库，这里也只读数）。
    const onCellDblClick = () => {
      const ranges = api.getluckysheet_select_save?.() as
        | Array<{ row: number[]; column: number[]; sheetIndex?: number }>
        | undefined
      if (!ranges || ranges.length === 0) return
      const r0 = ranges[0]
      const row = r0.row?.[0]
      const col = r0.column?.[0]
      if (typeof row !== 'number' || typeof col !== 'number') return
      const sheetIdx = typeof r0.sheetIndex === 'number' ? r0.sheetIndex : 0
      const sheet = parsed.data.sheets?.[sheetIdx] ?? parsed.data.sheets?.[0]
      if (!sheet) return
      const text = textOfValue(sheet.celldata?.find((it) => it.r === row && it.c === col)?.v)
      setCopyCell({ row, col, text })
    }
    box.addEventListener('dblclick', onCellDblClick, true)

    // 命中兜底：宿主已设为 relative（见上），正常情况下「宿主 top + 列头高 === 网格 top」恒成立，
    // 命中不会偏行。这里只在极少数**二者脱钩**时（例如外层做了 transform/缩放、或上方内容
    // 在点击前一刻才回流）才重测几何，避免每次点击都 jfrefreshgrid 整表重绘造成闪烁。
    const onPointerDown = () => {
      const cm = box.querySelector('#luckysheet-cell-main')
      if (!cm) return
      const drift = cm.getBoundingClientRect().top - box.getBoundingClientRect().top
      // 网格原点相对宿主的正常偏移 = 列头高度（20）附近；偏离超过一行(24)即视为脱钩
      if (Math.abs(drift - 20) > 24) doRefresh()
    }
    box.addEventListener('pointerdown', onPointerDown, true)

    let raf = 0
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    let rafScheduled = false
    let created = false
    // SPA 内「window load」早已触发，靠它不可靠；用字体就绪 + 尺寸观察 + 两次延时兜底
    // 吸收打开表格文档后上方内容的迟滞回流（字体 / 图片 / 异步渲染），避免双击错位。
    const settleTimers: ReturnType<typeof setTimeout>[] = []
    // 阅读态表格嵌在会纵向滚动的文档流里，且上方常有标题 / 宽度调节器 / 异步渲染的
    // 正文；布局稳定前 Luckysheet 已在 create 时缓存了网格几何（含容器相对文档的纵向偏移）。
    // 之后页面滚动，或上方内容回流（字体加载、图片加载、Markdown 异步渲染、宽度调节器布局），
    // 都会使缓存偏移与实际错位 —— 此刻单击/双击命中整行下移（编辑态网格被固定容器钉住，故无此问题）。
    //
    // 关键修复：原实现把重测延迟 200ms（setTimeout 防抖）。问题恰好出在这 200ms 上——
    // 首次点击常落在初始 settle 重测之后，故命中正确；用户滚动后再点击若落在 200ms 窗口内，
    // 几何仍是旧的，于是「第二次起点击整行下移约 6 行」。改为用 requestAnimationFrame 在
    // 下一帧立即重测（无人为延迟、不丢事件），并在 pointerdown 命中前同步再测一次，
    // 保证每次点击都基于最新几何，彻底消除稳定后的偏移。
    const doRefresh = () => {
      if (!created) return
      // 关键防护：luckysheet 创建后会在容器内挂一个白底的「渲染中」遮罩
      // (#luckysheetloadingdata)，它要等 ini()→execF() 完成后才淡出移除。
      // 若在此遮罩尚在时调用 refresh()（id()），会在尚未就绪的数据上重绘网格，
      // 把已渲染的表格清空成空白 —— 这正是「阅读态表格偶发空白」的元凶。
      // 因此遮罩尚在时一律跳过，等其移除（ini 完成）后再允许重测几何。
      const overlay = box.querySelector('#luckysheetloadingdata')
      if (overlay) return
      try {
        api.refresh()
      } catch {
        /* 个别版本无 refresh，忽略 */
      }
    }
    const scheduleRefresh = () => {
      if (!created || rafScheduled) return
      rafScheduled = true
      requestAnimationFrame(() => {
        rafScheduled = false
        doRefresh()
      })
    }
    // 兜底：即便 ini() 因某种原因始终没移除遮罩（理论上已被上面的 localforage 兜底修复），
    // 这里也强制把它清掉，避免「渲染中」白屏卡死。多档延时覆盖「数据/字体回流」后才稳定。
    const clearLoadingMask = () => {
      const el = box.querySelector('#luckysheetloadingdata') as HTMLElement | null
      if (el) {
        el.style.display = 'none'
        el.remove()
      }
    }

    raf = requestAnimationFrame(() => {
      try {
        api.create({
          container: containerId,
          lang: 'zh',
          title: '',
          showinfobar: false,
          showtoolbar: false,
          showsheetbar: true, // 多工作表时仍可切换查看
          showsheetbarConfig: { add: false, menu: false, sheet: true },
          showstatisticBar: false,
          sheetFormulaBar: false,
          allowEdit: false,
          allowCopy: true,
          enableAddRow: false,
          enableAddBackTop: false,
          defaultColWidth: 100,
          defaultRowHeight: 24,
          data: sheetsToLuckysheet(parsed.data),
        })
        created = true
        // 创建后立刻再测一次，吸收创建那一帧的布局抖动
        scheduleRefresh()
        // 两次延时兜底：打开文档后上方内容（字体 / 图片 / 异步正文）可能迟滞回流，
        // 使缓存纵向偏移再度错位；停止变动后 refresh 重测，确保双击命中不偏行。
        settleTimers.push(setTimeout(scheduleRefresh, 400))
        settleTimers.push(setTimeout(scheduleRefresh, 1200))
        // 兜底清「渲染中」遮罩：ini() 完成后正常会淡出移除；这里再加一道保险，
        // 万一遮罩因异常残留，则在 2s / 4s 两档被强制清掉（阈值取大，避免大表仍在
        // 正常加载时被过早移除）。
        settleTimers.push(setTimeout(clearLoadingMask, 2000))
        settleTimers.push(setTimeout(clearLoadingMask, 4000))
      } catch (e) {
        message.error(`表格渲染失败：${(e as Error)?.message || '未知错误'}`)
      }
    })

    // 监听一切会改变容器纵向偏移的时机
    window.addEventListener('scroll', scheduleRefresh, true)
    window.addEventListener('resize', scheduleRefresh)
    window.addEventListener('load', scheduleRefresh) // 图片/字体加载完、上方回流稳定后校正
    // 容器自身尺寸变化（如上方内容回流挤动）即重测
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleRefresh()) : null
    ro?.observe(host)
    // 字体异步加载是上方回流的主因，字体就绪后追加校正
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => scheduleRefresh()).catch(() => undefined)
    }

    return () => {
      cancelAnimationFrame(raf)
      if (scrollTimer !== null) clearTimeout(scrollTimer)
      settleTimers.forEach((t) => clearTimeout(t))
      window.removeEventListener('scroll', scheduleRefresh, true)
      window.removeEventListener('resize', scheduleRefresh)
      window.removeEventListener('load', scheduleRefresh)
      ro?.disconnect()
      box.removeEventListener('dblclick', onCellDblClick, true)
      box.removeEventListener('pointerdown', onPointerDown, true)
      try {
        api.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
      host.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  /** 复制所选（无选区则复制全部）；纯文本，不回写单元格 */
  const copySelected = () => {
    if (!taRef.current || !copyCell) return
    const ta = taRef.current
    const text =
      ta.selectionStart !== ta.selectionEnd
        ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
        : ta.value
    if (!text) {
      message.warning('没有可复制的内容')
      return
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => message.success('已复制纯文本到剪贴板'))
        .catch(() => legacyCopy(text))
    } else {
      legacyCopy(text)
    }
  }

  /** 不支持 Clipboard API 时的回退（execCommand） */
  const legacyCopy = (text: string) => {
    try {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.select()
      document.execCommand('copy')
      message.success('已复制纯文本到剪贴板')
    } catch {
      message.warning('复制失败，请手动选择复制')
    }
  }

  return (
    <div>
      {reset && (
        <Alert
          type="warning"
          showIcon
          message="内容格式异常，已重置为空表格"
          style={{ margin: 12 }}
          closable
          onClose={() => {
            setReset(false)
            message.info('提示已关闭')
          }}
        />
      )}
      <div ref={elRef} style={{ width: '100%', minHeight: 360 }} />

      {copyCell && (
        <Modal
          title={`单元格 ${cellRef(copyCell.row, copyCell.col)} · 复制内容（只读）`}
          open
          onCancel={() => setCopyCell(null)}
          footer={[
            <Button key="copy" type="primary" onClick={copySelected}>
              复制所选
            </Button>,
            <Button key="close" onClick={() => setCopyCell(null)}>
              关闭
            </Button>,
          ]}
        >
          <Input.TextArea
            ref={taRef}
            readOnly
            value={copyCell.text}
            autoSize={{ minRows: 3, maxRows: 14 }}
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace', fontSize: 13 }}
          />
          <div style={{ marginTop: 8, color: '#8a919f', fontSize: 12, lineHeight: 1.7 }}>
            只读模式：可拖动选中其中任意部分文字后点「复制所选」，复制到剪贴板的内容为纯文本（不含表格样式），且不会修改原单元格内容。
          </div>
        </Modal>
      )}
    </div>
  )
}
