import { useEffect, useRef, useState } from 'react'
import { Button, Divider, Drawer, Radio, Select, Space, Switch, Tooltip } from 'antd'
import { CopyOutlined, PartitionOutlined, SettingOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { MM_LAYOUTS, type MmHandle } from './mmShared'

interface Props {
  handle: MmHandle
  /** 按需生成大纲文本（仅在打开大纲面板时调用，避免每次数据变更都重算） */
  getOutline: () => string
  /**
   * 面板开合通知。抽屉以 `getContainer={false}` 内联渲染在画布容器内，
   * 挂载/卸载与滑入滑出动画都会让浏览器连续 reflow；父组件据此在动画窗口内
   * 跳过画布 resize，避免「resize → render → 再 resize」的抖动回路。
   */
  onPanelToggle?: () => void
  /** 当前布局（结构） */
  layout: string
  /** 布局切换回调 */
  onLayoutChange: (layout: string) => void
}

type PanelKey = 'layout' | 'outline' | 'setting'

/**
 * 思维导图右侧浮动工具条：结构 / 大纲 / 设置。
 * （节点样式 / 基础样式 / 主题 已并入顶部工具条的样式组合，复用 mindmap-vite 自带面板。）
 */
export default function MindmapSideToolbar({
  handle,
  getOutline,
  onPanelToggle,
  layout,
  onLayoutChange,
}: Props) {
  const [panel, setPanel] = useState<PanelKey | null>(null)
  const [mode, setMode] = useState<'edit' | 'readonly'>('edit')
  const [wheel, setWheel] = useState<'zoom' | 'move'>('zoom')
  const [freeDrag, setFreeDrag] = useState(false)

  const close = () => setPanel(null)

  // 面板开合 → 通知父组件（抽屉动画期间不要 resize 画布）
  useEffect(() => {
    onPanelToggle?.()
  }, [onPanelToggle, panel])

  /**
   * 连点防护：结构等「整树重排」类操作很重，
   * 同一个动作 150ms 内重复触发直接丢弃。
   */
  const lastCmdRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  function throttleCmd(key: string, run: () => void) {
    const now = Date.now()
    const last = lastCmdRef.current
    if (last.key === key && now - last.at < 150) return
    lastCmdRef.current = { key, at: now }
    run()
  }

  return (
    <>
      {/* 右侧竖排入口 */}
      <div className="hk-mm-tb hk-mm-side">
        <SideBtn icon={<PartitionOutlined />} label="结构" onClick={() => setPanel('layout')} />
        <SideBtn icon={<UnorderedListOutlined />} label="大纲" onClick={() => setPanel('outline')} />
        <SideBtn icon={<SettingOutlined />} label="设置" onClick={() => setPanel('setting')} />
      </div>

      {/* ---------- 结构 ---------- */}
      <Drawer title="结构" width={320} open={panel === 'layout'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        <Radio.Group
          value={layout}
          onChange={(e) => {
            const next = e.target.value as string
            // 结构切换同样触发整树重排：同一目标值 150ms 内重复请求直接丢弃
            throttleCmd(`layout:${next}`, () => {
              onLayoutChange(next)
              handle.toast('结构已切换', 'success')
            })
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {MM_LAYOUTS.map((l) => (
            <Radio key={l.value} value={l.value}>
              {l.label}
            </Radio>
          ))}
        </Radio.Group>
      </Drawer>

      {/* ---------- 大纲 ---------- */}
      <Drawer
        title="大纲"
        width={360}
        open={panel === 'outline'}
        onClose={close}
        mask={false}
        getContainer={false}
        rootClassName="hk-mm-drawer"
        extra={
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              void navigator.clipboard.writeText(getOutline())
              handle.toast('大纲已复制到剪贴板', 'success')
            }}
          >
            复制
          </Button>
        }
      >
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.9, margin: 0, fontFamily: 'inherit' }}>
          {getOutline() || '（空导图）'}
        </pre>
      </Drawer>

      {/* ---------- 设置 ---------- */}
      <Drawer title="设置" width={320} open={panel === 'setting'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        <Section title="交互">
          <Row label="只读模式">
            <Switch
              size="small"
              checked={mode === 'readonly'}
              onChange={(v) => {
                const next = v ? 'readonly' : 'edit'
                handle.setMode(next)
                setMode(next)
                handle.toast(v ? '已切换为只读模式' : '已恢复编辑模式', 'success')
              }}
            />
          </Row>
          <Row label="滚轮行为">
            <Select
              size="small"
              style={{ width: 130 }}
              value={wheel}
              options={[
                { value: 'zoom', label: '缩放画布' },
                { value: 'move', label: '平移画布' },
              ]}
              onChange={(v: 'zoom' | 'move') => {
                handle.setWheelAction(v)
                setWheel(v)
              }}
            />
          </Row>
          <Row label="自由拖拽">
            <Switch
              size="small"
              checked={freeDrag}
              onChange={(v) => {
                handle.setFreeDrag(v)
                setFreeDrag(v)
                handle.toast(v ? '已开启画布自由拖拽' : '已关闭画布自由拖拽', 'success')
              }}
            />
          </Row>
        </Section>

        <Divider style={{ margin: '12px 0' }} />

        <Section title="节点展开">
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Button
              block
              size="small"
              onClick={() => {
                handle.execCommand('EXPAND_ALL')
                handle.toast('已展开全部节点')
              }}
            >
              展开全部
            </Button>
            <Button
              block
              size="small"
              onClick={() => {
                handle.execCommand('UNEXPAND_ALL', 2)
                handle.toast('已收起到二级节点')
              }}
            >
              收起到二级
            </Button>
          </Space>
        </Section>
      </Drawer>
    </>
  )
}

/** 右侧竖排按钮：图标 + 文字 */
function SideBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Tooltip title={label} placement="left">
      <div className="hk-mm-side-btn" onClick={onClick}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 10, marginTop: 2 }}>{label.slice(0, 2)}</span>
      </div>
    </Tooltip>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#8a919f', marginBottom: 8 }}>{title}</div>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {children}
      </Space>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <span style={{ width: 52, fontSize: 13, color: '#5f6672', flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}
