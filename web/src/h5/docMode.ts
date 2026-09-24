import type { DocType } from '../types'

/** 文档阅读态的权限矩阵结果：可编辑 / 只读 */
export type DocMode = 'editable' | 'readonly'

/**
 * H5 编辑态白名单：以下文档类型在手机版提供内嵌编辑能力。
 *
 *   · whiteboard / todo / calendar —— 复用桌面编辑器，移动端触控适配完成；
 *   · gallery（图片库）—— 复用桌面 `GalleryEditor`（批量上传 + 相册管理），
 *     经 `GalleryEditorH5` 适配器接入 H5 编辑矩阵；上传走本机文件选择，移动端可用。
 *
 * 其余类型（markdown / 表格 / 思维导图 / 流程图 / 绘图 / 甘特图 / 接口 /
 * 附件 / 网页 / 需求原型 / 目录）一律只读。
 */
export const H5_EDITABLE_TYPES: ReadonlyArray<DocType> = ['whiteboard', 'todo', 'calendar', 'gallery']

/**
 * 按文档类型返回 H5 阅读态权限矩阵结果。
 *
 * ⚠️ 目录（doc_type='folder'）不进矩阵 —— 它是容器、本身不承载正文，
 *   调用方须先以 `isContainerType` 判定为容器后再走目录视图，不要传进本函数。
 *
 * @param t 文档类型
 * @returns 'editable'（白名单内）或 'readonly'
 */
export function getDocMode(t: DocType): DocMode {
  return (H5_EDITABLE_TYPES as ReadonlyArray<DocType>).includes(t) ? 'editable' : 'readonly'
}

/**
 * 判定某类型是否为「容器」（目录）。
 *
 * 容器本身不承载正文、不能在阅读/编辑矩阵里处理，需单独渲染子文档列表。
 *
 * @param t 文档类型或任意字符串
 * @returns 仅 doc_type === 'folder' 时返回 true
 */
export function isContainerType(t: DocType | string): boolean {
  return t === 'folder'
}
