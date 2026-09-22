// Markdown（Vditor IR 模式）右键上下文菜单的命令层。
//
// 三类上下文：
//   - line  （标题/正文/空白行）：样式（H1~H3/正文/引用/无序/有序列表）、插入（表格/图片/链接/分割线/时序图/流程图）、删除行
//   - selection（选中文字）：加粗/斜体/删除线/下划线/行内代码/代码块
//   - table（表格内单元格）：上/下插行、左/右插列、删本行、删本列
//
// ── 为什么块级改写走「markdown 级」而不是 DOM 手术 ──
// 早期实现是「选中整块 → deleteValue() → insertMD(新 md)」。实测在 IR 模式下会错位：
// execCommand('delete') 后光标落点由浏览器决定，再把新块 insertMD 回去时，
// 新内容会与相邻块的 marker 混在一起（实测把「正文」和下一行标题的文本互换、甚至吃掉后续块）。
// 现在改成确定性做法：
//   1) `lute.VditorIRDOM2Md` 把正文容器整体转成 markdown，并**逐块**转出每个顶层 block 的 markdown 片段；
//   2) 按片段在大文档里的顺序位置做**定向替换 / 插入**（ordered splice），得到新的整篇 markdown；
//   3) `vd.setValue(新 markdown)` 一次写回，由 Vditor 自己重新解析渲染。
// ⚠️ setValue 走 `processAfterRender({enableInput:false})`，**不会触发 input 回调** →
//    调用方（VditorEditor）必须在写回后自行更新本地副本并触发自动保存（见 markChanged）。
//
// ⚠️ 「当前行」必须在**右键那一刻**按坐标解析并记下 block 序号（见 resolveContext）：
//    右键浮层是 position:fixed 且正好盖在鼠标处，点菜单项时 `caretRangeFromPoint` 会命中浮层而不是正文。
//
// 行内元素（图片/链接）仍用 Vditor 原生的 insertMD —— 它们作用于光标，行为已经正确。
// 选区格式化（加粗/斜体/删除线/下划线/行内代码/代码块）也走 markdown 级包裹，
// 但必须先过 CommonMark 侧翼守卫（见 applySelectionOp 上方的注释），否则会产生字面星号。

import type Vditor from 'vditor'

/* ---------------------------------- 内部工具 ---------------------------------- */

/** 选区（selection 菜单场景）在菜单点击前会被编辑器失焦清掉，故打开菜单时暂存，应用时还原 */
let savedSelection: Range | null = null

/** Vditor 实例上本模块用到的（公开/非公开）方法面 */
type VdApi = {
  focus?: () => void
  insertMD?: (md: string) => void
  vditor?: {
    ir?: { element?: HTMLElement }
    lute?: { VditorIRDOM2Md?: (html: string) => string }
  }
}

function api(vd: Vditor): VdApi {
  return vd as unknown as VdApi
}

/** 取 IR 正文容器（.vditor-reset） */
function irElement(vd: Vditor): HTMLElement | null {
  const ir = api(vd).vditor?.ir
  if (ir?.element) return ir.element
  return (document.querySelector('.vditor-ir .vditor-reset') as HTMLElement) || null
}

/** IR DOM → Markdown（Lute 提供；Vditor 自身的复制功能用的同一条路径） */
function domToMd(vd: Vditor, html: string): string | null {
  const fn = api(vd).vditor?.lute?.VditorIRDOM2Md
  return typeof fn === 'function' ? fn(html) : null
}

/** 聚焦编辑器（insertMD / execCommand 生效的前提） */
function focusEditor(vd: Vditor): void {
  api(vd).focus?.()
}

/** 浏览器兼容的「点命中 caret」 */
function caretRangeFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as unknown as {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  return null
}

/** 把 caret 落到点命中的位置（右键先确定当前光标位置） */
function dropCaretAtPoint(x: number, y: number): void {
  const c = caretRangeFromPoint(x, y)
  if (!c) return
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  try {
    r.setStart(c.node, c.offset)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  } catch {
    /* 越界等忽略 */
  }
}

/** 点命中位置所属的顶层 block 序号（reset 的直属子元素） */
function blockIndexOfNode(reset: HTMLElement, node: Node): number {
  let n: Node | null = node
  if (n && n.nodeType === 3) n = n.parentNode
  while (n && n.parentNode && n.parentNode !== reset) n = n.parentNode
  if (!n || n === reset || !reset.contains(n)) return -1
  return Array.prototype.indexOf.call(reset.children, n)
}

