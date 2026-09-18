// 导入「格式 ↔ 扩展名」映射（前端唯一事实来源）。
//
// 为什么要单独拆一个文件：
//   1. lib/import/parse.ts 会静态拉入 xlsx / turndown / dompurify 等重依赖，
//      而导入下拉（DocTree）只需要这张轻量映射表 —— 若从 parse.ts 导出，
//      「打开知识库」就会顺带下载整包解析器；
//   2. 文件选择对话框的 accept 过滤与各格式的扩展名集合必须和解析器注册表
//      （parse.ts 的 parserRegistry）保持一致，否则会出现「选了 Word 却只能选到 .pdf」
//      这类过滤错配。映射表放在这里，parse.ts 反向依赖它生成 ACCEPT_EXTENSIONS，
//      保证二者不会各写一份而漂移。

/** 一种导入格式的展示与过滤信息 */
export interface ImportFormatSpec {
  /** 下拉菜单 key（与 ACCEPT 过滤、URL 等特殊项共用同一 menu） */
  key: string
  /** 下拉展示文案 */
  label: string
  /** 该格式允许的扩展名（小写，不带点） */
  exts: string[]
  /** 传给 <input type="file" accept> 的字符串（逗号分隔，带点） */
  accept: string
}

/** 由扩展名集合生成 accept 字符串（保持声明顺序，便于界面与过滤一致） */
function acceptOf(exts: string[]): string {
  return exts.map((e) => `.${e}`).join(',')
}

function spec(key: string, label: string, exts: string[]): ImportFormatSpec {
  return { key, label, exts, accept: acceptOf(exts) }
}

/**
 * 导入下拉的格式清单。顺序即菜单展示顺序。
 *
 * 约定：exts 必须与 parse.ts 的 parserRegistry 键集合一致（注册表里的键都应在其中，
 * 这里列出的扩展名也都应能被解析，哪怕是「明确不支持」的解析器——.wps/.dps 即如此，
 * 它们由 parse.ts 给出友好拒绝文案而不是静默失败）。
 */
export const IMPORT_FORMATS: ImportFormatSpec[] = [
  spec('md', 'Markdown（.md）', ['md', 'markdown', 'txt']),
  spec('html', 'HTML（.html）', ['htm', 'html']),
  spec('pdf', 'PDF（.pdf）', ['pdf']),
  spec('docx', 'Word（.docx）', ['docx', 'doc']),
  spec('xlsx', 'Excel（.xlsx）', ['xls', 'xlsx', 'csv', 'et']),
  spec('mindmap', '思维导图（.smm/.km/.xmind/.mm）', ['smm', 'km', 'xmind', 'mm']),
  spec('pptx', 'PPT（.pptx）', ['pptx']),
  spec('dwg', 'AutoCAD（.dwg/.dxf）', ['dwg', 'dxf']),
  spec('drawio', 'draw.io 绘图（.drawio）', ['drawio']),
  spec('vsdx', 'Visio（.vsd/.vsdx）', ['vsd', 'vsdx']),
  spec('wps', 'WPS（.wps/.dps）', ['wps', 'dps']),
]

/** 「网页链接导入」不是文件格式，单独作为下拉项（不进文件选择器） */
export const IMPORT_URL_KEY = 'url'

/** 全部受支持的导入扩展名（小写，去重，保持声明顺序） */
export const IMPORT_EXTENSIONS: string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of IMPORT_FORMATS) {
    for (const e of f.exts) {
      if (!seen.has(e)) {
        seen.add(e)
        out.push(e)
      }
    }
  }
  return out
})()

/** 取文件扩展名（小写，无扩展名返回空串） */
export function extOfName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 该扩展名是否有对应导入解析器（无扩展名视为不支持） */
export function isSupportedImportExt(ext: string): boolean {
  return IMPORT_EXTENSIONS.includes(ext.toLowerCase())
}

/** 不支持格式的统一拒绝文案（导入列表与 toast 共用，避免各处措辞不一） */
export function unsupportedImportReason(name: string): string {
  const ext = extOfName(name)
  return ext ? `暂不支持该格式（.${ext}）` : '暂不支持该格式（无法识别文件类型）'
}
