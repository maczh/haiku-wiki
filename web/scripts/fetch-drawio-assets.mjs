/**
 * 拉取 draw.io 官方发行版的静态资源子集到 web/vendor/drawio。
 *
 * 背景：需求要求「内嵌 draw.io 完整绘图组件」。draw.io 的 webapp 源码包（src/main/webapp）
 * 合计约 150MB，其中绝大部分是开发态源码、Java 服务端（WEB-INF）、多语言资源与模板，
 * 运行期并不需要。本脚本按下面的白名单只取运行期真正被加载的那部分（约 37MB）。
 *
 * 白名单依据（对 v31.4.6 的 js/app.min.js 与 index.html 逐项核对）：
 *   · index.html 只引 styles/grapheditor.css、js/bootstrap.js、js/main.js；
 *   · 自托管（非 *.diagrams.net 域）走 bootstrap.js 的 `!supportedDomain` 分支：
 *       js/PreConfig.js → js/app.min.js → js/PostConfig.js；
 *   · 生产态（urlParams.dev != '1'）由 app.min.js 追加加载：
 *       js/shapes-14-6-5.min.js、js/stencils.min.js、js/extensions.min.js；
 *   · js/stencils.min.js 把 204 个 stencil XML 以 raw-deflate+base64 内联，
 *     并劫持 mxStencilRegistry.loadStencil 直接从内存返回 →
 *     **无需再下载 41MB 的 stencils/ 目录**（该目录仅在缺 shape 时走 HTTP 兜底）；
 *   · 运行期 HTTP 取件的其余根路径：styles/（CSS）、images/（IMAGE_PATH）、
 *     img/（GRAPH_IMAGE_PATH，图片素材与 clipart）、shapes/（按需加载的 JS 形状库）、
 *     plugins/（插件）、mxgraph/css 与 mxgraph/images（mxClient 样式与图标）、
 *     resources/dia[_xx].txt（界面语言包）、stencils/clipart（少量 PNG）。
 *
 * 未纳入（并在 README 中说明影响）：math4（MathJax，仅数学排版用到）、
 * templates（模板对话框）、WEB-INF/META-INF（Java 服务端）、js/diagramly 与
 * js/grapheditor（已被 app.min.js 打包的源码）、js/integrate.min.js 与
 * js/viewer*.min.js（独立嵌入/只读查看器，本项目的 iframe 嵌入模式用不到）。
 *
 * 用法：
 *   node scripts/fetch-drawio-assets.mjs            # 幂等增量同步
 *   node scripts/fetch-drawio-assets.mjs --force    # 忽略已存在文件，全量重下
 *
 * 可调环境变量（内网/受限网络下改这两个即可）：
 *   DRAWIO_REF          版本锚点，默认 v31.4.6（= dev HEAD 744cb5420fdf…）
 *   DRAWIO_GH_API       GitHub API 基址，默认 https://api.github.com
 *                       被墙时可用 https://gh-proxy.com/api.github.com
 *   DRAWIO_CDN          文件下载基址，默认 https://cdn.jsdelivr.net/gh/jgraph/drawio@<REF>
 *   DRAWIO_CONCURRENCY  并发下载数，默认 8
 */
import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'vendor', 'drawio')

const REF = process.env.DRAWIO_REF || 'v31.4.6'
const GH_API = (process.env.DRAWIO_GH_API || 'https://api.github.com').replace(/\/$/, '')
const CDN = (process.env.DRAWIO_CDN || `https://cdn.jsdelivr.net/gh/jgraph/drawio@${REF}`).replace(/\/$/, '')
const CONCURRENCY = Math.max(1, Number(process.env.DRAWIO_CONCURRENCY || 8))
const FORCE = process.argv.includes('--force')

const WEBAPP = 'src/main/webapp'

/** 精确包含的文件（webapp 根） */
const EXACT = ['index.html', 'favicon.ico', 'export-fonts.css']

/** 按前缀包含的目录 */
const PREFIX = [
  'styles/',
  'images/',
  'img/',
  'shapes/',
  'plugins/',
  'stencils/clipart/',
  'mxgraph/css/',
  'mxgraph/images/',
]

