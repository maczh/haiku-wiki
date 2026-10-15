import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules/katex/dist/fonts')
// Crepe's inlined KaTeX CSS uses relative fonts/ URLs. Supply these at build
// input time so Vite can resolve and hash them instead of leaving broken URLs.
const destination = path.join(root, 'src/vendor/typo-md-editor/fonts')
if (!(await stat(source).catch(() => null))?.isDirectory()) throw new Error('KaTeX 字体缺失，请先 npm install')
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
console.log('[katex-assets] Crepe 公式字体已就绪')
