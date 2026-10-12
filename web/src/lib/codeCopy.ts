/**
 * 代码块「复制到剪贴板」：给容器内所有代码块注入右上角悬浮按钮。
 * 覆盖阅读态（MarkdownView）、分享态、H5 与导出预览；编辑态由 typo-md-editor 原生提供。
 */
const BTN_CLASS = 'hk-code-copy-btn'

/** IR 编辑态 overlay 句柄：refresh 重算锚点/定位，destroy 清理监听与 DOM */
export interface CodeCopyOverlay {
  refresh: () => void
  destroy: () => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fallthrough */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}

function codeText(pre: HTMLElement): string {
  const code = pre.querySelector('code')
  return (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '')
}

function attachButton(host: HTMLElement, getText: () => string): void {
  if (host.querySelector(`.${BTN_CLASS}`)) return
  host.classList.add('hk-code-copy-host')
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = BTN_CLASS
  btn.textContent = '复制'
  btn.setAttribute('aria-label', '复制代码到剪贴板')
  btn.addEventListener('mousedown', (e) => e.preventDefault())
  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    e.preventDefault()
    const ok = await copyText(getText())
    btn.textContent = ok ? '已复制' : '复制失败'
    btn.classList.toggle('hk-code-copy-btn--done', ok)
    setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('hk-code-copy-btn--done') }, 2000)
  })
  host.appendChild(btn)
}

export function injectCodeCopyButtons(container: HTMLElement): void {
  if (!container) return
  container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.closest('.vditor-ir__preview')) return   // IR 预览侧高亮 pre，跳过防一码两钮
    attachButton(pre, () => codeText(pre))
  })
  container.querySelectorAll<HTMLElement>('.hk-jsonfold-scroll').forEach((wrap) => {
    const raw = wrap.getAttribute('data-hk-code-text')
    if (!raw) return
    attachButton(wrap, () => raw)
  })
}

/** 代码块锚点：可见侧元素 + 取自源码侧的复制文本 */
interface CcAnchor {
  el: HTMLElement
  text: string
}

/**
 * IR 编辑态专用：把复制按钮做成「滚动容器层的 overlay」，不进入 Vditor IR DOM，
 * 避免被 processCodeRender 拷进预览、被 lute 序列化进正文。
 *
 * @param scroller 滚动容器（position:relative；VditorEditor 的 elRef div）
 * @param root     代码块查找根（.vditor-ir 元素）
 */
export function attachCodeCopyOverlay(scroller: HTMLElement, root: HTMLElement): CodeCopyOverlay {
  // overlay 层挂在 scroller 直下（.vditor 与 .vditor-ir 之外），
  // lute 序列化只取 ir.element.innerHTML，本层不会进正文。
  const layer = document.createElement('div')
  layer.className = 'hk-code-copy-layer'
  scroller.appendChild(layer)

  // 锚点 → {按钮, 文案}；内存维护，不用会进入 IR DOM 的标记属性
  const entries = new Map<HTMLElement, { btn: HTMLButtonElement; text: string }>()

  function makeBtn(getText: () => string, anchor: HTMLElement): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `${BTN_CLASS} hk-code-copy-float`
    btn.textContent = '复制'
    btn.setAttribute('aria-label', '复制代码到剪贴板')
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      e.preventDefault()
      const ok = await copyText(getText())
      btn.textContent = ok ? '已复制' : '复制失败'
      btn.classList.toggle('hk-code-copy-btn--done', ok)
      setTimeout(() => {
        btn.textContent = '复制'
        btn.classList.remove('hk-code-copy-btn--done')
        // 文案宽度变化后重新贴右上角
        place(anchor, btn)
      }, 2000)
    })
    return btn
  }

  /** 把按钮贴到锚点可见侧右上角（8px 内边距） */
  function place(anchor: HTMLElement, btn: HTMLButtonElement): void {
    const r = anchor.getBoundingClientRect()
    const c = scroller.getBoundingClientRect()
    // btn 已挂载且 layer 可见，offsetWidth 可读（「已复制」比「复制」宽，每次重算）
    const w = btn.offsetWidth
    btn.style.top = `${r.top - c.top + scroller.scrollTop + 8}px`
    btn.style.left = `${r.left - c.left + scroller.scrollLeft + r.width - 8 - w}px`
  }

  /** 收集当前所有代码块锚点（源码/高亮两侧取可见侧，文案取源码侧） */
  function collect(): CcAnchor[] {
    const out: CcAnchor[] = []
    const textOf = (pre: HTMLElement): string => {
      const code = pre.querySelector('code')
      return (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '')
    }
    root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      if (pre.closest('.vditor-ir__preview')) {
        // 高亮侧：其宿主 preview 有源码 pre 兄弟则跳过（由源码侧统一处理）
        const pv = pre.parentElement
        const prev = pv?.previousElementSibling
        if (prev && prev.tagName === 'PRE') return
        out.push({ el: pre, text: textOf(pre) })
        return
      }
      // 源码侧 pre（IR 里普通 pre 即源码侧）
      const next = pre.nextElementSibling
      if (next instanceof HTMLElement && next.classList.contains('vditor-ir__preview')) {
        // 高亮代码块：锚点取当前可见的一侧（display:none 时 offsetParent 为 null）
        out.push({ el: pre.offsetParent ? pre : next, text: textOf(pre) })
        return
      }
      out.push({ el: pre, text: textOf(pre) })
    })
    return out
  }

  function refresh(): void {
    const anchors = collect()
    const keep = new Set(anchors.map((a) => a.el))
    // 移除已消失锚点的按钮
    entries.forEach((entry, el) => {
      if (!keep.has(el)) {
        entry.btn.remove()
        entries.delete(el)
      }
    })
    // 新建/复用 + 定位
    anchors.forEach((a) => {
      let entry = entries.get(a.el)
      if (!entry) {
        const e = { btn: null as unknown as HTMLButtonElement, text: a.text }
        e.btn = makeBtn(() => e.text, a.el)
        entry = e
        entries.set(a.el, entry)
        layer.appendChild(entry.btn)
      } else {
        entry.text = a.text   // 同步最新代码文本
      }
      place(a.el, entry.btn)
    })
  }

  const onScroll = () => refresh()
  scroller.addEventListener('scroll', onScroll, { passive: true })

  refresh()

  return {
    refresh,
    destroy(): void {
      scroller.removeEventListener('scroll', onScroll)
      entries.forEach((entry) => entry.btn.remove())
      entries.clear()
      layer.remove()
    },
  }
}
