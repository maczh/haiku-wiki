import { useEffect, useRef, useState } from 'react'
import { Button, Space, Tooltip, message } from 'antd'
import {
  AimOutlined,
  DeleteOutlined,
  DownloadOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
  SisternodeOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons'
import MindMap from 'simple-mind-map'
import Drag from 'simple-mind-map/src/plugins/Drag.js'
import Export from 'simple-mind-map/src/plugins/Export.js'
import { patchDoc } from '../../api/docs'
import { parseMindmapJSON, stringifyMindmap, type SmmNode } from '../../lib/mindmap'
import VersionDrawer from './VersionDrawer'
import SaveIndicator, { type SaveStatus } from './SaveIndicator'

// 插件静态注册（模块级一次即可，所有实例共享）
MindMap.usePlugin(Drag)
MindMap.usePlugin(Export)

interface Props {
  docId: number
  initialContent: string
  title: string
}

const SAVE_DEBOUNCE_MS = 3000

/** 节点实例（simple-mind-map 未暴露类型，仅取用到的属性） */
interface SmmNodeInstance {
  isRoot?: boolean
  getData?(): { text?: string }
}

/**
 * 思维导图编辑器（simple-mind-map 方案）：
 *  全屏画布（支持节点拖拽调整层级、双击编辑文本）+ 顶部工具栏，
 *  mindMap.getData() 取数据 3s 防抖自动保存（v2 契约）+ 手动保存 + 历史版本。
 */
export default function MindmapEditor({ docId, initialContent, title }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mindMapRef = useRef<MindMap | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<SmmNode | null>(null)
  const dirtyRef = useRef(false)
  const titleRef = useRef(title)

  const [status, setStatus] = useState<SaveStatus>('editing')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  /** 是否有激活节点（控制节点操作按钮可用性提示） */
  const [hasActive, setHasActive] = useState(false)

  useEffect(() => {
    const host = elRef.current
    if (!host) return

    const { data, reset } = parseMindmapJSON(initialContent)
    if (reset) message.warning('内容格式异常，已重置默认思维导图')
    latestRef.current = data.root
    dirtyRef.current = false
    setStatus('editing')
    setSavedAt(null)

    const mm = new MindMap({
      el: host,
      data: data.root,
      layout: 'logicalStructure',
      initRootNodePosition: ['center', 'center'],
      enableAutoEnterTextEditWhenKeydown: true,
      mousewheelAction: 'zoom',
    })
    mindMapRef.current = mm

    mm.on('data_change', (d: SmmNode) => {
      latestRef.current = d
      dirtyRef.current = true
      setStatus('editing')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
    })
    mm.on('node_active', (_node: unknown, activeNodeList: unknown[]) => {
      setHasActive(activeNodeList.length > 0)
    })

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      // 切换文档前若有未保存内容，立即保存（fire-and-forget）
      if (dirtyRef.current && latestRef.current) {
        void patchDoc(docId, { content: stringifyMindmap(latestRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
      mindMapRef.current = null
      try {
        mm.destroy()
      } catch {
        /* 重复销毁等场景忽略 */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    const root = latestRef.current
    if (!root) return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: stringifyMindmap(root), source })
      dirtyRef.current = false
      const now = new Date()
      setSavedAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  // ---------- 工具栏操作 ----------

  function requireMindMap(): MindMap | null {
    const mm = mindMapRef.current
    if (!mm) message.warning('画布尚未就绪')
    return mm
  }

  /** 取当前激活节点实例（无激活节点时提示） */
  function requireActiveNode(mm: MindMap): SmmNodeInstance | null {
    const list = mm.renderer.activeNodeList as SmmNodeInstance[]
    const node = list.length > 0 ? list[list.length - 1] : null
    if (!node) message.info('请先单击选中一个节点')
    return node
  }

  function addChild() {
    const mm = requireMindMap()
    if (!mm) return
    if (!requireActiveNode(mm)) return
    mm.execCommand('INSERT_CHILD_NODE')
  }

  function addSibling() {
    const mm = requireMindMap()
    if (!mm) return
    const node = requireActiveNode(mm)
    if (!node) return
    if (node.isRoot) {
      message.info('根节点没有同级节点，请使用「添加子节点」')
      return
    }
    mm.execCommand('INSERT_NODE')
  }

  function removeActiveNode() {
    const mm = requireMindMap()
    if (!mm) return
    const node = requireActiveNode(mm)
    if (!node) return
    if (node.isRoot) {
      message.info('根节点不可删除')
      return
    }
    mm.execCommand('REMOVE_NODE')
  }

  function centerRoot() {
    const mm = requireMindMap()
    if (!mm) return
    mm.renderer.setRootNodeCenter()
    mm.view.reset()
  }

  function zoomIn() {
    requireMindMap()?.view.enlarge()
  }

  function zoomOut() {
    requireMindMap()?.view.narrow()
  }

  async function exportPng() {
    const mm = requireMindMap()
    if (!mm) return
    try {
      await mm.export('png', true, titleRef.current || '思维导图')
    } catch {
      message.error('导出失败，请重试')
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具栏：保存状态 + 节点操作 + 视图操作 + 保存/历史 */}
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
        <Space size={8} wrap={false}>
          <Tooltip title="在选中节点下添加子节点（双击节点可直接编辑文本）">
            <Button size="small" icon={<PlusOutlined />} disabled={!hasActive} onClick={addChild}>
              子节点
            </Button>
          </Tooltip>
          <Tooltip title="为选中节点添加同级节点">
            <Button size="small" icon={<SisternodeOutlined />} disabled={!hasActive} onClick={addSibling}>
              同级节点
            </Button>
          </Tooltip>
          <Tooltip title="删除选中节点及其子树">
            <Button size="small" icon={<DeleteOutlined />} disabled={!hasActive} onClick={removeActiveNode} danger>
              删除节点
            </Button>
          </Tooltip>
          <Tooltip title="根节点居中">
            <Button size="small" icon={<AimOutlined />} onClick={centerRoot} />
          </Tooltip>
          <Tooltip title="放大（Ctrl+=）">
            <Button size="small" icon={<ZoomInOutlined />} onClick={zoomIn} />
          </Tooltip>
          <Tooltip title="缩小（Ctrl+-）">
            <Button size="small" icon={<ZoomOutOutlined />} onClick={zoomOut} />
          </Tooltip>
          <Tooltip title="导出 PNG 图片">
            <Button size="small" icon={<DownloadOutlined />} onClick={() => void exportPng()} />
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

      {/* 画布：simple-mind-map 自管理内部尺寸（拖拽画布平移 / 滚轮缩放） */}
      <div ref={elRef} style={{ flex: 1, minHeight: 0 }} />

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
