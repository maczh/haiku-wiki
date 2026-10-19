/**
 * 首页「我的网盘」区块 —— 与「书架」**同级别**的平行 <section>（PRD §4.1）。
 *
 * 自己负责数据获取（连接列表 + 能力清单），父组件（DashboardPage）只管挂载，
 * 这样首页与网盘页之间没有隐式耦合。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dropdown, Empty, Spin, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  deleteConnection,
  listConnections,
  listProviders,
  refreshConnection,
} from '../../api/netdisk'
import { openNetdiskOAuth } from '../../lib/netdisk/oauth'
import NetdiskProviderMenu from './NetdiskProviderMenu'
import NetdiskConnectionDialog from './NetdiskConnectionDialog'
import NetdiskCard from './NetdiskCard'
import type { NetdiskConnection, NetdiskKind, NetdiskProvider } from '../../types'

export default function NetdiskSection() {
  const navigate = useNavigate()
  const [providers, setProviders] = useState<NetdiskProvider[]>([])
  const [conns, setConns] = useState<NetdiskConnection[]>([])
  const [loading, setLoading] = useState(true)
  /** 配置对话框：kind 非空即打开；editing 非空为编辑态 */
  const [dialog, setDialog] = useState<{ kind: NetdiskKind; editing: NetdiskConnection | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, c] = await Promise.all([listProviders(), listConnections()])
      setProviders(p)
      setConns(c)
    } catch {
      /* request 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 点「+ 新增网盘」子菜单：native 类开对话框，oauth 类走授权跳转 */
  async function handlePick(kind: NetdiskKind) {
    const p = providers.find((x) => x.kind === kind)
    if (p && !p.available) return
    if (p?.oauth) {
      try {
        const res = await openNetdiskOAuth(kind)
        if (res.ok) {
          message.success(`${res.name || '网盘'}授权成功`)
          void load()
        } else {
          message.error(res.message || '授权未完成')
        }
      } catch (e) {
        message.error(e instanceof Error ? e.message : '授权失败')
      }
      return
    }
    setDialog({ kind, editing: null })
  }

  async function handleDelete(conn: NetdiskConnection) {
    try {
      await deleteConnection(conn.id)
      message.success('已删除连接')
      void load()
    } catch {
      /* request 拦截器已提示 */
    }
  }

  async function handleReauth(conn: NetdiskConnection) {
    try {
      const res = await openNetdiskOAuth(conn.kind, conn.name)
      if (res.ok) {
        message.success('重新授权成功')
        await refreshConnection(conn.id)
        void load()
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重新授权失败')
    }
  }

  return (
    <section data-testid="hk-netdisk-section" style={{ marginTop: 28 }}>
      <div className="hk-dash-section-head hk-netdisk-head">
        <h3 className="hk-dash-section-title">我的网盘</h3>
        <div className="hk-dash-section-extra" style={{ marginLeft: 'auto' }}>
          <NetdiskProviderMenu providers={providers} onPick={handlePick}>
            <Button type="primary" size="small" icon={<PlusOutlined />} data-testid="hk-netdisk-add">
              新增网盘
            </Button>
          </NetdiskProviderMenu>
        </div>
      </div>

      <Spin spinning={loading}>
        {conns.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有网盘连接，点击右上角「新增网盘」接入 NAS（SMB/FTP）、WebDAV、百度网盘或阿里云盘"
            style={{ padding: '28px 0' }}
          />
        ) : (
          <div className="hk-netdisk-grid">
            {conns.map((c) => (
              <NetdiskCard
                key={c.id}
                conn={c}
                onOpen={(x) => navigate(`/netdisk/${x.id}`)}
                onEdit={(x) => setDialog({ kind: x.kind, editing: x })}
                onDelete={handleDelete}
                onReauth={handleReauth}
              />
            ))}
          </div>
        )}
      </Spin>

      {dialog && (
        <NetdiskConnectionDialog
          open
          kind={dialog.kind}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void load()
          }}
        />
      )}
    </section>
  )
}
