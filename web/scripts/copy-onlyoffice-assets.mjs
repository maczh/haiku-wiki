// OnlyOffice SDK is a build input, not an npm dependency or a tracked source file.
// Keep it self-hosted and reject builds that would ship a broken Office editor.
import { cp, mkdir, open, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchSdk } from './fetch-onlyoffice-assets.mjs'
import { brotliDecompressSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = '9.4.0-develop'
const destination = path.join(root, process.argv.includes('--dist') ? 'dist' : 'public', 'packages')
const required = [
  'web-apps/apps/api/documents/api.js',
  'web-apps/apps/api/documents/preload.html',
  'web-apps/apps/documenteditor/main/index.html',
  'web-apps/apps/spreadsheeteditor/main/index.html',
  'web-apps/apps/presentationeditor/main/index.html',
  'web-apps/vendor/requirejs/require.js',
  'web-apps/vendor/xregexp/xregexp-all-min.js',
  'sdkjs/common/AllFonts.js',
  'sdkjs/common/libfont/engine/fonts.js',
  ...['word', 'cell', 'slide'].flatMap(type => [`sdkjs/${type}/sdk-all.js`, `sdkjs/${type}/sdk-all-min.js`]),
  'x2t/x2t.js',
  'x2t/x2t.wasm',
]

async function missing(packages) {
  const base = path.join(packages, 'onlyoffice', version)
  const absent = []
  for (const file of required) {
    const info = await stat(path.join(base, file)).catch(() => null)
    if (!info?.isFile() || !info.size) { absent.push(file); continue }
    const handle = await open(path.join(base, file), 'r')
    try {
      const head = Buffer.alloc(128)
      await handle.read(head, 0, head.length, 0)
      if (head.toString().startsWith('version https://git-lfs.github.com/spec')) absent.push(`${file} (Git LFS 指针，非实际资源)`)
      else if (file.endsWith('.wasm') && !head.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
        // Upstream stores x2t.wasm Brotli-compressed under its original name;
        // x2t-assets.ts decodes it at runtime. Validate the decoded magic too.
        try {
          const decoded = brotliDecompressSync(await readFile(path.join(base, file)))
          if (!decoded.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) absent.push(`${file} (无效 WASM)`)
        } catch { absent.push(`${file} (无效 WASM/Brotli)`)}
      }
      else if (file.endsWith('.js') && /^\s*</.test(head.toString())) absent.push(`${file} (错误的 HTML 响应)`)
    } finally { await handle.close() }
  }
  for (const dir of ['sdkjs/word', 'sdkjs/cell', 'sdkjs/slide', 'x2t-fonts']) {
    const entries = await readdir(path.join(base, dir)).catch(() => [])
    if (!entries.length) absent.push(`${dir}/`)
  }
  // A failed/interrupted first download can leave all entry points present but
  // still miss later files. If a pinned manifest exists, check the whole tree.
  if (!absent.length) {
    const cache = path.join(root, 'vendor/onlyoffice-sdk/8e29896eed790430e4430838960127828b184040.json')
    const contents = await readFile(cache, 'utf8').catch(() => null)
    if (contents) {
      const files = JSON.parse(contents).tree.filter(file => file.type === 'blob')
      for (let start = 0; start < files.length; start += 64) {
        const batch = files.slice(start, start + 64)
        const states = await Promise.all(batch.map(file => stat(path.join(base, file.path)).catch(() => null)))
        states.forEach((info, index) => {
          if (!info?.isFile() || info.size !== batch[index].size) absent.push(batch[index].path)
        })
        if (absent.length >= 20) break
      }
    }
  }
  return absent
}

const candidates = process.argv.includes('--check') ? [destination] : process.env.ONLYOFFICE_PACKAGES_DIR
  ? [path.resolve(process.env.ONLYOFFICE_PACKAGES_DIR)]
  : [
      destination,
      path.resolve(root, '../../onlyoffice-web-comp/public/packages'),
      path.join(root, 'vendor', 'onlyoffice-packages'),
    ]

let source
for (const candidate of candidates) {
  if (!(await missing(candidate)).length) {
    source = candidate
    break
  }
}
if (!source && !process.env.ONLYOFFICE_PACKAGES_DIR && !process.argv.includes('--check')) {
  try {
    await fetchSdk(destination)
    if (!(await missing(destination)).length) source = destination
  } catch (error) {
    console.error(`[onlyoffice-assets] SDK 下载失败：${error.message}`)
  }
}
if (!source) {
  console.error(`[onlyoffice-assets] 缺少完整的 OnlyOffice ${version} 静态 SDK。`)
  console.error(`请恢复 ${destination}/onlyoffice/${version}/，或设置 ONLYOFFICE_PACKAGES_DIR 为包含 onlyoffice/${version}/ 的 packages 目录。`)
  console.error(`缺失项目：${(await missing(candidates[0])).join(', ')}`)
  console.error('SDK 被 Git 忽略，npm install 不会安装它；不要继续发布缺失 SDK 的构建。')
  process.exit(1)
}

if (source !== destination) {
  await mkdir(destination, { recursive: true })
  await cp(path.join(source, 'onlyoffice', version), path.join(destination, 'onlyoffice', version), { recursive: true })
}
const absent = await missing(destination)
if (absent.length) throw new Error(`OnlyOffice 同步后仍缺少：${absent.join(', ')}`)
console.log(`[onlyoffice-assets] OnlyOffice ${version} SDK 已就绪 → ${path.relative(root, destination)}`)
