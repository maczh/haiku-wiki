// 寄海文库品牌图标：圆角海洋渐变底 + 白色双帆纸船与海浪。
// 与 web/public/logo.svg、favicon.png 同源，保证界面与浏览器标签一致。
export interface JihaiLogoProps {
  /** 边长（px），默认 28 */
  size?: number
  style?: React.CSSProperties
  className?: string
}

export default function JihaiLogo({ size = 28, style, className }: JihaiLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="寄海文库"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id="jihaiLogoBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f6fe0" />
          <stop offset="1" stopColor="#12b3c8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#jihaiLogoBg)" />
      <path d="M33 12 L44.5 31.5 H33 Z" fill="#fff" />
      <path d="M30.5 17.5 V31.5 H21.5 Z" fill="#fff" opacity="0.85" />
      <path d="M16.5 34.5 H47.5 L41.5 44.5 H22.5 Z" fill="#fff" />
      <path
        d="M8 50 q6 -5 12 0 q6 5 12 0 q6 -5 12 0 q6 5 12 0"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M14 57.5 q6 -5 12 0 q6 5 12 0 q6 -5 12 0"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  )
}
