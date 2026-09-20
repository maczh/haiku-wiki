/**
 * Mermaid 静态资源链路校验（P0-6 / 架构文档 R1）。
 *
 * 背景：Vditor 内部对 `.language-mermaid` 无条件请求
 * `{cdn}/dist/js/mermaid/mermaid.min.js`（cdn = `/vditor`）。若该文件缺失或版本不对，
 * 结果是「Markdown 里的 mermaid 代码块原样显示、控制台无任何报错」—— 静默失效，极难排查。
 *
 * 本脚本断言三件事（任一不满足即以非零码退出）：
 *   1. 文件存在且非空；
 *   2. 体积与 `node_modules/mermaid/dist/mermaid.min.js` **完全一致**（版本归一生效的实证）；
 *   3. 内容 sha256 与源文件一致，且尾部仍暴露 `globalThis["mermaid"]`（Vditor 依赖的全局）。
 *
 * 运行：npm run verify:mermaid-assets
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')

/** 检查目标：开发态资源必检；构建产物存在时一并检查（dist 由 vite 从 public 复制而来） */
const TARGETS = [
  {
    label: '开发态资源',
    file: path.join(root, 'public', 'vditor', 'dist', 'js', 'mermaid', 'mermaid.min.js'),
    required: true,
  },
  {
    label: '构建产物',
    file: path.join(root, 'dist', 'vditor', 'dist', 'js', 'mermaid', 'mermaid.min.js'),
    required: false,
  },
]

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
  // 1) 规范来源（项目依赖 mermaid）
  let srcBuf
  try {
    srcBuf = await readFile(SOURCE)
  } catch {
    console.error(`基准文件缺失：${SOURCE}\n请先执行 npm install（需要 mermaid 依赖）。`)
    process.exit(1)
  }
  const srcHash = sha256(srcBuf)
  console.log(`[基准] node_modules/mermaid/dist/mermaid.min.js —— ${srcBuf.length} B · sha256 ${srcHash.slice(0, 16)}…`)

  // 2) 期望暴露全局 mermaid（Vditor 以裸标识符 `mermaid.render/initialize` 调用它）
  if (!srcBuf.toString('utf8', Math.max(0, srcBuf.length - 400)).includes('globalThis["mermaid"]')) {
    console.error('基准文件尾部未发现 `globalThis["mermaid"]`，与 Vditor 期望的 UMD 形态不符。')
    process.exit(1)
  }

  for (const t of TARGETS) {
    const rel = path.relative(root, t.file)
    console.log(`\n[${t.label}] ${rel}`)
    let st
    try {
      st = await stat(t.file)
    } catch {
      if (t.required) bad('文件缺失（运行 npm run build 前会由 prebuild 自动生成；开发态可直接执行 node scripts/copy-vditor-assets.mjs）')
      else console.log('  · 不存在（尚未构建，跳过）')
      continue
    }
    if (!st.isFile() || st.size === 0) {
      bad('不是有效文件或为空')
      continue
    }
    if (st.size !== srcBuf.length) {
      bad(`体积不一致：目标 ${st.size} B ≠ 基准 ${srcBuf.length} B（版本归一未生效）`)
      continue
    }
    const buf = await readFile(t.file)
    const hash = sha256(buf)
    if (hash !== srcHash) {
      bad(`sha256 不一致：${hash.slice(0, 16)}… ≠ ${srcHash.slice(0, 16)}…（体积相同但内容不同）`)
      continue
    }
    const tail = buf.toString('utf8', Math.max(0, buf.length - 400))
    if (!tail.includes('globalThis["mermaid"]')) {
      bad('尾部未暴露 `globalThis["mermaid"]`（Vditor 会拿到 undefined）')
      continue
    }
    ok(`存在、体积一致（${st.size} B）、sha256 一致、已暴露全局 mermaid`)
  }

  if (failed > 0) {
    console.error(`\nMermaid 资源校验失败：${failed} 项\n提示：先运行 node scripts/copy-vditor-assets.mjs 重新就位资源。`)
    process.exit(1)
  }
  console.log('\nMermaid 资源校验通过（版本归一已生效）')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
