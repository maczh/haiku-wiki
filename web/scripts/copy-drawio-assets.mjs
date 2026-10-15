/**
 * 把 vendor/drawio 下的 draw.io 静态资源同步到 public/drawio，供 Vite 随构建产物一起发布
 * （最终被 Go 的 embed 打进二进制，实现完全自托管、不依赖任何外部 CDN）。
 *
 * 与 copy-vditor-assets.mjs 同构：逐文件比对体积，未变则跳过（幂等，便于反复构建）。
 *
 * vendor/drawio 不存在时：
 *   · 若未设置 DRAWIO_SKIP_FETCH，自动调用 fetch-drawio-assets.mjs 拉取；
 *   · 拉取失败或资源不完整时中止构建，避免发布后才发现绘图不可用。
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const src = path.join(root, 'vendor', 'drawio')
const dest = path.join(root, 'public', 'drawio')
const critical = ['index.html', 'styles/grapheditor.css', 'js/bootstrap.js', 'js/PreConfig.js', 'js/PostConfig.js', 'js/main.js', 'js/app.min.js', 'js/stencils.min.js', 'js/extensions.min.js', 'js/shapes-14-6-5.min.js']
async function complete(base) {
  for (const file of critical) {
    const info = await stat(path.join(base, file)).catch(() => null)
    if (!info?.isFile() || !info.size) return false
  }
  return true
}

/** 运行同目录下的另一个脚本，实时转发 stdout/stderr；返回是否成功 */
function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, script)], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

async function syncDir(from, to, counters) {
  const st = await stat(from)
  if (st.isDirectory()) {
    await mkdir(to, { recursive: true })
    for (const name of await readdir(from)) {
      await syncDir(path.join(from, name), path.join(to, name), counters)
    }
    return
  }
  const cur = await stat(to).catch(() => null)
  if (cur?.isFile() && cur.size === st.size) {
    counters.skipped += 1
    return
  }
  await mkdir(path.dirname(to), { recursive: true })
  await copyFile(from, to)
  counters.copied += 1
}

async function main() {
  if (!(await complete(src))) {
    if (process.env.DRAWIO_SKIP_FETCH === '1') {
      throw new Error('DRAWIO_SKIP_FETCH=1，但 vendor/drawio 缺少必需资源，无法发布完整绘图组件')
    }
    console.log('[drawio-assets] vendor/drawio 不存在，尝试自动拉取…')
    const ok = await runNode('fetch-drawio-assets.mjs')
    if (!ok || !(await complete(src))) {
      throw new Error(
        '[drawio-assets] 拉取失败或绘图组件资源不完整。\n' +
          '               可在有网环境执行 `npm run fetch:drawio` 后重新构建，\n' +
          '               或预先准备好 web/vendor/drawio 再构建。',
      )
    }
  }

  const counters = { copied: 0, skipped: 0 }
  const t0 = Date.now()
  await syncDir(src, dest, counters)
  if (!(await complete(dest))) throw new Error('public/drawio 同步后校验失败')
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `[drawio-assets] 就绪 → public/drawio（写入 ${counters.copied}，未变 ${counters.skipped}，${secs}s）`,
  )
}

main().catch((e) => {
  console.error(`[drawio-assets] 同步失败：${e?.message || e}`)
  process.exit(1)
})
