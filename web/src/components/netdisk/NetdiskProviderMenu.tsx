/**
 * 「+ 新增网盘」下拉子菜单。
 *
 * 菜单项（含夸克）全部由 `GET /api/netdisks/providers` 下发：
 *   - available=false → disabled + Tooltip 说明（夸克「官方暂未开放第三方 API」、
 *     百度/阿里未配置 AppKey 时都走这条，**不写死任何 availability**）；
 *   - oauth=true → 走授权跳转，native=true → 打开配置对话框。
 */

import { Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { CloudOutlined, CloudServerOutlined, HddOutlined, LinkOutlined } from '@ant-design/icons'
import { useMemo, type ReactNode } from 'react'
import type { NetdiskKind, NetdiskProvider } from '../../types'
import { NETDISK_KIND_MENU_LABEL } from '../../lib/netdisk/constants'

const KIND_ICON: Record<NetdiskKind, ReactNode> = {
  smb: <HddOutlined />,
  ftp: <HddOutlined />,
  webdav: <CloudServerOutlined />,
  baidu: <CloudOutlined />,
  aliyun: <CloudOutlined />,
  quark: <CloudOutlined />,
}

interface Props {
  providers: NetdiskProvider[]
  /** 选中某个类型：native 类由父组件开配置对话框，oauth 类由父组件走授权跳转 */
  onPick: (kind: NetdiskKind) => void
  children: ReactNode
}

export default function NetdiskProviderMenu({ providers, onPick, children }: Props) {
  const items = useMemo<MenuProps['items']>(
    () =>
      providers.map((p) => ({
        key: p.kind,
        icon: KIND_ICON[p.kind] ?? <CloudOutlined />,
        label: (
          <Tooltip title={p.available ? undefined : p.disabled_reason || '暂不可用'}>
            <span style={{ opacity: p.available ? 1 : 0.55 }}>
              {p.label || NETDISK_KIND_MENU_LABEL[p.kind]}
              {!p.available && p.kind === 'quark' ? '（未开放）' : ''}
            </span>
          </Tooltip>
        ),
        disabled: !p.available,
        onClick: () => onPick(p.kind),
      })),
    [providers, onPick],
  )

  return (
    <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
      {children}
    </Dropdown>
  )
}
