import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Popconfirm, Space, Tree, Tooltip, message } from 'antd'
import type { TreeProps } from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  ApartmentOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { patchDoc } from '../../api/docs'
import {
  parseMindmapJSON,
  treeToMarkdown,
  cloneTree,
  stringifyMindmap,
  type MindNode,
} from '../../lib/mindmap'
import MarkmapPreview from '../reader/MarkmapPreview'
import VersionDrawer from './VersionDrawer'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

type DropInfo = Parameters<NonNullable<TreeProps['onDrop']>>[0]

// ---------- 树编辑辅助 ----------

function pathArr(key: string): number[] {
  return key.split('-').map(Number)
}

function getNodeByPath(root: MindNode, path: number[]): MindNode | null {
  let cur: MindNode | null = root
  for (const i of path) {
    cur = cur?.children[i] ?? null
    if (!cur) return null
  }
  return cur
}

function findParent(root: MindNode, target: MindNode): MindNode | null {
  if (root.children.includes(target)) return root
  for (const c of root.children) {
    const r = findParent(c, target)
    if (r) return r
  }
  return null
}

function removeFromTree(root: MindNode, path: number[]): MindNode | null {
  const parentPath = path.slice(0, -1)
  const idx = path[path.length - 1]
  const parent = getNodeByPath(root, parentPath)
  if (!parent || idx < 0 || idx >= parent.children.length) return null
  return parent.children.splice(idx, 1)[0]
}

/** 树 → antd Tree treeData（key 为路径 '0-1-2'，根节点 key='0' 不可拖拽） */
function toTreeData(node: MindNode, path: number[]): DataNode {
  const key = path.join('-') || '0'
  return {
    key,
    title: node.text,
    ...(path.length === 0 ? { icon: <ApartmentOutlined />, draggable: false } : {}),
    children: node.children.map((c, i) => toTreeData(c, [...path, i])),
  }
}

/**
 * 思维导图编辑器（I06 自研轻量方案）：
 *  左树（antd Tree 原生 draggable + 增删改弹层）右 markmap 实时预览，双栏布局。
 *  3s 防抖自动保存 + 手动保存 + 历史版本。
 */
