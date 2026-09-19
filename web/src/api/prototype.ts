import request from './request'
import type { PrototypeItem } from '../types'

/** 需求原型：批量上传（每张必须带标题，可选需求描述）。 */
export async function addPrototypeItems(
  docId: number,
  files: File[],
  titles: string[],
  descs: string[],
): Promise<{
  items: PrototypeItem[]
  rejected: { name: string; reason: string }[]
}> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  form.append('titles', JSON.stringify(titles))
  form.append('descs', JSON.stringify(descs))
  return request.post(`/docs/${docId}/prototype/items`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<{ items: PrototypeItem[]; rejected: { name: string; reason: string }[] }>
}

/** 需求原型：改某条原型的标题与需求描述。 */
export async function updatePrototypeItem(
  docId: number,
  itemId: string,
  title: string,
  desc: string,
): Promise<{ title: string; desc: string }> {
  return request.patch(`/docs/${docId}/prototype/items/${itemId}`, { title, desc }) as Promise<{
    title: string
    desc: string
  }>
}

/** 需求原型：删除一条原型（原件 / 预览图 / 解压出的网页包一并清理）。 */
export async function removePrototypeItem(docId: number, itemId: string): Promise<{ item_id: string }> {
  return request.delete(`/docs/${docId}/prototype/items/${itemId}`) as Promise<{ item_id: string }>
}
