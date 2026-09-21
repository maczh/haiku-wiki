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
  /** 另存为模板的用户；内置模板为 0 */
  created_by: number
  sort: number
  created_at: string
  updated_at: string
}

/** 模板写入字段（另存为 / 管理员编辑共用） */
export interface TemplateInput {
  category: string
  doc_type: DocType
  name: string
  title?: string
  content: string
  sort?: number
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

/** 单个模板数据文件（或目录）导入结果 */
export interface ImportFileError {
  file: string
  error: string
}

export interface TemplateImportResult {
  files: number
  created: number
  updated: number
  skipped: number
  failed: number
  errors: ImportFileError[]
  overwrite: boolean
}

/**
 * 管理员批量导入模板（POST /api/admin/templates/import）。
 * files 可多文件；目录导入时前端把 webkitRelativePath 通过 paths 一并提交，便于报错定位。
 */
export async function importTemplates(
  files: File[],
  overwrite = false,
  paths?: string[],
): Promise<TemplateImportResult> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  form.append('overwrite', overwrite ? '1' : '0')
  if (paths && paths.length) form.append('paths', JSON.stringify(paths))
  return request.post('/admin/templates/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 目录导入可能上百个文件，给足时间
    timeout: 120000,
  }) as Promise<TemplateImportResult>
}

/** 「另存为模板」：把自建文档存成自定义模板（任意登录用户） */
export async function createTemplate(input: TemplateInput): Promise<DocTemplate> {
  return request.post('/templates', input) as Promise<DocTemplate>
}

/** 管理员修改模板（内置模板后端拒绝） */
export async function updateTemplate(id: number, input: TemplateInput): Promise<DocTemplate> {
  return request.put(`/admin/templates/${id}`, input) as Promise<DocTemplate>
}

/** 管理员删除导入的模板（内置模板后端拒绝删除） */
export async function deleteTemplate(id: number): Promise<void> {
  await request.delete(`/admin/templates/${id}`)
}

/** 删除自己另存的模板（他人的模板与内置模板后端拒绝） */
export async function deleteOwnTemplate(id: number): Promise<void> {
  await request.delete(`/templates/${id}`)
}

/**
 * 「常用模板」抽取：按分类轮转取样，保证首页/文库面板里各业务分类都能露脸，
 * 而不是被某一类（或某一字母序靠前的分类）占满。
 */
export function pickCommonTemplates(list: DocTemplate[], limit = 12): DocTemplate[] {
  const byCat = new Map<string, DocTemplate[]>()
  for (const t of list) {
    const arr = byCat.get(t.category)
    if (arr) arr.push(t)
    else byCat.set(t.category, [t])
  }
  const cats = [...byCat.values()]
  const out: DocTemplate[] = []
  // 每个分类内部已按 sort 排好；轮转 rounds 轮直到取够
  for (let round = 0; out.length < limit; round++) {
    let added = false
    for (const arr of cats) {
      if (out.length >= limit) break
      if (round < arr.length) {
        out.push(arr[round])
        added = true
      }
    }
    if (!added) break
  }
  return out
}
