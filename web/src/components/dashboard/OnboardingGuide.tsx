import { Card, Button } from 'antd'
import { CloseOutlined, BookOutlined, FileAddOutlined, ShareAltOutlined } from '@ant-design/icons'

/**
 * 新手使用向导（首页卡片）。
 *
 * 设计取舍：
 *  · 只给三步（建库 → 建文档 → 分享协作），每步都绑定一个「立刻去做」的动作，
 *    避免变成只读的说明书；
 *  · 关闭入口在右上角，关闭状态由父组件写入 localStorage（key 见 lib/dashboard.ts），
 *    刷新后不再出现；首页欢迎条上仍保留「新手向导」按钮可随时叫回。
 */
interface Props {
  /** 点击「新建知识库」 */
  onCreateBook: () => void
  /** 点击「新建文档」 */
  onCreateDoc: () => void
  /** 点击「分享与协作」（跳转到知识库页面） */
  onShare: () => void
  /** 右上角关闭 */
  onClose: () => void
}

const STEPS: { title: string; desc: string; action: string; icon: React.ReactNode; key: 'book' | 'doc' | 'share' }[] = [
  {
    key: 'book',
    title: '第 1 步 · 新建知识库',
    desc: '一个知识库就是书架上的「一本书」，用来隔离不同项目或团队的资料。可见性分私有 / 成员可见 / 公开三档。',
    action: '新建知识库',
    icon: <BookOutlined />,
  },
  {
    key: 'doc',
    title: '第 2 步 · 新建文档',
    desc: '支持文档、表格、思维导图、流程图、绘图、待办清单、工作日历、甘特图、接口文档九种类型；也可以直接导入现有文件。',
    action: '新建文档',
    icon: <FileAddOutlined />,
  },
  {
    key: 'share',
    title: '第 3 步 · 分享与协作',
    desc: '在文档右键菜单里生成免登录分享链接（可加阅读密码与有效期），或邀请同事加入协作共同编辑。',
    action: '去试试',
    icon: <ShareAltOutlined />,
  },
]

export default function OnboardingGuide({ onCreateBook, onCreateDoc, onShare, onClose }: Props) {
  const handlers: Record<string, () => void> = {
    book: onCreateBook,
    doc: onCreateDoc,
    share: onShare,
  }

  return (
    <Card
      size="small"
      className="hk-dash-onboard"
      data-testid="hk-onboarding-guide"
      title={
        <span style={{ fontSize: 14 }}>
          新手使用向导
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#8a919f' }}>三步开始使用寄海文库</span>
        </span>
      }
      extra={
        <button
          type="button"
          className="hk-dash-dismiss"
          title="不再显示新手向导"
          aria-label="关闭新手向导"
          data-testid="hk-onboarding-close"
          onClick={onClose}
        >
          <CloseOutlined />
        </button>
      }
    >
      {STEPS.map((s, i) => (
        <div className="hk-dash-step" key={s.key}>
          <div className="hk-dash-step-index">{i + 1}</div>
          <div className="hk-dash-step-body">
            <div className="hk-dash-step-title">
              {s.icon}
              <span style={{ marginLeft: 6 }}>{s.title}</span>
            </div>
            <div className="hk-dash-step-desc">{s.desc}</div>
            <Button size="small" type="link" style={{ paddingLeft: 0, height: 22 }} onClick={handlers[s.key]}>
              {s.action} →
            </Button>
          </div>
        </div>
      ))}
    </Card>
  )
}
