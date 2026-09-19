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

// buildChildrenMap 已迁到 lib/docTree.ts（纯函数，不拉 zustand/React）。
// 这里 re-export 保持既有 `from '../stores/docTreeStore'` 的 import 不变。
export { buildChildrenMap } from '../lib/docTree'
