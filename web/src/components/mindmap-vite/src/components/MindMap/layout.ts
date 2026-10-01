import type { LineStyle, MindNode, StructureType } from "./types";
import { measureText, wrapText } from "./text";
import { FISHBONE_ACCENT } from "./theme";

export interface SizedNode {
  w: number;
  h: number;
  lines: string[];
  lineHeight: number;
  fontSize: number;
}

export interface PositionedNode {
  node: MindNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** 子节点延伸的主轴：h 水平 / v 垂直 */
  axis: "h" | "v";
  /** 延伸方向：h → 1 右 / -1 左；v → 1 下 / -1 上 */
  sgn: 1 | -1;
  centerX: number;
  centerY: number;
  /** 节点渲染旋转角度（度），鱼骨图节点沿骨头方向倾斜 */
  rot: number;
  /**
   * 子树「主干」竖线的 x 位置，**相对节点自身左上角**（节点局部坐标，与渲染时
   * `translate(${x},${y})` 之后的坐标系一致，故不受整体归一化平移影响）。
   * 折叠按钮以此为落点，使竖线看起来从折叠按钮向下伸出。
   */
  busX?: number;
  /**
   * 鱼骨图「锚点」相对节点自身左上角的偏移（节点局部坐标）。
   * 鱼骨图的节点锚在 45° 斜骨上，折叠圆点必须画在锚点处而不是盒子边缘。
   */
  dotDX?: number;
  dotDY?: number;
}

export interface MindLink {
  from: PositionedNode;
  to: PositionedNode;
  color: string;
  curve: boolean;
  axis: "h" | "v" | "diag";
  sgn: 1 | -1;
  /** 预计算路径（时间轴 / 鱼骨图等复杂连线） */
  path?: string;
  /**
   * 是否画成直线（lineStyle = "straight"）。
   * 由 layoutTree 在出口统一按 lineStyle 回填，各布局函数无需关心这个形态差异。
   */
  straight?: boolean;
}

export interface LayoutResult {
  nodes: PositionedNode[];
  links: MindLink[];
  width: number;
  height: number;
  byId: Map<string, PositionedNode>;
  rootPos: PositionedNode;
}

export interface LayoutOptions {
  structure: StructureType;
  branchColors: Map<string, string>;
  linkColor: string;
  lineStyle: LineStyle;
}

const H_GAP = 58; // 水平层间距
const V_GAP = 12; // 同一侧节点垂直间距
const V_LEVEL_GAP = 46; // 上下结构的层间距
const V_SIB_GAP = 22; // 上下结构同级节点水平间距
const PAD_X = 16;
const PAD_Y = 11;
const MIN_W = 72;

/**
 * 左对齐文本（下划线样式 / 时间轴子节点）相对节点左缘的内边距。
 * 布局层与渲染层必须用同一个值，否则「连线接入点」与「文字实际位置」会错位。
 */
export const TEXT_LEFT_INSET = 12;
/** 单个标记图标的占位宽度 */
const MARKER_W = 19;
/** 优先级 / 进度 / 图标 前缀的占位宽度 */
const BADGE_W = 17;
const PREFIX_GAP = 3;
/** 备注 / 链接小图标的占位宽度 */
const RIGHT_BADGE_W = 15;
/** 节点缩略图方框边长（渲染与布局共用，保证连线接入点与图片位置对齐） */
export const IMAGE_BOX = 40;
/** 缩略图与文字之间的间距 */
const IMAGE_GAP = 6;
/** 标签小色块高度与水平间距 */
const TAG_H = 16;
const TAG_PAD_X = 6;
const TAG_GAP = 4;

import { latexWidth } from "./extras";

/** 单个标签色块宽度（与渲染层 measureTagWidth 保持同口径） */
export function measureTagWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[一-龥＀-￯]/.test(ch) ? 11 : 6.2;
  return w + TAG_PAD_X * 2;
}

/** 文字左侧前缀（标记 + 优先级 + 进度 + 图标 + 标签 + 缩略图）总宽度 */
export function prefixWidth(node: MindNode): number {
  let w = (node.markers?.length ?? 0) * MARKER_W;
  if (node.priority) w += BADGE_W + PREFIX_GAP;
  if (node.progress != null) w += BADGE_W + PREFIX_GAP;
  w += (node.icons?.length ?? 0) * (BADGE_W + PREFIX_GAP);
  if (node.tags?.length) {
    w += node.tags.reduce((s, t) => s + measureTagWidth(t) + TAG_GAP, -TAG_GAP);
  }
  if (node.image) w += IMAGE_BOX + IMAGE_GAP;
  return w;
}

/** 右上角角标（备注 / 链接）占位宽度 */
export function rightBadgeWidth(node: MindNode): number {
  return (node.note ? RIGHT_BADGE_W : 0) + (node.link ? RIGHT_BADGE_W : 0);
}

/**
 * 按层级返回默认字号（节点未显式设置字号时生效）：
 *   根节点最大 → 一级节点次之 → 二级及以下 / 叶子节点最小。
 * 与形状规则配合构成层级视觉：根 / 一级节点为带外框的色块，
 * 二级及以下 / 叶子节点为下划线风格（无外边框）。
 */
export function defaultFontSizeForDepth(depth: number): number {
  if (depth <= 0) return 24; // 根节点
  if (depth === 1) return 18; // 一级节点
  return 11; // 二级及以下 / 叶子节点
}

/** 节点盒子的内边距 / 最小尺寸档位（不同结构可选用不同档位） */
export interface SizePad {
  padX: number;
  padY: number;
  minW: number;
  minH: number;
}

const DEFAULT_PAD: SizePad = { padX: PAD_X, padY: PAD_Y, minW: MIN_W, minH: 34 };

