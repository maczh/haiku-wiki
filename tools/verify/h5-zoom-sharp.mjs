/**
 * H5 缩放清晰度 + 思维导图视口高度探针（真机等效触摸序列）。
 *
 * 验证本轮两个修复：
 *   A. H5ZoomStage「折叠进 layout zoom」：双指放大松手后 data-h5-zoom-layout > 100
 *      （transform 缩放被折叠成 CSS zoom，浏览器按真实尺寸重排 → 文字不发糊）；
 *   B. PdfViewer 缩放感知重渲染：放大松手后可见页 canvas backing 分辨率显著提高
 *      （CSS 尺寸不变），重置后回落 —— 这是 PDF 放大不发糊的机制；
 *   C. 思维导图桌面阅读页/分享页画布高度 = 填满视口剩余高度（不再固定 560px）。
 *
 * 触摸序列用 Playwright CDP `Input.dispatchTouchEvent` 逐帧派发（同 h5-touch-scroll.mjs
 * 的结论：synthesizeScrollGesture 在本环境复现不了真实触摸路径）。
 * 输出 `RESULT <name> <step> <value> ok=<bool>`，由外层 bash 断言。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright-core')

const BASE = process.env.BASE || 'http://127.0.0.1:8186'
const TOKEN = process.env.TOKEN || ''
const OUT = process.env.OUT || '.'
// 文档 id（bash 侧准备）：PDF 附件 / DOCX 附件 / 思维导图
const PDF_ID = Number(process.env.PDF_DOC_ID || 5)
const DOCX_ID = Number(process.env.DOCX_DOC_ID || 0)
const MM_ID = Number(process.env.MM_DOC_ID || 3)
const MM_SLUG = process.env.MM_SLUG || ''
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome'

const log = (...a) => console.log(...a)
let failures = 0
function result(name, step, value, ok) {
  if (!ok) failures++
  // 固定 4 段：bash 侧按 $4 判 ok=，其余全部算 detail（value 可含空格/箭头）
  log(`RESULT ${name} ${step} ok=${ok} ${value}`)
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server', '--hide-scrollbars'],
})

// ---------- H5 移动上下文：双指缩放 ----------
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
})
await ctx.addInitScript(
  ([t]) => {
    try {
      localStorage.setItem('hk_token', t)
      localStorage.setItem('haiku_view_mode', 'h5')
    } catch {
      /* ignore */
    }
  },
  [TOKEN],
)
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)

/** 双指捏合：中点 (cx,cy)，两指间距 from→to（to>from 放大） */
async function pinch(cx, cy, from, to) {
  const pts = (d) => [
    { x: Math.round(cx - d / 2), y: Math.round(cy), radiusX: 10, radiusY: 10, force: 1, id: 1 },
    { x: Math.round(cx + d / 2), y: Math.round(cy), radiusX: 10, radiusY: 10, force: 1, id: 2 },
  ]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) })
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
}

async function zoomState() {
  return page.evaluate(() => {
    const host = document.querySelector('[data-h5-zoom]')
    const inner = host && host.querySelector('[data-h5-zoom-layout]')
    const canvas = Array.from(document.querySelectorAll('canvas')).find((c) => c.getBoundingClientRect().width > 80)
    return {
      host: !!host,
      scale: host ? Number(host.getAttribute('data-h5-zoom-scale') || 0) : 0,
      layout: inner ? Number(inner.getAttribute('data-h5-zoom-layout') || 0) : 0,
      canvasBacking: canvas ? canvas.width : 0,
      canvasCss: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
      canvasStyleW: canvas ? parseFloat(canvas.style.width || '0') : 0,
    }
  })
}

/** 单指划屏（验证缩放修复没破坏原生的滚动/划屏行为） */
async function touchScroll(x, y0, y1) {
  const tp = (y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(y0) })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(y0 + ((y1 - y0) * i) / 10) })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(320)
}

