import request from './request'
import type { Book, Bookshelf, Visibility } from '../types'

export async function listBooks(): Promise<Bookshelf> {
  return request.get('/books') as Promise<Bookshelf>
}

export async function getBook(id: number): Promise<Book> {
  return request.get(`/books/${id}`) as Promise<Book>
}

export async function createBook(payload: {
  name: string
  description?: string
  cover_color?: string
  visibility?: Visibility
}): Promise<Book> {
  return request.post('/books', payload) as Promise<Book>
}

export async function updateBook(
  id: number,
  payload: { name?: string; description?: string; cover_color?: string },
): Promise<Book> {
  return request.put(`/books/${id}`, payload) as Promise<Book>
}

export async function deleteBook(id: number): Promise<void> {
  return request.delete(`/books/${id}`) as Promise<void>
}

export async function setBookVisibility(id: number, visibility: Visibility): Promise<Book> {
  return request.put(`/books/${id}/visibility`, { visibility }) as Promise<Book>
}
