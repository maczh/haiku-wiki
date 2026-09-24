/**
 * luckysheet 的「触摸划屏全局杀手」修补（上游 bug 的前端兜底）。
 *
 * ## 现象
 * 手机上只要打开过任何一篇**表格文档**（阅读态 SheetView 或编辑态 SheetEditor 会加载
 * luckysheet），此后**整个会话**里所有页面的触摸上下划屏就全废了 —— 返回文库目录页
 * 也划不动，甚至连不是表格的文档页也划不动，必须整页刷新才恢复。
 * 反馈里的「除了 md / docx / 思维导图外，其他类型都划不动」正是这个原因：
 * 那几个类型不加载 luckysheet，其余都是被**同一次会话里打开的表格**连坐。
 *
 * ## 根因
 * luckysheet 的 UMD 产物里有一段模块级代码（`dist/luckysheet.umd.js`，属于它的
 * touchhandle 特性），**在模块首次求值时无条件注册**、且没有任何解除途径：
 *
 * ```js
 * document.addEventListener("touchmove", function (e) { e.preventDefault() }, { passive: false })
 * ```
 *
 * `touchmove` 被 preventDefault 之后，浏览器就认为这次手势被消费掉了，
 * **整页的触摸滚动全部失效**（实测：往返前后 `touchmove: defaultPrevented` 由 false 变 true，
 * `<main>` 的 `scrollTop` 从 393 掉到 0；而 DOM、body/html 内联样式、touch-action 链全都正常，
 * 所以从表面完全看不出问题）。
 *
 * ## 修法
 * 在 luckysheet 注册监听**之前**劫持 `document.addEventListener`：把「唯一动作就是
 * preventDefault」的 touchmove 监听换成带条件的包装 —— 只在事件目标落在 luckysheet 自己
 * 的触摸手柄 `.luckysheet-cs-touchhandle` 上时才真的阻止默认（保留该特性原本的意图），
 * 其余情况一律放行，页面触摸滚动恢复正常。
 *
 * ⚠️ **必须在 `import 'luckysheet'` 之前完成副作用执行**（ESM 按 import 声明顺序求值），
 * 所以 SheetView / SheetEditor 里都要把本模块的 import 放在 luckysheet 之前。
 * 同时自身幂等，重复引入无副作用。
 *
 * （与同目录下 SheetView 里 localforage 兜底是同一类「第三方 UMD 裸全局/裸副作用」的兜底思路。）
 */

/** 监听函数是否「唯一动作就是给事件 preventDefault」 */
function isBarePreventDefault(listener: unknown): boolean {
  if (typeof listener !== 'function') return false
  let src: string
  try {
    src = Function.prototype.toString.call(listener as () => void).replace(/\s+/g, '')
  } catch {
    return false // 某些原生/代理函数 toString 会抛
  }
  // 覆盖 function (e) { e.preventDefault() } / e => e.preventDefault() / (e) => { e.preventDefault() }
  return /^(?:function)?\(?[A-Za-z_$][\w$]*\)?(?:=>|\{)[A-Za-z_$][\w$]*\.preventDefault\(\)\}?$/.test(src)
}

/** 只在 luckysheet 自己的触摸手柄上生效 —— 那是这段代码原本要服务的场景 */
const TOUCH_HANDLE_SELECTOR = '.luckysheet-cs-touchhandle'

interface ShimmedDocument extends Document {
  __hkTouchShim?: boolean
}

/**
 * 安装修补（幂等）。由 SheetView / SheetEditor 在引入 luckysheet 前调用。
 */
export function installLuckysheetTouchShim(): void {
  if (typeof document === 'undefined') return
  const doc = document as ShimmedDocument
  if (doc.__hkTouchShim) return
  doc.__hkTouchShim = true

  // ⚠️ 必须转成宽松签名再用：直接拿 `typeof doc.addEventListener` 会让 TS 选中
  // `addEventListener<K extends keyof DocumentEventMap>(type: K, listener: (ev: ...) => any)`
  // 这条重载 —— 传字面量 'touchmove' 时 K 被推断为 'touchmove'，回调形参必须写成
  // `TouchEvent`，写 `Event` 会掉到第二条重载、又因为 `|null` 报「不可赋值」而编译失败。
  // （本项目 `tsc --noEmit` 要求 0 错误，这里不能靠 any 蒙混。）
  const orig = doc.addEventListener.bind(doc) as unknown as (
    type: string,
    listener: (e: Event) => void,
    options?: boolean | AddEventListenerOptions,
  ) => void

  doc.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'touchmove' && isBarePreventDefault(listener)) {
      const inner = listener as (e: Event) => void
      return orig(
        'touchmove',
        (e: Event) => {
          const t = e.target as Element | null
          // 只有真的在拖 luckysheet 的触摸手柄时才阻止默认，其余一律放行
          if (t && typeof t.closest === 'function' && t.closest(TOUCH_HANDLE_SELECTOR)) inner(e)
        },
        options,
      )
    }
    return orig(type, listener as (e: Event) => void, options)
  }) as typeof doc.addEventListener
}

installLuckysheetTouchShim()

export default installLuckysheetTouchShim
