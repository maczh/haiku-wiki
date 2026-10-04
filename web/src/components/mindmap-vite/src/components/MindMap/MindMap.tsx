import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  MindMapApi,
  MindMapConfig,
  MindMapProps,
  MindNode,
  MindNodeStyle,
  TextDefaults,
} from "./types";
import { BORDER_DASH, DEFAULT_CONFIG, DEFAULT_TEXT } from "./types";
import type {
  BranchGeom,
} from "./branchstyle";
import { branchPath } from "./branchstyle";
import {
  sketchArrowHead,
  sketchCurve,
  sketchEllipse,
  sketchLine,
  sketchRect,
} from "./handdrawn";
import {
  layoutTree,
  nodeSize,
  textCenterX,
  prefixWidth,
  defaultFontSizeForDepth,
  TEXT_LEFT_INSET,
  type LayoutResult,
  type MindLink,
  type PositionedNode,
} from "./layout";
import { measureText } from "./text";
import {
  ExtrasLayer,
  FormulaText,
  NodeImage,
  NodeTags,
  extrasEditTarget,
  extrasHitTest,
  type ExtrasTarget,
} from "./extras";
import {
  MARKER_MAP,
  NODE_ICON_MAP,
  PRIORITY_COLORS,
  PROGRESS_COLOR,
  PROGRESS_TRACK,
  THEME_LIST,
  THEME_MAP,
  buildBranchColors,
  FISHBONE_ACCENT,
} from "./theme";
import {
  countNodes,
  createNode,
  depthOf,
  findNode,
  findParent,
  opAddChild,
  opAddParent,
  opAddSibling,
  opDelete,
  opMove,
  opOutdent,
  opToggleCollapse,
  opUpdate,
  type TreeOpResult,
} from "./tree";
import { Toolbar } from "./Toolbar";
import { MultiSelectBar } from "./MultiSelectBar";
import { MainMenu, buildMainMenu } from "./Menu";
import { Dialog } from "./Dialog";
import { Icon } from "./Icons";
import { Minimap } from "./Minimap";
import {
  downloadBlob,
  exportTree,
  IMPORT_ACCEPT,
  parseMindmapFile,
  type ExportFormat,
  type SvgPayload,
} from "./io";
import "./MindMap.css";

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const HISTORY_LIMIT = 80;
/** 新概要 / 新分组框的默认文案：点一下浮动条就先落这个字，随后可双击改写 */
const SUMMARY_DEFAULT = "概要";
const FRAME_DEFAULT = "分组";
/**
 * 概要 / 分组框的内联编辑态。刻意只存「身份 + 草稿文案」：
 * 编辑框的 x/y/w/h 由 `extrasEditTarget` 从当前布局实时算（拖拽、缩放后都贴得住），
 * 不必在 state 里缓存一份随时会过期的几何。
 */
type ExtrasEditState = { kind: "summary" | "frame"; id: string; value: string };

/** 拖放落点方式：同级前插 / 同级后插 / 挂接为子节点 */
type DropMode = "before" | "after" | "child";

/** 节点拖拽中的状态（wx / wy 为画布世界坐标） */
interface NodeDragState {
  id: string;
  wx: number;
  wy: number;
  overId: string | null;
  mode: DropMode;
}

/** 右键环形菜单项：角度以屏幕坐标为准（0° 指向右，顺时针为正） */
const RADIAL_ITEMS: { key: string; label: string; hint: string; angle: number }[] = [
  { key: "prev", label: "前移", hint: "Alt+Up", angle: -90 },
  { key: "child", label: "下级", hint: "Tab", angle: -30 },
  { key: "sibling", label: "同级", hint: "Enter", angle: 30 },
  { key: "next", label: "后移", hint: "Alt+Down", angle: 90 },
  { key: "delete", label: "删除", hint: "Delete", angle: 150 },
  { key: "outdent", label: "上级", hint: "Shift+Tab", angle: -150 },
];
/** 环形菜单按钮距圆心距离（px） */
const RADIAL_RADIUS = 90;

interface DocState {
  tree: MindNode;
  past: MindNode[];
  future: MindNode[];
  selectedId: string | null;
  /**
   * 多选集合（Ctrl/Cmd + 左键点选）。
   * 约定：`selectedId` 始终是集合里的「主选中项」（最后点中的那个），
   * 节点级工具栏功能作用于它；`selectedIds` 为多选聚合功能（关联线 / 概要 / 分组框）提供输入。
   */
  selectedIds: string[];
}

type DocAction =
  | { type: "commit"; tree: MindNode; focusId?: string | null }
  | { type: "select"; id: string | null }
  /** Ctrl/Cmd + 左键：切换某个节点的选中态 */
  | { type: "toggleSelect"; id: string }
  /** 清空全部选中（Esc / 点击空白） */
  | { type: "clearSelect" }
  | { type: "reset"; tree: MindNode }
  | { type: "undo" }
  | { type: "redo" };

/** 由主选中项派生多选集合（普通选中时集合只有它自己） */
function selectOnly(id: string | null): string[] {
  return id ? [id] : [];
}

function docReducer(state: DocState, action: DocAction): DocState {
  switch (action.type) {
    case "commit": {
      if (action.tree === state.tree) return state;
      const past = [...state.past, state.tree];
      if (past.length > HISTORY_LIMIT) past.shift();
      return {
        tree: action.tree,
        past,
        future: [],
        selectedId:
          action.focusId === undefined ? state.selectedId : action.focusId,
        // 树变化后剔除已不存在的 id，保持多选集合与实际节点一致
        selectedIds:
          action.focusId === undefined
            ? state.selectedIds
            : selectOnly(action.focusId),
      };
    }
    case "select":
      return state.selectedId === action.id && state.selectedIds.length <= 1
        ? state
        : { ...state, selectedId: action.id, selectedIds: selectOnly(action.id) };
    case "toggleSelect": {
      const has = state.selectedIds.includes(action.id);
      // 取消选中：主选中项顺延到集合里剩下的第一个；集合空则清空
      if (has) {
        const next = state.selectedIds.filter((x) => x !== action.id);
        return {
          ...state,
          selectedIds: next,
          selectedId: next.length ? next[next.length - 1] : null,
        };
      }
      return {
        ...state,
        selectedIds: [...state.selectedIds, action.id],
        selectedId: action.id,
      };
    }
    case "clearSelect":
      return state.selectedId === null && state.selectedIds.length === 0
        ? state
        : { ...state, selectedId: null, selectedIds: [] };
    case "reset":
      return {
        tree: action.tree,
        past: [],
        future: [],
        selectedId: action.tree.id,
        selectedIds: selectOnly(action.tree.id),
      };
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        tree: prev,
        past: state.past.slice(0, -1),
        future: [state.tree, ...state.future].slice(0, HISTORY_LIMIT),
        selectedId: state.selectedId,
        selectedIds: state.selectedIds,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const past = [...state.past, state.tree].slice(-HISTORY_LIMIT);
      return {
        tree: next,
        past,
        future: state.future.slice(1),
        selectedId: state.selectedId,
        selectedIds: state.selectedIds,
      };
    }
    default:
      return state;
  }
}

/**
 * 下划线「轨道」样式常量（仅二级及以下 / 叶子节点）：
 * 文字左对齐，下划线贴合文字块宽度并从文字左端起画，形成「文字 + 下划线」，
 * 连线再自轨道两端接入，整体连贯 —— 仿参考截图。
 * 时间轴结构不使用轨道（改由肘形折线的「短横头」承担引导），见 isTimeline。
 */
const UNDER_LEFT = TEXT_LEFT_INSET; // 文字 / 轨道左内边距（与布局层同一来源）
const UNDER_PAD_R = 6; // 轨道右端超出文字的留白
const UNDER_DY = 7; // 轨道相对节点底边的上移量

/** 文本块宽度（取最宽一行），用于让下划线贴合文字。 */
function underlineTextWidth(n: PositionedNode): number {
  const sz = nodeSize(n.node, n.depth);
  const bold = !!n.node.style?.bold;
  let w = 0;
  for (const l of sz.lines) w = Math.max(w, measureText(l || " ", sz.fontSize, bold));
  return w;
}

/** 节点是否为下划线样式（考虑逐节点显式覆盖）。 */
function isUnderlineNode(n: PositionedNode): boolean {
  const shape = n.node.style?.shape ?? (n.depth <= 1 ? "capsule" : "underline");
  return shape === "underline";
}

/** 下划线节点的轨道几何（绝对坐标）：左端 / 右端 / y。 */
function underlineRail(n: PositionedNode): { left: number; right: number; y: number } {
  // 右端 = 左内边距 + 前缀（标记 / 优先级 / 图标）占位 + 文本块宽度 + 留白
  const rightLocal = UNDER_LEFT + prefixWidth(n.node) + underlineTextWidth(n) + UNDER_PAD_R;
  return {
    left: n.x + UNDER_LEFT,
    right: n.x + rightLocal,
    y: n.y + n.h - UNDER_DY,
  };
}

/** 生成连线路径（曲线 / 折线，兼容 h / v / diag 三种主轴） */
function linkPath(l: MindLink): string {
  if (l.path) return l.path;
  const { from, to, axis, sgn, curve, straight } = l;
  if (axis === "diag") {
    // 鱼骨图：子节点连线沿骨头方向（父→子中心）画直线，否则会落到水平主轴公式被画歪
    return `M ${from.centerX} ${from.centerY} L ${to.centerX} ${to.centerY}`;
  }
  if (axis === "v") {
    const x1 = from.centerX;
    const y1 = sgn === 1 ? from.y + from.h : from.y;
    const x2 = to.centerX;
    const y2 = sgn === 1 ? to.y : to.y + to.h;
    if (curve) {
      const my = (y1 + y2) / 2;
      return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    }
    if (straight) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const my = y1 + sgn * Math.max(14, Math.abs(y2 - y1) * 0.45);
    return `M ${x1} ${y1} L ${x1} ${my} L ${x2} ${my} L ${x2} ${y2}`;
  }
  // 水平主轴。下划线（二级及以下 / 叶子）节点的连入 / 连出点落在「下划线轨道」
  // 的两端，使线条与文字下划线连贯（仿参考截图）；带框节点仍用边缘中点。
  const fromU = isUnderlineNode(from);
  const toU = isUnderlineNode(to);
  const rf = fromU ? underlineRail(from) : null;
  const rt = toU ? underlineRail(to) : null;
  const x1 = rf ? (sgn === 1 ? rf.right : rf.left) : sgn === 1 ? from.x + from.w : from.x;
  const y1 = rf ? rf.y : from.y + from.h / 2;
  const x2 = rt ? (sgn === 1 ? rt.left : rt.right) : sgn === 1 ? to.x : to.x + to.w;
  const y2 = rt ? rt.y : to.y + to.h / 2;
  // 直线：既不曲线化，也不拐肘，两端直接相连
  if (straight) return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (curve) {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const mx = x1 + sgn * Math.max(14, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
}

/* ------------------------------------------------------------------ */
/* 分支样式（截图 1）与手绘（截图 5）路径加工                          */
/* ------------------------------------------------------------------ */

/**
 * 解析 linkPath 产出的 d，抽出分支样式 / 手绘曲线需要的端点与切向。
 * 与 parseLinkPath 同源，但额外保留控制点，供 branchPath 的 cubic 分支使用。
 */
function toBranchGeom(g: LinkGeom): BranchGeom {
  const cubic = g.v0.x !== g.v1.x || g.v0.y !== g.v1.y;
  // 曲线的中点控制点按标准三次贝塞尔公式反推（用于 brace 等形态还原曲率）
  const mx = (g.p0.x + 3 * (g.p0.x + g.v0.x) + 3 * (g.p1.x - g.v1.x) + g.p1.x) / 8;
  const my = (g.p0.y + 3 * (g.p0.y + g.v0.y) + 3 * (g.p1.y - g.v1.y) + g.p1.y) / 8;
  return {
    p0: g.p0,
    p1: g.p1,
    v0: g.v0,
    v1: g.v1,
    cubic,
    c1: { x: g.p0.x + g.v0.x * 24, y: g.p0.y + g.v0.y * 24 },
    c2: { x: mx, y: my },
  };
}

/**
 * 手绘主题下把连线的 d 换成「双笔触」路径（返回 2 条 path）。
 * 曲线（三次贝塞尔）走 sketchCurve 保留柔和走向，折线 / 直线走 sketchLine。
 *
 * 判曲线不能靠「数字个数 ≥ 8」——肘形折线 `M..L..L..L..` 也是 8 个数字，
 * 会被误判成三次贝塞尔而画歪；这里直接看路径里有没有 `C` 指令。
 */
function handdrawLink(
  d: string,
  seed: string,
  jitter: number
): string[] {
  const g = parseLinkPath(d);
  if (!g) return [d];
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (nums && /\bC\b/.test(d) && nums.length >= 8) {
    return sketchCurve(
      g.p0,
      { x: Number(nums[2]), y: Number(nums[3]) },
      { x: Number(nums[4]), y: Number(nums[5]) },
      g.p1,
      seed,
      { amp: jitter, gap: 1.5, segments: 14 }
    );
  }
  return sketchLine(g.p0.x, g.p0.y, g.p1.x, g.p1.y, seed, {
    amp: jitter,
    gap: 1.5,
    segments: 12,
  });
}

/* ------------------------------------------------------------------ */
/* 连线形态：直线 / 箭头 / 从粗到细（taper）                            */
/*                                                                     */
/* 连线路径只由 linkPath 产出，形如：                                   */
/*   M p0 [ L p1        （4 个数，直线 / 折线首末段）                   */
/*   M p0 C c1 c2 p1    （8 个数，曲线或折线的三段折点）                */
/* 下面按这个固定格式解析出端点与切向，供箭头朝向与变宽填充带使用。     */
/* ------------------------------------------------------------------ */

interface LinkGeom {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  /** 起点单位切向（由 p0 指向终点方向） */
  v0: { x: number; y: number };
  /** 终点单位切向 */
  v1: { x: number; y: number };
}

function parseLinkPath(d: string): LinkGeom | null {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 4) return null;
  // 统一「先摊平成点列」再取端点。
  // 早期版本按「数字个数 ≥ 8 即三次贝塞尔」分支取端点，对折线是错的：
  // `M..L..L..L..` 恰好 8 个数字会走 cubic 分支，p1 取到第 4 个点而不是终点，
  // 箭头就掉在半路上。摊平后两端点恒为首 / 尾，切向取第一 / 最后一段的方向，
  // 三次贝塞尔（p0 c1 c2 p1）与折线 / 手绘抖动折线都能正确解析。
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];
  const unit = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay) || 1;
    return { x: (bx - ax) / L, y: (by - ay) / L };
  };
  const v0 =
    pts.length >= 2
      ? unit(p0.x, p0.y, pts[1].x, pts[1].y)
      : unit(p0.x, p0.y, p1.x, p1.y);
  const v1 =
    pts.length >= 2
      ? unit(pts[pts.length - 2].x, pts[pts.length - 2].y, p1.x, p1.y)
      : unit(p0.x, p0.y, p1.x, p1.y);
  return { p0, p1, v0, v1 };
}

