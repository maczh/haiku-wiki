/**
 * 网盘文件列表的鼠标右键菜单（PRD 本次需求）。
 *
 * 由 NetdiskFileList 在「右键某一行」或「点击不可预览的文件名」时，传入屏幕坐标 + 操作项，
 * 在光标处弹出固定定位的菜单。点击菜单项 / 点击别处 / 滚动 / 按 Esc 都会关闭。
 *
 * 关闭监听在 useEffect 里挂载（晚于触发它的那次事件），因此「右键打开」的那次
 * contextmenu 不会把自己误关掉。
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  /** 分隔线（与上面的项之间） */
  divider?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/** 菜单最大宽高，避免贴边时溢出视口 */
const MENU_WIDTH = 184
const MENU_MAX_HEIGHT = 320

export default function NetdiskContextMenu({ x, y, items, onClose }: Props) {
  // 关闭监听：左键点别处 / 右键别处 / 滚动 / 缩放 / Esc
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      // 点在菜单内部不关闭（由菜单项自身处理）
      const t = e.target as HTMLElement
      if (t.closest('[data-netdisk-ctx-menu]')) return
      onClose()
    }
    const onDocContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('[data-netdisk-ctx-menu]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('contextmenu', onDocContextMenu)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('contextmenu', onDocContextMenu)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // 防止贴右 / 贴下边缘时溢出：坐标回退
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const top = Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8)

  const node = (
    <div
      data-netdisk-ctx-menu
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 2000,
        minWidth: MENU_WIDTH,
        maxHeight: MENU_MAX_HEIGHT,
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,.16)',
        padding: '4px 0',
        border: '1px solid #ebedf0',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <div key={it.key}>
          {it.divider && i > 0 && <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />}
          <div
            onMouseDown={(e) => {
              if (it.disabled) return
              // 文档级 mousedown 监听会在 click 前关闭菜单；在菜单项自身按下时
              // 直接执行操作，避免菜单卸载后 click 丢失（导入菜单表现为无响应）。
              e.preventDefault()
              it.onClick?.()
              onClose()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              color: it.danger ? '#cf1322' : 'rgba(0,0,0,.85)',
              opacity: it.disabled ? 0.4 : 1,
              fontSize: 13,
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!it.disabled) e.currentTarget.style.background = '#f5f6f8'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {it.icon && <span style={{ fontSize: 13, width: 14, textAlign: 'center' }}>{it.icon}</span>}
            <span>{it.label}</span>
          </div>
        </div>
      ))}
    </div>
  )

  return createPortal(node, document.body)
}
