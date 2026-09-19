import request from './request'
import type { GalleryImage } from '../types'

/** 图片库：批量上传（服务端立刻生成预览图与缩略图） */
export async function addGalleryImages(docId: number, files: File[]): Promise<{
  images: GalleryImage[]
  rejected: { name: string; reason: string }[]
}> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  return request.post(`/docs/${docId}/gallery/images`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<{ images: GalleryImage[]; rejected: { name: string; reason: string }[] }>
}

/** 图片库：删除一张图（原件与派生图一并清理） */
export async function removeGalleryImage(docId: number, imageId: string): Promise<{ image_id: string }> {
  return request.delete(`/docs/${docId}/gallery/images/${imageId}`) as Promise<{ image_id: string }>
}

/** 图片库：改显示名 */
export async function renameGalleryImage(docId: number, imageId: string, name: string): Promise<{ name: string }> {
  return request.patch(`/docs/${docId}/gallery/images/${imageId}`, { name }) as Promise<{ name: string }>
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
