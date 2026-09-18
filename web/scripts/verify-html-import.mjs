/**
 * HTML 导入清洗层的 node 侧验证（第六轮第 4 项）。
 *
 * 浏览器里才能跑 DOM，这里用 jsdom 造一个真实 DOM，再用 esbuild 把
 * src/lib/import/htmlClean.ts 现场转成 ESM 直接 import —— 断言的是**产品代码本身**，
 * 不是复制一份逻辑来测，因此规则改动会被这个脚本立刻发现。
 *
 * 覆盖：
 *   ① CSS 规则解析出 display:none / visibility:hidden 等隐藏选择器；
 *   ② 命中隐藏选择器的元素（含内联 style / hidden 属性）整棵子树被剔除；
 *   ③ <script>（及其文本）不进正文；
 *   ④ 链接保留、懒加载图片补成可用 URL；
 *   ⑤ 脚本不执行时，DOM 里已有的可见文本节点照常保留。
 *
 * 运行：npm run verify:import
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const root = path.resolve(import.meta.dirname, '..')

/** 样例 HTML：真实网页里最常见的四类噪声 */
const SAMPLE = `<!doctype html>
<html>
<head>
  <title>示例文章</title>
  <style>
    /* 注释也要能跳过 */
    .ads { display: none; }
    .popup, .tooltip { visibility: hidden; }
    @media (max-width: 600px) { .mobile-only { display: none; } }
    .keep { color: #333; }
  </style>
</head>
<body>
  <h1>可见标题</h1>
  <div class="ads">隐藏广告文案 SHOULD_NOT_APPEAR</div>
  <div class="popup">弹窗文案 SHOULD_NOT_APPEAR</div>
  <div style="display:none">内联隐藏 SHOULD_NOT_APPEAR</div>
  <div hidden>hidden 属性 SHOULD_NOT_APPEAR</div>
  <div class="mobile-only">移动端隐藏 SHOULD_NOT_APPEAR</div>
  <p>正文段落，包含 <a href="https://example.com/page">一个链接</a>。</p>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://cdn.example.com/real.png" alt="懒加载图" />
  <img src="https://cdn.example.com/direct.jpg" alt="直链图" />
  <div id="app-root">脚本渲染后的可见文本</div>
  <script>
    var tpl = '<p>脚本里的假正文 SHOULD_NOT_APPEAR</p>'
    document.getElementById('app-root').textContent = '由脚本写入的文本'
  </script>
</body>
</html>`

let failed = 0

function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` —— ${extra}` : ''}`)
  }
}

async function main() {
  // ① 把 TS 源码现场打包成 ESM（不写进仓库，落在系统临时目录）
  const dir = await mkdtemp(path.join(tmpdir(), 'hk-html-clean-'))
  const outfile = path.join(dir, 'htmlClean.mjs')
  try {
    await build({
      entryPoints: [path.join(root, 'src/lib/import/htmlClean.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2020',
      logLevel: 'silent',
    })

    const mod = await import(pathToFileURL(outfile).href)
    const { collectStyleText, hiddenSelectors, stripNonContent, pruneInvisible, fixLazyImages } = mod

    // ② 纯函数：CSS → 隐藏选择器
    const dom = new JSDOM(SAMPLE, { runScripts: 'outside-only' })
    const doc = dom.window.document
    const css = collectStyleText(doc)
    const sels = hiddenSelectors(css)

    console.log('CSS 隐藏选择器：', sels)
    check('解析出 .ads（display:none）', sels.includes('.ads'))
    check('解析出 .popup / .tooltip（visibility:hidden，逗号分组拆开）', sels.includes('.popup') && sels.includes('.tooltip'))
    check('@media 内的 .mobile-only 也被解析', sels.includes('.mobile-only'))
    check('普通规则 .keep 不被误判为隐藏', !sels.includes('.keep'))

    // ③ DOM 侧：剥离脚本 → 剔除不可见 → 补懒加载图
    const body = doc.body
    const scriptTextBefore = body.querySelector('script')?.textContent || ''
    check('样例里确实存在脚本文本（前置条件）', scriptTextBefore.includes('SHOULD_NOT_APPEAR'))

    const stripped = stripNonContent(body)
    check('剥离了 script/style 等非正文节点', stripped > 0, `实际 ${stripped}`)

    const pruned = pruneInvisible(body, sels)
    check('剔除了隐藏元素（含内联 style / hidden 属性）', pruned >= 4, `实际 ${pruned}`)

    const fixed = fixLazyImages(body)
    check('懒加载图片补全为可用 URL', fixed >= 1 && body.querySelector('img')?.getAttribute('src') === 'https://cdn.example.com/real.png')

    const html = body.innerHTML
    console.log('清洗后 HTML 长度：', html.length)

    check('脚本文本不再出现在正文里', !html.includes('脚本里的假正文'))
    check('display:none 的隐藏文案被移除', !html.includes('隐藏广告文案'))
    check('visibility:hidden 的隐藏文案被移除', !html.includes('弹窗文案'))
    check('内联 display:none 的隐藏文案被移除', !html.includes('内联隐藏'))
    check('hidden 属性的隐藏文案被移除', !html.includes('hidden 属性 SHOULD_NOT_APPEAR'))
    check('@media 内的隐藏文案被移除', !html.includes('移动端隐藏'))
    check('可见标题保留', html.includes('可见标题'))
    check('正文段落保留', html.includes('正文段落'))
    check('链接保留（href 与文字都在）', html.includes('https://example.com/page') && html.includes('一个链接'))
    check('直链图片保留', html.includes('https://cdn.example.com/direct.jpg'))
    check(
      '脚本未执行时，DOM 已有的可见文本节点照常保留（不误删）',
      html.includes('脚本渲染后的可见文本'),
      '静态 DOM 下脚本产物无法生成，此时按现有文本处理',
    )
    check('整体无 SHOULD_NOT_APPEAR 残留', !html.includes('SHOULD_NOT_APPEAR'), html.slice(0, 400))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  if (failed > 0) {
    console.error(`\nHTML 导入清洗验证失败：${failed} 项`)
    process.exit(1)
  }
  console.log('\nHTML 导入清洗验证全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
