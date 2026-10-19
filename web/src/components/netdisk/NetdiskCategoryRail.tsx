/**
 * 网盘页左侧「快捷分类」导航（图片 / 文档 / 视频 / 音乐 / 其他）。
 *
 * 仿常规云盘左侧栏：点击切换当前目录下的文件分类筛选（客户端过滤已加载条目，
 * 不新增接口）。当前目录文件随分类实时过滤，与工具栏的视图/排序互不干扰。
 */

import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  CustomerServiceOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { NetdiskCategoryFilter } from '../../lib/netdisk/format'

const RAIL: { key: NetdiskCategoryFilter; label: string; icon: ReactNode }[] = [
  { key: 'all', label: '全部文件', icon: <AppstoreOutlined /> },
  { key: 'image', label: '图片', icon: <FileImageOutlined style={{ color: '#52c41a' }} /> },
  { key: 'doc', label: '文档', icon: <FileTextOutlined style={{ color: '#2f54eb' }} /> },
  { key: 'video', label: '视频', icon: <VideoCameraOutlined style={{ color: '#722ed1' }} /> },
  { key: 'audio', label: '音乐', icon: <CustomerServiceOutlined style={{ color: '#fa8c16' }} /> },
  { key: 'other', label: '其他', icon: <FileOutlined style={{ color: '#8a919f' }} /> },
]

interface Props {
  active: NetdiskCategoryFilter
  onChange: (cat: NetdiskCategoryFilter) => void
}

export default function NetdiskCategoryRail({ active, onChange }: Props) {
  return (
    <div className="hk-nd-side-cats" data-testid="hk-netdisk-cats">
      <div className="hk-nd-side-cats-title">快捷分类</div>
      {RAIL.map((r) => (
        <div
          key={r.key}
          className={`hk-nd-side-cat${active === r.key ? ' active' : ''}`}
          onClick={() => onChange(r.key)}
          title={r.label}
        >
          <span className="hk-nd-side-cat-icon">{r.icon}</span>
          <span className="hk-nd-side-cat-label">{r.label}</span>
        </div>
      ))}
    </div>
  )
}
