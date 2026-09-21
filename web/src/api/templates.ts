import request from './request'
import type { DocType } from '../types'

/** 文档模板（对应后端 doc_templates 表的内置种子数据） */
export interface DocTemplate {
  id: number
  category: string
  doc_type: DocType
  name: string
  title: string
  content: string
  builtin: boolean
  sort: number
  created_at: string
  updated_at: string
}

/** 模板分类聚合：某分类下涵盖的文档类型与模板数量 */
export interface TemplateCategory {
  category: string
  doc_types: DocType[]
  count: number
}

export interface TemplateQuery {
  category?: string
  doc_type?: DocType
  builtin?: boolean
}

/** 列出文档模板（按业务分类 / 文档类型筛选） */
export async function listTemplates(query: TemplateQuery = {}): Promise<DocTemplate[]> {
  return request.get('/templates', { params: query }) as Promise<DocTemplate[]>
}

/** 列出模板分类聚合（左侧分类导航用） */
export async function listTemplateCategories(): Promise<TemplateCategory[]> {
  return request.get('/templates/categories') as Promise<TemplateCategory[]>
}
