import type { CanvasCategory, LineStyle, MindNode, StructureType } from "./types";

/**
 * 鱼骨图专用强调色（仿参考截图「奇海 RIS 菜品模型」鱼骨图的蓝灰主色
 * rgb(115,161,191)）。鱼骨图是一种「单色骨架」图式：脊柱、斜骨、括号连线、
 * 一级胶囊描边、根节点填充统一使用这一支色，呈现截图里那种整体协调的蓝灰调，
 * 而非思维导图那种逐分支跳色。节点自身设置了 color / style.borderColor 时仍会优先。
 */
export const FISHBONE_ACCENT = "#73a1bf";

/** 分支配色盘（按根节点下第 N 个子分支循环取色） */
export const BRANCH_COLORS = [
  "#2f6fed",
  "#00a870",
  "#f0a020",
  "#e34d59",
  "#8b5cf6",
  "#0ea5e9",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];

/** 画布主题定义 */
export interface CanvasTheme {
  id: string;
  name: string;
  category: CanvasCategory;
  /** 画布背景 */
  background: string;
  /** 根节点填充 */
  rootFill: string;
  /** 根节点文字色 */
  rootText: string;
  /** 普通节点填充 */
  nodeFill: string;
  /** 普通节点文字色 */
  nodeText: string;
  /** 普通节点描边（不设置分支色时） */
  nodeStroke: string;
  /** 圆角半径 */
  radius: number;
  /** 描边宽度 */
  strokeWidth: number;
  /** 默认连线色 */
  linkColor: string;
  /** 连线宽度 */
  linkWidth: number;
  /** 是否使用分支彩色 */
  useBranchColor: boolean;
  /** 节点是否有描边 */
  nodeBorder: boolean;
  /** 该主题默认连线样式 */
  lineStyle: LineStyle;
  /**
   * 是否为「手绘」风格（截图 5）：节点外框与连线都改为手绘抖动路径。
   * 渲染层据此切换 path 生成器，见 MindMap.tsx 的 hand* 系列函数。
   */
  handDrawn?: boolean;
  /** 手绘抖动幅度（px），越大越潦草；仅 handDrawn 主题生效 */
  handJitter?: number;
}

/** 主题分类顺序与名称 */
export const THEME_CATEGORIES: { id: CanvasCategory; label: string }[] = [
  { id: "classic", label: "经典" },
  { id: "dark", label: "深色" },
  { id: "plain", label: "朴素" },
  { id: "hand", label: "手绘" },
];

const t = (
  id: string,
  name: string,
  category: CanvasCategory,
  o: Partial<CanvasTheme>
): CanvasTheme => ({
  id,
  name,
  category,
  background: "#f7f8fa",
  rootFill: "#2f6fed",
  rootText: "#ffffff",
  nodeFill: "#ffffff",
  nodeText: "#1f2329",
  nodeStroke: "#c4c9d1",
  radius: 10,
  strokeWidth: 2,
  linkColor: "#c4c9d1",
  linkWidth: 2,
  useBranchColor: true,
  nodeBorder: true,
  lineStyle: "curve",
  ...o,
});

