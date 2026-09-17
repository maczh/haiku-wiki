// 块级操作的纯逻辑层：Markdown 行 ⇄ 块类型转换、插入模板、行内样式包装。
//
// 为什么以「Markdown 源文本」为操作对象，而不是直接改 DOM：
//   · Vditor 的 IR 模式把内容同时维护成 DOM 与 Markdown 两份，直接改 DOM 会被它自己的
//     输入事件覆盖或产生不一致；
//   · IR 模式下每个顶层块的 `data-block` 属性就是它在源码里的行号，所以
//     「第 N 行 → 第 N 个块」是可逆的，用文本变换最稳。
//   · 文本变换可单测，不依赖浏览器。

/** 可识别的块类型（与 Markdown 语法一一对应） */
export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'code'
  | 'hr'
  | 'table'

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
  if (/^>\s?/.test(t)) return 'quote'
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

/** 空列表项等内容占位文案 */
const LIST_PLACEHOLDER = '列表项'
const QUOTE_PLACEHOLDER = '引用内容'

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
    case 'h4': {
      const level = Number(kind.slice(1))
      return `${indent}${'#'.repeat(level)} ${text || '标题'}`
    }
    case 'ul':
      return `${indent}- ${text || LIST_PLACEHOLDER}`
    case 'ol':
      return `${indent}1. ${text || LIST_PLACEHOLDER}`
    case 'task':
      return `${indent}- [ ] ${text || LIST_PLACEHOLDER}`
    case 'quote':
      // 引用可能多行：逐行加 > 前缀，空行保留为孤立 >
      return text
        ? text
            .split('\n')
            .map((l) => `${indent}> ${l}`)
            .join('\n')
        : `${indent}> ${QUOTE_PLACEHOLDER}`
    case 'code':
      // 已经是代码块就不再套一层（避免 ``` 嵌套）
      if (detectBlockKind(line) === 'code') return line
      return '```\n' + (text || '') + '\n```'
    case 'hr':
      return `${indent}---`
    case 'table':
      if (detectBlockKind(line) === 'table') return line
      return `${indent}| 列 1 | 列 2 |\n${indent}| --- | --- |\n${indent}| ${text || ' '} |  |`
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
