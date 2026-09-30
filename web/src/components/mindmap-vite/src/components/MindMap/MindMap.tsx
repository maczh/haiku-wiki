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
import { DEFAULT_CONFIG, DEFAULT_TEXT } from "./types";
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
import { ExtrasLayer, FormulaText, NodeImage, NodeTags } from "./extras";
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
import { Dialog } from "./Dialog";
import { Icon } from "./Icons";
import { Minimap } from "./Minimap";
import {
  downloadBlob,
  exportTree,
  parseMindmapFile,
  type ExportFormat,
  type SvgPayload,
} from "./io";
import "./MindMap.css";

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const HISTORY_LIMIT = 80;

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
}

type DocAction =
  | { type: "commit"; tree: MindNode; focusId?: string | null }
  | { type: "select"; id: string | null }
  | { type: "reset"; tree: MindNode }
  | { type: "undo" }
  | { type: "redo" };

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
      };
    }
    case "select":
      return state.selectedId === action.id
        ? state
        : { ...state, selectedId: action.id };
    case "reset":
      return {
        tree: action.tree,
        past: [],
        future: [],
        selectedId: action.tree.id,
      };
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        tree: prev,
        past: state.past.slice(0, -1),
        future: [state.tree, ...state.future].slice(0, HISTORY_LIMIT),
        selectedId: state.selectedId,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const past = [...state.past, state.tree].slice(-HISTORY_LIMIT);
      return { tree: next, past, future: state.future.slice(1), selectedId: state.selectedId };
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
  const { from, to, axis, sgn, curve } = l;
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
  if (curve) {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const mx = x1 + sgn * Math.max(14, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
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
  const radius = base.radius ?? theme.radius;
  const strokeWidth = base.strokeWidth ?? theme.strokeWidth;
  const canvasBg = base.background ?? theme.background;

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
          dispatch({ type: "select", id: null });
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
    dispatch({ type: "select", id: null });
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

  /** 按深度批量设置收起状态：depth >= d 的节点收起（d 为极大值时全展开） */
  const setCollapsedBelow = useCallback((d: number) => {
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

      /* 配置（主题 / 结构 / 连线 / 基础样式） */
      getConfig: () => config,
      setConfig: (patch) => setConfig((c) => ({ ...c, ...patch })),
      setStructure: (s) => setConfig((c) => ({ ...c, structure: s })),
      setLineStyle: (s) => setConfig((c) => ({ ...c, lineStyle: s })),
      setThemeId: (t) => setConfig((c) => ({ ...c, themeId: t })),
      setBase: (patch) => setConfig((c) => ({ ...c, base: { ...c.base, ...patch } })),
      getBase: () => config.base ?? {},

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
      getScale: () => transform.scale,
      getView: () => ({ scale: transform.scale, tx: transform.tx, ty: transform.ty }),
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
              { id: `assoc-${Date.now().toString(36)}`, fromId, toId, label: label || undefined },
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
      addChild,
      addParent,
      addSibling,
      applyStyle,
      buildSvgPayload,
      collapseToDepth,
      doc.future.length,
      doc.past.length,
      doc.selectedId,
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
            {layout.links.map((l) => (
              <path
                key={`${l.from.node.id}->${l.to.node.id}`}
                d={linkPath(l)}
                fill="none"
                stroke={l.color}
                strokeWidth={linkWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* 关联线 / 外框 / 概要：画在连线之上、节点之下 */}
            <ExtrasLayer root={doc.tree} nodes={layoutNodes} />

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
              const isSelected = node.id === doc.selectedId && !editing;
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
                    dispatch({ type: "select", id: node.id });
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
                    startEdit(node);
                  }}
                >
                  <title>
                    {node.title}
                    {node.note ? `\n备注：${node.note}` : ""}
                    {node.link ? `\n链接：${node.link}` : ""}
                  </title>
                  {isSelected && (
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
                  {showRect && (
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
                          : isSelected
                          ? strokeWidth + 0.6
                          : strokeWidth
                      }
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
                    <line
                      className="mm-underline"
                      x1={UNDER_LEFT}
                      y1={underY}
                      x2={UNDER_LEFT + prefixWidth(node) + railTextW + UNDER_PAD_R}
                      y2={underY}
                      stroke={stroke}
                      strokeWidth={1.6}
                    />
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
            点击选中 · 双击编辑 · 右键功能菜单 · 拖动节点可排序 / 挂接
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
