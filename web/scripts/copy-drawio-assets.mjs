/**
 * 把 vendor/drawio 下的 draw.io 静态资源同步到 public/drawio，供 Vite 随构建产物一起发布
 * （最终被 Go 的 embed 打进二进制，实现完全自托管、不依赖任何外部 CDN）。
 *
 * 与 copy-vditor-assets.mjs 同构：逐文件比对体积，未变则跳过（幂等，便于反复构建）。
 *
 * vendor/drawio 不存在时：
 *   · 若未设置 DRAWIO_SKIP_FETCH，自动调用 fetch-drawio-assets.mjs 拉取；
 *   · 拉取失败或设置了 DRAWIO_SKIP_FETCH=1 时 **只告警不中断构建**——
 *     应用其余功能不受影响，绘图文档在界面上会提示「绘图组件未部署」并给出指引。
 *   这样保证「无网环境也能把项目构建起来」。
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const src = path.join(root, 'vendor', 'drawio')
const dest = path.join(root, 'public', 'drawio')
const entry = path.join(src, 'index.html')

async function exists(p) {
  return (await stat(p).catch(() => null)) != null
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
  if (!(await exists(entry))) {
    if (process.env.DRAWIO_SKIP_FETCH === '1') {
      console.warn('[drawio-assets] 跳过：未设置拉取且 vendor/drawio 不存在')
      return
    }
    console.log('[drawio-assets] vendor/drawio 不存在，尝试自动拉取…')
    const ok = await runNode('fetch-drawio-assets.mjs')
    if (!ok || !(await exists(entry))) {
      console.warn(
        '[drawio-assets] 拉取失败，跳过绘图组件部署。\n' +
          '               应用其余功能不受影响；绘图文档会提示「绘图组件未部署」。\n' +
          '               可在有网环境执行 `npm run fetch:drawio` 后重新构建，\n' +
          '               或预先准备好 web/vendor/drawio 再构建。',
      )
      return
    }
  }

  const counters = { copied: 0, skipped: 0 }
  const t0 = Date.now()
  await syncDir(src, dest, counters)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `[drawio-assets] 就绪 → public/drawio（写入 ${counters.copied}，未变 ${counters.skipped}，${secs}s）`,
  )
}

main().catch((e) => {
  console.warn(`[drawio-assets] 同步异常（不中断构建）：${e?.message || e}`)
})