/**
 * 计算单个节点的渲染尺寸（含前缀与角标占位）。
 * **不自动换行**：节点内容不允许按宽度折行（含叶子节点），节点宽度随内容自适应；
 * 仅保留用户显式输入的换行符 `\n`。为此向 wrapText 传入极大宽度以关闭宽度折行。
 *
 * `pad` 仅影响盒子几何（宽高），不影响字号与折行结果 —— 因此渲染层按默认档位取
 * 文本行信息、布局层按结构档位取盒子尺寸时，两者仍然一致。
 */
export function nodeSize(node: MindNode, depth = 0, pad: SizePad = DEFAULT_PAD): SizedNode {
  const fontSize = node.style?.fontSize ?? defaultFontSizeForDepth(depth);
  const bold = !!node.style?.bold;
  const m = wrapText(node.title || " ", fontSize, Number.POSITIVE_INFINITY, bold);
  // 公式节点：正文区是 LaTeX 而非纯文本，宽度改由 katex 实测结果决定
  if (node.formula) {
    const pref = prefixWidth(node);
    const right = rightBadgeWidth(node);
    const extra = pad.padX * 2 + pref + right;
    const contentW = latexWidth(node.formula, fontSize);
    const w = Math.max(contentW + extra, pad.minW + pref + right);
    const h = Math.max(fontSize * 2 + pad.padY * 2, pad.minH);
    return { w, h, lines: [], lineHeight: fontSize * 1.6, fontSize };
  }
  const pref = prefixWidth(node);
  const right = rightBadgeWidth(node);
  const extra = pad.padX * 2 + pref + right;
  const w = Math.max(m.width + extra, pad.minW + pref + right);
  let h = Math.max(m.height + pad.padY * 2, fontSize * 1.5 + pad.padY * 2, pad.minH);
  // 带缩略图的节点至少给图片方框留足高度，否则缩略图会撑破节点盒子
  if (node.image) h = Math.max(h, IMAGE_BOX + pad.padY * 2);
  return { w, h, lines: m.lines, lineHeight: m.lineHeight, fontSize };
}

/** 文本块宽度（取最宽一行，不含内边距与前后缀占位）。 */
export function textBlockWidth(node: MindNode, size: SizedNode): number {
  const bold = !!node.style?.bold;
  let w = 0;
  for (const l of size.lines) w = Math.max(w, measureText(l || " ", size.fontSize, bold));
  return w;
}


/** 节点内文本区域水平居中位置（左侧给前缀留位，右侧给角标留位） */
export function textCenterX(node: MindNode, w: number): number {
  const pref = prefixWidth(node);
  return pref + (w - pref - rightBadgeWidth(node)) / 2;
}

type Sizer = (n: MindNode) => SizedNode;

function makeSizer(depthMap: Map<string, number>): Sizer {
  const cache = new Map<string, SizedNode>();
  return (n: MindNode): SizedNode => {
    let s = cache.get(n.id);
    if (!s) {
      s = nodeSize(n, depthMap.get(n.id) ?? 0);
      cache.set(n.id, s);
    }
    return s;
  };
}

/**
 * 时间轴专用尺寸：整体比默认档位更紧凑 —— 根 / 一级是「细胶囊」，
 * 二级及以下只是紧贴文字的一行（无盒子、无下划线，仿参考截图）。
 * 仅改变盒子几何，字号与折行仍与渲染层一致。
 */
function makeTimelineSizer(depthMap: Map<string, number>): Sizer {
  const cache = new Map<string, SizedNode>();
  return (n: MindNode): SizedNode => {
    let s = cache.get(n.id);
    if (!s) {
      const d = depthMap.get(n.id) ?? 0;
      s =
        d <= 1
          ? nodeSize(n, d, { padX: PAD_X, padY: 4, minW: MIN_W, minH: 32 })
          : nodeSize(n, d, { padX: 10, padY: 3, minW: 0, minH: 22 });
      cache.set(n.id, s);
    }
    return s;
  };
}

/**
 * 鱼骨图专用尺寸（仿参考截图）：
 *   · 根 / 一级是细胶囊（盒高 ≈ 1.9× 字号，与实测比例一致）；
 *   · 二级及以下没有盒子，宽度正好等于「文字 + 左侧 12px 锚点区」，
 *     高度 = 1.5× 字号 + 4 —— 既保证括号行距（34）不会与相邻行重叠，
 *     又能让透明命中区、选中框正好贴合文字。
 * 仅改变盒子几何，字号与折行仍与渲染层一致。
 */
function makeFishboneSizer(depthMap: Map<string, number>): Sizer {
  const cache = new Map<string, SizedNode>();
  return (n: MindNode): SizedNode => {
    let s = cache.get(n.id);
    if (!s) {
      const d = depthMap.get(n.id) ?? 0;
      s =
        d <= 1
          ? nodeSize(n, d, { padX: PAD_X, padY: 4, minW: MIN_W, minH: 34 })
          : nodeSize(n, d, { padX: 6, padY: 2, minW: 0, minH: 0 });
      cache.set(n.id, s);
    }
    return s;
  };
}

interface RawResult {
  nodes: PositionedNode[];
  links: MindLink[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  root: PositionedNode;
}

const mkNode = (
  node: MindNode,
  x: number,
  y: number,
  depth: number,
  axis: "h" | "v",
  sgn: 1 | -1,
  size: SizedNode,
  rot = 0
): PositionedNode => ({
  node,
  x,
  y,
  w: size.w,
  h: size.h,
  depth,
  axis,
  sgn,
  centerX: x + size.w / 2,
  centerY: y + size.h / 2,
  rot,
});

function bounds(nodes: PositionedNode[]) {
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h)),
  };
}

/* ------------------------------------------------------------------ */
/* 水平单侧布局（逻辑结构图 / 思维导图单侧）                            */
/* ------------------------------------------------------------------ */

