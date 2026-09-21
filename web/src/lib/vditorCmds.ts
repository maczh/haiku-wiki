// Markdown（Vditor IR 模式）右键上下文菜单的命令层。
//
// 三类上下文：
//   - line  （标题/正文/空白行）：样式（H1~H3/正文/引用/无序/有序列表）、插入（表格/图片/链接/分割线/时序图/流程图）、删除行
//   - selection（选中文字）：加粗/斜体/删除线/下划线/行内代码/代码块
//   - table（表格内单元格）：上/下插行、左/右插列、删本行、删本列
//
// 关键约束（见项目 memory 的 Vditor IR DOM 铁律）：
//   · 正文是 `.vditor-ir .vditor-reset`；IR 把 block marker（# / > / - 等）渲染成 `.vditor-ir__marker` 可见 span；
//   · 因此「当前行」= 右键点命中的顶层 block（reset 的直属子元素）；
//   · block 类型变换走「选中整块 → deleteValue → insertMD(新 markdown)」，复用 Vditor 自身的 markdown→IR 渲染，
//     避免手工拼 IR DOM 导致与版本强耦合。
//   · 表格增删行列直接操作该 block 的 markdown（VditorIRDOM2Md 单独转换后再放回），保证与渲染一致。

import type Vditor from 'vditor'

/* ---------------------------------- 内部工具 ---------------------------------- */

/** 选区（selection 菜单场景）在菜单点击前会被编辑器失焦清掉，故打开菜单时暂存，应用时还原 */
let savedSelection: Range | null = null

/** 取 IR 正文容器（.vditor-reset） */
function irElement(vd: Vditor): HTMLElement | null {
  const ir = (vd as unknown as { vditor?: { ir?: { element?: HTMLElement } } }).vditor?.ir
  if (ir?.element) return ir.element
  return (document.querySelector('.vditor-ir .vditor-reset') as HTMLElement) || null
}

