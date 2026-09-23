import type { ComponentType } from 'react'
import type { DocType } from '../types'
import TodoEditor from '../components/editor/TodoEditor'
import CalendarEditor from '../components/editor/CalendarEditor'
import WhiteboardEditor from '../components/editor/WhiteboardEditor'

/** H5 编辑态统一接收的 props（与三个编辑器组件的 Props 完全一致） */
export interface H5EditorProps {
  docId: number
  initialContent: string
  title: string
}

/**
 * 可编辑类型 → 编辑组件 映射（仅白名单三种）。
 *
 * 复用桌面版 TodoEditor / CalendarEditor / WhiteboardEditor 并做移动端触控适配，
 * 不改动编辑器内部逻辑。
 */
export const EDITOR_MAP: Partial<Record<DocType, ComponentType<H5EditorProps>>> = {
  todo: TodoEditor,
  calendar: CalendarEditor,
  whiteboard: WhiteboardEditor,
}
