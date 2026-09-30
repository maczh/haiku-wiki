import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "./Icons";
import { Popover, PopLabel } from "./Popover";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  SHAPES,
  type BaseStyle,
  type CanvasCategory,
  type MindMapConfig,
  type MindNodeStyle,
  type StructureType,
  type TextDefaults,
} from "./types";
import {
  BORDER_COLORS,
  HIGHLIGHT_COLORS,
  MARKERS,
  NODE_ICONS,
  PRIORITY_COLORS,
  PRIORITY_LEVELS,
  PROGRESS_LEVELS,
  STRUCTURES,
  TEXT_COLORS,
  THEME_CATEGORIES,
  THEME_LIST,
} from "./theme";
import {
  EXPORT_LABELS,
  IMPORT_ACCEPT,
  type ExportFormat,
} from "./io";

export interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canDelete: boolean;
  onInsertParent: () => void;
  onInsertSiblingBefore: () => void;
  onInsertSiblingAfter: () => void;
  onInsertChild: () => void;
  onDelete: () => void;
  /** 当前选中节点的标记 */
  markers: string[];
  onToggleMarker: (id: string) => void;
  /** 字号 / 字体（无选中时作为新建节点默认值） */
  defaults: TextDefaults;
  onDefaults: (patch: Partial<TextDefaults>) => void;
  /** 当前选中节点的文字样式 */
  style: MindNodeStyle;
  onStyle: (patch: Partial<MindNodeStyle>) => void;
  onNote: () => void;
  onLink: () => void;
  /** 整体配置（主题 / 结构 / 连线） */
  config: MindMapConfig;
  onConfig: (patch: Partial<MindMapConfig>) => void;
  /** 基础（默认）样式：影响新建节点与画布 */
  onBase: (patch: Partial<BaseStyle>) => void;
  /** 优先级 / 进度 / 图标前缀 */
  priority?: number;
  onSetPriority: (v: number | undefined) => void;
  progress?: number;
  onSetProgress: (v: number | undefined) => void;
  icons: string[];
  onToggleIcon: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (format: ExportFormat) => void;
  onNew: () => void;
}

const SHORTCUTS: [string, string][] = [
  ["Tab", "新增子节点"],
  ["Enter", "结束编辑 / 新增同级"],
  ["Shift + Enter", "在前面插入同级"],
  ["Shift + Tab", "节点上移一层"],
  ["F2 / 双击", "编辑节点内容"],
  ["Delete", "删除节点"],
  ["空格", "折叠 / 展开"],
  ["方向键", "切换选中节点"],
  ["Ctrl + Z", "撤销"],
  ["Ctrl + Shift + Z", "重做"],
  ["Ctrl + S", "保存 .km 文件"],
  ["Esc", "取消选中 / 退出编辑"],
];

/* ----------------------------- 缩略图预览 ----------------------------- */

