import {
  BookOutlined,
  DeleteOutlined,
  FileAddOutlined,
  GlobalOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UploadOutlined,
} from '@ant-design/icons'

export interface QuickActionHandlers {
  onCreateBook: () => void
  onCreateDoc: () => void
  onImportFile: () => void
  onImportUrl: () => void
  onSearch: () => void
  onTeams: () => void
  onTrash: () => void
  onSettings: () => void
}

interface Item {
  key: keyof QuickActionHandlers
  label: string
  desc: string
  icon: React.ReactNode
  /** 图标底色 / 前景色（低饱和，与语雀风格一致） */
  bg: string
  fg: string
}

const ITEMS: Item[] = [
  { key: 'onCreateBook', label: '新建知识库', desc: '建立独立空间', icon: <BookOutlined />, bg: '#eef2ff', fg: '#2f54eb' },
  { key: 'onCreateDoc', label: '新建文档', desc: '九种文档类型', icon: <FileAddOutlined />, bg: '#e8f7f0', fg: '#13a86b' },
  { key: 'onImportFile', label: '导入文件', desc: 'Word/Excel/PDF/CAD', icon: <UploadOutlined />, bg: '#fff4e6', fg: '#d97706' },
  { key: 'onImportUrl', label: '导入网页', desc: '按链接抓正文', icon: <GlobalOutlined />, bg: '#e6f7f7', fg: '#0d9488' },
  { key: 'onSearch', label: '全文搜索', desc: '标题 + 正文', icon: <SearchOutlined />, bg: '#f3ebff', fg: '#722ed1' },
  { key: 'onTeams', label: '团队', desc: '团队文库与成员', icon: <TeamOutlined />, bg: '#e8f2ff', fg: '#1677ff' },
  { key: 'onTrash', label: '回收站', desc: '恢复已删文档', icon: <DeleteOutlined />, bg: '#f1f3f5', fg: '#5f6672' },
  { key: 'onSettings', label: '账号设置', desc: '昵称与密码', icon: <SettingOutlined />, bg: '#f1f3f5', fg: '#5f6672' },
]

/** 首页快捷操作：一屏直达高频动作，免去「先进知识库再找入口」的两跳。 */
export default function QuickActions(handlers: QuickActionHandlers) {
  return (
    <div className="hk-dash-quick" data-testid="hk-quick-actions">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          type="button"
          className="hk-dash-quick-item"
          title={it.label}
          data-testid={`hk-quick-${it.key.replace(/^on/, '').toLowerCase()}`}
          onClick={handlers[it.key]}
        >
          <span className="hk-dash-quick-icon" style={{ background: it.bg, color: it.fg }}>
            {it.icon}
          </span>
          <span className="hk-dash-quick-text">
            <span className="hk-dash-quick-label" style={{ display: 'block' }}>
              {it.label}
            </span>
            <span className="hk-dash-quick-desc" style={{ display: 'block' }}>
              {it.desc}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
