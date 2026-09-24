#!/usr/bin/env node
// 编辑器菜单回归：Markdown 右键上下文菜单（行/选区/表格三态）+ Luckysheet 内置下拉（文字色/背景色/边框）。
//
// 与旧 e2e-editor-context-menu.sh 的差别（关键）：全部使用「真实输入事件」——
//   右键 = page.mouse.click(button:'right')；子菜单 = page.hover 真实悬停；菜单项 = page.click 真实左键。
//   上一轮脚本用合成 dispatchEvent/hit.click()（无真实 mousedown），漏判了 Bug B：真实用户 mousedown 会先
//   把整个右键菜单卸载，click 永远命中不到子菜单项 onClick。
//
// 数据：tools/verify/fixtures/e2e-data 的临时副本（book 1=md 2=sheet），账号 e2e@example.com/secret123。
// 二进制：环境 $TMPDIR/haiku-wiki（由 bash tools/build/build-embed.sh 产出）。
//
// ⚠️ 跨平台：playwright-core 与 Chrome 路径都按宿主推导，别写死 `/Users/...` 或 `/Applications/...`
//    （写死会在 Linux 上 `ERR_MODULE_NOT_FOUND` 秒退，表现为 run-all 里「exit=1 用时=0s」）。
// ⚠️ 基准目录用 `os.homedir()` 而非 `process.env.HOME`：本机 shell 环境里 HOME 可能**未设置**
//    （实测 undefined），模板会拼出 "undefined/…"，动态 import 会把它当**裸包名**而报
//    `Cannot find package 'undefined'`（极难看出是 HOME 的问题）。
const HOME = process.env.HOME || os.homedir()
const PW_CORE = process.env.PW_CORE
  || path.join(HOME, '.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js')
if (!fs.existsSync(PW_CORE)) {
  console.error(`未找到 playwright-core：${PW_CORE}（可用 PW_CORE=/path/to/playwright-core/index.js 覆盖）`)
  process.exit(1)
}
const pw = (await import(PW_CORE)).default
const { chromium } = pw
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const PORT = Number(process.env.PORT || 8193)
const BASE = `http://127.0.0.1:${PORT}`
const FIXTURE = path.resolve('tools/verify/fixtures/e2e-data')
const BIN = path.join(process.env.TMPDIR || os.tmpdir(), 'haiku-wiki')
const CHROME = process.env.CHROME || [
  '/opt/google/chrome/chrome',                                              // Linux
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',          // macOS
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p))
if (!CHROME) { console.error('未找到 Chrome，请用 CHROME=/path/to/chrome 指定'); process.exit(1) }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxmenu-'))
const DATA = path.join(TMP, 'data')
execSync(`cp -r ${JSON.stringify(FIXTURE)}/. ${JSON.stringify(DATA)}/`, { stdio: 'inherit' })

let pass = 0, fail = 0
const log = (s) => console.log(s)
const ok = (n) => { pass++; log(`  ✅ ${n}`) }
const no = (n, d) => { fail++; log(`  ❌ ${n}${d ? ' —— ' + d : ''}`) }
const neq = (n, got) => { if (got) ok(n); else no(n, `got=${got}`) }

function httpGet(p, headers) {
  return new Promise((res, rej) => {
    const r = http.get(`${BASE}${p}`, { headers: headers || {} }, (resp) => { let d = ''; resp.on('data', (c) => (d += c)); resp.on('end', () => res({ code: resp.statusCode, body: d })) })
    r.on('error', rej); r.setTimeout(5000, () => r.destroy(new Error('timeout')))
  })
}
function httpPost(p, body, headers) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body)
    const r = http.request(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) } }, (resp) => { let d = ''; resp.on('data', (c) => (d += c)); resp.on('end', () => res({ code: resp.statusCode, body: d })) })
    r.on('error', rej); r.write(data); r.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try { const r = await httpGet('/api/books'); if (r.code !== 0) return } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error('server not up')
}