function StructureThumb({ kind }: { kind: string }) {
  const colors = ["#00a870", "#f0a020", "#e34d59", "#2f6fed"];
  const root = (x: number, y: number, w = 14, h = 8) => (
    <rect x={x} y={y} width={w} height={h} rx={2} fill="#2f6fed" />
  );
  const rightBranches = (
    <>
      {[5, 16, 27].map((y, i) => (
        <g key={i}>
          <path d={`M17 18 C 24 18, 24 ${y + 3}, 31 ${y + 3}`} fill="none" stroke={colors[i]} strokeWidth={1.3} />
          <rect x={31} y={y} width={18} height={6} rx={2} fill="#fff" stroke={colors[i]} strokeWidth={1} />
        </g>
      ))}
    </>
  );
  return (
    <svg width="52" height="36" viewBox="0 0 52 36" aria-hidden="true">
      {/* 逻辑结构图（右） */}
      {kind === "logical-right" && (<>{root(3, 14)}{rightBranches}</>)}
      {/* 逻辑结构图（左）：整体镜像 */}
      {kind === "logical-left" && (
        <g transform="translate(52,0) scale(-1,1)">{root(3, 14)}{rightBranches}</g>
      )}
      {/* 思维导图：根居中，左右均衡 */}
      {kind === "mindmap" && (
        <>
          {root(19, 14)}
          {[6, 22].map((y, i) => (
            <g key={`r${i}`}>
              <path d={`M33 18 C 38 18, 36 ${y + 3}, 38 ${y + 3}`} fill="none" stroke={colors[i]} strokeWidth={1.3} />
              <rect x={38} y={y} width={12} height={6} rx={2} fill="#fff" stroke={colors[i]} strokeWidth={1} />
            </g>
          ))}
          {[6, 22].map((y, i) => (
            <g key={`l${i}`}>
              <path d={`M19 18 C 14 18, 16 ${y + 3}, 14 ${y + 3}`} fill="none" stroke={colors[i + 2]} strokeWidth={1.3} />
              <rect x={2} y={y} width={12} height={6} rx={2} fill="#fff" stroke={colors[i + 2]} strokeWidth={1} />
            </g>
          ))}
        </>
      )}
      {/* 组织结构图：顶级横向铺开（梳状） */}
      {kind === "org" && (
        <>
          {root(19, 3, 14, 7)}
          <path d={`M26 10 L26 20 L14 20`} fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <path d={`M26 20 L38 20`} fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={6} y={20} width={16} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <rect x={30} y={20} width={16} height={6} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
        </>
      )}
      {/* 目录组织图：顶级横向，深层垂直堆叠（竖向列表） */}
      {kind === "catalog" && (
        <>
          {root(19, 3, 14, 7)}
          <path d={`M26 10 L26 16`} fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <rect x={19} y={13} width={14} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <path d={`M26 19 L29 22`} fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={23} y={22} width={12} height={5} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
          <path d={`M29 27 L29 29`} fill="none" stroke={colors[2]} strokeWidth={1.2} />
          <rect x={23} y={29} width={12} height={5} rx={1.5} fill="#fff" stroke={colors[2]} strokeWidth={1} />
        </>
      )}
      {/* 时间轴：根在左，节点位于同一水平线 */}
      {kind === "timeline" && (
        <>
          {root(3, 15, 11, 7)}
          <path d={`M14 18.5 L48 18.5`} fill="none" stroke="#8b95a5" strokeWidth={1.4} />
          {[18, 30, 42].map((x, i) => (
            <rect key={i} x={x} y={15} width={11} height={7} rx={2} fill="#fff" stroke={colors[i]} strokeWidth={1} />
          ))}
        </>
      )}
      {/* 鱼骨图：脊柱 + 上下交替的骨头 */}
      {kind === "fishbone" && (
        <>
          {root(40, 15, 11, 7)}
          <path d={`M45 18.5 L8 18.5`} fill="none" stroke="#8b95a5" strokeWidth={1.4} />
          <path d={`M30 18.5 L24 7`} fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <rect x={18} y={4} width={12} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <path d={`M16 18.5 L16 30`} fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={10} y={27} width={12} height={6} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
        </>
      )}
    </svg>
  );
}

function ThemeSwatch({ id }: { id: string }) {
  const t = THEME_LIST.find((x) => x.id === id);
  if (!t) return null;
  return (
    <span
      className="mm-theme-swatch"
      style={{
        background: t.nodeFill,
        borderColor: t.nodeStroke,
        boxShadow: `inset 6px 0 0 ${t.rootFill}`,
      }}
    />
  );
}

/* ----------------------------- 工具栏主体 ----------------------------- */

