// 接口文档（Apifox 风格）数据契约与导入解析。
//
// 正文结构与后端 exportx.ApiDoc 对齐：{ version, base_host, groups:[{id,name,items:[endpoint]}] }。
// endpoint: { id, name, method, uri, base_host?, content_type, headers[], params[], body_type, body, description }。

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

export interface ApiKeyValue {
  key: string
  value: string
  enabled: boolean
  description?: string
}

export interface ApiEndpoint {
  id: string
  name: string
  method: HttpMethod
  uri: string
  base_host?: string
  content_type: string
  headers: ApiKeyValue[]
  params: ApiKeyValue[]
  body_type: 'none' | 'json' | 'form' | 'raw'
  body: string
  description?: string
}

export interface ApiGroup {
  id: string
  name: string
  items: ApiEndpoint[]
}

export interface ApiDoc {
  version: number
  base_host: string
  groups: ApiGroup[]
}

let idSeq = 0
function genId(prefix: string): string {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`
}

export function defaultApiDoc(): ApiDoc {
  return {
    version: 1,
    base_host: '',
    groups: [
      {
        id: genId('g'),
        name: '默认分组',
        items: [defaultEndpoint('未命名接口')],
      },
    ],
  }
}

export function defaultEndpoint(name: string): ApiEndpoint {
  return {
    id: genId('e'),
    name,
    method: 'GET',
    uri: '/',
    content_type: 'application/json',
    headers: [],
    params: [],
    body_type: 'none',
    body: '',
  }
}

/** 解析并归一化存储正文；非法/空内容回退默认文档。 */
export function normalizeApiDoc(content: string): ApiDoc {
  if (!content || !content.trim()) return defaultApiDoc()
  try {
    const o = JSON.parse(content) as Partial<ApiDoc>
    const groups = Array.isArray(o.groups)
      ? o.groups.map((g) => ({
          id: g.id || genId('g'),
          name: g.name || '未命名分组',
          items: Array.isArray(g.items) ? g.items.map(normalizeEndpoint).filter(Boolean) : [],
        }))
      : []
    return {
      version: o.version ?? 1,
      base_host: o.base_host ?? '',
      groups: groups.length ? groups : defaultApiDoc().groups,
    }
  } catch {
    return defaultApiDoc()
  }
}

function normalizeEndpoint(e: Partial<ApiEndpoint>): ApiEndpoint {
  const m = (e.method || 'GET').toUpperCase() as HttpMethod
  return {
    id: e.id || genId('e'),
    name: e.name || '未命名接口',
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(m) ? m : 'GET',
    uri: e.uri ?? '/',
    base_host: e.base_host ?? '',
    content_type: e.content_type ?? 'application/json',
    headers: Array.isArray(e.headers) ? e.headers.map(coerceKV) : [],
    params: Array.isArray(e.params) ? e.params.map(coerceKV) : [],
    body_type: (e.body_type as ApiEndpoint['body_type']) || 'none',
    body: e.body ?? '',
    description: e.description ?? '',
  }
}

function coerceKV(kv: Partial<ApiKeyValue>): ApiKeyValue {
  return { key: kv.key ?? '', value: kv.value ?? '', enabled: kv.enabled !== false, description: kv.description ?? '' }
}

export function serializeApiDoc(doc: ApiDoc): string {
  return JSON.stringify(doc)
}

// ---------- 导入解析 ----------

/** 从一段文本尝试解析为接口文档（自动识别 OpenAPI 2/3、Postman、Apifox）。失败返回 null。 */
export function importApiSpec(text: string): ApiDoc | null {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  const o = obj as Record<string, unknown>
  if (typeof o !== 'object' || o === null) return null
  if (typeof o.swagger === 'string' && o.swagger.startsWith('2')) return parseSwagger2(o)
  if (typeof o.openapi === 'string') return parseOpenAPI3(o)
  if (o.info && (o.paths || o.basePath)) return parseSwagger2(o)
  if (Array.isArray(o.item) && o.info && (o.info as Record<string, unknown>)?.schema) return parsePostman(o)
  if (Array.isArray(o.item)) return parsePostman(o)
  // Apifox 导出的「接口文档」本质是 OpenAPI3，走同一解析。
  return null
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

function parseSwagger2(o: Record<string, unknown>): ApiDoc {
  const paths = (o.paths as Record<string, Record<string, unknown>>) || {}
  const groups: ApiGroup[] = []
  const items: ApiEndpoint[] = []
  for (const [path, ops] of Object.entries(paths)) {
    for (const [m, opRaw] of Object.entries(ops)) {
      const method = m.toUpperCase() as HttpMethod
      if (!METHODS.includes(method)) continue
      const op = (opRaw || {}) as Record<string, unknown>
      const params = Array.isArray(op.parameters) ? (op.parameters as Record<string, unknown>[]) : []
      const headers: ApiKeyValue[] = []
      const query: ApiKeyValue[] = []
      let body = ''
      let bodyType: ApiEndpoint['body_type'] = 'none'
      for (const p of params) {
        const inWhere = String(p.in || '')
        if (inWhere === 'header') {
          headers.push({ key: String(p.name || ''), value: String(p.default ?? p.example ?? ''), enabled: true, description: String(p.description || '') })
        } else if (inWhere === 'query' || inWhere === 'path') {
          query.push({ key: String(p.name || ''), value: String(p.default ?? p.example ?? ''), enabled: true, description: String(p.description || '') })
        } else if (inWhere === 'body') {
          body = schemaToSample(p.schema)
          bodyType = 'json'
        }
      }
      const consumes = Array.isArray(op.consumes) ? (op.consumes as string[]) : (Array.isArray(o.consumes) ? (o.consumes as string[]) : [])
      const contentType = consumes[0] || 'application/json'
      items.push({
        id: genId('e'),
        name: String(op.summary || op.operationId || `${method} ${path}`),
        method,
        uri: path,
        content_type: contentType,
        headers,
        params: query,
        body_type: bodyType,
        body,
        description: String(op.description || ''),
      })
    }
  }
  if (items.length) groups.push({ id: genId('g'), name: 'Swagger 导入', items })
  return { version: 1, base_host: swaggerBaseHost(o), groups }
}

function swaggerBaseHost(o: Record<string, unknown>): string {
  const schemes = Array.isArray(o.schemes) ? (o.schemes as string[]) : ['https']
  const host = typeof o.host === 'string' ? o.host : ''
  const basePath = typeof o.basePath === 'string' ? o.basePath : ''
  if (!host) return ''
  return `${schemes[0] || 'https'}://${host}${basePath}`
}

