/**
 * 工具条 / 主菜单共用的面板内容。
 *
 * 抽出来的原因：主菜单要求「包含工具条上所有功能」，若在菜单里复制一份
 * 面板 JSX，两处会各自演化、很快不同步。这里按面板拆成纯展示组件，
 * 由调用方注入状态与回调，工具条的 Popover 与主菜单的子菜单共用同一份实现。
 */
import type { ReactNode } from "react";
import { PopLabel } from "./Popover";
import {
  BORDER_STYLES,
  BRANCH_STYLES,
  FONT_FAMILIES,
  FONT_SIZES,
  LINK_ARROWS,
  LINK_COLOR_MODES,
  LINK_PATTERNS,
  SHAPES,
  type BaseStyle,
  type CanvasCategory,
  type MindMapConfig,
  type MindNodeStyle,
  type StructureType,
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

/* ----------------------------- 缩略图预览 ----------------------------- */

export function StructureThumb({ kind }: { kind: string }) {
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
      {kind === "logical-right" && (<>{root(3, 14)}{rightBranches}</>)}
      {kind === "logical-left" && (
        <g transform="translate(52,0) scale(-1,1)">{root(3, 14)}{rightBranches}</g>
      )}
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
      {kind === "org" && (
        <>
          {root(19, 3, 14, 7)}
          <path d="M26 10 L26 20 L14 20" fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <path d="M26 20 L38 20" fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={6} y={20} width={16} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <rect x={30} y={20} width={16} height={6} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
        </>
      )}
      {kind === "catalog" && (
        <>
          {root(19, 3, 14, 7)}
          <path d="M26 10 L26 16" fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <rect x={19} y={13} width={14} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <path d="M26 19 L29 22" fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={23} y={22} width={12} height={5} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
          <path d="M29 27 L29 29" fill="none" stroke={colors[2]} strokeWidth={1.2} />
          <rect x={23} y={29} width={12} height={5} rx={1.5} fill="#fff" stroke={colors[2]} strokeWidth={1} />
        </>
      )}
      {kind === "timeline" && (
        <>
          {root(3, 15, 11, 7)}
          <path d="M14 18.5 L48 18.5" fill="none" stroke="#8b95a5" strokeWidth={1.4} />
          {[18, 30, 42].map((x, i) => (
            <rect key={i} x={x} y={15} width={11} height={7} rx={2} fill="#fff" stroke={colors[i]} strokeWidth={1} />
          ))}
        </>
      )}
      {kind === "fishbone" && (
        <>
          {root(40, 15, 11, 7)}
          <path d="M45 18.5 L8 18.5" fill="none" stroke="#8b95a5" strokeWidth={1.4} />
          <path d="M30 18.5 L24 7" fill="none" stroke={colors[0]} strokeWidth={1.2} />
          <rect x={18} y={4} width={12} height={6} rx={1.5} fill="#fff" stroke={colors[0]} strokeWidth={1} />
          <path d="M16 18.5 L16 30" fill="none" stroke={colors[1]} strokeWidth={1.2} />
          <rect x={10} y={27} width={12} height={6} rx={1.5} fill="#fff" stroke={colors[1]} strokeWidth={1} />
        </>
      )}
    </svg>
  );
}

