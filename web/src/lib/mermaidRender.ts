// Mermaid 渲染保真工具（P0-6 / 架构文档 §1.3 第 3 步、风险 R2）。
//
// 为什么需要这个模块？
// -----------------------------------------------------------------------------
// 【事实 1｜mermaid 渲染是 fire-and-forget】Vditor 内部对每个 `.language-mermaid` 容器
//   动态加载 `{cdn}/dist/js/mermaid/mermaid.min.js`，加载成功后调用
//   `mermaid.render(id, code)` 并把返回的 `<svg>` 写进容器。整个过程**不被 `after` 回调等待**：
//   `Vditor.preview` 先派发各渲染器、再同步调用 `after()` —— 即 `after` 执行时 SVG 往往还没注入。
//   结论：任何「在 after 里对整体产物做一次清洗」的写法，时机都早于 mermaid 注入，
//   只能洗到 Vditor 的原始产物，洗不到 mermaid 生成的 SVG。
//
// 【事实 2｜DOMPurify 会连内容一起删掉 <foreignObject>】实测（dompurify 3.4.15）：
//   无论是否指定 `USE_PROFILES:{svg:true}`，`DOMPurify.sanitize()` 都会把
//   `<foreignObject>` **连同其内部文字一并删除** —— 因为 `svgDisallowed` 与
//   `DEFAULT_FORBID_CONTENTS` 都包含 `foreignobject`，且无法用 `ADD_TAGS` 恢复
//   （实测 `ADD_TAGS:['foreignObject']` 只能保住标签壳，标签里的文字仍被清空）。
//   而 Vditor 以 `securityLevel:'loose'` + `flowchart:{htmlLabels:true}` 初始化 mermaid，
//   节点标签正是渲染在 `<foreignObject>` 里的 —— 若对含 mermaid 产物的 DOM 整体清洗，
//   结果是「图还在、文字全丢、且无任何报错」。
//
// 于是本模块给出两个能力：
//   - `waitForMermaidBlocks`：等 mermaid 的 SVG 真正注入后再动作；
//   - `sanitizePreservingMermaid`：**摘出 mermaid 节点 → 对其余内容跑 DOMPurify →
//     把 mermaid 节点原位放回**，并对 mermaid 节点单独做「定向清洗」（去脚本、去事件属性、
//     去 `javascript:` 协议 URL），从而既不让 DOMPurify 清空图形、又不让注入的 SVG 完全未经清洗。

import DOMPurify, { type Config } from 'dompurify'

/** mermaid 代码块容器的选择器（与 Vditor 内部 `mermaidRenderAdapter` 保持一致） */
export const MERMAID_SELECTOR = '.language-mermaid'

/** 默认清洗配置：与阅读页 / 导出原有行为一致（script + 内联事件 + 危险嵌入标签） */
const DEFAULT_PURIFY: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
}

/** 占位标记属性：DOMPurify 默认保留 `data-*` 属性，故占位符能在清洗后存活并被精确找回 */
const PLACEHOLDER_ATTR = 'data-hk-mermaid-slot'

export interface SanitizePreservingMermaidOptions {
  /** 覆盖传给 DOMPurify 的清洗配置（默认与阅读页一致） */
  purify?: Config
}

/** 取出「已经渲染出 `<svg>`」的 mermaid 容器（渲染失败的容器不在此列，仍走常规清洗） */
function renderedMermaidNodes(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)).filter(
    (el) => el.querySelector('svg') !== null,
  )
}

/**
 * 等待 `root` 内所有 mermaid 容器出现 `<svg>`（或超时）。
 *
 * 供「mermaid 注入之后」的动作使用：`Vditor.preview` / `Vditor.mermaidRender` 都是
 * fire-and-forget（见文件头「事实 1」），调用方必须显式等一次。
 *
 * 语义：
 *  - 只等待「有内容（`textContent` 非空）且尚未出现 `<svg>`」的容器；空代码块 Vditor 会跳过，
 *    不参与等待，避免无谓地拖满超时；
 *  - **超时也 resolve**（不 reject）：渲染失败（脚本 404 / 语法错误）时不应阻塞上层流程，
 *    由调用方继续走清洗与降级；
 *  - 用 `MutationObserver` 监听 `childList + subtree`（mermaid 通过 `el.innerHTML = svg` 注入，
 *    属于子树 childList 变更），命中后立即结束，绝大多数情况远快于超时。
 *
 * @param root 渲染容器（如阅读页正文节点）
 * @param timeoutMs 最长等待时间，默认 5000ms
 */