export const THEME_LIST: CanvasTheme[] = [
  /* --------------------------- 经典 --------------------------- */
  t("classic-blue", "经典蓝", "classic", {}),
  t("classic-green", "经典绿", "classic", {
    rootFill: "#00a870",
    nodeStroke: "#b8d8cb",
    linkColor: "#bcd8cd",
  }),
  t("classic-orange", "经典橙", "classic", {
    rootFill: "#f0a020",
    nodeStroke: "#e6d3b1",
    linkColor: "#e6d5b6",
  }),
  t("classic-gold", "经典金", "classic", {
    rootFill: "#e8b339",
    nodeFill: "#fffdf5",
    nodeStroke: "#e2d4ad",
    linkColor: "#e2d6b3",
  }),
  t("classic-red", "经典红", "classic", {
    rootFill: "#e34d59",
    nodeStroke: "#e6c4c7",
    linkColor: "#e7c6c9",
  }),
  t("classic-purple", "经典紫", "classic", {
    rootFill: "#8b5cf6",
    nodeStroke: "#d3c8f2",
    linkColor: "#d5cbf3",
  }),
  /* --------------------------- 深色 --------------------------- */
  t("dark-blue", "深色蓝", "dark", {
    background: "#1b2130",
    rootFill: "#2f6fed",
    rootText: "#ffffff",
    nodeFill: "#27303f",
    nodeText: "#e6e9f0",
    nodeStroke: "#3c4657",
    linkColor: "#4b5a72",
  }),
  t("dark-green", "深色绿", "dark", {
    background: "#16211c",
    rootFill: "#00a870",
    rootText: "#ffffff",
    nodeFill: "#22322b",
    nodeText: "#e2efe8",
    nodeStroke: "#35483f",
    linkColor: "#3f5a4d",
  }),
  t("dark-purple", "深色紫", "dark", {
    background: "#1d1a2b",
    rootFill: "#8b5cf6",
    rootText: "#ffffff",
    nodeFill: "#2a2740",
    nodeText: "#eae6f7",
    nodeStroke: "#413c5c",
    linkColor: "#4d476b",
  }),
  t("dark-gray", "深色灰", "dark", {
    background: "#1f2329",
    rootFill: "#4a5262",
    rootText: "#ffffff",
    nodeFill: "#2b313a",
    nodeText: "#e4e7ec",
    nodeStroke: "#3c434d",
    linkColor: "#4a5260",
    useBranchColor: false,
  }),
  /* --------------------------- 朴素 --------------------------- */
  t("plain-gray", "朴素灰", "plain", {
    background: "#ffffff",
    rootFill: "#ffffff",
    rootText: "#1f2329",
    nodeFill: "#ffffff",
    nodeText: "#3d4451",
    nodeStroke: "#dcdfe6",
    radius: 4,
    strokeWidth: 1,
    linkColor: "#d4d7de",
    linkWidth: 1.5,
    useBranchColor: false,
    lineStyle: "elbow",
  }),
  t("plain-blue", "朴素蓝", "plain", {
    background: "#ffffff",
    rootFill: "#eef4ff",
    rootText: "#2f6fed",
    nodeFill: "#ffffff",
    nodeText: "#3d4451",
    nodeStroke: "#cfdcf5",
    radius: 6,
    strokeWidth: 1,
    linkColor: "#c9dcff",
    linkWidth: 1.5,
    useBranchColor: false,
    lineStyle: "elbow",
  }),
  t("plain-green", "素雅绿", "plain", {
    background: "#ffffff",
    rootFill: "#e9f8f1",
    rootText: "#0f8a5f",
    nodeFill: "#ffffff",
    nodeText: "#3d4451",
    nodeStroke: "#cfe6db",
    radius: 6,
    strokeWidth: 1,
    linkColor: "#c3e2d5",
    linkWidth: 1.5,
    useBranchColor: false,
    lineStyle: "elbow",
  }),
  t("plain-minimal", "极简", "plain", {
    background: "#ffffff",
    rootFill: "#ffffff",
    rootText: "#1f2329",
    nodeFill: "#ffffff",
    nodeText: "#1f2329",
    nodeStroke: "#ffffff",
    radius: 0,
    strokeWidth: 0,
    linkColor: "#b9bec7",
    linkWidth: 1.2,
    useBranchColor: false,
    nodeBorder: false,
    lineStyle: "elbow",
  }),
  /* --------------------------- 手绘 --------------------------- */
  /* 参考截图：中心节点为紫色双笔椭圆、四周彩色圆角矩形（每笔描两遍）、
     连线是两根夹着走的灰线、箭头是空心的「V」。
     handJitter 是「单笔起伏幅度」（px），取小值 —— 幅度一大就变成折线毛刺；
     双笔的张开量（gap）由渲染层按形状分配：椭圆 3.6、矩形 2.2、连线 1.5。
     因为每笔画两遍，描边都必须比常规主题细一点，否则两条线糊成一片。 */
  t("hand-colorful", "手绘彩色", "hand", {
    background: "#fdfcf7",
    rootFill: "#b79aee",
    rootText: "#ffffff",
    nodeFill: "#ffffff",
    nodeText: "#2f2a3d",
    nodeStroke: "#6b6580",
    radius: 12,
    strokeWidth: 1.7,
    linkColor: "#9a94ad",
    linkWidth: 1.3,
    useBranchColor: true,
    handDrawn: true,
    handJitter: 1.1,
  }),
  t("hand-blueprint", "手绘蓝图", "hand", {
    background: "#f5f7fa",
    rootFill: "#5b8def",
    rootText: "#ffffff",
    nodeFill: "#ffffff",
    nodeText: "#243247",
    nodeStroke: "#4a6a9c",
    radius: 14,
    strokeWidth: 1.7,
    linkColor: "#8fa8c9",
    linkWidth: 1.3,
    useBranchColor: false,
    handDrawn: true,
    handJitter: 0.9,
  }),
  t("hand-forest", "手绘森野", "hand", {
    background: "#faf7ef",
    rootFill: "#5aa469",
    rootText: "#ffffff",
    nodeFill: "#fffdf6",
    nodeText: "#2f3b30",
    nodeStroke: "#5f7a63",
    radius: 16,
    strokeWidth: 1.7,
    linkColor: "#93ab8f",
    linkWidth: 1.3,
    useBranchColor: true,
    handDrawn: true,
    handJitter: 1.3,
  }),
];

