import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  DeleteOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { deleteTemplate, importTemplates, listTemplates, type DocTemplate } from '../api/templates'
import { DOC_TYPE_LABEL, type DocType } from '../types'
import { iconForDocType } from '../lib/fileIcon'

/**
 * 管理员「导入模板」页（系统管理 → 导入模板）。
 *
 * 模板正文不再硬编码在后端代码里，而是放在外部 JSON 数据文件中：
 *   - 内置一套（server/internal/repository/templates/*.json）随二进制分发，启动时自动建表灌入；
 *   - 管理员可在这里上传模板数据文件，或直接选中整个模板目录批量导入。
 *
 * 导入进来的模板 builtin=false：与内置模板同名同类型时默认跳过（可开「覆盖」开关强制覆盖），
 * 启动时的内置模板同步也不会覆盖它们。
 */
export default function AdminTemplatesPage() {
  const [builtin, setBuiltin] = useState<DocTemplate[]>([])
  const [imported, setImported] = useState<DocTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const [files, setFiles] = useState<File[]>([])
  const [paths, setPaths] = useState<string[]>([])
  const [overwrite, setOverwrite] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    created: number
    updated: number
    skipped: number
    failed: number
    errors: { file: string; error: string }[]
  } | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)

  async function reload() {
    setLoading(true)
    try {
      const [b, i] = await Promise.all([
        listTemplates({ builtin: true }),
        listTemplates({ builtin: false }),
      ])
      setBuiltin(b)
      setImported(i)
    } catch {
      message.error('加载模板列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  /** 多选文件：与目录选择互斥，后选的覆盖先选的（界面上只保留最近一次选择） */
  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    setFiles(picked)
    setPaths(picked.map((f) => f.name))
    setResult(null)
    e.target.value = ''
  }

  /** 选择模板目录：webkitdirectory 让浏览器把目录内所有文件一次性给出，
   *  webkitRelativePath（目录名/子目录/文件.json）作为展示与报错用的相对路径。 */
  function onPickDir(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []).filter((f) => f.name.toLowerCase().endsWith('.json'))
    if (picked.length === 0) return
    setFiles(picked)
    setPaths(
      picked.map((f) => {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath
        return rel || f.name
      }),
    )
    setResult(null)
    e.target.value = ''
  }

  async function submit() {
    if (files.length === 0) {
      message.warning('请先选择模板数据文件或模板目录')
      return
    }
    setSubmitting(true)
    try {
      const r = await importTemplates(files, overwrite, paths)
      setResult(r)
      if (r.failed > 0) message.warning(`导入完成，${r.failed} 个文件解析失败`)
      else message.success(`导入完成：新增 ${r.created} 条，更新 ${r.updated} 条，跳过 ${r.skipped} 条`)
      await reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      message.error(msg || '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete(t: DocTemplate) {
    try {
      await deleteTemplate(t.id)
      message.success(`已删除模板「${t.name}」`)
      await reload()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      message.error(msg || '删除失败')
    }
  }

  const columns: ColumnsType<DocTemplate> = [
    {
      title: '模板名称',
      dataIndex: 'name',
      render: (_v, t) => (
        <Space size={6}>
          <span style={{ color: iconForDocType(t.doc_type).color }}>{iconForDocType(t.doc_type).icon}</span>
          <span>{t.name}</span>
        </Space>
      ),
    },
    { title: '业务分类', dataIndex: 'category', width: 140 },
    {
      title: '文档类型',
      dataIndex: 'doc_type',
      width: 100,
      render: (v: DocType) => <Tag bordered={false}>{DOC_TYPE_LABEL[v] ?? v}</Tag>,
    },
    { title: '默认标题', dataIndex: 'title', ellipsis: true },
    {
      title: '操作',
      width: 80,
      render: (_v, t) => (
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => void onDelete(t)}>
          删除
        </Button>
      ),
    },
  ]

  const builtinByCat = useMemo(() => {
    const m = new Map<string, number>()
    builtin.forEach((t) => m.set(t.category, (m.get(t.category) || 0) + 1))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [builtin])

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <ImportOutlined style={{ marginRight: 8, color: '#2f54eb' }} />
        导入模板
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        模板以外部 JSON 数据文件维护：内置模板随服务端分发并在启动时自动建表灌入；
        你也可以上传自己的模板数据文件，或直接选中整个模板目录批量导入。导入的模板属于自定义模板，
        不会被内置模板覆盖。
      </Typography.Paragraph>

      <Card size="small" title="选择模板数据文件或目录" style={{ marginBottom: 16 }}>
        <Space wrap size={12}>
          <Button icon={<FileAddOutlined />} onClick={() => fileInput.current?.click()}>
            选择文件
          </Button>
          <Tooltip title="选中一个模板目录，自动收集目录内全部 .json 模板文件">
            <Button icon={<FolderOpenOutlined />} onClick={() => dirInput.current?.click()}>
              选择目录
            </Button>
          </Tooltip>
          <Space size={6}>
            <Switch checked={overwrite} onChange={setOverwrite} />
            <span style={{ fontSize: 13 }}>覆盖同名同分类同类型的已有模板</span>
          </Space>
          <Button type="primary" loading={submitting} disabled={files.length === 0} onClick={() => void submit()}>
            开始导入（{files.length}）
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新列表
          </Button>
        </Space>

        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={onPickFiles}
        />
        {/* webkitdirectory 不是 React 标准属性，用 ref + DOM 赋值规避 TS 类型缺失 */}
        <input
          ref={dirInput}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={onPickDir}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />

        {files.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#8a919f', maxHeight: 120, overflow: 'auto' }}>
            {paths.slice(0, 20).map((p, i) => (
              <div key={`${p}-${i}`}>{p}</div>
            ))}
            {paths.length > 20 && <div>…共 {paths.length} 个文件</div>}
          </div>
        )}

        {result && (
          <Alert
            style={{ marginTop: 12 }}
            type={result.failed > 0 ? 'warning' : 'success'}
            showIcon
            message={`新增 ${result.created} 条 · 更新 ${result.updated} 条 · 跳过 ${result.skipped} 条 · 失败 ${result.failed} 个文件`}
            description={
              result.errors.length > 0 ? (
                <div style={{ maxHeight: 160, overflow: 'auto', fontSize: 12 }}>
                  {result.errors.map((e, i) => (
                    <div key={i}>
                      {e.file}：{e.error}
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            size="small"
            title={`自定义模板（${imported.length}）`}
            extra={<span style={{ fontSize: 12, color: '#8a919f' }}>管理员导入，可删除</span>}
          >
            {imported.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有导入任何模板"
                style={{ margin: '12px 0' }}
              />
            ) : (
              <Table
                rowKey="id"
                size="small"
                loading={loading}
                columns={columns}
                dataSource={imported}
                pagination={{ pageSize: 10, size: 'small' }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="内置模板">
            <Statistic title="内置模板总数" value={builtin.length} loading={loading} />
            <div style={{ marginTop: 12 }}>
              {builtinByCat.map(([cat, n]) => (
                <div
                  key={cat}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}
                >
                  <span style={{ color: '#5a6172' }}>{cat}</span>
                  <span style={{ color: '#8a919f' }}>{n}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card size="small" title="数据文件格式" style={{ marginTop: 16 }}>
            <pre
              style={{
                margin: 0,
                fontSize: 11,
                lineHeight: 1.6,
                background: '#f7f8fa',
                padding: 10,
                borderRadius: 6,
                overflow: 'auto',
                color: '#5a6172',
              }}
            >
              {`{
  "category": "行政办公类文档",
  "templates": [
    {
      "name": "会议纪要",
      "title": "会议纪要",
      "doc_type": "markdown",
      "sort": 1,
      "content": "# 会议纪要\\n\\n..."
    }
  ]
}`}
            </pre>
            <div style={{ fontSize: 12, color: '#8a919f', marginTop: 8 }}>
              doc_type 取 markdown / sheet / mindmap / gantt；sheet、mindmap、gantt 的 content
              可直接写 JSON 对象（也可以写 JSON 字符串）。
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