function layoutSide(
  root: MindNode,
  side: 1 | -1,
  branchColors: Map<string, string>,
  linkColor: string,
  curve: boolean,
  sizeOf: Sizer,
  baseDepth = 0
): RawResult {
  const getW = (n: MindNode) => sizeOf(n).w;
  const getH = (n: MindNode) => sizeOf(n).h;

  const yTop = new Map<string, number>();
  let cursor = 0;
  const computeY = (n: MindNode): void => {
    const kids = n.collapsed ? [] : n.children;
    if (!kids.length) {
      const y = cursor;
      cursor += getH(n) + V_GAP;
      yTop.set(n.id, y);
      return;
    }
    const ys = kids.map((c) => {
      computeY(c);
      return yTop.get(c.id)!;
    });
    const firstC = ys[0] + getH(kids[0]) / 2;
    const lastC = ys[ys.length - 1] + getH(kids[kids.length - 1]) / 2;
    yTop.set(n.id, (firstC + lastC) / 2 - getH(n) / 2);
  };
  computeY(root);

  const nodes: PositionedNode[] = [];
  const links: MindLink[] = [];

  // 每个一级分支独立计算「列宽」：某分支深层出现一个超宽节点时，只向外撑宽
  // 该分支自己的列，而不会把其它分支的整列都推远。旧实现用全局 depth 列宽
  // （所有分支在同深度共享 pitch[d]），一个宽节点会让所有分支同深度列一起膨胀，
  // 画布被拉得极宽 → fit() 缩放到极小 → 视觉上像「零散的长链」而非紧凑的思维导图。
  interface Branch { node: MindNode; widths: number[]; }
  const kids = root.collapsed ? [] : root.children;
  const branches: Branch[] = kids.map((b) => {
    const widths: number[] = [];
    const walk = (n: MindNode, rd: number) => {
      widths[rd] = Math.max(widths[rd] ?? 0, getW(n));
      if (!n.collapsed) n.children.forEach((c) => walk(c, rd + 1));
    };
    walk(b, 0);
    return { node: b, widths };
  });

  const rootW = getW(root);
  const rootX = side === 1 ? 0 : -rootW;
  const rootPos = mkNode(root, rootX, yTop.get(root.id)!, baseDepth, "h", side, sizeOf(root));
  nodes.push(rootPos);
  // 右向：根右缘作为一级列起点；左向：根左缘
  const rootEdge = side === 1 ? rootX + rootW : rootX;

  for (const br of branches) {
    const place = (n: MindNode, rd: number, parent?: PositionedNode): void => {
      const w = getW(n);
      let x: number;
      if (side === 1) {
        // 右向：子节点紧贴「父节点右缘 + 层间距」，父右到哪里子就接哪里。
        // 这里刻意**不用**本分支该深度的最大宽度（br.widths[rd-1]）当列宽：同一个父节点下
        // 只要有一个宽兄弟（比如「预订规则：时段、最低消费、超时释放」），整列就会被推到最宽那个
        // 兄弟的宽度之外，窄父节点（如「定金与退订」）的子节点因此被甩出两百多像素，
        // 视觉上就是大片空白。按父宽推进既紧凑，也不会与同层节点重叠。
        x = rd === 0 ? rootEdge + H_GAP : (parent as PositionedNode).x + (parent as PositionedNode).w + H_GAP;
      } else {
        // 左向：子节点右缘 = 父左缘 - 层间距（父宽在这里自动约掉）。
        // 同样不用最大宽度，否则一个宽兄弟会把整条左链往外推很远，正是「左右间距过大」的来源。
        if (rd === 0) x = rootEdge - H_GAP - w;
        else x = (parent as PositionedNode).x - H_GAP - w;
      }
      const pos = mkNode(n, x, yTop.get(n.id)!, baseDepth + 1 + rd, "h", side, sizeOf(n));
      nodes.push(pos);
      if (parent) {
        links.push({
          from: parent,
          to: pos,
          color: branchColors.get(n.id) ?? linkColor,
          curve,
          axis: "h",
          sgn: side,
        });
      }
      if (!n.collapsed) n.children.forEach((c) => place(c, rd + 1, pos));
    };
    place(br.node, 0, rootPos);
  }

  const b = bounds(nodes);
  return { nodes, links, ...b, root: nodes[0] };
}

/* ------------------------------------------------------------------ */
/* 平衡布局（思维导图）                                                 */
/* ------------------------------------------------------------------ */

function splitBalanced(root: MindNode): { left: MindNode[]; right: MindNode[] } {
  const weight = (n: MindNode): number =>
    n.collapsed ? 1 : n.children.length ? n.children.reduce((a, c) => a + weight(c), 0) : 1;
  const left: MindNode[] = [];
  const right: MindNode[] = [];
  let L = 0;
  let R = 0;
  for (const c of root.children) {
    if (R <= L) {
      right.push(c);
      R += weight(c);
    } else {
      left.push(c);
      L += weight(c);
    }
  }
  return { left, right };
}

function layoutBalanced(
  root: MindNode,
  branchColors: Map<string, string>,
  linkColor: string,
  curve: boolean,
  sizeOf: Sizer
): RawResult {
  const { left, right } = splitBalanced(root);
  const rightTree: MindNode = { ...root, children: right };
  const leftTree: MindNode = { ...root, children: left };
  const rR = layoutSide(rightTree, 1, branchColors, linkColor, curve, sizeOf);
  const rL = layoutSide(leftTree, -1, branchColors, linkColor, curve, sizeOf);
  // layoutSide 对两侧「根副本」的落点不同：右侧根占据 [0, rootW]，左侧根占据
  // [-rootW, 0]。这里保留了右侧根作为真正的根节点，因此必须把左侧整体在 x 上
  // 对齐（对齐量正好是一个根节点宽度 rootW）—— 否则左侧一级节点与根之间的间距
  // 会比右侧多出整整一个 rootW，左右不对称。
  const dy = rR.root.y - rL.root.y;
  const dx = rR.root.x - rL.root.x;
  for (const n of rL.nodes) {
    n.y += dy;
    n.centerY += dy;
    n.x += dx;
    n.centerX += dx;
  }
  // 左右两次布局各自生成了一个「根节点副本」，这里只保留右侧那份，
  // 左侧副本随即被丢弃 —— 因此左侧分支的连线必须改指到真正的根节点上，
  // 否则会引用一个既不参与归一化、也不参与渲染的坐标（连线会被画到画布外）。
  // 根节点的收起按钮朝向右侧
  const rootPos = rR.root;
  const leftChildren = rL.nodes.filter((n) => n.node.id !== root.id);
  const nodes = [...rR.nodes, ...leftChildren];
  const links: MindLink[] = [
    ...rR.links,
    ...rL.links.map((l) => (l.from === rL.root ? { ...l, from: rootPos } : l)),
  ];
  const b = bounds(nodes);
  return { nodes, links, ...b, root: rootPos };
}