/** 精确包含的脚本（生产态加载链，缺一不可） */
const SCRIPTS = [
  'js/bootstrap.js',
  'js/main.js',
  'js/PreConfig.js',
  'js/PostConfig.js',
  'js/app.min.js', // 主应用
  'js/stencils.min.js', // 内联 204 个 stencil（替代 stencils/ 目录）
  'js/extensions.min.js', // ELK / Mermaid / PlantUML 等扩展
  'js/shapes-14-6-5.min.js', // 打包后的 JS 形状库
]

/** 界面语言包：默认英文 + 简繁中文（其余语言按需增补） */
const LOCALES = ['resources/dia.txt', 'resources/dia_zh.txt', 'resources/dia_zh-tw.txt']

function wanted(p) {
  if (EXACT.includes(p)) return true
  if (SCRIPTS.includes(p)) return true
  if (LOCALES.includes(p)) return true
  return PREFIX.some((pre) => p.startsWith(pre))
}

async function fetchWithRetry(url, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(url)
      if (resp.ok) return resp
      lastErr = new Error(`HTTP ${resp.status}`)
      // 4xx（除 429）重试无意义
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) break
    } catch (e) {
      lastErr = e
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)))
  }
  throw lastErr
}

async function listTree() {
  const url = `${GH_API}/repos/jgraph/drawio/git/trees/${REF}?recursive=1`
  const resp = await fetchWithRetry(url)
  const json = await resp.json()
  if (!json.tree) throw new Error(`无法读取仓库文件树：${JSON.stringify(json).slice(0, 200)}`)
  return json.tree
}

/** 并发池：按给定并发数跑一组任务，逐个上报结果 */
async function pool(items, worker, size) {
  let cursor = 0
  const results = []
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  console.log(`[drawio-assets] 版本锚点 ${REF}`)
  const tree = await listTree()
  const files = tree
    .filter((e) => e.type === 'blob' && e.path.startsWith(`${WEBAPP}/`))
    .map((e) => ({ rel: e.path.slice(WEBAPP.length + 1), size: e.size || 0 }))
    .filter((f) => wanted(f.rel))

  const totalBytes = files.reduce((a, f) => a + f.size, 0)
  console.log(
    `[drawio-assets] 选中 ${files.length} 个文件 / ${(totalBytes / 1048576).toFixed(2)} MB（源码包全量为 150MB 量级）`,
  )

  // 先探明哪些需要下载，便于统计进度
  const todo = []
  for (const f of files) {
    const target = path.join(dest, f.rel)
    if (!FORCE) {
      const cur = await stat(target).catch(() => null)
      if (cur?.isFile() && cur.size === f.size) continue
    }
    todo.push(f)
  }
  if (todo.length === 0) {
    console.log('[drawio-assets] 已是最新，无需下载')
    return
  }
  console.log(`[drawio-assets] 待下载 ${todo.length} 个文件`)

  let done = 0
  let bytes = 0
  const failed = []
  await pool(
    todo,
    async (f) => {
      const url = `${CDN}/${WEBAPP}/${f.rel}`
      try {
        const resp = await fetchWithRetry(url)
        const buf = Buffer.from(await resp.arrayBuffer())
        if (f.size && buf.length !== f.size) {
          throw new Error(`体积不符（期望 ${f.size}，实得 ${buf.length}）`)
        }
        const target = path.join(dest, f.rel)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, buf)
        bytes += buf.length
      } catch (e) {
        failed.push(`${f.rel}: ${e?.message || e}`)
      } finally {
        done += 1
        if (done % 50 === 0 || done === todo.length) {
          console.log(`[drawio-assets]   ${done}/${todo.length}  ${(bytes / 1048576).toFixed(1)} MB`)
        }
      }
    },
    CONCURRENCY,
  )

  // 记录清单，供复制脚本与排障使用
  await mkdir(dest, { recursive: true })
  await writeFile(
    path.join(dest, '.manifest.json'),
    `${JSON.stringify({ ref: REF, source: CDN, files: files.map((f) => f.rel) }, null, 2)}\n`,
  )

  if (failed.length > 0) {
    console.error(`[drawio-assets] ${failed.length} 个文件失败：`)
    for (const m of failed.slice(0, 20)) console.error(`  · ${m}`)
    process.exit(1)
  }
  console.log(`[drawio-assets] 完成：${dest}`)
}

main().catch((e) => {
  console.error(`[drawio-assets] 失败：${e?.message || e}`)
  console.error(
    '[drawio-assets] 若网络受限，可设置 DRAWIO_GH_API=https://gh-proxy.com/api.github.com 后重试',
  )
  process.exit(1)
})
