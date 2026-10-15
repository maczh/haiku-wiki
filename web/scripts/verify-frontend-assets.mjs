import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(web, process.argv.includes('--dist') ? 'dist' : 'public')
const checks = [
  'microsoftoffice.svg',
  'drawio/index.html', 'drawio/styles/grapheditor.css',
  ...['bootstrap', 'PreConfig', 'PostConfig', 'main', 'app.min', 'stencils.min', 'extensions.min', 'shapes-14-6-5.min'].map(name => `drawio/js/${name}.js`),
]
let failures = 0
for (const relative of checks) {
  try {
    const file = path.join(base, relative)
    if (!(await stat(file)).size) throw new Error('空文件')
    if (relative.endsWith('.js')) new Script(await readFile(file, 'utf8'), { filename: relative })
  } catch (error) {
    console.error(`[assets] ${relative}: ${error.message}`)
    failures++
  }
}

for (const dir of ['excalidraw/dist/prod/fonts', 'excalidraw/dist/prod/locales', 'excalidraw/dist/prod/data']) {
  const files = await readdir(path.join(base, dir), { recursive: true }).catch(() => [])
  if (!files.length) { console.error(`[assets] 缺少 ${dir}`); failures++ }
}

if (process.argv.includes('--dist')) {
  const files = await readdir(path.join(base, 'assets')).catch(() => [])
  const patterns = [
    /^pdf\.worker.*\.(mjs|js)$/, /^x2t\.worker.*\.js$/, /^md5\.worker.*\.js$/,
    /^KaTeX_.*\.woff2$/, /^TypoMdEditor-.*\.js$/, /^MarkdownView-.*\.js$/,
  ]
  for (const pattern of patterns) {
    if (!files.some(file => pattern.test(file))) { console.error(`[assets] 缺少构建资源 ${pattern}`); failures++ }
  }
}
if (failures) process.exit(1)
console.log(`[assets] ${base}：draw.io JS、Excalidraw 及前端运行资源校验通过`)
