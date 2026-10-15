import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Pin the upstream revision so SDK contents do not change between builds.
export const SDK_REVISION = '99dbe255893b82fba46b82b337c571eb7d41f668'
const treeId = '8e29896eed790430e4430838960127828b184040'
const repository = 'electroluxcode/onlyoffice-web-comp'
const version = '9.4.0-develop'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)))
  })
}

export async function fetchSdk(destination) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'haiku-onlyoffice-sdk-'))
  try {
    console.log(`[onlyoffice-assets] 从原仓库下载 SDK（首次约 1GB 解压资源）：${SDK_REVISION}`)
    const manifest = path.join(temporary, 'tree.json')
    const download = (url, file) => run('curl', ['--fail', '--location', '--retry', '1', '--connect-timeout', '20', '--max-time', '600', '--silent', '--show-error', '--output', file, url])
    const cache = path.resolve(destination, '../../vendor/onlyoffice-sdk', `${treeId}.json`)
    let tree
    try {
      tree = JSON.parse(await readFile(cache, 'utf8'))
      if (tree.sha !== treeId || tree.truncated || !tree.tree?.length) throw new Error('无效缓存')
    } catch {
      await download(`https://api.github.com/repos/${repository}/git/trees/${treeId}?recursive=1`, manifest)
      tree = JSON.parse(await readFile(manifest, 'utf8'))
      if (tree.sha !== treeId || tree.truncated || !tree.tree?.length) throw new Error('SDK 文件清单不完整')
      await mkdir(path.dirname(cache), { recursive: true })
      await copyFile(manifest, cache)
    }
    if (tree.truncated || !tree.tree?.length) throw new Error('SDK 文件清单不完整')
    // Many language help pages share the same binary files. Fetch each Git blob
    // once and copy it to its other paths, avoiding a huge, duplicate tarball.
    const groups = new Map()
    for (const file of tree.tree.filter(entry => entry.type === 'blob')) {
      if (path.isAbsolute(file.path) || file.path.split('/').includes('..')) throw new Error('无效 SDK 路径')
      const list = groups.get(file.sha) || []
      list.push(file)
      groups.set(file.sha, list)
    }
    const priority = files => files.some(file => /^(x2t\/|x2t-fonts\/|web-apps\/apps\/api\/)/.test(file.path)) ? 0 : 1
    const jobs = [...groups.entries()].sort((a, b) => priority(a[1]) - priority(b[1]))
    const base = path.join(destination, 'onlyoffice', version)
    let cursor = 0
    let done = 0
    let bytes = 0
    const errors = []
    const hash = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
    console.log(`[onlyoffice-assets] ${tree.tree.filter(f => f.type === 'blob').length} 个文件，去重后下载 ${jobs.length} 个资源（32 路并发）`)
    await Promise.all(Array.from({ length: 32 }, async () => {
      while (cursor < jobs.length) {
        const [sha, files] = jobs[cursor++]
        try {
          const first = files[0]
          const output = path.join(base, first.path)
          await mkdir(path.dirname(output), { recursive: true })
          let data
          if ((await stat(output).catch(() => null))?.size === first.size) {
            const existing = await readFile(output)
            if (hash(existing) === sha) data = existing
          }
          if (!data) {
            // This CDN is documented by upstream. All downloaded bytes must
            // match the immutable Git blob; otherwise use the pinned Git URL.
            const urls = [
              `https://ca0eac5f.onlyoffice-packages.pages.dev/onlyoffice/${version}/${first.path.split('/').map(encodeURIComponent).join('/')}`,
              `https://raw.githubusercontent.com/${repository}/${SDK_REVISION}/public/packages/onlyoffice/${version}/${first.path.split('/').map(encodeURIComponent).join('/')}`,
            ]
            let error
            for (const url of urls) {
              try {
                await download(url, output)
                data = await readFile(output)
                if (hash(data) !== sha) throw new Error('SDK Git blob 校验不匹配')
                error = undefined
                break
              } catch (cause) { error = cause; data = undefined }
            }
            if (error) throw error
            bytes += data.length
          }
          for (const duplicate of files.slice(1)) {
            const target = path.join(base, duplicate.path)
            await mkdir(path.dirname(target), { recursive: true })
            await copyFile(output, target)
          }
        } catch (error) { errors.push(`${files[0].path}: ${error.message}`) }
        done++
        if (done % 200 === 0 || done === jobs.length) console.log(`[onlyoffice-assets] ${done}/${jobs.length}，本次下载 ${(bytes / 1048576).toFixed(1)} MB`)
      }
    }))
    if (errors.length) throw new Error(`${errors.length} 个 SDK 资源失败：\n${errors.slice(0, 10).join('\n')}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
