// 块级操作的纯逻辑层：Markdown 行 ⇄ 块类型转换、插入模板、行内样式包装。
//
// 为什么以「Markdown 源文本」为操作对象，而不是直接改 DOM：
//   · Vditor 的 IR 模式把内容同时维护成 DOM 与 Markdown 两份，直接改 DOM 会被它自己的
//     输入事件覆盖或产生不一致；
//   · DOM 侧的块定位不可靠：`data-block` 是静态占位 "0"（详见 lib/irDom.ts），
//     只能用文档序索引近似映射到源码行，多行块（代码块/表格/列表）会错位，
//     因此块级操作统一走 Markdown 文本变换最稳。
//   · 文本变换可单测，不依赖浏览器。

/** 可识别的块类型（与 Markdown 语法一一对应） */
export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'code'
  | 'hr'
  | 'table'
  // 增量（语雀交互复刻）：高亮块（带 emoji 前缀的 blockquote）与折叠块（HTML details）
  | 'callout'
  | 'details'

/** 行内样式 */
export type InlineStyle = 'bold' | 'italic' | 'strike' | 'code' | 'mark'

/** 行的块前缀（保留缩进，便于处理嵌套列表） */
const BLOCK_PREFIX_RE = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/

/** 去掉行首的块标记，保留缩进与正文 */
export function stripBlockPrefix(line: string): string {
  return line.replace(BLOCK_PREFIX_RE, '$1')
}

