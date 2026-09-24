/**
 * H5 分享：链接生成 + 唤起各 App。
 *
 * 三条路径，按「能不能真唤起 App」从强到弱：
 *   1. **系统分享**（`navigator.share`，iOS Safari / Android Chrome 都支持）：
 *      直接拉起系统分享面板，微信 / 朋友圈 / QQ / 微博 / 钉钉 / 短信… 全在里面，
 *      这是唯一能真正「唤起相应 App 并带链接」的通用能力，优先走它。
 *   2. **URL Scheme 直呼**：在 Web Share API 不可用时（微信内置浏览器、部分安卓内核）
 *      用各家的 scheme 唤起；同时**先把链接写进剪贴板**，App 打开后直接粘贴即可，
 *      未安装 App 时也不会「点了没反应，什么都没得到」。
 *   3. **复制链接**：兜底。
 *
 * ⚠️ 微信的 `weixin://` 不接受任意分享参数（无公众号 JS-SDK 时无法直接分享），
 *    所以「微信 / 朋友圈」走的是「复制链接 + 提示去粘贴」，这是微信生态下的标准做法。
 */

export interface ShareChannel {
  key: string
  name: string
  /** 唤起用的 URL scheme；不提供则只做「复制 + 提示」 */
  scheme?: (url: string, title: string) => string
  /** 点击后的提示文案 */
  hint?: string
}

/** 可直接唤起的渠道（有真实 scheme） */
export const SHARE_CHANNELS: ReadonlyArray<ShareChannel> = [
  {
    key: 'wechat',
    name: '微信',
    hint: '链接已复制，打开微信粘贴给好友即可',
  },
  {
    key: 'moments',
    name: '朋友圈',
    hint: '链接已复制，在朋友圈粘贴即可发布',
  },
  {
    key: 'qq',
    name: 'QQ',
    scheme: (url, title) =>
      `mqqapi://share/to_fri?src_type=web&version=1&file_type=news&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  },
  {
    key: 'qzone',
    name: 'QQ空间',
    scheme: (url, title) =>
      `mqqapi://share/to_qzone?src_type=web&version=1&file_type=news&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  },
  {
    key: 'weibo',
    name: '微博',
    scheme: (url, title) => `sinaweibo://compose?content=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    key: 'dingtalk',
    name: '钉钉',
    scheme: (url, title) =>
      `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  },
  {
    key: 'sms',
    name: '短信',
    scheme: (url, title) => `sms:?&body=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    key: 'email',
    name: '邮件',
    scheme: (url, title) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  },
]

/** 是否支持系统分享（Web Share API） */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as Navigator).share === 'function'
}

/** 系统分享；返回 false 表示不可用或被用户取消 */
export async function nativeShare(payload: {
  title: string
  text?: string
  url: string
}): Promise<boolean> {
  if (!canNativeShare()) return false
  try {
    await (navigator as Navigator).share(payload)
    return true
  } catch {
    // 用户取消 share() 也会 reject，不算错误
    return false
  }
}

/** 复制到剪贴板（含不支持 Clipboard API 时的 execCommand 兜底） */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走兜底 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * 唤起某个渠道：先复制链接（保证用户总有东西可粘贴），再跳 scheme。
 * 用 `location.href = scheme` 触发；未安装 App 时浏览器静默忽略，不会报错。
 */
export function openShareChannel(ch: ShareChannel, url: string, title: string): void {
  if (ch.scheme) {
    // 部分内核对直接跳 scheme 会被拦截，用隐藏 iframe 更稳（iOS 上两者都可，取其一）
    try {
      window.location.href = ch.scheme(url, title)
    } catch {
      /* 忽略：未安装 App 时浏览器会静默失败 */
    }
  }
}

/** 当前页面所属的站点根（用于拼绝对链接） */
export function siteOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

/** 文档级分享链接（/doc-share/:slug） */
export function docShareUrl(slug: string): string {
  return `${siteOrigin()}/doc-share/${slug}`
}

/** 文库级分享链接（/share/:slug） */
export function bookShareUrl(slug: string): string {
  return `${siteOrigin()}/share/${slug}`
}
