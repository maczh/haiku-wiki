// 「存放位置（目录）」下拉的选项构造。
//
// ⚠️ 这里的字段名必须是 `value` / `label` —— AntD 的 Select 只认这两个键
// （antd 内部 `fieldNames` 默认 `{label:'label', value:'value'}`）。
//
// 历史 bug：知识库页的新建/导入弹窗曾用 `{id, label}` 构造选项，导致每一项的
// `value` 都是 undefined —— 控件匹配不到任何选项，把原始值 `0`（根目录）当文本
// 显示出来（截图里那个孤零零的「0」）；用户点选任意一项，onChange 拿到的都是
// undefined，最终落库 parent_id=0，于是「无论怎么选都变成 0」。
//
// 现在这张映射集中在本文件，任何需要「选个目录/层级」的地方都从这里取，
// 并由 web/scripts/verify-dashboard.mjs 的用例锁住 value/label 契约。

import { buildChildrenMap } from './docTree'
import type { DocNode } from '../types'

/** 目录下拉的一个选项（字段名即 AntD 契约，勿改） */
export interface DirOption {
  value: number
  label: string
}

/** 根目录哨兵值：后端约定 parent_id=0 表示知识库顶层 */
export const ROOT_DIR_VALUE = 0

/** 根目录选项文案 */
export const ROOT_DIR_LABEL = '根目录（知识库顶层）'

/** 未选知识库时的提示文案（此时目录下拉应禁用） */
export const PICK_BOOK_FIRST = '请先选择知识库'

/** 层级缩进字符（全角空格，保证在 Select 里视觉缩进明显且不会被 trim） */
const INDENT = '　'

/**
 * 把知识库的平铺文档列表转成带层级缩进的目录选项。
 *
 * 任意层级的节点都可选：目录（folder）选它即「放进该目录」，
 * 普通文档选它即「挂在该文档下」（树本来就允许文档有子节点）。
 * 目录额外加「（目录）」后缀，便于在长列表里区分容器与内容。
 */
export function buildDirOptions(docs: DocNode[]): DirOption[] {
  const map = buildChildrenMap(docs)
  const out: DirOption[] = []
  const walk = (parentId: number, depth: number) => {
    for (const d of map.get(parentId) || []) {
      out.push({
        value: d.id,
        label: INDENT.repeat(depth) + (d.title || '未命名') + (d.doc_type === 'folder' ? '（目录）' : ''),
      })
      walk(d.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
}

/** 在目录选项前补上「根目录」 */
export function withRootDir(options: DirOption[]): DirOption[] {
  return [{ value: ROOT_DIR_VALUE, label: ROOT_DIR_LABEL }, ...options]
}
