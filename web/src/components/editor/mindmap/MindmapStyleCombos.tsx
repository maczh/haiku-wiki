import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from '../../mindmap-vite/src/components/MindMap/Icons'
import { Popover, PopLabel } from '../../mindmap-vite/src/components/MindMap/Popover'
import type {
  BaseStyle,
  LineStyle,
  MindMapApi,
  MindNodeStyle,
} from '../../mindmap-vite/src/components/MindMap'
import {
  BORDER_COLORS,
  BORDER_STYLES,
  FONT_FAMILIES,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  LINK_ARROWS,
  LINK_COLOR_MODES,
  LINK_PATTERNS,
  NODE_ICONS,
  PRIORITY_COLORS,
  PRIORITY_LEVELS,
  PROGRESS_LEVELS,
  TEXT_COLORS,
  THEME_CATEGORIES,
  THEME_LIST,
  SHAPES,
} from '../../mindmap-vite/src/components/MindMap'
import type { CanvasCategory } from '../../mindmap-vite/src/components/MindMap'

interface Props {
  /** 画布命令式句柄（未就绪时 null，面板禁用） */
  api: MindMapApi | null
  /** 是否有选中节点（决定节点级面板可用性） */
  hasActive: boolean
  /**
   * 回显刷新 tick：选中变化 / 画布数据变化时递增。
   * 面板的当前值直接读 api（getNodeStyle / getPriority / …），tick 只负责触发重渲染。
   */
  tick: number
  /** 当前画布主题 id（THEME_LIST 口径） */
  themeId: string
  /** 当前基础样式覆盖（回显） */
  base: BaseStyle
  onNodeStyle: (patch: Partial<MindNodeStyle>) => void
  onBaseStyle: (patch: Partial<BaseStyle>) => void
  /** 连接方式（曲线 / 折线 / 直线）改的是 MindMapConfig.lineStyle，不走 BaseStyle */
  onLineStyle: (s: LineStyle) => void
  onThemeId: (id: string) => void
  onPriority: (v: number | undefined) => void
  onProgress: (v: number | undefined) => void
  onToggleIcon: (id: string) => void
}

/** 主题卡片色块（与 mindmap-vite 工具条 ThemeSwatch 同款） */
function ThemeSwatch({ id }: { id: string }) {
  const t = THEME_LIST.find((x) => x.id === id)
  if (!t) return null
  return (
    <span
      className="mm-theme-swatch"
      style={{
        background: t.nodeFill,
        borderColor: t.nodeStroke,
        boxShadow: `inset 6px 0 0 ${t.rootFill}`,
      }}
    />
  )
}

/** 边框线型 → CSS border-style 预览（dashdot 无对应 CSS 值，退化为 double） */
const BORDER_PREVIEW: Record<string, CSSProperties['borderBottomStyle']> = {
  solid: "solid",
  dashed: "dashed",
  dotted: "dotted",
  dashdot: "double",
};

/** 连接方式候选（对应 MindMapConfig.lineStyle） */
const LINK_SHAPES: SegItem[] = [
  { id: "curve", label: "曲线" },
  { id: "elbow", label: "折线" },
  { id: "straight", label: "直线" },
];

interface SegItem {
  id: string;
  label: string;
}