/** 点命中位置的顶层 block（reset 的直属子元素） */
function currentBlock(reset: HTMLElement, x: number, y: number): HTMLElement | null {
  const c = caretRangeFromPoint(x, y)
  if (!c) return null
  let node: Node | null = c.node
  if (node && node.nodeType === 3) node = node.parentNode
  while (node && node.parentNode && node.parentNode !== reset) node = node.parentNode
  if (!node || node === reset || !reset.contains(node)) return null
  return (node as HTMLElement) || null
}

/** 还原 selection 菜单暂存的选区 */
function restoreSelection(): void {
  if (!savedSelection) return
  const sel = window.getSelection()
  try {
    sel?.removeAllRanges()
    sel?.addRange(savedSelection)
  } catch {
    /* 失效忽略 */
  }
}

/** 用 selection 文本包前后缀（行内代码 / 代码块）。调用前需还原选区 */
function wrapSelection(before: string, after: string = before): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
  const text = sel.toString()
  document.execCommand('insertText', false, before + text + after)
}

/* ------------------------------- markdown 级改写 ------------------------------- */

interface DocParts {
  /** 整篇 markdown */
  full: string
  /** 每个顶层 block 的 markdown 片段（与 reset.children 一一对应、顺序一致） */
  parts: string[]
}

/** 逐块转出 markdown，便于按块定位 */
function docParts(vd: Vditor): DocParts | null {
  const reset = irElement(vd)
  if (!reset) return null
  const full = domToMd(vd, reset.innerHTML)
  if (full == null) return null
  const parts: string[] = []
  for (const child of Array.from(reset.children)) {
    const wrap = document.createElement('div')
    wrap.appendChild(child.cloneNode(true))
    parts.push(domToMd(vd, wrap.innerHTML) ?? '')
  }
  return { full, parts }
}

/** 依次在 full 里定位各片段，返回每个片段的起始下标（找不到返回 null） */
function locateParts(full: string, parts: string[]): number[] | null {
  const pos: number[] = []
  let cursor = 0
  for (const p of parts) {
    if (p === '') {
      pos.push(cursor)
      continue
    }
    const at = full.indexOf(p, cursor)
    if (at < 0) return null
    pos.push(at)
    cursor = at + p.length
  }
  return pos
}

/** 把第 index 个片段替换成 newPart（newPart 为空串即删除该块） */
function spliceReplace(full: string, parts: string[], index: number, newPart: string): string | null {
  const pos = locateParts(full, parts)
  if (!pos) return null
  const start = pos[index]
  const end = start + parts[index].length
  if (newPart !== '') return full.slice(0, start) + newPart + full.slice(end)
  // 删除：把衔接处的多余空行收成一段
  const before = full.slice(0, start).replace(/\n+$/, '')
  const after = full.slice(end).replace(/^\n+/, '')
  if (before === '') return after
  if (after === '') return before
  return `${before}\n\n${after}`
}

/** 在第 index 个片段之后插入 newPart */
function spliceInsert(full: string, parts: string[], index: number, newPart: string): string | null {
  const pos = locateParts(full, parts)
  if (!pos) return null
  const at = pos[index] + parts[index].length
  const before = full.slice(0, at)
  const after = full.slice(at)
  if (after.trim() === '') return `${before}\n\n${newPart}\n`
  return `${before}\n\n${newPart}${after.startsWith('\n') ? '' : '\n\n'}${after}`
}

/** 去掉每行行首的块级标记（标题 / 引用 / 列表 / 有序列表） */
const BLOCK_MARK_RE = /^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/

function stripBlockMarks(md: string): string[] {
  return md.split('\n').map((l) => l.replace(BLOCK_MARK_RE, ''))
}

/** 把 block 序号定位到当前 markdown（越界返回 null） */
function partsAt(vd: Vditor, index: number | undefined): (DocParts & { index: number }) | null {
  if (index == null || index < 0) return null
  const info = docParts(vd)
  if (!info || index >= info.parts.length) return null
  return { ...info, index }
}

/* ---------------------------------- 行/块操作 ---------------------------------- */

export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'ul' | 'ol'

const BLOCK_PREFIX: Record<BlockType, string> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  p: '',
  quote: '> ',
  ul: '- ',
  ol: '1. ',
}

/** 把一段 markdown 改写成目标块类型（列表/引用逐行加标记，标题/正文只改首个非空行） */
function restyle(md: string, type: BlockType): string {
  const lines = stripBlockMarks(md)
  if (type === 'quote' || type === 'ul' || type === 'ol') {
    const prefix = BLOCK_PREFIX[type]
    return lines.map((l) => (l.trim() === '' ? l : prefix + l)).join('\n')
  }
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first < 0) return md
  lines[first] = BLOCK_PREFIX[type] + lines[first]
  return lines.join('\n')
}

