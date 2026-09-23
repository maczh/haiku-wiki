import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, Empty, List, Spin } from 'antd'
import { FolderOutlined } from '@ant-design/icons'
import { getDoc, getTree } from '../../api/docs'
import { iconForDocType } from '../../lib/fileIcon'
import type { DocDetail, DocNode, DocType } from '../../types'
import { getDocMode, isContainerType } from '../docMode'
import { READER_MAP, type H5ReaderProps } from '../readerMap'
import { EDITOR_MAP, type H5EditorProps } from '../editorMap'
import H5DocContainer from '../H5DocContainer'
import { isH5Degraded } from '../styles'
import { useH5Layout } from '../MobileLayout'

/**
 * H5 文档页：统一分发阅读 / 编辑 / 目录容器三种视图。
 *
 *   · 先拉文档详情（含 doc_type / can_write / content）；
 *   · folder（目录）→ 渲染子文档列表（容器视图）；
 *   · 其余类型：editable = getDocMode==='editable' && can_write；
 *       - 可编辑 → 套 EDITOR_MAP[doc_type]（WhiteboardEditor 等），并隐藏底部 Tab；
 *       - 只读   → 套 READER_MAP[doc_type]（reader/* 阅读组件）。
 *   编辑态（editable 且 can_write）额外校验 doc.can_write，无写权限则降级只读。
 */
export default function MDoc() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { setTabHidden, setHeader } = useH5Layout()

  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)

  // 目录容器视图的子文档
  const [children, setChildren] = useState<DocNode[]>([])
  const [childrenLoading, setChildrenLoading] = useState(false)

  // 文档详情
  useEffect(() => {
    const id = Number(docId)
    if (!id) {
      setDoc(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    getDoc(id)
      .then((res) => {
        if (!alive) return
        setDoc(res.doc)
        setCanWrite(!!res.can_write)
      })
      .catch(() => {
        if (alive) setDoc(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [docId])

  const isFolder = !!doc && isContainerType(doc.doc_type)

  // 目录：拉取同库文档树，筛出本目录的直接子节点
  useEffect(() => {
    if (!isFolder || !doc) {
      setChildren([])
      return
    }
    let alive = true
    setChildrenLoading(true)
    getTree(doc.book_id)
      .then((all) => {
        if (!alive) return
        setChildren(all.filter((n) => n.parent_id === doc.id))
      })
      .catch(() => {
        if (alive) setChildren([])
      })
      .finally(() => {
        if (alive) setChildrenLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isFolder, doc])

  const editable = !!doc && !isContainerType(doc.doc_type) && getDocMode(doc.doc_type) === 'editable' && canWrite

  // 编辑态隐藏底部 Tab；离开（卸载/切到只读）恢复
  useEffect(() => {
    setTabHidden(!!editable)
    return () => setTabHidden(false)
  }, [editable, setTabHidden])

  // 顶栏标题 + 返回
  useEffect(() => {
    if (!doc) return
    setHeader({ title: doc.title || '文档', showBack: true })
  }, [doc, setHeader])

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />
  }

  if (!doc) {
    return (
      <div style={{ padding: 16 }}>
        <Alert type="error" showIcon message="文档不存在或加载失败" />
      </div>
    )
  }

  // 目录容器视图
  if (isFolder) {
    return (
      <div style={{ padding: 12 }}>
        <Alert
          type="info"
          showIcon
          message="这是一个目录"
          description="目录本身不存放正文，点击子文档查看内容。"
          style={{ marginBottom: 12, borderRadius: 8 }}
        />
        {childrenLoading ? (
          <Spin style={{ display: 'block', margin: '40px auto' }} />
        ) : children.length === 0 ? (
          <Empty description="目录下还没有文档" style={{ marginTop: 40 }} />
        ) : (
          <List
            style={{ background: '#fff', borderRadius: 10, overflow: 'hidden' }}
            dataSource={children}
            renderItem={(n) => {
              const spec = iconForDocType(n.doc_type)
              const folder = n.doc_type === 'folder'
              return (
                <List.Item
                  role="button"
                  onClick={() => navigate(`/m/doc/${n.id}`)}
                  style={{ cursor: 'pointer', padding: '12px 14px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    {folder ? (
                      <FolderOutlined style={{ color: '#faad14', fontSize: 16, flexShrink: 0 }} />
                    ) : (
                      <span style={{ color: spec.color, fontSize: 16, flexShrink: 0 }}>{spec.icon}</span>
                    )}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: '#1f2329' }}>{n.title || '未命名'}</span>
                  </div>
                </List.Item>
              )
            }}
          />
        )}
      </div>
    )
  }

  // 编辑态
  if (editable) {
    const Editor = EDITOR_MAP[doc.doc_type as DocType]
    if (Editor) {
      const editorProps: H5EditorProps = {
        docId: doc.id,
        initialContent: doc.content,
        title: doc.title,
      }
      const hint =
        doc.doc_type === 'whiteboard'
          ? '白板在手机端可编辑，建议横屏以获得更好体验'
          : undefined
      return (
        <H5DocContainer editing degradedHint={hint}>
          <Editor {...editorProps} />
        </H5DocContainer>
      )
    }
  }

  // 只读态
  const Reader = READER_MAP[doc.doc_type as DocType]
  if (Reader) {
    const readerProps: H5ReaderProps = {
      content: doc.content,
      docId: doc.id,
      bookId: doc.book_id,
      canWrite,
    }
    const hint = isH5Degraded(doc.doc_type)
      ? '该类型在手机端阅读体验有所下降，建议在桌面版编辑'
      : undefined
    return (
      <H5DocContainer degradedHint={hint}>
        <Reader {...readerProps} />
      </H5DocContainer>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <Alert type="warning" showIcon message="暂不支持的文档类型" />
    </div>
  )
}
