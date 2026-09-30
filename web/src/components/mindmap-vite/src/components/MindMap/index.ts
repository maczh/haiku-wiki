export { MindMap } from "./MindMap";
export { Toolbar } from "./Toolbar";
export type { ToolbarProps } from "./Toolbar";
export { Dialog } from "./Dialog";
export { Icon } from "./Icons";
export type { IconName, IconProps } from "./Icons";

export type {
  MindNode,
  MindNodeShape,
  MindNodeStyle,
  MindNodeImage,
  MindNodeFrame,
  MindGeneralization,
  MindAssocLine,
  MindMapApi,
  MindMapProps,
  MindMapConfig,
  BaseStyle,
  CanvasCategory,
  LineStyle,
  StructureType,
  TextDefaults,
} from "./types";
export {
  DEFAULT_CONFIG,
  DEFAULT_TEXT,
  FONT_FAMILIES,
  FONT_SIZES,
  SHAPES,
} from "./types";

export { layoutTree, nodeSize, textCenterX } from "./layout";
export type { PositionedNode, MindLink, LayoutResult, SizedNode } from "./layout";

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
