/**
 * H5 触摸滚动探针（真机等效）。
 *
 * 为什么必须单独写这个：**`el.scrollTop = 200` 是程序化滚动，测不出触摸划屏失效**
 * —— 触摸滚动走浏览器的合成器/手势识别，只有派发**真实触摸事件**才能验证。
 * 之前的排查全用 `scrollTop` 写入，所以每次都「全绿但用户依旧说划不动」。
 *
 * 实现：playwright-core + CDP `Input.synthesizeScrollGesture`
 *   · `isMobile:true` + `hasTouch:true`（模拟手机内核，viewport meta / touch-action 行为才一致）
 *   · `gestureSourceType:'touch'` 让 Chrome 按触摸手势处理（含 touch-action 判定与惯性）
 *
 * 输出：每步一行 `RESULT <name> <step> scrollTop=<n> ok=<true|false>`，
 * 由外层 bash 断言。诊断信息打成 `DIAG ...`。
 */
import { createRequire } from 'node:module'

// ⚠️ **ESM 不认 NODE_PATH**（那是 CJS 的解析规则），直接 `import 'playwright-core'`
// 会报 ERR_MODULE_NOT_FOUND。套件把依赖装在托管 workspace 里、只给 NODE_PATH，
// 所以这里用 createRequire 走 CJS 解析（会读 NODE_PATH），既不用写死宿主绝对路径，
// 也不必给本仓库再加一份 node_modules。
const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright-core')

const BASE = process.env.BASE || 'http://127.0.0.1:8178'
const TOKEN = process.env.TOKEN || ''
const CASES = JSON.parse(process.env.CASES || '[]')
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome'

const log = (...a) => console.log(...a)

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server', '--hide-scrollbars'],
})

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

/**
 * 真实触摸滑动：从 (x,y0) 拖到 (x,y1)，y1<y0 表示内容上滚（即向下看）。
 *
 * ⚠️ **别用 `Input.synthesizeScrollGesture`**：实测在本环境（headless Chrome +
 * isMobile/hasTouch）下 `gestureSourceType:'touch'` **完全不产生滚动**（scrollTop 恒 0），
 * 只有 `'mouse'` 能滚 —— 用它会得到「什么都滚不动」的假失败。
 * 逐帧 `Input.dispatchTouchEvent` 才是真触摸路径（实测 scrollTop 能到 300+）。
 */
async function touchScroll(x, y0, y1) {
  const tp = (y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(y0) })
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: tp(y0 + ((y1 - y0) * i) / steps),
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(320)
}

/** 文库页的滚动容器指标（含诊断项） */
async function probeMain() {
  return page.evaluate(() => {
    const m = document.querySelector('[data-h5-main]')
    if (!m) return { main: false }
    const cs = getComputedStyle(m)
    const body = document.body
    const bcs = getComputedStyle(body)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const layers = []
    for (const c of body.children) {
      const s = getComputedStyle(c)
      if (s.position !== 'fixed') continue
      const r = c.getBoundingClientRect()
      if (r.width >= vw * 0.9 && r.height >= vh * 0.9) {
        layers.push(`${c.tagName}.${String(c.className || '').slice(0, 40)}`)
      }
    }
    const hit = document.elementFromPoint(Math.round(vw / 2), Math.round(vh / 2))
    // 「DOM 看着干净却划不动」时，真相几乎总是这三类：
    //   a) 命中元素或其某个祖先带 touch-action:none（会把整条手势吞掉）
    //   b) 上一页残留的全局样式/类名/节点（luckysheet / excalidraw 等都爱往 body 挂东西）
    //   c) 残留的 <style> 注入
    const taChain = []
    for (let e = hit; e && e !== document.documentElement.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e)
      taChain.push(`${e.tagName}${e === m ? '[data-h5-main]' : ''}:${s.touchAction}`)
      if (taChain.length >= 6) break
    }
    return {
      main: true,
      overflowY: cs.overflowY,
      touchAction: cs.touchAction,
      scrollHeight: m.scrollHeight,
      clientHeight: m.clientHeight,
      scrollTop: Math.round(m.scrollTop),
      bodyInlineOverflow: body.style.overflow || '-',
      bodyTouchAction: bcs.touchAction,
      bodyPosition: bcs.position,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      layers,
      hit: hit ? `${hit.tagName}.${String(hit.className || '').slice(0, 40)}` : 'null',
      taChain: taChain.join(' < '),
      // 残留物探测：这几类节点/全局在正常返回后都应为 0 / 空
      leftover: {
        styles: Array.from(document.querySelectorAll('style'))
          .slice(0, 16)
          .map((s) => `${s.id || '-'}::${(s.textContent || '').replace(/\s+/g, ' ').slice(0, 70)}`),
        luckysheetRoot: document.querySelectorAll('.luckysheet').length,
        luckysheetCell: document.querySelectorAll('#luckysheet-cell-main').length,
        excalidraw: document.querySelectorAll('.excalidraw').length,
        vditor: document.querySelectorAll('.vditor').length,
        bodyClass: document.body.className,
        htmlClass: document.documentElement.className,
        styleTags: document.querySelectorAll('style').length,
        headStyleText: Array.from(document.querySelectorAll('style'))
          .map((s) => (s.textContent || '').slice(0, 40))
          .filter((t) => /luckysheet|excalidraw|vditor|wx-/i.test(t))
          .slice(0, 4),
      },
    }
  })
}

let failures = 0

