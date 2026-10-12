/**
 * 代码块「复制到剪贴板」回归（jsdom，无浏览器依赖）。
 *
 * 覆盖 web/src/lib/codeCopy.ts 的两个入口：
 *   1. injectCodeCopyButtons —— 阅读态/分享态/H5（按钮挂 pre 内）
 *   2. attachCodeCopyOverlay —— IR 编辑态（overlay 方案，不进 Vditor IR DOM）
 *
 * 跑法：npm run verify:code-copy
 *（esbuild 转译 TS → jsdom 执行；不需要 Chrome，也不需要起服务）
 */
import { JSDOM } from 'jsdom'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const REPO = path.resolve(WEB, '..')
const SRC = path.join(WEB, 'src/lib/codeCopy.ts')
const ESBUILD = path.join(WEB, 'node_modules/esbuild/bin/esbuild') // 原生二进制，直接执行
const BUNDLE = path.join(os.tmpdir(), 'codecopy-verify-bundle.mjs')

execSync(`${ESBUILD} ${SRC} --bundle --format=esm --outfile=${BUNDLE}`, { stdio: 'inherit' })

// jsdom 环境挂全局（Node 21+ 的全局 navigator 是只读 getter，须用 defineProperty）
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.MutationObserver = dom.window.MutationObserver
// jsdom 无 execCommand → mock 以验证降级路径
let execCmdCalls = []
dom.window.document.execCommand = (cmd) => { execCmdCalls.push(cmd); return true }

const { injectCodeCopyButtons, attachCodeCopyOverlay } = await import(`file://${BUNDLE}`)

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅', name, extra) }
  else { fail++; console.log('❌', name, extra) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function mockClipboard() {
  const calls = []
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { calls.push(t); return Promise.resolve() } },
  })
  return calls
}
const resetBody = () => { dom.window.document.body.innerHTML = '' }
const BTN = '.hk-code-copy-btn'

/* ---------- A. 阅读态注入 ---------- */
resetBody()
const read = dom.window.document.createElement('div')
read.className = 'doc-content'
read.innerHTML = `
  <pre><code class="language-js">const a = 1\nhello('x')\n</code></pre>
  <pre><code class="language-json">{"a":1}\n</code></pre>
  <div class="hk-jsonfold-scroll" data-hk-code-text="{&quot;a&quot;:1}"><span>{"a":1}</span></div>
`
dom.window.document.body.appendChild(read)
injectCodeCopyButtons(read)
ok('A1 阅读态：js pre 注入按钮', !!read.querySelector('pre code.language-js')?.closest('pre')?.querySelector(BTN))
ok('A2 阅读态：jsonfold 折叠树注入按钮', !!read.querySelector('.hk-jsonfold-scroll .hk-code-copy-btn'))
ok('A3 阅读态：按钮总数=3（2 pre + 1 jsonfold）', read.querySelectorAll(BTN).length === 3, `实际=${read.querySelectorAll(BTN).length}`)
injectCodeCopyButtons(read)
ok('A4 阅读态：幂等（二次调用不重复注入）', read.querySelectorAll(BTN).length === 3)

/* ---------- B. IR 双 pre 去重（阅读态入口也保留该排除） ---------- */
resetBody()
const ir = dom.window.document.createElement('div')
ir.innerHTML = `
  <div data-block="0">
    <pre class="vditor-reset" contenteditable="true"><code class="language-js">const a = 1\n</code></pre>
    <div class="vditor-ir__preview" data-render="2"><pre class="vditor-reset"><code class="language-js"><span>const</span> a = 1\n</code></pre></div>
  </div>
`
dom.window.document.body.appendChild(ir)
injectCodeCopyButtons(ir)
ok('B1 IR：源码侧 pre 有按钮', !!ir.querySelector('pre[contenteditable] .hk-code-copy-btn'))
ok('B2 IR：高亮侧 pre 无按钮（防一码两钮）', !ir.querySelector('.vditor-ir__preview .hk-code-copy-btn'))
ok('B3 IR：按钮总数=1', ir.querySelectorAll(BTN).length === 1)

/* ---------- C. 点击复制（Clipboard API + 反馈态） ---------- */
const calls = mockClipboard()
read.querySelector('pre code.language-js').closest('pre').querySelector(BTN).click()
await sleep(50)
ok('C1 点击 → clipboard.writeText 收到代码文本', calls.length === 1 && calls[0].includes('const a = 1') && calls[0].includes("hello('x')"), JSON.stringify(calls))
ok('C2 点击后按钮文案=已复制', read.querySelector('pre code.language-js').closest('pre').querySelector(BTN).textContent === '已复制')
await sleep(2100)
ok('C3 2s 后文案恢复=复制', read.querySelector('pre code.language-js').closest('pre').querySelector(BTN).textContent === '复制')

/* ---------- D. execCommand 降级 ---------- */
Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: undefined })
execCmdCalls = []
read.querySelector('pre code.language-json').closest('pre').querySelector(BTN).click()
await sleep(50)
ok('D1 无 clipboard API → 走 execCommand 降级', execCmdCalls.includes('copy'), JSON.stringify(execCmdCalls))

/* ---------- E. Overlay（IR 编辑态） ---------- */
resetBody()
const scroller = dom.window.document.createElement('div')
scroller.style.position = 'relative'
const vd = dom.window.document.createElement('div')
vd.className = 'vditor'
const irRoot = dom.window.document.createElement('div')
irRoot.className = 'vditor-ir'
irRoot.innerHTML = `
  <div data-block="0">
    <pre class="vditor-reset" contenteditable="true" style="display:none"><code class="language-js">const v1 = 1\n</code></pre>
    <div class="vditor-ir__preview" data-render="2"><pre class="vditor-reset"><code class="language-js">const v1 = 1\n</code></pre></div>
  </div>
`
vd.appendChild(irRoot)
scroller.appendChild(vd)
dom.window.document.body.appendChild(scroller)
const ov = attachCodeCopyOverlay(scroller, irRoot)
ok('E1 overlay 层挂在 scroller 直下', !!scroller.querySelector(':scope > .hk-code-copy-layer'))
ok('E2 overlay 层不在 IR root 内', !irRoot.querySelector('.hk-code-copy-layer'))
ok('E3 overlay 按钮=1（源码/高亮双 pre 只算一个代码块）', scroller.querySelectorAll('.hk-code-copy-float').length === 1, `实际=${scroller.querySelectorAll('.hk-code-copy-float').length}`)
ok('E4 overlay 按钮不在 IR root 内（不污染 lute 序列化）', irRoot.querySelectorAll(`${BTN}, .hk-code-copy-float`).length === 0)

/* ---------- F. 编辑内容变化后 refresh → 复制到新文本 ---------- */
const calls2 = mockClipboard()
const srcPre = irRoot.querySelector('pre[contenteditable]')
srcPre.style.display = ''
srcPre.querySelector('code').textContent = 'const v2 = 2\n'
ov.refresh()
await sleep(50)
scroller.querySelector('.hk-code-copy-float').click()
await sleep(50)
ok('F1 编辑内容变化后 refresh → 点击复制到新文本', calls2.length === 1 && calls2[0].includes('const v2 = 2'), JSON.stringify(calls2))

/* ---------- G. destroy ---------- */
ov.destroy()
ok('G1 destroy 后 overlay 层移除', !scroller.querySelector('.hk-code-copy-layer'))
ok('G2 destroy 后按钮移除', scroller.querySelectorAll('.hk-code-copy-float').length === 0)

console.log('==============================')
console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