export const THEME_MAP = new Map(THEME_LIST.map((th) => [th.id, th]));
export const DEFAULT_THEME_ID = THEME_LIST[0].id;

/* ------------------------------ 结构 ------------------------------ */

export const STRUCTURES: {
  id: StructureType;
  label: string;
  /** 缩略图样式变体 */
  thumb: string;
}[] = [
  { id: "logical-right", label: "逻辑结构图", thumb: "logical-right" },
  { id: "logical-left", label: "逻辑结构图", thumb: "logical-left" },
  { id: "mindmap", label: "思维导图", thumb: "mindmap" },
  { id: "org", label: "组织结构图", thumb: "org" },
  { id: "catalog", label: "目录组织图", thumb: "catalog" },
  { id: "timeline", label: "时间轴", thumb: "timeline" },
  { id: "fishbone", label: "鱼骨图", thumb: "fishbone" },
];

export const STRUCTURE_MAP = new Map(STRUCTURES.map((s) => [s.id, s]));

/* ------------------------------ 标记 ------------------------------ */

/** 标记（图标）定义，附带用于绘制的单字 / 颜色。 */
export interface MarkerDef {
  id: string;
  label: string;
  char: string;
  bg: string;
  fg: string;
}

export const MARKERS: MarkerDef[] = [
  { id: "priority-1", label: "优先级 1", char: "1", bg: "#e34d59", fg: "#fff" },
  { id: "priority-2", label: "优先级 2", char: "2", bg: "#f0a020", fg: "#fff" },
  { id: "priority-3", label: "优先级 3", char: "3", bg: "#2f6fed", fg: "#fff" },
  { id: "flag-red", label: "红旗", char: "⚑", bg: "#e34d59", fg: "#fff" },
  { id: "flag-blue", label: "蓝旗", char: "⚑", bg: "#2f6fed", fg: "#fff" },
  { id: "flag-green", label: "绿旗", char: "⚑", bg: "#00a870", fg: "#fff" },
  { id: "star", label: "星标", char: "★", bg: "#f0a020", fg: "#fff" },
  { id: "check", label: "已完成", char: "✓", bg: "#00a870", fg: "#fff" },
  { id: "question", label: "待确认", char: "?", bg: "#8b5cf6", fg: "#fff" },
  { id: "smiley", label: "笑脸", char: "☺", bg: "#f0a020", fg: "#fff" },
  { id: "heart", label: "心动", char: "♥", bg: "#ec4899", fg: "#fff" },
  { id: "idea", label: "灵感", char: "!", bg: "#14b8a6", fg: "#fff" },
];

export const MARKER_MAP = new Map(MARKERS.map((m) => [m.id, m]));

/* --------------------------- 优先级 / 进度 --------------------------- */

