// HTML 导入前的清洗层：CSS 规则解析 + 不可见元素剔除 + 非正文节点剥离。
//
// 为什么要单独一层：
//   · 导入的 HTML 常含「用 CSS 藏起来」的导航/弹窗/埋点容器（display:none 等），
//     直接转 Markdown 会把这些隐藏文案一起写进正文，读起来全是噪声；
//   · DOMParser 产出的文档**不执行脚本、也无布局**，因此：
//       - getComputedStyle 不可用（没有渲染树）→ 只能静态解析 CSS 规则；
//       - <script> 里的文本不会变成节点，也不该进正文 → 直接剔除；
//   · 这些逻辑与「文件 → 解析器」的调度无关，独立后可单独做 node 侧验证。
//
// 本文件的纯函数（parseCssRules / declaresHidden / hiddenSelectors）不依赖 DOM，
// 可在 node 下直接用 esbuild 打包后断言（见提交说明里的验证命令）。

/** 一条 CSS 规则（选择器 + 声明块原文） */
export interface CssRule {
  selector: string
  decls: string
}

/**
 * 把 CSS 文本拆成规则列表。
 *
 * 手写解析而不用 CSSOM：导入的 CSS 可能夹带语法错误、@media 嵌套与注释，
 * 浏览器 CSSOM 在解析失败时会整段丢弃；这里只关心「选择器 → 声明」的对应关系，
 * 用深度计数即可容忍残缺，且 @media / @supports 内部的规则一样能取出来（条件组
 * 在静态分析中当作无条件处理——拿不到视口尺寸，宁可多剔除也不漏噪声）。
 */
export function parseCssRules(css: string): CssRule[] {
  const text = (css || '').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  // stack：每进入一个 `{` 压一层，遇到 `}` 弹一层并产出一条规则
  const stack: { selector: string; decls: string }[] = []
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      const pre = buf.trim()
      buf = ''
      // at-rule（@media/@supports/@font-face …）本身不是选择器，用空串占位
      stack.push({ selector: pre.startsWith('@') ? '' : pre, decls: '' })
      continue
    }
    if (ch === '}') {
      const top = stack.pop()
      if (!top) {
        buf = ''
        continue
      }
      const inner = buf
      buf = ''
      if (top.selector) {
        // 该层自身的声明：遇到嵌套规则时只取第一个 `{` 之前的声明
        rules.push({ selector: top.selector, decls: inner.split('{')[0] })
      }
      continue
    }
    buf += ch
  }
  return rules
}

/** 声明块是否会让元素不可见（display:none / visibility:hidden / opacity:0 等） */
export function declaresHidden(decls: string): boolean {
  const d = (decls || '').toLowerCase()
  if (!d.trim()) return false
  if (/display\s*:\s*none\b/.test(d)) return true
  if (/visibility\s*:\s*(hidden|collapse)\b/.test(d)) return true
  // clip-path: inset(100%) / clip: rect(0,0,0,0) —— 常见的「视觉隐藏但保留给读屏器」写法
  if (/clip-path\s*:\s*inset\(\s*100%/.test(d)) return true
  if (/clip\s*:\s*rect\(\s*0/.test(d)) return true
  // opacity: 0（含 0.0 / .0）
  const opacity = /opacity\s*:\s*([^;]+)/.exec(d)
  if (opacity && Number.parseFloat(opacity[1]) === 0) return true
  // height:0 + overflow:hidden —— 折叠容器
  if (/height\s*:\s*0(?:px|em|rem|%)?\b/.test(d) && /overflow(-y)?\s*:\s*hidden/.test(d)) return true
  return false
}

/** 从 CSS 文本里取出所有「隐藏类」选择器（已做规范化，便于 matches() 使用） */
export function hiddenSelectors(css: string): string[] {
  const out: string[] = []
  for (const rule of parseCssRules(css)) {
    if (!declaresHidden(rule.decls)) continue
    // 逗号分隔的选择器组拆开逐条保留
    for (const part of rule.selector.split(',')) {
      const sel = part.trim().replace(/\s+/g, ' ')
      if (sel && !out.includes(sel)) out.push(sel)
    }
  }
  return out
}

// ---------- 以下为 DOM 侧（浏览器环境） ----------

/** 收集文档里所有 <style> 的文本（<link> 外链样式跨域取不到，静态导入无法处理） */
export function collectStyleText(doc: Document): string {
  const nodes = doc.querySelectorAll('style')
  let css = ''
  nodes.forEach((n) => {
    css += (n.textContent || '') + '\n'
  })
  return css
}

/** 不产出正文的节点：脚本/样式/模板/嵌入对象等 */
const NON_CONTENT_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'link',
  'meta',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'audio',
  'video',
]

/** 剥离不产出正文的节点（<script> 的文本绝不进正文） */
export function stripNonContent(root: Element): number {
  let removed = 0
  for (const tag of NON_CONTENT_TAGS) {
    root.querySelectorAll(tag).forEach((el) => {
      el.parentNode?.removeChild(el)
      removed++
    })
  }
  return removed
}

/**
 * 懒加载图片补全：src 缺失或为占位图时，用 data-src / data-original 等常见懒加载属性补上。
 * 目的：导入后的 Markdown 里图片仍是可访问 URL，而不是空链接。
 */
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-url']

export function fixLazyImages(root: Element): number {
  let fixed = 0
  root.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim()
    const usable = src && !/^(data:image\/gif;base64,R0lGOD|about:blank|#)/i.test(src)
    if (usable) return
    for (const attr of LAZY_SRC_ATTRS) {
      const v = (img.getAttribute(attr) || '').trim()
      if (v && !v.startsWith('data:image/gif;base64,R0lGOD')) {
        img.setAttribute('src', v)
        fixed++
        return
      }
    }
  })
  return fixed
}

/** 判断元素是否「实际上看不见」：inline style / hidden 属性 / CSS 隐藏规则任一命中 */
export function isHiddenElement(el: Element, hiddenSels: string[]): boolean {
  const style = (el.getAttribute('style') || '').toLowerCase()
  if (declaresHidden(style)) return true
  if (el.hasAttribute('hidden')) return true
  if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return true
  for (const sel of hiddenSels) {
    try {
      if (el.matches(sel)) return true
    } catch {
      // 选择器带浏览器不支持的伪类/语法（如 :has(...)）：跳过该条，不影响其余
    }
  }
  return false
}

/**
 * 剔除所有不可见元素（自顶向下，命中即整棵子树移除）。
 * 返回被移除的元素数量，便于在导入结果里给出提示。
 */
export function pruneInvisible(root: Element, hiddenSels: string[]): number {
  let removed = 0
  const all = Array.from(root.querySelectorAll('*'))
  for (const el of all) {
    // 父节点已被移除时跳过（整棵子树随之消失，不必重复处理）
    if (!el.parentElement) continue
    if (isHiddenElement(el, hiddenSels)) {
      el.parentNode?.removeChild(el)
      removed++
    }
  }
  return removed
}