/* ------------------------------------------------------------------ */
/* 上下布局（组织结构图 / 目录组织图）                                  */
/* ------------------------------------------------------------------ */

function layoutVertical(
  root: MindNode,
  branchColors: Map<string, string>,
  linkColor: string,
  curve: boolean,
  align: "center" | "left",
  sizeOf: Sizer
): RawResult {
  const swCache = new Map<string, number>();
  const sw = (n: MindNode): number => {
    const cached = swCache.get(n.id);
    if (cached != null) return cached;
    const size = sizeOf(n);
    const kids = n.collapsed ? [] : n.children;
    let v: number;
    if (!kids.length) v = size.w;
    else {
      const kidsW = kids.reduce((a, k) => a + sw(k), 0) + V_SIB_GAP * (kids.length - 1);
      v = Math.max(size.w, kidsW);
    }
    swCache.set(n.id, v);
    return v;
  };

  const xOf = new Map<string, number>();
  const placeX = (n: MindNode, left: number) => {
    const size = sizeOf(n);
    const span = sw(n);
    const kids = n.collapsed ? [] : n.children;
    if (!kids.length) {
      xOf.set(n.id, left + (align === "center" ? (span - size.w) / 2 : 0));
      return;
    }
    const kidsW = kids.reduce((a, k) => a + sw(k), 0) + V_SIB_GAP * (kids.length - 1);
    let cx = left + (align === "center" ? (span - kidsW) / 2 : 0);
    kids.forEach((k) => {
      placeX(k, cx);
      cx += sw(k) + V_SIB_GAP;
    });
    xOf.set(n.id, align === "center" ? left + (span - size.w) / 2 : left);
  };
  placeX(root, 0);

  const levelH: number[] = [];
  const walkD = (n: MindNode, d: number) => {
    levelH[d] = Math.max(levelH[d] ?? 0, sizeOf(n).h);
    if (!n.collapsed) n.children.forEach((c) => walkD(c, d + 1));
  };
  walkD(root, 0);
  const levelY: number[] = [];
  let acc = 0;
  for (let d = 0; d < levelH.length; d++) {
    levelY[d] = acc;
    acc += levelH[d] + V_LEVEL_GAP;
  }

  const nodes: PositionedNode[] = [];
  const links: MindLink[] = [];
  const place = (n: MindNode, depth: number, parent?: PositionedNode) => {
    const size = sizeOf(n);
    const y = levelY[depth] + (levelH[depth] - size.h) / 2;
    const pos = mkNode(n, xOf.get(n.id)!, y, depth, "v", 1, size);
    nodes.push(pos);
    if (parent) {
      links.push({
        from: parent,
        to: pos,
        color: branchColors.get(n.id) ?? linkColor,
        curve,
        axis: "v",
        sgn: 1,
      });
    }
    if (!n.collapsed) n.children.forEach((c) => place(c, depth + 1, pos));
  };
  place(root, 0);

  const b = bounds(nodes);
  return { nodes, links, ...b, root: nodes[0] };
}

/* ------------------------------------------------------------------ */
/* 目录组织图（缩进式目录树）                                          */
/*   根节点居中于顶部；一级节点横向并列成「列」；列内按 DFS 前序自上而下   */
/*   依次落位，每深一层向右缩进一级；连线为肘形折线                    */
/*   （父底部 → 竖向下行 → 短横头 → 子节点左缘）。                      */
/*                                                                   */
/*   关键：列内使用一个自上而下「单调推进」的游标，父节点先于其全部子孙   */
/*   落位、游标只增不减，因此从结构上不可能出现节点重叠 —— 旧实现只按      */
/*   直接子节点自身高度推进游标，兄弟节点会落进前一个兄弟的子树区域造成    */
/*   大面积重叠。                                                      */
/* ------------------------------------------------------------------ */

const CAT_INDENT = 38; // 每深一层向右缩进
const CAT_STUB = 10; // 折线末端短横头长度
const CAT_COL_GAP = 46; // 相邻一级列之间的间距
const CAT_BUS_DROP = 18; // 根 → 一级：汇流线高于一级节点行的距离

