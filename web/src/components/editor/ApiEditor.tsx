import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileAddOutlined,
  HistoryOutlined,
  ImportOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { patchDoc } from '../../api/docs'
import { proxyRequest } from '../../api/proxy'
import {
  defaultEndpoint,
  importApiSpec,
  jsonToFields,
  normalizeApiDoc,
  serializeApiDoc,
  type ApiDoc,
  type ApiEndpoint,
  type ApiField,
  type ApiGroup,
  type ApiKeyValue,
  type HttpMethod,
} from '../../lib/apiDoc'
import {
  deleteHistoryByIndex,
  loadHistory,
  saveHistory,
  type DebugHistoryRecord,
} from '../../lib/apiHistory'
import { type SaveStatus } from './SaveIndicator'

interface Props {
  /** 文档 ID（只读模式可不传，此时不落库） */
  docId?: number
  initialContent: string
  title?: string
  /** 只读（阅读模式）：表单禁用、隐藏保存/导入，但调试可用 */
  readOnly?: boolean
}

const SAVE_DEBOUNCE_MS = 2500

const METHOD_COLOR: Record<string, string> = {
  GET: '#1677ff',
  POST: '#52c41a',
  PUT: '#fa8c16',
  DELETE: '#ff4d4f',
  PATCH: '#722ed1',
  HEAD: '#8c8c8c',
  OPTIONS: '#13c2c2',
}

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((m) => ({
  value: m,
  label: <span style={{ color: METHOD_COLOR[m], fontWeight: 600 }}>{m}</span>,
}))

const BODY_TYPE_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: '表单 (x-www-form-urlencoded)' },
  { value: 'raw', label: '原始 (raw)' },
]

const rid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

/** 可编辑的 key/value 列表（请求头 / 请求参数共用）。
 *  - shortKey：字段名框收窄（请求头 / 请求参数用）
 *  - showDesc：是否显示「说明」列（请求参数可隐藏，改由 hover 提示）
 *  - hoverCn：悬停字段名时显示「中文名称 + 类型」提示（GET 请求参数用）
 */
