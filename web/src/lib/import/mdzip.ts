// Markdown 包（.md.zip / .zip）导入解包器：zip 里一个 .md + 若干被它引用的图片。
//
// 需求：导入「带内嵌图片的 .md + 图片」压缩包后，图片要转存进文库（走上传链路拿到
// 新 URL），并把 .md 正文里的图片地址**同步改写**成新 URL 再入库，保证文档打开即见图。
//
// 设计要点：
//   - 解析（本文件）与上传（runImport / ImportDialog 两条链路）分离：这里只负责
//     「解包 + 找 md + 收集图片引用 + 产出可重写正文的 apply」，绝不发请求；
//   - 上传走既有秒传链路（uploadWithDedup），同一张图被多种写法引用时只上传一次
//     （按 zip 内解析路径去重，别名 key 在 apply 时自动跟主 key 取同一个 url）；
//   - 防护与 mindmap_import.go（后端 .xmind 解压）同口径：限制单条目与总量，
//     且只读取「md + 被引用的图片」这些需要的条目，zip 炸弹读不进内存；
//   - 引用识别三种形态：行内 ![alt](ref "title")、HTML <img src="...">、
//     引用式 ![alt][label] + [label]: path（仅当 label 确实被图片用到才改写，
//     避免误伤普通链接的定义）；
//   - 解析不到的引用（缺失文件、外链、data:、站点绝对路径）**原样保留**，
//     绝不因为个别图片失败而丢弃整个文档。
import JSZip from 'jszip'

/** zip 内一张待上传的图片 */
export interface MdZipImage {
  /** md 里的原始引用文本（如 "./images/a.png"），上传后重写正文的 key */
  key: string
  /** 解析到的 zip 条目路径（小写规范化），同一文件多写法引用据此去重 */
  path: string
  /** 可直接走上传链路的文件对象 */
  file: File
}

export interface MdZipPackage {
  images: MdZipImage[]
  /**
   * 用「原始引用文本 → 上传后 URL」映射重写正文。
   * 查不到 URL 的引用原样保留（含解析失败的图片与外链）。
   */
  apply: (urlOf: (key: string) => string | undefined) => string
}

/** 预期内的失败（消息可直接展示给用户）；非 MdZipError 视为意外损坏 */
export class MdZipError extends Error {}

// 与后端 upload_service.go 的 allowedExt / maxUploadBytes 对齐：
// 不在白名单里的扩展名（avif/ico 等）传上去必被拒，这里直接不收。
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

const MAX_ENTRY_BYTES = 64 << 20 // 单条目解压上限 = 后端 UploadMaxBytes
const MAX_TOTAL_BYTES = 256 << 20 // 本次导入图片字节总量上限

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}

function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

function depth(path: string): number {
  let d = 0
  for (const ch of path) if (ch === '/') d++
  return d
}

/** zip 内路径规范化：反斜杠→斜杠、去开头 ./ 与 / */
function normZipPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^\/+/, '')
}

