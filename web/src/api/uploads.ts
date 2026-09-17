import request from './request'
import type { UploadResult } from '../types'

/** multipart 上传（白名单 + ≤20MB 由后端校验） */
export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  return request.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }) as Promise<UploadResult>
}