export function Toolbar(props: ToolbarProps) {
  const {
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    canDelete,
    onInsertParent,
    onInsertSiblingBefore,
    onInsertSiblingAfter,
    onInsertChild,
    onDelete,
    markers,
    onToggleMarker,
    defaults,
    onDefaults,
    style,
    onStyle,
    onNote,
    onLink,
    config,
    onConfig,
    onBase,
    priority,
    onSetPriority,
    progress,
    onSetProgress,
    icons,
    onToggleIcon,
    onImport,
    onExport,
    onNew,
  } = props;

  const fileRef = useRef<HTMLInputElement>(null);
  const base = config.base ?? {};

  /** 除表单控件外，阻止按钮抢走画布焦点（保证键盘快捷键一直可用） */
  const guard = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("select, input, textarea")) return;
    e.preventDefault();
  };

  const sizeOptions = FONT_SIZES.includes(defaults.fontSize)
    ? FONT_SIZES
    : [...FONT_SIZES, defaults.fontSize].sort((a, b) => a - b);
  const fontValue = FONT_FAMILIES.some((f) => f.value === defaults.fontFamily)
    ? defaults.fontFamily
    : FONT_FAMILIES[0].value;

  const themesByCat: { cat: CanvasCategory; label: string; items: typeof THEME_LIST }[] =
    THEME_CATEGORIES.map((c) => ({
      cat: c.id,
      label: c.label,
      items: THEME_LIST.filter((t) => t.category === c.id),
    }));

  return (
    <div className="mm-toolbar" onMouseDown={guard}>
      {/* 撤销 / 重做 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Icon name="undo" />
        </button>
        <button type="button" className="mm-tb-btn" title="重做 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          <Icon name="redo" />
        </button>
      </div>

      <i className="mm-tb-sep" />

      {/* 结构编辑 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="插入上级节点" onClick={onInsertParent}>
          <Icon name="insert-parent" />
        </button>
        <button type="button" className="mm-tb-btn" title="在下方插入同级节点 (Enter)" onClick={onInsertSiblingAfter}>
          <Icon name="insert-sibling-below" />
        </button>
        <button type="button" className="mm-tb-btn" title="在上方插入同级节点 (Shift+Enter)" onClick={onInsertSiblingBefore}>
          <Icon name="insert-sibling-above" />
        </button>
        <button type="button" className="mm-tb-btn" title="插入子节点 (Tab)" onClick={onInsertChild}>
          <Icon name="insert-child" />
        </button>
        <Popover
          title="标记"
          width={224}
          trigger={() => (
            <span className="mm-tb-combo">
              <Icon name="marker" />
              {markers.length > 0 && <b className="mm-dot" />}
            </span>
          )}
        >
          {(close) => (
            <>
              <PopLabel>标记（可多选）</PopLabel>
              <div className="mm-marker-grid">
                {MARKERS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`mm-marker-chip ${markers.includes(m.id) ? "is-on" : ""}`}
                    title={m.label}
                    style={{ background: m.bg, color: m.fg }}
                    onClick={() => onToggleMarker(m.id)}
                  >
                    {m.char}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mm-pop-action"
                onClick={() => {
                  markers.forEach((m) => onToggleMarker(m));
                  close();
                }}
              >
                <Icon name="trash" size={14} /> 清除全部标记
              </button>
            </>
          )}
        </Popover>
      </div>

      <i className="mm-tb-sep" />

      {/* 字号 / 字体 */}
      <select
        className="mm-tb-select mm-tb-size"
        title="字号"
        value={defaults.fontSize}
        onChange={(e) => onDefaults({ fontSize: Number(e.target.value) })}
      >
        {sizeOptions.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        className="mm-tb-select mm-tb-font"
        title="字体"
        value={fontValue}
        onChange={(e) => onDefaults({ fontFamily: e.target.value })}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>{f.label}</option>
        ))}
      </select>

      <i className="mm-tb-sep" />

      {/* 字符样式 */}
      <div className="mm-tb-group">
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.bold ? "is-on" : ""}`} title="加粗 (Ctrl+B)" style={{ fontWeight: 800 }} onClick={() => onStyle({ bold: !style.bold })}>B</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.italic ? "is-on" : ""}`} title="斜体 (Ctrl+I)" style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }} onClick={() => onStyle({ italic: !style.italic })}>I</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.underline ? "is-on" : ""}`} title="下划线 (Ctrl+U)" style={{ textDecoration: "underline" }} onClick={() => onStyle({ underline: !style.underline })}>U</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.strike ? "is-on" : ""}`} title="删除线" style={{ textDecoration: "line-through" }} onClick={() => onStyle({ strike: !style.strike })}>S</button>
      </div>

      <i className="mm-tb-sep" />

      {/* 备注 / 链接 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="节点备注" onClick={onNote}>
          <Icon name="note" />
        </button>
        <button type="button" className="mm-tb-btn" title="超链接" onClick={onLink}>
          <Icon name="link" />
        </button>
      </div>

      <i className="mm-tb-sep" />

      {/* ===== 节点样式 ===== */}
      <Popover
        title="节点样式"
        align="left"
        width={236}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="node-style" size={17} />
            <span>节点样式</span>
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>形状</PopLabel>
            <div className="mm-shape-grid">
              {SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`mm-shape-chip ${style.shape === s.id ? "is-on" : ""}`}
                  onClick={() => onStyle({ shape: style.shape === s.id ? undefined : s.id })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <PopLabel>文字颜色</PopLabel>
            <div className="mm-swatches">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${style.color === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => onStyle({ color: style.color === c ? undefined : c })} />
              ))}
            </div>
            <PopLabel>填充背景</PopLabel>
            <div className="mm-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${(style.background ?? "transparent") === c ? "is-on" : ""} ${c === "transparent" ? "is-none" : ""}`} style={{ background: c === "transparent" ? "#fff" : c }} title={c === "transparent" ? "无填充" : c} onClick={() => onStyle({ background: c === "transparent" ? undefined : c })} />
              ))}
            </div>
            <PopLabel>边框颜色</PopLabel>
            <div className="mm-swatches">
              {BORDER_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${style.borderColor === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => onStyle({ borderColor: style.borderColor === c ? undefined : c })} />
              ))}
            </div>
          </>
        )}
      </Popover>

      {/* ===== 基础样式 ===== */}
      <Popover
        title="基础样式"
        align="left"
        width={236}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="base-style" size={17} />
            <span>基础样式</span>
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>默认字体</PopLabel>
            <select className="mm-pop-select" value={base.fontFamily ?? ""} onChange={(e) => onBase({ fontFamily: e.target.value || undefined })}>
              <option value="">（跟随系统）</option>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <PopLabel>默认字号</PopLabel>
            <select className="mm-pop-select" value={base.fontSize ?? ""} onChange={(e) => onBase({ fontSize: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">（默认）</option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <PopLabel>连线颜色</PopLabel>
            <div className="mm-swatches">
              {BORDER_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${base.linkColor === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => onBase({ linkColor: base.linkColor === c ? undefined : c })} />
              ))}
            </div>
            <PopLabel>连线粗细 · {base.linkWidth ?? "默认"}</PopLabel>
            <input className="mm-pop-range" type="range" min={1} max={5} step={1} value={base.linkWidth ?? 2} onChange={(e) => onBase({ linkWidth: Number(e.target.value) })} />
            <PopLabel>圆角 · {base.radius ?? "默认"}</PopLabel>
            <input className="mm-pop-range" type="range" min={0} max={20} step={1} value={base.radius ?? 10} onChange={(e) => onBase({ radius: Number(e.target.value) })} />
            <PopLabel>默认填充</PopLabel>
            <div className="mm-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${(base.nodeFill ?? "transparent") === c ? "is-on" : ""} ${c === "transparent" ? "is-none" : ""}`} style={{ background: c === "transparent" ? "#fff" : c }} title={c === "transparent" ? "无" : c} onClick={() => onBase({ nodeFill: c === "transparent" ? undefined : c })} />
              ))}
            </div>
            <PopLabel>默认文字色</PopLabel>
            <div className="mm-swatches">
              {TEXT_COLORS.map((c) => (
                <button key={c} type="button" className={`mm-swatch ${base.nodeText === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => onBase({ nodeText: base.nodeText === c ? undefined : c })} />
              ))}
            </div>
          </>
        )}
      </Popover>

      {/* ===== 主题 ===== */}
      <Popover
        title="主题"
        align="left"
        width={252}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="theme" size={17} />
            <span>主题</span>
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
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
                      className={`mm-theme-card ${config.themeId === t.id ? "is-on" : ""}`}
                      onClick={() => onConfig({ themeId: t.id })}
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

      {/* ===== 结构 ===== */}
      <Popover
        title="结构"
        align="left"
        width={236}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="structure" size={17} />
            <span>结构</span>
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>布局结构</PopLabel>
            <div className="mm-structure-grid">
              {STRUCTURES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`mm-structure-card ${config.structure === s.id ? "is-on" : ""}`}
                  onClick={() => onConfig({ structure: s.id as StructureType })}
                >
                  <StructureThumb kind={s.id} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <PopLabel>连线样式</PopLabel>
            <div className="mm-seg">
              {([["curve", "曲线"], ["elbow", "折线"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`mm-seg-btn ${config.lineStyle === k ? "is-on" : ""}`}
                  onClick={() => onConfig({ lineStyle: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </Popover>

      <i className="mm-tb-sep" />

      {/* ===== 优先级 ===== */}
      <Popover
        title="优先级"
        align="left"
        width={208}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="priority" size={17} />
            <span>优先级</span>
            {priority != null && <b className="mm-badge" style={{ background: PRIORITY_COLORS[priority] }}>{priority}</b>}
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>设置优先级（1–9）</PopLabel>
            <div className="mm-prio-grid">
              {PRIORITY_LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`mm-prio-chip ${priority === lv ? "is-on" : ""}`}
                  style={{ background: priority === lv ? PRIORITY_COLORS[lv] : undefined, color: priority === lv ? "#fff" : PRIORITY_COLORS[lv] }}
                  onClick={() => onSetPriority(priority === lv ? undefined : lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" onClick={() => onSetPriority(undefined)}>
              <Icon name="trash" size={14} /> 清除优先级
            </button>
          </>
        )}
      </Popover>

      {/* ===== 进度 ===== */}
      <Popover
        title="进度"
        align="left"
        width={208}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="progress" size={17} />
            <span>进度</span>
            {progress != null && <b className="mm-badge" style={{ background: "#8bc34a" }}>{progress * 10}%</b>}
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>设置进度（0–100%，每档 10%）</PopLabel>
            <div className="mm-prog-grid">
              {PROGRESS_LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`mm-prog-chip ${progress === lv ? "is-on" : ""}`}
                  onClick={() => onSetProgress(progress === lv ? undefined : lv)}
                >
                  {lv * 10}
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" onClick={() => onSetProgress(undefined)}>
              <Icon name="trash" size={14} /> 清除进度
            </button>
          </>
        )}
      </Popover>

      {/* ===== 图标 ===== */}
      <Popover
        title="图标"
        align="left"
        width={236}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="icon" size={17} />
            <span>图标</span>
            {icons.length > 0 && <b className="mm-dot" />}
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>添加图标前缀（可多选）</PopLabel>
            <div className="mm-icon-grid">
              {NODE_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  className={`mm-icon-chip ${icons.includes(ic.id) ? "is-on" : ""}`}
                  title={ic.label}
                  onClick={() => onToggleIcon(ic.id)}
                >
                  <span className="mm-icon-emoji">{ic.char}</span>
                </button>
              ))}
            </div>
            <button type="button" className="mm-pop-action" onClick={() => icons.forEach((id) => onToggleIcon(id))}>
              <Icon name="trash" size={14} /> 清除全部图标
            </button>
          </>
        )}
      </Popover>

      <i className="mm-tb-sep" />

      {/* ===== 文件：打开 / 保存(.km) / 导出 ===== */}
      <Popover
        title="文件"
        align="right"
        width={244}
        trigger={() => (
          <span className="mm-tb-combo mm-tb-combo-text">
            <Icon name="folder" size={17} />
            <span>文件</span>
            <Icon name="chevron" size={13} />
          </span>
        )}
      >
        {(close) => (
          <>
            <button type="button" className="mm-pop-action" onClick={() => fileRef.current?.click()}>
              <Icon name="folder" size={15} /> 打开…
            </button>
            <button type="button" className="mm-pop-action" onClick={() => { onExport("km"); close(); }}>
              <Icon name="save" size={15} /> 保存（.km）
            </button>
            <PopLabel>导出为</PopLabel>
            {(Object.keys(EXPORT_LABELS) as ExportFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                className="mm-pop-action"
                onClick={() => { onExport(f); close(); }}
              >
                <Icon name="save" size={15} /> {EXPORT_LABELS[f]}
              </button>
            ))}
            <div className="mm-pop-tip">默认打开 / 保存格式为 .km</div>
            <PopLabel>其他</PopLabel>
            <button type="button" className="mm-pop-action" onClick={() => { onNew(); close(); }}>
              <Icon name="file-plus" size={15} /> 新建空白导图
            </button>
          </>
        )}
      </Popover>

      {/* 快捷键说明 */}
      <Popover
        title="快捷键"
        align="right"
        width={252}
        trigger={() => (
          <span className="mm-tb-combo">
            <Icon name="keyboard" size={17} />
          </span>
        )}
      >
        {() => (
          <>
            <PopLabel>编辑快捷键</PopLabel>
            <div className="mm-shortcuts">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="mm-shortcut-row">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Popover>

      <i className="mm-tb-sep" />

      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="删除节点 (Delete)" disabled={!canDelete} onClick={onDelete}>
          <Icon name="trash" />
        </button>
      </div>

      <input
        ref={fileRef}
        className="mm-file-input"
        type="file"
        accept={IMPORT_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export default Toolbar;
