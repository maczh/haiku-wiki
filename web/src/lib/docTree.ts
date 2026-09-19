// 目录树的纯函数工具（不依赖 zustand / React，便于 node 侧直接单测）。
//
// 原先 buildChildrenMap 放在 stores/docTreeStore.ts 里，导致任何只想要这个纯函数的
// 模块（如 lib/dirOptions.ts）都会被连带拉进 zustand 与 React 的依赖图。
// 这里抽成独立模块，store 反向 re-export 保持既有 import 路径不变。

import type { DocNode } from '../types'

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
