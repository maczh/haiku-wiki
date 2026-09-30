// H5 思维导图「单指上下左右划屏平移画布」探针：
// CDP Input.dispatchTouchEvent 派发真实触摸序列，断言画布视图 tx/ty 双向变化 + touch-action=none。
// 用法：node mm-h5-pan.mjs <baseURL> <token>
import { createRequire } from 'node:module'
const require2 = createRequire('/home/macro/.workbuddy/binaries/node/workspace/node_modules/')
const { chromium } = require2('playwright-core')

const BASE = process.argv[2] || 'http://127.0.0.1:8192'
const TOKEN = process.argv[3] || ''
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`)
}

const browser = await chromium.launch({
  executablePath: '/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'],
})
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([t]) => {
      localStorage.setItem('hk_token', t)
      localStorage.setItem('haiku_view_mode', 'h5')
    },
    [TOKEN]
  )
  await page.goto(`${BASE}/m/doc/3`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.mm-stage', { timeout: 20000 })
  await page.waitForTimeout(3500)

  const readView = () =>
    page.evaluate(() => {
      const g = document.querySelector('g.mm-root')
      const host = document.querySelector('[data-h5-native-zoom]')
      const m = g ? g.getAttribute('transform') || '' : ''
      const mm = m.match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/)
      return {
        tx: mm ? parseFloat(mm[1]) : null,
        ty: mm ? parseFloat(mm[2]) : null,
        touchAction: host ? getComputedStyle(host).touchAction : 'na',
        native: host ? host.getAttribute('data-h5-native-zoom') : 'na',
      }
    })

  const before = await readView()
  ok('H5 原生缩放挂载', before.native === '1', `native=${before.native}`)
  ok('touch-action=none（手势全接管）', before.touchAction === 'none', `touchAction=${before.touchAction}`)

  const cdp = await ctx.newCDPSession(page)
  const box = await page.locator('.mm-stage').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  async function swipe(dxTotal, dyTotal, steps = 6) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] })
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx + (dxTotal * i) / steps, y: cy + (dyTotal * i) / steps, id: 1 }],
      })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(200)
  }

  // 向右下划 → tx 增、ty 增（CDP 触摸序列可能被合并，只断言方向与生效）
  await swipe(120, 80)
  const after1 = await readView()
  ok('右下划屏平移画布', after1.tx > before.tx + 5 && after1.ty > before.ty + 5, `d=(${(after1.tx - before.tx).toFixed(1)},${(after1.ty - before.ty).toFixed(1)})`)

  // 向左上划 → 回到接近原位
  await swipe(-120, -80)
  const after2 = await readView()
  ok('左上划屏平移画布', Math.abs(after2.tx - before.tx) < 30 && Math.abs(after2.ty - before.ty) < 30, `d=(${(after2.tx - before.tx).toFixed(1)},${(after2.ty - before.ty).toFixed(1)})`)

  // 纵向划屏也被画布接管（不再走页面滚动）
  const scrollBefore = await page.evaluate(() => document.querySelector('[data-h5-main]')?.scrollTop ?? -1)
  await swipe(0, 150)
  const scrollAfter = await page.evaluate(() => document.querySelector('[data-h5-main]')?.scrollTop ?? -1)
  const after3 = await readView()
  ok('纵向划屏归画布（页面不滚）', scrollAfter === scrollBefore && after3.ty > before.ty + 3, `scroll ${scrollBefore}→${scrollAfter}, dTy=${(after3.ty - before.ty).toFixed(1)}`)
} finally {
  await browser.close()
}

const fail = results.filter((r) => !r.pass).length
console.log(`PASS=${results.length - fail} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
