import request from './request'
import type { SearchHit } from '../types'

export async function search(q: string): Promise<SearchHit[]> {
  return request.get('/search', { params: { q } }) as Promise<SearchHit[]>
}