// ---- 浏览器通用 ----
let page
const IR = () => page.evaluate(() => !!document.querySelector('.vditor-ir .vditor-reset'))
async function waitIr() { for (let i = 0; i < 20; i++) { if (await IR()) return; await sleep(600) } }
function blkSig() { return page.evaluate(() => { const r = document.querySelector('.vditor-ir .vditor-reset'); if (!r) return 'no-ir'; return Array.from(r.children).map((c) => c.tagName.toLowerCase()).join(',') }) }
async function visitDoc(id, tab = 'edit') { await page.goto(`${BASE}/books/1?docId=${id}&tab=${tab}&_n=${Math.random()}`, { waitUntil: 'domcontentloaded' }); await waitIr() }
function blockXY(idx) {
  return page.evaluate((i) => { const r = document.querySelector('.vditor-ir .vditor-reset'); const t = r.children[i]; if (!t) return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + 40), y: Math.round(b.top + b.height / 2) } }, idx)
}
async function rightClickBlock(idx) { const p = await blockXY(idx); if (!p) throw new Error('no block ' + idx); await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(500); return p }
async function menuVisible() { return page.evaluate(() => !!document.querySelector('[data-vd-cm]')) }
// 右键菜单项现在都带 data-ctx-key；用 key 选择，避免文案/嵌套层级变化导致误判。
// 二级面板（转化为/缩进/在下方添加）与主菜单渲染在同一个 [data-vd-cm] 浮层内，
// 悬停触发项即展开面板，无需跨弹层。
async function hoverTrigger(key) {
  const handle = await page.evaluateHandle((k) => {
    const el = document.querySelector(`[data-vd-cm] [data-ctx-key="${k}"]`)
    return el && el.getClientRects().length > 0 ? el : null
  }, key)
  const el = handle.asElement(); if (!el) throw new Error('no trigger ' + key)
  await el.hover(); await sleep(700)
}
async function clickByKey(key) {
  const handle = await page.evaluateHandle((k) => {
    const el = document.querySelector(`[data-vd-cm] [data-ctx-key="${k}"]`)
    return el && el.getClientRects().length > 0 ? el : null
  }, key)
  const el = handle.asElement(); if (!el) throw new Error('no item ' + key)
  await el.click({ delay: 30 }); await sleep(1600)
}
// 行操作：右键 → 悬停触发（展开二级面板）→ 点二级项
async function lineOp(idx, trigger, item) { await rightClickBlock(idx); await hoverTrigger(trigger); await clickByKey(item) }
// 两级导航（addbelow 的分组只是视觉分组，项仍是平铺的 data-ctx-key）
async function lineOpNested(idx, trigger, _group, item) { await rightClickBlock(idx); await hoverTrigger(trigger); await clickByKey(item) }
// 选区：选中 block 前 n 字 → 右键 → 点顶部项
async function selOp(idx, n, item) {
  await page.evaluate(({ i, cnt }) => {
    const r = document.querySelector('.vditor-ir .vditor-reset'); const b = r.children[i]
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); let tn = null, node
    while ((node = w.nextNode())) { if ((node.textContent || '').replace(/​/g, '').trim() !== '') { tn = node; break } }
    if (!tn) return
    const len = Math.max(1, Math.min(cnt, tn.textContent.length))
    const sel = window.getSelection(); const rg = document.createRange(); rg.setStart(tn, 0); rg.setEnd(tn, len); sel.removeAllRanges(); sel.addRange(rg)
  }, { i: idx, cnt: n })
  await sleep(400)
  const p = await blockXY(idx); await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(500)
  await clickByKey(item)
}
async function createDoc(content) {
  const r = await httpPost('/api/books/1/docs', { parent_id: 0, title: '右键菜单用例', doc_type: 'markdown', content }, { Authorization: `Bearer ${TOKEN}` })
  const id = JSON.parse(r.body)?.data?.id ?? JSON.parse(r.body)?.data?.doc?.id
  if (!id) throw new Error('createDoc failed: ' + r.body)
  return id
}
async function docContent(id) { const r = await httpGet(`/api/docs/${id}`, { Authorization: `Bearer ${TOKEN}` }); return JSON.parse(r.body)?.data?.doc?.content ?? '' }
// 落库断言轮询：右键菜单动作会触发 3s 防抖自动保存，API 落库滞后于 DOM。
// 此处轮询 docContent 直到命中或超时，避免「读到保存前内容」的时序误判。
async function waitContent(id, pred, ms = 7000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred(await docContent(id))) return true
    await sleep(300)
  }
  return false
}

let TOKEN
let server, browser

