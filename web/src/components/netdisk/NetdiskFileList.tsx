/**
 * 网盘页右侧「文件 + 目录列表面板」（PRD §4.5）。
 *
 * 仿常规云盘（百度网盘 / 阿里云盘 / OneDrive）的观感：
 *   - 列表 ⇄ 网格 双视图切换（视图偏好存 localStorage）
 *   - 分类筛选 chips（全部 / 图片 / 文档 / 表格 / PDF / 视频 / 音乐 / 压缩包）
 *   - 彩色文件类型图标（NetdiskFileIcon）
 *   - 行内 hover 操作栏 + 「更多」菜单（复用原有 rowMenu）
 *   - 目录优先排序 + 名称 / 大小 / 修改时间 / 类型 排序
 *
 * 目录优先排序；非白名单文件的「预览」「导入到文库」按钮置灰 + Tooltip 说明原因。
 */

import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button, Checkbox, Dropdown, Empty, Select, Spin, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  MoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import {
  categoryOf,
  formatSize,
  formatTime,
  isNetdiskImportable,
  matchesNetdiskCategory,
  netdiskImportReason,
  type NetdiskCategory,
  type NetdiskCategoryFilter,
} from '../../lib/netdisk/format'
import { isPreviewSupported, previewUnsupportedReason } from '../../lib/netdisk/preview'
import { extOfName } from '../../lib/import/formats'
import { pathSegments } from '../../lib/netdisk/path'
import type { NetdiskConnection, NetdiskEntry } from '../../types'
import NetdiskFileIcon from './NetdiskFileIcon'
import NetdiskThumb from './NetdiskThumb'
import NetdiskContextMenu, { type ContextMenuItem } from './NetdiskContextMenu'

interface Props {
  conn: NetdiskConnection
  path: string
  entries: NetdiskEntry[]
  loading: boolean
  /** 进入子目录 */
  onOpenDir: (path: string) => void
  /** 回到某级祖先目录（面包屑） */
  onGoPath: (path: string) => void
  onRefresh: () => void
  onNewDir: (name: string) => void
  onUpload: () => void
  onPreview: (item: NetdiskEntry) => void
  onDownload: (item: NetdiskEntry) => void
  onImport: (item: NetdiskEntry) => void
  onRename: (item: NetdiskEntry, name: string) => void
  onMove: (item: NetdiskEntry) => void
  onDelete: (item: NetdiskEntry) => void
  onBatchDownload: (items: NetdiskEntry[]) => void
  onBatchImport: (items: NetdiskEntry[]) => void
  onBatchDelete: (items: NetdiskEntry[]) => void
  onBatchMove: (items: NetdiskEntry[]) => void
  /** 左侧「快捷分类」导航选中的分类（由 NetdiskPage 持有状态） */
  category: NetdiskCategoryFilter
}

type ViewMode = 'list' | 'grid'
type SortBy = 'name' | 'size' | 'time' | 'type'

const CATEGORY_ORDER: NetdiskCategory[] = [
  'folder',
  'image',
  'doc',
  'sheet',
  'pdf',
  'video',
  'audio',
  'zip',
  'other',
]

/** 目录优先，组内按所选维度排序 */
function sortEntries(items: NetdiskEntry[], sortBy: SortBy): NetdiskEntry[] {
  return [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    switch (sortBy) {
      case 'size':
        return a.size - b.size
      case 'time':
        return new Date(b.mod_time).getTime() - new Date(a.mod_time).getTime()
      case 'type':
        return (
          CATEGORY_ORDER.indexOf(categoryOf(a.name, a.is_dir)) -
          CATEGORY_ORDER.indexOf(categoryOf(b.name, b.is_dir))
        )
      case 'name':
      default:
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
    }
  })
}

/** 是否可导入（严格按 IMPORT_EXTENSIONS，剔除 wps/dps） */
function isImportable(name: string): boolean {
  return isNetdiskImportable(name)
}