/** 优先级 1-9 的配色（参照 Simple Mind Map：1 红 2 蓝 3 绿 4 橙 5 紫 6-9 灰） */
export const PRIORITY_COLORS: Record<number, string> = {
  1: "#e5484d",
  2: "#2f6fed",
  3: "#17a34a",
  4: "#e08b2a",
  5: "#8b5cf6",
  6: "#9aa4b2",
  7: "#9aa4b2",
  8: "#9aa4b2",
  9: "#9aa4b2",
};

export const PRIORITY_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 进度取值 0 ~ 10（每级 10%） */
export const PROGRESS_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** 进度饼图填充色 / 底色 */
export const PROGRESS_COLOR = "#8bc34a";
export const PROGRESS_TRACK = "#f0efd8";

/* ------------------------------ 节点图标 ------------------------------ */

export interface NodeIconDef {
  id: string;
  label: string;
  char: string;
}

/** 节点图标（作为文字前缀渲染） */
export const NODE_ICONS: NodeIconDef[] = [
  { id: "star", label: "星标", char: "⭐" },
  { id: "flag", label: "旗帜", char: "🚩" },
  { id: "fire", label: "火热", char: "🔥" },
  { id: "bulb", label: "灵感", char: "💡" },
  { id: "pin", label: "图钉", char: "📌" },
  { id: "target", label: "目标", char: "🎯" },
  { id: "rocket", label: "火箭", char: "🚀" },
  { id: "check", label: "完成", char: "✅" },
  { id: "cross", label: "否决", char: "❌" },
  { id: "warn", label: "警告", char: "⚠️" },
  { id: "question", label: "疑问", char: "❓" },
  { id: "bang", label: "重点", char: "❗" },
  { id: "thumbup", label: "赞同", char: "👍" },
  { id: "clap", label: "鼓掌", char: "👏" },
  { id: "clock", label: "时间", char: "⏰" },
  { id: "bubble", label: "讨论", char: "💬" },
  { id: "pen", label: "备注", char: "📝" },
  { id: "link", label: "链接", char: "🔗" },
  { id: "lock", label: "锁定", char: "🔒" },
  { id: "gift", label: "奖励", char: "🎁" },
  { id: "money", label: "资金", char: "💰" },
  { id: "book", label: "资料", char: "📚" },
  { id: "user", label: "人员", char: "👤" },
  { id: "heart", label: "心动", char: "❤️" },
];

export const NODE_ICON_MAP = new Map(NODE_ICONS.map((i) => [i.id, i]));

/* ------------------------------ 颜色盘 ------------------------------ */

/** 自带的文字色盘 */
export const TEXT_COLORS = [
  "#1f2329",
  "#6b7280",
  "#e34d59",
  "#f0a020",
  "#00a870",
  "#2f6fed",
  "#8b5cf6",
  "#ec4899",
  "#0ea5e9",
  "#ffffff",
];

/** 自带的高亮色盘 */
export const HIGHLIGHT_COLORS = [
  "transparent",
  "#ffe58f",
  "#ffccc7",
  "#d9f7be",
  "#bae7ff",
  "#efdbff",
  "#f5f5f5",
  "#ffd6e7",
  "#d6f5f2",
  "#fff1b8",
];

/** 边框 / 分支色盘 */
export const BORDER_COLORS = [
  "#2f6fed",
  "#00a870",
  "#f0a020",
  "#e34d59",
  "#8b5cf6",
  "#0ea5e9",
  "#ec4899",
  "#14b8a6",
  "#8b95a5",
  "#1f2329",
];

/**
 * 为根节点的每个子分支分配强调色，并向下继承。
 * 返回 id -> color 的映射（除非节点自身设置过 color / style.borderColor）。
 */
export function buildBranchColors(root: MindNode): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: MindNode, inherited?: string) => {
    const own = node.color ?? node.style?.borderColor;
    const color = own ?? inherited;
    if (color) map.set(node.id, color);
    node.children.forEach((c, i) => {
      // 根节点的一级分支按色盘取色；更深层继承所属分支色
      const next =
        node === root ? BRANCH_COLORS[i % BRANCH_COLORS.length] : color;
      walk(c, next);
    });
  };
  walk(root, undefined);
  return map;
}