function layoutCatalog(
  root: MindNode,
  branchColors: Map<string, string>,
  linkColor: string,
  curve: boolean,
  sizeOf: Sizer
): RawResult {
  const rootSize = sizeOf(root);
  const nodes: PositionedNode[] = [];
  const links: MindLink[] = [];
  const kids = root.collapsed ? [] : root.children;

  // 根节点居中于顶部
  const rootPos = mkNode(root, -rootSize.w / 2, 0, 0, "v", 1, rootSize);
  // 根的子树竖线从底边中点垂下（与其汇流连线起点一致），而非左侧缩进位
  if (root.children.length) rootPos.busX = rootSize.w / 2;
  nodes.push(rootPos);

  // 子树相对本列左缘的最大横向占宽（含逐层缩进），决定列宽
  const colWidth = (n: MindNode, rel: number): number => {
    let m = rel * CAT_INDENT + sizeOf(n).w;
    if (!n.collapsed) for (const c of n.children) m = Math.max(m, colWidth(c, rel + 1));
    return m;
  };

  const widths = kids.map((k) => colWidth(k, 0));
  const totalW = widths.reduce((a, b) => a + b, 0) + CAT_COL_GAP * Math.max(0, kids.length - 1);
  const top = rootSize.h + V_LEVEL_GAP; // 一级节点所在行
  const busY = top - CAT_BUS_DROP; // 根到一级的汇流线高度

  let colX = -totalW / 2;
  kids.forEach((k, i) => {
    // 列内游标：DFS 前序自上而下单调推进，保证同列节点纵向互不重叠
    let cursor = top;

    const place = (n: MindNode, rel: number, depth: number, parent?: PositionedNode): PositionedNode => {
      const size = sizeOf(n);
      const pos = mkNode(n, colX + rel * CAT_INDENT, cursor, depth, "v", 1, size);
      nodes.push(pos);

      // 有子节点时，子树竖线落在「下一层缩进位置」再左移一个短横头（相对本节点左缘）
      if (n.children.length) pos.busX = CAT_INDENT - CAT_STUB;

      if (parent) {
        const x0 = pos.x - CAT_STUB;
        const y0 = parent.y + parent.h;
        const y1 = pos.centerY;
        // 拐角做小圆角，避免生硬的直角
        const r = Math.min(5, Math.max(0, (y1 - y0) / 2), CAT_STUB);
        links.push({
          from: parent,
          to: pos,
          color: branchColors.get(n.id) ?? linkColor,
          curve,
          axis: "v",
          sgn: 1,
          path:
            r > 0.5
              ? `M ${x0} ${y0} L ${x0} ${y1 - r} Q ${x0} ${y1} ${x0 + r} ${y1} L ${pos.x} ${y1}`
              : `M ${x0} ${y0} L ${x0} ${y1} L ${pos.x} ${y1}`,
        });
      }

      cursor += size.h + V_GAP;
      if (!n.collapsed) for (const c of n.children) place(c, rel + 1, depth + 1, pos);
      return pos;
    };

    const kpos = place(k, 0, 1);

    // 根 → 一级：竖直下行至汇流线，横穿至本列，再下落到一级节点顶部
    links.push({
      from: rootPos,
      to: kpos,
      color: branchColors.get(k.id) ?? linkColor,
      curve,
      axis: "v",
      sgn: 1,
      path: `M ${rootPos.centerX} ${rootPos.y + rootPos.h} L ${rootPos.centerX} ${busY} L ${kpos.centerX} ${busY} L ${kpos.centerX} ${kpos.y}`,
    });

    colX += widths[i] + CAT_COL_GAP;
  });

  const b = bounds(nodes);
  return { nodes, links, ...b, root: rootPos };
}

/* ------------------------------------------------------------------ */
/* 时间轴（仿参考截图）                                                 */
/*                                                                   */
/*   根节点（实心胶囊）在最左端，一条水平主轴向右贯穿全部一级节点；       */
/*   一级节点是带描边的胶囊、直接挂在主轴上（不透明底色遮住主轴）；       */
/*   一级子树沿主轴「上下交替」——偶数序号向下、奇数序号向上；            */
/*   子树连线为肘形折线：自父节点边沿沿竖线下行 / 上行，末端一个短横头     */
/*   收在子节点文本左前方；每深一层整体向右缩进 TL_INDENT。              */
/*   二级及以下节点无盒子、无下划线，只有左对齐文字（由渲染层配合）。      */
/* ------------------------------------------------------------------ */

const TL_COL_GAP = 56; // 相邻一级列之间的间距
const TL_INDENT = 36; // 每深一层，子节点文本向右缩进（与参考截图贴合度可调）
const TL_TRUNK_DX = 0; // 子树竖线正好落在「父节点文本左缘」（仿参考截图）
const TL_STUB = TL_INDENT - TL_TRUNK_DX; // 短横头直达子节点文本左缘（不留白）
const TL_V_GAP = 8; // 同一列内的纵向行距