/** 该扩展名的人类可读类型 */
function typeLabel(name: string, isDir: boolean): string {
  if (isDir) return '目录'
  const ext = extOfName(name)
  if (!ext) return '文件'
  return ext.toUpperCase()
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'time', label: '修改时间' },
  { value: 'type', label: '类型' },
]

export default function NetdiskFileList({
  conn,
  path,
  entries,
  loading,
  onOpenDir,
  onGoPath,
  onRefresh,
  onNewDir,
  onUpload,
  onPreview,
  onDownload,
  onImport,
  onRename,
  onMove,
  onDelete,
  onBatchDownload,
  onBatchImport,
  onBatchDelete,
  onBatchMove,
  category,
}: Props) {
  const [view, setView] = useState<ViewMode>(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('hk-netdisk-view') : null
    return v === 'grid' ? 'grid' : 'list'
  })
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [checked, setChecked] = useState<string[]>([])
  /** 右键菜单（或点击不可预览文件名弹出的菜单）的状态 */
  const [ctx, setCtx] = useState<{ x: number; y: number; item: NetdiskEntry } | null>(null)
  const [editing, setEditing] = useState<{ path: string; value: string; isNew?: boolean } | null>(null)

  useEffect(() => {
    localStorage.setItem('hk-netdisk-view', view)
  }, [view])

  const sorted = useMemo(() => sortEntries(entries, sortBy), [entries, sortBy])
  const filtered = useMemo(
    () => sorted.filter((i) => matchesNetdiskCategory(i.name, i.is_dir, category)),
    [sorted, category],
  )
  const visible = editing?.isNew
    ? [{ path: '__new-folder__', name: '新文件夹', is_dir: true, size: 0, mod_time: new Date().toISOString() } as NetdiskEntry, ...filtered]
    : filtered
  const segs = useMemo(() => pathSegments(path), [path])

  const checkedItems = useMemo(() => filtered.filter((i) => checked.includes(i.path)), [filtered, checked])
  const anyChecked = checkedItems.length > 0

  const allChecked = filtered.length > 0 && filtered.every((i) => checked.includes(i.path))
  const someChecked = filtered.some((i) => checked.includes(i.path))

  function toggleItem(path: string, on: boolean) {
    setChecked((s) => (on ? [...s, path] : s.filter((p) => p !== path)))
  }

  function toggleAll(on: boolean) {
    setChecked((prev) => {
      const set = new Set(prev)
      if (on) filtered.forEach((i) => set.add(i.path))
      else filtered.forEach((i) => set.delete(i.path))
      return [...set]
    })
  }

  function commitEdit() {
    if (!editing) return
    const name = editing.value.trim()
    if (!name) { setEditing(null); return }
    if (editing.isNew) onNewDir(name)
    else {
      const item = entries.find((entry) => entry.path === editing.path)
      if (item && name !== item.name) onRename(item, name)
    }
    setEditing(null)
  }

  function renderName(item: NetdiskEntry) {
    const active = editing?.path === item.path
    if (active) return <input autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onFocus={(e) => e.currentTarget.select()} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit() } if (e.key === 'Escape') setEditing(null) }} style={{ minWidth: 0, flex: 1, border: '1px solid #1677ff', borderRadius: 4, padding: '3px 6px' }} />
    return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
  }

  /**
   * 构建右键菜单项（目录与文件略有不同）。
   * 目录：打开目录 + 改名 + 移动 + 删除；文件：预览 / 下载 / 导入到文库 + 改名 + 移动 + 删除。
   */
  function buildContextItems(item: NetdiskEntry): ContextMenuItem[] {
    const items: ContextMenuItem[] = []
    if (item.is_dir) {
      items.push({
        key: 'open',
        label: '打开目录',
        icon: <FolderOpenOutlined />,
        onClick: () => onOpenDir(item.path),
      })
    } else {
      items.push({
        key: 'preview',
        label: '预览',
        icon: <EyeOutlined />,
        disabled: !isPreviewSupported(item.name),
        onClick: () => onPreview(item),
      })
      items.push({
        key: 'download',
        label: '下载',
        icon: <DownloadOutlined />,
        onClick: () => onDownload(item),
      })
      items.push({
        key: 'import',
        label: '导入到文库',
        icon: <ImportOutlined />,
        disabled: !isImportable(item.name),
        onClick: () => onImport(item),
      })
    }
    items.push({ key: 'div1', label: '', divider: true })
    items.push({ key: 'rename', label: '改名', icon: <EditOutlined />, onClick: () => setEditing({ path: item.path, value: item.name }) })
    items.push({ key: 'move', label: '移动', icon: <FolderOpenOutlined />, onClick: () => onMove(item) })
    items.push({ key: 'div2', label: '', divider: true })
    items.push({ key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => onDelete(item) })
    return items
  }

  /** 在 (x, y) 处弹出右键菜单 */
  function openMenu(e: ReactMouseEvent, item: NetdiskEntry) {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, item })
  }

  /**
   * 点击文件名：默认预览操作。
   *   - 目录 → 进入目录
   *   - 可预览文件 → 预览
   *   - 不可预览文件 → 弹出右键菜单（PRD 本次需求）
   */
  function handleNameActivate(item: NetdiskEntry, e: ReactMouseEvent) {
    if (item.is_dir) {
      e.preventDefault()
      onOpenDir(item.path)
      return
    }
    if (isPreviewSupported(item.name)) {
      onPreview(item)
      return
    }
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, item })
  }

  const rowMenu = (item: NetdiskEntry): MenuProps => ({
    items: [
      {
        key: 'preview',
        icon: <EyeOutlined />,
        label: '预览',
        disabled: item.is_dir || !isPreviewSupported(item.name),
        onClick: () => onPreview(item),
      },
      {
        key: 'download',
        icon: <DownloadOutlined />,
        label: '下载',
        onClick: () => onDownload(item),
      },
      {
        key: 'import',
        icon: <ImportOutlined />,
        label: '导入到文库',
        disabled: item.is_dir || !isImportable(item.name),
        onClick: () => onImport(item),
      },
      { type: 'divider' },
      { key: 'rename', icon: <EditOutlined />, label: '改名', onClick: () => setEditing({ path: item.path, value: item.name }) },
      { key: 'move', icon: <FolderOpenOutlined />, label: '移动', onClick: () => onMove(item) },
      { type: 'divider' },
      { key: 'delete', label: '删除', danger: true, onClick: () => onDelete(item) },
    ],
  })

  return (
    <div className="hk-nd-main" data-testid="hk-netdisk-filelist">
      <div className="hk-nd-breadcrumb">
        <span style={{ color: '#8a919f' }}>{conn.name}</span>
        <span style={{ margin: '0 6px', color: '#c9cdd4' }}>/</span>
        <a onClick={() => onGoPath('/')}>根目录</a>
        {segs.map((s) => (
          <span key={s.path}>
            <span style={{ margin: '0 6px', color: '#c9cdd4' }}>/</span>
            {s.path === path ? (
              <span>{s.name}</span>
            ) : (
              <a onClick={() => onGoPath(s.path)}>{s.name}</a>
            )}
          </span>
        ))}
      </div>

      <div className="hk-nd-toolbar">
        <Button type="primary" size="small" icon={<FileAddOutlined />} onClick={() => { if (!editing) setEditing({ path: '__new-folder__', value: '新文件夹', isNew: true }) }}>
          新建目录
        </Button>
        <Button size="small" onClick={onUpload} data-testid="hk-netdisk-upload">
          上传
        </Button>
        <Button size="small" onClick={onRefresh}>
          刷新
        </Button>
        <Checkbox
          checked={allChecked}
          indeterminate={!allChecked && someChecked}
          onChange={(e) => toggleAll(e.target.checked)}
          style={{ marginLeft: 4 }}
        >
          全选
        </Checkbox>

        <div className="hk-nd-toolbar-spacer" />

        <Select
          size="small"
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          options={SORT_OPTIONS}
          style={{ width: 110 }}
        />
        <div className="hk-nd-view-toggle">
          <Button
            type={view === 'list' ? 'primary' : 'text'}
            size="small"
            icon={<UnorderedListOutlined />}
            onClick={() => setView('list')}
            title="列表"
          />
          <Button
            type={view === 'grid' ? 'primary' : 'text'}
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => setView('grid')}
            title="网格"
          />
        </div>

        {anyChecked && (
          <>
            <Button size="small" onClick={() => onBatchDownload(checkedItems)}>
              批量下载（{checkedItems.length}）
            </Button>
            <Button
              size="small"
              onClick={() => onBatchImport(checkedItems.filter((i) => !i.is_dir))}
            >
              批量导入（{checkedItems.filter((i) => !i.is_dir).length}）
            </Button>
            <Button size="small" onClick={() => onBatchMove(checkedItems)}>
              批量移动
            </Button>
            <Button size="small" danger onClick={() => onBatchDelete(checkedItems)}>
              批量删除
            </Button>
          </>
        )}
      </div>

      {view === 'list' ? (
        <>
          <div className="hk-nd-list-head">
            <span className="hk-nd-head-check">
              <Checkbox
                checked={allChecked}
                indeterminate={!allChecked && someChecked}
                onChange={(e) => toggleAll(e.target.checked)}
              />
            </span>
            <span className="hk-nd-head-name">文件名</span>
            <span className="hk-nd-head-meta">类型</span>
            <span className="hk-nd-head-meta">大小</span>
            <span className="hk-nd-head-meta hk-nd-head-time">修改时间</span>
            <span className="hk-nd-head-ops">操作</span>
          </div>
          <div className="hk-nd-list">
          <Spin spinning={loading}>
            {filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loading ? '加载中…' : '该目录为空'}
                style={{ padding: '48px 0' }}
              />
            ) : (
              visible.map((item) => {
                const previewOk = !item.is_dir && isPreviewSupported(item.name)
                const importOk = !item.is_dir && isImportable(item.name)
                const selected = checked.includes(item.path)
                return (
                  <div
                    key={item.path}
                    className={`hk-nd-row${selected ? ' hk-nd-row-selected' : ''}`}
                    data-testid="hk-netdisk-row"
                    onContextMenu={(e) => openMenu(e, item)}
                  >
                    <Checkbox
                      checked={selected}
                      onChange={(e) => toggleItem(item.path, e.target.checked)}
                    />
                    <div
                      className="hk-nd-row-name"
                      onClick={(e) => handleNameActivate(item, e)}
                      onDoubleClick={() => item.is_dir && onOpenDir(item.path)}
                      title={item.is_dir ? '双击进入目录' : item.name}
                    >
                      <NetdiskFileIcon name={item.name} isDir={item.is_dir} size={20} />
                      {renderName(item)}
                    </div>
                    <div className="hk-nd-row-meta">{typeLabel(item.name, item.is_dir)}</div>
                    <div className="hk-nd-row-meta">{item.is_dir ? '—' : formatSize(item.size)}</div>
                    <div className="hk-nd-row-meta" style={{ width: 132 }}>
                      {formatTime(item.mod_time)}
                    </div>
                    <div className="hk-nd-row-ops">
                      <Tooltip title={previewOk ? '预览' : previewUnsupportedReason(item.name)}>
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          aria-label={`预览 ${item.name}`}
                          disabled={!previewOk}
                          onClick={() => onPreview(item)}
                        />
                      </Tooltip>
                      <Tooltip title="下载">
                        <Button
                          type="text"
                          size="small"
                          icon={<DownloadOutlined />}
                          aria-label={`下载 ${item.name}`}
                          onClick={() => onDownload(item)}
                        />
                      </Tooltip>
                      <Tooltip title={importOk ? '导入到文库' : netdiskImportReason(item.name)}>
                        <Button
                          type="text"
                          size="small"
                          icon={<ImportOutlined />}
                          aria-label={`导入 ${item.name} 到文库`}
                          disabled={!importOk}
                          onClick={() => onImport(item)}
                        />
                      </Tooltip>
                      <Tooltip title="改名">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          aria-label={`重命名 ${item.name}`}
                          onClick={() => setEditing({ path: item.path, value: item.name })}
                        />
                      </Tooltip>
                      <Tooltip title="移动">
                        <Button
                          type="text"
                          size="small"
                          icon={<FolderOpenOutlined />}
                          aria-label={`移动 ${item.name}`}
                          onClick={() => onMove(item)}
                        />
                      </Tooltip>
                      <Tooltip title="删除">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={`删除 ${item.name}`}
                          onClick={() => onDelete(item)}
                        />
                      </Tooltip>
                      <Dropdown menu={rowMenu(item)} trigger={['click']}>
                        <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`更多操作：${item.name}`} />
                      </Dropdown>
                    </div>
                  </div>
                )
              })
            )}
          </Spin>
        </div>
        </>
      ) : (
        <div className="hk-nd-grid">
          <Spin spinning={loading}>
            {filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loading ? '加载中…' : '该目录为空'}
                style={{ padding: '48px 0' }}
              />
            ) : (
              visible.map((item) => {
                const previewOk = !item.is_dir && isPreviewSupported(item.name)
                const importOk = !item.is_dir && isImportable(item.name)
                const selected = checked.includes(item.path)
                return (
                  <div
                    key={item.path}
                    className={`hk-nd-grid-card${selected ? ' hk-nd-grid-card-selected' : ''}`}
                    data-testid="hk-netdisk-row"
                    onDoubleClick={() => item.is_dir && onOpenDir(item.path)}
                    onContextMenu={(e) => openMenu(e, item)}
                  >
                    <Checkbox
                      className="hk-nd-card-check"
                      checked={selected}
                      onChange={(e) => toggleItem(item.path, e.target.checked)}
                    />
                    <div
                      className="hk-nd-card-tile"
                      onClick={() => item.is_dir && onOpenDir(item.path)}
                    >
                      <NetdiskThumb connId={conn.id} entry={item} size={64} />
                    </div>
                    <div
                      className="hk-nd-card-name"
                      title={item.name}
                      onClick={(e) => handleNameActivate(item, e)}
                    >
                      {renderName(item)}
                    </div>
                    <div className="hk-nd-card-meta">
                      {item.is_dir ? '目录' : `${formatSize(item.size)} · ${formatTime(item.mod_time)}`}
                    </div>
                    <div className="hk-nd-card-ops">
                      <Tooltip title={previewOk ? '预览' : previewUnsupportedReason(item.name)}>
                        <Button
                          type="text"
                          size="small"
                          icon={<EyeOutlined />}
                          aria-label={`预览 ${item.name}`}
                          disabled={!previewOk}
                          onClick={() => onPreview(item)}
                        />
                      </Tooltip>
                      <Tooltip title="下载">
                        <Button
                          type="text"
                          size="small"
                          icon={<DownloadOutlined />}
                          aria-label={`下载 ${item.name}`}
                          onClick={() => onDownload(item)}
                        />
                      </Tooltip>
                      <Tooltip title={importOk ? '导入到文库' : netdiskImportReason(item.name)}>
                        <Button
                          type="text"
                          size="small"
                          icon={<ImportOutlined />}
                          aria-label={`导入 ${item.name} 到文库`}
                          disabled={!importOk}
                          onClick={() => onImport(item)}
                        />
                      </Tooltip>
                      <Dropdown menu={rowMenu(item)} trigger={['click']}>
                        <Button type="text" size="small" icon={<MoreOutlined />} aria-label={`更多操作：${item.name}`} />
                      </Dropdown>
                    </div>
                  </div>
                )
              })
            )}
          </Spin>
        </div>
      )}

      {ctx && (
        <NetdiskContextMenu
          x={ctx.x}
          y={ctx.y}
          items={buildContextItems(ctx.item)}
          onClose={() => setCtx(null)}
        />
      )}
    </div>
  )
}
