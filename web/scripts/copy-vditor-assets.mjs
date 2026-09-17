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
 * （mathjax / mermaid / echarts / markmap / graphviz / plantuml / wavedrom ...）
 * 一律不复制，避免产物与镜像体积无谓膨胀。
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
]

try {
  await stat(src)
} catch {
  console.error(`[vditor-assets] 未找到 ${src}，请先执行 npm install`)
  process.exit(1)
}

// 逐文件同步：目标已存在且大小一致时跳过（幂等；同时避免重复覆盖既有产物）
let copied = 0
let skipped = 0

async function sync(from, to) {
  const st = await stat(from)
  if (st.isDirectory()) {
    await mkdir(to, { recursive: true })
    for (const name of await readdir(from)) {
      await sync(path.join(from, name), path.join(to, name))
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
  await sync(from, path.join(dest, rel))
}

console.log(`[vditor-assets] Vditor 静态资源就绪 → public/vditor/dist（写入 ${copied}，未变 ${skipped}）`)
