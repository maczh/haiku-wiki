import { useState } from 'react'
import { Alert, Button, Checkbox, Divider, Drawer, InputNumber, Radio, Select, Slider, Space, Switch, Tooltip, Typography } from 'antd'
import {
  ApartmentOutlined,
  BgColorsOutlined,
  CopyOutlined,
  PartitionOutlined,
  SettingOutlined,
  SlidersOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { deepMerge, MM_FONTS, MM_LAYOUTS, MM_SHAPES, MM_THEME_PRESETS, type MmHandle, type MmThemePreset } from './mmShared'

interface Props {
  handle: MmHandle
  /** 按需生成大纲文本（仅在打开大纲面板时调用，避免每次数据变更都重算） */
  getOutline: () => string
}

type PanelKey = 'node' | 'base' | 'theme' | 'layout' | 'outline' | 'setting'

/**
 * 思维导图右侧浮动工具条（仿 Simple Mind Map 官方 Demo）：
 *  节点样式 / 基础样式 / 主题 / 结构 / 大纲 / 设置，点击后右侧滑出对应面板。
 */
export default function MindmapSideToolbar({ handle, getOutline }: Props) {
  const [panel, setPanel] = useState<PanelKey | null>(null)
  // 节点样式面板需要"当前选中节点样式"作为回显，激活节点变化时刷新
  const [styleTick, setStyleTick] = useState(0)
  const [baseTick, setBaseTick] = useState(0)
  const [mode, setMode] = useState<'edit' | 'readonly'>('edit')
  const [wheel, setWheel] = useState<'zoom' | 'move'>('zoom')
  const [freeDrag, setFreeDrag] = useState(false)
  const [lineMarker, setLineMarker] = useState(true)

  const close = () => setPanel(null)

  /** 主题/基础样式统一入口：以初始主题为基准做覆盖 */
  function applyThemePatch(patch: Record<string, unknown>, tip: string) {
    const mm = handle.requireMm()
    if (!mm) return
    mm.setTheme(deepMerge(handle.baseTheme(), patch) as never)
    setBaseTick((n) => n + 1)
    handle.toast(tip, 'success')
  }

  /** 取当前主题值（用于面板回显） */
  function themeValue(key: string, fallback: unknown): unknown {
    void baseTick
    const mm = handle.mm
    if (!mm) return fallback
    const t = mm.getTheme() as Record<string, unknown>
    return t[key] ?? fallback
  }

  const nodeStyle: Record<string, unknown> = (() => {
    void styleTick
    if (!handle.mm || !handle.hasActive) return {}
    try {
      return (handle.activeNode()?.getData?.().style ?? {}) as Record<string, unknown>
    } catch {
      return {}
    }
  })()

  function setNodeStyle(prop: string, value: unknown) {
    const node = handle.activeNode()
    if (!node) return
    node.setStyle?.(prop, value)
    setStyleTick((n) => n + 1)
  }

  return (
    <>
      {/* 右侧竖排入口 */}
      <div className="hk-mm-tb hk-mm-side">
        <SideBtn icon={<BgColorsOutlined />} label="节点样式" onClick={() => setPanel('node')} />
        <SideBtn icon={<SlidersOutlined />} label="基础样式" onClick={() => setPanel('base')} />
        <SideBtn icon={<PartitionOutlined />} label="主题" onClick={() => setPanel('theme')} />
        <SideBtn icon={<ApartmentOutlined />} label="结构" onClick={() => setPanel('layout')} />
        <SideBtn icon={<UnorderedListOutlined />} label="大纲" onClick={() => setPanel('outline')} />
        <SideBtn icon={<SettingOutlined />} label="设置" onClick={() => setPanel('setting')} />
      </div>

      {/* ---------- 节点样式 ---------- */}
      <Drawer title="节点样式" width={320} open={panel === 'node'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        {!handle.hasActive && <Alert type="info" showIcon message="请先在画布中单击选中一个节点" style={{ marginBottom: 12 }} />}
        <Section title="文字">
          <Row label="颜色">
            <ColorField value={(nodeStyle.color as string) ?? ''} onChange={(v) => setNodeStyle('color', v)} />
          </Row>
          <Row label="字号">
            <InputNumber
              size="small"
              min={10}
              max={48}
              value={Number(nodeStyle.fontSize ?? 14)}
              disabled={!handle.hasActive}
              onChange={(v) => setNodeStyle('fontSize', Number(v ?? 14))}
              addonAfter="px"
            />
            <Space size={4} style={{ marginLeft: 8 }}>
              <Check glyph="B" title="加粗" active={nodeStyle.fontWeight === 'bold'} disabled={!handle.hasActive} onClick={() => setNodeStyle('fontWeight', nodeStyle.fontWeight === 'bold' ? 'normal' : 'bold')} />
              <Check glyph="I" title="斜体" active={nodeStyle.fontStyle === 'italic'} disabled={!handle.hasActive} onClick={() => setNodeStyle('fontStyle', nodeStyle.fontStyle === 'italic' ? 'normal' : 'italic')} italic />
            </Space>
          </Row>
          <Row label="装饰">
            <Checkbox
              disabled={!handle.hasActive}
              checked={nodeStyle.textDecoration === 'underline'}
              onChange={(e) => setNodeStyle('textDecoration', e.target.checked ? 'underline' : 'none')}
            >
              下划线
            </Checkbox>
            <Checkbox
              disabled={!handle.hasActive}
              checked={nodeStyle.textDecoration === 'line-through'}
              onChange={(e) => setNodeStyle('textDecoration', e.target.checked ? 'line-through' : 'none')}
            >
              删除线
            </Checkbox>
          </Row>
        </Section>

        <Divider style={{ margin: '12px 0' }} />

        <Section title="外观">
          <Row label="填充色">
            <ColorField value={(nodeStyle.fillColor as string) ?? ''} onChange={(v) => setNodeStyle('fillColor', v)} />
          </Row>
          <Row label="边框色">
            <ColorField value={(nodeStyle.borderColor as string) ?? ''} onChange={(v) => setNodeStyle('borderColor', v)} />
          </Row>
          <Row label="边框宽">
            <InputNumber
              size="small"
              min={0}
              max={10}
              value={Number(nodeStyle.borderWidth ?? 0)}
              disabled={!handle.hasActive}
              onChange={(v) => setNodeStyle('borderWidth', Number(v ?? 0))}
              addonAfter="px"
            />
          </Row>
          <Row label="圆角">
            <InputNumber
              size="small"
              min={0}
              max={40}
              value={Number(nodeStyle.borderRadius ?? 0)}
              disabled={!handle.hasActive}
              onChange={(v) => setNodeStyle('borderRadius', Number(v ?? 0))}
              addonAfter="px"
            />
          </Row>
          <Row label="形状">
            <Select
              size="small"
              style={{ width: 150 }}
              disabled={!handle.hasActive}
              placeholder="保持主题默认"
              value={(nodeStyle.shape as string) || undefined}
              options={MM_SHAPES.map((s) => ({ value: s.value, label: s.label }))}
              onChange={(v) => {
                const node = handle.activeNode()
                if (!node) return
                node.setShape?.(v)
                setStyleTick((n) => n + 1)
              }}
            />
          </Row>
        </Section>

        <Divider style={{ margin: '12px 0' }} />

        <Section title="连线（该节点与父节点之间）">
          <Row label="颜色">
            <ColorField value={(nodeStyle.lineColor as string) ?? ''} onChange={(v) => setNodeStyle('lineColor', v)} />
          </Row>
          <Row label="宽度">
            <InputNumber
              size="small"
              min={1}
              max={10}
              value={Number(nodeStyle.lineWidth ?? 2)}
              disabled={!handle.hasActive}
              onChange={(v) => setNodeStyle('lineWidth', Number(v ?? 2))}
              addonAfter="px"
            />
          </Row>
        </Section>

        <div style={{ marginTop: 16 }}>
          <Button
            block
            size="small"
            disabled={!handle.hasActive}
            onClick={() => {
              const mm = handle.requireMm()
              if (!mm) return
              mm.execCommand('REMOVE_CUSTOM_STYLES')
              setStyleTick((n) => n + 1)
              handle.toast('已清除自定义样式，恢复主题默认', 'success')
            }}
          >
            清除自定义样式
          </Button>
        </div>
      </Drawer>

      {/* ---------- 基础样式（全局） ---------- */}
      <Drawer title="基础样式" width={320} open={panel === 'base'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          作用于全部节点与连线的全局样式（覆盖主题默认值）。
        </Typography.Paragraph>
        <Section title="连线">
          <Row label="颜色">
            <ColorField
              value={String(themeValue('lineColor', '#5496ff'))}
              onChange={(v) => applyThemePatch({ lineColor: v }, '连线颜色已更新')}
            />
          </Row>
          <Row label="宽度">
            <InputNumber
              size="small"
              min={1}
              max={10}
              value={Number(themeValue('lineWidth', 2))}
              onChange={(v) => applyThemePatch({ lineWidth: Number(v ?? 2) }, '连线宽度已更新')}
              addonAfter="px"
            />
          </Row>
          <Row label="虚线">
            <Select
              size="small"
              style={{ width: 150 }}
              value={String(themeValue('lineDasharray', ''))}
              options={[
                { value: '', label: '实线' },
                { value: '5,5', label: '短虚线' },
                { value: '10,6', label: '长虚线' },
                { value: '2,4', label: '点线' },
              ]}
              onChange={(v) => applyThemePatch({ lineDasharray: v }, '连线样式已更新')}
            />
          </Row>
          <Row label="箭头">
            <Switch
              size="small"
              checked={lineMarker}
              onChange={(v) => {
                setLineMarker(v)
                applyThemePatch({ showLineMarker: v }, v ? '已显示连线箭头' : '已隐藏连线箭头')
              }}
            />
          </Row>
        </Section>

        <Divider style={{ margin: '12px 0' }} />

        <Section title="节点">
          <Row label="字体">
            <Select
              size="small"
              style={{ width: 190 }}
              value={String(themeValue('fontFamily', ''))}
              options={MM_FONTS.map((f) => ({ value: f.value, label: f.label }))}
              onChange={(v) =>
                applyThemePatch(
                  { root: { fontFamily: v }, second: { fontFamily: v }, node: { fontFamily: v } },
                  '字体已更新',
                )
              }
            />
          </Row>
          <Row label="字号">
            <InputNumber
              size="small"
              min={10}
              max={32}
              value={Number((themeValue('node', {}) as Record<string, unknown>).fontSize ?? 14)}
              onChange={(v) =>
                applyThemePatch({ node: { fontSize: Number(v ?? 14) } }, '字号已更新')
              }
              addonAfter="px"
            />
          </Row>
          <Row label="内边距">
            <Space size={6}>
              <InputNumber
                size="small"
                min={0}
                max={40}
                value={Number(themeValue('paddingX', 15))}
                onChange={(v) => applyThemePatch({ paddingX: Number(v ?? 15) }, '水平内边距已更新')}
                addonBefore="X"
              />
              <InputNumber
                size="small"
                min={0}
                max={40}
                value={Number(themeValue('paddingY', 5))}
                onChange={(v) => applyThemePatch({ paddingY: Number(v ?? 5) }, '垂直内边距已更新')}
                addonBefore="Y"
              />
            </Space>
          </Row>
        </Section>

        <Divider style={{ margin: '12px 0' }} />

        <Section title="画布">
          <Row label="背景色">
            <ColorField
              value={String(themeValue('backgroundColor', '#ffffff'))}
              onChange={(v) => applyThemePatch({ backgroundColor: v }, '画布背景已更新')}
            />
          </Row>
        </Section>
      </Drawer>

      {/* ---------- 主题 ---------- */}
      <Drawer title="主题" width={320} open={panel === 'theme'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {MM_THEME_PRESETS.map((preset) => (
            <ThemeCard
              key={preset.key}
              preset={preset}
              onClick={() => {
                const mm = handle.requireMm()
                if (!mm) return
                mm.setTheme(preset.key === 'default' ? handle.baseTheme() : (deepMerge(handle.baseTheme(), preset.theme) as never))
                setBaseTick((n) => n + 1)
                handle.toast(`已应用主题：${preset.label}`, 'success')
              }}
            />
          ))}
        </div>
      </Drawer>

      {/* ---------- 结构 ---------- */}
      <Drawer title="结构" width={320} open={panel === 'layout'} onClose={close} mask={false} getContainer={false} rootClassName="hk-mm-drawer">
        <Radio.Group
          value={handle.mm?.getLayout?.() ?? 'logicalStructure'}
          onChange={(e) => {
            const mm = handle.requireMm()
            if (!mm) return
            mm.setLayout(e.target.value)
            handle.toast('结构已切换', 'success')
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
                const mm = handle.requireMm()
                if (!mm) return
                const next = v ? 'readonly' : 'edit'
                mm.setMode(next)
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
                const mm = handle.requireMm()
                if (!mm) return
                mm.updateConfig({ mousewheelAction: v })
                setWheel(v)
              }}
            />
          </Row>
          <Row label="自由拖拽">
            <Switch
              size="small"
              checked={freeDrag}
              onChange={(v) => {
                const mm = handle.requireMm()
                if (!mm) return
                mm.updateConfig({ enableFreeDrag: v })
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
                handle.requireMm()?.execCommand('EXPAND_ALL')
                handle.toast('已展开全部节点')
              }}
            >
              展开全部
            </Button>
            <Button
              block
              size="small"
              onClick={() => {
                handle.requireMm()?.execCommand('UNEXPAND_ALL', false, 2)
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

/** 主题卡片：三色预览 + 名称 */
function ThemeCard({ preset, onClick }: { preset: MmThemePreset; onClick: () => void }) {
  const [root, second, line] = preset.preview
  return (
    <Tooltip title={`应用主题：${preset.label}`}>
      <div
        onClick={onClick}
        style={{
          width: 128,
          padding: 10,
          border: '1px solid #ebedf0',
          borderRadius: 8,
          cursor: 'pointer',
          background: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 26, height: 18, borderRadius: 4, background: root, border: `1px solid ${line}` }} />
          <span style={{ flex: 1, height: 2, background: line }} />
          <span style={{ width: 26, height: 18, borderRadius: 4, background: second, border: `1px solid ${line}` }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#5f6672' }}>{preset.label}</div>
      </div>
    </Tooltip>
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

/** 颜色选择：原生取色器 + 一键恢复主题默认 */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
  return (
    <Space size={6}>
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: '1px solid #d9d9d9', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
      />
      <Button size="small" type="text" onClick={() => onChange('transparent')} style={{ padding: '0 4px', fontSize: 12 }}>
        透明
      </Button>
    </Space>
  )
}

/** 文字样式开关（B / I） */
function Check({
  glyph,
  title,
  active,
  disabled,
  italic,
  onClick,
}: {
  glyph: string
  title: string
  active: boolean
  disabled?: boolean
  italic?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip title={title}>
      <Button
        size="small"
        type={active ? 'primary' : 'default'}
        disabled={disabled}
        onClick={onClick}
        style={{ fontWeight: 700, fontStyle: italic ? 'italic' : 'normal', width: 28, padding: 0 }}
      >
        {glyph}
      </Button>
    </Tooltip>
  )
}
