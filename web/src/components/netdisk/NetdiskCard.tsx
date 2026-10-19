/**
 * 首页「我的网盘」区块里的单张连接卡片。
 * 视觉尺寸与书架的 BookCard 保持一致（同一套 grid + hover 阴影）。
 */

import { Badge, Dropdown, Popconfirm, Tag } from 'antd'
import type { MenuProps } from 'antd'
import { DeleteOutlined, EditOutlined, HddOutlined, CloudOutlined, CloudServerOutlined } from '@ant-design/icons'
import type { NetdiskConnection, NetdiskKind, NetdiskStatus } from '../../types'
import { NETDISK_KIND_LABEL, NETDISK_STATUS_LABEL, NETDISK_STATUS_COLOR } from '../../lib/netdisk/constants'

const KIND_ICON: Record<NetdiskKind, React.ReactNode> = {
  smb: <HddOutlined style={{ color: '#2f54eb' }} />,
  ftp: <HddOutlined style={{ color: '#13a8a8' }} />,
  webdav: <CloudServerOutlined style={{ color: '#722ed1' }} />,
  baidu: <CloudOutlined style={{ color: '#2932e1' }} />,
  aliyun: <CloudOutlined style={{ color: '#ff7d00' }} />,
  quark: <CloudOutlined style={{ color: '#8a919f' }} />,
}

interface Props {
  conn: NetdiskConnection
  onOpen: (conn: NetdiskConnection) => void
  onEdit: (conn: NetdiskConnection) => void
  onDelete: (conn: NetdiskConnection) => void
  onReauth?: (conn: NetdiskConnection) => void
}

export default function NetdiskCard({ conn, onOpen, onEdit, onDelete, onReauth }: Props) {
  const sub =
    conn.kind === 'baidu' || conn.kind === 'aliyun'
      ? conn.account || '已授权账号'
      : [conn.host, conn.share].filter(Boolean).join(' / ')

  const menu: MenuProps = {
    items: [
      { key: 'edit', icon: <EditOutlined />, label: '编辑', onClick: () => onEdit(conn) },
      ...(conn.status === 'reauth_required' && onReauth
        ? [{ key: 'reauth', icon: <CloudOutlined />, label: '重新授权', onClick: () => onReauth(conn) }]
        : []),
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: (
          <Popconfirm
            title="删除该网盘连接？"
            description="仅删除本系统中的连接配置，不会影响网盘里的文件"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(conn)}
          >
            <span>删除</span>
          </Popconfirm>
        ),
      },
    ],
  }

  return (
    <div
      className="hk-netdisk-card"
      data-testid="hk-netdisk-card"
      onClick={() => onOpen(conn)}
      title={`${NETDISK_KIND_LABEL[conn.kind]} · ${conn.host || '已授权'}`}
    >
      <div className="hk-netdisk-card-actions" onClick={(e) => e.stopPropagation()}>
        <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
          <span style={{ cursor: 'pointer', color: '#8a919f', padding: 4 }}>⋯</span>
        </Dropdown>
      </div>
      <div className="hk-netdisk-card-title">
        {KIND_ICON[conn.kind]}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {conn.name}
        </span>
      </div>
      <div className="hk-netdisk-card-sub">{sub || '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag style={{ marginInlineEnd: 0 }}>{NETDISK_KIND_LABEL[conn.kind]}</Tag>
        <Badge
          status={badgeStatus(conn.status)}
          text={<span style={{ fontSize: 12, color: '#5c6470' }}>{NETDISK_STATUS_LABEL[conn.status]}</span>}
        />
      </div>
      {conn.status === 'failed' && conn.last_error && (
        <div
          style={{
            fontSize: 11,
            color: '#cf1322',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={conn.last_error}
        >
          {conn.last_error}
        </div>
      )}
    </div>
  )
}

/** antd Badge status 可用的值比我们的状态枚举少一档，reauth 用 warning 兜住 */
function badgeStatus(status: NetdiskStatus): 'default' | 'success' | 'error' | 'warning' | 'processing' {
  const color = NETDISK_STATUS_COLOR[status]
  if (color === 'success') return 'success'
  if (color === 'error') return 'error'
  if (color === 'warning') return 'warning'
  if (color === 'processing') return 'processing'
  return 'default'
}
