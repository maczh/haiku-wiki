/** 节点形状 */
export type MindNodeShape = "rect" | "rounded" | "capsule" | "underline" | "none";

/** 单个节点的文字 / 外观样式。 */
export interface MindNodeStyle {
  /** 字号，默认 14 */
  fontSize?: number;
  /** 字体，默认 Microsoft YaHei 系列 */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** 文字颜色 */
  color?: string;
  /** 节点填充色 */
  background?: string;
  /** 节点描边 / 连线颜色（分支强调色） */
  borderColor?: string;
  /** 描边宽度 */
  borderWidth?: number;
  /** 节点圆角（覆盖主题基准圆角；按节点宽高一半内敛） */
  borderRadius?: number;
  /** 节点形状 */
  shape?: MindNodeShape;
}

/** 节点缩略图（simple-mind-map 迁移补齐项） */
export interface MindNodeImage {
  url: string;
  /** 图片标题（tooltip） */
  title?: string;
  width?: number;
  height?: number;
  /** 是否使用自定义尺寸（而非等比缩略） */
  custom?: boolean;
}

/** 关联线（simple-mind-map 迁移补齐项）：根节点上挂载，连接两个节点 */
export interface MindAssocLine {
  id: string;
  fromId: string;
  toId: string;
  /** 连线文案（居中显示） */
  label?: string;
  color?: string;
}

/** 外框（simple-mind-map 迁移补齐项）：框住该节点及其子树 */
export interface MindNodeFrame {
  color?: string;
  /** 标签（外框左上角文字） */
  label?: string;
}

/** 概要（simple-mind-map 迁移补齐项）：从该节点出发的_summary 汇总连线 */
export interface MindGeneralization {
  /** 汇总指向的节点 id（范围内最深的节点） */
  targetId: string;
  /** 概要节点文案 */
  text?: string;
}

/** 思维导图节点（嵌套树结构，组件内部统一使用）。 */
export interface MindNode {
  id: string;
  title: string;
  children: MindNode[];
  /** 是否收起（不渲染子节点） */
  collapsed?: boolean;
  /** 节点强调色（描边 / 连线颜色），等价于 style.borderColor 的快捷方式 */
  color?: string;
  /** 扩展样式 */
  style?: MindNodeStyle;
  /** 备注（图标形式展示，hover 可见） */
  note?: string;
  /** 超链接 */
  link?: string;
  /** 标记 / 图标，如 priority-1、flag-red、star、question */
  markers?: string[];
  /** 是否为根节点 */
  isRoot?: boolean;
  /** 优先级 1 - 9（作为前缀图标渲染） */
  priority?: number;
  /** 进度 0 - 10（0% ~ 100%，步长 10%；作为前缀饼图渲染） */
  progress?: number;
  /** 节点图标前缀（emoji 图标 id 列表） */
  icons?: string[];
  /* ---------------- 以下为 simple-mind-map 迁移补齐的能力 ---------------- */
  /** 节点缩略图 */
  image?: MindNodeImage;
  /** 标签（小色块文本，排列在文字前缀之后） */
  tags?: string[];
  /** LaTeX 公式（不含 $ 定界符；有值时节点正文渲染为公式） */
  formula?: string;
  /** 外框 */
  frame?: MindNodeFrame;
  /** 概要（汇总连线） */
  generalization?: MindGeneralization;
  /**
   * 根节点专属：关联线集合（挂在根节点上，避免污染普通节点的树结构语义）。
   * 只有 tree 的根节点会读取该字段。
   */
  assocLines?: MindAssocLine[];
}

/** 主题分类：经典 / 深色 / 朴素 */
export type CanvasCategory = "classic" | "dark" | "plain";
/** 连线样式 */
export type LineStyle = "curve" | "elbow";
/** 结构（对应「结构」面板） */
export type StructureType =
  | "logical-right"
  | "logical-left"
  | "mindmap"
  | "org"
  | "catalog"
  | "timeline"
  | "fishbone";

/** 全局「基础样式」覆盖（作用于整张画布） */
export interface BaseStyle {
  fontFamily?: string;
  fontSize?: number;
  /** 画布背景色 */
  background?: string;
  /** 连线颜色 */
  linkColor?: string;
  /** 连线宽度 */
  linkWidth?: number;
  /** 节点圆角 */
  radius?: number;
  /** 节点描边宽度 */
  strokeWidth?: number;
  /** 默认节点填充色 */
  nodeFill?: string;
  /** 默认节点文字色 */
  nodeText?: string;
}

/** 全局视图配置（对应工具栏 4 个面板）。 */
export interface MindMapConfig {
  /** 主题 id（见 THEME_LIST） */
  themeId: string;
  /** 结构 */
  structure: StructureType;
  /** 连线样式 */
  lineStyle: LineStyle;
  /** 基础样式覆盖 */
  base: BaseStyle;
}

export const DEFAULT_CONFIG: MindMapConfig = {
  themeId: "classic-blue",
  // 未指定结构时默认「思维导图」（左右均衡），而非逻辑结构图
  structure: "mindmap",
  lineStyle: "curve",
  base: {},
};

/** 新建节点时继承的默认文字样式（工具栏无选中时即为默认值）。 */
export interface TextDefaults {
  fontSize: number;
  fontFamily: string;
}

export const DEFAULT_TEXT: TextDefaults = {
  fontSize: 14,
  fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
};

