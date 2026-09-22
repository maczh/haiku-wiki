/**
 * 把 Excalidraw 运行期需要的静态资源从 node_modules 复制到 public/excalidraw/dist/prod。
 *
 * 背景：@excalidraw/excalidraw 0.18 的 JS 本体会被 Vite 打包，但**字体**（Excalifont /
 * Virgil / Xiaolai 中文手写体等）与**语言包**（locales/*.js）不在包内静态引用路径上，
 * 而是「运行期按 EXCALIDRAW_ASSET_PATH 拼 URL」加载；该变量未设置时兜底指向
 * esm.sh CDN —— 离线/内网环境下字体全挂、界面退回英文。
 *
 * 因此本项目改为自托管：WhiteboardEditor / whiteboardExport 统一设置
 * `window.EXCALIDRAW_ASSET_PATH = '/excalidraw/dist/prod/'`，由本脚本在
 * `predev` / `prebuild` 阶段把资源就位（与 copy-vditor-assets / copy-drawio-assets 同一套约定）。
 *
 * 注意：字体文件名带内容哈希（如 Excalifont-Regular-349fac….woff2），哈希清单烘焙在
 * JS 本体里 —— 升级 @excalidraw/excalidraw 后必须重跑本脚本，否则新清单找不到旧文件。
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod')
const dest = path.join(root, 'public', 'excalidraw', 'dist', 'prod')

/** 需要自托管的资源（相对 @excalidraw/excalidraw/dist/prod） */
const INCLUDE = [
  'fonts', // 手绘/正文/代码字体（运行期 FontFace 注入，缺失 → 文本用系统字体兜底）
  'locales', // 语言包（zh-CN 等，运行期动态 import，缺失 → 强制英文）
  'data', // 图片元数据编解码等运行期数据
]

try {
  await stat(src)
} catch {
  console.error(`[excalidraw-assets] 未找到 ${src}，请先执行 npm install`)
  process.exit(1)
}

// 逐文件同步：目标已存在且大小一致时跳过（幂等；避免重复覆盖既有产物）
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
    console.warn(`[excalidraw-assets] 跳过（不存在）：${rel}`)
    continue
  }
  await sync(from, path.join(dest, rel))
}

console.log(`[excalidraw-assets] Excalidraw 静态资源就绪 → public/excalidraw/dist/prod（写入 ${copied}，未变 ${skipped}）`)
