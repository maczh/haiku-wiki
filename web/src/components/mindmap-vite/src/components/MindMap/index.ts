export { MindMap } from "./MindMap";
export { Toolbar } from "./Toolbar";
export type { ToolbarProps } from "./Toolbar";
/* 多选浮动条（关联线 / 概要 / 分组）与九宫格主菜单 */
export { MultiSelectBar } from "./MultiSelectBar";
export type { MultiSelectBarProps } from "./MultiSelectBar";
export { MainMenu, buildMainMenu } from "./Menu";
export type { MainMenuItem, MainMenuProps, MainMenuActions } from "./Menu";
/* 工具条 / 主菜单共用的面板（可在外层自定义菜单时复用） */
export {
  NodeStylePanel,
  BaseStylePanel,
  ThemePanel,
  StructurePanel,
  MarkerPanel,
  PriorityPanel,
  ProgressPanel,
  IconPanel,
  StructureThumb,
  ThemeSwatch,
  BranchThumb,
} from "./panels";
export { Dialog } from "./Dialog";
export { Icon } from "./Icons";
export type { IconName, IconProps } from "./Icons";

export type {
  MindNode,
  MindNodeShape,
  MindNodeStyle,
  MindBorderStyle,
  MindNodeImage,
  MindNodeFrame,
  MindGeneralization,
  MindAssocLine,
  MindAssocArrow,
  MindSummaryGroup,
  MindFrameGroup,
  MindMapApi,
  MindMapProps,
  MindMapConfig,
  BaseStyle,
  CanvasCategory,
  LineStyle,
  StructureType,
  TextDefaults,
  LinkPattern,
  LinkArrow,
  LinkColorMode,
  BranchStyle,
} from "./types";
export {
  DEFAULT_CONFIG,
  DEFAULT_TEXT,
  FONT_FAMILIES,
  FONT_SIZES,
  SHAPES,
  BORDER_STYLES,
  BORDER_DASH,
  LINK_PATTERNS,
  LINK_ARROWS,
  LINK_COLOR_MODES,
  BRANCH_STYLES,
} from "./types";

export { layoutTree, nodeSize, textCenterX } from "./layout";
export type { PositionedNode, MindLink, LayoutResult, SizedNode } from "./layout";

/* --------------------- 手绘风格 / 分支样式路径生成 --------------------- */
/**
 * `sketch*` 是「双笔触」手绘（仿参考截图：每笔画两遍、两笔在两端收拢、
 * 中段错开、转角出头）；`hand*` 是它的单笔兼容版（取第 0 笔），
 * 保留给老调用方与新导出路径。
 */
export {
  handLine,
  handCurve,
  handRect,
  handEllipse,
  sketchLine,
  sketchCurve,
  sketchRect,
  sketchEllipse,
  sketchPath,
  sketchArrowHead,
} from "./handdrawn";
export type { SketchOptions } from "./handdrawn";
export { branchPath } from "./branchstyle";
export type { BranchGeom } from "./branchstyle";

export {
  THEME_LIST,
  THEME_MAP,
  THEME_CATEGORIES,
  THEME_CATEGORIES as THEME_GROUPS,
  DEFAULT_THEME_ID,
  STRUCTURES,
  BORDER_COLORS,
  STRUCTURE_MAP,
  MARKERS,
  MARKER_MAP,
  BRANCH_COLORS,
  TEXT_COLORS,
  HIGHLIGHT_COLORS,
  NODE_ICONS,
  NODE_ICON_MAP,
  PRIORITY_COLORS,
  PRIORITY_LEVELS,
  PROGRESS_LEVELS,
  PROGRESS_COLOR,
  PROGRESS_TRACK,
  buildBranchColors,
} from "./theme";
export type {
  CanvasTheme,
  MarkerDef,
  NodeIconDef,
} from "./theme";

export { measureText, wrapText } from "./text";
export type { TextMetrics } from "./text";

export * from "./tree";

/* ------------------------- 文件读写（导入 / 导出） ------------------------- */
export {
  mapFileStructure,
  parseMindmapFile,
  exportTree,
  downloadBlob,
  svgToPngBlob,
  EXPORT_LABELS,
  IMPORT_ACCEPT,
} from "./io";
export type { ParsedMindmap, ExportFormat, SvgPayload, ExportResult } from "./io";
export { parseMindmapJson, fromNested, fromFlat } from "./io";
export type { FlatNode } from "./io";
export {
  parseFreeMind,
  exportFreeMind,
  parseKityMinderXml,
  exportYoudaoFlat,
  exportKityMinder,
  exportSmm,
  escapeXml,
} from "./io";
export { parseXmind, exportXmind } from "./io";

/* --------------------------- 有道云笔记数据适配 --------------------------- */
export { adaptYoudaoMindmap } from "../../data/adapter";
export type { YoudaoMindmap, YoudaoNode } from "../../data/adapter";