/** 单例：打开文库页 → 触摸滑动验可滚 → 进文档页 → 返回 → 再触摸滑动 */
async function runCase(name, docId, title) {
  // 1. 文库页（整页加载，作为基线）
  await page.goto(`${BASE}/m/books/1`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)

  const before = await probeMain()
  log(
    `DIAG2 ${name}(前) taChain=[${before.taChain}] st=${before.leftover.styleTags} ` +
      `lsRoot=${before.leftover.luckysheetRoot} lsCell=${before.leftover.luckysheetCell} ` +
      `bodyCls="${before.leftover.bodyClass}"`,
  )
  if (!before.main) {
    log(`RESULT ${name} before-main=false ok=false`)
    failures++
    return
  }
  const scrollableBefore = before.scrollHeight - before.clientHeight > 40
  if (!scrollableBefore) {
    log(`DIAG ${name} 文库页不可滚（sh=${before.scrollHeight} ch=${before.clientHeight}），跳过`)
    log(`RESULT ${name} before-not-scrollable ok=skip`)
    return
  }
  await touchScroll(195, 700, 400)
  const beforeTop = (await probeMain()).scrollTop
  const beforeOk = beforeTop > 10
  log(`RESULT ${name} before-swipe scrollTop=${beforeTop} ok=${beforeOk}`)
  if (!beforeOk) failures++

  // 2. SPA 导航进文档页（点文库树里标题匹配的行）
  const clicked = await page.evaluate((t) => {
    const rows = Array.from(document.querySelectorAll('div[role="button"]'))
    const r = rows.find((x) => (x.innerText || '').includes(t))
    if (!r) return 'not-found'
    r.click()
    return 'clicked'
  }, title)
  await page.waitForTimeout(3200)
  const docPath = new URL(page.url()).pathname

  // 3. 返回文库页（浏览器后退 = SPA 内导航，保留组件泄漏这个前提）
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2600)

  const after = await probeMain()
  if (!after.main) {
    log(`RESULT ${name} after-main=false ok=false`)
    failures++
    return
  }
  // 先把滚动位置归零，确保「划不动」不是已经滚到底造成的假象
  await page.evaluate(() => {
    const m = document.querySelector('[data-h5-main]')
    if (m) m.scrollTop = 0
  })
  await page.waitForTimeout(120)

  const afterTop0 = (await probeMain()).scrollTop

  // 「DOM/样式都干净却划不动」时最常见的元凶是**残留的全局监听器在 preventDefault**
  // （滚动会被整条手势吞掉）。检测方式：在 window 上挂**冒泡阶段**（最后一个跑）的
  // 监听器读 defaultPrevented —— 若为 true，说明前面有人调了 preventDefault。
  await page.evaluate(() => {
    window.__hkTouchLog = []
    window.__hkTouchLog._h = (e) => window.__hkTouchLog.push(`${e.type}:prevented=${e.defaultPrevented}:cancelable=${e.cancelable}`)
    for (const t of ['touchstart', 'touchmove', 'touchend']) window.addEventListener(t, window.__hkTouchLog._h)
  })
  await touchScroll(195, 700, 400)
  const afterTop = (await probeMain()).scrollTop
  const afterOk = afterTop > 10
  const touchLog = await page.evaluate(() => {
    const l = window.__hkTouchLog || []
    for (const t of ['touchstart', 'touchmove', 'touchend']) window.removeEventListener(t, l._h)
    return {
      events: l.length,
      prevented: l.filter((x) => x.includes('prevented=true')).length,
      sample: l.slice(0, 6),
    }
  })

  log(
    `DIAG ${name} click=${clicked} doc=${docPath} back=${new URL(page.url()).pathname} ` +
      `sh=${after.scrollHeight} ch=${after.clientHeight} top0=${afterTop0} ` +
      `ov=${after.overflowY} ta=${after.touchAction} bOv=${after.bodyInlineOverflow} bta=${after.bodyTouchAction} ` +
      `pos=${after.bodyPosition} htmlOv=${after.htmlOverflow} lay=${after.layers.length}` +
      (after.layers.length ? ` layer=[${after.layers.join(' | ')}]` : '') +
      ` hit=${after.hit}`,
  )
  log(`DIAG2 ${name} taChain=[${after.taChain}]`)
  log(
    `DIAG2 ${name} leftover=st${after.leftover.styleTags} lsRoot=${after.leftover.luckysheetRoot} ` +
      `lsCell=${after.leftover.luckysheetCell} exc=${after.leftover.excalidraw} vd=${after.leftover.vditor} ` +
      `bodyCls="${after.leftover.bodyClass}" htmlCls="${after.leftover.htmlClass}" ` +
      `headStyles=[${after.leftover.headStyleText.join(' | ')}]`,
  )
  const bs = after.leftover.styles
  log(`DIAG2 ${name} styles#${bs.length}=[${bs.map((s, i) => i + ':' + s).join(' ~ ')}]`)
  log(
    `DIAG2 ${name} touchEvt=${touchLog.events} prevented=${touchLog.prevented} ` +
      `sample=[${touchLog.sample.join(' | ')}]`,
  )
  log(`RESULT ${name} after-swipe scrollTop=${afterTop} ok=${afterOk}`)
  if (!afterOk) {
    failures++
    await page.screenshot({ path: `${process.env.OUT || '.'}/fail-${name}.png` })
  }
}

// ONLY=sheet,markdown 可只跑指定类型（定位问题时省时间）
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

for (const c of CASES) {
  if (ONLY && !ONLY.includes(c.name)) continue
  try {
    await runCase(c.name, c.id, c.title)
  } catch (e) {
    log(`RESULT ${c.name} error="${String(e).slice(0, 160)}" ok=false`)
    failures++
  }
}

log(`TOUCH_SCROLL_FAILURES=${failures}`)
await browser.close()
process.exit(0)
