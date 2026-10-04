import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { Popover, PopLabel } from "./Popover";
import {
  BaseStylePanel,
  IconPanel,
  MarkerPanel,
  NodeStylePanel,
  PriorityPanel,
  ProgressPanel,
  StructurePanel,
  ThemePanel,
} from "./panels";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  type BaseStyle,
  type MindMapConfig,
  type MindNodeStyle,
  type TextDefaults,
} from "./types";
import { EXPORT_LABELS, IMPORT_ACCEPT, type ExportFormat } from "./io";

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
  priority?: number;
  onSetPriority: (v: number | undefined) => void;
  progress?: number;
  onSetProgress: (v: number | undefined) => void;
  icons: string[];
  onToggleIcon: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (format: ExportFormat) => void;
  onNew: () => void;
  /** 九宫格主菜单（内含工具条全部功能 + 下级子菜单） */
  mainMenu: ReactNode;
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
  ["Ctrl / Cmd + 左键", "多选节点（选中 ≥2 个后浮现关联线 / 概要 / 分组）"],
  ["Ctrl + Z", "撤销"],
  ["Ctrl + Shift + Z", "重做"],
  ["Ctrl + S", "保存 .km 文件"],
  ["Esc", "取消选中 / 退出编辑"],
];

/* ------------------------------------------------------------------ *
 * 工具条主体
 *
 * 编排顺序（从左到右）：
 *   ① 主菜单（九宫格）→ ② 文件 → ③ 撤销/重做 → ④ 结构编辑 + 标记
 *   → ⑤ 字号/字体 → ⑥ 字符样式 → ⑦ 备注/链接
 *   → ⑧ 节点样式 → ⑨ 基础样式 → ⑩ 主题 → ⑪ 结构
 *   → ⑫ 优先级 → ⑬ 进度 → ⑭ 图标 → ⑮ 快捷键 → ⑯ 删除
 *
 * 所有功能按钮一律**只留图标**，文字信息通过 `title`（悬停提示）承载。
 * 多选聚合（关联线 / 概要 / 分组）不在这里 —— 它由画布上的
 * MultiSelectBar 在选中 ≥2 个节点时浮动出现。
 * ------------------------------------------------------------------ */

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
    mainMenu,
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

  /** 纯图标按钮的内容（文字信息走 title） */
  const ico = (name: IconName, size = 18) => <Icon name={name} size={size} />;

  return (
    <div className="mm-toolbar" onMouseDown={guard}>
      {/* ① 主菜单（九宫格）：内含工具条全部功能 */}
      {mainMenu}

      {/* ② 文件 */}
      <Popover
        title="文件：新建 / 打开 / 保存 / 导出"
        align="left"
        width={244}
        trigger={() => ico("folder", 17)}
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
              <button key={f} type="button" className="mm-pop-action" onClick={() => { onExport(f); close(); }}>
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

      <i className="mm-tb-sep" />

      {/* ③ 撤销 / 重做 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          {ico("undo")}
        </button>
        <button type="button" className="mm-tb-btn" title="重做 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          {ico("redo")}
        </button>
      </div>

      <i className="mm-tb-sep" />

      {/* ④ 结构编辑 + 标记 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="插入上级节点" onClick={onInsertParent}>
          {ico("insert-parent")}
        </button>
        <button type="button" className="mm-tb-btn" title="在下方插入同级节点 (Enter)" onClick={onInsertSiblingAfter}>
          {ico("insert-sibling-below")}
        </button>
        <button type="button" className="mm-tb-btn" title="在上方插入同级节点 (Shift+Enter)" onClick={onInsertSiblingBefore}>
          {ico("insert-sibling-above")}
        </button>
        <button type="button" className="mm-tb-btn" title="插入子节点 (Tab)" onClick={onInsertChild}>
          {ico("insert-child")}
        </button>
        <Popover title="标记（可多选）" width={224} trigger={() => ico("marker")}>
          {() => <MarkerPanel markers={markers} onToggleMarker={onToggleMarker} />}
        </Popover>
      </div>

      <i className="mm-tb-sep" />

      {/* ⑤ 字号 / 字体 */}
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

      {/* ⑥ 字符样式 */}
      <div className="mm-tb-group">
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.bold ? "is-on" : ""}`} title="加粗 (Ctrl+B)" style={{ fontWeight: 800 }} onClick={() => onStyle({ bold: !style.bold })}>B</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.italic ? "is-on" : ""}`} title="斜体 (Ctrl+I)" style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }} onClick={() => onStyle({ italic: !style.italic })}>I</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.underline ? "is-on" : ""}`} title="下划线 (Ctrl+U)" style={{ textDecoration: "underline" }} onClick={() => onStyle({ underline: !style.underline })}>U</button>
        <button type="button" className={`mm-tb-btn mm-tb-letter ${style.strike ? "is-on" : ""}`} title="删除线" style={{ textDecoration: "line-through" }} onClick={() => onStyle({ strike: !style.strike })}>S</button>
      </div>

      <i className="mm-tb-sep" />

      {/* ⑦ 备注 / 链接 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="节点备注" onClick={onNote}>
          {ico("note")}
        </button>
        <button type="button" className="mm-tb-btn" title="超链接" onClick={onLink}>
          {ico("link")}
        </button>
      </div>

      <i className="mm-tb-sep" />

      {/* ⑧ 节点样式 */}
      <Popover title="节点样式：形状 / 颜色 / 填充 / 外框线型" align="left" width={236} trigger={() => ico("node-style", 17)}>
        {() => <NodeStylePanel style={style} onStyle={onStyle} />}
      </Popover>

      {/* ⑨ 基础样式 */}
      <Popover title="基础样式：连线 / 分支 / 圆角" align="left" width={236} trigger={() => ico("base-style", 17)}>
        {() => <BaseStylePanel base={base} onBase={onBase} />}
      </Popover>

      {/* ⑩ 主题 */}
      <Popover title="主题" align="left" width={252} trigger={() => ico("theme", 17)}>
        {() => <ThemePanel config={config} onConfig={onConfig} />}
      </Popover>

      {/* ⑪ 结构 */}
      <Popover title="结构：布局 / 连线样式" align="left" width={236} trigger={() => ico("structure", 17)}>
        {() => <StructurePanel config={config} onConfig={onConfig} />}
      </Popover>

      {/* ⑫ 优先级 */}
      <Popover title="优先级" align="left" width={208} trigger={() => ico("priority", 17)}>
        {() => <PriorityPanel priority={priority} onSetPriority={onSetPriority} />}
      </Popover>

      {/* ⑬ 进度 */}
      <Popover title="进度" align="left" width={208} trigger={() => ico("progress", 17)}>
        {() => <ProgressPanel progress={progress} onSetProgress={onSetProgress} />}
      </Popover>

      {/* ⑭ 图标 */}
      <Popover title="图标前缀（可多选）" align="left" width={236} trigger={() => ico("icon", 17)}>
        {() => <IconPanel icons={icons} onToggleIcon={onToggleIcon} />}
      </Popover>

      <i className="mm-tb-sep" />

      {/* ⑮ 快捷键 */}
      <Popover title="快捷键" align="right" width={252} trigger={() => ico("keyboard", 17)}>
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

      {/* ⑯ 删除 */}
      <div className="mm-tb-group">
        <button type="button" className="mm-tb-btn" title="删除节点 (Delete)" disabled={!canDelete} onClick={onDelete}>
          {ico("trash")}
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
