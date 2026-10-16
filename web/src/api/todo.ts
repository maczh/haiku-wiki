import request from './request'

export interface TodoOption { kind: 'assignee' | 'project'; name: string }
export function listTodoOptions(): Promise<TodoOption[]> {
  return request.get('/todo-options')
}
export async function saveTodoOptions(options: TodoOption[]): Promise<void> {
  for (let i = 0; i < options.length; i += 500) {
    await request.post('/todo-options', { options: options.slice(i, i + 500) })
  }
}