export default function MindmapEditor({ docId, initialContent, title }: Props) {
  const [tree, setTree] = useState<MindNode>(() => cloneTree(parseMindmapJSON(initialContent).data.tree))
  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [editModal, setEditModal] = useState<{ key: string; value: string } | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<MindNode>(tree)
  const dirtyRef = useRef(false)

  // 内容格式异常提示（仅初挂载一次）
  useEffect(() => {
    if (parseMindmapJSON(initialContent).reset) {
      message.warning('内容格式异常，已重置默认思维导图')
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current) {
        void patchDoc(docId, { content: stringifyMindmap(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  function applyTree(next: MindNode) {
    setTree(next)
    latestRef.current = next
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifyMindmap(latestRef.current), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  // ---------- 节点操作 ----------

  function addChild(parentKey: string) {
    const next = cloneTree(latestRef.current)
    const parent = getNodeByPath(next, pathArr(parentKey))
    if (!parent) return
    parent.children.push({ text: '新节点', children: [] })
    applyTree(next)
  }

  function renameNode(key: string, text: string) {
    const next = cloneTree(latestRef.current)
    const node = getNodeByPath(next, pathArr(key))
    if (!node) return
    node.text = text
    applyTree(next)
  }

  function removeNode(key: string) {
    const next = cloneTree(latestRef.current)
    removeFromTree(next, pathArr(key))
    applyTree(next)
  }

  function handleDrop(info: DropInfo) {
    const dragKey = String(info.dragNode.key)
    const dropKey = String(info.node.key)
    const dragPath = pathArr(dragKey)
    const dropPath = pathArr(dropKey)
    // 不能拖到自身或自己的子孙下面
    if (dropKey.startsWith(`${dragKey}-`)) {
      message.warning('不能移动到自身或其子孙节点下')
      return
    }
    const next = cloneTree(latestRef.current)
    const dropRef = getNodeByPath(next, dropPath)
    if (!getNodeByPath(next, dragPath) || !dropRef) return
    const dragged = removeFromTree(next, dragPath)
    if (!dragged) return
    if (info.dropToGap) {
      // 前后插入：dropPosition -1 = 目标前，1 = 目标后
      const parent = findParent(next, dropRef) ?? next
      const idx = parent.children.indexOf(dropRef)
      const insertAt = (info.dropPosition ?? 1) < 0 ? Math.max(0, idx) : idx + 1
      parent.children.splice(insertAt, 0, dragged)
    } else {
      dropRef.children.push(dragged)
    }
    applyTree(next)
  }

  const treeData = [toTreeData(tree, [])]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部状态条 */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          borderBottom: '1px solid #ebedf0',
          background: '#fff',
        }}
      >
        <SaveIndicator status={status} savedAt={savedAt} />
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Tooltip title="在中心主题下添加一级分支">
            <Button size="small" icon={<PlusOutlined />} onClick={() => addChild('0')}>
              添加分支
            </Button>
          </Tooltip>
          <Tooltip title="立即保存（生成手动版本快照）">
            <Button size="small" icon={<SaveOutlined />} onClick={() => void doSave('manual')}>
              保存
            </Button>
          </Tooltip>
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>
            历史版本
          </Button>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* 左：结构树编辑 */}
        <div
          style={{
            width: 340,
            flexShrink: 0,
            borderRight: '1px solid #ebedf0',
            overflow: 'auto',
            padding: '12px 8px',
          }}
        >
          <div style={{ color: '#8a919f', fontSize: 12, padding: '0 8px 8px' }}>
            拖拽调整层级与顺序；悬停节点出现操作按钮
          </div>
          <Tree
            blockNode
            treeData={treeData}
            defaultExpandAll
            draggable={{ icon: false }}
            onDrop={handleDrop}
            titleRender={(n) => {
              const key = String(n.key)
              const isRoot = key === '0'
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title as string}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, paddingRight: 8 }}>
                    <a
                      title="添加子节点"
                      onClick={(e) => {
                        e.stopPropagation()
                        addChild(key)
                      }}
                    >
                      <PlusOutlined />
                    </a>
                    <a
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditModal({ key, value: String(n.title) })
                      }}
                    >
                      ✎
                    </a>
                    {!isRoot && (
                      <Popconfirm
                        title="删除该节点及其子节点？"
                        okText="删除"
                        okType="danger"
                        cancelText="取消"
                        onConfirm={(e) => {
                          e?.stopPropagation()
                          removeNode(key)
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <a title="删除" style={{ color: '#ff4d4f' }} onClick={(e) => e.stopPropagation()}>
                          ✕
                        </a>
                      </Popconfirm>
                    )}
                  </span>
                </span>
              )
            }}
          />
        </div>

        {/* 右：markmap 实时预览 */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <MarkmapPreview markdown={treeToMarkdown(tree)} />
        </div>
      </div>

      {/* 重命名弹层 */}
      <Modal
        title="重命名节点"
        open={!!editModal}
        onOk={() => {
          if (editModal) renameNode(editModal.key, editModal.value.trim() || '未命名节点')
          setEditModal(null)
        }}
        onCancel={() => setEditModal(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={editModal?.value ?? ''}
          autoFocus
          onChange={(e) => setEditModal((m) => (m ? { ...m, value: e.target.value } : m))}
          onPressEnter={() => {
            if (editModal) renameNode(editModal.key, editModal.value.trim() || '未命名节点')
            setEditModal(null)
          }}
        />
      </Modal>

      <VersionDrawer
        open={versionOpen}
        docId={docId}
        title={title}
        docType="mindmap"
        onClose={() => setVersionOpen(false)}
        onRolledBack={() => window.location.reload()}
      />
    </div>
  )
}
