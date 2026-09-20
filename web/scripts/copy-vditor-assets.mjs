/**
 * 把 Vditor 运行期真正需要的静态资源从 node_modules 复制到 public/vditor/dist。
 *
 * 背景：Vditor 默认从 `https://unpkg.com/vditor@<ver>` 拉取 lute 解析器、highlight.js、
 * KaTeX 等资源。在离线/内网/CDN 被拦截的环境下，`Vditor.preview` 的 `after` 回调
 * 永远不会触发，阅读页正文会渲染为空白（且控制台无报错，极难排查）。
 *
 * 因此本项目改为自托管：组件里统一设置 `cdn: '/vditor'`，由本脚本在
 * `predev` / `prebuild` 阶段把资源就位，既避免外部依赖，又保证版本与依赖库一致。
 *
 * 只复制本项目实际启用的能力所需子集，未启用的重型渲染器
 * （mathjax / echarts / markmap / graphviz / plantuml / wavedrom ...）一律不复制，
 * 避免产物与镜像体积无谓膨胀。
 *
 * Mermaid 是例外（P0-6）：Vditor 内部对 `.language-mermaid` 无条件请求
 * `{cdn}/dist/js/mermaid/mermaid.min.js`，缺它就是「代码块原样显示且无报错」的静默失效，
 * 所以必须复制。但 Vditor 内置那份是 11.16.1，与本项目依赖 `mermaid@^11.17.2` 版本不同，
 * 而独立 `flowchart` doc_type（`web/src/lib/flowchart.ts`）用的是项目依赖那份 ——
 * 若不做归一，「八种图类型是否被支持」就要按两个版本各验一遍。故追加了
 * **版本归一**步骤：用 `node_modules/mermaid/dist/mermaid.min.js` 覆盖拷贝产物。
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', 'vditor', 'dist')
const dest = path.join(root, 'public', 'vditor', 'dist')

/** 需要自托管的资源（相对 vditor/dist） */
const INCLUDE = [
  'index.css', // 预览模式会按 cdn 前缀请求它
  'css', // content-theme/*.css
  'images', // 占位图 / emoji / logo
  'js/lute', // Markdown 解析与渲染（必需，缺失即白屏）
  'js/highlight.js', // 代码高亮（hljs.style）
  'js/katex', // 公式（math.engine = KaTeX）
  'js/icons', // 工具栏图标
  'js/i18n', // 语言包（zh_CN）
  'js/mermaid', // 图表渲染（缺失 → 代码块静默失效；实际内容由下方「版本归一」写入）
]

/**
 * Mermaid 的「规范来源」：项目依赖的 mermaid（`^11.17.2`），而非 Vditor 内置的 11.16.1。
 * 两者同为 esbuild 打包的 UMD 产物、结尾均为 `globalThis["mermaid"] = ...`（同 major 11.x，
 * `?v=11.16.1` 只是缓存串），因此可安全互换。
 */
const MERMAID_REL = path.join('js', 'mermaid', 'mermaid.min.js')
const MERMAID_SRC = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')

try {
  await stat(src)
} catch {
  console.error(`[vditor-assets] 未找到 ${src}，请先执行 npm install`)
  process.exit(1)
}

// 逐文件同步：目标已存在且大小一致时跳过（幂等；同时避免重复覆盖既有产物）
let copied = 0
let skipped = 0

/**
 * Mermaid 版本归一：以 `node_modules/mermaid/dist/mermaid.min.js` 为规范来源，
 * 覆盖 `public/vditor/dist/js/mermaid/mermaid.min.js`。
 *
 * 关键点（务必保留）：
 *  - 幂等判据是「目标体积 == **规范来源** 的体积」，**不是** Vditor 内置那份的体积。
 *    否则会因为「Vditor 内置 11.16.1 与项目 11.17.2 体积不同」而每次都被体积判断放行、
 *    反复写入；反之若两者体积恰好相同，覆盖步骤又会被「体积相同就跳过」错挡掉。
 *  - 因此这里完全绕开通用 sync 的体积跳过逻辑，自己判断、并打印可读的覆盖日志。
 */
async function normalizeMermaid() {
  let srcStat
  try {
    srcStat = await stat(MERMAID_SRC)
  } catch {
    console.warn(`[vditor-assets] 未找到 ${MERMAID_SRC}（项目依赖 mermaid 缺失），跳过版本归一`)
    return
  }
  const target = path.join(dest, MERMAID_REL)
  const cur = await stat(target).catch(() => null)
  if (cur?.isFile() && cur.size === srcStat.size) {
    skipped += 1
    console.log(`[vditor-assets] Mermaid 版本归一：已生效（${srcStat.size} B），跳过`)
    return
  }
  await mkdir(path.dirname(target), { recursive: true })
  const before = cur?.isFile() ? `${cur.size} B` : '（首次写入）'
  await copyFile(MERMAID_SRC, target)
  copied += 1
  console.log(
    `[vditor-assets] Mermaid 版本归一：node_modules/mermaid（11.17.2，${srcStat.size} B）` +
      ` 覆盖 public/vditor/dist/js/mermaid/mermaid.min.js（覆盖前 ${before}）`,
  )
}

async function sync(from, to, rel) {
  // Mermaid 是唯一需要「换源」的资源：不走 Vditor 内置那份，改由 normalizeMermaid 写入，
  // 这样既保留 INCLUDE 语义（目录会被创建），也不再重复拷贝一份必然被覆盖的 3.4MB 文件。
  if (rel === MERMAID_REL) {
    await normalizeMermaid()
    return
  }
  const st = await stat(from)
  if (st.isDirectory()) {
    await mkdir(to, { recursive: true })
    for (const name of await readdir(from)) {
      await sync(path.join(from, name), path.join(to, name), path.join(rel, name))
    }
    return
  }
  const cur = await stat(to).catch(() => null)
  if (cur?.isFile() && cur.size === st.size) {
    skipped += 1
    return
  }
  await mkdir(path.dirname(to), { recursive: true })
  await copyFile(from, to)
  copied += 1
}

for (const rel of INCLUDE) {
  const from = path.join(src, rel)
  try {
    await stat(from)
  } catch {
    console.warn(`[vditor-assets] 跳过（不存在）：${rel}`)
    continue
  }
  await sync(from, path.join(dest, rel), rel)
}

console.log(`[vditor-assets] Vditor 静态资源就绪 → public/vditor/dist（写入 ${copied}，未变 ${skipped}）`)