/**
 * 设置当前行的样式（H1~H3/正文/引用/列表）。
 * @returns 新的整篇 markdown；null 表示无法处理（调用方不做写回）
 */
export function setBlockType(vd: Vditor, blockIndex: number | undefined, type: BlockType): string | null {
  const info = partsAt(vd, blockIndex)
  if (!info) return null
  const next = restyle(info.parts[info.index], type)
  return spliceReplace(info.full, info.parts, info.index, next)
}

/** 删除当前行 */
export function deleteLine(vd: Vditor, blockIndex: number | undefined): string | null {
  const info = partsAt(vd, blockIndex)
  if (!info) return null
  return spliceReplace(info.full, info.parts, info.index, '')
}

/* ---------------------------------- 插入操作 ---------------------------------- */

export type InsertKind = 'table' | 'image' | 'link' | 'hr' | 'seq' | 'flow'

/** 块级插入（作为独立块，插在当前行之后） */
const INSERT_BLOCK_MD: Record<'table' | 'hr' | 'seq' | 'flow', string> = {
  table: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 单元格 | 单元格 | 单元格 |\n| 单元格 | 单元格 | 单元格 |',
  hr: '---',
  seq: '```mermaid\nsequenceDiagram\n    participant A as 用户\n    participant B as 系统\n    A->>B: 请求\n    B-->>A: 响应\n```',
  flow: '```mermaid\nflowchart TD\n    A[开始] --> B{判断}\n    B -->|是| C[处理]\n    B -->|否| D[结束]\n```',
}

/** 行内插入（插在光标处） */
const INSERT_INLINE_MD: Record<'image' | 'link', string> = {
  image: '![图片描述](图片URL)',
  link: '[链接文字](https://)',
}

/**
 * 插入内容。
 *  - 表格 / 分割线 / 时序图 / 流程图 → 作为独立块插在当前行之后（markdown 级 splice）
 *  - 图片 / 链接 → 行内元素，插在光标处（Vditor 原生 insertMD，作用于已落下的 caret）
 * @returns 需要写回的新 markdown；null 表示已由 insertMD 直接改动 DOM（或无法处理）
 */
export function insertContent(vd: Vditor, kind: InsertKind, blockIndex: number | undefined): string | null {
  if (kind === 'image' || kind === 'link') {
    focusEditor(vd)
    api(vd).insertMD?.(INSERT_INLINE_MD[kind])
    return null
  }
  const info = partsAt(vd, blockIndex)
  if (!info) return null
  return spliceInsert(info.full, info.parts, info.index, INSERT_BLOCK_MD[kind])
}

/* ---------------------------------- 选区操作 ---------------------------------- */

export type SelectionOp = 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'codeblock'

/**
 * 选区格式化的 markdown 标记。
 * 走 markdown 级改写而不是 execCommand：IR 模式在选区变化时会重渲染块内 marker，
 * 右键时暂存的 Range 到点菜单项时往往已脱离文档，`addRange` 静默失败 → execCommand 作用在塌缩光标上，
 * 表现为「点了加粗没有任何变化」。这里改为在选中文字所属块的 markdown 里定位该文本并包裹标记。
 */
const SELECTION_MARK: Record<Exclude<SelectionOp, 'codeblock'>, (t: string) => string> = {
  bold: (t) => `**${t}**`,
  italic: (t) => `*${t}*`,
  strike: (t) => `~~${t}~~`,
  underline: (t) => `<u>${t}</u>`,
  code: (t) => `\`${t}\``,
}

/* ------------------------------- CommonMark 侧翼守卫 -------------------------------
 * ⚠️ 铁律：`**` 不是「随便包起来就生效」的。
 * `**正文段落一。**第二句在这里。` 里的闭合 `**` 前面是标点 `。`、后面紧跟文字 `第`，
 * 不满足 CommonMark 的「右侧侧翼（right-flanking）」条件 → Lute 拒绝把它当闭合标记，
 * 文档里直接留下**字面星号**（无头 Chrome 实测：该写法编辑态 strong=0、读态也不加粗；
 * 而 `**正文段落一**。第二句在这里。` 编辑态 strong=1、读态 `<strong>` 正常）。
 * 左侧同理：`正文段落一**。第二**句` 的起始 `**` 前面是文字、后面是标点 → 左侧侧翼不成立，也不加粗。
 * 所以包裹前先把「开头/结尾处会破坏侧翼的标点或空白」挪到标记外侧。
 * 注意：反引号（行内代码 / 代码块）不受侧翼规则约束，不需要收窄；`<u>` 走 HTML 也不需要。 */
