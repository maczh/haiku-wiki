/**
 * 网盘页左侧目录树：我的网盘 → 连接 → 目录（逐级懒加载）。
 *
 * 与文库的 KnowledgeTree 同款 antd Tree，但**只加载根目录、不递归预取**，
 * 每展开一级拉一次（设计文档 §3.4-B）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Spin, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FolderOutlined, HddOutlined, CloudOutlined, CloudServerOutlined } from '@ant-design/icons'
import { listDir } from '../../api/netdisk'
import { dirCacheGet, dirCacheInvalidateConn, dirCacheSet } from '../../lib/netdisk/dirCache'
import type { NetdiskConnection, NetdiskEntry } from '../../types'
import { NETDISK_ROOT } from '../../lib/netdisk/constants'

const KIND_ICON: Record<string, React.ReactNode> = {
  smb: <HddOutlined style={{ color: '#2f54eb' }} />,
  ftp: <HddOutlined style={{ color: '#13a8a8' }} />,
  webdav: <CloudServerOutlined style={{ color: '#722ed1' }} />,
  baidu: <CloudOutlined style={{ color: '#2932e1' }} />,
  aliyun: <CloudOutlined style={{ color: '#ff7d00' }} />,
  quark: <CloudOutlined style={{ color: '#8a919f' }} />,
}

interface Props {
  conns: NetdiskConnection[]
  activeConnId: number
  currentPath: string
  /** 选中某目录（点击树的目录节点） */
  onSelect: (connId: number, path: string) => void
  /** 点击连接根节点（无 path 时视为根目录） */
  onSelectConn: (connId: number) => void
  /** 写操作成功后 +1，触发受影响分支重拉 */
  reloadNonce: number
  loading?: boolean
}

interface KNode extends DataNode {
  key: string
  connId?: number
  path?: string
  selectable: boolean
  children?: KNode[]
}

/** 已展开并加载过的目录 key（连接根也算） */
type LoadedMap = Map<string, NetdiskEntry[]>

const connKey = (id: number) => `conn:${id}`
const dirKey = (id: number, path: string) => `dir:${id}:${path}`

export default function NetdiskTree({
  conns,
  activeConnId,
  currentPath,
  onSelect,
  onSelectConn,
  reloadNonce,
  loading = false,
}: Props) {
  const [loaded, setLoaded] = useState<LoadedMap>(new Map())
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [loadingKeys, setLoadingKeys] = useState<React.Key[]>([])
  const loadedRef = useRef<LoadedMap>(new Map())
  loadedRef.current = loaded

  /** 失效某连接的缓存并重拉其已展开分支 */
  const invalidate = useCallback((connId: number) => {
    dirCacheInvalidateConn(connId)
    const next: LoadedMap = new Map()
    for (const [k, v] of loadedRef.current) {
      // 只保留别的连接的已加载数据
      if (!k.startsWith(`conn:${connId}:`) && k !== connKey(connId) && !k.startsWith(`dir:${connId}:`)) {
        next.set(k, v)
      }
    }
    loadedRef.current = next
    setLoaded(next)
  }, [])

  useEffect(() => {
    if (reloadNonce > 0) invalidate(activeConnId)
  }, [reloadNonce, activeConnId, invalidate])

  /** 拉某个目录；命中缓存则直接用 */
  const fetchDir = useCallback(
    async (connId: number, path: string, force = false): Promise<NetdiskEntry[]> => {
      if (!force) {
        const hit = dirCacheGet(connId, path)
        if (hit) return hit
      }
      const res = await listDir(connId, path, force)
      const dirs = res.items.filter((i) => i.is_dir).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      dirCacheSet(connId, path, dirs)
      return dirs
    },
    [],
  )

  /** 懒加载：展开某节点时拉它的子目录 */
  const loadChildren = useCallback(
    async (node: KNode) => {
      if (node.connId == null || node.path == null) return
      const key = node.path === NETDISK_ROOT ? connKey(node.connId) : dirKey(node.connId, node.path)
      setLoadingKeys((s) => [...s, key])
      try {
        const dirs = await fetchDir(node.connId, node.path)
        setLoaded((prev) => {
          const next = new Map(prev)
          next.set(key, dirs)
          return next
        })
      } catch {
        setLoaded((prev) => {
          const next = new Map(prev)
          next.set(key, [])
          return next
        })
      } finally {
        setLoadingKeys((s) => s.filter((k) => k !== key))
      }
    },
    [fetchDir],
  )

  const treeData = useMemo<KNode[]>(() => {
    const buildDirNodes = (connId: number, items: NetdiskEntry[]): KNode[] =>
      items
        .filter((i) => i.is_dir)
        .map((i) => {
          const key = dirKey(connId, i.path)
          const kids = loaded.get(key)
          return {
            key,
            connId,
            path: i.path,
            title: i.name,
            icon: <FolderOutlined style={{ color: '#faad14' }} />,
            isLeaf: false,
            selectable: true,
            children: kids ? buildDirNodes(connId, kids) : undefined,
          } as KNode
        })

    return [
      {
        key: 'cat:netdisk',
        title: (
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            我的网盘
            <span style={{ color: '#8a919f', fontWeight: 400, marginLeft: 6 }}>{conns.length}</span>
          </span>
        ),
        icon: <CloudOutlined style={{ color: '#2f54eb' }} />,
        selectable: false,
        children: conns.map((c) => {
          const kids = loaded.get(connKey(c.id))
          return {
            key: connKey(c.id),
            connId: c.id,
            path: c.root_path || NETDISK_ROOT,
            title: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {c.name}
                {c.status === 'failed' && (
                  <span title={c.last_error || '连接失败'} style={{ color: '#cf1322', fontSize: 12 }}>
                    ⚠
                  </span>
                )}
              </span>
            ),
            icon: KIND_ICON[c.kind] ?? <CloudOutlined />,
            isLeaf: false,
            selectable: true,
            children: kids ? buildDirNodes(c.id, kids) : undefined,
          } as KNode
        }),
      },
    ]
  }, [conns, loaded])

  const selectedKeys = useMemo<React.Key[]>(() => {
    if (!activeConnId) return []
    if (currentPath === NETDISK_ROOT || currentPath === '') return [connKey(activeConnId)]
    return [dirKey(activeConnId, currentPath)]
  }, [activeConnId, currentPath])

  return (
    <div className="hk-nd-side-body" data-testid="hk-netdisk-tree">
      <Spin spinning={loading}>
        {conns.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有网盘连接" style={{ padding: '24px 0' }} />
        ) : (
          <Tree
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={selectedKeys}
            loadedKeys={[]}
            loadData={(node) => loadChildren(node as KNode)}
            onExpand={(keys) => setExpandedKeys(keys as React.Key[])}
            onSelect={(keys, info) => {
              const node = info.node as KNode
              if (node.connId == null) return
              if (node.path && node.path !== NETDISK_ROOT) onSelect(node.connId, node.path)
              else onSelectConn(node.connId)
            }}
          />
        )}
      </Spin>
      {loadingKeys.length > 0 && (
        <div style={{ textAlign: 'center', padding: 6, color: '#8a919f', fontSize: 12 }}>
          <Spin size="small" /> 加载中…
        </div>
      )}
    </div>
  )
}
