/**
 * 「移动」对话框：在网盘内选目标目录（树形懒加载）。
 * 禁止把目录移动到它自己或它的子目录里。
 */

import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Spin, Tree } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { FolderOutlined } from '@ant-design/icons'
import { listDir } from '../../api/netdisk'
import { isValidMoveTarget } from '../../lib/netdisk/path'
import type { NetdiskConnection, NetdiskEntry } from '../../types'

interface Props {
  open: boolean
  connId: number
  connections: NetdiskConnection[]
  /** 被移动的条目（批量时为多条，取第一条做祖先校验） */
  srcPath: string
  onClose: () => void
  onConfirm: (targetConnId: number, targetDir: string) => void
}

interface KNode extends DataNode {
  key: string
  path: string
  children?: KNode[]
}

export default function NetdiskMoveDialog({ open, connId, connections, srcPath, onClose, onConfirm }: Props) {
  const [childrenMap, setChildrenMap] = useState<Map<string, NetdiskEntry[]>>(new Map())
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [target, setTarget] = useState<string>('/')
  const [loading, setLoading] = useState(false)
  const [targetConnId, setTargetConnId] = useState(connId)

  useEffect(() => {
    if (!open) return
    setTarget('/')
    setTargetConnId(connId)
    setExpandedKeys([])
    setChildrenMap(new Map())
    void load('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connId])

  useEffect(() => {
    if (!open) return
    setTarget('/')
    setChildrenMap(new Map())
    void load('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConnId])

  async function load(path: string) {
    setLoading(true)
    try {
      const res = await listDir(targetConnId, path)
      const dirs = res.items.filter((i) => i.is_dir).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      setChildrenMap((prev) => {
        const next = new Map(prev)
        next.set(path, dirs)
        return next
      })
    } catch {
      /* request 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }

  const treeData = useMemo<KNode[]>(() => {
    const build = (parent: string, items: NetdiskEntry[]): KNode[] =>
      items.map((i) => {
        const kids = childrenMap.get(i.path)
        return {
          key: i.path,
          path: i.path,
          title: i.name,
          icon: <FolderOutlined style={{ color: '#faad14' }} />,
          isLeaf: false,
          children: kids ? build(i.path, kids) : undefined,
        } as KNode
      })
    const roots = childrenMap.get('/')
    return roots ? build('/', roots) : []
  }, [childrenMap])

  const ok = targetConnId !== connId || isValidMoveTarget(srcPath, target)

  return (
    <Modal
      open={open}
      title="移动到"
      width={460}
      onCancel={onClose}
      onOk={() => ok && onConfirm(targetConnId, target)}
      okButtonProps={{ disabled: !ok }}
      okText="移动到这里"
    >
      <Spin spinning={loading}>
        <select
          value={targetConnId}
          onChange={(e) => setTargetConnId(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 12, padding: 6, border: '1px solid #d9d9d9', borderRadius: 6 }}
        >
          {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {childrenMap.get('/')?.length === 0 && (
          <Alert type="info" showIcon message="当前网盘没有子目录，只能移动到根目录" style={{ marginBottom: 8 }} />
        )}
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          <Tree
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={[target]}
            loadData={(node) => {
              const p = (node as KNode).path
              return load(p)
            }}
            onExpand={(keys) => setExpandedKeys(keys as React.Key[])}
            onSelect={(keys) => {
              if (keys.length) setTarget(String(keys[0]))
            }}
          />
        </div>
      </Spin>
      {!ok && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message="不能移动到自身或自身的子目录，请选择其它目标"
        />
      )}
    </Modal>
  )
}
