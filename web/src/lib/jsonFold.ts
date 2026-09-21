/**
 * JSON 对象折叠渲染器（纯 DOM，无 React 依赖）。
 *
 * 用途：
 *  - 阅读视图 MarkdownView 在 Vditor.preview 之后做 DOM 后处理，把 `language-json`
 *    代码块替换为可折叠的 JSON 树；
 *  - 接口文档（ApiEditor）的返回结果 / 返回结果示例 / 请求体（折叠预览）复用同一渲染。
 *
 * 折叠语义：对象 `{...}` 与数组 `[...]` 前有一个 ▾ 切换按钮，点击折叠其子节点并显示
 * `{…} (N)` 概览；叶子（字符串/数字/布尔/null）不可折叠。切换只改 class，不修改数据。
 */

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function typeClass(v: unknown): string {
  if (v === null) return 'jk-null'
  switch (typeof v) {
    case 'string':
      return 'jk-string'
    case 'number':
      return 'jk-number'
    case 'boolean':
      return 'jk-boolean'
    default:
      return 'jk-other'
  }
}

function formatPrimitive(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v) // 带引号
  return String(v)
}

function buildNode(value: unknown, keyLabel?: string): HTMLElement {
  const node = el('div', 'hk-jsonfold-node')
  if (keyLabel !== undefined) node.appendChild(el('span', 'hk-jsonfold-key', keyLabel))

  const isContainer = value !== null && typeof value === 'object'
  if (!isContainer) {
    node.appendChild(el('span', `hk-jsonfold-val ${typeClass(value)}`, formatPrimitive(value)))
    return node
  }

  const isArr = Array.isArray(value)
  const openCh = isArr ? '[' : '{'
  const closeCh = isArr ? ']' : '}'
  const toggle = el('span', 'hk-jsonfold-toggle', '▾')
  toggle.setAttribute('role', 'button')
  toggle.setAttribute('aria-label', '折叠/展开')
  const open = el('span', 'hk-jsonfold-brace', openCh)
  const children = el('div', 'hk-jsonfold-children')
  const close = el('span', 'hk-jsonfold-brace hk-close', closeCh)
  const count = isArr ? value.length : Object.keys(value).length
  const preview = el('span', 'hk-jsonfold-preview', `${openCh}…${closeCh} (${count})`)

  const entries: Array<[string | null, unknown]> = isArr
    ? (value as unknown[]).map((v, i) => [null, v])
    : Object.entries(value as Record<string, unknown>)
  for (const [k, v] of entries) {
    children.appendChild(buildNode(v, k !== null ? `${JSON.stringify(k)}: ` : undefined))
  }

  toggle.addEventListener('click', () => {
    const collapsed = node.classList.toggle('hk-jsonfold-collapsed')
    toggle.textContent = collapsed ? '▸' : '▾'
  })

  node.append(toggle, open, children, close, preview)
  return node
}

/** 解析文本并构建可折叠 JSON 树；非法 JSON 返回 null（调用方回退为原文） */
export function jsonFoldFromText(text: string): HTMLElement | null {
  const t = (text ?? '').trim()
  if (!t) return null
  let v: unknown
  try {
    v = JSON.parse(t)
  } catch {
    return null
  }
  const root = el('div', 'hk-jsonfold')
  root.appendChild(buildNode(v))
  return root
}
