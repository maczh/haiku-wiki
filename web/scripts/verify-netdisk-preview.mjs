/**
 * 「我的网盘」纯逻辑回归（esbuild 转译 TS → Node 执行，无浏览器依赖）。
 *
 * 覆盖：
 *   1. lib/netdisk/preview.ts  —— 预览类型判定（pdf/mp4/png/json/xyz）
 *   2. lib/netdisk/path.ts     —— 路径规范化 / 拼接 / 父目录 / 移动合法性
 *   3. lib/netdisk/format.ts   —— 导入白名单（不含 wps/dps）与体积格式化
 *   4. lib/netdisk/dirCache.ts —— 写操作后祖先链失效
 *   5. lib/netdisk/constants.ts—— 枚举与后端逐字一致（防漂移）
 *
 * 跑法：node scripts/verify-netdisk-preview.mjs
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const ESBUILD = path.join(WEB, 'node_modules/esbuild/bin/esbuild') // 原生二进制，直接执行
const OUT = path.join(os.tmpdir(), 'netdisk-verify-bundle.mjs')

const { writeFileSync, rmSync } = await import('node:fs')

// 五个纯逻辑模块打成一个 bundle（entry 用绝对路径，避免相对解析歧义）
const ENTRY = path.join(os.tmpdir(), 'netdisk-verify-entry.ts')
writeFileSync(
  ENTRY,
  `export * as preview from '${path.join(WEB, 'src/lib/netdisk/preview.ts')}'
export * as path from '${path.join(WEB, 'src/lib/netdisk/path.ts')}'
export * as format from '${path.join(WEB, 'src/lib/netdisk/format.ts')}'
export * as constants from '${path.join(WEB, 'src/lib/netdisk/constants.ts')}'
export * as dirCache from '${path.join(WEB, 'src/lib/netdisk/dirCache.ts')}'
`,
  'utf8',
)
execSync(`${ESBUILD} ${ENTRY} --bundle --format=esm --outfile=${OUT}`, { stdio: 'inherit' })
const { preview, path: p, format, constants, dirCache } = await import(`file://${OUT}`)

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log('✅', name, extra)
  } else {
    fail += 1
    console.log('❌', name, extra)
  }
}

// ---------- 1. 预览类型判定 ----------
ok('pdf → reader', preview.netdiskPreviewKind('方案.pdf') === 'reader')
ok('docx → reader', preview.netdiskPreviewKind('a.docx') === 'reader')
ok('xlsx → reader', preview.netdiskPreviewKind('a.xlsx') === 'reader')
ok('xls → reader', preview.netdiskPreviewKind('a.xls') === 'reader')
ok('doc → reader', preview.netdiskPreviewKind('a.doc') === 'reader')
ok('ppt → reader', preview.netdiskPreviewKind('a.ppt') === 'reader')
ok('pptx → reader', preview.netdiskPreviewKind('a.pptx') === 'reader')
ok('drawio → reader', preview.netdiskPreviewKind('a.drawio') === 'reader')
ok('md → reader', preview.netdiskPreviewKind('README.md') === 'reader')
ok('mp4 → video', preview.netdiskPreviewKind('演示.mp4') === 'video')
ok('mkv → video', preview.netdiskPreviewKind('x.mkv') === 'video')
ok('mp3 → audio', preview.netdiskPreviewKind('x.mp3') === 'audio')
ok('png → image', preview.netdiskPreviewKind('封面.png') === 'image')
ok('svg → image', preview.netdiskPreviewKind('x.svg') === 'image')
ok('json → text', preview.netdiskPreviewKind('x.json') === 'text')
ok('log → text', preview.netdiskPreviewKind('x.log') === 'text')
ok('xyz → unsupported', preview.netdiskPreviewKind('x.xyz') === 'unsupported')
ok('无扩展名 → unsupported', preview.netdiskPreviewKind('README') === 'unsupported')
ok('大写扩展名也认', preview.netdiskPreviewKind('A.PDF') === 'reader')
ok('isPreviewSupported 与 kind 一致', preview.isPreviewSupported('a.mp4') && !preview.isPreviewSupported('a.xyz'))
ok('不可预览原因带扩展名', preview.previewUnsupportedReason('a.xyz').includes('.xyz'))
ok('二进制预览 docType=file', preview.netdiskPreviewDocType('a.pdf') === 'file')
ok('md 预览 docType=markdown', preview.netdiskPreviewDocType('a.md') === 'markdown')
ok('mp4 无 docType', preview.netdiskPreviewDocType('a.mp4') === null)

// ---------- 2. 路径 ----------
ok('cleanPath 去尾斜杠', p.cleanPath('/a/b/') === '/a/b')
ok('cleanPath 折叠重复斜杠', p.cleanPath('//a///b') === '/a/b')
ok('cleanPath 相对路径补 /', p.cleanPath('a/b') === '/a/b')
ok('cleanPath 空 = 根', p.cleanPath('') === '/')
ok('cleanPath 反斜杠归一', p.cleanPath('\\a\\b') === '/a/b')
let threw = false
try {
  p.cleanPath('/a/../etc')
} catch {
  threw = true
}
ok('cleanPath 拒绝 ..', threw)
ok('joinPath 根下拼接', p.joinPath('/', '2026') === '/2026')
ok('joinPath 子目录拼接', p.joinPath('/a', 'b') === '/a/b')
ok('joinPath 反斜杠被剔除', p.joinPath('/a', 'b/c') === '/a/bc')
ok('baseName', p.baseName('/a/b/c.pdf') === 'c.pdf')
ok('baseName 根 = 空', p.baseName('/') === '')
ok('parentPath', p.parentPath('/a/b/c') === '/a/b')
ok('parentPath 一级子目录的父是根', p.parentPath('/a') === '/')
ok('parentPath 根的父仍是根', p.parentPath('/') === '/')
ok('pathSegments', JSON.stringify(p.pathSegments('/a/b')) === JSON.stringify([{ name: 'a', path: '/a' }, { name: 'b', path: '/a/b' }]))
ok('pathSegments 根为空数组', p.pathSegments('/').length === 0)
ok('isSameOrAncestor 自身算祖先', p.isSameOrAncestor('/a', '/a'))
ok('isSameOrAncestor 前缀', p.isSameOrAncestor('/a', '/a/b/c'))
ok('isSameOrAncestor 前缀不能只匹配字符串', !p.isSameOrAncestor('/ab', '/a/b'))
ok('isDescendantOf 不含自身', !p.isDescendantOf('/a', '/a'))
ok('isDescendantOf 真后代', p.isDescendantOf('/a', '/a/b'))
ok('isValidMoveTarget 禁止移到自身', !p.isValidMoveTarget('/a', '/a'))
ok('isValidMoveTarget 禁止移到自身子目录', !p.isValidMoveTarget('/a', '/a/b'))
ok('isValidMoveTarget 允许移到别处', p.isValidMoveTarget('/a', '/x'))

// ---------- 3. 导入白名单与格式化 ----------
ok('md 可导入', format.isNetdiskImportable('a.md'))
ok('docx 可导入', format.isNetdiskImportable('a.docx'))
ok('zip 可导入（md.zip）', format.isNetdiskImportable('a.zip'))
ok('smm 可导入', format.isNetdiskImportable('a.smm'))
ok('wps 不可导入', !format.isNetdiskImportable('a.wps'))
ok('dps 不可导入', !format.isNetdiskImportable('a.dps'))
ok('mp4 不可导入', !format.isNetdiskImportable('a.mp4'))
ok('无扩展名不可导入', !format.isNetdiskImportable('README'))
ok('不可导入原因带扩展名', format.netdiskImportReason('a.mp4').includes('.mp4'))
ok('formatSize 空', format.formatSize(0) === '—')
ok('formatSize KB', format.formatSize(2048) === '2 KB')
ok('formatSize MB', format.formatSize(1024 * 1024 * 2.5) === '2.5 MB')
ok('formatSize GB', format.formatSize(1024 * 1024 * 1024 * 3) === '3 GB')
ok('formatPercent 裁剪', format.formatPercent(150) === '100%' && format.formatPercent(-5) === '0%')
ok('taskStatusLabel', format.taskStatusLabel('running') === '进行中')
ok('taskTypeLabel', format.taskTypeLabel('import') === '导入到文库')

// ---------- 4. 目录缓存 ----------
dirCache.dirCacheClear()
ok('缓存未命中返回 null', dirCache.dirCacheGet(1, '/') === null)
dirCache.dirCacheSet(1, '/', [{ name: 'a', path: '/a', is_dir: true, size: 0, mod_time: '' }])
ok('写入后可命中', dirCache.dirCacheGet(1, '/')?.length === 1)
dirCache.dirCacheSet(1, '/a', [])
ok('子目录也可命中', dirCache.dirCacheGet(1, '/a') !== null)
dirCache.dirCacheInvalidate(1, '/a/b')
ok('失效子目录连带祖先 /a', dirCache.dirCacheGet(1, '/a') === null)
ok('失效子目录连带祖先 /', dirCache.dirCacheGet(1, '/') === null)
dirCache.dirCacheSet(2, '/', [])
dirCache.dirCacheInvalidateConn(1)
ok('整连接失效不影响别的连接', dirCache.dirCacheGet(2, '/') !== null)
ok('整连接失效清掉本连接', dirCache.dirCacheGet(1, '/') === null)

// ---------- 5. 枚举与后端逐字一致 ----------
ok('NETDISK_KINDS 含六类', constants.NETDISK_KINDS.length === 6 && constants.NETDISK_KINDS.includes('quark'))
ok('状态四态', constants.NETDISK_STATUSES.length === 4)
ok('任务类型两种', constants.NETDISK_TASK_TYPES.length === 2)
ok('FTP 模式两种', constants.FTP_MODES.length === 2)
ok('错误码段 42xxx', constants.NETDISK_ERROR_CODE.UNSUPPORTED === 42008 && constants.NETDISK_ERROR_CODE.CONFLICT === 42005)
ok('isOAuthKind', constants.isOAuthKind('baidu') && constants.isOAuthKind('aliyun') && !constants.isOAuthKind('smb'))
ok('isNativeKind', constants.isNativeKind('smb') && !constants.isNativeKind('baidu'))

rmSync(ENTRY, { force: true })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) process.exit(1)
