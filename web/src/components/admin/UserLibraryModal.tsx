import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Modal, Popconfirm, Space, Spin, Table, Tabs, Tag, Tree, message } from 'antd'
import { DeleteOutlined, DownloadOutlined, RightOutlined } from '@ant-design/icons'
import { backupLibrary, deleteLibrary, listLibraryDocs, listUserLibraries } from '../../api/admin'
import { VISIBILITY_LABEL } from '../../types'
import type { DocNode, LibraryView } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  userId: number
  username: string
}

/** 把平铺文档列表组装成树（仅展示，用于展开文库时预览文档结构） */
function buildTree(docs: DocNode[]): DocNode[] {
  const byId = new Map<number, DocNode>()
  docs.forEach((d) => byId.set(d.id, { ...d, children: [] }))
  const roots: DocNode[] = []
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children!.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

/**
 * 用户文库管理（仅管理员）：查看某用户的私有文库 / 团队文库，
 * 可展开某库加载文档树、备份（导出 zip）或删除（级联软删文档）。
 */
export default function UserLibraryModal({ open, onClose, userId, username }: Props) {
  const [privateLibs, setPrivateLibs] = useState<LibraryView[]>([])
  const [teamLibs, setTeamLibs] = useState<LibraryView[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [docTree, setDocTree] = useState<DocNode[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listUserLibraries(userId)
      setPrivateLibs(res.private || [])
      setTeamLibs(res.team || [])
    } catch {
      /* 拦截器已提示 */
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (open) {
      setExpanded(null)
      setDocTree([])
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId])

  async function toggleDocs(bookId: number) {
    if (expanded === bookId) {
      setExpanded(null)
      setDocTree([])
      return
    }
    setExpanded(bookId)
    setDocsLoading(true)
    try {
      const docs = await listLibraryDocs(bookId)
      setDocTree(buildTree(docs))
    } catch {
      setDocTree([])
    } finally {
      setDocsLoading(false)
    }
  }

  async function handleBackup(bookId: number) {
    try {
      await backupLibrary(bookId)
      message.success('已开始下载备份')
    } catch {
      /* 拦截器已提示 */
    }
  }

  async function handleDelete(bookId: number) {
    setDeleting(bookId)
    try {
      await deleteLibrary(bookId)
      message.success('文库已删除')
      if (expanded === bookId) {
        setExpanded(null)
        setDocTree([])
      }
      await load()
    } finally {
      setDeleting(null)
    }
  }

  const columns = [
    {
      title: '文库',
      dataIndex: 'name',
      render: (v: string, r: LibraryView) => (
        <Space size={6}>
          <span style={{ fontWeight: 600 }}>{v}</span>
          {r.is_company_kb && <Tag color="purple">公司知识库</Tag>}
        </Space>
      ),
    },
    { title: '可见性', dataIndex: 'visibility', width: 100, render: (v: LibraryView['visibility']) => VISIBILITY_LABEL[v] },
    { title: '文档数', dataIndex: 'doc_count', width: 90 },
    {
      title: '操作',
      key: 'op',
      width: 230,
      render: (_: unknown, r: LibraryView) => (
        <Space>
          <Button size="small" type="text" icon={<RightOutlined />} onClick={() => void toggleDocs(r.id)}>
            {expanded === r.id ? '收起' : '文档'}
          </Button>
          <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => void handleBackup(r.id)}>
            备份
          </Button>
          <Popconfirm
            title={`删除文库「${r.name}」？`}
            description="将级联软删其中的全部文档，删除后可在回收站恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(r.id)}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={deleting === r.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  function renderLibs(libs: LibraryView[]) {
    if (libs.length === 0) return <Empty description="暂无文库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    return (
      <Table<LibraryView>
        rowKey="id"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={libs}
        expandable={{
          expandedRowKeys: expanded ? [expanded] : [],
          expandIcon: () => null,
          expandedRowRender: (r) =>
            expanded === r.id ? (
              <Spin spinning={docsLoading}>
                {docTree.length === 0 ? (
                  <Empty description="该文库暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Tree
                    treeData={docTree.map((n) => toTreeData(n))}
                    defaultExpandAll
                    selectable={false}
                    style={{ padding: '8px 0' }}
                  />
                )}
              </Spin>
            ) : null,
        }}
      />
    )
  }

  return (
    <Modal
      title={
        <span>
          文库管理 · {username}
        </span>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <Spin spinning={loading}>
        <Tabs
          items={[
            { key: 'private', label: `私有文库 (${privateLibs.length})`, children: renderLibs(privateLibs) },
            { key: 'team', label: `团队文库 (${teamLibs.length})`, children: renderLibs(teamLibs) },
          ]}
        />
      </Spin>
    </Modal>
  )
}

/** DocNode → antd Tree treeData（递归） */
function toTreeData(n: DocNode): { key: number; title: string; children?: ReturnType<typeof toTreeData>[] } {
  return {
    key: n.id,
    title: n.title,
    children: n.children?.map((c) => toTreeData(c)),
  }
}