/** 工具栏可选的字体列表 */
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "微软雅黑", value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { label: "苹方", value: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: "宋体", value: '"SimSun", "Songti SC", serif' },
  { label: "黑体", value: '"SimHei", "Heiti SC", sans-serif' },
  { label: "楷体", value: '"KaiTi", "Kaiti SC", serif' },
  { label: "仿宋", value: '"FangSong", serif' },
  { label: "思源黑体", value: '"Source Han Sans SC", "Noto Sans SC", sans-serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times", value: '"Times New Roman", Times, serif' },
  { label: "Consolas", value: 'Consolas, "Courier New", monospace' },
];

/** 工具栏可选字号 */
export const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48];

/** 节点形状可选值 */
export const SHAPES: { id: MindNodeShape; label: string }[] = [
  { id: "rect", label: "矩形" },
  { id: "rounded", label: "圆角矩形" },
  { id: "capsule", label: "胶囊" },
  { id: "underline", label: "下划线" },
  { id: "none", label: "无边框" },
];

export interface MindMapProps {
  /** 根节点数据 */
  data: MindNode;
  /** 容器宽度，默认 100% */
  width?: number | string;
  /** 容器高度，默认 100% */
  height?: number | string;
  /** 附加 className */
  className?: string;
  /** 挂载时是否自动适应屏幕，默认 true */
  fitOnMount?: boolean;
  /** 是否可编辑，默认 true */
  editable?: boolean;
  /** 是否显示工具栏，默认 true */
  showToolbar?: boolean;
  /** 数据变更回调（受控使用时可自行持久化） */
  onChange?: (tree: MindNode) => void;
  /** 初始视图配置 */
  defaultConfig?: Partial<MindMapConfig>;
  /** 缩放比例变化回调（宿主缩放条 / H5 手势联动用） */
  onScaleChange?: (scale: number) => void;
  /** 选中节点变化回调（宿主工具条禁用态用） */
  onSelectChange?: (id: string | null) => void;
}

/**
 * 命令式 API（宿主通过 ref 调用）。
 * 宿主沿用既有浮动工具条，需要「像操作画布实例一样」驱动本组件；
 * 这里把所有内部操作收敛为一套接口，避免宿主直接依赖内部状态。
 */
export interface MindMapApi {
  /* 数据 */
  getTree(): MindNode;
  setTree(tree: MindNode): void;

  /* 撤销 / 重做 */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /* 结构操作 */
  addChild(): void;
  addSibling(before?: boolean): void;
  addParent(): void;
  removeNode(): void;
  outdent(): void;
  select(id: string | null): boolean;
  getSelectedId(): string | null;
  hasSelection(): boolean;

  /* 节点样式 / 新建节点文字默认值 */
  setNodeStyle(patch: Partial<MindNodeStyle>): void;
  getNodeStyle(): MindNodeStyle;
  clearNodeStyles(): void;
  getTextDefaults(): TextDefaults;
  setTextDefaults(patch: Partial<TextDefaults>): void;

  /* 配置 */
  getConfig(): MindMapConfig;
  setConfig(patch: Partial<MindMapConfig>): void;
  setStructure(s: StructureType): void;
  setLineStyle(s: LineStyle): void;
  setThemeId(t: string): void;
  setBase(patch: Partial<BaseStyle>): void;
  getBase(): BaseStyle;

  /* 运行期模式 */
  getMode(): "edit" | "readonly";
  setMode(m: "edit" | "readonly"): void;
  setWheelAction(a: "zoom" | "move"): void;
  setFreeDrag(v: boolean): void;

  /* 视图 */
  zoomIn(): void;
  zoomOut(): void;
  fitView(): void;
  resetView(): void;
  /** 把根节点居中（保持当前缩放） */
  centerRoot(): void;
  getScale(): number;
  /** 读取当前视图变换（与 setView 同一坐标系：内容坐标 s 映射到屏幕 s*scale + t） */
  getView(): { scale: number; tx: number; ty: number };
  /**
   * 直接写入视图变换（scale / tx / ty 均可选，缺省沿用当前值）。
   * H5 原生无级缩放用：宿主按手指位置算出新的 scale 与平移量后一次写入，
   * 等价于 simple-mind-map 时代的 `view.scale/x/y + view.transform()`。
   */
  setView(v: { scale?: number; tx?: number; ty?: number }): void;

  /* 展开 / 收起 */
  expandAll(): void;
  collapseToDepth(d: number): void;
  toggleCollapse(id?: string): void;

  /* 节点补充属性 */
  setNote(text: string): void;
  getNote(): string;
  setLink(url: string): void;
  getLink(): string;
  setImage(img: MindNodeImage | null): void;
  getImage(): MindNodeImage | undefined;
  setTags(tags: string[]): void;
  getTags(): string[];
  setFormula(f: string | null): void;
  getFormula(): string;
  setFrame(f: MindNodeFrame | null): void;
  getFrame(): MindNodeFrame | undefined;
  setGeneralization(g: MindGeneralization | null): void;
  getGeneralization(): MindGeneralization | undefined;

  /* 标记 / 优先级 / 进度 / 图标前缀（宿主顶部工具条的面板用） */
  getPriority(): number | undefined;
  setPriority(v: number | undefined): void;
  getProgress(): number | undefined;
  setProgress(v: number | undefined): void;
  getIcons(): string[];
  toggleIcon(id: string): void;

  /* 关联线 */
  addAssocLine(fromId: string, toId: string, label?: string): void;
  removeAssocLine(id: string): void;
  getAssocLines(): MindAssocLine[];

  /* 导出 */
  getSvg(): unknown;
  exportPng(): void;
  exportAs(f: string): void;

  /* 几何 */
  getNodeBoxes(): Record<string, { x: number; y: number; w: number; h: number }>;
}