function parseOpenAPI3(o: Record<string, unknown>): ApiDoc {
  const paths = (o.paths as Record<string, Record<string, unknown>>) || {}
  const servers = Array.isArray(o.servers) ? (o.servers as Record<string, unknown>[]) : []
  const base = servers.length ? String(servers[0].url || '') : ''
  const groups: ApiGroup[] = []
  const items: ApiEndpoint[] = []
  for (const [path, ops] of Object.entries(paths)) {
    for (const [m, opRaw] of Object.entries(ops)) {
      const method = m.toUpperCase() as HttpMethod
      if (!METHODS.includes(method)) continue
      const op = (opRaw || {}) as Record<string, unknown>
      const params = Array.isArray(op.parameters) ? (op.parameters as Record<string, unknown>[]) : []
      const headers: ApiKeyValue[] = []
      const query: ApiKeyValue[] = []
      for (const p of params) {
        const inWhere = String(p.in || '')
        if (inWhere === 'header') headers.push({ key: String(p.name || ''), value: String(p.default ?? ''), enabled: true, description: String(p.description || '') })
        else if (inWhere === 'query' || inWhere === 'path') query.push({ key: String(p.name || ''), value: String(p.default ?? ''), enabled: true, description: String(p.description || '') })
      }
      let body = ''
      let bodyType: ApiEndpoint['body_type'] = 'none'
      let contentType = 'application/json'
      const rb = op.requestBody as Record<string, unknown> | undefined
      if (rb && rb.content && typeof rb.content === 'object') {
        const content = rb.content as Record<string, Record<string, unknown>>
        const ct = Object.keys(content)[0]
        if (ct) {
          contentType = ct
          const schema = content[ct]?.schema
          body = schemaToSample(schema)
          bodyType = 'json'
        }
      }
      items.push({
        id: genId('e'),
        name: String(op.summary || (op.operationId as string) || `${method} ${path}`),
        method,
        uri: path,
        content_type: contentType,
        headers,
        params: query,
        body_type: bodyType,
        body,
        description: String(op.description || ''),
      })
    }
  }
  if (items.length) groups.push({ id: genId('g'), name: 'OpenAPI 导入', items })
  return { version: 1, base_host: base, groups }
}

