import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TodoEditor, { type TodoEditorHandle } from '../../components/editor/TodoEditor'
import TodoCopyDialog from '../../components/todo/TodoCopyDialog'
import { getDoc } from '../../api/docs'
import type { DocNode } from '../../types'
import type { H5EditorProps } from '../editorMap'

export default function TodoEditorH5(props: H5EditorProps) {
  const editor = useRef<TodoEditorHandle>(null)
  const [source, setSource] = useState<DocNode | null>(null)
  const navigate = useNavigate()
  async function openSaveAs() {
    try {
      const { doc } = await getDoc(props.docId)
      setSource(doc)
    } catch { /* 请求拦截器显示错误 */ }
  }
  return <>
    <TodoEditor key={props.docId} {...props} ref={editor} onSaveAs={() => void openSaveAs()} />
    <TodoCopyDialog source={source} getCurrentContent={() => editor.current?.getContent()}
      onClose={() => setSource(null)} onCreated={copy => {
        setSource(null)
        navigate(`/m/doc/${copy.id}`)
      }} />
  </>
}