/** 一排互斥小 chip：与 mindmap-vite 工具条的「曲线/折线」分段按钮同款样式 */
function SegRow({
  items,
  value,
  onPick,
  disabled,
  cols,
  disableDeselect,
}: {
  items: SegItem[]
  value: string | undefined
  onPick: (v: string | undefined) => void
  disabled?: boolean
  cols?: 3 | 4
  /** 无「再点取消」语义的项（如 lineStyle 是 config 必填字段，无法回退到 undefined） */
  disableDeselect?: boolean
}) {
  return (
    <div className={`mm-shape-grid${cols === 4 ? ' mm-line-grid' : ''}`}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`mm-shape-chip ${value === it.id ? 'is-on' : ''}`}
          disabled={disabled}
          onClick={() => onPick(disableDeselect ? it.id : value === it.id ? undefined : it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 思维导图顶部「样式组合」按钮组：节点样式 / 基础样式 / 主题 / 优先级 / 进度 / 图标。
 *
 * 面板内容与交互完全复用 mindmap-vite 自带工具条（同款 Popover 浮层、色板、
 * 主题卡片、优先级九宫格、进度档位、图标网格，连 CSS 类都共用 MindMap.css），
 * 只是数据读写改走 MindMapApi，由宿主（MindmapEditor）负责持久化。
 */
export default function MindmapStyleCombos(p: Props) {
  const { api, hasActive, tick } = p

  /** 面板内按下时不抢画布焦点（与 mindmap-vite Toolbar 的 guard 同款） */
  const guard = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('select, input, textarea')) return
    e.preventDefault()
  }

  // 当前值直接读 api；tick 变化时本组件重渲染，读到的是最新选中节点
  void tick
  const style: MindNodeStyle = (hasActive ? api?.getNodeStyle?.() : {}) ?? {}
  const base = p.base
  const priority = hasActive ? api?.getPriority?.() : undefined
  const progress = hasActive ? api?.getProgress?.() : undefined
  const icons = hasActive ? (api?.getIcons?.() ?? []) : []
  const disabledCls = hasActive ? '' : 'mm-tb-disabled'
  /** 连线色彩模式缺省「彩色」 */
  const linkColorMode = base.linkColorMode ?? 'auto'
  /** 连接方式直接读画布 config（lineStyle 不在 BaseStyle 里，无法从 base 回显） */
  const currentLineStyle: string = api?.getConfig?.()?.lineStyle ?? 'curve'

  const themesByCat: { cat: CanvasCategory; label: string; items: typeof THEME_LIST }[] =
    THEME_CATEGORIES.map((c) => ({
      cat: c.id,
      label: c.label,
      items: THEME_LIST.filter((t) => t.category === c.id),
    }))

  return (
    <div className="hk-mm-style-combos" onMouseDown={guard}>
      {/* ===== 节点样式 ===== */}
      <Popover title="节点样式" align="left" width={236} trigger={() => (
        <span className={`mm-tb-combo mm-tb-combo-text ${disabledCls}`}>
          <Icon name="node-style" size={17} />
          <span>节点样式</span>
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            <PopLabel>形状</PopLabel>
            <div className="mm-shape-grid">
              {SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`mm-shape-chip ${style.shape === s.id ? 'is-on' : ''}`}
                  disabled={!hasActive}
                  onClick={() => p.onNodeStyle({ shape: style.shape === s.id ? undefined : s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <PopLabel>文字颜色</PopLabel>
            <div className="mm-swatches">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" disabled={!hasActive} className={`mm-swatch ${style.color === c ? 'is-on' : ''}`} style={{ background: c }} title={c} onClick={() => p.onNodeStyle({ color: style.color === c ? undefined : c })} />
              ))}
            </div>
            <PopLabel>填充背景</PopLabel>
            <div className="mm-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" disabled={!hasActive} className={`mm-swatch ${(style.background ?? 'transparent') === c ? 'is-on' : ''} ${c === 'transparent' ? 'is-none' : ''}`} style={{ background: c === 'transparent' ? '#fff' : c }} title={c === 'transparent' ? '无填充' : c} onClick={() => p.onNodeStyle({ background: c === 'transparent' ? undefined : c })} />
              ))}
            </div>
            <PopLabel>边框颜色</PopLabel>
            <div className="mm-swatches">
              {BORDER_COLORS.map((c) => (
                <button key={c} type="button" disabled={!hasActive} className={`mm-swatch ${style.borderColor === c ? 'is-on' : ''}`} style={{ background: c }} title={c} onClick={() => p.onNodeStyle({ borderColor: style.borderColor === c ? undefined : c })} />
              ))}
            </div>
            <PopLabel>边框线型</PopLabel>
            <div className="mm-shape-grid mm-line-grid">
              {BORDER_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`mm-shape-chip mm-bs-chip ${style.borderStyle === s.id ? 'is-on' : ''}`}
                  disabled={!hasActive}
                  onClick={() => p.onNodeStyle({ borderStyle: style.borderStyle === s.id ? undefined : s.id })}
                >
                  <i className="mm-bs-line" style={{ borderBottomStyle: BORDER_PREVIEW[s.id] ?? 'solid' }} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Popover>

      {/* ===== 基础样式 ===== */}
      <Popover title="基础样式" align="left" width={236} trigger={() => (
        <span className="mm-tb-combo mm-tb-combo-text">
          <Icon name="base-style" size={17} />
          <span>基础样式</span>
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            <PopLabel>默认字体</PopLabel>
            <select className="mm-pop-select" value={base.fontFamily ?? ''} onChange={(e) => p.onBaseStyle({ fontFamily: e.target.value || undefined })}>
              <option value="">（跟随系统）</option>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <PopLabel>默认字号</PopLabel>
            <select className="mm-pop-select" value={base.fontSize ?? ''} onChange={(e) => p.onBaseStyle({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">（默认）</option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <PopLabel>连线线型</PopLabel>
            <SegRow
              items={LINK_PATTERNS}
              value={base.linkPattern}
              onPick={(v) => p.onBaseStyle({ linkPattern: v as BaseStyle['linkPattern'] })}
            />
            <PopLabel>连接方式</PopLabel>
            <SegRow
              items={LINK_SHAPES}
              value={currentLineStyle}
              disableDeselect
              onPick={(v) => v && p.onLineStyle(v as LineStyle)}
            />
            <PopLabel>箭头</PopLabel>
            <SegRow
              items={LINK_ARROWS}
              value={base.linkArrow}
              onPick={(v) => p.onBaseStyle({ linkArrow: v as BaseStyle['linkArrow'] })}
            />
            <PopLabel>连线色彩</PopLabel>
            <SegRow
              items={LINK_COLOR_MODES}
              value={base.linkColorMode}
              onPick={(v) => p.onBaseStyle({ linkColorMode: v as BaseStyle['linkColorMode'] })}
            />
            {linkColorMode === 'single' && (
              <>
                <div className="mm-swatches">
                  {BORDER_COLORS.map((c) => (
                    <button key={c} type="button" className={`mm-swatch ${base.linkColor === c ? 'is-on' : ''}`} style={{ background: c }} title={c} onClick={() => p.onBaseStyle({ linkColor: base.linkColor === c ? undefined : c })} />
                  ))}
                </div>
                {!base.linkColor && <div className="mm-pop-hint">未选色时沿用主题连线色</div>}
              </>
            )}
            <div className="mm-pop-hint">
              {linkColorMode === 'single' ? '单色：整图连线统一用下方颜色' : '彩色：每条分支用主题配色'}
            </div>
            <PopLabel>连线粗细 · {base.linkWidth ?? '默认'}</PopLabel>
            <input className="mm-pop-range" type="range" min={1} max={5} step={1} value={base.linkWidth ?? 2} onChange={(e) => p.onBaseStyle({ linkWidth: Number(e.target.value) })} />
            <PopLabel>圆角 · {base.radius ?? '默认'}</PopLabel>
            <input className="mm-pop-range" type="range" min={0} max={20} step={1} value={base.radius ?? 10} onChange={(e) => p.onBaseStyle({ radius: Number(e.target.value) })} />
            <PopLabel>默认填充</PopLabel>
            <div className="mm-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${(base.nodeFill ?? 'transparent') === c ? 'is-on' : ''} ${c === 'transparent' ? 'is-none' : ''}`} style={{ background: c === 'transparent' ? '#fff' : c }} title={c === 'transparent' ? '无' : c} onClick={() => p.onBaseStyle({ nodeFill: c === 'transparent' ? undefined : c })} />
              ))}
            </div>
            <PopLabel>默认文字色</PopLabel>
            <div className="mm-swatches">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${base.nodeText === c ? 'is-on' : ''}`} style={{ background: c }} title={c} onClick={() => p.onBaseStyle({ nodeText: base.nodeText === c ? undefined : c })} />
              ))}
            </div>
          </>
        )}
      </Popover>

      {/* ===== 主题 ===== */}
      <Popover title="主题" align="left" width={252} trigger={() => (
        <span className="mm-tb-combo mm-tb-combo-text">
          <Icon name="theme" size={17} />
          <span>主题</span>
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            {themesByCat.map((g) => (
              <div key={g.cat}>
                <PopLabel>{g.label}</PopLabel>
                <div className="mm-theme-grid">
                  {g.items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`mm-theme-card ${p.themeId === t.id ? 'is-on' : ''}`}
                      onClick={() => p.onThemeId(t.id)}
                    >
                      <ThemeSwatch id={t.id} />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </Popover>

      <i className="mm-tb-sep" />

      {/* ===== 优先级 ===== */}
      <Popover title="优先级" align="left" width={208} trigger={() => (
        <span className={`mm-tb-combo mm-tb-combo-text ${disabledCls}`}>
          <Icon name="priority" size={17} />
          <span>优先级</span>
          {priority != null && <b className="mm-badge" style={{ background: PRIORITY_COLORS[priority] }}>{priority}</b>}
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            <PopLabel>设置优先级（1–9）</PopLabel>
            <div className="mm-prio-grid">
              {PRIORITY_LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`mm-prio-chip ${priority === lv ? 'is-on' : ''}`}
                  disabled={!hasActive}
                  style={{ background: priority === lv ? PRIORITY_COLORS[lv] : undefined, color: priority === lv ? '#fff' : PRIORITY_COLORS[lv] }}
                  onClick={() => p.onPriority(priority === lv ? undefined : lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" disabled={!hasActive} onClick={() => p.onPriority(undefined)}>
              <Icon name="trash" size={14} /> 清除优先级
            </button>
          </>
        )}
      </Popover>

      {/* ===== 进度 ===== */}
      <Popover title="进度" align="left" width={208} trigger={() => (
        <span className={`mm-tb-combo mm-tb-combo-text ${disabledCls}`}>
          <Icon name="progress" size={17} />
          <span>进度</span>
          {progress != null && <b className="mm-badge" style={{ background: '#8bc34a' }}>{progress * 10}%</b>}
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            <PopLabel>设置进度（0–100%，每档 10%）</PopLabel>
            <div className="mm-prog-grid">
              {PROGRESS_LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`mm-prog-chip ${progress === lv ? 'is-on' : ''}`}
                  disabled={!hasActive}
                  onClick={() => p.onProgress(progress === lv ? undefined : lv)}
                >
                  {lv * 10}
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" disabled={!hasActive} onClick={() => p.onProgress(undefined)}>
              <Icon name="trash" size={14} /> 清除进度
            </button>
          </>
        )}
      </Popover>

      {/* ===== 图标 ===== */}
      <Popover title="图标" align="left" width={236} trigger={() => (
        <span className={`mm-tb-combo mm-tb-combo-text ${disabledCls}`}>
          <Icon name="icon" size={17} />
          <span>图标</span>
          {icons.length > 0 && <b className="mm-dot" />}
          <Icon name="chevron" size={13} />
        </span>
      )}>
        {() => (
          <>
            <PopLabel>添加图标前缀（可多选）</PopLabel>
            <div className="mm-icon-grid">
              {NODE_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  className={`mm-icon-chip ${icons.includes(ic.id) ? 'is-on' : ''}`}
                  disabled={!hasActive}
                  title={ic.label}
                  onClick={() => p.onToggleIcon(ic.id)}
                >
                  <span className="mm-icon-emoji">{ic.char}</span>
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" disabled={!hasActive} onClick={() => icons.forEach((id) => p.onToggleIcon(id))}>
              <Icon name="trash" size={14} /> 清除全部图标
            </button>
          </>
        )}
      </Popover>
    </div>
  )
}
