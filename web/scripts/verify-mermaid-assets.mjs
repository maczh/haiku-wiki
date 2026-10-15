/**
 * Mermaid 运行时链路校验（P0-6 / 架构文档 R1）。
 *
 * 背景（v1-typo 之前）：Vditor 内部对 `.language-mermaid` 无条件请求
 *   `{cdn}/dist/js/mermaid/mermaid.min.js`（cdn = `/vditor`）。若该文件缺失或版本不对，
 *   结果是「Markdown 里的 mermaid 代码块原样显示、控制台无任何报错」—— 静默失效，极难排查。
 *   彼时本脚本断言 `public/vditor/.../mermaid.min.js` 与 `node_modules/mermaid` 字节一致。
 *
 * 现状（v1-typo 起）：Markdown 阅读/导出统一走 typo-md-editor 的 `toHtml`（仅产出
 *   `<pre><code class="language-mermaid">` 围栏块），真正的 SVG 由全站统一 mermaid 运行时
 *   （`src/lib/flowchart.ts` 通过 `import mermaid from 'mermaid'` 引入，由 Vite 随构建打包）
 *   在 MarkdownView / FlowchartView 的 `renderMermaidBlocks` 里 `await mermaid.render` 注入。
 *   因此 mermaid **不再依赖任何 `/vditor` 静态资源**，而是作为 npm 依赖被打进 JS chunk。
 *
 * 本脚本改判三件事（任一不满足即以非零码退出）：
 *   1. `node_modules/mermaid` 依赖存在且 mermaid.min.js 非空（版本归一生效的实证）；
 *   2. 基准文件尾部仍暴露 `globalThis["mermaid"]`（UMD 形态，供任何裸调用兜底）；
 *   3. `src/lib/flowchart.ts` 确实以 `import mermaid from 'mermaid'` 接入统一运行时
 *      （即「mermaid 已被全站唯一入口接管」，回归时若有人又塞回 Vditor 式 CDN 会立刻暴露）。
 *
 * 运行：npm run verify:mermaid-assets
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')
const FLOWCHART = path.join(root, 'src', 'lib', 'flowchart.ts')

let failed = 0

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function bad(msg) {
  failed += 1
  console.log(`  ✗ ${msg}`)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function main() {
  // 1) 规范来源（项目依赖 mermaid，由 Vite 打包进 chunk）
  let srcBuf
  try {
    srcBuf = await readFile(SOURCE)
  } catch {
    console.error(`基准文件缺失：${SOURCE}\n请先执行 npm install（需要 mermaid 依赖）。`)
    process.exit(1)
  }
  const srcHash = sha256(srcBuf)
  console.log(`[基准] node_modules/mermaid/dist/mermaid.min.js —— ${srcBuf.length} B · sha256 ${srcHash.slice(0, 16)}…`)
  if (srcBuf.length === 0) bad('基准文件为空')
  else ok('基准 mermaid 文件非空')

  // 2) 期望暴露全局 mermaid（UMD 形态，defensive）
  const tail = srcBuf.toString('utf8', Math.max(0, srcBuf.length - 400))
  if (!tail.includes('globalThis["mermaid"]')) {
    bad('基准文件尾部未发现 `globalThis["mermaid"]`，UMD 形态不符')
  } else {
    ok('基准 mermaid 已暴露全局（UMD 形态）')
  }

  // 3) 全站统一入口：flowchart.ts 必须 import mermaid（而非再走 /vditor CDN）
  let fc
  try {
    fc = await readFile(FLOWCHART, 'utf8')
  } catch {
    console.error(`未找到 ${FLOWCHART}（mermaid 统一运行时入口）。`)
    process.exit(1)
  }
  if (/import\s+mermaid\s+from\s+['"]mermaid['"]/.test(fc)) {
    ok('src/lib/flowchart.ts 已 import mermaid（统一运行时由 Vite 打包，不再依赖 /vditor 静态资源）')
  } else {
    bad('src/lib/flowchart.ts 未以 `import mermaid from "mermaid"` 接入统一运行时')
  }
  if (/vditor/i.test(fc)) {
    bad('src/lib/flowchart.ts 仍残留 vditor 引用（mermaid 应已脱离 /vditor）')
  } else {
    ok('src/lib/flowchart.ts 无 vditor 残留')
  }

  if (failed > 0) {
    console.error(`\nMermaid 资源校验失败：${failed} 项`)
    process.exit(1)
  }
  console.log('\nMermaid 运行时链路校验通过（统一由 Vite 打包 mermaid 依赖）')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