// ---- A/B：PDF 双指放大 → 折叠 + 升清；重置 → 回落 ----
{
  await page.goto(`${BASE}/m/doc/${PDF_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  const base = await zoomState()
  result('pdf' , 'base-canvas', `backing=${base.canvasBacking} css=${base.canvasCss}`, base.canvasBacking > 200 && base.canvasCss > 80)

  await pinch(195, 420, 80, 300)
  await page.waitForTimeout(1200) // fold 立即生效；PdfViewer 防抖 300ms + 重渲染耗时
  const z = await zoomState()
  result('pdf', 'zoom-scale', z.scale, z.scale >= 200)
  result('pdf', 'fold-layout-zoom', z.layout, z.layout >= 200)
  // CSS 布局尺寸不得变（否则版面跳）—— 比 style.width（布局值），rect 是视觉值会被 zoom 放大
  result('pdf', 'css-unchanged', `${z.canvasStyleW} vs ${base.canvasStyleW}`, Math.abs(z.canvasStyleW - base.canvasStyleW) <= 1)
  result('pdf', 'backing-boosted', `${base.canvasBacking} -> ${z.canvasBacking}`, z.canvasBacking >= base.canvasBacking * 1.6)
  await page.screenshot({ path: `${OUT}/zoom-pdf-boosted.png` })

  // 重置：layout zoom 与 backing 都应回到基准
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /重置/.test(x.innerText || ''))
    if (b) b.click()
  })
  await page.waitForTimeout(1500)
  const r = await zoomState()
  result('pdf', 'reset-scale', r.scale, r.scale === 100)
  result('pdf', 'reset-layout', r.layout, r.layout === 100)
  result('pdf', 'reset-backing', `${r.canvasBacking} vs ${base.canvasBacking}`, Math.abs(r.canvasBacking - base.canvasBacking) <= 2)
  result('pdf', 'reset-style-w', `${r.canvasStyleW} vs ${base.canvasStyleW}`, Math.abs(r.canvasStyleW - base.canvasStyleW) <= 1)
}

// ---- A2：DOCX 折叠进 layout zoom（DOM 文字按真实尺寸重排） ----
if (DOCX_ID > 0) {
  await page.goto(`${BASE}/m/doc/${DOCX_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const hasDocx = await page.evaluate(() => !!document.querySelector('.docx-preview'))
  result('docx', 'rendered', hasDocx, hasDocx)
  if (hasDocx) {
    await pinch(195, 420, 80, 300)
    await page.waitForTimeout(1200)
    const z = await zoomState()
    result('docx', 'zoom-scale', z.scale, z.scale >= 200)
    result('docx', 'fold-layout-zoom', z.layout, z.layout >= 200)
    await page.screenshot({ path: `${OUT}/zoom-docx-folded.png` })

    // 放大态单指拖动（平移）仍由手势层接管：记录触发痕迹即可（不强制位移方向）
    // 再缩回 1:1：layout zoom 应回 100（3.75 × 60/300 = 0.75 → 触底 MIN_SCALE=1）
    await pinch(195, 420, 300, 60)
    await page.waitForTimeout(1000)
    const back = await zoomState()
    result('docx', 'pinch-out-reset', back.layout, back.layout === 100 && back.scale === 100)
  }
}

// ---- 缩放修复不破坏划屏：PDF 页缩回 1:1 后单指划屏仍归原生滚动 ----
{
  await page.goto(`${BASE}/m/doc/${PDF_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const m = await page.evaluate(() => {
    const h = document.querySelector('[data-h5-zoom]')
    return h ? { sh: h.scrollHeight, ch: h.clientHeight } : null
  })
  if (m && m.sh - m.ch > 60) {
    await touchScroll(195, 700, 400)
    const top = await page.evaluate(() => {
      const h = document.querySelector('[data-h5-zoom]')
      return h ? Math.round(h.scrollTop) : -1
    })
    result('pdf', 'native-scroll-1x', top, top > 10)
  } else {
    result('pdf', 'native-scroll-1x', `skip sh=${m ? m.sh : 'na'}`, true)
  }
}

// ---------- 桌面上下文：思维导图视口高度 ----------
{
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await dctx.addInitScript(
    ([t]) => {
      try {
        localStorage.setItem('hk_token', t)
        localStorage.setItem('haiku_view_mode', 'desktop')
      } catch {
        /* ignore */
      }
    },
    [TOKEN],
  )
  const dp = await dctx.newPage()

  // 阅读模式：画布应填满标题以下剩余视口（>560 且不超过视口）
  await dp.goto(`${BASE}/books/1?docId=${MM_ID}&tab=read`, { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(4500)
  const h1 = await dp.evaluate(() => {
    const el = document.querySelector('[data-h5-native-zoom]')
    if (!el) return 0
    const wrap = el.parentElement
    return wrap ? Math.round(wrap.getBoundingClientRect().height) : 0
  })
  result('mindmap', 'reader-height', h1, h1 > 600 && h1 <= 900)

  // 分享模式（文档级 /doc-share/:slug）
  if (MM_SLUG) {
    await dp.goto(`${BASE}/doc-share/${MM_SLUG}`, { waitUntil: 'domcontentloaded' })
    await dp.waitForTimeout(4500)
    const h2 = await dp.evaluate(() => {
      const el = document.querySelector('[data-h5-native-zoom]')
      if (!el) return 0
      const wrap = el.parentElement
      return wrap ? Math.round(wrap.getBoundingClientRect().height) : 0
    })
    result('mindmap', 'share-height', h2, h2 > 600 && h2 <= 900)
    await dp.screenshot({ path: `${OUT}/mindmap-share-height.png` })
  }
  await dctx.close()
}

await browser.close()
log(`ZOOM_SHARP_FAILURES=${failures}`)
process.exit(0)