function layoutTimeline(
  root: MindNode,
  branchColors: Map<string, string>,
  linkColor: string,
  curve: boolean,
  sizeOf: Sizer
): RawResult {
  const rootSize = sizeOf(root);
  const kids = root.collapsed ? [] : root.children;
  const nodes: PositionedNode[] = [];
  const links: MindLink[] = [];

  // 子树竖直跨度（含全部子孙），用于单调游标推进 —— 旧实现只按直接子节点自身高度
  // 推进游标，导致兄弟节点落进前一个兄弟的子树区域，大面积重叠（与旧目录图同问题）。
  const subH = (n: MindNode): number => {
    const h = sizeOf(n).h;
    const cs = n.collapsed ? [] : n.children;
    if (!cs.length) return h;
    let t = h + TL_V_GAP;
    cs.forEach((c, i) => {
      t += subH(c);
      if (i < cs.length - 1) t += TL_V_GAP;
    });
    return t;
  };

  // 根节点置于最左侧，垂直居中于主轴（centerY = 0）
  const rootPos = mkNode(root, 0, -rootSize.h / 2, 0, "h", 1, rootSize);
  nodes.push(rootPos);
  const rRight = rootPos.x + rootPos.w;

  const AXIS_Y = 0; // 主轴水平线（世界坐标）

  // 一级节点沿主轴横向铺开，全部 centerY = 0（与主轴重合）
  let x = rRight + TL_COL_GAP;
  // 主轴（脊柱）右端点：从根右缘延伸到最后一个一级胶囊右缘，
  // 被一级胶囊的不透明底色遮住，视觉上是一根贯穿全部一级节点的连续脊柱。
  let axisRight = rRight;

  kids.forEach((k, i) => {
    const ksize = sizeOf(k);
    // 上下交替：偶数序号向下、奇数序号向上（SVG y 向下为正，故「上」为 -1）
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const kpos = mkNode(k, x, AXIS_Y - ksize.h / 2, 1, "v", dir, ksize);
    // 子树竖线起点：一级胶囊内文字居中，落在「文本左缘」（TL_TRUNK_DX=0，仿参考截图）
    const kTextLeft = kpos.x + textCenterX(k, ksize.w) - textBlockWidth(k, ksize) / 2;
    kpos.busX = kTextLeft - kpos.x + TL_TRUNK_DX;
    nodes.push(kpos);
    if (kpos.x + kpos.w > axisRight) axisRight = kpos.x + kpos.w;

    // 一级之下 / 之上：向右逐层缩进的「肘形折线树」
    const placeDeep = (
      parent: PositionedNode,
      parentTextLeft: number,
      depth: number,
      d: 1 | -1
    ): void => {
      const cs = parent.node.collapsed ? [] : parent.node.children;
      if (!cs.length) return;
      const childTextLeft = parentTextLeft + TL_INDENT;
      const trunkX = parentTextLeft + TL_TRUNK_DX;
      const parentEdgeY = d === 1 ? parent.y + parent.h : parent.y;
      // 游标：向下的语义是「下一个可用顶边」，向上是「下一个可用底边」
      let cursor = d === 1 ? parent.y + parent.h + TL_V_GAP : parent.y - TL_V_GAP;
      for (const c of cs) {
        const csize = sizeOf(c);
        // 节点盒子按「文本左缘」反推（下划线 / 时间轴子节点文字左对齐于 TEXT_LEFT_INSET）
        const cx = childTextLeft - TEXT_LEFT_INSET - prefixWidth(c);
        const cy = d === 1 ? cursor : cursor - csize.h;
        const cpos = mkNode(c, cx, cy, depth, "v", d, csize);
        // 折叠按钮落在子树竖线上，使竖线看起来从按钮伸出
        cpos.busX = TEXT_LEFT_INSET + prefixWidth(c) + TL_TRUNK_DX;
        nodes.push(cpos);
        links.push({
          from: parent,
          to: cpos,
          color: branchColors.get(c.id) ?? linkColor,
          curve,
          axis: "v",
          sgn: d,
          // 肘形折线：父节点边沿 → 沿竖线下行 / 上行 → 短横头收在子节点文本左前方
          path: `M ${trunkX} ${parentEdgeY} L ${trunkX} ${cpos.centerY} L ${trunkX + TL_STUB} ${cpos.centerY}`,
        });
        placeDeep(cpos, childTextLeft, depth + 1, d);
        if (d === 1) cursor += subH(c) + TL_V_GAP;
        else cursor = cy - (subH(c) - csize.h) - TL_V_GAP;
      }
    };
    placeDeep(kpos, kTextLeft, 2, dir);

    // 下一列的起点 = 本列（含整棵子树）最右缘 + 列间距
    const maxRight = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
    x = maxRight + TL_COL_GAP;
  });

  // 主轴脊柱：一条连续水平线，从根右缘贯穿到最后一个一级胶囊右缘，
  // 被一级胶囊的不透明底色遮住，视觉上是一根完整的脊柱（仿参考截图）。
  links.push({
    from: rootPos,
    to: rootPos,
    color: linkColor,
    curve: false,
    axis: "h",
    sgn: 1,
    path: `M ${rRight} ${AXIS_Y} L ${axisRight} ${AXIS_Y}`,
  });

  const b = bounds(nodes);
  return { nodes, links, ...b, root: rootPos };
}

/* ------------------------------------------------------------------ */
/* 鱼骨图                                                              */
/* ------------------------------------------------------------------ */

/**
 * 鱼骨图几何常量（px）。
 *
 * 取值来自参考截图（奇海 RIS 菜品模型 · 鱼骨图）的像素实测，并按本应用的字号
 * 档位（根 24 / 一级 18 / 二级及以下 11）等比换算：
 *   · 斜骨 45°（实测斜率恰为 1，上、下骨都是 45°）；
 *   · 一级节点盒中心到脊柱 ≈ 4.5×一级字号 → 84；
 *   · 骨上相邻锚点的最小垂直步距 ≈ 3.7×二级字号 → 40；
 *   · 括号子树行距 ≈ 2.8×二级字号 → 34；
 *   · 括号竖线偏移 ≈ 2.0×二级字号 → 22，短横头 ≈ 1.4× → 16；
 *   · 标签相对锚点的水平偏移 ≈ 0.9×二级字号 → 12（与 TEXT_LEFT_INSET 一致）。
 */
const FB_L1_DY = 84; // 一级节点盒中心到脊柱的垂直距离
const FB_L1_CROSS = 0.25; // 斜骨穿过一级盒子的位置（距左缘的宽度比例）
const FB_SLOT = 40; // 骨上相邻锚点的最小垂直步距
const FB_ROW = 34; // 括号子树每行的垂直步距
const FB_RAIL_DX = 22; // 括号竖线相对父锚点的水平偏移
const FB_STUB = 16; // 括号短横头长度
const FB_LABEL_DX = 12; // 标签相对锚点的水平偏移
const FB_BONE_TAIL = 22; // 斜骨末端超出最后一个锚点的长度
const FB_J0 = 62; // 第一根骨与根节点右缘的水平间距
const FB_BONE_GAP = 36; // 同一侧相邻两根骨的间距

/**
 * 鱼骨「括号」子树占用的垂直行数（深度累加）。
 *   叶子 = 0；已折叠分支 = 0；
 *   有子节点的分支 = Σ(子分支行数 + 1) —— 即整棵括号子树在竖向上占多少「行」。
 * 这比「叶子计数」更能反映真实的纵向延伸：一个深 3 层、每层 1 个孩子的链，
 * 行数 = 3（而非 1），因此能正确预留纵向空间、避免后代与兄弟节点重叠。
 */
function bracketExtent(n: MindNode): number {
  if (n.collapsed || !n.children.length) return 0;
  let rows = 0;
  for (const c of n.children) rows += bracketExtent(c) + 1;
  return rows;
}