/** 取 Lute 的 IR→Markdown 转换器 */
function lute(vd: Vditor): { VditorIRDOM2Md: (html: string) => string } | null {
  return ((vd as unknown as { vditor?: { lute?: { VditorIRDOM2Md: (h: string) => string } } }).vditor?.lute as never) || null
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

/** 点命中位置的顶层 block（reset 的直属子元素） */
function currentBlock(reset: HTMLElement, x: number, y: number): HTMLElement | null {
  const c = caretRangeFromPoint(x, y)
  if (!c) return null
  let node: Node | null = c.node
  if (node && node.nodeType === 3) node = node.parentNode
  while (node && node.parentNode && node.parentNode !== reset) node = node.parentNode
  return (node as HTMLElement) || null
}

/** 去掉 block 的 IR marker，得到正文文本 */
function blockCoreText(block: HTMLElement): string {
  const clone = block.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.vditor-ir__marker').forEach((e) => e.remove())
  return (clone.textContent ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** 选中整块并删除（供 block 替换 / 删除行使用） */
function selectAndDelete(vd: Vditor, block: HTMLElement): void {
  const sel = window.getSelection()
  const r = document.createRange()
  r.selectNode(block)
  sel?.removeAllRanges()
  sel?.addRange(r)
  const api = vd as unknown as { deleteValue?: () => void; focus?: () => void }
  api.deleteValue?.()
  api.focus?.()
}

/** 用新 markdown 替换整块（删旧 → 插新） */
function replaceBlock(vd: Vditor, block: HTMLElement, md: string): void {
  selectAndDelete(vd, block)
  const api = vd as unknown as { insertMD?: (md: string) => void; focus?: () => void }
  api.focus?.()
  api.insertMD?.(md)
}

/** 在 caret 处插入 markdown（插入类菜单） */
function insertAtCursor(vd: Vditor, md: string): void {
  const api = vd as unknown as { focus?: () => void; insertMD?: (md: string) => void }
  api.focus?.()
  api.insertMD?.(md)
}

/** 用 selection 文本包前后缀（行内代码 / 代码块）。调用前需还原选区 */
function wrapSelection(before: string, after: string = before): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
  const text = sel.toString()
  document.execCommand('insertText', false, before + text + after)
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

/* ---------------------------------- 行/块操作 ---------------------------------- */

export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'ul' | 'ol'

const BLOCK_MD: Record<BlockType, (t: string) => string> = {
  h1: (t) => `# ${t}`,
  h2: (t) => `## ${t}`,
  h3: (t) => `### ${t}`,
  p: (t) => t,
  quote: (t) => `> ${t}`,
  ul: (t) => `- ${t}`,
  ol: (t) => `1. ${t}`,
}

/** 设置当前 block 的样式（H1~H3/正文/引用/列表） */
export function setBlockType(vd: Vditor, x: number, y: number, type: BlockType): void {
  const reset = irElement(vd)
  if (!reset) return
  dropCaretAtPoint(x, y)
  const block = currentBlock(reset, x, y)
  if (!block) return
  const md = BLOCK_MD[type](blockCoreText(block))
  replaceBlock(vd, block, md)
}

/** 删除当前行 */
export function deleteLine(vd: Vditor, x: number, y: number): void {
  const reset = irElement(vd)
  if (!reset) return
  dropCaretAtPoint(x, y)
  const block = currentBlock(reset, x, y)
  if (!block) return
  selectAndDelete(vd, block)
}

/* ---------------------------------- 插入操作 ---------------------------------- */

const SAMPLE_TABLE = `| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 单元格 | 单元格 | 单元格 |\n| 单元格 | 单元格 | 单元格 |`

const SEQ_MD = '```mermaid\nsequenceDiagram\n    participant A as 用户\n    participant B as 系统\n    A->>B: 请求\n    B-->>A: 响应\n```'

const FLOW_MD = '```mermaid\nflowchart TD\n    A[开始] --> B{判断}\n    B -->|是| C[处理]\n    B -->|否| D[结束]\n```'

export function insertContent(vd: Vditor, kind: 'table' | 'image' | 'link' | 'hr' | 'seq' | 'flow'): void {
  switch (kind) {
    case 'table':
      insertAtCursor(vd, SAMPLE_TABLE)
      break
    case 'image':
      insertAtCursor(vd, '![图片描述](图片URL)')
      break
    case 'link':
      insertAtCursor(vd, '[链接文字](https://)')
      break
    case 'hr':
      insertAtCursor(vd, '\n\n---\n\n')
      break
    case 'seq':
      insertAtCursor(vd, SEQ_MD)
      break
    case 'flow':
      insertAtCursor(vd, FLOW_MD)
      break
  }
}

/* ---------------------------------- 选区操作 ---------------------------------- */

export type SelectionOp = 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'codeblock'

export function applySelectionOp(vd: Vditor, op: SelectionOp): void {
  const api = vd as unknown as { focus?: () => void }
  api.focus?.()
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
  api.focus?.()
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
export function tableOp(vd: Vditor, td: HTMLTableCellElement, kind: TableOp): void {
  const reset = irElement(vd)
  if (!reset) return
  const tr = td.closest('tr')
  const tableEl = td.closest('table')
  if (!tr || !tableEl) return

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

  // 取出该 table block 的 markdown（单独转换，避免受文档其它内容干扰）
  let block: Node | null = tableEl
  while (block.parentNode && block.parentNode !== reset) block = block.parentNode
  const wrapper = document.createElement('div')
  wrapper.className = 'vditor-reset'
  wrapper.appendChild((block as HTMLElement).cloneNode(true))
  const lt = lute(vd)
  if (!lt) return
  const md = lt.VditorIRDOM2Md(wrapper.innerHTML)
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  if (lines.length < 2) return

  const emptyRow = (n: number) => `| ${Array(n).fill(' ').join(' | ')} |`
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
        cells.splice(p, 0, i === 1 ? '---' : '')
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
  if (lines.length < 2) return
  replaceBlock(vd, block as HTMLElement, lines.join('\n'))
}

export type TableOp = 'row-up' | 'row-down' | 'row-del' | 'col-left' | 'col-right' | 'col-del'

/* ---------------------------------- 上下文判定 ---------------------------------- */

export type CtxKind = 'line' | 'selection' | 'table'
export interface CtxState {
  kind: CtxKind
  x: number
  y: number
  td?: HTMLTableCellElement
}

/**
 * 在编辑器区域右键时调用：判定上下文并暂存选区。
 *  - 已有非折叠选区且右键落在选区内 → selection（保留选区，不移动 caret）
 *  - 否则落下 caret；若命中表格单元格 → table；否则 → line
 */
export function resolveContext(vd: Vditor, x: number, y: number): CtxState | null {
  const target = document.elementFromPoint(x, y)
  const sel = window.getSelection()
  const hasSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0
  if (hasSel && target && sel!.containsNode(target, true)) {
    try {
      savedSelection = sel!.getRangeAt(0).cloneRange()
    } catch {
      savedSelection = null
    }
    return { kind: 'selection', x, y }
  }
  savedSelection = null
  dropCaretAtPoint(x, y)
  const inTable = !!(target && target.closest('.vditor-ir table'))
  if (inTable) {
    const td = (target!.closest('td,th') as HTMLTableCellElement) || null
    return { kind: 'table', x, y, td: td ?? undefined }
  }
  return { kind: 'line', x, y }
}
