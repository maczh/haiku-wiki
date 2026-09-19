import { useRef, useState } from 'react'
import { Card, Button, Alert } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

/** 视频章节（点击跳到对应时间点） */
export interface VideoChapter {
  label: string
  /** 秒 */
  at: number
}

interface Props {
  /** 视频地址（随前端静态资源分发，离线可用） */
  src: string
  /** 封面图；缺省时由浏览器显示首帧 */
  poster?: string
  chapters?: VideoChapter[]
  /** 视频总时长（秒）；用于标题上的「约 N 分钟」说明 */
  seconds?: number
  /** 右上角关闭（本次会话隐藏，刷新后可能再出现） */
  onClose: () => void
  /** 「不再提示」：持久隐藏 */
  onDismissForever: () => void
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 首页「视频介绍」卡片：内嵌操作演示视频（含中文语音讲解与字幕），
 * 并提供章节跳转，方便只想看某一段的用户。
 *
 * 视频是随前端分发的静态资源（web/public/onboarding/…），
 * 不依赖任何外部 CDN；若资源缺失（例如裁剪过的部署包），
 * 播放器会报错，此处降级为一段文字说明而不是让用户对着黑框。
 */
export default function IntroVideo({
  src,
  poster,
  chapters = [],
  seconds,
  onClose,
  onDismissForever,
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [started, setStarted] = useState(false)

  function seek(at: number) {
    const v = ref.current
    if (!v) return
    v.currentTime = at
    setStarted(true)
    void v.play().catch(() => {
      /* 自动播放被策略拦截时静默：用户自己点播放即可 */
    })
  }

  return (
    <Card
      size="small"
      data-testid="hk-intro-video"
      title={
        <span style={{ fontSize: 14 }}>
          视频介绍
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#8a919f' }}>
            {seconds ? `约 ${Math.round(seconds / 60)} 分钟，带语音讲解与字幕` : '带语音讲解与字幕'}
          </span>
        </span>
      }
      extra={
        <button
          type="button"
          className="hk-dash-dismiss"
          title="不再显示视频介绍"
          aria-label="关闭视频介绍"
          data-testid="hk-intro-close"
          onClick={onClose}
        >
          <CloseOutlined />
        </button>
      }
    >
      {failed ? (
        <Alert
          type="info"
          showIcon
          message="演示视频未随本部署包分发"
          description="功能说明可参考仓库 docs/ 目录下的《寄海文库功能指南》。"
        />
      ) : (
        <video
          ref={ref}
          className="hk-dash-video"
          src={src}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          data-testid="hk-intro-player"
          onError={() => setFailed(true)}
          onPlay={() => setStarted(true)}
        />
      )}

      {!failed && chapters.length > 0 && (
        <div className="hk-dash-video-chapters">
          {chapters.map((c) => (
            <span
              key={c.label}
              className="hk-dash-video-chapter"
              role="button"
              tabIndex={0}
              title={`跳到 ${mmss(c.at)}`}
              onClick={() => seek(c.at)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') seek(c.at)
              }}
            >
              {c.label} {mmss(c.at)}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span className="hk-dash-video-fallback">
          {started ? '已开始播放，可拖动进度条回看任意步骤。' : '点击播放开始了解寄海文库的完整用法。'}
        </span>
        <div style={{ flex: 1 }} />
        <Button size="small" type="text" data-testid="hk-intro-dismiss" onClick={onDismissForever}>
          不再提示
        </Button>
      </div>
    </Card>
  )
}