export function waitForMermaidBlocks(root: HTMLElement, timeoutMs = 5000): Promise<void> {
  const pending = Array.from(root.querySelectorAll<HTMLElement>(MERMAID_SELECTOR)).filter(
    (el) => (el.textContent ?? '').trim() !== '' && el.querySelector('svg') === null,
  )
  if (pending.length === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let observer: MutationObserver | null = null

    const finish = () => {
      if (done) return
      done = true
      observer?.disconnect()
      if (timer !== null) clearTimeout(timer)
      resolve()
    }
    const stillPending = () => pending.some((el) => el.querySelector('svg') === null)

    observer = new MutationObserver(() => {
      if (!stillPending()) finish()
    })
    observer.observe(root, { childList: true, subtree: true })
    timer = setTimeout(finish, timeoutMs)

    // 若在建立观察者之前就已全部就绪（例如脚本已缓存、同帧内完成），立刻结束
    if (!stillPending()) finish()
  })
}

/**
 * 保真清洗：**摘出 mermaid 节点 → 清洗其余内容 → 原位放回**。
 *
 * 直接对含 mermaid 产物的 DOM 调 `DOMPurify.sanitize` 会删掉 `<foreignObject>`（见文件头
 * 「事实 2」），使图变空框且无报错；本函数通过「摘出-清洗-放回」绕开该问题。
 *
 * 放回的保序策略：在 mermaid 节点原位放一个 `<span data-hk-mermaid-slot="i">` 占位符。
 * 选它而不是注释节点的原因：DOMPurify 默认会**移除 HTML 注释**，而 `<span>` + `data-*` 属性
 * 会被保留，因此清洗后仍能用属性精确匹配、且天然保序（`querySelectorAll` 按文档序返回）。
 *
 * 对 mermaid 节点本身不做 DOMPurify，而是做「定向清洗」：删 `<script>` / `<iframe>` /
 * `<object>` / `<embed>`、删所有 `on*` 内联事件属性、删 `javascript:` 协议的 `href/src` ——
 * 这些才是 `securityLevel:'loose'` 下真正可利用的注入点，而 `<foreignObject>` 及其标签文字被保留。
 *
 * @param root 渲染容器（会被就地修改其 DOM）
 * @param opts 可选：覆盖 DOMPurify 配置
 */
export function sanitizePreservingMermaid(root: HTMLElement, opts: SanitizePreservingMermaidOptions = {}): void {
  const nodes = renderedMermaidNodes(root)

  // 没有已渲染的 mermaid 图 → 退化为普通清洗（与原有行为一致）
  if (nodes.length === 0) {
    root.innerHTML = purify(root.innerHTML, opts)
    return
  }

  // 1) 摘出 mermaid 节点，并在原位留下占位符
  const slots: string[] = []
  nodes.forEach((node, index) => {
    const slot = `s${index}`
    const placeholder = root.ownerDocument.createElement('span')
    placeholder.setAttribute(PLACEHOLDER_ATTR, slot)
    node.parentNode?.replaceChild(placeholder, node)
    sanitizeMermaidNode(node)
    slots.push(slot)
  })

  // 2) 对其余内容跑 DOMPurify（保留既有 XSS 兜底行为）
  root.innerHTML = purify(root.innerHTML, opts)

  // 3) 按占位符把 mermaid 节点原位放回（保序）
  root.querySelectorAll<HTMLElement>(`[${PLACEHOLDER_ATTR}]`).forEach((placeholder) => {
    const slot = placeholder.getAttribute(PLACEHOLDER_ATTR)
    const index = slot === null ? -1 : slots.indexOf(slot)
    if (index < 0) {
      placeholder.remove()
      return
    }
    placeholder.parentNode?.replaceChild(nodes[index], placeholder)
  })
}

/** mermaid 节点的定向清洗：去脚本 / 去内联事件 / 去 `javascript:` 协议 URL，但保留图形与 `<foreignObject>` */
function sanitizeMermaidNode(node: HTMLElement): void {
  node.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove())

  const walk = (el: Element): void => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
    for (const child of Array.from(el.children)) walk(child)
  }
  walk(node)
}

/** 统一的 DOMPurify 调用入口（合并默认配置与覆盖项） */
function purify(html: string, opts: SanitizePreservingMermaidOptions): string {
  return DOMPurify.sanitize(html, { ...DEFAULT_PURIFY, ...(opts.purify ?? {}) })
}
