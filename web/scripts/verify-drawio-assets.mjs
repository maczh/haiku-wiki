/**
 * draw.io 自托管静态资源的构建产物校验（第六轮第 2 项）。
 *
 * 背景：draw.io 的 index.html 只是壳，应用由 js/bootstrap.js → js/PreConfig.js →
 * js/app.min.js 动态注入。任何一个子资源缺失，静态服务都会把请求兜底成应用的
 * index.html（HTML），浏览器当 JS 执行就抛
 * `Uncaught SyntaxError: Unexpected token '<'` —— 报错完全指不到真实文件。
 *
 * 本脚本在构建产物里逐个核对「关键资源存在、非空、且首字节不是 HTML」，
 * 用于在 CI / 发布前把这类问题拦住（运行：npm run verify:drawio）。
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

/** 必须与 src/lib/drawio.ts 的 DRAWIO_JS_ASSETS 保持一致 */
const REQUIRED_JS = ['js/bootstrap.js', 'js/PreConfig.js', 'js/app.min.js', 'js/PostConfig.js', 'js/main.js']

/** 全部必需文件（HTML/CSS 走存在性与非空校验，JS 额外校验「不是 HTML」） */
const REQUIRED = ['index.html', 'styles/grapheditor.css', ...REQUIRED_JS]

/** 入口页必须出现的指纹（与运行时探测同一套判据） */
const FINGERPRINT = /drawio|mxgraph|geInfo|bootstrap\.js/i

let failed = 0

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function bad(msg) {
  failed++
  console.log(`  ✗ ${msg}`)
}

async function checkDir(label, base) {
  console.log(`\n[${label}] ${base}`)
  for (const rel of REQUIRED) {
    const file = path.join(base, rel)
    try {
      const st = await stat(file)
      if (!st.isFile()) {
        bad(`${rel} 不是文件`)
        continue
      }
      if (st.size === 0) {
        bad(`${rel} 是空文件`)
        continue
      }
      const head = (await readFile(file, 'utf8')).slice(0, 512)
      // 只有 JS 才做这项判定：index.html 本来就是 HTML
      if (REQUIRED_JS.includes(rel) && /^\s*<(!doctype|html|head|body)/i.test(head)) {
        bad(`${rel} 内容以 HTML 开头（疑似被 SPA 兜底页接管，运行时会抛 Unexpected token '<'）`)
        continue
      }
      ok(`${rel}（${(st.size / 1024).toFixed(0)} KB）`)
    } catch {
      bad(`${rel} 缺失`)
    }
  }

  // 入口页指纹
  try {
    const html = await readFile(path.join(base, 'index.html'), 'utf8')
    if (FINGERPRINT.test(html.slice(0, 4096))) ok('index.html 指纹校验通过（确为 draw.io 页面）')
    else bad('index.html 不含 draw.io 指纹（可能是应用自身的兜底页）')
  } catch {
    bad('index.html 无法读取')
  }
}

async function main() {
  // 构建产物优先；public 作为开发态兜底一起检查
  const targets = [
    { label: '构建产物', base: path.join(root, 'dist', 'drawio') },
    { label: '开发态资源', base: path.join(root, 'public', 'drawio') },
  ]
  let any = false
  for (const t of targets) {
    const st = await stat(t.base).catch(() => null)
    if (!st) {
      console.log(`\n[${t.label}] ${t.base} —— 不存在，跳过`)
      continue
    }
    any = true
    await checkDir(t.label, t.base)
  }
  if (!any) {
    console.log('\n未找到任何 drawio 资源目录：执行 `npm run fetch:drawio` 拉取后再构建。')
  }

  if (failed > 0) {
    console.error(`\ndraw.io 资源校验失败：${failed} 项`)
    process.exit(1)
  }
  console.log('\ndraw.io 资源校验通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
