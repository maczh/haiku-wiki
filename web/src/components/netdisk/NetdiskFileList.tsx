/**
 * 网盘页右侧「文件 + 目录列表面板」（PRD §4.5）。
 *
 * 目录优先排序；非白名单文件的「预览」「导入到文库」按钮置灰 + Tooltip 说明原因。
 */

import { useMemo, useState } from 'react'
import { Button, Checkbox, Dropdown, Empty, Spin, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  MoreOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import { formatSize, formatTime, isNetdiskImportable, netdiskImportReason } from '../../lib/netdisk/format'
import { isPreviewSupported, previewUnsupportedReason } from '../../lib/netdisk/preview'
import { extOfName } from '../../lib/import/formats'
import { pathSegments } from '../../lib/netdisk/path'
import type { NetdiskConnection, NetdiskEntry } from '../../types'

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
  onNewDir: () => void
  onUpload: () => void
  onPreview: (item: NetdiskEntry) => void
  onDownload: (item: NetdiskEntry) => void
  onImport: (item: NetdiskEntry) => void
  onRename: (item: NetdiskEntry) => void
  onMove: (item: NetdiskEntry) => void
  onDelete: (item: NetdiskEntry) => void
  onBatchDownload: (items: NetdiskEntry[]) => void
  onBatchImport: (items: NetdiskEntry[]) => void
  onBatchDelete: (items: NetdiskEntry[]) => void
  onBatchMove: (items: NetdiskEntry[]) => void
}

/** 目录优先 + 名称排序（中文按拼音） */
function sortEntries(items: NetdiskEntry[]): NetdiskEntry[] {
  return [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
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
}: Props) {
  const [checked, setChecked] = useState<string[]>([])
  const sorted = useMemo(() => sortEntries(entries), [entries])
  const segs = useMemo(() => pathSegments(path), [path])

  const checkedItems = useMemo(
    () => sorted.filter((i) => checked.includes(i.path)),
    [sorted, checked],
  )
  const anyChecked = checkedItems.length > 0

  function toggle(path: string, on: boolean) {
    setChecked((s) => (on ? [...s, path] : s.filter((p) => p !== path)))
  }

  const rowMenu = (item: NetdiskEntry): MenuProps => ({
    items: [
      { key: 'preview', icon: <EyeOutlined />, label: '预览', disabled: item.is_dir || !isPreviewSupported(item.name), onClick: () => onPreview(item) },
      { key: 'download', icon: <DownloadOutlined />, label: '下载', onClick: () => onDownload(item) },
      { key: 'import', icon: <ImportOutlined />, label: '导入到文库', disabled: item.is_dir || !isImportable(item.name), onClick: () => onImport(item) },
      { type: 'divider' },
      { key: 'rename', icon: <EditOutlined />, label: '改名', onClick: () => onRename(item) },
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
        {segs.map((s, i) => (
          <span key={s.path}>
            <span style={{ margin: '0 6px', color: '#c9cdd4' }}>/</span>
            {i === segs.length - 1 ? (
              <span>{s.name}</span>
            ) : (
              <a onClick={() => onGoPath(s.path)}>{s.name}</a>
            )}
          </span>
        ))}
      </div>

      <div className="hk-nd-toolbar">
        <Button type="primary" size="small" icon={<FileAddOutlined />} onClick={onNewDir}>
          新建目录
        </Button>
        <Button size="small" onClick={onUpload} data-testid="hk-netdisk-upload">
          上传
        </Button>
        <Button size="small" onClick={onRefresh}>
          刷新
        </Button>
        <div className="hk-nd-toolbar-spacer" />
        {anyChecked && (
          <>
            <Button size="small" onClick={() => onBatchDownload(checkedItems)}>
              批量下载（{checkedItems.length}）
            </Button>
            <Button size="small" onClick={() => onBatchImport(checkedItems.filter((i) => !i.is_dir))}>
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

      <div className="hk-nd-list">
        <Spin spinning={loading}>
          {sorted.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该目录为空" style={{ padding: '48px 0' }} />
          ) : (
            sorted.map((item) => {
              const previewOk = !item.is_dir && isPreviewSupported(item.name)
              const importOk = !item.is_dir && isImportable(item.name)
              return (
                <div
                  key={item.path}
                  className={`hk-nd-row${checked.includes(item.path) ? ' hk-nd-row-selected' : ''}`}
                  data-testid="hk-netdisk-row"
                >
                  <Checkbox
                    checked={checked.includes(item.path)}
                    onChange={(e) => toggle(item.path, e.target.checked)}
                  />
                  <div
                    className="hk-nd-row-name"
                    onDoubleClick={() => item.is_dir && onOpenDir(item.path)}
                    title={item.is_dir ? '双击进入目录' : item.name}
                  >
                    {item.is_dir ? (
                      <FolderOutlined style={{ color: '#faad14' }} />
                    ) : (
                      <span style={{ color: '#8a919f', fontSize: 11, width: 16, textAlign: 'center' }}>
                        {extOfName(item.name).toUpperCase().slice(0, 4)}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                    {item.is_dir && (
                      <a style={{ fontSize: 12 }} onClick={() => onOpenDir(item.path)}>
                        进入
                      </a>
                    )}
                  </div>
                  <div className="hk-nd-row-meta">{typeLabel(item.name, item.is_dir)}</div>
                  <div className="hk-nd-row-meta">{item.is_dir ? '—' : formatSize(item.size)}</div>
                  <div className="hk-nd-row-meta" style={{ width: 132 }}>
                    {formatTime(item.mod_time)}
                  </div>
                  <div className="hk-nd-row-ops">
                    <Tooltip title={previewOk ? '预览' : previewUnsupportedReason(item.name)}>
                      <Button type="link" size="small" disabled={!previewOk} onClick={() => onPreview(item)}>
                        预览
                      </Button>
                    </Tooltip>
                    <Tooltip title={importOk ? '导入到文库' : netdiskImportReason(item.name)}>
                      <Button type="link" size="small" disabled={!importOk} onClick={() => onImport(item)}>
                        导入
                      </Button>
                    </Tooltip>
                    <Dropdown menu={rowMenu(item)} trigger={['click']}>
                      <Button type="link" size="small" icon={<MoreOutlined />} />
                    </Dropdown>
                  </div>
                </div>
              )
            })
          )}
        </Spin>
      </div>
    </div>
  )
}