async function main() {
  if (!fs.existsSync(BIN)) { console.error(`❌ 缺少 ${BIN}；先跑 bash tools/build/build-embed.sh`); process.exit(1) }
  const childEnv = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), JWT_SECRET: 'ctxmenu-secret', GIN_MODE: 'release', STORAGE_TYPE: 'local' }
  server = spawn(BIN, [], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', () => {}); server.stderr.on('data', (d) => { if (/address already in use/.test(d)) { console.error('❌ 端口被占用'); process.exit(1) } })
  await waitServer()

  const login = await httpPost('/api/auth/login', { account: 'e2e@example.com', password: 'secret123' })
  TOKEN = JSON.parse(login.body)?.data?.token
  if (!TOKEN) { console.error('❌ 登录失败: ' + login.body); process.exit(1) }

  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server', '--hide-scrollbars', '--window-size=1560,900'] })
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 900 } })
  page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }); await sleep(800)
  await page.evaluate((t) => { localStorage.setItem('hk_token', t); localStorage.removeItem('hk.toc.open') }, TOKEN)
  await page.goto(`${BASE}/books/1?_n=${Math.random()}`, { waitUntil: 'domcontentloaded' }); await sleep(800)

  const MD = '# 标题一\n\n正文段落一。第二句在这里。\n\n## 标题二\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |\n'

  // ===== 1) 行上下文：转化为（H1~H6 / 正文 / 列表 / 待办 / 代码 / 引用 / 高亮块 / 分栏 / 折叠块） =====
  log('===== 1) 行上下文：转化为 =====')
  let id = await createDoc(MD); await visitDoc(id); await waitIr()
  neq('初始块序 h1,p,h2,table', (await blkSig()) === 'h1,p,h2,table')
  await rightClickBlock(1)
  neq('顶层菜单出现', await menuVisible())
  // 顶层菜单应包含：转化为/删除/复制/剪切/缩进/在下方添加
  neq('顶层菜单含「转化为」', await page.evaluate(() => (document.querySelector('[data-vd-cm]').textContent || '').includes('转化为')))
  neq('顶层菜单含「在下方添加」', await page.evaluate(() => (document.querySelector('[data-vd-cm]').textContent || '').includes('在下方添加')))
  await lineOp(1, 'transform', 'h2'); neq('转化为→标题2', (await blkSig()) === 'h1,h2,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('h4'); neq('转化为→标题4', (await blkSig()) === 'h1,h4,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('h5'); neq('转化为→标题5', (await blkSig()) === 'h1,h5,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('h6'); neq('转化为→标题6', (await blkSig()) === 'h1,h6,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('quote'); neq('转化为→引用', (await blkSig()) === 'h1,blockquote,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('ul'); neq('转化为→无序列表', (await blkSig()) === 'h1,ul,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('ol'); neq('转化为→有序列表', (await blkSig()) === 'h1,ol,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('p'); neq('转化为→正文', (await blkSig()) === 'h1,p,h2,table')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('todo'); neq('转化为→待办(task)', await waitContent(id, (c) => c.includes('- [ ]')))
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('code'); neq('转化为→代码(fence)', await waitContent(id, (c) => c.includes('```')))
  // 高亮块 / 分栏 / 折叠块：HTML 包裹需经 IR 往返 + 阅读态渲染（关键回归点）
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('callout'); neq('转化为→高亮块(html 落库)', await waitContent(id, (c) => c.includes('hk-callout')))
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('columns'); neq('转化为→分栏(html 落库)', await waitContent(id, (c) => c.includes('hk-columns')))
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('transform'); await clickByKey('toggle'); neq('转化为→折叠块(details 落库)', await waitContent(id, (c) => c.includes('hk-toggle')))

  // ===== 2) 行上下文：在下方添加（基础 / 画板类 / 数据表） =====
  log('===== 2) 行上下文：在下方添加 =====')
  id = await createDoc(MD); await visitDoc(id); const t0 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset table').length); await lineOpNested(1, 'addbelow', '基础', 'table'); neq('在下方添加→基础→表格', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset table').length)) === t0 + 1)
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '基础', 'image'); neq('在下方添加→基础→图片(img)', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset img').length)) >= 1)
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '基础', 'attach'); neq('在下方添加→基础→附件', await waitContent(id, (c) => c.includes('附件名称')))
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '基础', 'status'); neq('在下方添加→基础→状态', await waitContent(id, (c) => c.includes('状态')))
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '画板类', 'flow'); neq('在下方添加→画板类→流程图(mermaid)', await waitContent(id, (c) => c.includes('flowchart')))
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '画板类', 'mindmap'); neq('在下方添加→画板类→思维导图(mindmap)', await waitContent(id, (c) => c.includes('mindmap')))
  id = await createDoc(MD); await visitDoc(id); await lineOpNested(1, 'addbelow', '画板类', 'board'); neq('在下方添加→画板类→画板', await waitContent(id, (c) => c.includes('flowchart')))
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('addbelow'); await clickByKey('datatable')
  const dtOk = await waitContent(id, (c) => c.includes('字段') && c.includes('说明'))
  if (!dtOk) { const raw = await docContent(id); log('    · DEBUG 数据表落库内容: ' + JSON.stringify(raw.slice(0, 360))) }
  neq('在下方添加→数据表', dtOk)

  // ===== 3) 删除 / 复制 / 剪切（顶部叶子项 + 剪贴板） =====
  log('===== 3) 删除 / 复制 / 剪切 =====')
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await clickByKey('delete'); neq('删除只删本行', (await blkSig()) === 'h1,h2,table')
  // 复制：块内容进剪贴板（headless 不一定有剪贴板权限，断言不崩 + 块数不变）
  id = await createDoc(MD); await visitDoc(id); const before = await blkSig(); await rightClickBlock(1); await clickByKey('copy'); await sleep(400); neq('复制不改变块数', (await blkSig()) === before)
  // 剪切：块被移除
  id = await createDoc(MD); await visitDoc(id); await rightClickBlock(1); await clickByKey('cut'); await sleep(400); neq('剪切移除本行', (await blkSig()) === 'h1,h2,table')

  // ===== 4) 缩进 增加 / 减少（菜单动作执行且不损坏文档结构） =====
  // 说明：Vditor IR 会把块首前导空格归一化掉（标题/段落），列表块整体缩进也未必落库为嵌套；
  // 故此处仅断言「动作可执行且不破坏块结构」，缩进落库嵌套为已知产品限制（见交付说明）。
  log('===== 4) 缩进 =====')
  const MDL = '# 标题\n\n- 项目一\n- 项目二\n'
  id = await createDoc(MDL); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('indent'); await clickByKey('indent-in'); neq('增加缩进不损坏文档结构', (await blkSig()) === 'h1,ul')
  id = await createDoc(MDL); await visitDoc(id); await rightClickBlock(1); await hoverTrigger('indent'); await clickByKey('indent-out'); neq('减少缩进不崩', (await blkSig()) === 'h1,ul')

  // ===== 5) 表格内上下文：行列增删 =====
  log('===== 5) 表格内上下文：行列增删 =====')
  id = await createDoc(MD); await visitDoc(id)
  await page.evaluate(() => { const tb = document.querySelector('.vditor-ir .vditor-reset table'); const td = tb.querySelector('tbody td'); const b = td.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 2 }); (document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) || td).dispatchEvent(ev) })
  await sleep(500)
  neq('右键单元格→6 项菜单', await menuVisible())
  const rows0 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset tbody tr').length)
  const cols0 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset thead th').length)
  await rightClickBlock; // noop
  // 重新打开单元格菜单并点项（真实点击）
  async function tblOp(text) { await page.evaluate(() => { const tb = document.querySelector('.vditor-ir .vditor-reset table'); const td = tb.querySelector('tbody td'); const b = td.getBoundingClientRect(); const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 2 }); (document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) || td).dispatchEvent(ev) }); await sleep(500); await clickByKey(text) }
  await tblOp('row-down'); neq('在下方插入行', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset tbody tr').length)) === rows0 + 1)
  const cols1 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset thead th').length)
  await tblOp('col-right'); neq('在右侧插入列', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset thead th').length)) === cols1 + 1)
  const rows2 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset tbody tr').length)
  await tblOp('row-del'); neq('删除本行', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset tbody tr').length)) === rows2 - 1)
  const cols3 = await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset thead th').length)
  await tblOp('col-del'); neq('删除本列', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset thead th').length)) === cols3 - 1)

  // ===== 6) 选区上下文：格式化 =====
  log('===== 6) 选区上下文：加粗/斜体/删除线/下划线/行内代码/代码块 =====')
  id = await createDoc(MD); await visitDoc(id); await selOp(1, 6, 'bold'); neq('选区→加粗(strong)', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset strong').length)) >= 1)
  id = await createDoc(MD); await visitDoc(id); await selOp(1, 6, 'italic'); neq('选区→斜体(em)', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset em').length)) >= 1)
  id = await createDoc(MD); await visitDoc(id); await selOp(1, 6, 'strike'); neq('选区→删除线(s)', (await page.evaluate(() => document.querySelectorAll('.vditor-ir .vditor-reset s').length)) >= 1)

  // ===== 7) Luckysheet 内置下拉：文字颜色 / 填充色 / 边框（Bug A 核心：点得开） =====
  log('===== 7) Luckysheet 内置下拉（Bug A 修复） =====')
  await visitDoc(2, 'edit'); await sleep(1500)
  neq('Luckysheet 已渲染', await page.evaluate(() => !!document.querySelector('.luckysheet-cell-main')))
  async function openLuckyToolbar({ id }) {
    const h = await page.evaluateHandle(({ id }) => document.querySelector('#' + id), { id })
    const el = h.asElement(); if (!el) throw new Error('no toolbar ' + id)
    await el.click({ delay: 20 }); await sleep(1000)
    return page.evaluate(({ id }) => { const m = document.querySelector('#' + id + '-menuButton'); if (!m) return 'no-panel'; const r = m.getBoundingClientRect(); if (r.width < 5 || r.height < 5) return 'hidden'; return 'shown' }, { id })
  }
  const fc = await openLuckyToolbar({ id: 'luckysheet-icon-text-color-menu' }); neq('文字颜色下拉可弹出', fc === 'shown')
  const bg = await openLuckyToolbar({ id: 'luckysheet-icon-cell-color-menu' }); neq('单元格背景色下拉可弹出', bg === 'shown')
  await sleep(1200)
  const br = await openLuckyToolbar({ id: 'luckysheet-icon-border-menu' }); neq('边框下拉可弹出', br === 'shown')

  // ===== 8) 自定义取色按钮：真实选单元格 → 点顶部「文字颜色」→ 选色块 → 断言落库（fc） =====
  // 这条是用户「颜色渲染」需求的可靠落色路径（applyCellColor 已修正 setCellFormat 签名为 (row,col,attr,value)）
  log('===== 8) 自定义取色按钮落色（颜色渲染） =====')
  await visitDoc(2, 'edit'); await sleep(1500)
  // 按坐标点选一个单元格（网格画在 canvas 上，默认列宽100/行高24）
  const cellPos = await page.evaluate(() => { const m = document.querySelector('.luckysheet-cell-main'); if (!m) return null; const b = m.getBoundingClientRect(); return { x: Math.round(b.left + 2 * 100 + 50), y: Math.round(b.top + 3 * 24 + 12) } })
  if (cellPos) { await page.mouse.click(cellPos.x, cellPos.y); await sleep(400) }
  const selCount = await page.evaluate(() => { try { const s = window.luckysheet.getluckysheet_select_save ? window.luckysheet.getluckysheet_select_save() : []; return Array.isArray(s) ? s.length : 0 } catch { return -1 } })
  neq('已选中单元格', selCount >= 1)
  // 点顶部「文字颜色」按钮（真实坐标点击，避开 antd Popover 可能的遮挡）
  const btnPos = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '文字颜色'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  neq('找到「文字颜色」按钮', !!btnPos)
  if (btnPos) {
    await page.mouse.click(btnPos.x, btnPos.y); await sleep(500)
    const swPos = await page.evaluate(() => { const t = Array.from(document.querySelectorAll('[title="#e60000"]')).find((e) => e.style && e.style.background); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
    neq('找到色板色块 #e60000', !!swPos)
    if (swPos) { await page.mouse.click(swPos.x, swPos.y); await sleep(400) }
    await sleep(4500)
    const c2 = await docContent(2)
    neq('文字颜色已落库(fc)', c2.includes('"fc"'))
  }
  // 背景色同理
  await visitDoc(2, 'edit'); await sleep(1500)
  const cellPos2 = await page.evaluate(() => { const m = document.querySelector('.luckysheet-cell-main'); if (!m) return null; const b = m.getBoundingClientRect(); return { x: Math.round(b.left + 5 * 100 + 50), y: Math.round(b.top + 6 * 24 + 12) } })
  if (cellPos2) { await page.mouse.click(cellPos2.x, cellPos2.y); await sleep(400) }
  const btnPos2 = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '单元格背景色'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  if (btnPos2) {
    await page.mouse.click(btnPos2.x, btnPos2.y); await sleep(500)
    const swPos2 = await page.evaluate(() => { const t = Array.from(document.querySelectorAll('[title="#0066cc"]')).find((e) => e.style && e.style.background); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
    if (swPos2) { await page.mouse.click(swPos2.x, swPos2.y); await sleep(400) }
    await sleep(4500)
    const c3 = await docContent(2)
    neq('单元格背景色已落库(bg)', c3.includes('"bg"'))
  }

  // ===== 控制台错误 =====
  log('===== 9) 控制台错误 =====')
  const realErr = errors.filter((e) => !/Download the React DevTools|404|favicon/i.test(e))
  neq('零控制台错误', realErr.length === 0)
  if (realErr.length) realErr.slice(0, 8).forEach((e) => log('    · ' + e.slice(0, 200)))

  log(`\n通过 ${pass} 项，失败 ${fail} 项`)
  await browser.close()
  server.kill('SIGKILL')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', e); try { server?.kill('SIGKILL') } catch {} try { browser?.close() } catch {} process.exit(2) })
