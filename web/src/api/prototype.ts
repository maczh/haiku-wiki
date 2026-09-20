import request from './request'
import type { BatchAddMeta, BatchManifestEntry, PrototypeItem } from '../types'

/**
 * 需求原型：批量上传（每张必须带标题，可选需求描述）。
 *
 * 两阶段协议（T03b）：可选传 `manifest`（与用户所选条目**等长同序**的唯一真源），
 * `files` 只承载 manifest 中 `kind=file` 的字节。注意 **`titles`/`descs` 必须按
 * manifest 下标对齐**（服务端就是这么取的）——这样被秒传的条目也能拿到自己的标题。
 * manifest 缺省时行为与改造前完全一致。
 */
export async function addPrototypeItems(
  docId: number,
  files: File[],
  titles: string[],
  descs: string[],
  manifest?: BatchManifestEntry[],
): Promise<BatchAddMeta & { items: PrototypeItem[] }> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  form.append('titles', JSON.stringify(titles))
  form.append('descs', JSON.stringify(descs))
  if (manifest) form.append('manifest', JSON.stringify(manifest))
  return request.post(`/docs/${docId}/prototype/items`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<BatchAddMeta & { items: PrototypeItem[] }>
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

/** 需求原型：重新生成某条原型的预览图（三档尺寸），用于首次转换降级后补救。 */
export async function regeneratePrototypeItem(docId: number, itemId: string): Promise<{ item: PrototypeItem }> {
  return request.post(`/docs/${docId}/prototype/items/${itemId}/regenerate`) as Promise<{ item: PrototypeItem }>
}