function parsePostman(o: Record<string, unknown>): ApiDoc {
  const groups: ApiGroup[] = []
  const walk = (items: unknown[], parentName: string) => {
    for (const it of items as Record<string, unknown>[]) {
      if (Array.isArray(it.item)) {
        const name = String(it.name || parentName || '分组')
        const sub = collectPostmanItems(it.item as unknown[])
        if (sub.length) groups.push({ id: genId('g'), name, items: sub })
        else walk(it.item, name)
      }
    }
  }
  walk((o.item as unknown[]) ?? [], 'Postman 导入')
  if (groups.length === 0) {
    const sub = collectPostmanItems(o.item as unknown[])
    if (sub.length) groups.push({ id: genId('g'), name: 'Postman 导入', items: sub })
  }
  return { version: 1, base_host: '', groups }
}

function collectPostmanItems(items: unknown[]): ApiEndpoint[] {
  const out: ApiEndpoint[] = []
  for (const it of items as Record<string, unknown>[]) {
    if (Array.isArray(it.item)) {
      out.push(...collectPostmanItems(it.item as unknown[]))
      continue
    }
    const req = (it.request || {}) as Record<string, unknown>
    if (!req || Object.keys(req).length === 0) continue
    const method = String(req.method || 'GET').toUpperCase() as HttpMethod
    const urlRaw = postmanUrl(req.url)
    const headers = Array.isArray(req.header) ? (req.header as Record<string, unknown>[]).map((h) => ({ key: String(h.key || ''), value: String(h.value || ''), enabled: true, description: String(h.description || '') })) : []
    let body = ''
    let bodyType: ApiEndpoint['body_type'] = 'none'
    let contentType = 'application/json'
    const bh = req.body as Record<string, unknown> | undefined
    if (bh) {
      const mode = String(bh.mode || '')
      if (mode === 'raw') {
        body = String(bh.raw || '')
        bodyType = 'raw'
        const ct = postmanHeaderValue(headers, 'Content-Type')
        if (ct) contentType = ct
        else if (/^\s*[{[]/.test(body)) {
          bodyType = 'json'
          contentType = 'application/json'
        }
      } else if (mode === 'urlencoded' || mode === 'formdata') {
        bodyType = 'form'
        contentType = 'application/x-www-form-urlencoded'
        const flds = Array.isArray(bh.urlencoded) ? (bh.urlencoded as Record<string, unknown>[]) : Array.isArray(bh.formdata) ? (bh.formdata as Record<string, unknown>[]) : []
        body = flds.map((f) => `${encodeURIComponent(String(f.key || ''))}=${encodeURIComponent(String(f.value || ''))}`).join('&')
      }
    }
    out.push({
      id: genId('e'),
      name: String(it.name || `${method} ${urlRaw}`),
      method,
      uri: urlRaw,
      content_type: contentType,
      headers,
      params: [],
      body_type: bodyType,
      body,
    })
  }
  return out
}

function postmanUrl(url: unknown): string {
  if (!url) return '/'
  if (typeof url === 'string') return url
  const u = url as Record<string, unknown>
  if (typeof u.raw === 'string') return u.raw
  const host = Array.isArray(u.host) ? (u.host as string[]).join('') : ''
  const path = Array.isArray(u.path) ? (u.path as string[]).join('/') : ''
  return `/${path}` + (host ? ` (${host})` : '')
}

function postmanHeaderValue(headers: ApiKeyValue[], key: string): string {
  const h = headers.find((x) => x.key.toLowerCase() === key.toLowerCase())
  return h ? h.value : ''
}

/** 把 JSON Schema 转换为可读示例（仅做浅层采样，复杂结构直接回退为 {}）。 */
function schemaToSample(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return ''
  try {
    return JSON.stringify(sampleFromSchema(schema as Record<string, unknown>), null, 2)
  } catch {
    return ''
  }
}

function sampleFromSchema(s: Record<string, unknown>): unknown {
  switch (s.type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      const props = (s.properties as Record<string, Record<string, unknown>>) || {}
      for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v)
      return out
    }
    case 'array':
      return [sampleFromSchema((s.items as Record<string, unknown>) || {})]
    case 'string':
      return (s.example as string) ?? (s.default as string) ?? 'string'
    case 'integer':
    case 'number':
      return (s.example as number) ?? (s.default as number) ?? 0
    case 'boolean':
      return (s.example as boolean) ?? false
    default:
      return (s.example as unknown) ?? null
  }
}
