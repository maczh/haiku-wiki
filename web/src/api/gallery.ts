import request from './request'
import type { BatchAddMeta, BatchManifestEntry, GalleryImage } from '../types'

/**
 * 图片库：批量上传（服务端立刻生成预览图与缩略图）。
 *
 * 两阶段协议（T03b）：可选传 `manifest`（与用户所选条目**等长同序**的唯一真源），
 * `files` 只承载 manifest 中 `kind=file` 的字节。**manifest 缺省时行为与改造前完全一致**，
 * 因此老后端 / 未做预检的调用方无需改动。
 */
export async function addGalleryImages(
  docId: number,
  files: File[],
  manifest?: BatchManifestEntry[],
): Promise<BatchAddMeta & { images: GalleryImage[] }> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  if (manifest) form.append('manifest', JSON.stringify(manifest))
  return request.post(`/docs/${docId}/gallery/images`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<BatchAddMeta & { images: GalleryImage[] }>
}

/** 图片库：删除一张图（原件与派生图一并清理） */
export async function removeGalleryImage(docId: number, imageId: string): Promise<{ image_id: string }> {
  return request.delete(`/docs/${docId}/gallery/images/${imageId}`) as Promise<{ image_id: string }>
}

/** 图片库：改显示名 */
export async function renameGalleryImage(docId: number, imageId: string, name: string): Promise<{ name: string }> {
  return request.patch(`/docs/${docId}/gallery/images/${imageId}`, { name }) as Promise<{ name: string }>
}

/** 图片库：重新生成某张图片的预览图（三档尺寸），用于首次转换降级后补救。 */
export async function regenerateGalleryImage(docId: number, imageId: string): Promise<{ image: GalleryImage }> {
  return request.post(`/docs/${docId}/gallery/images/${imageId}/regenerate`) as Promise<{ image: GalleryImage }>
}

/** 本机图片转换能力：用于提示「哪些格式会因缺少转换器而只保存原件」 */
export interface ImageConverterInfo {
  converter: string
  heif_converter: string
  native_formats: string[]
  external_format: string[]
  vector_formats: string[]
  allowed_ext: string[]
  preview_max: number
  thumb_max: number
}

export async function imageConverter(): Promise<ImageConverterInfo> {
  return request.get('/images/converter') as Promise<ImageConverterInfo>
}