/**
 * 「从粗到细」两端宽度（产品口径，固定值不随 linkWidth 浮动）：
 * 粗端 8（父端），细端 2（子端）。改这两个即可整体调节 taper 的落差。
 */
const TAPER_THICK_W = 8
const TAPER_THIN_W = 2

/**
 * 在「已采样好的中心线」上生成两端渐变的填充带。
 * taperFillPath 与手绘版共用这一段几何逻辑：区别只在于中心线点从哪来 ——
 * 普通路径由贝塞尔公式采样，手绘路径由抖动后的折线提供。
 */
function taperBandFromPoints(
  pts: { x: number; y: number }[],
  w0: number,
  w1: number
): string {
  const N = pts.length - 1;
  if (N < 1) return "";
  const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const L = Math.hypot(tx, ty) || 1;
    tx /= L;
    ty /= L;
    const w = w0 + (w1 - w0) * (i / N);
    left.push(fmt({ x: pts[i].x - ty * w * 0.5, y: pts[i].y + tx * w * 0.5 }));
    right.push(fmt({ x: pts[i].x + ty * w * 0.5, y: pts[i].y - tx * w * 0.5 }));
  }
  return `M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z`;
}

/** 手绘路径的中心线采样：把抖动折线还原成点序列（供 taper 填充带使用） */
function handTaperFill(d: string, w0: number, w1: number): string {
  // handCurve / handLine 产出的都是 "M x y L x y L ..." 折线，直接解析坐标对
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 4) return "";
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return taperBandFromPoints(pts, w0, w1);
}

/**
 * 把连线路径变成「从粗到细」的填充带（两端宽度线性插值）。
 * 变宽只能靠填充多边形表达 —— 描边加 dash 会退化成虚线，所以 taper 与虚线互斥。
 */
function taperFillPath(d: string, w0: number, w1: number): string | null {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length < 4) return null;
  const cubic = nums.length >= 8;
  const p0 = { x: nums[0], y: nums[1] };
  const p1 = cubic ? { x: nums[6], y: nums[7] } : { x: nums[2], y: nums[3] };
  const c1 = cubic ? { x: nums[2], y: nums[3] } : p0;
  const c2 = cubic ? { x: nums[4], y: nums[5] } : p1;
  const N = 22;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    let x: number, y: number;
    if (cubic) {
      x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x;
      y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y;
    } else {
      x = p0.x + (p1.x - p0.x) * t;
      y = p0.y + (p1.y - p0.y) * t;
    }
    pts.push({ x, y });
  }
  return taperBandFromPoints(pts, w0, w1);
}

/**
 * 箭头三角形：`tip` 为尖端位置，`dir` 为尖端所指方向（单位向量）。
 * inward 的尖端在父端且朝父（dir = -v0），outward 的尖端在子端且朝子（dir = +v1）。
 */
function arrowTri(tip: { x: number; y: number }, dir: { x: number; y: number }, size: number, halfW: number) {
  const baseX = tip.x - dir.x * size;
  const baseY = tip.y - dir.y * size;
  const px = -dir.y * halfW;
  const py = dir.x * halfW;
  return `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${(baseX + px).toFixed(2)},${(baseY + py).toFixed(2)} ${(baseX - px).toFixed(2)},${(baseY - py).toFixed(2)}`;
}

