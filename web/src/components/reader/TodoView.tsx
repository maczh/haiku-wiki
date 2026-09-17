import { useMemo } from 'react'
import TodoBoard from '../todo/TodoBoard'
import { parseTodoJSON } from '../../lib/todo'

/** 待办清单阅读视图：复用编辑面板，仅关闭所有变更入口。 */
export default function TodoView({ content }: { content: string }) {
  const parsed = useMemo(() => parseTodoJSON(content), [content])
  return (
    <div style={{ paddingTop: 8 }}>
      <TodoBoard value={parsed.data} readOnly />
    </div>
  )
}