/** 判断一行的块类型 */
export function detectBlockKind(line: string): BlockKind {
  const t = line.trim()
  if (!t) return 'paragraph'
  if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) return 'hr'
  if (t.startsWith('```') || t.startsWith('~~~')) return 'code'
  // 表格必须在列表之前判断：| - | 这样的分隔行也以 | 开头
  if (/^\|.*\|$/.test(t)) return 'table'
  // 折叠块：HTML <details> 标签（整块多行，此处只判首行）
  if (/^\s*<details>/i.test(t)) return 'details'
  if (/^>\s?/.test(t)) {
    // 高亮块：带 emoji 前缀的 blockquote（小图标集合，避免把中文引用误判为 callout）
    if (/^>\s*(💡|📌|⚠️|✅|🔥|📝|💬|🎯|🚀|⭐|📎|🔔|📢|✔️|❗|📍|💡|🔆|📦|🧭|🛠️|♻️|📌)\s/.test(t)) return 'callout'
    return 'quote'
  }
  if (/^[-*+]\s+\[[ xX]\](\s|$)/.test(t)) return 'task'
  if (/^\d+[.)]\s+/.test(t)) return 'ol'
  if (/^[-*+]\s+/.test(t)) return 'ul'
  if (/^####\s+/.test(t)) return 'h4'
  if (/^###\s+/.test(t)) return 'h3'
  if (/^##\s+/.test(t)) return 'h2'
  if (/^#\s+/.test(t)) return 'h1'
  return 'paragraph'
}

/** 「转换为」菜单的目标类型 */
export const CONVERT_TARGETS: { kind: BlockKind; label: string }[] = [
  { kind: 'paragraph', label: '正文' },
  { kind: 'h1', label: '标题 1' },
  { kind: 'h2', label: '标题 2' },
  { kind: 'h3', label: '标题 3' },
  { kind: 'ul', label: '无序列表' },
  { kind: 'ol', label: '有序列表' },
  { kind: 'task', label: '待办清单' },
  { kind: 'quote', label: '引用' },
  { kind: 'code', label: '代码块' },
  { kind: 'hr', label: '分割线' },
]

/**
 * 把一行内容转成目标块类型。
 *
 * 返回的可能是**多行**（代码块要包一层围栏，表格要三行），调用方需按整体替换该行。
 */
export function convertLine(line: string, kind: BlockKind): string {
  const indent = /^(\s*)/.exec(line)?.[1] ?? ''
  const text = stripBlockPrefix(line).trim()
  switch (kind) {
    case 'paragraph':
      return indent + text
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(kind.slice(1))
      const head = '#'.repeat(level)
      // 空内容只保留前缀（`## ` 才是合法空标题），绝不写入「标题」字样
      return text ? `${indent}${head} ${text}` : `${indent}${head} `
    }
    case 'ul':
      // 空内容只保留 `- ` 前缀，不写「列表项」字样
      return `${indent}- ${text}`
    case 'ol':
      // 空内容只保留 `1. ` 前缀，不写「列表项」字样
      return `${indent}1. ${text}`
    case 'task':
      // 空内容只保留 `- [ ] ` 前缀，不写「列表项」字样
      return `${indent}- [ ] ${text}`
    case 'quote':
      // 引用可能多行：逐行加 > 前缀；空内容只保留 `> ` 前缀，不写「引用内容」字样
      return text
        ? text
            .split('\n')
            .map((l) => `${indent}> ${l}`)
            .join('\n')
        : `${indent}> `
    case 'code':
      // 已经是代码块就不再套一层（避免 ``` 嵌套）
      if (detectBlockKind(line) === 'code') return line
      return '```\n' + (text || '') + '\n```'
    case 'hr':
      return `${indent}---`
    case 'table':
      if (detectBlockKind(line) === 'table') return line
      return `${indent}| 列 1 | 列 2 |\n${indent}| --- | --- |\n${indent}| ${text || ' '} |  |`
    case 'callout':
      // 高亮块：带 emoji 前缀的 blockquote（语雀 callout 风格）
      return `${indent}> 💡 ${text || '提示内容'}`
    case 'details':
      // 折叠块：HTML <details>（Vditor IR 与阅读态均按原始 HTML 渲染/保留）
      return `${indent}<details>\n${indent}<summary>折叠块</summary>\n${indent}\n${indent}${text || '内容'}\n${indent}</details>`
    default:
      return indent + text
  }
}

// ---------- 插入模板 ----------

/** 插入类菜单项：把 lines 插到当前行之后 */
export interface InsertTemplate {
  key: string
  label: string
  lines: string[]
  /** 搜索用关键词（含拼音首字母与英文，方便中英混输） */
  keywords: string
}

export const INSERT_TEMPLATES: InsertTemplate[] = [
  { key: 'table', label: '表格', lines: ['| 列 1 | 列 2 |', '| --- | --- |', '|  |  |'], keywords: 'biaoge table grid 表格' },
  { key: 'code', label: '代码块', lines: ['```', '', '```'], keywords: 'daima code block 代码' },
  { key: 'quote', label: '引用', lines: ['> '], keywords: 'yinyong quote 引用' },
  { key: 'todo', label: '待办项', lines: ['- [ ] '], keywords: 'daiban todo checkbox 待办 任务' },
  { key: 'divider', label: '分割线', lines: ['---'], keywords: 'fenge hr divider 分割' },
  { key: 'math', label: '数学公式', lines: ['$$', '', '$$'], keywords: 'gongshi math latex formula 公式' },
  { key: 'date', label: '当前日期', lines: [], keywords: 'riqi date today 日期 今天' },
  { key: 'datetime', label: '当前日期时间', lines: [], keywords: 'shijian datetime now 时间 现在' },
]

/** 走宿主弹窗/上传流程的插入项（自己无法离线完成） */
export const HOST_INSERT_ITEMS: InsertTemplate[] = [
  { key: 'image', label: '图片', lines: [], keywords: 'tupian image picture upload 图片 上传' },
  { key: 'link', label: '链接', lines: [], keywords: 'lianjie link url 链接' },
  { key: 'attachment', label: '附件文件', lines: [], keywords: 'fujian attachment file upload 附件 文件' },
]

// ---------- 行内样式 ----------

const INLINE_WRAPPERS: Record<InlineStyle, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  mark: ['==', '=='],
}

export const INLINE_STYLES: { style: InlineStyle; label: string; keywords: string }[] = [
  { style: 'bold', label: '加粗', keywords: 'jiacu bold strong 加粗' },
  { style: 'italic', label: '斜体', keywords: 'xieti italic 斜体' },
  { style: 'strike', label: '删除线', keywords: 'shanchuxian strike delete 删除线' },
  { style: 'code', label: '行内代码', keywords: 'daima code inline 行内代码' },
  { style: 'mark', label: '高亮', keywords: 'gaoliang mark highlight 高亮' },
]

/**
 * 给一行的正文加行内样式。
 *
 * - 正文已经带同样的包裹时会**取消**该样式（与所见即所得编辑器的再点一次取消一致）；
 * - 正文为空时填占位文本，否则光标落在两个标记之间没法继续输入。
 */
export function applyInlineStyle(line: string, style: InlineStyle, text?: string): string {
  const prefixMatch = BLOCK_PREFIX_RE.exec(line)
  const prefix = prefixMatch ? prefixMatch[0] : ''
  const indent = /^\s*/.exec(prefix)?.[0] ?? ''
  const marker = prefix.slice(indent.length)
  const body = line.slice(prefix.length)
  const [open, close] = INLINE_WRAPPERS[style]
  const target = (text ?? body).trim()
  if (!target) return line
  // 已有包裹 → 去掉
  if (body.startsWith(open) && body.endsWith(close) && body.length >= open.length + close.length) {
    const inner = body.slice(open.length, body.length - close.length)
    if (inner.trim()) return prefix + inner
  }
  return `${prefix}${open}${target}${close}`
}

// ---------- 时间 ----------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地日期 `YYYY-MM-DD` */
export function formatDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 本地日期时间 `YYYY-MM-DD HH:mm` */
export function formatDateTime(d = new Date()): string {
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ---------- 整体替换 ----------

/**
 * 用 `replacement`（可多行）替换 `lines` 的第 `index` 行，返回新行数组。
 * index 越界时按追加处理，调用方不必先做边界判断。
 */
export function replaceLine(lines: string[], index: number, replacement: string[]): string[] {
  const next = lines.slice()
  if (index < 0 || index >= next.length) {
    next.push(...replacement)
    return next
  }
  next.splice(index, 1, ...replacement)
  return next
}

/** 在 `index` 之后插入若干行 */
export function insertAfterLine(lines: string[], index: number, addition: string[]): string[] {
  const next = lines.slice()
  const at = Math.min(Math.max(index + 1, 0), next.length)
  next.splice(at, 0, ...addition)
  return next
}

// ---------- 增量（语雀交互复刻）：块级边界识别与多行块操作 ----------

/** 块的起止行（含端点），用于删除 / 复制 / 缩进等多行块操作 */
export interface BlockRange {
  start: number
  end: number
}

const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s+/

/**
 * 把单行索引扩展为整个块的边界（代码块围栏、表格、details、连续引用/列表等）。
 *
 * 处理规则：
 *  - code：从首行围栏找到下一个 ``` / ~~~ 闭合行为止；
 *  - details：从 <details> 找到 </details> 为止；
 *  - table：连续以 `|` 开头的行为止；
 *  - quote / callout：连续以 `>` 开头的行为止；
 *  - ul / ol / task：连续列表项（含同级续行缩进行）为止；
 *  - 其余（标题 / 段落 / hr 等）单行处理。
 */
export function detectBlockRange(lines: string[], index: number): BlockRange {
  const n = lines.length
  if (index < 0 || index >= n) {
    const clamped = Math.max(0, Math.min(index, n - 1))
    return { start: clamped, end: clamped }
  }
  const kind = detectBlockKind(lines[index] ?? '')
  const line = (i: number) => lines[i] ?? ''

  if (kind === 'code') {
    let end = index
    for (let i = index + 1; i < n; i++) {
      if (/^\s*```|^\s*~~~/i.test(line(i).trim())) {
        end = i
        break
      }
      end = i
    }
    return { start: index, end }
  }
  if (kind === 'details') {
    let end = index
    for (let i = index + 1; i < n; i++) {
      if (/^\s*<\/details>/i.test(line(i).trim())) {
        end = i
        break
      }
      end = i
    }
    return { start: index, end }
  }
  if (kind === 'table') {
    let end = index
    while (end + 1 < n && /^\|.*\|$/.test(line(end + 1).trim())) end++
    return { start: index, end }
  }
  if (kind === 'quote' || kind === 'callout') {
    let end = index
    while (end + 1 < n && /^>\s?/.test(line(end + 1))) end++
    return { start: index, end }
  }
  if (kind === 'ul' || kind === 'ol' || kind === 'task') {
    let end = index
    while (end + 1 < n) {
      const next = line(end + 1)
      if (LIST_ITEM_RE.test(next) || (next.trim() !== '' && /^\s+\S/.test(next))) end++
      else break
    }
    return { start: index, end }
  }
  // 单行块（标题 / 段落 / hr / 等）
  return { start: index, end: index }
}

/** 删除 [start, end] 区间（含端点）的块，返回新行数组 */
export function deleteBlock(lines: string[], range: BlockRange): string[] {
  const next = lines.slice()
  next.splice(range.start, range.end - range.start + 1)
  return next
}

/** 取出块的 Markdown 源串（用于复制到剪贴板） */
export function copyBlock(lines: string[], range: BlockRange): string {
  return lines.slice(range.start, range.end + 1).join('\n')
}

/**
 * 对区间内的每一行统一加减前导空格（delta>0 右缩进，delta<0 左缩进）。
 * 空行不缩进；左缩进时最多去掉 |delta| 个空格，避免越过上一行。
 */
export function indentBlock(lines: string[], range: BlockRange, delta: number): string[] {
  if (!Number.isFinite(delta) || delta === 0) return lines.slice()
  return lines.map((l, i) => {
    if (i < range.start || i > range.end) return l
    if (l.trim() === '') return l
    if (delta > 0) return ' '.repeat(delta) + l
    const cur = /^(\s*)/.exec(l)?.[1].length ?? 0
    const remove = Math.min(cur, -delta)
    return l.slice(remove)
  })
}

/**
 * 在第 index 行之后插入模板（在模板前补一个空行，保证与上文块分隔）。
 * 返回新行数组。
 */
export function insertBelow(lines: string[], index: number, tpl: string[]): string[] {
  const next = lines.slice()
  const at = Math.min(Math.max(index + 1, 0), next.length)
  // 若上文不是空行，先补一个空行做分隔；模板自身为空时直接跳过
  const needGap = at > 0 && next[at - 1].trim() !== ''
  const addition = needGap ? ['', ...tpl] : tpl
  next.splice(at, 0, ...addition)
  return next
}

/** 提取块内纯文本（去掉块标记 / 围栏 / details 标签），用于「转化为」目标为单行块类型 */
function extractBlockText(lines: string[], range: BlockRange): string {
  const block = lines.slice(range.start, range.end + 1)
  if (block.length === 0) return ''
  const firstKind = detectBlockKind(block[0] ?? '')
  if (firstKind === 'code') {
    return block.filter((l) => !/^\s*```|^\s*~~~/i.test(l.trim())).join('\n').trim()
  }
  if (firstKind === 'details') {
    return block
      .filter((l) => !/^\s*<\/?details>/i.test(l.trim()))
      .map((l) => l.replace(/^\s*<summary>(.*)<\/summary>\s*$/i, '$1'))
      .join('\n')
      .trim()
  }
  return block.map((l) => stripBlockPrefix(l)).join('\n').replace(/^\n+|\n+$/g, '').trim()
}

/**
 * 把整块转换为目标块类型，返回转换后的多行结果。
 * 对多行块（代码 / 表格 / details / callout）也能正确提取正文后重建。
 */
export function convertBlock(lines: string[], range: BlockRange, kind: BlockKind): string[] {
  const text = extractBlockText(lines, range) || ''
  const rows = text.split('\n').filter((l) => l.trim() !== '')
  switch (kind) {
    case 'code':
      return ['```', text, '```']
    case 'details':
      return ['<details>', '<summary>折叠块</summary>', '', text || '内容', '</details>']
    case 'callout':
      // 空内容只保留 `> 💡 ` 前缀，不写「提示内容」字样
      return [text ? `> 💡 ${text.replace(/\s*\n\s*/g, ' ')}` : '> 💡 ']
    case 'quote':
      // 空内容只保留 `> ` 前缀，不写「引用内容」字样；非空则逐行加 > 前缀
      return rows.length ? rows.map((l) => `> ${l}`) : ['> ']
    case 'ul':
      // 空内容只保留 `- ` 前缀，不写「列表项」字样
      return rows.length ? rows.map((l) => `- ${l}`) : ['- ']
    case 'ol':
      // 空内容只保留 `1. ` 前缀，不写「列表项」字样
      return rows.length ? rows.map((l, i) => `${i + 1}. ${l}`) : ['1. ']
    case 'task':
      // 空内容只保留 `- [ ] ` 前缀，不写「列表项」字样
      return rows.length ? rows.map((l) => `- [ ] ${l}`) : ['- [ ] ']
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(kind.slice(1))
      const head = '#'.repeat(level)
      // 空内容只保留 `## ` 前缀（合法空标题），绝不写入「标题」字样
      return [text ? `${head} ${text.replace(/\s*\n\s*/g, ' ')}` : `${head} `]
    }
    case 'paragraph':
    default:
      // 空块转正文时返回空行，绝不写入「正文」字样
      return [text]
  }
}

/**
 * 在单行文本中对选中片段施加行内样式（加粗 / 代码 / 高亮等）。
 * 已包裹时取消该样式（与所见即所得「再点一次取消」一致）；未命中选中片段则原样返回。
 */
export function wrapSelection(line: string, selected: string, style: InlineStyle): string {
  if (!selected) return line
  const [open, close] = INLINE_WRAPPERS[style]
  const idx = line.indexOf(selected)
  if (idx < 0) return line
  // 已包裹 → 去掉
  if (line.slice(0, idx).endsWith(open) && line.slice(idx + selected.length).startsWith(close)) {
    return line.slice(0, idx - open.length) + selected + line.slice(idx + selected.length + close.length)
  }
  return line.slice(0, idx) + open + selected + close + line.slice(idx + selected.length)
}
