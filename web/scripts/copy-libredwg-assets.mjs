import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageEntry = fileURLToPath(import.meta.resolve('@mlightcad/libredwg-web'))
const packageRoot = dirname(dirname(packageEntry))
const targetRoot = fileURLToPath(new URL('../public/vendor/libredwg-web/', import.meta.url))

await mkdir(targetRoot, { recursive: true })
await cp(join(packageRoot, 'wasm'), join(targetRoot, 'wasm'), { recursive: true, force: true })
await cp(join(packageRoot, 'dist', 'libredwg-web.js'), join(targetRoot, 'dist', 'libredwg-web.js'), { force: true })
console.log(`[libredwg-assets] 就绪 → ${targetRoot}`)