/** 进度饼图扇区路径（fraction 0~1，从 12 点方向顺时针） */
function piePath(fraction: number): string {
  const r = 8;
  if (fraction >= 1) {
    return `M ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 Z`;
  }
  const a = fraction * Math.PI * 2 - Math.PI / 2;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  const large = fraction > 0.5 ? 1 : 0;
  return `M 0 0 L 0 ${-r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

export const MindMap = forwardRef<MindMapApi, MindMapProps>(function MindMap(
  {
    data,
    width = "100%",
    height = "100%",
    className,
    fitOnMount = true,
    editable = true,
    showToolbar = true,
    onChange,
    defaultConfig,
    onScaleChange,
    onSelectChange,
  },
  ref
) {
  const [doc, dispatch] = useReducer(docReducer, undefined, () => ({
    tree: data,
    past: [] as MindNode[],
    future: [] as MindNode[],
    // 默认选中根节点：这样工具栏里的节点级功能（样式 / 优先级 / 进度 / 图标等）
    // 一打开就能直接使用，而不是静默无反应
    selectedId: data.id as string | null,
    selectedIds: [data.id as string],
  }));

  const treeRef = useRef(doc.tree);
  treeRef.current = doc.tree;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const firstChange = useRef(true);
  useEffect(() => {
    if (firstChange.current) {
      firstChange.current = false;
      return;
    }
    onChangeRef.current?.(doc.tree);
  }, [doc.tree]);

  // 外部传入新数据时重置（若正是内部刚提交的那棵树则跳过，保留撤销历史）
  const lastExternal = useRef(data);
  useEffect(() => {
    if (data === lastExternal.current) return;
    lastExternal.current = data;
    if (data !== treeRef.current) dispatch({ type: "reset", tree: data });
  }, [data]);

  const [config, setConfig] = useState<MindMapConfig>({
    ...DEFAULT_CONFIG,
    ...defaultConfig,
  });
  const configRef = useRef(config);
  configRef.current = config;
  const [textDefaults, setTextDefaults] = useState<TextDefaults>({
    ...DEFAULT_TEXT,
  });
  const defaultsRef = useRef(textDefaults);
  defaultsRef.current = textDefaults;

  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null
  );
  const editingRef = useRef(editing);
  editingRef.current = editing;

  /**
   * 概要 / 分组框文案的内联编辑态（双击画布上的文案进入）。
   * 与 `editing`（节点标题）分开：两者的落库位置不同
   * （`node.title` vs `summaryGroups[].text` / `frameGroups[].label`）。
   */
  const [extraEdit, setExtraEdit] = useState<ExtrasEditState | null>(null);
  const extraEditRef = useRef(extraEdit);
  extraEditRef.current = extraEdit;
  const extraInputRef = useRef<HTMLInputElement>(null);

  const [dialog, setDialog] = useState<{
    kind: "note" | "link";
    value: string;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(
    null
  );
  const [pendingFit, setPendingFit] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  /** 主菜单的「文件 → 打开」需要一个隐藏 input 触发；放在这里与工具条共用 */
  const menuFileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  /** 转发给键盘快捷键使用的导出函数（避免闭包捕获旧的布局尺寸） */
  const exportRef = useRef<(format: ExportFormat) => void>(() => {});

  /* 节点拖拽（同级排序 / 挂接为子节点） */
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const nodeDragRef = useRef<NodeDragState | null>(null);
  nodeDragRef.current = nodeDrag;
  /** 按下后还没超过阈值时先不进入拖拽，避免影响单击选中 */
  const pendingDragRef = useRef<{
    id: string;
    sx: number;
    sy: number;
    active: boolean;
  } | null>(null);

  /* 右键环形菜单锚定的节点 */
  const [menuId, setMenuId] = useState<string | null>(null);

  /* -------------------- 运行期模式（可由宿主通过 ref 切换） -------------------- */
  /** 只读 / 编辑：props.editable 只作为初值，运行期切换走这里 */
  const [mode, setModeState] = useState<"edit" | "readonly">(editable ? "edit" : "readonly");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** 运行期「可编辑」判定：props.editable 只定初值，运行期切换走 mode */
  const editableNow = mode === "edit";
  /** 滚轮行为：zoom 缩放 / move 平移 */
  const [wheelAction, setWheelAction] = useState<"zoom" | "move">("zoom");
  const wheelActionRef = useRef(wheelAction);
  wheelActionRef.current = wheelAction;
  /** 自由拖拽开关：关闭后禁止拖动节点改层级（仅保留选中 / 编辑） */
  const [freeDrag, setFreeDrag] = useState(false);
  const freeDragRef = useRef(freeDrag);
  freeDragRef.current = freeDrag;

  /** 供 window 级监听读取当前视图变换（避免闭包捕获旧值） */
  const transformRef = useRef(transform);
  transformRef.current = transform;
  /** 缩放比例变化回调（宿主缩放条用） */
  const scaleChangeRef = useRef(onScaleChange);
  scaleChangeRef.current = onScaleChange;
  useEffect(() => {
    scaleChangeRef.current?.(transform.scale);
  }, [transform.scale]);
  /** 选中变化上报宿主（工具条禁用态 / 节点样式面板回显） */
  const selectChangeRef = useRef(onSelectChange);
  selectChangeRef.current = onSelectChange;
  useEffect(() => {
    selectChangeRef.current?.(doc.selectedId);
  }, [doc.selectedId]);

  const theme = THEME_MAP.get(config.themeId) ?? THEME_LIST[0];
  const base = config.base ?? {};

  const branchColors = useMemo(() => buildBranchColors(doc.tree), [doc.tree]);
  const linkColor = base.linkColor ?? theme.linkColor;
  const layout: LayoutResult = useMemo(
    () =>
      layoutTree(doc.tree, {
        structure: config.structure,
        branchColors,
        linkColor,
        lineStyle: config.lineStyle,
      }),
    [doc.tree, config.structure, config.lineStyle, branchColors, linkColor]
  );

  const linkWidth = base.linkWidth ?? theme.linkWidth;
  /** 连线配色：auto 彩色（各分支主题色）/ single 单色（linkColor 统一） */
  const linkColorMode = base.linkColorMode ?? "auto";
  const radius = base.radius ?? theme.radius;
  const strokeWidth = base.strokeWidth ?? theme.strokeWidth;
  const canvasBg = base.background ?? theme.background;
  /** 分支样式（截图 1）：括号 / 圆弧等，默认沿用 lineStyle 骨架 */
  const branchStyle = base.branchStyle ?? "default";
  /** 手绘主题（截图 5）：外框与连线都改为抖动路径 */
  const handOn = Boolean(theme.handDrawn);
  const handJitter = theme.handJitter ?? 1.5;

  const selectedNode = doc.selectedId ? findNode(doc.tree, doc.selectedId) : null;
  const selStyle: MindNodeStyle = selectedNode?.style ?? {};
  const effectiveDefaultFont = selStyle.fontFamily ?? textDefaults.fontFamily;
  const effectiveDefaultSize = selStyle.fontSize ?? textDefaults.fontSize;

  const showToast = useCallback(
    (text: string, kind: "ok" | "err" = "ok") => {
      setToast({ text, kind });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 2800);
    },
    []
  );
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  /* ------------------------------ 视图操作 ------------------------------ */

  const fit = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return;
    const pad = 64;
    const raw = Math.min(
      (cw - pad) / Math.max(layout.width, 1),
      (ch - pad) / Math.max(layout.height, 1),
      1.3
    );
    const s = raw > 0 ? raw : 1;
    setTransform({
      scale: s,
      tx: (cw - layout.width * s) / 2,
      ty: (ch - layout.height * s) / 2,
    });
  }, [layout.width, layout.height]);

  useEffect(() => {
    if (fitOnMount) fit();
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingFit) return;
    setPendingFit(false);
    fit();
  }, [pendingFit, fit]);

  // 切换结构后自动适配视图，避免不同结构尺寸差异导致的「图形错位 / 缩放异常」
  const prevStructureRef = useRef(config.structure);
  useEffect(() => {
    if (prevStructureRef.current !== config.structure) {
      prevStructureRef.current = config.structure;
      fit();
    }
  }, [config.structure, fit]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setMenuId(null);
      // 滚轮行为可切到「平移画布」（宿主设置面板）
      if (wheelActionRef.current === "move") {
        setTransform((t) => ({ ...t, tx: t.tx - e.deltaY, ty: t.ty - e.deltaX }));
        return;
      }
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = Math.min(Math.max(t.scale * factor, MIN_SCALE), MAX_SCALE);
        const k = next / t.scale;
        return { scale: next, tx: px - (px - t.tx) * k, ty: py - (py - t.ty) * k };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = stageRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setTransform((t) => {
      const next = Math.min(Math.max(t.scale * factor, MIN_SCALE), MAX_SCALE);
      const k = next / t.scale;
      return { scale: next, tx: cx - (cx - t.tx) * k, ty: cy - (cy - t.ty) * k };
    });
  }, []);

  const navigateTo = useCallback((tx: number, ty: number) => {
    setTransform((t) => ({ ...t, tx, ty }));
  }, []);

  const focusStage = useCallback(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  /* ------------------------------ 编辑操作 ------------------------------ */

  /** 新建节点按「深度」套用默认字号（根 24 / 一级 18 / 二级及以下 11），
   *  优先尊重用户显式设置的基础字号，其次回退到 defaultFontSizeForDepth。 */
  const withDefaults = useCallback((tree: MindNode, id: string): MindNode => {
    const b = configRef.current.base ?? {};
    const node = findNode(tree, id);
    if (!node || node.style?.fontSize) return tree;
    const d = {
      fontSize: b.fontSize ?? defaultFontSizeForDepth(depthOf(tree, id)),
      fontFamily: b.fontFamily ?? defaultsRef.current.fontFamily,
    };
    return opUpdate(tree, id, {}, { fontSize: d.fontSize, fontFamily: d.fontFamily });
  }, []);

  const applyOp = useCallback(
    (res: TreeOpResult) => {
      if (!res.changed) return;
      dispatch({
        type: "commit",
        tree: withDefaults(res.tree, res.focusId),
        focusId: res.focusId,
      });
    },
    [withDefaults]
  );

  /** 提交一次结构变更，并立即让新节点进入编辑态 */
  const commitAndEdit = useCallback(
    (res: TreeOpResult, initialTitle: string) => {
      if (!res.changed) return;
      dispatch({
        type: "commit",
        tree: withDefaults(res.tree, res.focusId),
        focusId: res.focusId,
      });
      dispatch({ type: "select", id: res.focusId });
      setEditing({ id: res.focusId, value: initialTitle });
    },
    [withDefaults]
  );

  const addChild = useCallback(() => {
    if (!editableNow) return;
    const res = opAddChild(treeRef.current, doc.selectedId ?? doc.tree.id);
    commitAndEdit(res, "分支主题");
  }, [editableNow, doc.selectedId, doc.tree.id, commitAndEdit]);

  const addSibling = useCallback(
    (before: boolean) => {
      if (!editableNow || !doc.selectedId) return;
      const res = opAddSibling(treeRef.current, doc.selectedId, before);
      commitAndEdit(res, "分支主题");
    },
    [editableNow, doc.selectedId, commitAndEdit]
  );

  const addParent = useCallback(() => {
    if (!editableNow || !doc.selectedId) return;
    const res = opAddParent(treeRef.current, doc.selectedId);
    commitAndEdit(res, "分支主题");
  }, [editableNow, doc.selectedId, commitAndEdit]);

  const outdent = useCallback(() => {
    if (!editableNow || !doc.selectedId) return;
    applyOp(opOutdent(treeRef.current, doc.selectedId));
  }, [applyOp, doc.selectedId, editableNow]);

  /** 同级内前移 / 后移（Alt+↑ / Alt+↓，同时供右键菜单使用） */
  const moveSibling = useCallback(
    (dir: -1 | 1) => {
      if (!editableNow || !doc.selectedId) return;
      const id = doc.selectedId;
      if (id === doc.tree.id) return;
      const hit = findParent(treeRef.current, id);
      if (!hit) return;
      const siblings = hit.parent.children;
      const at = hit.index + dir;
      if (at < 0 || at >= siblings.length) return;
      applyOp(
        opMove(treeRef.current, id, siblings[at].id, dir === -1 ? "before" : "after")
      );
    },
    [applyOp, doc.selectedId, doc.tree.id, editableNow]
  );

  const removeNode = useCallback(() => {
    if (!editableNow || !doc.selectedId) return;
    if (doc.selectedId === doc.tree.id) {
      showToast("根节点不可删除", "err");
      return;
    }
    applyOp(opDelete(treeRef.current, doc.selectedId));
  }, [applyOp, doc.selectedId, doc.tree.id, editableNow, showToast]);

  const toggleCollapse = useCallback(
    (id?: string) => {
      const target = id ?? doc.selectedId;
      if (!target) return;
      const node = findNode(treeRef.current, target);
      if (!node || node.children.length === 0) return;
      dispatch({ type: "commit", tree: opToggleCollapse(treeRef.current, target) });
    },
    [doc.selectedId]
  );

  const applyStyle = useCallback(
    (patch: Partial<MindNodeStyle>) => {
      if (patch.fontSize !== undefined || patch.fontFamily !== undefined) {
        setTextDefaults((d) => ({
          fontSize: patch.fontSize ?? d.fontSize,
          fontFamily: patch.fontFamily ?? d.fontFamily,
        }));
      }
      if (!editableNow) return;
      const id = doc.selectedId;
      if (!id || !findNode(treeRef.current, id)) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      dispatch({
        type: "commit",
        tree: opUpdate(treeRef.current, id, {}, patch),
      });
    },
    [doc.selectedId, editableNow, showToast]
  );

  const toggleMarker = useCallback(
    (markerId: string) => {
      if (!editableNow) return;
      if (!selectedNode) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      const cur = selectedNode.markers ?? [];
      const next = cur.includes(markerId)
        ? cur.filter((m) => m !== markerId)
        : [...cur, markerId];
      dispatch({
        type: "commit",
        tree: opUpdate(treeRef.current, selectedNode.id, {
          markers: next.length ? next : undefined,
        }),
      });
    },
    [editableNow, selectedNode, showToast]
  );

  /** 设置选中节点的优先级（1-9） */
  const setPriority = useCallback(
    (value: number | undefined) => {
      if (!editableNow) return;
      if (!selectedNode) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      dispatch({
        type: "commit",
        tree: opUpdate(treeRef.current, selectedNode.id, {
          priority: value,
        }),
      });
    },
    [editableNow, selectedNode, showToast]
  );

  /** 设置选中节点的进度（0-10，每级 10%） */
  const setProgress = useCallback(
    (value: number | undefined) => {
      if (!editableNow) return;
      if (!selectedNode) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      dispatch({
        type: "commit",
        tree: opUpdate(treeRef.current, selectedNode.id, {
          progress: value,
        }),
      });
    },
    [editableNow, selectedNode, showToast]
  );

  /** 切换选中节点的图标前缀 */
  const toggleIcon = useCallback(
    (iconId: string) => {
      if (!editableNow) return;
      if (!selectedNode) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      const cur = selectedNode.icons ?? [];
      const next = cur.includes(iconId)
        ? cur.filter((m) => m !== iconId)
        : [...cur, iconId];
      dispatch({
        type: "commit",
        tree: opUpdate(treeRef.current, selectedNode.id, {
          icons: next.length ? next : undefined,
        }),
      });
    },
    [editableNow, selectedNode, showToast]
  );

  const startEdit = useCallback(
    (node: MindNode) => {
      if (!editableNow) return;
      dispatch({ type: "select", id: node.id });
      setEditing({ id: node.id, value: node.title });
    },
    [editableNow]
  );

  const endEdit = useCallback((next: "child" | "sibling" | null) => {
    const cur = editingRef.current;
    setEditing(null);
    if (!cur) return;
    const trimmed = cur.value.replace(/\s+$/, "");
    const old = findNode(treeRef.current, cur.id)?.title ?? "";
    if (next === null && trimmed === old) {
      dispatch({ type: "select", id: cur.id });
      return;
    }
    let tree = opUpdate(treeRef.current, cur.id, { title: trimmed });
    let focusId: string = cur.id;
    let createdId: string | null = null;
    // 新建子/同级节点：按深度套用默认字号（二级及以下 → 11px），并立即进入编辑态
    const styleFor = (id: string, t: MindNode) => {
      const b = configRef.current.base ?? {};
      return {
        fontSize: b.fontSize ?? defaultFontSizeForDepth(depthOf(t, id)),
        fontFamily: b.fontFamily ?? defaultsRef.current.fontFamily,
      };
    };
    if (next === "child") {
      const r = opAddChild(tree, cur.id);
      if (r.changed) {
        tree = opUpdate(r.tree, r.focusId, {}, styleFor(r.focusId, r.tree));
        focusId = r.focusId;
        createdId = r.focusId;
      }
    } else if (next === "sibling") {
      const r = opAddSibling(tree, cur.id, false);
      if (r.changed) {
        tree = opUpdate(r.tree, r.focusId, {}, styleFor(r.focusId, r.tree));
        focusId = r.focusId;
        createdId = r.focusId;
      }
    }
    dispatch({ type: "commit", tree, focusId });
    if (createdId) setEditing({ id: createdId, value: "分支主题" });
  }, []);

  /* 编辑框高度随内容自适应 */
  const editPos: PositionedNode | undefined = editing
    ? layout.byId.get(editing.id)
    : undefined;
  useEffect(() => {
    const ta = editRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const min = editPos ? editPos.h : 34;
    ta.style.height = `${Math.max(ta.scrollHeight, min)}px`;
  }, [editing?.value, editPos]);

  useEffect(() => {
    if (editing) {
      const t = window.setTimeout(() => {
        editRef.current?.focus();
        editRef.current?.select();
      }, 20);
      return () => window.clearTimeout(t);
    }
  }, [editing?.id]);

  /** 概要 / 分组框文案：进入编辑态就自动聚焦并全选，刚生成也能直接打字 */
  useEffect(() => {
    if (!extraEdit) return;
    const t = window.setTimeout(() => {
      const el = extraInputRef.current;
      if (!el) return;
      el.focus();
      // 与节点标题编辑保持一致：全选原文案，生成的「概要 / 分组」直接打字即覆盖
      el.select();
    }, 20);
    return () => window.clearTimeout(t);
  }, [extraEdit?.id, extraEdit?.kind]);

  /* ------------------------------ 键盘导航 ------------------------------ */

  const navigate = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      const cur = doc.selectedId ? layout.byId.get(doc.selectedId) : undefined;
      if (!cur) {
        dispatch({ type: "select", id: layout.rootPos.node.id });
        return;
      }
      let best: PositionedNode | null = null;
      let bestScore = Infinity;
      for (const c of layout.nodes) {
        if (c.node.id === cur.node.id) continue;
        const dx = c.centerX - cur.centerX;
        const dy = c.centerY - cur.centerY;
        let primary = 0;
        let perp = 0;
        if (dir === "up") {
          if (dy > -4) continue;
          primary = -dy;
          perp = Math.abs(dx);
        } else if (dir === "down") {
          if (dy < 4) continue;
          primary = dy;
          perp = Math.abs(dx);
        } else if (dir === "left") {
          if (dx > -4) continue;
          primary = -dx;
          perp = Math.abs(dy);
        } else {
          if (dx < 4) continue;
          primary = dx;
          perp = Math.abs(dy);
        }
        const score = primary + perp * 1.7;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best) dispatch({ type: "select", id: best.node.id });
    },
    [doc.selectedId, layout]
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      // 概要 / 分组框文案正在编辑：焦点可能已被点到画布上，
      // 这时输入框拿不到按键，由这里兜住 Esc 收起编辑框。
      if (extraEdit) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelExtraEdit();
        }
        return;
      }
      // 节点标题处于内联编辑中：快捷键一律让位给输入框
      if (editing) return;
      const meta = e.ctrlKey || e.metaKey;

      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (meta && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        dispatch({ type: "redo" });
        return;
      }
      if (meta && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        exportRef.current("km");
        return;
      }
      if (meta && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        applyStyle({ bold: !selStyle.bold });
        return;
      }
      if (meta && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        applyStyle({ italic: !selStyle.italic });
        return;
      }
      if (meta && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        applyStyle({ underline: !selStyle.underline });
        return;
      }

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) outdent();
          else addChild();
          return;
        case "Enter":
          e.preventDefault();
          addSibling(e.shiftKey);
          return;
        case "F2":
          e.preventDefault();
          if (selectedNode) startEdit(selectedNode);
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          removeNode();
          return;
        case " ":
          e.preventDefault();
          toggleCollapse();
          return;
        case "Escape":
          e.preventDefault();
          setMenuId(null);
          dispatch({ type: "clearSelect" });
          return;
        case "ArrowUp":
          e.preventDefault();
          if (e.altKey) moveSibling(-1);
          else navigate("up");
          return;
        case "ArrowDown":
          e.preventDefault();
          if (e.altKey) moveSibling(1);
          else navigate("down");
          return;
        case "ArrowLeft":
          e.preventDefault();
          navigate("left");
          return;
        case "ArrowRight":
          e.preventDefault();
          navigate("right");
          return;
        default:
          return;
      }
    },
    [
      addChild,
      addSibling,
      applyStyle,
      editing,
      extraEdit,
      moveSibling,
      navigate,
      outdent,
      removeNode,
      selStyle.bold,
      selStyle.italic,
      selStyle.underline,
      selectedNode,
      startEdit,
      toggleCollapse,
    ]
  );

  /* ------------------------------ 导入 / 导出 ------------------------------ */

  const buildSvgPayload = useCallback((): SvgPayload => {
    const src = svgRef.current;
    if (!src) throw new Error("画布尚未就绪");
    const pad = 32;
    const W = Math.ceil(layout.width + pad * 2);
    const H = Math.ceil(layout.height + pad * 2);
    const clone = src.cloneNode(true) as SVGSVGElement;
    const rootG = clone.querySelector("g.mm-root");
    if (rootG) rootG.setAttribute("transform", `translate(${pad},${pad})`);
    clone.querySelectorAll(".mm-ui-only").forEach((el) => el.remove());
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(W));
    bg.setAttribute("height", String(H));
    bg.setAttribute("fill", canvasBg);
    clone.insertBefore(bg, clone.firstChild);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(W));
    clone.setAttribute("height", String(H));
    clone.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const xml = new XMLSerializer().serializeToString(clone);
    return {
      svg: `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`,
      width: W,
      height: H,
    };
  }, [layout.width, layout.height, canvasBg]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        const { blob, filename } = await exportTree(
          treeRef.current,
          format,
          buildSvgPayload,
          "mindmap"
        );
        downloadBlob(blob, filename);
        showToast(`已导出 ${filename}`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "导出失败", "err");
      }
    },
    [buildSvgPayload, showToast]
  );
  exportRef.current = (format: ExportFormat) => {
    void handleExport(format);
  };

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const { tree, structure } = await parseMindmapFile(file.name, buffer);
        // 先清空当前画布（reset 会整体替换树），再按文件声明的结构绘制；
        // 文件未声明结构类型时，回落到「思维导图」。
        dispatch({ type: "reset", tree });
        setConfig((c) => ({ ...c, structure: structure ?? "mindmap" }));
        setPendingFit(true);
        showToast(`已打开 ${file.name}（${countNodes(tree)} 个节点）`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "打开文件失败", "err");
      }
    },
    [showToast]
  );

  const handleNew = useCallback(() => {
    const root = createNode("中心主题");
    root.isRoot = true;
    dispatch({ type: "reset", tree: root });
    setPendingFit(true);
    showToast("已新建空白导图");
  }, [showToast]);

  /* ------------------------------ 节点拖拽 ------------------------------ */

  /** 屏幕坐标 → 画布世界坐标 */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    const t = transformRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - t.tx) / t.scale,
      y: (clientY - rect.top - t.ty) / t.scale,
    };
  }, []);

  /**
   * 目标节点的同级排列方向：
   * 水平布局（逻辑图 / 思维导图）同级靠 y 排序，上下布局（组织结构图）靠 x 排序，
   * 目录组织图 / 时间轴的深层节点又回到垂直堆叠 —— 因此优先用实际坐标反推。
   */
  const siblingAxisOf = useCallback(
    (p: PositionedNode): "x" | "y" => {
      const hit = findParent(doc.tree, p.node.id);
      if (hit && hit.parent.children.length > 1) {
        let dx = 0;
        let dy = 0;
        for (const c of hit.parent.children) {
          if (c.id === p.node.id) continue;
          const q = layout.byId.get(c.id);
          if (!q) continue;
          dx += Math.abs(q.centerX - p.centerX);
          dy += Math.abs(q.centerY - p.centerY);
        }
        if (dx || dy) return dy >= dx ? "y" : "x";
      }
      const s = config.structure;
      if (s === "org") return "x";
      if ((s === "catalog" || s === "timeline") && p.depth <= 1) return "x";
      return "y";
    },
    [config.structure, doc.tree, layout]
  );

  /** 命中测试：返回落点目标节点与插入方式 */
  const resolveDrop = useCallback(
    (wx: number, wy: number, dragId: string): { id: string; mode: DropMode } | null => {
      const dragNode = findNode(doc.tree, dragId);
      // 从后往前找，命中视觉上最上层的节点
      for (let i = layout.nodes.length - 1; i >= 0; i--) {
        const p = layout.nodes[i];
        if (p.node.id === dragId) continue;
        // 不能拖进自己的子孙里，否则会形成环
        if (dragNode && findNode(dragNode, p.node.id)) continue;
        if (wx < p.x || wx > p.x + p.w || wy < p.y || wy > p.y + p.h) continue;
        // 根节点只有「挂接为子节点」这一种落法
        if (p.node.id === doc.tree.id) return { id: p.node.id, mode: "child" };
        const along = siblingAxisOf(p);
        const rel =
          along === "y"
            ? (wy - p.centerY) / Math.max(p.h, 1)
            : (wx - p.centerX) / Math.max(p.w, 1);
        const mode: DropMode = rel < -0.28 ? "before" : rel > 0.28 ? "after" : "child";
        return { id: p.node.id, mode };
      }
      return null;
    },
    [doc.tree, layout, siblingAxisOf]
  );

  const beginNodeDrag = useCallback(
    (e: ReactMouseEvent<SVGGElement>, nodeId: string) => {
      if (!editableNow || e.button !== 0) return;
      if (!freeDragRef.current) return; // 关闭自由拖拽后不接管节点拖动
      if (nodeId === doc.tree.id) return; // 根节点不可拖动
      e.stopPropagation();
      focusStage();
      pendingDragRef.current = {
        id: nodeId,
        sx: e.clientX,
        sy: e.clientY,
        active: false,
      };
    },
    [doc.tree.id, editableNow, focusStage]
  );

  // 拖拽期间在 window 上监听，指针移出画布也不会中断
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const st = pendingDragRef.current;
      if (!st) return;
      if (!st.active) {
        if (Math.abs(e.clientX - st.sx) < 5 && Math.abs(e.clientY - st.sy) < 5) return;
        st.active = true;
        setMenuId(null);
      }
      e.preventDefault();
      const { x, y } = toWorld(e.clientX, e.clientY);
      const hit = resolveDrop(x, y, st.id);
      setNodeDrag({
        id: st.id,
        wx: x,
        wy: y,
        overId: hit?.id ?? null,
        mode: hit?.mode ?? "child",
      });
    };
    const onUp = () => {
      const st = pendingDragRef.current;
      pendingDragRef.current = null;
      if (!st) return;
      if (!st.active) {
        setNodeDrag(null);
        return;
      }
      const d = nodeDragRef.current;
      setNodeDrag(null);
      if (!d || !d.overId || d.overId === d.id) return;
      if (d.mode !== "child" && d.overId === doc.tree.id) return;
      const res = opMove(treeRef.current, d.id, d.overId, d.mode);
      if (res.changed) {
        dispatch({ type: "commit", tree: res.tree, focusId: res.focusId });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [doc.tree.id, resolveDrop, toWorld]);

  // Esc 关闭环形菜单：画布未拿到焦点时（例如刚右键完就按 Esc）也能关掉
  useEffect(() => {
    if (!menuId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuId]);

  /* ------------------------------ 画布平移 ------------------------------ */

  const dragRef = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
    moved: boolean;
  } | null>(null);

  const onStageMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    focusStage();
    const el = e.target as HTMLElement;
    // 菜单内部的点击交给按钮自己处理，否则 mousedown 会先把菜单关掉
    if (el.closest(".mm-radial")) return;
    setMenuId(null);
    if (
      el.closest(".mm-node, .mm-collapse, .mm-editor, .mm-zoom, .mm-minimap, .mm-modal")
    ) {
      return;
    }
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.tx,
      ty: transform.ty,
      moved: false,
    };
  };

  const onStageMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setTransform((t) => ({ ...t, tx: d.tx + dx, ty: d.ty + dy }));
  };

  const onStageMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    if ((e.target as HTMLElement).closest(".mm-node, .mm-collapse")) return;
    // 点空白：清空选中（多选集合一并清空）
    dispatch({ type: "clearSelect" });
  };

  const confirmDialog = () => {
    if (!dialog || !selectedNode) return;
    const v = dialog.value.trim();
    dispatch({
      type: "commit",
      tree: opUpdate(treeRef.current, selectedNode.id, {
        [dialog.kind]: v ? v : undefined,
      } as Partial<MindNode>),
    });
    setDialog(null);
  };

  /* ------------------------------ 渲染 ------------------------------ */

  const editingNode = editing ? findNode(doc.tree, editing.id) : null;

  /** 平铺的节点盒子（ExtrasLayer 只需要 id + 几何） */
  const layoutNodes = useMemo(
    () => layout.nodes.map((p) => ({ id: p.node.id, x: p.x, y: p.y, w: p.w, h: p.h })),
    [layout.nodes]
  );
  /** 节点盒子查表：ExtrasLayer 画几何、双击命中测试都要用它 */
  const nodeBoxes = useMemo(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const p of layoutNodes) m.set(p.id, { x: p.x, y: p.y, w: p.w, h: p.h });
    return m;
  }, [layoutNodes]);
  /** 当前内联编辑中的概要 / 分组框的编辑框（画布坐标） */
  const extraEditRect = useMemo(() => {
    if (!extraEdit) return null;
    return extrasEditTarget(doc.tree, nodeBoxes, extraEdit.kind, extraEdit.id);
  }, [doc.tree, extraEdit, nodeBoxes]);

  /* --------------------- 命令式 API 依赖的原子操作 --------------------- */

  /** 给选中节点打一次数据补丁（note / link / image / tags / formula / frame / generalization） */
  const setNodeField = useCallback(
    (patch: Record<string, unknown>) => {
      const id = doc.selectedId;
      if (!editableNow) return;
      if (!id || !findNode(treeRef.current, id)) {
        showToast("请先点击选中一个节点", "err");
        return;
      }
      dispatch({ type: "commit", tree: opUpdate(treeRef.current, id, patch) });
    },
    [doc.selectedId, editableNow, showToast]
  );

  /* --------------------- 多选聚合：关联线 / 概要 / 分组框 --------------------- */

  /** 当前多选集合（过滤掉树里已不存在的 id，避免脏数据画线） */
  const validSelectedIds = useMemo(
    () => doc.selectedIds.filter((id) => findNode(doc.tree, id) != null),
    [doc.selectedIds, doc.tree]
  );

  /**
   * 多选浮动条的锚点：被选节点的包围盒（画布坐标）。
   * 少��� 2 个时不显示——关联线 / 概要至少要两个节点才有意义。
   */
  const multiSelectBounds = useMemo(() => {
    if (validSelectedIds.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of validSelectedIds) {
      const p = layout.byId.get(id);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [validSelectedIds, layout.byId]);

  /** 为多选生成一段稳定的 id（同一批操作不重复） */
  const groupId = useCallback(
    (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    []
  );

  /**
   * 给多选节点两两添加关联线（截图 2）。
   * 采用「链式」而非完全两两连接：N 个节点产生 N-1 条线，
   * 避免 4 个节点就画出 6 条线把画面糊住。
   */
  const addAssocBetweenSelected = useCallback(() => {
    if (!editableNow) return;
    const ids = validSelectedIds;
    if (ids.length < 2) {
      showToast("请按住 Ctrl / Cmd 选中至少 2 个节点", "err");
      return;
    }
    const cur = treeRef.current.assocLines ?? [];
    const next = [...cur];
    let added = 0;
    for (let i = 0; i < ids.length - 1; i += 1) {
      const fromId = ids[i];
      const toId = ids[i + 1];
      if (next.some((l) => l.fromId === fromId && l.toId === toId)) continue;
      next.push({ id: groupId("assoc"), fromId, toId, arrow: "out" });
      added += 1;
    }
    if (!added) {
      showToast("所选节点之间已存在关联线", "err");
      return;
    }
    dispatch({
      type: "commit",
      tree: opUpdate(treeRef.current, treeRef.current.id, { assocLines: next }),
    });
    showToast(`已添加 ${added} 条关联线`);
  }, [editableNow, groupId, showToast, validSelectedIds]);

  /**
   * 把多选节点汇总为一个概要（截图 3）。
   * 概要框的位置由 ExtrasLayer 依据节点包围盒实时算出，因此这里只存节点 id 集合。
   *
   * 点击浮动条的「概要」直接落地：弧线 + 文案一起画出来，并**立刻**把新概要
   * 的文案切成内联编辑态，用户不必再点一次「确定」。
   */
  const addSummaryForSelected = useCallback(() => {
    if (!editableNow) return;
    const ids = validSelectedIds;
    if (ids.length < 2) {
      showToast("请按住 Ctrl / Cmd 选中至少 2 个节点", "err");
      return;
    }
    const id = groupId("sum");
    const cur = treeRef.current.summaryGroups ?? [];
    dispatch({
      type: "commit",
      tree: opUpdate(treeRef.current, treeRef.current.id, {
        summaryGroups: [...cur, { id, nodeIds: ids, text: SUMMARY_DEFAULT }],
      }),
    });
    // 编辑态要在下一帧再开：等 group 进了树，几何才量得出来
    window.setTimeout(() => setExtraEdit({ kind: "summary", id, value: SUMMARY_DEFAULT }), 0);
    showToast(`已为 ${ids.length} 个节点创建概要，可直接改写文案`);
  }, [editableNow, groupId, showToast, validSelectedIds]);

  /** 把多选节点圈成一个分组框（截图 4）；同上，落地后直接进入标题编辑 */
  const addFrameForSelected = useCallback(() => {
    if (!editableNow) return;
    const ids = validSelectedIds;
    if (ids.length < 1) {
      showToast("请先按住 Ctrl / Cmd 选中节点", "err");
      return;
    }
    const id = groupId("frm");
    const cur = treeRef.current.frameGroups ?? [];
    dispatch({
      type: "commit",
      tree: opUpdate(treeRef.current, treeRef.current.id, {
        frameGroups: [
          ...cur,
          { id, nodeIds: ids, label: FRAME_DEFAULT },
        ],
      }),
    });
    window.setTimeout(() => setExtraEdit({ kind: "frame", id, value: FRAME_DEFAULT }), 0);
    showToast(`已为 ${ids.length} 个节点创建分组框，双击可改标题`);
  }, [editableNow, groupId, showToast, validSelectedIds]);

  /**
   * 提交概要 / 分组框文案。空文案按各自约定回退：
   * 概要 → 兜底「概要」（画出来总得有字）；分组 → 清掉标签（只剩虚线框）。
   */
  const commitExtraEdit = useCallback(() => {
    const cur = extraEditRef.current;
    if (!cur) return;
    const text = cur.value.replace(/\s+$/, "");
    const tree = treeRef.current;
    const origin =
      cur.kind === "summary"
        ? tree.summaryGroups?.find((g) => g.id === cur.id)?.text ?? SUMMARY_DEFAULT
        : tree.frameGroups?.find((g) => g.id === cur.id)?.label ?? "";
    if (text === origin.trim()) {
      // 没改就别塞一条撤销记录
      setExtraEdit(null);
      focusStage();
      return;
    }
    const next = cur.kind === "summary" ? text || SUMMARY_DEFAULT : text || undefined;
    const patched =
      cur.kind === "summary"
        ? opUpdate(tree, tree.id, {
            summaryGroups: (tree.summaryGroups ?? []).map((g) =>
              g.id === cur.id ? { ...g, text: next as string } : g
            ),
          })
        : opUpdate(tree, tree.id, {
            frameGroups: (tree.frameGroups ?? []).map((g) =>
              g.id === cur.id ? { ...g, label: next as string | undefined } : g
            ),
          });
    dispatch({ type: "commit", tree: patched });
    extraEditRef.current = null;
    setExtraEdit(null);
    focusStage();
  }, [focusStage]);

  /**
   * 放弃修改（Esc）。必须先清空 `extraEditRef` 再 `focusStage()`：
   * 收起编辑框会把焦点还给画布 → 触发输入框的 onBlur → 若不摘掉 ref 就会被
   * `commitExtraEdit` 当成「正常提交」写进树，Esc 等于没生效。
   */
  const cancelExtraEdit = useCallback(() => {
    extraEditRef.current = null;
    setExtraEdit(null);
    focusStage();
  }, [focusStage]);

  /** 双击画布上的概要框 / 分组框标题 → 进入内联编辑 */
  const startExtraEdit = useCallback(
    (target: ExtrasTarget) => {
      if (!editableNow) return;
      focusStage();
      setExtraEdit({ ...target, value: target.value });
    },
    [editableNow, focusStage]
  );

  /**
   * 画布双击命中测试：把屏幕坐标换算成画布坐标后再问 extras 层。
   *
   * 走**捕获阶段**（`onDoubleClickCapture`）是必须的：节点组上有一块比外框更大
   * 的透明命中区（`rect.mm-hit`），分组框的标题胶囊常常压在它下面，冒泡阶段的
   * 画布监听器根本收不到 dblclick——事件已经被节点吃去「编辑节点标题」了。
   * 在捕获阶段拦下并 stopPropagation，才能既改到分组标题又不误伤节点编辑。
   */
  const onStageDoubleClickCapture = useCallback(
    (e: ReactMouseEvent) => {
      if (!editableNow || editingRef.current) return;
      const st = stageRef.current;
      if (!st) return;
      const r = st.getBoundingClientRect();
      const px = (e.clientX - r.left - transform.tx) / transform.scale;
      const py = (e.clientY - r.top - transform.ty) / transform.scale;
      const hit = extrasHitTest(doc.tree, nodeBoxes, px, py);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      startExtraEdit(hit);
    },
    [doc.tree, editableNow, nodeBoxes, startExtraEdit, transform]
  );

  /** 清空多选（不改动树，仅收起选择） */
  const clearMultiSelect = useCallback(() => {
    dispatch({ type: "clearSelect" });
  }, []);

  /** 按深度批量设置收起状态：depth >= d 的节点收起（d 为极大值时全展开） */  const setCollapsedBelow = useCallback((d: number) => {
    const walk = (n: MindNode, depth: number): MindNode => ({
      ...n,
      collapsed: depth >= d ? true : n.collapsed,
      children: n.children.map((c) => walk(c, depth + 1)),
    });
    dispatch({ type: "commit", tree: walk(treeRef.current, 0) });
  }, []);

  const expandAll = useCallback(() => setCollapsedBelow(Number.MAX_SAFE_INTEGER), [setCollapsedBelow]);
  const collapseToDepth = useCallback((d: number) => setCollapsedBelow(d), [setCollapsedBelow]);

  /* --------------------------- 对外命令式 API --------------------------- */
  /*
   * 宿主（haiku-wiki）沿用原有浮动工具条，需要像操作 simple-mind-map 实例那样
   * 驱动画布；这里把内部 reducer 操作提升为命令式接口，宿主只拿 ref 调用即可。
   */
  useImperativeHandle(
    ref,
    () => ({
      /* 数据 */
      getTree: () => treeRef.current,
      setTree: (tree) => dispatch({ type: "reset", tree }),

      /* 撤销 / 重做 */
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      canUndo: () => doc.past.length > 0,
      canRedo: () => doc.future.length > 0,

      /* 结构操作 */
      addChild,
      addSibling,
      addParent,
      removeNode,
      outdent,
      select: (id) => {
        if (!id) {
          dispatch({ type: "select", id: null });
          return false;
        }
        if (!findNode(treeRef.current, id)) return false;
        dispatch({ type: "select", id });
        return true;
      },
      getSelectedId: () => doc.selectedId,
      hasSelection: () => Boolean(doc.selectedId),

      /* 多选（Ctrl / Cmd + 左键） */
      getSelectedIds: () => doc.selectedIds,
      toggleSelect: (id: string) => {
        if (!findNode(treeRef.current, id)) return false;
        dispatch({ type: "toggleSelect", id });
        return true;
      },
      clearSelect: () => dispatch({ type: "clearSelect" }),
      addAssocBetween: addAssocBetweenSelected,
      addSummaryFor: addSummaryForSelected,
      addFrameFor: addFrameForSelected,

      /* 节点样式 / 新建节点文字默认值 */
      setNodeStyle: (patch) => applyStyle(patch),
      getNodeStyle: () => findNode(treeRef.current, doc.selectedId ?? "")?.style ?? {},
      clearNodeStyles: () => {
        const id = doc.selectedId;
        if (!id) return;
        dispatch({
          type: "commit",
          tree: opUpdate(treeRef.current, id, {}, { shape: undefined }),
        });
      },
      getTextDefaults: () => textDefaults,
      setTextDefaults: (patch) => setTextDefaults((d) => ({ ...d, ...patch })),

      /* 配置（主题 / 结构 / 连线 / 基础样式）。
       * ⚠️ getter 必须走 configRef 而不是闭包里的 `config`：本 handle 的依赖数组里没有
       * config，闭包会一直指向首次渲染那份 —— 宿主算「基础样式全量覆盖」时
       * （`{...api.getBase(), ...patch}`）就会拿到空的旧 base，每次改一项都把之前设的
       * 连线线型 / 箭头 / 边框线型全部抹掉，看上去就是「样式存不下来」。
       * 底下 getScale / getView 同理（transform 对象每次平移都换引用）。 */
      getConfig: () => configRef.current,
      setConfig: (patch) => setConfig((c) => ({ ...c, ...patch })),
      setStructure: (s) => setConfig((c) => ({ ...c, structure: s })),
      setLineStyle: (s) => setConfig((c) => ({ ...c, lineStyle: s })),
      setThemeId: (t) => setConfig((c) => ({ ...c, themeId: t })),
      setBase: (patch) => setConfig((c) => ({ ...c, base: { ...c.base, ...patch } })),
      getBase: () => configRef.current.base ?? {},

      /* 运行期模式 */
      getMode: () => mode,
      setMode: (m) => setModeState(m),
      setWheelAction: (a) => setWheelAction(a),
      setFreeDrag: (v) => setFreeDrag(v),

      /* 视图 */
      zoomIn: () => zoomBy(1.2),
      zoomOut: () => zoomBy(1 / 1.2),
      fitView: fit,
      resetView: () => setTransform({ scale: 1, tx: 0, ty: 0 }),
      centerRoot: () => {
        const el = stageRef.current;
        const root = layout.rootPos;
        if (!el || !root) return;
        const s = transform.scale;
        setTransform({
          scale: s,
          tx: el.clientWidth / 2 - (root.x + root.w / 2) * s,
          ty: el.clientHeight / 2 - (root.y + root.h / 2) * s,
        });
      },
      getScale: () => transformRef.current.scale,
      getView: () => ({
        scale: transformRef.current.scale,
        tx: transformRef.current.tx,
        ty: transformRef.current.ty,
      }),
      setView: (v) =>
        setTransform((t) => ({
          scale: v.scale === undefined ? t.scale : Math.min(Math.max(v.scale, MIN_SCALE), MAX_SCALE),
          tx: v.tx ?? t.tx,
          ty: v.ty ?? t.ty,
        })),

      /* 展开 / 收起 */
      expandAll,
      collapseToDepth,
      toggleCollapse,

      /* 节点补充属性（simple-mind-map 迁移补齐项） */
      setNote: (text) => setNodeField({ note: text || undefined }),
      getNote: () => findNode(treeRef.current, doc.selectedId ?? "")?.note ?? "",
      setLink: (url) => setNodeField({ link: url || undefined }),
      getLink: () => findNode(treeRef.current, doc.selectedId ?? "")?.link ?? "",
      setImage: (img) => setNodeField({ image: img ?? undefined }),
      getImage: () => findNode(treeRef.current, doc.selectedId ?? "")?.image,
      setTags: (tags) => setNodeField({ tags: tags?.length ? tags : undefined }),
      getTags: () => findNode(treeRef.current, doc.selectedId ?? "")?.tags ?? [],
      setFormula: (f) => setNodeField({ formula: f || undefined }),
      getFormula: () => findNode(treeRef.current, doc.selectedId ?? "")?.formula ?? "",
      setFrame: (f) => setNodeField({ frame: f ?? undefined }),
      getFrame: () => findNode(treeRef.current, doc.selectedId ?? "")?.frame,
      setGeneralization: (g) => setNodeField({ generalization: g ?? undefined }),
      getGeneralization: () => findNode(treeRef.current, doc.selectedId ?? "")?.generalization,

      /* 优先级 / 进度 / 图标（宿主顶部工具条面板用） */
      getPriority: () => findNode(treeRef.current, doc.selectedId ?? "")?.priority,
      setPriority,
      getProgress: () => findNode(treeRef.current, doc.selectedId ?? "")?.progress,
      setProgress,
      getIcons: () => findNode(treeRef.current, doc.selectedId ?? "")?.icons ?? [],
      toggleIcon,

      /* 关联线（统一挂在根节点上） */
      addAssocLine: (fromId, toId, label) => {
        if (!fromId || !toId || fromId === toId) return;
        const cur = treeRef.current.assocLines ?? [];
        if (cur.some((l) => l.fromId === fromId && l.toId === toId)) return;
        dispatch({
          type: "commit",
          tree: opUpdate(treeRef.current, treeRef.current.id, {
            assocLines: [
              ...cur,
              { id: `assoc-${Date.now().toString(36)}`, fromId, toId, label: label || undefined, arrow: "out" },
            ],
          }),
        });
      },
      removeAssocLine: (id) =>
        dispatch({
          type: "commit",
          tree: opUpdate(treeRef.current, treeRef.current.id, {
            assocLines: (treeRef.current.assocLines ?? []).filter((l) => l.id !== id),
          }),
        }),
      getAssocLines: () => treeRef.current.assocLines ?? [],

      /* 导出 */
      getSvg: () => buildSvgPayload(),
      exportPng: () => handleExport("png"),
      exportAs: (f) => handleExport(f as ExportFormat),

      /* 节点包围盒：宿主做浮层 / 定位时用 */
      getNodeBoxes: () => {
        const m: Record<string, { x: number; y: number; w: number; h: number }> = {};
        for (const p of layout.nodes) m[p.node.id] = { x: p.x, y: p.y, w: p.w, h: p.h };
        return m;
      },
    }),
    [
      addAssocBetweenSelected,
      addChild,
      addFrameForSelected,
      addParent,
      addSibling,
      addSummaryForSelected,
      applyStyle,
      buildSvgPayload,
      collapseToDepth,
      doc.future.length,
      doc.past.length,
      doc.selectedId,
      doc.selectedIds,
      expandAll,
      fit,
      handleExport,
      layout.nodes,
      mode,
      outdent,
      removeNode,
      setCollapsedBelow,
      setNodeField,
      textDefaults,
      treeRef,
      transform.scale,
      toggleCollapse,
    ]
  );

  return (
    <div className={`mm-wrap ${className ?? ""}`} style={{ width, height }}>
      {showToolbar && (
        <Toolbar
          mainMenu={
            <MainMenu
              buildItems={(close) =>
                buildMainMenu({
                  onNew: () => { close(); handleNew(); },
                  onOpen: () => { close(); menuFileRef.current?.click(); },
                  onExport: (f) => { close(); handleExport(f); },
                  canUndo: doc.past.length > 0,
                  canRedo: doc.future.length > 0,
                  onUndo: () => dispatch({ type: "undo" }),
                  onRedo: () => dispatch({ type: "redo" }),
                  canDelete: Boolean(doc.selectedId) && doc.selectedId !== doc.tree.id,
                  onDelete: removeNode,
                  onInsertParent: addParent,
                  onInsertSiblingBefore: () => addSibling(true),
                  onInsertSiblingAfter: () => addSibling(false),
                  onInsertChild: addChild,
                  onNote: () => selectedNode && setDialog({ kind: "note", value: selectedNode.note ?? "" }),
                  onLink: () => selectedNode && setDialog({ kind: "link", value: selectedNode.link ?? "" }),
                  style: selStyle,
                  onStyle: applyStyle,
                  config,
                  onConfig: (patch) => setConfig((c) => ({ ...c, ...patch })),
                  onBase: (patch) => setConfig((c) => ({ ...c, base: { ...c.base, ...patch } })),
                  markers: selectedNode?.markers ?? [],
                  onToggleMarker: toggleMarker,
                  priority: selectedNode?.priority,
                  onSetPriority: setPriority,
                  progress: selectedNode?.progress,
                  onSetProgress: setProgress,
                  icons: selectedNode?.icons ?? [],
                  onToggleIcon: toggleIcon,
                })(close)
              }
            />
          }
          canUndo={doc.past.length > 0}
          canRedo={doc.future.length > 0}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          canDelete={Boolean(doc.selectedId) && doc.selectedId !== doc.tree.id}
          onInsertParent={addParent}
          onInsertSiblingBefore={() => addSibling(true)}
          onInsertSiblingAfter={() => addSibling(false)}
          onInsertChild={addChild}
          onDelete={removeNode}
          markers={selectedNode?.markers ?? []}
          onToggleMarker={toggleMarker}
          defaults={{
            fontSize: effectiveDefaultSize,
            fontFamily: effectiveDefaultFont,
          }}
          onDefaults={applyStyle}
          style={selStyle}
          onStyle={applyStyle}
          onNote={() => selectedNode && setDialog({ kind: "note", value: selectedNode.note ?? "" })}
          onLink={() => selectedNode && setDialog({ kind: "link", value: selectedNode.link ?? "" })}
          config={config}
          onConfig={(patch) => setConfig((c) => ({ ...c, ...patch }))}
          onBase={(patch) => setConfig((c) => ({ ...c, base: { ...c.base, ...patch } }))}
          priority={selectedNode?.priority}
          onSetPriority={setPriority}
          progress={selectedNode?.progress}
          onSetProgress={setProgress}
          icons={selectedNode?.icons ?? []}
          onToggleIcon={toggleIcon}
          onImport={handleImport}
          onExport={handleExport}
          onNew={handleNew}
        />
      )}

      {/* 主菜单「文件 → 打开」用的隐藏 input（工具条自带一个，这里服务于 Portal 菜单） */}
      <input
        ref={menuFileRef}
        className="mm-file-input"
        type="file"
        accept={IMPORT_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />

      <div
        ref={stageRef}
        className={`mm-stage ${editableNow ? "is-editableNow" : ""}`}
        style={{ background: canvasBg }}
        tabIndex={editableNow ? 0 : -1}
        onKeyDown={onKeyDown}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
        onMouseLeave={onStageMouseUp}
        onDoubleClickCapture={onStageDoubleClickCapture}
        onContextMenu={(e) => {
          // 空白处右键：屏蔽浏览器原生菜单并关闭已打开的环形菜单
          e.preventDefault();
          setMenuId(null);
        }}
      >
        <svg ref={svgRef} className="mm-svg" width="100%" height="100%">
          <g
            className="mm-root"
            transform={`translate(${transform.tx},${transform.ty}) scale(${transform.scale})`}
          >
            {layout.links.map((l) => {
              const base_d = linkPath(l);
              // 分支样式（截图 1）：在骨架外套一层括号 / 圆弧形态
              const bsGeo = branchStyle === "default" ? null : parseLinkPath(base_d);
              const styled =
                bsGeo && branchStyle !== "default"
                  ? branchPath(branchStyle, toBranchGeom(bsGeo))
                  : null;
              // 手绘主题（参考截图）：把最终路径换成「双笔触」路径（2 条 path）
              const sketch =
                handOn && styled
                  ? handdrawLink(styled, `${l.from.node.id}->${l.to.node.id}`, handJitter)
                  : handOn
                  ? handdrawLink(base_d, `${l.from.node.id}->${l.to.node.id}`, handJitter)
                  : null;
              const d = sketch ? sketch[0] : (styled ?? base_d);
              // 单色模式：忽略各分支的主题色，整张画布统一用 linkColor
              const color = linkColorMode === "single" ? linkColor : l.color ?? linkColor;
              const pattern = base.linkPattern ?? "solid";
              const arrow = base.linkArrow ?? "none";
              const geo = arrow === "none" ? null : parseLinkPath(d);
              // 从粗到细：变宽只能靠填充带表达（描边加 dash 会退化成虚线），与虚线互斥
              // 手绘主题下 taper 改用手绘中心线表达，避免填充带盖掉抖动效果
              const taper =
                pattern === "taper"
                  ? handOn
                    ? handTaperFill(d, TAPER_THICK_W, TAPER_THIN_W)
                    : taperFillPath(d, TAPER_THICK_W, TAPER_THIN_W)
                  : null;
              // 箭头跟着「所在端」的线宽：taper 父端 8 / 子端 2，否则用 linkWidth 派生
              const arrowW =
                pattern === "taper" ? (arrow === "inward" ? TAPER_THICK_W : TAPER_THIN_W) : linkWidth;
              const arrowLen = arrowW * 3 + 4
              const arrowBase = arrowW * 1.7 + 1
              const dashAttr = pattern === "dashed" ? "7 5" : undefined;
              return (
                <g key={`${l.from.node.id}->${l.to.node.id}`} className="mm-link">
                  {taper ? (
                    <path d={taper} fill={color} stroke="none" />
                  ) : sketch ? (
                    // 双笔触：两笔各自独立描一遍，端点在节点边缘收拢
                    sketch.map((pd, i) => (
                      <path
                        key={i}
                        d={pd}
                        fill="none"
                        stroke={color}
                        strokeWidth={linkWidth * (i === 0 ? 1 : 0.82)}
                        strokeDasharray={dashAttr}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))
                  ) : (
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={linkWidth}
                      strokeDasharray={dashAttr}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {geo &&
                    // 手绘风格用「空心 V」（两根短线），其余保持实心三角：
                    // 参考截图的箭头就是开口的，实心三角会把线头糊成一坨
                    (sketch ? (
                      sketchArrowHead(
                        // 向内：尖端贴在父端并朝父节点（朝画布中心收）；向外：尖端贴在子端朝外
                        arrow === "inward" ? geo.p0 : geo.p1,
                        arrow === "inward" ? { x: -geo.v0.x, y: -geo.v0.y } : geo.v1,
                        arrowLen,
                        arrowBase,
                        `arw-${l.from.node.id}-${l.to.node.id}`,
                        { amp: handJitter, gap: 0 }
                      ).map((pd, i) => (
                        <path
                          key={`ah${i}`}
                          d={pd}
                          fill="none"
                          stroke={color}
                          strokeWidth={linkWidth * 1.15}
                          strokeLinecap="round"
                        />
                      ))
                    ) : (
                      <polygon
                        points={
                          arrow === "inward"
                            ? arrowTri(geo.p0, { x: -geo.v0.x, y: -geo.v0.y }, arrowLen, arrowBase)
                            : arrowTri(geo.p1, geo.v1, arrowLen, arrowBase)
                        }
                        fill={color}
                      />
                    ))}
                </g>
              );
            })}

            {/* 关联线 / 外框 / 概要：画在连线之上、节点之下 */}
            <ExtrasLayer
              root={doc.tree}
              nodes={layoutNodes}
              handDrawn={handOn}
              handJitter={handJitter}
            />

            {layout.nodes.map((p) => {
              const node = p.node;
              const eff = node.style ?? {};
              const isRoot = node.id === doc.tree.id;
              // 默认形状按层级：根节点与一级节点为胶囊外框（capsule），
              // 二级及以下 / 叶子节点保持下划线风格（无外边框）。
              // 节点显式设置 eff.shape 时仍以自身设置为准。
              const defaultShape = p.depth <= 1 ? "capsule" : "underline";
              const shape = eff.shape ?? defaultShape;
              const showRect = shape !== "underline" && shape !== "none";
              // 下划线「轨道」样式：文字左对齐，下划线贴合文字块宽度，
              // 连线自轨道两端接入，整体连贯（仿参考截图）。
              // 仅作用于二级及以下 / 叶子节点。
              const underTextX = UNDER_LEFT + prefixWidth(node);
              const underY = p.h - UNDER_DY;
              const noBorder = shape === "none";
              const isUnderline = shape === "underline";
              // 时间轴与鱼骨图：子节点只用左对齐文字，引导交给结构自身的连线
              // （时间轴是肘形折线、鱼骨图是 45° 斜骨 + 括号），因此不画下划线轨道。
              const isTimeline = config.structure === "timeline";
              const isFishbone = config.structure === "fishbone";
              const railTextW = isUnderline && !isTimeline && !isFishbone ? underlineTextWidth(p) : 0;
              // 圆角：节点显式 borderRadius 优先（按宽高一半内敛），否则按形状 / 主题基准
              const rx =
                eff.borderRadius != null
                  ? Math.min(eff.borderRadius, p.w / 2, p.h / 2)
                  : shape === "capsule"
                  ? p.h / 2
                  : shape === "rect" || shape === "none"
                  ? 2
                  : radius;

              const accent =
                node.color ??
                eff.borderColor ??
                (isFishbone ? FISHBONE_ACCENT : branchColors.get(node.id) ?? theme.nodeStroke);
              const stroke = theme.useBranchColor
                ? accent
                : node.color ?? eff.borderColor ?? theme.nodeStroke;
              // 鱼骨图：根节点为单色骨架的实心蓝灰胶囊（仿参考截图），故强制用强调色填充；
              // 一级胶囊沿用主题白底（不透明，自然压住斜骨），仅描边用强调色。
              const fill =
                isFishbone && isRoot
                  ? node.color ?? eff.background ?? FISHBONE_ACCENT
                  : eff.background ??
                    (isRoot ? base.nodeFill ?? theme.rootFill : base.nodeFill ?? theme.nodeFill);
              const fontFamily = eff.fontFamily ?? DEFAULT_TEXT.fontFamily;
              const fontSize = eff.fontSize ?? defaultFontSizeForDepth(p.depth);
              // 根节点的 rootText 是为「填充色块」设计的对比色；当下划线 / 无边框样式不绘制
              // 底色块时，根节点文字必须回退到普通节点文字色，否则会出现白字白底不可见。
              const textColor =
                eff.color ??
                (isFishbone && isRoot
                  ? "#ffffff"
                  : isRoot && showRect
                  ? base.nodeText ?? theme.rootText
                  : base.nodeText ?? theme.nodeText);
              // 手绘风格（参考截图）：外框走「双笔触」路径 ——
              // 中心节点是两道同心椭圆（gap 略大），普通节点是两道错开的圆角框。
              const handStrokes: string[] | null =
                handOn && showRect
                  ? isRoot
                    ? sketchEllipse(p.w / 2, p.h / 2, p.w / 2, p.h / 2, `root-${node.id}`, {
                        amp: handJitter,
                        gap: 3.6,
                      })
                    : sketchRect(0, 0, p.w, p.h, rx, `nd-${node.id}`, {
                        amp: handJitter,
                        gap: 2.2,
                      })
                  : null;
              // 节点边框线型：实线 / 虚线 / 点线 / 点划线（根节点与带框节点生效）
              const dash = BORDER_DASH[eff.borderStyle ?? "solid"];
              const isSelected = node.id === doc.selectedId && !editing;
              // 多选高亮：非主选中项但仍在集合里的节点，用更轻的描边提示
              const isMultiPicked =
                validSelectedIds.length > 1 && validSelectedIds.includes(node.id) && !isSelected;
              const hasKids = node.children.length > 0;
              const isCollapsed = Boolean(node.collapsed);
              const sized = nodeSize(node, p.depth);
              const lineH = sized.lineHeight;
              const blockTop = p.h / 2 - (sized.lines.length * lineH) / 2 + lineH / 2;
              const textX = textCenterX(node, p.w);
              const decoration =
                [
                  eff.underline ? "underline" : "",
                  eff.strike ? "line-through" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined;

              // 前缀（标记 / 优先级 / 进度 / 图标）依次排布
              let px = (node.markers?.length ?? 0) * 19;

              return (
                <g
                  key={node.id}
                  className="mm-node"
                  transform={`translate(${p.x},${p.y})${p.rot ? ` rotate(${p.rot} ${p.w / 2} ${p.h / 2})` : ""}`}
                  style={{ cursor: editableNow ? "pointer" : "default" }}
                  opacity={nodeDrag?.id === node.id ? 0.32 : 1}
                  onMouseDown={(e) => beginNodeDrag(e, node.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    focusStage();
                    setMenuId(null);
                    // Ctrl / Cmd + 左键 = 切换选中（多选）；否则单选替换
                    if (e.ctrlKey || e.metaKey) {
                      dispatch({ type: "toggleSelect", id: node.id });
                    } else {
                      dispatch({ type: "select", id: node.id });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!editableNow) return;
                    focusStage();
                    dispatch({ type: "select", id: node.id });
                    setMenuId(node.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    // 还有概要 / 分组文案开着就直接落库，避免两个编辑框并存
                    if (extraEditRef.current) commitExtraEdit();
                    startEdit(node);
                  }}
                >
                  <title>
                    {node.title}
                    {node.note ? `\n备注：${node.note}` : ""}
                    {node.link ? `\n链接：${node.link}` : ""}
                  </title>
                  {/* 选中环是编辑态的拖拽/工具栏交互提示：阅读 / 分享 / H5 三态下
                      reducer 仍会默认选中根节点，若照画就会出现一圈蓝虚线选中框。 */}
                  {isSelected && editableNow && (
                    <rect
                      className="mm-ui-only"
                      x={-4}
                      y={-4}
                      width={p.w + 8}
                      height={p.h + 8}
                      rx={radius + 4}
                      ry={radius + 4}
                      fill="none"
                      stroke="#2f6fed"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                    />
                  )}
                  {/* 多选提示环：非主选中项的已选节点 */}
                  {isMultiPicked && editableNow && (
                    <rect
                      className="mm-ui-only"
                      x={-4}
                      y={-4}
                      width={p.w + 8}
                      height={p.h + 8}
                      rx={radius + 4}
                      ry={radius + 4}
                      fill="none"
                      stroke="#2f6fed"
                      strokeWidth={1.2}
                      strokeDasharray="2 3"
                      opacity={0.75}
                    />
                  )}
                  {/* 手绘主题（参考截图）：中心节点双笔椭圆 + 普通节点双笔圆角矩形 */}
                  {handStrokes && (
                    <>
                      {/* 底色只填一次：第 0 笔就是「外皮」，直接拿它当填充轮廓，
                          避免两笔各自填充后出现错位色边 */}
                      <path className="mm-rect" d={handStrokes[0]} fill={fill} stroke="none" />
                      {handStrokes.map((pd, i) => (
                        <path
                          key={`hs${i}`}
                          d={pd}
                          fill="none"
                          stroke={noBorder ? "transparent" : stroke}
                          strokeWidth={
                            noBorder
                              ? 0
                              : (isSelected && editableNow ? strokeWidth + 0.6 : strokeWidth) *
                                (i === 0 ? 1 : 0.86)
                          }
                          strokeDasharray={dash}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}
                    </>
                  )}
                  {!handStrokes && showRect && (
                    <rect
                      className="mm-rect"
                      width={p.w}
                      height={p.h}
                      rx={rx}
                      ry={rx}
                      fill={fill}
                      stroke={noBorder ? "transparent" : stroke}
                      strokeWidth={
                        noBorder
                          ? 0
                          : isSelected && editableNow
                          ? strokeWidth + 0.6
                          : strokeWidth
                      }
                      strokeDasharray={dash}
                    />
                  )}

                  {!showRect && (
                    // 无框（下划线 / 无边框）节点：补一块透明命中区，使整节点区域
                    // 都可点击 / 右键 / 拖拽，交互与带框的一级节点完全一致。
                    <rect
                      className="mm-hit"
                      x={0}
                      y={0}
                      width={p.w}
                      height={p.h}
                      fill="transparent"
                      pointerEvents="all"
                    />
                  )}

                  {isUnderline && !isTimeline && !isFishbone && (
                    /* 手绘风格下下划线也走双笔触，与外框/连线同一套笔法 */
                    handOn ? (
                      sketchLine(
                        UNDER_LEFT,
                        underY,
                        UNDER_LEFT + prefixWidth(node) + railTextW + UNDER_PAD_R,
                        underY,
                        `ul-${node.id}`,
                        { amp: handJitter, gap: 1.6, segments: 10 }
                      ).map((pd, i) => (
                        <path
                          key={`ul${i}`}
                          d={pd}
                          className="mm-underline"
                          fill="none"
                          stroke={stroke}
                          strokeWidth={i === 0 ? 1.6 : 1.3}
                          strokeLinecap="round"
                        />
                      ))
                    ) : (
                      <line
                        className="mm-underline"
                        x1={UNDER_LEFT}
                        y1={underY}
                        x2={UNDER_LEFT + prefixWidth(node) + railTextW + UNDER_PAD_R}
                        y2={underY}
                        stroke={stroke}
                        strokeWidth={1.6}
                      />
                    )
                  )}

                  {node.formula ? (
                    <FormulaText
                      latex={node.formula}
                      cx={textX}
                      cy={p.h / 2}
                      fontSize={fontSize}
                      boxW={Math.max(24, p.w - prefixWidth(node) * 2)}
                    />
                  ) : (
                    sized.lines.map((line, i) => (
                      <text
                        key={i}
                        className="mm-text"
                        x={isUnderline ? underTextX : textX}
                        y={blockTop + i * lineH}
                        fill={textColor}
                        fontSize={fontSize}
                        fontFamily={fontFamily}
                        fontWeight={eff.bold ? 700 : 400}
                        fontStyle={eff.italic ? "italic" : undefined}
                        style={{ textDecoration: decoration } as CSSProperties}
                        textAnchor={isUnderline ? "start" : "middle"}
                        dominantBaseline="middle"
                      >
                        {line === "" ? " " : line}
                      </text>
                    ))
                  )}

                  {/* 标记图标 */}
                  {(node.markers ?? []).map((mid, i) => {
                    const def = MARKER_MAP.get(mid);
                    if (!def) return null;
                    return (
                      <g key={mid} transform={`translate(${9 + i * 19},${p.h / 2})`}>
                        <circle r={7} fill={def.bg} />
                        <text
                          y={0.5}
                          fill={def.fg}
                          fontSize={9.5}
                          fontWeight={700}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {def.char}
                        </text>
                      </g>
                    );
                  })}

                  {/* 优先级徽标 */}
                  {node.priority != null && (() => {
                    const color = PRIORITY_COLORS[node.priority] ?? "#9aa4b2";
                    return (
                      <g key="priority" transform={`translate(${px + 8.5},${p.h / 2})`}>
                        <circle r={8} fill={color} />
                        <text
                          y={0.5}
                          fill="#fff"
                          fontSize={10}
                          fontWeight={800}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {node.priority}
                        </text>
                      </g>
                    );
                  })()}
                  {node.priority != null && (px += 20)}

                  {/* 进度饼图 */}
                  {node.progress != null && (() => {
                    const frac = (node.progress ?? 0) / 10;
                    return (
                      <g key="progress" transform={`translate(${px + 8.5},${p.h / 2})`}>
                        <circle r={8} fill={PROGRESS_TRACK} />
                        <path d={piePath(frac)} fill={PROGRESS_COLOR} />
                      </g>
                    );
                  })()}
                  {node.progress != null && (px += 20)}

                  {/* emoji 图标前缀 */}
                  {(node.icons ?? []).map((iconId, i) => {
                    const def = NODE_ICON_MAP.get(iconId);
                    if (!def) return null;
                    return (
                      <text
                        key={`icon-${iconId}`}
                        x={px + i * 20 + 9}
                        y={p.h / 2 + 0.5}
                        fontSize={14}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {def.char}
                      </text>
                    );
                  })}
                  {px += (node.icons?.length ?? 0) * 20}

                  {/* 标签色块（simple-mind-map 迁移补齐） */}
                  {!!node.tags?.length && (
                    <NodeTags
                      tags={node.tags}
                      cx={px + (node.tags.length * 20) / 2}
                      cy={p.h / 2}
                      fontSize={fontSize}
                    />
                  )}
                  {px += (node.tags?.length ?? 0) * 20}

                  {/* 节点缩略图（simple-mind-map 迁移补齐） */}
                  {node.image && <NodeImage url={node.image.url} title={node.image.title} h={p.h} />}

                  {/* 备注 / 链接小标记 */}
                  {node.note && (
                    <g transform={`translate(${p.w - 10},9)`}>
                      <circle r={5.5} fill="#8b95a5" />
                      <path
                        d="M -2.6 -2 h 5.2 M -2.6 0 h 5.2 M -2.6 2 h 3"
                        stroke="#fff"
                        strokeWidth={1}
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                  {node.link && (
                    <g
                      transform={`translate(${p.w - 10 - (node.note ? 15 : 0)},9)`}
                    >
                      <circle r={5.5} fill="#2f6fed" />
                      <path
                        d="M -2.4 2.4 L 2.4 -2.4"
                        stroke="#fff"
                        strokeWidth={1.4}
                        strokeLinecap="round"
                      />
                    </g>
                  )}

                  {/* 折叠按钮 */}
                  {hasKids && (
                    <g
                      className="mm-collapse"
                      transform={
                        // 鱼骨图：圆点落在 45° 斜骨（或括号短横头）的锚点上，而不是盒子边缘
                        isFishbone && p.dotDX !== undefined
                          ? `translate(${p.dotDX},${p.dotDY ?? p.h / 2})`
                          : p.axis === "v"
                          ? // 目录组织图给出 busX：折叠按钮与子树竖线起点对齐，看起来竖线从按钮垂下
                            `translate(${p.busX ?? p.w / 2},${p.sgn === 1 ? p.h : 0})`
                          : `translate(${p.sgn === 1 ? p.w : 0},${p.h / 2})`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                    >
                      <circle
                        r={8.5}
                        fill={theme.useBranchColor ? accent : "#b9bec7"}
                        className="mm-collapse-dot"
                      />
                      <text
                        y={0.5}
                        fill="#fff"
                        fontSize={13}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        {isCollapsed ? "+" : "−"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 拖拽落点提示 + 跟随指针的节点幻影 */}
            {nodeDrag &&
              (() => {
                const target = nodeDrag.overId
                  ? layout.byId.get(nodeDrag.overId)
                  : undefined;
                const ghost = layout.byId.get(nodeDrag.id);
                const along = target ? siblingAxisOf(target) : "y";
                const lineY = target
                  ? target.y + (nodeDrag.mode === "before" ? -7 : target.h + 7)
                  : 0;
                const lineX = target
                  ? target.x + (nodeDrag.mode === "before" ? -7 : target.w + 7)
                  : 0;
                return (
                  <g className="mm-ui-only" pointerEvents="none">
                    {target && nodeDrag.mode === "child" && (
                      <rect
                        x={target.x - 5}
                        y={target.y - 5}
                        width={target.w + 10}
                        height={target.h + 10}
                        rx={radius + 4}
                        ry={radius + 4}
                        fill="none"
                        stroke="#2f6fed"
                        strokeWidth={2}
                        strokeDasharray="7 4"
                      />
                    )}
                    {target && nodeDrag.mode !== "child" && along === "y" && (
                      <line
                        x1={target.x}
                        y1={lineY}
                        x2={target.x + target.w}
                        y2={lineY}
                        stroke="#2f6fed"
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    )}
                    {target && nodeDrag.mode !== "child" && along === "x" && (
                      <line
                        x1={lineX}
                        y1={target.y}
                        x2={lineX}
                        y2={target.y + target.h}
                        stroke="#2f6fed"
                        strokeWidth={3}
                        strokeLinecap="round"
                      />
                    )}
                    {ghost && (
                      /* 幻影略微上移右偏，避免完全盖住落点节点 */
                      <g
                        transform={`translate(${nodeDrag.wx - ghost.w / 2 + 16},${
                          nodeDrag.wy - ghost.h / 2 - 16
                        })`}
                      >
                        <rect
                          width={ghost.w}
                          height={ghost.h}
                          rx={radius}
                          ry={radius}
                          fill="#fff"
                          stroke="#2f6fed"
                          strokeWidth={1.6}
                          strokeDasharray="4 3"
                          opacity={0.94}
                        />
                        <text
                          x={ghost.w / 2}
                          y={ghost.h / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={13}
                          fill="#2f6fed"
                        >
                          {ghost.node.title}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })()}
          </g>
        </svg>

        {/* 右键环形功能菜单 */}
        {menuId &&
          (() => {
            const p = layout.byId.get(menuId);
            const node = findNode(doc.tree, menuId);
            if (!p || !node) return null;
            const isRoot = menuId === doc.tree.id;
            const hit = findParent(doc.tree, menuId);
            const sibCount = hit ? hit.parent.children.length : 0;
            const sibIdx = hit ? hit.index : -1;
            const disabled: Record<string, boolean> = {
              prev: isRoot || sibIdx <= 0,
              next: isRoot || sibIdx < 0 || sibIdx >= sibCount - 1,
              outdent: isRoot || !hit || hit.parent.id === doc.tree.id,
              delete: isRoot,
            };
            const run: Record<string, () => void> = {
              prev: () => moveSibling(-1),
              next: () => moveSibling(1),
              child: addChild,
              sibling: () => addSibling(false),
              outdent,
              delete: removeNode,
            };
            return (
              <div
                className="mm-radial"
                style={{
                  left: transform.tx + p.centerX * transform.scale,
                  top: transform.ty + p.centerY * transform.scale,
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <i className="mm-radial-ring" />
                {RADIAL_ITEMS.map((it) => {
                  const a = (it.angle * Math.PI) / 180;
                  const dis = disabled[it.key] === true;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      className={`mm-radial-btn${dis ? " is-disabled" : ""}`}
                      disabled={dis}
                      style={{
                        left: `calc(50% + ${(Math.cos(a) * RADIAL_RADIUS).toFixed(1)}px)`,
                        top: `calc(50% + ${(Math.sin(a) * RADIAL_RADIUS).toFixed(1)}px)`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(null);
                        run[it.key]?.();
                      }}
                    >
                      <b>{it.label}</b>
                      <span>{it.hint}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="mm-radial-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuId(null);
                    startEdit(node);
                  }}
                >
                  <b>编辑</b>
                  <span>F2</span>
                </button>
              </div>
            );
          })()}

        {/* 多选浮动条：选中 ≥2 个节点时浮现在选区旁（替代原先的工具条「多选」面板） */}
        {editableNow && (
          <MultiSelectBar
            bounds={multiSelectBounds}
            transform={transform}
            onAddAssoc={addAssocBetweenSelected}
            onAddSummary={addSummaryForSelected}
            onAddFrame={addFrameForSelected}
            onClear={clearMultiSelect}
          />
        )}

        {/* 内联编辑框 */}
        {editing && editPos && editingNode && (
          <div
            className="mm-editor"
            style={{
              left: transform.tx + editPos.x * transform.scale,
              top: transform.ty + editPos.y * transform.scale,
              transform: `scale(${transform.scale})`,
              transformOrigin: "top left",
            }}
          >
            <textarea
              ref={editRef}
              className="mm-editor-input"
              value={editing.value}
              spellCheck={false}
              style={{
                width: Math.max(editPos.w, 110),
                minHeight: editPos.h,
                fontFamily: editingNode.style?.fontFamily ?? DEFAULT_TEXT.fontFamily,
                fontSize: editingNode.style?.fontSize ?? defaultFontSizeForDepth(editPos.depth),
                fontWeight: editingNode.style?.bold ? 700 : 400,
                fontStyle: editingNode.style?.italic ? "italic" : undefined,
                textDecoration:
                  [
                    editingNode.style?.underline ? "underline" : "",
                    editingNode.style?.strike ? "line-through" : "",
                  ]
                  .filter(Boolean)
                  .join(" ") || undefined,
                color: editingNode.style?.color ?? "#1f2329",
                background:
                  editingNode.style?.background ??
                  (base.nodeFill ?? theme.nodeFill),
                borderRadius: radius,
              }}
              onChange={(e) =>
                setEditing((cur) => (cur ? { ...cur, value: e.target.value } : cur))
              }
              onBlur={() => endEdit(null)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !(e.nativeEvent as KeyboardEvent).isComposing
                ) {
                  // 回车完成编辑并新增同级节点（与右键菜单 / 全局快捷键一致）
                  e.preventDefault();
                  endEdit("sibling");
                } else if (e.key === "Tab") {
                  // Tab 完成编辑并新增下级节点（Shift+Tab 仅完成编辑）
                  e.preventDefault();
                  endEdit(e.shiftKey ? null : "child");
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(null);
                  focusStage();
                }
              }}
            />
          </div>
        )}

        {/* 概要 / 分组框文案的内联编辑：盖在原文案上，回车 / 失焦落库，Esc 撤销 */}
        {extraEdit && extraEditRect && (
          <div
            className="mm-editor is-extra"
            style={{
              left: transform.tx + extraEditRect.x * transform.scale,
              top: transform.ty + extraEditRect.y * transform.scale,
              transform: `scale(${transform.scale})`,
              transformOrigin: "top left",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={extraInputRef}
              className="mm-editor-input is-extra"
              value={extraEdit.value}
              spellCheck={false}
              style={{
                width: Math.max(extraEditRect.w + 16, 72),
                height: Math.max(extraEditRect.h + 6, 26),
                fontSize: extraEditRect.fontSize,
                fontWeight: 600,
                borderRadius: extraEdit.kind === "frame" ? 9 : 8,
              }}
              onChange={(e) =>
                setExtraEdit((cur) => (cur ? { ...cur, value: e.target.value } : cur))
              }
              onBlur={() => commitExtraEdit()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (
                  (e.key === "Enter" || e.key === "Tab") &&
                  !(e.nativeEvent as KeyboardEvent).isComposing
                ) {
                  e.preventDefault();
                  commitExtraEdit();
                } else if (e.key === "Escape") {
                  // Esc 回退到进入编辑前的文案（树里还是旧值，关掉即可）
                  e.preventDefault();
                  cancelExtraEdit();
                }
              }}
            />
          </div>
        )}

        {/* 左下角停靠区：竖向缩放控件 + 紧邻其右侧的位置预览面板 */}
        <div className="mm-dock-bl">
          <div
            className="mm-zoom is-vertical"
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="mm-zoom-btn"
              title="放大"
              onClick={() => zoomBy(1.2)}
            >
              <Icon name="zoom-in" size={16} />
            </button>
            <button
              type="button"
              className="mm-zoom-value"
              title="适应屏幕"
              onClick={fit}
            >
              {Math.round(transform.scale * 100)}%
            </button>
            <button
              type="button"
              className="mm-zoom-btn"
              title="缩小"
              onClick={() => zoomBy(1 / 1.2)}
            >
              <Icon name="zoom-out" size={16} />
            </button>
            <i className="mm-zoom-sep" />
            <button
              type="button"
              className="mm-zoom-btn"
              title="适应屏幕"
              onClick={fit}
            >
              <Icon name="fit" size={16} />
            </button>
          </div>

          {stageSize.w > 0 && (
            <Minimap
              layout={layout}
              transform={transform}
              stageWidth={stageSize.w}
              stageHeight={stageSize.h}
              onNavigate={navigateTo}
            />
          )}
        </div>

        {!selectedNode && editableNow && (
          <div className="mm-hint">
            点击选中 · 双击编辑 · 右键功能菜单 · 拖动节点可排序 / 挂接 · Ctrl/Cmd + 左键多选
          </div>
        )}

        {toast && (
          <div className={`mm-toast ${toast.kind === "err" ? "is-err" : ""}`}>
            {toast.text}
          </div>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        title={dialog?.kind === "note" ? "节点备注" : "超链接地址"}
        multiline={dialog?.kind === "note"}
        value={dialog?.value ?? ""}
        placeholder={
          dialog?.kind === "note"
            ? "输入备注内容（Ctrl+Enter 保存）"
            : "https://example.com"
        }
        onChange={(v) => setDialog((d) => (d ? { ...d, value: v } : d))}
        onCancel={() => setDialog(null)}
        onConfirm={confirmDialog}
      />
    </div>
  );
});

export default MindMap;
