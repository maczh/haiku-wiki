import { create } from 'zustand'
import type { DocNode } from '../types'
import { getTree } from '../api/docs'

interface DocTreeState {
  bookId: number | null
  docs: DocNode[]
  loading: boolean
  loadTree: (bookId: number) => Promise<void>
  reset: () => void
  /** 本地更新单个节点（重命名后） */
  patchLocal: (id: number, patch: Partial<DocNode>) => void
}

/** 目录树全局状态：平铺列表 + 前端组树 */
export const useDocTreeStore = create<DocTreeState>((set) => ({
  bookId: null,
  docs: [],
  loading: false,
  loadTree: async (bookId: number) => {
    set({ loading: true })
    try {
      const docs = await getTree(bookId)
      set({ docs, bookId, loading: false })
    } catch {
      set({ loading: false })
    }
  },
  reset: () => set({ bookId: null, docs: [] }),
  patchLocal: (id, patch) =>
    set((st) => ({
      docs: st.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
}))

/** 由平铺列表构建父子索引 */
export function buildChildrenMap(docs: DocNode[]): Map<number, DocNode[]> {
  const map = new Map<number, DocNode[]>()
  for (const d of docs) {
    const list = map.get(d.parent_id) || []
    list.push(d)
    map.set(d.parent_id, list)
  }
  // 同级排序：置顶文档优先（pinned_at 非空在前），其余按 pos（后端 ORDER BY 同规则，前端保证稳定）
  const pinnedRank = (d: DocNode) => (d.pinned_at ? 0 : 1)
  for (const list of map.values()) {
    list.sort((a, b) => {
      const pr = pinnedRank(a) - pinnedRank(b)
      if (pr !== 0) return pr
      return a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0
    })
  }
  return map
}