function KVEditor({
  value,
  onChange,
  disabled,
  shortKey,
  showDesc = true,
  hoverCn = false,
}: {
  value: ApiKeyValue[]
  onChange: (v: ApiKeyValue[]) => void
  disabled?: boolean
  shortKey?: boolean
  showDesc?: boolean
  hoverCn?: boolean
}) {
  const update = (i: number, patch: Partial<ApiKeyValue>) =>
    onChange(value.map((kv, idx) => (idx === i ? { ...kv, ...patch } : kv)))
  const add = () => onChange([...value, { key: '', value: '', enabled: true, description: '', type: '' }])
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  return (
    <div>
      {value.length === 0 && (
        <div style={{ color: '#8a919f', fontSize: 13, padding: '8px 0' }}>暂无条目</div>
      )}
      {value.map((kv, i) => {
        const keyInput = (
          <Input
            placeholder="字段名"
            value={kv.key}
            disabled={disabled}
            onChange={(e) => update(i, { key: e.target.value })}
            style={{ width: shortKey ? 130 : 200 }}
          />
        )
        return (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <Checkbox
              checked={kv.enabled}
              disabled={disabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
            />
            {hoverCn && (kv.description || kv.type) ? (
              <Tooltip title={`中文名称：${kv.description || '—'}　类型：${kv.type || '—'}`}>
                {keyInput}
              </Tooltip>
            ) : (
              keyInput
            )}
            <Input
              placeholder="Value"
              value={kv.value}
              disabled={disabled}
              onChange={(e) => update(i, { value: e.target.value })}
              style={{ flex: 1, minWidth: 0 }}
            />
            {showDesc && (
              <Input
                placeholder="说明"
                value={kv.description}
                disabled={disabled}
                onChange={(e) => update(i, { description: e.target.value })}
                style={{ width: 150 }}
              />
            )}
            {!disabled && (
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={() => remove(i)} />
            )}
          </div>
        )
      })}
      {!disabled && (
        <Button size="small" icon={<PlusOutlined />} onClick={add}>
          添加
        </Button>
      )}
    </div>
  )
}

/** 字段参数说明表（请求体 / 返回结果通用）。 */
function FieldTable({ fields }: { fields: ApiField[] }) {
  if (!fields || fields.length === 0) {
    return (
      <div style={{ color: '#8a919f', fontSize: 13, padding: '6px 0' }}>（暂无字段说明）</div>
    )
  }
  return (
    <Table<ApiField>
      size="small"
      style={{ marginTop: 8 }}
      pagination={false}
      columns={[
        {
          title: '字段名',
          dataIndex: 'name',
          key: 'name',
          width: 220,
          ellipsis: true,
          render: (t: string) => <code style={{ fontSize: 12 }}>{t}</code>,
        },
        {
          title: '类型',
          dataIndex: 'type',
          key: 'type',
          width: 90,
          render: (t: string) => <Tag>{t || '—'}</Tag>,
        },
        {
          title: '说明',
          dataIndex: 'description',
          key: 'description',
          render: (t?: string) => t || '—',
        },
        {
          title: '必填',
          dataIndex: 'required',
          key: 'required',
          width: 70,
          render: (r?: boolean) => (r ? <Tag color="red">是</Tag> : '否'),
        },
      ]}
      dataSource={fields.map((f, i) => ({ ...f, key: `${f.name}_${i}` }))}
    />
  )
}

/**
 * 接口文档编辑器（仿 Apifox）：
 *  - 左栏：分组 / 接口树（可新建分组、新建/删除接口）
 *  - 右栏：选中接口的配置（方法/名称/baseHost/uri/Content-Type/请求头/请求参数/请求体）
 *  - 「调试」经服务端 /api/proxy 转发（绕开 CORS + SSRF 防护），返回结果在「返回结果」页
 *  - 「导入」支持 Swagger2 / OpenAPI3 / Apifox / Postman 文件，或从 URL 在线导入
 *  - 内容 2.5s 防抖自动保存（patchDoc）；只读模式下表单禁用但调试仍可用。
 */
export default function ApiEditor({ docId, initialContent, title, readOnly }: Props) {
  const [doc, setDoc] = useState<ApiDoc>(() => normalizeApiDoc(initialContent))
  const docRef = useRef(doc)
  docRef.current = doc
  const [selGroup, setSelGroup] = useState<string | null>(null)
  const [selEp, setSelEp] = useState<string | null>(null)
  const [tab, setTab] = useState('headers')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [debug, setDebug] = useState<null | Awaited<ReturnType<typeof proxyRequest>>>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)

  // 调试历史抽屉
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<DebugHistoryRecord[]>([])

  // 接口右键：重命名 / 移动分组
  const [renameEp, setRenameEp] = useState<{ groupId: string; epId: string; name: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [moveEp, setMoveEp] = useState<{ groupId: string; epId: string } | null>(null)
  const [moveTarget, setMoveTarget] = useState<string>('')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 选中失效时回退到第一篇接口 */
  useEffect(() => {
    const g = doc.groups.find((x) => x.id === selGroup)
    const ep = g?.items.find((x) => x.id === selEp)
    if (ep) return
    const firstG = doc.groups[0]
    const firstEp = firstG?.items[0]
    setSelGroup(firstG?.id ?? null)
    setSelEp(firstEp?.id ?? null)
  }, [doc, selGroup, selEp])

  const current = useMemo(() => {
    const group = doc.groups.find((g) => g.id === selGroup)
    if (!group) return null
    const ep = group.items.find((e) => e.id === selEp)
    if (!ep) return null
    return { group, ep }
  }, [doc, selGroup, selEp])

  /** 阅读模式展示用：除 Host 外的完整 URI（GET 时拼接已启用的 query 参数） */
  const displayUri = useMemo(() => {
    if (!current) return '/'
    let uri = current.ep.uri || '/'
    if (current.ep.method === 'GET') {
      const q = current.ep.params
        .filter((p) => p.enabled && p.key)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
      if (q) uri += (uri.includes('?') ? '&' : '?') + q
    }
    return uri
  }, [current])

  /** 文档自带返回示例的格式化（JSON 美化，非 JSON 原样） */
  const respPretty = useMemo(() => {
    const ex = current?.ep.response_example
    if (!ex) return ''
    try {
      return JSON.stringify(JSON.parse(ex), null, 2)
    } catch {
      return ex
    }
  }, [current])

  const mutate = useCallback(
    (fn: (d: ApiDoc) => ApiDoc) => {
      setDoc((prev) => fn(prev))
      if (!readOnly) scheduleSave()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [readOnly],
  )

  function scheduleSave() {
    if (readOnly || !docId) return
    dirtyRef.current = true
    setStatus('editing')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void doSave('auto'), SAVE_DEBOUNCE_MS)
  }

  async function doSave(source: 'auto' | 'manual') {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!docId) return
    setStatus('saving')
    try {
      await patchDoc(docId, { content: serializeApiDoc(docRef.current), source })
      dirtyRef.current = false
      setStatus('saved')
    } catch {
      setStatus('editing')
    }
  }

  // 卸载前 flush 未保存内容
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (!readOnly && dirtyRef.current && docId) {
        void patchDoc(docId, { content: serializeApiDoc(docRef.current), source: 'auto' }).catch(() => undefined)
        dirtyRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, readOnly])

  // ---------- 分组 / 接口树操作 ----------

  const addGroup = useCallback(() => {
    const g: ApiGroup = { id: rid('g'), name: '新分组', items: [] }
    mutate((d) => ({ ...d, groups: [...d.groups, g] }))
    setSelGroup(g.id)
    setSelEp(null)
  }, [mutate])

  const addEndpoint = useCallback(
    (groupId: string) => {
      const ep = defaultEndpoint('未命名接口')
      mutate((d) => ({
        ...d,
        groups: d.groups.map((g) => (g.id !== groupId ? g : { ...g, items: [...g.items, ep] })),
      }))
      setSelGroup(groupId)
      setSelEp(ep.id)
    },
    [mutate],
  )

  const deleteEndpoint = useCallback(
    (groupId: string, epId: string) => {
      mutate((d) => ({
        ...d,
        groups: d.groups.map((g) =>
          g.id !== groupId ? g : { ...g, items: g.items.filter((e) => e.id !== epId) },
        ),
      }))
    },
    [mutate],
  )

  const deleteGroup = useCallback(
    (groupId: string) => {
      const g = doc.groups.find((x) => x.id === groupId)
      if (g && g.items.length > 0) {
        Modal.confirm({
          title: `删除分组「${g.name}」？`,
          content: `该分组下有 ${g.items.length} 个接口将一并删除。`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: () =>
            mutate((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== groupId) })),
        })
        return
      }
      mutate((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== groupId) }))
    },
    [doc.groups, mutate],
  )

  const renameGroup = useCallback(
    (groupId: string, name: string) => {
      mutate((d) => ({
        ...d,
        groups: d.groups.map((g) => (g.id !== groupId ? g : { ...g, name })),
      }))
    },
    [mutate],
  )

  const patchEndpoint = useCallback(
    (patch: Partial<ApiEndpoint>) => {
      if (!current) return
      mutate((d) => ({
        ...d,
        groups: d.groups.map((g) =>
          g.id !== current.group.id
            ? g
            : { ...g, items: g.items.map((e) => (e.id !== current.ep.id ? e : { ...e, ...patch })) },
        ),
      }))
    },
    [current, mutate],
  )

  // ---------- 接口移动 / 历史 ----------

  /** 把接口从原分组移动到目标分组 */
  const moveEndpoint = useCallback(
    (fromGroupId: string, epId: string, toGroupId: string) => {
      if (fromGroupId === toGroupId) return
      mutate((d) => {
        let moving: ApiEndpoint | undefined
        const without = d.groups.map((g) => {
          if (g.id !== fromGroupId) return g
          moving = g.items.find((e) => e.id === epId)
          return { ...g, items: g.items.filter((e) => e.id !== epId) }
        })
        if (!moving) return d
        return {
          ...d,
          groups: without.map((g) => (g.id !== toGroupId ? g : { ...g, items: [...g.items, moving!] })),
        }
      })
      setSelGroup(toGroupId)
      setSelEp(epId)
    },
    [mutate],
  )

  /** 刷新当前接口的调试历史列表（打开抽屉时调用） */
  const refreshHistory = useCallback(() => {
    if (current) setHistory(loadHistory(docId, current.ep.id))
  }, [current, docId])

  /** 从历史记录回填请求头 / 参数 / 请求体到当前接口 */
  const applyHistory = useCallback(
    (rec: DebugHistoryRecord) => {
      patchEndpoint({
        headers: rec.headers,
        params: rec.params,
        body_type: rec.body_type,
        body: rec.body,
      })
      setHistoryOpen(false)
      message.success('已填入该次调试的请求头 / 参数 / 请求体')
    },
    [patchEndpoint],
  )

  /** 按索引删除一条历史记录 */
  const removeHistory = useCallback(
    (index: number) => {
      if (!current) return
      setHistory(deleteHistoryByIndex(docId, current.ep.id, index))
    },
    [current, docId],
  )

  /** 确认重命名接口（无论是否选中该接口都生效） */
  const doRename = useCallback(() => {
    if (renameEp && renameValue.trim()) {
      const newName = renameValue.trim()
      mutate((d) => ({
        ...d,
        groups: d.groups.map((g) => ({
          ...g,
          items: g.items.map((it) => (it.id === renameEp.epId ? { ...it, name: newName } : it)),
        })),
      }))
    }
    setRenameEp(null)
  }, [renameEp, renameValue, mutate])

  // ---------- 在线调试 ----------

  async function runDebug() {
    if (!current) return
    const ep = current.ep
    const base = (ep.base_host && ep.base_host.trim()) || (doc.base_host && doc.base_host.trim())
    let url = (ep.uri || '/').trim()
    if (base && !/^https?:\/\//i.test(url)) {
      url = base.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`)
    }
    if (!/^https?:\/\//i.test(url)) {
      message.warning('请先填写有效的 baseHost 或完整 URI（含 http(s)://）')
      return
    }
    const headers: Record<string, string> = {}
    for (const h of ep.headers) if (h.enabled && h.key) headers[h.key] = h.value
    let body: string | undefined
    const isForm = ep.body_type === 'form'
    if (isForm) {
      // 表单参数在「请求参数」区填写，作为 application/x-www-form-urlencoded 发送
      const flds = ep.params
        .filter((p) => p.enabled && p.key)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
      body = flds
      if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    } else {
      // 非表单：query 参数拼到 URL；body 按类型发送
      const q = ep.params
        .filter((p) => p.enabled && p.key)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&')
      if (q) url += (url.includes('?') ? '&' : '?') + q
      if (ep.body_type !== 'none' && ep.body) body = ep.body
      if (body && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = ep.content_type || (ep.body_type === 'json' ? 'application/json' : 'text/plain')
      }
    }
    // 记录调试历史（时间 / 接口 / 请求头 / 请求参数 / 请求体），同一接口保留最近 10 条
    setHistory(
      saveHistory(docId, ep.id, {
        time: Date.now(),
        method: ep.method,
        uri: ep.uri,
        base_host: ep.base_host,
        headers: ep.headers,
        params: ep.params,
        body_type: ep.body_type,
        body: ep.body,
      }),
    )
    setDebugLoading(true)
    setDebug(null)
    setTab('result')
    try {
      const res = await proxyRequest({ method: ep.method, url, headers, body })
      setDebug(res)
    } catch (e) {
      message.error((e as Error)?.message || '调试请求失败')
    } finally {
      setDebugLoading(false)
    }
  }

  // ---------- 导入 ----------

  const mergeImported = useCallback(
    (parsed: ApiDoc) => {
      mutate((d) => ({
        version: 1,
        base_host: d.base_host || parsed.base_host || '',
        groups:
          d.groups.length === 1 && d.groups[0].items.length === 0 && d.groups[0].name === '默认分组'
            ? parsed.groups
            : [...d.groups, ...parsed.groups],
      }))
      message.success(`已导入 ${parsed.groups.reduce((n, g) => n + g.items.length, 0)} 个接口`)
    },
    [mutate],
  )

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void file.text().then((text) => {
      const parsed = importApiSpec(text)
      if (!parsed || parsed.groups.length === 0) {
        message.error('无法识别该文件：仅支持 Swagger2 / OpenAPI3 / Apifox / Postman 的 JSON')
        return
      }
      mergeImported(parsed)
    })
  }

  async function importFromUrl() {
    const u = urlValue.trim()
    if (!u) return
    setUrlLoading(true)
    try {
      const res = await proxyRequest({ method: 'GET', url: u })
      const parsed = importApiSpec(res.body)
      if (!parsed || parsed.groups.length === 0) {
        message.error('该 URL 返回内容无法识别为接口文档（Swagger/OpenAPI/Postman 的 JSON）')
        return
      }
      mergeImported(parsed)
      setUrlOpen(false)
      setUrlValue('')
    } catch (err) {
      message.error((err as Error)?.message || '在线导入失败')
    } finally {
      setUrlLoading(false)
    }
  }

  const prettyBody = useMemo(() => {
    if (!debug) return ''
    try {
      return JSON.stringify(JSON.parse(debug.body), null, 2)
    } catch {
      return debug.body
    }
  }, [debug])

  const statusColor = (s: number) => (s >= 200 && s < 300 ? '#52c41a' : s >= 400 ? '#ff4d4f' : '#fa8c16')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      {/* 顶栏工具条 */}
      <div
        style={{
          height: 48,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 16px',
          borderBottom: '1px solid #ebedf0',
        }}
      >
        <ApiOutlined style={{ color: '#13c2c2' }} />
        <span style={{ fontWeight: 600 }}>{title ?? '接口文档'}</span>
        <span style={{ color: '#8a919f', fontSize: 12 }}>全局 Base Host：</span>
        <Input
          value={doc.base_host}
          disabled={readOnly}
          onChange={(e) => mutate((d) => ({ ...d, base_host: e.target.value }))}
          placeholder="https://api.example.com（可选，接口可单独覆盖）"
          style={{ width: 320, fontSize: 12 }}
        />
        <div style={{ flex: 1 }} />
        {!readOnly && (
          <>
            <Dropdown
              menu={{
                items: [
                  { key: 'file', icon: <ImportOutlined />, label: '从文件导入（Swagger/OpenAPI/Apifox/Postman）' },
                  { key: 'url', icon: <LinkOutlined />, label: '从 URL 在线导入' },
                ],
                onClick: ({ key }) => {
                  if (key === 'file') fileInputRef.current?.click()
                  if (key === 'url') setUrlOpen(true)
                },
              }}
            >
              <Button size="small" icon={<ImportOutlined />}>
                导入 <DownOutlined />
              </Button>
            </Dropdown>
            <Button
              size="small"
              icon={<SaveOutlined />}
              onClick={() => void doSave('manual')}
              type={status === 'editing' ? 'primary' : 'default'}
            >
              {status === 'saving' ? '保存中…' : status === 'editing' ? '保存' : '已保存'}
            </Button>
          </>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左栏：分组 / 接口树 */}
        <div
          style={{
            width: 250,
            flexShrink: 0,
            borderRight: '1px solid #f0f2f5',
            overflow: 'auto',
            padding: '8px 0',
          }}
        >
          {doc.groups.map((g) => (
            <div key={g.id} style={{ marginBottom: 4 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  background: g.id === selGroup ? '#f0f5ff' : undefined,
                }}
              >
                <FileAddOutlined style={{ color: '#faad14' }} />
                <Input
                  size="small"
                  variant="borderless"
                  value={g.name}
                  disabled={readOnly}
                  onChange={(e) => renameGroup(g.id, e.target.value)}
                  style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
                />
                {!readOnly && (
                  <Tooltip title="新建接口">
                    <Button
                      size="small"
                      type="text"
                      icon={<PlusOutlined />}
                      onClick={() => addEndpoint(g.id)}
                    />
                  </Tooltip>
                )}
                {!readOnly && (
                  <Tooltip title="删除分组">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => deleteGroup(g.id)}
                    />
                  </Tooltip>
                )}
              </div>
              {g.items.map((e) => {
                const epNode = (
                  <div
                    onClick={() => {
                      setSelGroup(g.id)
                      setSelEp(e.id)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 10px 4px 28px',
                      cursor: 'pointer',
                      background: e.id === selEp ? '#e6f4ff' : undefined,
                    }}
                  >
                    <Tag color={METHOD_COLOR[e.method]} style={{ marginRight: 0, minWidth: 52, textAlign: 'center' }}>
                      {e.method}
                    </Tag>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {e.name}
                    </span>
                    {!readOnly && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          deleteEndpoint(g.id, e.id)
                        }}
                      />
                    )}
                  </div>
                )
                if (readOnly) return <div key={e.id}>{epNode}</div>
                return (
                  <Dropdown
                    key={e.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'rename', icon: <EditOutlined />, label: '重命名' },
                        { key: 'move', icon: <SwapOutlined />, label: '移动分组' },
                        { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'rename') {
                          setRenameValue(e.name)
                          setRenameEp({ groupId: g.id, epId: e.id, name: e.name })
                        } else if (key === 'move') {
                          setMoveTarget('')
                          setMoveEp({ groupId: g.id, epId: e.id })
                        } else if (key === 'delete') {
                          Modal.confirm({
                            title: `删除接口「${e.name}」？`,
                            content: '该接口将被删除，此操作不可撤销。',
                            okText: '删除',
                            okType: 'danger',
                            cancelText: '取消',
                            onOk: () => deleteEndpoint(g.id, e.id),
                          })
                        }
                      },
                    }}
                  >
                    {epNode}
                  </Dropdown>
                )
              })}
            </div>
          ))}
          {!readOnly && (
            <div style={{ padding: '4px 10px' }}>
              <Button size="small" icon={<PlusOutlined />} onClick={addGroup} block>
                新建分组
              </Button>
            </div>
          )}
        </div>

        {/* 右栏：接口配置 + 调试 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!current ? (
            <Empty description="选择左侧接口，或新建一个接口" style={{ marginTop: 80 }} />
          ) : (
            <>
              {/* 接口元信息行 */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f2f5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Select
                    value={current.ep.method}
                    disabled={readOnly}
                    onChange={(v) => patchEndpoint({ method: v as HttpMethod })}
                    options={METHOD_OPTIONS}
                    style={{ width: 110 }}
                  />
                  <Input
                    value={current.ep.name}
                    disabled={readOnly}
                    onChange={(e) => patchEndpoint({ name: e.target.value })}
                    placeholder="接口名称"
                    style={{ width: 240 }}
                  />
                  {readOnly ? (
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <code
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: '#f7f8fa',
                          border: '1px solid #ebedf0',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontFamily: 'monospace',
                          fontSize: 13,
                          overflow: 'auto',
                          whiteSpace: 'nowrap',
                          userSelect: 'text',
                        }}
                      >
                        {displayUri}
                      </code>
                      <Tooltip title="复制 URI（不含 Host）">
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => {
                            void navigator.clipboard.writeText(displayUri)
                            message.success('已复制 URI')
                          }}
                        />
                      </Tooltip>
                    </div>
                  ) : (
                    <Input
                      value={current.ep.uri}
                      disabled={readOnly}
                      onChange={(e) => patchEndpoint({ uri: e.target.value })}
                      placeholder="/path/to/api"
                      style={{ flex: 1, minWidth: 0 }}
                      addonBefore="URI"
                    />
                  )}
                  <Tooltip title="在线调试（经服务端代理转发）">
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={debugLoading} onClick={() => void runDebug()}>
                      调试
                    </Button>
                  </Tooltip>
                  <Tooltip title="调试历史记录（同一接口最近 10 次，可回填）">
                    <Button
                      icon={<HistoryOutlined />}
                      onClick={() => {
                        setHistoryOpen(true)
                        refreshHistory()
                      }}
                    >
                      历史
                    </Button>
                  </Tooltip>
                  <Tooltip title="复制到剪贴板（完整 URL）">
                    <Button
                      icon={<SendOutlined />}
                      onClick={() => {
                        const base =
                          (current.ep.base_host && current.ep.base_host.trim()) ||
                          (doc.base_host && doc.base_host.trim()) ||
                          ''
                        const full = base
                          ? base.replace(/\/$/, '') + (current.ep.uri.startsWith('/') ? current.ep.uri : `/${current.ep.uri}`)
                          : current.ep.uri
                        void navigator.clipboard.writeText(full)
                        message.success('已复制完整地址')
                      }}
                    />
                  </Tooltip>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Input
                    value={current.ep.base_host}
                    disabled={readOnly}
                    onChange={(e) => patchEndpoint({ base_host: e.target.value })}
                    placeholder="本接口 Base Host（留空则用全局）"
                    style={{ width: 320 }}
                    addonBefore="Host"
                  />
                  <Select
                    value={current.ep.content_type}
                    disabled={readOnly}
                    onChange={(v) => patchEndpoint({ content_type: v })}
                    options={[
                      { value: 'application/json', label: 'application/json' },
                      { value: 'application/x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
                      { value: 'multipart/form-data', label: 'multipart/form-data' },
                      { value: 'text/plain', label: 'text/plain' },
                      { value: 'application/xml', label: 'application/xml' },
                    ]}
                    style={{ width: 260 }}
                    showSearch
                  />
                </div>
              </div>

              {/* 配置 Tabs */}
              <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
                <Tabs
                  activeKey={tab}
                  onChange={setTab}
                  items={[
                    {
                      key: 'headers',
                      label: `请求头 (${current.ep.headers.filter((h) => h.enabled).length})`,
                      children: (
                        <KVEditor
                          value={current.ep.headers}
                          disabled={readOnly}
                          shortKey
                          onChange={(v) => patchEndpoint({ headers: v })}
                        />
                      ),
                    },
                    {
                      key: 'params',
                      label: `请求参数 (${current.ep.params.filter((h) => h.enabled).length})`,
                      children: (
                        <KVEditor
                          value={current.ep.params}
                          disabled={readOnly}
                          shortKey
                          showDesc={false}
                          hoverCn
                          onChange={(v) => patchEndpoint({ params: v })}
                        />
                      ),
                    },
                    {
                      key: 'body',
                      label: '请求体',
                      children: (
                        <div>
                          <Select
                            value={current.ep.body_type}
                            disabled={readOnly}
                            onChange={(v) => patchEndpoint({ body_type: v as ApiEndpoint['body_type'] })}
                            options={BODY_TYPE_OPTIONS}
                            style={{ width: 240, marginBottom: 10 }}
                          />
                          {current.ep.body_type === 'none' && (
                            <div style={{ color: '#8a919f', fontSize: 13 }}>该接口无请求体</div>
                          )}
                          {current.ep.body_type === 'form' && (
                            <div>
                              <div style={{ color: '#8a919f', fontSize: 13, marginBottom: 8 }}>
                                表单字段请在上方「请求参数」中填写，将作为{' '}
                                <code>application/x-www-form-urlencoded</code> 发送。
                              </div>
                              <Input.TextArea
                                readOnly
                                value={current.ep.params
                                  .filter((p) => p.enabled && p.key)
                                  .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
                                  .join('&')}
                                autoSize={{ minRows: 3, maxRows: 10 }}
                                style={{ fontFamily: 'monospace', fontSize: 13, color: '#8a919f' }}
                              />
                            </div>
                          )}
                          {(current.ep.body_type === 'json' || current.ep.body_type === 'raw') && (
                            <div>
                              <Input.TextArea
                                value={current.ep.body}
                                disabled={readOnly}
                                onChange={(e) => patchEndpoint({ body: e.target.value })}
                                placeholder={
                                  current.ep.body_type === 'json'
                                    ? '{\n  "key": "value"\n}'
                                    : '原始请求体'
                                }
                                autoSize={{ minRows: 8, maxRows: 20 }}
                                style={{ fontFamily: 'monospace', fontSize: 13 }}
                              />
                              {current.ep.body_type === 'json' && (
                                <>
                                  <Divider orientation="left" plain style={{ margin: '12px 0 4px' }}>
                                    字段参数说明
                                  </Divider>
                                  <FieldTable fields={jsonToFields(current.ep.body)} />
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: 'result',
                      label: '返回结果',
                      children: (
                        <div>
                          {respPretty && (
                            <div style={{ marginBottom: 16 }}>
                              <Divider orientation="left" plain style={{ margin: '4px 0 8px' }}>
                                返回结果示例（文档说明）
                              </Divider>
                              <pre
                                style={{
                                  background: '#f7f8fa',
                                  padding: 12,
                                  borderRadius: 6,
                                  fontSize: 13,
                                  overflow: 'auto',
                                  maxHeight: 360,
                                  fontFamily: 'monospace',
                                }}
                              >
                                {respPretty}
                              </pre>
                              <FieldTable
                                fields={
                                  current.ep.response_fields && current.ep.response_fields.length
                                    ? current.ep.response_fields
                                    : jsonToFields(current.ep.response_example || '')
                                }
                              />
                            </div>
                          )}
                          {debugLoading ? (
                            <div style={{ textAlign: 'center', padding: 40 }}>
                              <Spin /> <span style={{ marginLeft: 8, color: '#8a919f' }}>请求中…</span>
                            </div>
                          ) : !debug ? (
                            <Empty description="点击「调试」发送请求以查看返回结果" style={{ marginTop: 40 }} />
                          ) : (
                            <div>
                              <Space style={{ marginBottom: 10 }} wrap>
                                <Tag color={statusColor(debug.status)} style={{ fontSize: 13 }}>
                                  {debug.status} {debug.status_text}
                                </Tag>
                                <span style={{ color: '#8a919f', fontSize: 13 }}>耗时 {debug.duration_ms} ms</span>
                                <Button
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  onClick={() => void runDebug()}
                                >
                                  重新调试
                                </Button>
                              </Space>
                              <Divider orientation="left" plain style={{ margin: '8px 0' }}>
                                响应头
                              </Divider>
                              <pre
                                style={{
                                  background: '#f7f8fa',
                                  padding: 12,
                                  borderRadius: 6,
                                  fontSize: 12,
                                  maxHeight: 160,
                                  overflow: 'auto',
                                }}
                              >
                                {Object.entries(debug.headers)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join('\n')}
                              </pre>
                              <Divider orientation="left" plain style={{ margin: '8px 0' }}>
                                响应体
                              </Divider>
                              <pre
                                style={{
                                  background: '#f7f8fa',
                                  padding: 12,
                                  borderRadius: 6,
                                  fontSize: 13,
                                  overflow: 'auto',
                                  maxHeight: 360,
                                  fontFamily: 'monospace',
                                }}
                              >
                                {prettyBody}
                              </pre>
                            </div>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 导入文件用隐藏选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={onFileChosen}
      />

      {/* 从 URL 在线导入 */}
      <Modal
        title="从 URL 在线导入接口文档"
        open={urlOpen}
        onOk={() => void importFromUrl()}
        onCancel={() => setUrlOpen(false)}
        okText="导入"
        cancelText="取消"
        confirmLoading={urlLoading}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          粘贴 Swagger2 / OpenAPI3 / Apifox / Postman 文档的 JSON 地址，系统将通过服务端代理拉取并解析（绕开跨域与内网限制）。
        </Typography.Paragraph>
        <Input
          placeholder="https://example.com/swagger.json"
          value={urlValue}
          onChange={(e) => setUrlValue(e.target.value)}
          onPressEnter={() => void importFromUrl()}
        />
      </Modal>

      {/* 调试历史抽屉：列出同一接口最近 10 次调试，可一键回填 */}
      <Drawer
        title="调试历史记录"
        width={460}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        destroyOnClose
      >
        {history.length === 0 ? (
          <Empty description="暂无调试记录，点击「调试」发送请求后会自动记录" style={{ marginTop: 60 }} />
        ) : (
          <List
            dataSource={history}
            renderItem={(rec, idx) => (
              <List.Item
                actions={[
                  <Button key="apply" size="small" onClick={() => applyHistory(rec)}>
                    填入
                  </Button>,
                  <Button
                    key="del"
                    size="small"
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => removeHistory(idx)}
                  />,
                ]}
              >
                <List.Item.Meta
                  avatar={<Tag color={METHOD_COLOR[rec.method]}>{rec.method}</Tag>}
                  title={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{rec.uri || '/'}</span>}
                  description={
                    <span style={{ fontSize: 12, color: '#8a919f' }}>
                      {new Date(rec.time).toLocaleString('zh-CN')}　·　请求头 {rec.headers.filter((h) => h.enabled).length}　·　参数{' '}
                      {rec.params.filter((p) => p.enabled).length}　·　请求体 {rec.body_type}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      {/* 重命名接口 */}
      <Modal
        title="重命名接口"
        open={!!renameEp}
        onOk={doRename}
        onCancel={() => setRenameEp(null)}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={doRename}
          placeholder="接口名称"
          autoFocus
        />
      </Modal>

      {/* 移动接口到其他分组 */}
      <Modal
        title="移动接口到其他分组"
        open={!!moveEp}
        onOk={() => {
          if (moveEp && moveTarget) moveEndpoint(moveEp.groupId, moveEp.epId, moveTarget)
          setMoveEp(null)
        }}
        onCancel={() => setMoveEp(null)}
        okText="移动"
        cancelText="取消"
        destroyOnClose
      >
        <Select
          value={moveTarget || undefined}
          onChange={setMoveTarget}
          placeholder="选择目标分组"
          style={{ width: '100%' }}
          showSearch
          options={doc.groups
            .filter((g) => g.id !== moveEp?.groupId)
            .map((g) => ({ value: g.id, label: g.name }))}
        />
      </Modal>
    </div>
  )
}
