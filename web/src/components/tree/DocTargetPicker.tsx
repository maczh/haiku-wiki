import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Select, Spin, TreeSelect } from 'antd'
import { getTree } from '../../api/docs'
import { buildDirTree, withRootDirTree, type DirTreeNode } from '../../lib/dirOptions'
import type { Book, DocNode } from '../../types'

/** 「目标知识库 + 目标位置」的选择结果。parentId=0 表示目标库根目录。 */
export interface DocTarget {
  bookId: number | null
  parentId: number
}

interface Props {
  /** 可作为目标的候选知识库（调用方负责先过滤出有写权限的） */
  books: Book[]
  value: DocTarget
  onChange: (next: DocTarget) => void
  /**
   * 防环：当「目标知识库」正好是 `bookId` 时，从位置树里摘掉 `docId` 这棵子树。
   * 移动/复制时传入被操作节点即可；不传则不做排除。
   */
  exclude?: { bookId: number; docId: number }
  /** 目标知识库的初始值（一般是当前所在库） */
  defaultBookId?: number
  disabled?: boolean
}

/**
 * 「目标知识库 → 目标位置」二级选择器（移动 / 复制弹窗共用）。
 *
 * 设计要点：
 *  1. **位置用 TreeSelect 而不是扁平 Select** —— 目录可以有很多层，
 *     扁平列表要靠全角空格数层数，层数一多就没法看。
 *  2. **根目录是一个真实选项（value=0）** —— 后端约定 parent_id=0 表示知识库顶层；
 *     移动/复制到根目录都是合法操作，必须有入口。
 *  3. **切换知识库就重载它的文档树**，并按 bookId 缓存（同一弹窗里来回切库不会重复请求）。
 *  4. **防环在选项构造层就做掉**（buildDirTree 的 excludeRootId），
 *     而不是等用户选了再报错 —— 非法选项根本不出现在列表里。
 */
export default function DocTargetPicker({ books, value, onChange, exclude, defaultBookId, disabled }: Props) {
  // 每个知识库的文档树缓存（弹窗生命周期内有效）
  const cacheRef = useRef<Map<number, DocNode[]>>(new Map())
  const [tree, setTree] = useState<DirTreeNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 首次进入：没选库时落到默认库（当前所在库）
  useEffect(() => {
    if (value.bookId == null && defaultBookId != null) {
      onChange({ bookId: defaultBookId, parentId: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultBookId])

  const bookId = value.bookId

  useEffect(() => {
    if (bookId == null) {
      setTree(null)
      return
    }
    let alive = true
    const cached = cacheRef.current.get(bookId)
    if (cached) {
      setTree(buildDirTree(cached, exclude && exclude.bookId === bookId ? exclude.docId : undefined))
      setError('')
      return
    }
    setLoading(true)
    setError('')
    getTree(bookId)
      .then((docs) => {
        if (!alive) return
        cacheRef.current.set(bookId, docs)
        setTree(buildDirTree(docs, exclude && exclude.bookId === bookId ? exclude.docId : undefined))
      })
      .catch(() => {
        if (alive) {
          setError('目标知识库的目录加载失败，请重试')
          setTree(null)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // exclude 是对象字面量，逐字段比较避免每次渲染都重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, exclude?.bookId, exclude?.docId])

  const options = useMemo(() => (tree ? withRootDirTree(tree) : []), [tree])

  /** 位置树里的「根目录」节点不可作为父节点的场景（当前没有）——保留 expand 默认行为即可 */
  const treeProps = {
    value: value.parentId,
    treeData: options,
    treeDefaultExpandAll: true,
    showSearch: true,
    treeNodeFilterProp: 'title',
    style: { width: '100%' },
    placeholder: loading ? '加载目录中…' : '选择目标位置（默认根目录）',
    onChange: (v: number) => onChange({ ...value, parentId: v ?? 0 }),
    disabled: disabled || loading || bookId == null,
    notFoundContent: loading ? <Spin size="small" /> : '该知识库还没有文档',
  }

  return (
    <>
      <Select
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="选择目标知识库（我是其成员或拥有者）"
        value={value.bookId ?? undefined}
        onChange={(v: number) => onChange({ bookId: v, parentId: 0 })}
        disabled={disabled}
        showSearch
        optionFilterProp="label"
        options={books.map((b) => ({ value: b.id, label: b.name }))}
        data-testid="hk-target-book"
      />
      <TreeSelect {...treeProps} data-testid="hk-target-parent" />
      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 10 }} />}
      {!loading && !error && tree && tree.length === 0 && (
        <div style={{ fontSize: 12, color: '#8a919f', marginTop: 6 }}>
          该知识库下还没有文档，只能放到根目录。
        </div>
      )}
    </>
  )
}