const PUNCT_RE = /[\p{P}\p{S}]/u

function isWsChar(ch: string): boolean {
  return ch === '' || /\s/.test(ch)
}

function isPunctChar(ch: string): boolean {
  return ch !== '' && PUNCT_RE.test(ch)
}

/** 起始标记能否开启强调（左侧侧翼） */
function canOpen(ch: string, before: string): boolean {
  if (isWsChar(ch)) return false
  return !isPunctChar(ch) || isWsChar(before) || isPunctChar(before)
}

/** 结束标记能否闭合强调（右侧侧翼） */
function canClose(ch: string, after: string): boolean {
  if (isWsChar(ch)) return false
  return !isPunctChar(ch) || isWsChar(after) || isPunctChar(after)
}

/** 把 [start, end) 收窄到能安全包裹的区间（已无可包裹内容返回 null） */
function emphasizeRange(part: string, start: number, end: number): [number, number] | null {
  let s = start
  let e = end
  while (s < e && !canOpen(part[s], s > 0 ? part[s - 1] : '')) s++
  while (e > s && !canClose(part[e - 1], e < part.length ? part[e] : '')) e--
  return e > s ? [s, e] : null
}

/**
 * 对选中文字做格式化。
 * @returns 新的整篇 markdown；null 表示 markdown 级改写不可用（调用方退回 DOM execCommand 路径）
 */
export function applySelectionOp(
  vd: Vditor,
  op: SelectionOp,
  selText: string,
  blockIndex: number | undefined,
): string | null {
  const raw = selText ?? ''
  if (raw === '') return null
  const info = partsAt(vd, blockIndex)
  if (!info) return null
  const part = info.parts[info.index] ?? ''
  // 原样优先，其次去掉首尾空白（选区常带出块尾的空白）
  const target = part.includes(raw) ? raw : raw.trim()
  if (target === '') return null
  const at = part.indexOf(target)
  if (at < 0) return null

  let start = at
  let end = at + target.length
  if (op === 'bold' || op === 'italic' || op === 'strike') {
    const range = emphasizeRange(part, start, end)
    // 选区里没有可包裹的实义字符（纯标点/空白）→ 原样返回，不做无意义的写入
    if (!range) return info.full
    ;[start, end] = range
  }

  const head = part.slice(0, start)
  const rest = part.slice(end)
  const inner = part.slice(start, end)

  if (op === 'codeblock') {
    // 围栏必须独占一行：与前文同挤一行时先断行，与后文同挤一行时补换行，
    // 否则闭合围栏 ` ```第二句… ` 不成立，代码块会把后续内容一并吞掉。
    const pre = head !== '' && !head.endsWith('\n') ? '\n\n' : ''
    const post = rest !== '' && !rest.startsWith('\n') ? '\n' : ''
    return spliceReplace(info.full, info.parts, info.index, `${head}${pre}\`\`\`\n${inner}\n\`\`\`${post}${rest}`)
  }

  const next = `${head}${SELECTION_MARK[op](inner)}${rest}`
  return spliceReplace(info.full, info.parts, info.index, next)
}

/** DOM 兜底：按暂存选区执行 execCommand（markdown 级改写失败时使用） */
export function applySelectionOpDom(vd: Vditor, op: SelectionOp): void {
  focusEditor(vd)
  restoreSelection()
  switch (op) {
    case 'bold':
      document.execCommand('bold')
      break
    case 'italic':
      document.execCommand('italic')
      break
    case 'strike':
      document.execCommand('strikeThrough')
      break
    case 'underline':
      document.execCommand('underline')
      break
    case 'code':
      wrapSelection('`')
      break
    case 'codeblock':
      wrapSelection('```\n', '\n```')
      break
  }
  focusEditor(vd)
}

/* ---------------------------------- 表格操作 ---------------------------------- */

