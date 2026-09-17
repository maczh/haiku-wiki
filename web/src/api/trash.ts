import request from './request'
import type { TrashItem } from '../types'

export async function listTrash(): Promise<TrashItem[]> {
  return request.get('/trash') as Promise<TrashItem[]>
}
