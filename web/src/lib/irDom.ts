/**
 * Vditor IR 模式的 DOM 定位辅助（实测结论，勿凭印象改回）：
 *
 * 1. Vditor 会为 **所有模式各建一个** `.vditor-reset` 容器（wysiwyg / sv / ir / preview），
 *    其中只有 `.vditor-ir` 下的那个是当前正文（其余为空壳，size 0×0）。
 *    裸查 `host.querySelector('.vditor-reset')` 会命中 wysiwyg 的空壳，
 *    导致 `contains()` 永远为 false —— 块手柄悬停不显示、菜单定位全废。
 *
 * 2. 块元素上的 `data-block` 是**静态占位符（恒为 "0"）**，不是源码行号；
 *    有意义的只有「全部 [data-block] 中的文档序位置」，它对应块的 Markdown 源行锚点。
 *    按 `[data-block="${n}"]` 取值查询永远只会命中第一个块。
 *
 * 3. 顶层块是 `.vditor-reset`（一个 <pre>）的直接子元素：
 *    标题/段落是 `<p>`（标题文字带 `.vditor-ir__marker--heading` 标记），代码块等被包在
 *    `.vditor-ir__node` 里 —— 都带 `data-block`，向上走到 reset 的最后一个 data-block 祖先即顶层块。
 */

/** IR 正文容器（当前模式的那个 .vditor-reset） */
export function irReset(host: HTMLElement): HTMLElement | null {
  return host.querySelector('.vditor-ir .vditor-reset') as HTMLElement | null
}

/** IR 顶层块列表（文档序） */
export function irBlocks(host: HTMLElement): HTMLElement[] {
  const reset = irReset(host)
  return reset ? Array.from(reset.querySelectorAll<HTMLElement>('[data-block]')) : []
}

/** 元素所在顶层块在文档序中的索引（-1 = 不在 IR 正文里） */
export function irBlockIndex(host: HTMLElement, el: HTMLElement): number {
  if (!irReset(host)?.contains(el)) return -1
  let node: HTMLElement | null = el
  let top: HTMLElement | null = null
  const reset = irReset(host)
  while (node && node !== reset) {
    if (node.hasAttribute('data-block')) top = node
    node = node.parentElement
  }
  if (!top) return -1
  return irBlocks(host).indexOf(top)
}