function cellsOf(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

function lineOf(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

/**
 * 表格内以当前单元格为中心做行列增删。
 * 源表格行序：header(0) / separator(1) / data(2..)；tbody 第 i 行 → 源行 2+i。
 */
export function tableOp(vd: Vditor, td: HTMLTableCellElement, kind: TableOp): string | null {
  const reset = irElement(vd)
  if (!reset) return null
  const tr = td.closest('tr')
  const tableEl = td.closest('table')
  if (!tr || !tableEl) return null

  let blockEl: Node = tableEl
  while (blockEl.parentNode && blockEl.parentNode !== reset) blockEl = blockEl.parentNode
  const blockIndex = Array.prototype.indexOf.call(reset.children, blockEl)
  const info = partsAt(vd, blockIndex)
  if (!info) return null

  const thead = tableEl.querySelector('thead')
  const tbody = tableEl.querySelector('tbody')
  let srcRow: number
  if (thead && thead.contains(tr)) {
    srcRow = 0
  } else if (tbody) {
    const idx = Array.from(tbody.querySelectorAll('tr')).indexOf(tr as HTMLTableRowElement)
    srcRow = 2 + (idx < 0 ? 0 : idx)
  } else {
    srcRow = Array.from(tableEl.querySelectorAll('tr')).indexOf(tr as HTMLTableRowElement)
  }
  const colIndex = Array.from(tr.children).indexOf(td as HTMLTableCellElement)

  const lines = info.parts[info.index]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  if (lines.length < 2) return null

  const emptyRow = (n: number) => `|${Array(n).fill(' ').join('|')}|`
  const colCount = cellsOf(lines[0]).length

  switch (kind) {
    case 'row-up':
      lines.splice(srcRow, 0, emptyRow(colCount))
      break
    case 'row-down':
      lines.splice(srcRow + 1, 0, emptyRow(colCount))
      break
    case 'row-del':
      lines.splice(srcRow, 1)
      break
    case 'col-left':
    case 'col-right': {
      const p = kind === 'col-left' ? colIndex : colIndex + 1
      for (let i = 0; i < lines.length; i++) {
        const cells = cellsOf(lines[i])
        cells.splice(p, 0, i === 1 ? '---' : ' ')
        lines[i] = lineOf(cells)
      }
      break
    }
    case 'col-del': {
      for (let i = 0; i < lines.length; i++) {
        const cells = cellsOf(lines[i])
        cells.splice(colIndex, 1)
        lines[i] = lineOf(cells)
      }
      break
    }
  }
  if (lines.length < 2) return null
  return spliceReplace(info.full, info.parts, info.index, lines.join('\n'))
}

export type TableOp = 'row-up' | 'row-down' | 'row-del' | 'col-left' | 'col-right' | 'col-del'

/* ---------------------------------- 上下文判定 ---------------------------------- */

export type CtxKind = 'line' | 'selection' | 'table'
export interface CtxState {
  kind: CtxKind
  x: number
  y: number
  /** line/selection/table 上下文：右键命中的顶层 block 序号（点菜单时按此定位，不再按坐标解析） */
  blockIndex?: number
  /** selection 上下文：右键那一刻选中的文本 */
  selText?: string
  /** table 上下文：右键命中的单元格 */
  td?: HTMLTableCellElement
}

/**
 * 在编辑器区域右键时调用：判定上下文、暂存选区文本、记下目标 block 序号。
 *  - 已有非折叠选区且右键落在选区内 → selection（不移动 caret）
 *  - 否则落下 caret；若命中表格单元格 → table；否则 → line
 */
export function resolveContext(vd: Vditor, x: number, y: number): CtxState | null {
  const reset = irElement(vd)
  const target = document.elementFromPoint(x, y)
  const sel = window.getSelection()
  const hasSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0
  if (hasSel && target && sel!.containsNode(target, true)) {
    let selText = ''
    let blockIndex = -1
    try {
      const r0 = sel!.getRangeAt(0)
      savedSelection = r0.cloneRange()
      selText = sel!.toString()
      if (reset) blockIndex = blockIndexOfNode(reset, r0.startContainer)
    } catch {
      savedSelection = null
    }
    return { kind: 'selection', x, y, selText, blockIndex: blockIndex >= 0 ? blockIndex : undefined }
  }
  savedSelection = null
  dropCaretAtPoint(x, y)
  if (target && target.closest('.vditor-ir table')) {
    const td = target.closest('td,th') as HTMLTableCellElement | null
    return {
      kind: 'table',
      x,
      y,
      td: td ?? undefined,
      blockIndex: reset && td ? Math.max(0, blockIndexOfNode(reset, td.closest('table')!)) : undefined,
    }
  }
  const block = reset ? currentBlock(reset, x, y) : null
  const blockIndex = block && reset ? Array.prototype.indexOf.call(reset.children, block) : -1
  return { kind: 'line', x, y, blockIndex: blockIndex >= 0 ? blockIndex : undefined }
}