/**
 * 鱼骨图（仿参考截图）：**水平脊柱 + 45° 斜骨 + 骨上文字 + 括号状子树**。
 *
 * 视觉规则（与参考截图一一对应）：
 *   1. 根节点（蓝色实心圆角盒）在最左，右缘贴住脊柱起点，纵向居中于脊柱；
 *   2. 脊柱是一条水平细线，从根右缘贯穿到最右侧节点；
 *   3. 每根「骨」是一条 45° 直线：自脊柱上的交点起，向上 / 向下交替斜插；
 *   4. 一级节点是带框胶囊，斜骨从它左侧约 1/4 处穿过（盒子不透明，自然压住骨线）；
 *   5. 二级节点是「无框文字」，锚点落在斜骨上、文字排在锚点右侧；
 *      位置沿骨依次向后推移，父节点带子树时该步距按子树行数放大，避免重叠；
 *   6. 三级及以下用「括号」连接：竖线 + 短横头，层层向右缩进，
 *      且向脊柱一侧堆叠（与截图一致：骨上方的分支向下生长、下方分支向上生长）。
 *
 * 所有文字保持水平（不随骨倾斜），仅位置沿斜骨排布。
 */
function layoutFishbone(
  root: MindNode,
  // 鱼骨图强制单色骨架（FISHBONE_ACCENT），不使用逐分支跳色；这两个参数保留以对齐
  // layoutTree 的统一调用签名，当前未使用。
  _branchColors: Map<string, string>,
  _linkColor: string,
  curve: boolean,
  sizeOf: Sizer
): RawResult {
  const rootSize = sizeOf(root);
  const kids = root.collapsed ? [] : root.children;
  const nodes: PositionedNode[] = [];
  const links: MindLink[] = [];

  // 脊柱位于 y = 0；根节点右缘贴在 x = 0
  const rootPos = mkNode(root, -rootSize.w, -rootSize.h / 2, 0, "h", 1, rootSize);
  nodes.push(rootPos);

  // 同一侧的相邻两根骨必须水平错开；上 / 下交替时两者可共用起点（在脊柱上交叉成 X）
  const sideCursor: { up: number; down: number } = { up: FB_J0, down: FB_J0 };
  let spineEnd = 0;

  kids.forEach((k, i) => {
    const up = i % 2 === 0;
    const dir = up ? -1 : 1; // 骨骼向外（远离脊柱）的方向
    const inward = up ? 1 : -1; // 括号子树堆叠方向：朝向脊柱（仿截图）
    const Jx = sideCursor[up ? "up" : "down"];
    // 鱼骨图用单一强调色（仿参考截图的蓝灰），呈现整体协调的单色骨架；
    // 仅当节点自身显式设置了 color / style.borderColor 时保留自定义色。
    const boneColor = k.color ?? k.style?.borderColor ?? FISHBONE_ACCENT;
    const ks = sizeOf(k);
    let boneRight = Jx;

    /**
     * 二级节点起始「到脊柱的垂直距离」d。必须同时满足两条硬约束，否则会出现节点重叠：
     *   (a) 不越过脊柱：整条括号子树（含最深后代）向内堆叠后，仍有 ≥ FB_ROW+ 的余量留在
     *       脊柱外侧 —— 否则深层括号会穿过脊柱、与对侧骨的分支打架；
     *   (b) 不压住一级盒：首个三级括号节点的左缘要落在一级盒右缘之外（一级盒按 0.75w 向右
     *       伸出，括号每深一级只向右 38px，若 d 太小，首个 L3 会叠在宽一级盒上）。
     * d 取两者与默认起始量的最大值，确保两种冲突都不会发生。
     */
    const maxExtent = Math.max(1, ...k.children.map((c) => bracketExtent(c)));
    const spineSafe = FB_L1_DY + maxExtent * FB_ROW + FB_ROW + 4;
    const boxSafe =
      FB_L1_DY +
      (1 - FB_L1_CROSS) * ks.w -
      (FB_RAIL_DX + FB_STUB + FB_LABEL_DX - TEXT_LEFT_INSET);
    const l2Start = Math.max(FB_L1_DY + FB_SLOT, spineSafe, boxSafe);

    const put = (
      n: MindNode,
      depth: number,
      left: number,
      top: number,
      anchorX: number,
      anchorY: number
    ): PositionedNode => {
      const size = sizeOf(n);
      const pos = mkNode(n, left, top, depth, "h", 1, size);
      // 锚点（局部坐标）：渲染层据此画折叠圆点
      pos.dotDX = anchorX - left;
      pos.dotDY = anchorY - top;
      nodes.push(pos);
      if (pos.x + pos.w > boneRight) boneRight = pos.x + pos.w;
      return pos;
    };

    /* -------- 一级节点：盒中心落在斜骨上，再右移使斜骨穿过左侧 1/4 -------- */
    const l1 = put(
      k,
      1,
      Jx + FB_L1_DY - ks.w * FB_L1_CROSS,
      dir * FB_L1_DY - ks.h / 2,
      Jx,
      0 // 折叠圆点落在斜骨与脊柱的交点上
    );

    /* -------- 三级及以下：括号子树（竖线 + 短横头，层层向右缩进） -------- */
    const placeBracket = (
      parent: MindNode,
      parentPos: PositionedNode,
      ax: number,
      ay: number,
      depth: number
    ): void => {
      const cs = parent.collapsed ? [] : parent.children;
      if (!cs.length) return;
      const railX = ax + FB_RAIL_DX;
      const childAnchorX = railX + FB_STUB;
      let acc = 0;
      for (const c of cs) {
        const cSize = sizeOf(c);
        const cy = ay + inward * (acc + 1) * FB_ROW;
        const pos = put(
          c,
          depth,
          childAnchorX + FB_LABEL_DX - TEXT_LEFT_INSET,
          cy - cSize.h / 2,
          childAnchorX,
          cy
        );
        links.push({
          from: parentPos,
          to: pos,
          color: boneColor,
          curve,
          axis: "diag",
          sgn: 1,
          path: `M ${railX} ${ay} L ${railX} ${cy} L ${childAnchorX} ${cy}`,
        });
        placeBracket(c, pos, childAnchorX, cy, depth + 1);
        // 关键修复：子节点自身可能带着一整棵括号子树，其后代会向内再堆叠
        // `bracketExtent(c)` 行；下一兄弟必须排在「当前子节点行 + 整棵子树行数」之后，
        // 否则后代会与下一兄弟落在同一行造成重叠（旧实现用 max(1, fbRows) 少算了深度）。
        acc += bracketExtent(c) + 1;
      }
    };

    /* -------- 二级节点：沿 45° 斜骨依次排开（锚点在骨上、文字在锚点右侧） -------- */
    let cursor = l2Start; // 到脊柱的垂直距离（45° 骨上水平位移 = 垂直位移）
    let tipX = Jx + FB_L1_DY;
    const l2 = k.collapsed ? [] : k.children;
    l2.forEach((c) => {
      const d = cursor;
      const cSize = sizeOf(c);
      const ax = Jx + d;
      const ay = dir * d;
      const pos = put(
        c,
        2,
        ax + FB_LABEL_DX - TEXT_LEFT_INSET,
        ay - cSize.h / 2,
        ax,
        ay
      );
      placeBracket(c, pos, ax, ay, 3);
      // 下一个二级节点起步：若本节点带着深括号子树，要把整棵子树占用的纵向行数
      // （bracketExtent(c) 行 + 自身 1 行）都让出来，避免下一根 L2 文字压住本节点的后代。
      cursor += Math.max(FB_SLOT, bracketExtent(c) * FB_ROW + FB_ROW);
      if (ax > tipX) tipX = ax;
    });

    /* -------- 斜骨：一条 45° 直线自脊柱交点直插最后一个二级节点（盒不透明，自然压住骨线） -------- */
    const tailX = tipX + FB_BONE_TAIL;
    links.push({
      from: rootPos,
      to: l1,
      color: boneColor,
      curve,
      axis: "diag",
      sgn: 1,
      path: `M ${Jx} 0 L ${tailX} ${dir * (tailX - Jx)}`,
    });

    /* -------- 同侧游标推进（防止同一侧相邻两根骨水平重叠） -------- */
    const boneEnd = Math.max(boneRight, tailX);
    sideCursor[up ? "up" : "down"] = boneEnd + FB_BONE_GAP;
    if (boneEnd > spineEnd) spineEnd = boneEnd;
  });

  /* -------- 脊柱：自根节点右缘水平贯穿到最右侧节点（单色骨架） -------- */
  links.push({
    from: rootPos,
    to: rootPos,
    color: FISHBONE_ACCENT,
    curve: false,
    axis: "h",
    sgn: 1,
    path: `M 0 0 L ${spineEnd} 0`,
  });

  const b = bounds(nodes);
  return { nodes, links, ...b, root: rootPos };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */

export function layoutTree(root: MindNode, opts: LayoutOptions): LayoutResult {
  // 计算每个节点在整棵树中的层级，供「按层级默认字号」使用（不改动节点数据本身）
  const depthMap = new Map<string, number>();
  const walkDepth = (n: MindNode, d: number) => {
    depthMap.set(n.id, d);
    for (const c of n.children) walkDepth(c, d + 1);
  };
  walkDepth(root, 0);
  const sizeOf = makeSizer(depthMap);
  const { branchColors, linkColor, lineStyle, structure } = opts;
  const curve = lineStyle === "curve";

  let raw: RawResult;
  switch (structure) {
    case "logical-left":
      raw = layoutSide(root, -1, branchColors, linkColor, curve, sizeOf);
      break;
    case "mindmap":
      raw = layoutBalanced(root, branchColors, linkColor, curve, sizeOf);
      break;
    case "org":
      raw = layoutVertical(root, branchColors, linkColor, curve, "center", sizeOf);
      break;
    case "catalog":
      raw = layoutCatalog(root, branchColors, linkColor, curve, sizeOf);
      break;
    case "timeline":
      // 时间轴用更紧凑的尺寸档位（细胶囊 + 紧贴文字的子节点行），更贴近参考截图
      raw = layoutTimeline(root, branchColors, linkColor, curve, makeTimelineSizer(depthMap));
      break;
    case "fishbone":
      // 鱼骨图用专用尺寸档位：细胶囊 + 紧贴文字的无框子节点行（仿参考截图）
      raw = layoutFishbone(root, branchColors, linkColor, curve, makeFishboneSizer(depthMap));
      break;
    case "logical-right":
    default:
      raw = layoutSide(root, 1, branchColors, linkColor, curve, sizeOf);
      break;
  }

  const nodes = raw.nodes;
  const links = raw.links;

  // 归一化：整体平移到 (0,0) 起点
  const minX = raw.minX;
  const minY = raw.minY;
  for (const n of nodes) {
    n.x -= minX;
    n.y -= minY;
    n.centerX -= minX;
    n.centerY -= minY;
  }
  // 注意：raw.root 已是 nodes 中的元素（各布局均把根节点放入 nodes），上面的循环已经平移过它，
  // 这里不能再平移一次，否则根节点会被重复偏移（minX<0 时尤其明显，会把思维导图/鱼骨图的根推出去压住分支）。
  for (const l of links) {
    l.straight = lineStyle === "straight";
    if (l.path) {
      l.path = l.path.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_m, a: string, b: string) => {
        const x = parseFloat(a) - minX;
        const y = parseFloat(b) - minY;
        return `${+x.toFixed(2)} ${+y.toFixed(2)}`;
      });
    }
  }

  const width = Math.max(...nodes.map((n) => n.x + n.w));
  const height = Math.max(...nodes.map((n) => n.y + n.h));
  const byId = new Map(nodes.map((n) => [n.node.id, n]));

  return { nodes, links, width, height, byId, rootPos: raw.root };
}
