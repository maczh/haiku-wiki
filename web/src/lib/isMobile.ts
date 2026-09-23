/**
 * 移动端 UA 嗅探（纯函数，无副作用）。
 *
 * 命中常见手机 / 平板 / 小程序 WebView UA：
 *   · iPhone / iPod / iPad / Android / Mobile / Windows Phone
 *   · MicroMessenger（微信内置浏览器，含微信小程序 web-view 组件）
 *   · 其它常见移动内核：webOS / BlackBerry / IEMobile / Opera Mini
 *
 * 用于「手机版 / 桌面版」视图模式的初始判定（见 web/src/h5/useViewMode.ts）。
 */

/** 常见移动端 UA 关键字（不区分大小写） */
const MOBILE_UA_RE =
  /(?:iPhone|iPod|iPad|Android|Mobile|MicroMessenger|Windows\s*Phone|webOS|BlackBerry|IEMobile|Opera\s*Mini)/i

/**
 * 判断给定 UA 是否为移动端。
 *
 * @param ua 用户代理字符串；缺省时取 `navigator.userAgent`（浏览器环境）。
 * @returns 命中移动端关键字返回 true，否则 false。
 */
export function isMobile(ua: string = navigator.userAgent): boolean {
  if (!ua) return false
  return MOBILE_UA_RE.test(ua)
}