/** 把相对引用解析成 zip 内绝对路径（基于 md 所在目录），处理 ../ 与 ./ */
function resolveRelative(baseDir: string, rel: string): string {
  const parts = baseDir ? baseDir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export interface MdZipOpenResult {
  mdPath: string
  mdText: string
  pkg: MdZipPackage
}

/**
 * 解包 Markdown 压缩包：
 *  ① 找 .md（层级最浅优先，其次名字短者优先——根目录的优于子目录里的）；
 *  ② 扫描正文里的图片引用，把能解析到 zip 条目的图片读出来组装成 File；
 *  ③ 返回 md 原文与 apply（上传完成后重写正文用）。
 *
 * 失败一律抛 MdZipError（消息可直出），调用方据此提示、不产生损坏文档。
 */
export async function openMdZip(file: File): Promise<MdZipOpenResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new MdZipError('不是有效的 zip 压缩包（文件可能已损坏）')
  }

  // 跳过目录与 macOS 打包噪声（__MACOSX/、.DS_Store）
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)$/i.test(normZipPath(f.name)),
  )
  const mds = entries
    .filter((f) => /\.(md|markdown)$/i.test(f.name))
    .sort((a, b) => depth(a.name) - depth(b.name) || a.name.length - b.name.length || (a.name < b.name ? -1 : 1))
  if (mds.length === 0) {
    throw new MdZipError('压缩包中未找到 .md 文件（Markdown 包 = .md + 其引用的图片）')
  }
  const mdEntry = mds[0]
  const mdText = await mdEntry.async('string')
  if (!mdText.trim()) {
    throw new MdZipError('压缩包中的 .md 文件内容为空')
  }
  const mdPath = normZipPath(mdEntry.name)
  const mdDir = mdPath.includes('/') ? mdPath.slice(0, mdPath.lastIndexOf('/')) : ''

  // 条目索引：精确路径 + 小写路径两套（zip 内大小写不一致的包很常见）
  const exact = new Map<string, (typeof entries)[number]>()
  const lower = new Map<string, (typeof entries)[number]>()
  for (const e of entries) {
    const p = normZipPath(e.name)
    if (!exact.has(p)) exact.set(p, e)
    if (!lower.has(p.toLowerCase())) lower.set(p.toLowerCase(), e)
  }

  /** 原始引用 → zip 条目；解析不到（外链/缺失/绝对路径/非图片）返回 null */
  const lookup = (raw: string): (typeof entries)[number] | null => {
    let p = raw.trim()
    if (!p) return null
    if (/^(https?:|data:|blob:|mailto:|javascript:|#)/i.test(p) || p.startsWith('/')) return null
    p = p.split(/[?#]/)[0]
    try {
      p = decodeURIComponent(p)
    } catch {
      // 引用里可能有裸 %，解不动就按原文找
    }
    p = p.replace(/\\/g, '/')
    const rel = p.replace(/^\.?\//, '')
    const abs = resolveRelative(mdDir, rel)
    for (const cand of [abs, rel]) {
      const hit = exact.get(cand) ?? lower.get(cand.toLowerCase())
      if (hit) return hit
    }
    // 兜底：按文件名唯一匹配（一些导出工具打包时会平铺/换目录）
    const base = (abs.split('/').pop() || '').toLowerCase()
    if (!base) return null
    let uniq: (typeof entries)[number] | null = null
    for (const e of entries) {
      if (normZipPath(e.name).toLowerCase().endsWith('/' + base)) {
        if (uniq) return null // 同名多个，宁可不动也不误配
        uniq = e
      }
    }
    return uniq
  }

  const { refs } = transformRefs(mdText)
  const images: MdZipImage[] = []
  const byPath = new Map<string, MdZipImage>()
  const alias = new Map<string, string>() // 别名 key → 主 key（同文件多写法）
  let total = 0
  for (const raw of refs) {
    const entry = lookup(raw)
    if (!entry) continue
    if (!IMAGE_EXTS.has(extOf(entry.name))) continue
    const pathKey = normZipPath(entry.name).toLowerCase()
    const seen = byPath.get(pathKey)
    if (seen) {
      if (seen.key !== raw) alias.set(raw, seen.key)
      continue
    }
    const blob = await entry.async('blob')
    if (blob.size > MAX_ENTRY_BYTES) continue // 单图超限：保留原路径，不中断导入
    total += blob.size
    if (total > MAX_TOTAL_BYTES) throw new MdZipError('压缩包内容过大（图片解压后超过 256MB）')
    const base = entry.name.slice(entry.name.lastIndexOf('/') + 1)
    const img: MdZipImage = {
      key: raw,
      path: pathKey,
      file: new File([blob], base, { type: MIME_BY_EXT[extOf(base)] || 'application/octet-stream' }),
    }
    images.push(img)
    byPath.set(pathKey, img)
  }

  const pkg: MdZipPackage = {
    images,
    apply: (urlOf) =>
      // 同一文件的别名写法跟随主 key 的 URL
      transformRefs(mdText, (raw) => urlOf(raw) ?? (alias.has(raw) ? urlOf(alias.get(raw)!) : undefined)).text,
  }
  return { mdPath, mdText, pkg }
}

/**
 * 扫描/改写 md 里的图片引用。
 *  - 不传 urlOf：仅收集（refs = 原始引用文本，按出现顺序，可能重复）；
 *  - 传 urlOf：引用能查到 URL 就替换，查不到原样保留。
 * 三种形态共用 onRef，保证「收集」与「改写」永远同口径。
 */
function transformRefs(
  md: string,
  urlOf?: (raw: string) => string | undefined,
): { text: string; refs: string[] } {
  const refs: string[] = []
  const onRef = (raw: string): string => {
    const t = raw.trim()
    if (urlOf) {
      const u = t ? urlOf(t) : undefined
      return u ? u : raw
    }
    if (t) refs.push(t)
    return raw
  }
  let out = md

  // ① 行内图片 ![alt](ref "title")；ref 含空格时用 <ref> 包裹
  out = out.replace(
    /(!\[[^\]\n]*\]\(\s*)(?:<([^<>\n]*)>|([^)\s]+))((?:\s+"[^"\n]*")?\s*\))/g,
    (_m, head: string, angle: string | undefined, plain: string | undefined, tail: string) =>
      head + onRef(angle ?? plain ?? '') + tail,
  )

  // ② HTML <img src="...">（md 里内嵌 HTML 的写法）
  out = out.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"'\n>]*)\2/gi,
    (_m, head: string, q: string, src: string) => head + q + onRef(src) + q,
  )

  // ③ 引用式图片 ![alt][label] 的定义行 [label]: path —— 仅当 label 确实被图片用到
  const usedLabels = new Set<string>()
  for (const m of md.matchAll(/!\[[^\]\n]*\]\s*\[([^\]\n]+)\]/g)) {
    usedLabels.add(m[1].trim().toLowerCase())
  }
  if (usedLabels.size > 0) {
    out = out.replace(
      /^[ \t]{0,3}(\[[^\]\n]+\]):[ \t]*(?:<([^<>\n]*)>|([^\s]+))([ \t]+"[^"\n]*")?[ \t]*$/gm,
      (m, label: string, angle: string | undefined, plain: string | undefined, title: string | undefined) => {
        if (!usedLabels.has(label.slice(1, -1).trim().toLowerCase())) return m
        return `[${label.slice(1, -1)}]:` + ' ' + onRef(angle ?? plain ?? '') + (title ?? '')
      },
    )
  }

  return { text: out, refs }
}
