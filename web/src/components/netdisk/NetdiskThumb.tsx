/**
 * 网格视图的缩略图瓦片。
 *
 * - 目录：渲染文件夹彩色图标（NetdiskFileIcon）。
 * - 图片：先用预览 token 换取 `previewUrl`，再以 `<img>` 真实缩略图展示；
 *   加载中 / 失败时回落到彩色扩展名色块，避免破图。
 * - 视频：暂无后端抽帧能力，渲染紫色视频色块 + 居中的播放三角，清晰表达类型；
 *   真实视频帧缩略图需后端支持（见下方说明）。
 * - 其余类型：彩色扩展名色块（NetdiskFileIcon）。
 *
 * 预览/下载走 query token，与 `<img>` 直链天然兼容，无需 Authorization 头。
 */

import { useEffect, useState } from 'react'
import { categoryOf, type NetdiskCategoryFilter } from '../../lib/netdisk/format'
import { makePreviewToken, previewUrl } from '../../api/netdisk'
import NetdiskFileIcon from './NetdiskFileIcon'
import type { NetdiskEntry } from '../../types'

interface Props {
  connId: number
  entry: NetdiskEntry
  /** 瓦片边长（px），默认 64 */
  size?: number
}

export default function NetdiskThumb({ connId, entry, size = 64 }: Props) {
  const cat = categoryOf(entry.name, entry.is_dir)
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImgSrc(null)
    setFailed(false)
    if (cat === 'image') {
      makePreviewToken(connId, entry.path)
        .then(({ token }) => {
          if (alive) setImgSrc(previewUrl(connId, entry.path, token))
        })
        .catch(() => {
          if (alive) setFailed(true)
        })
    }
    return () => {
      alive = false
    }
  }, [connId, entry.path, cat])

  // 目录：文件夹图标
  if (entry.is_dir) return <NetdiskFileIcon name={entry.name} isDir size={size} />

  // 图片：真实缩略图（加载中 / 失败回落色块）
  if (cat === 'image') {
    if (imgSrc && !failed) {
      return (
        <img
          src={imgSrc}
          alt={entry.name}
          style={{ width: size, height: size, objectFit: 'cover', borderRadius: 8 }}
        />
      )
    }
    return <NetdiskFileIcon name={entry.name} isDir={false} size={size} />
  }

  // 视频：紫色色块 + 播放三角（真实帧缩略图需后端抽帧）
  if (cat === 'video') {
    return (
      <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NetdiskFileIcon name={entry.name} isDir={false} size={size} />
        <span
          style={{
            position: 'absolute',
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              width: 0,
              height: 0,
              borderStyle: 'solid',
              borderWidth: `${size * 0.09}px 0 ${size * 0.09}px ${size * 0.15}px`,
              borderColor: 'transparent transparent transparent #fff',
              marginLeft: size * 0.03,
            }}
          />
        </span>
      </div>
    )
  }

  // 其余：彩色扩展名色块
  return <NetdiskFileIcon name={entry.name} isDir={false} size={size} />
}