export function ThemeSwatch({ id }: { id: string }) {
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

/**
 * 分支样式缩略图：每个缩略图就是该样式真实绘制的连线形态，
 * 图标与画布同源，所见即所得。
 */
export function BranchThumb({ kind }: { kind: string }) {
  const c = "#5b6472";
  const common = {
    fill: "none",
    stroke: c,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true">
      {kind === "default" && <path d="M4 12 C 14 12, 18 12, 30 12" {...common} />}
      {kind === "bracket-left" && <path d="M4 6 L 14 6 L 14 18 L 30 18" {...common} />}
      {kind === "bracket-right" && <path d="M4 18 L 20 18 L 20 6 L 30 6" {...common} />}
      {kind === "brace" && (
        <path d="M4 4 C 12 4, 9 11, 4 12 C 9 13, 12 20, 4 20 M4 12 L 30 12" {...common} />
      )}
      {kind === "arc-right" && <path d="M4 12 Q 17 2, 30 12" {...common} />}
      {kind === "arc-left" && <path d="M4 12 Q 17 22, 30 12" {...common} />}
      {kind === "fork" && <path d="M4 12 L 16 12 M 16 5 L 30 12 M 16 19 L 30 12" {...common} />}
      {kind === "hook" && <path d="M4 8 L 13 8 L 13 16 L 30 16 M 30 16 L 30 10" {...common} />}
    </svg>
  );
}

/* ----------------------------- 面板 ----------------------------- */

/** 节点样式：形状 / 文字颜色 / 填充 / 边框颜色 / 外框线型 */
export function NodeStylePanel({
  style,
  onStyle,
}: {
  style: MindNodeStyle;
  onStyle: (patch: Partial<MindNodeStyle>) => void;
}) {
  return (
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
          <button
            key={c}
            type="button"
            className={`mm-swatch ${(style.background ?? "transparent") === c ? "is-on" : ""} ${c === "transparent" ? "is-none" : ""}`}
            style={{ background: c === "transparent" ? "#fff" : c }}
            title={c === "transparent" ? "无填充" : c}
            onClick={() => onStyle({ background: c === "transparent" ? undefined : c })}
          />
        ))}
      </div>
      <PopLabel>边框颜色</PopLabel>
      <div className="mm-swatches">
        {BORDER_COLORS.map((c) => (
          <button key={c} type="button" className={`mm-swatch ${style.borderColor === c ? "is-on" : ""}`} style={{ background: c }} title={c} onClick={() => onStyle({ borderColor: style.borderColor === c ? undefined : c })} />
        ))}
      </div>
      <PopLabel>外框线型</PopLabel>
      <div className="mm-seg">
        {BORDER_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`mm-seg-btn ${(style.borderStyle ?? "solid") === s.id ? "is-on" : ""}`}
            title={s.label}
            onClick={() =>
              onStyle({
                borderStyle: (style.borderStyle ?? "solid") === s.id ? undefined : s.id,
              } as Partial<MindNodeStyle>)
            }
          >
            {/* 线型示意：用一段对应 dash 的横线，视觉上直接看出实/虚/点/点划 */}
            <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="25"
                y2="4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray={
                  s.id === "solid"
                    ? undefined
                    : s.id === "dashed"
                    ? "5 3"
                    : s.id === "dotted"
                    ? "1 3"
                    : "6 2.5 1 2.5"
                }
              />
            </svg>
            <span className="mm-seg-cap">{s.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** 基础样式：默认字体字号 / 连线（颜色·线型·箭头·色彩）/ 分支样式 / 圆角 */
export function BaseStylePanel({
  base,
  onBase,
}: {
  base: BaseStyle;
  onBase: (patch: Partial<BaseStyle>) => void;
}) {
  return (
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

      {/* ---- 连线线型：实线 / 虚线 / 从粗到细（8px → 2px） ---- */}
      <PopLabel>连线线型</PopLabel>
      <div className="mm-seg">
        {LINK_PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`mm-seg-btn ${(base.linkPattern ?? "solid") === p.id ? "is-on" : ""}`}
            title={p.label}
            onClick={() =>
              onBase({
                linkPattern: (base.linkPattern ?? "solid") === p.id ? undefined : p.id,
              } as Partial<BaseStyle>)
            }
          >
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
              {p.id === "taper" ? (
                /* 从粗到细：左端 8px、右端 2px 的渐窄带 */
                <path d="M2 1 L32 4.2 L32 5.8 L2 9 Z" fill="currentColor" />
              ) : (
                <line x1="2" y1="5" x2="32" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeDasharray={p.id === "dashed" ? "5 3" : undefined} />
              )}
            </svg>
            <span className="mm-seg-cap">{p.label}</span>
          </button>
        ))}
      </div>

      {/* ---- 连线箭头：无 / 向外 / 向内 ---- */}
      <PopLabel>连线箭头</PopLabel>
      <div className="mm-seg">
        {LINK_ARROWS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`mm-seg-btn ${(base.linkArrow ?? "none") === a.id ? "is-on" : ""}`}
            title={a.label}
            onClick={() =>
              onBase({
                linkArrow: (base.linkArrow ?? "none") === a.id ? undefined : a.id,
              } as Partial<BaseStyle>)
            }
          >
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
              <line x1="4" y1="5" x2="30" y2="5" stroke="currentColor" strokeWidth="1.6" />
              {a.id === "outward" && <polygon points="34,5 27,1.6 27,8.4" fill="currentColor" />}
              {a.id === "inward" && <polygon points="0,5 7,1.6 7,8.4" fill="currentColor" />}
            </svg>
            <span className="mm-seg-cap">{a.label}</span>
          </button>
        ))}
      </div>

      {/* ---- 连线色彩：彩色（按分支）/ 单色 ---- */}
      <PopLabel>连线色彩</PopLabel>
      <div className="mm-seg">
        {LINK_COLOR_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mm-seg-btn ${(base.linkColorMode ?? "auto") === m.id ? "is-on" : ""}`}
            title={m.label}
            onClick={() =>
              onBase({
                linkColorMode: (base.linkColorMode ?? "auto") === m.id ? undefined : m.id,
              } as Partial<BaseStyle>)
            }
          >
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
              {m.id === "auto" ? (
                /* 彩色：三段分色，暗示按分支取主题色 */
                <>
                  <line x1="2" y1="5" x2="13" y2="5" stroke="#2f6fed" strokeWidth="2" strokeLinecap="round" />
                  <line x1="14" y1="5" x2="24" y2="5" stroke="#00a870" strokeWidth="2" strokeLinecap="round" />
                  <line x1="25" y1="5" x2="32" y2="5" stroke="#f0a020" strokeWidth="2" strokeLinecap="round" />
                </>
              ) : (
                <line x1="2" y1="5" x2="32" y2="5" stroke="#5b6472" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
            <span className="mm-seg-cap">{m.label}</span>
          </button>
        ))}
      </div>

      {/* ---- 分支样式：括号 / 圆弧 / 分叉等 ---- */}
      <PopLabel>分支样式</PopLabel>
      <div className="mm-branch-grid">
        {BRANCH_STYLES.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`mm-branch-card ${(base.branchStyle ?? "default") === b.id ? "is-on" : ""}`}
            title={b.label}
            onClick={() =>
              onBase({
                branchStyle: (base.branchStyle ?? "default") === b.id ? undefined : b.id,
              } as Partial<BaseStyle>)
            }
          >
            <BranchThumb kind={b.id} />
            <span>{b.label}</span>
          </button>
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
  );
}

/** 主题：按分类列出全部主题 */
export function ThemePanel({
  config,
  onConfig,
}: {
  config: MindMapConfig;
  onConfig: (patch: Partial<MindMapConfig>) => void;
}) {
  const byCat: { cat: CanvasCategory; label: string; items: typeof THEME_LIST }[] =
    THEME_CATEGORIES.map((c) => ({
      cat: c.id,
      label: c.label,
      items: THEME_LIST.filter((t) => t.category === c.id),
    }));
  return (
    <>
      {byCat.map((g) => (
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
  );
}

/** 结构：布局结构 + 连线样式 */
export function StructurePanel({
  config,
  onConfig,
}: {
  config: MindMapConfig;
  onConfig: (patch: Partial<MindMapConfig>) => void;
}) {
  return (
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
          <button key={k} type="button" className={`mm-seg-btn ${config.lineStyle === k ? "is-on" : ""}`} onClick={() => onConfig({ lineStyle: k })}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

/** 标记（可多选） */
export function MarkerPanel({
  markers,
  onToggleMarker,
}: {
  markers: string[];
  onToggleMarker: (id: string) => void;
}) {
  return (
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
        onClick={() => markers.forEach((m) => onToggleMarker(m))}
      >
        清除全部标记
      </button>
    </>
  );
}

/** 优先级 1–9 */
export function PriorityPanel({
  priority,
  onSetPriority,
}: {
  priority?: number;
  onSetPriority: (v: number | undefined) => void;
}) {
  return (
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
        清除优先级
      </button>
    </>
  );
}

/** 进度 0–100% */
export function ProgressPanel({
  progress,
  onSetProgress,
}: {
  progress?: number;
  onSetProgress: (v: number | undefined) => void;
}) {
  return (
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
        清除进度
      </button>
    </>
  );
}

/** 图标前缀（可多选） */
export function IconPanel({
  icons,
  onToggleIcon,
}: {
  icons: string[];
  onToggleIcon: (id: string) => void;
}) {
  return (
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
        清除全部图标
      </button>
    </>
  );
}

/** 通用包装：给面板加个「暂不改动」提示（主菜单里用于不可用项） */
export function PanelHint({ children }: { children: ReactNode }) {
  return <div className="mm-pop-tip">{children}</div>;
}
